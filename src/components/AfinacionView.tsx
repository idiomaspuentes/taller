import { useCallback, useEffect, useMemo, useState } from "react";
import { loadSession, type GtSession } from "../dcs/auth";
import { loadAfinacionNotes, loadTermTitles, type AfinacionNotesData, type AfinacionStep } from "../dcs/afinacionLoad";
import { appendMyDecision, loadDecisionFiles, savePreferredTerm, saveCorrection } from "../dcs/afinacionStore";
import { commentOnIssue } from "../dcs/issues";
import { formatChatEvent } from "../domain/chatEvent";
import { loadAssignmentsFromDcs } from "../dcs/persist";
import { groupByCategory, type NoteItem } from "../domain/afinacionNotes";
import { compareTermRenderings, termLabel, type PreferredTerms, type TermItem } from "../domain/afinacionWords";
import { selectionFromWords, toggleWord, wordSpans, wordsOfSelection } from "../domain/afinacionSelection";
import { matchHelpQuoteToTokenIndices, tokenizeVersePlainText } from "../domain/helpQuoteMatch";
import {
  mergeDecisionFiles,
  reviewersToNotifyAfterEdit,
  summarizeRound,
  tallyItem,
  textFingerprint,
  type ReviewDecision,
  type ReviewStance,
} from "../domain/reviewRound";
import { levelOf, meetsLevel } from "../domain/levels";
import { decodeSolverLaunchContext, type SolverLaunchContext } from "../domain/solverLaunch";
import { resolveSourcePackage } from "../domain/sourcePackage";
import type { ProjectTask } from "../domain/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Props = {
  ctxEncoded: string;
  /** `notas` or `palabras`. */
  step?: AfinacionStep;
  onClose: () => void;
  announce: (msg: string) => void;
};

const STANCE_LABEL: Record<ReviewStance, string> = {
  approved: "De acuerdo",
  revise: "Propongo un cambio",
  rejected: "Tengo una objeción",
};

const QUESTION: Record<AfinacionStep, Record<"tpl" | "tps", string>> = {
  notas: {
    tpl: "¿El borrador conserva la forma del original?",
    tps: "¿El borrador deja claro el significado?",
  },
  palabras: {
    tpl: "¿Este término está traducido como en el resto del libro?",
    tps: "¿Este término mantiene el mismo sentido que en el resto del libro?",
  },
};

const TITLE: Record<AfinacionStep, string> = { notas: "Revisar notas", palabras: "Revisar palabras clave" };

const STATE_LABEL = { agreed: "Acordada", disputed: "En discusión", pending: "Pendiente" } as const;

const isRtl = (text: string) => /[\u0590-\u05FF\u0600-\u06FF]/.test(text);

function Words({ text, marked, onTap, selected }: { text: string; marked?: number[]; onTap?: (i: number) => void; selected?: number[] }) {
  const words = wordSpans(text);
  if (!words.length) return <span className="af-empty">Sin texto en este versículo</span>;
  return (
    <span className="af-words" dir={isRtl(text) ? "rtl" : undefined}>
      {words.map((w) =>
        onTap ? (
          <button
            key={w.index}
            type="button"
            className="af-word af-word--tap"
            data-selected={selected?.includes(w.index) ? "true" : undefined}
            aria-pressed={selected?.includes(w.index) ? true : false}
            onClick={() => onTap(w.index)}
          >
            {w.text}
          </button>
        ) : (
          <span key={w.index} className="af-word" data-marked={marked?.includes(w.index) ? "true" : undefined}>
            {w.text}
          </span>
        ),
      )}
    </span>
  );
}

/**
 * «Revisar notas» of a Afinación: every translation note of the chapter, one at
 * a time, with the original and the draft always in view. The reviewer marks
 * the words of the draft that render the note and answers; anyone may also
 * correct the verse at any moment, which makes earlier answers to it stale.
 */
export function AfinacionView({ ctxEncoded, step: stepProp = "notas", onClose, announce }: Props) {
  const [session] = useState<GtSession | undefined>(() => loadSession());
  const [ctx, setCtx] = useState<SolverLaunchContext | null>(null);
  const [data, setData] = useState<AfinacionNotesData | null>(null);
  const [decisions, setDecisions] = useState<ReviewDecision[]>([]);
  const [task, setTask] = useState<ProjectTask | null>(null);
  const [category, setCategory] = useState("all");
  const [position, setPosition] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<ReviewStance | null>(null);
  const [dockOpen, setDockOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fixing, setFixing] = useState(false);
  const [fixText, setFixText] = useState("");
  const [fixReason, setFixReason] = useState("");
  const [preferredTerms, setPreferredTerms] = useState<PreferredTerms>({});
  const [termTitles, setTermTitles] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const decoded = decodeSolverLaunchContext(ctxEncoded);
    if (!decoded) {
      setError("El enlace de esta herramienta no es válido. Ábrela de nuevo desde Mis tareas.");
      return;
    }
    setCtx(decoded);
    if (!session?.token) {
      setError("Tu sesión caducó. Vuelve a iniciar sesión.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const board = await loadAssignmentsFromDcs(session, decoded.pmOrg, decoded.lang, decoded.projectId, decoded.contentOrg);
      const thisTask = board?.teams.find((t) => t.id === decoded.taskId) ?? null;
      setTask(thisTask);
      const sourceTaskId = thisTask?.waitsFor?.find((w) => w.taskId)?.taskId;
      if (!sourceTaskId) {
        throw new Error("Esta tarea no dice qué texto revisa. Quien administra debe añadir «Esperar a» la traducción en la tarea.");
      }
      const loaded = await loadAfinacionNotes({ session, ctx: decoded, sourceTaskId, step: stepProp, pkg: resolveSourcePackage(board?.settings) });
      setData(loaded);
      setPreferredTerms(loaded.preferredTerms);
      const files = await loadDecisionFiles(session, { owner: loaded.draft.owner, repo: loaded.draft.repo, branch: loaded.draft.branch }, loaded.book);
      setDecisions(mergeDecisionFiles(files));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [ctxEncoded, session, stepProp]);

  useEffect(() => {
    void load();
  }, [load]);

  // The article titles arrive after the screen is up; until then a term shows its name.
  useEffect(() => {
    if (!session?.token || !data || data.step !== "palabras" || !data.termUses.length) return;
    let cancelled = false;
    void loadTermTitles(session, data.sourcePackage, data.termUses)
      .then((titles) => !cancelled && setTermTitles(titles))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session, data?.step, data?.termUses]);

  const groups = useMemo(() => (data ? groupByCategory(data.items) : []), [data]);
  const visible = useMemo(
    () => groups.filter((g) => category === "all" || g.category === category).flatMap((g) => g.items),
    [groups, category],
  );
  const item: NoteItem | undefined = visible[Math.min(position, Math.max(visible.length - 1, 0))];

  const taskStep = task?.steps?.find((s) => s.id === (ctx?.stepId || stepProp));
  const thresholds = { minAgree: taskStep?.minAssignees ?? 3, minIndependent: taskStep?.minIndependent ?? 2 };
  const me = (session?.username ?? "").toLowerCase();
  const verseText = item ? data?.draftVerses[item.verse] ?? "" : "";
  const hash = textFingerprint(verseText);

  const tally = item && data
    ? tallyItem({ itemId: item.id, decisions, currentHash: hash, levels: data.levels, authors: [], thresholds })
    : null;
  const mine = tally?.answers.find((a) => a.reviewer.trim().toLowerCase() === me);
  const others = (tally?.answers ?? []).filter((a) => a.reviewer.trim().toLowerCase() !== me);
  const staleMine = tally?.stale.find((a) => a.reviewer.trim().toLowerCase() === me);

  const summary = useMemo(
    () =>
      data
        ? summarizeRound({
            itemIds: data.items.map((i) => i.id),
            decisions,
            currentHashes: Object.fromEntries(data.items.map((i) => [i.id, textFingerprint(data.draftVerses[i.verse] ?? "")])),
            levels: data.levels,
            authors: [],
            thresholds,
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, decisions, thresholds.minAgree, thresholds.minIndependent],
  );

  // Changing item: show what this person already answered (their words and their note).
  useEffect(() => {
    if (!item || !data) return;
    const saved = decisions
      .filter((d) => d.itemId === item.id && d.reviewer.trim().toLowerCase() === me)
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
    setSelected(saved?.selectedText ? wordsOfSelection(verseText, saved.selectedText) : []);
    setNote(saved?.note ?? "");
    setPending(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, verseText]);

  const origTokens = item ? tokenizeVersePlainText(data?.originalVerses[item.verse] ?? "") : [];
  const origMarked = item && item.quote ? matchHelpQuoteToTokenIndices(origTokens, item.quote, item.occurrence) : [];

  // Words step: how this term was rendered in every use across the book.
  const termSlug = item && "termSlug" in item ? (item as TermItem).termSlug : "";
  const comparison = useMemo(
    () =>
      data && termSlug
        ? compareTermRenderings({
            uses: data.termUses.filter((u) => u.termSlug === termSlug),
            decisions,
            verseText: (c, v) => data.bookDraft[`${c}:${v}`] ?? "",
            preferred: preferredTerms[termSlug]?.text,
          })
        : null,
    [data, termSlug, decisions, preferredTerms],
  );
  const canChoosePreferred = Boolean(data) && meetsLevel(levelOf(data?.levels, me), "habilitada");

  async function choosePreferred(text: string) {
    if (!session || !data || !termSlug) return;
    setSaving(true);
    setError("");
    try {
      const next = await savePreferredTerm({
        session,
        target: { owner: data.draft.owner, repo: data.draft.repo, branch: data.draft.branch },
        slug: termSlug,
        text,
      });
      setPreferredTerms(next);
      announce(text ? `«${text}» quedó como traducción preferida` : "Se quitó la traducción preferida");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function jumpToUse(use: TermItem) {
    setCategory("all");
    const at = groups.flatMap((g) => g.items).findIndex((i) => i.id === use.id);
    if (at >= 0) setPosition(at);
  }

  async function answer(status: ReviewStance) {
    if (!session || !data || !item || !ctx) return;
    if (status !== "approved" && !note.trim()) {
      setPending(status);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const decision: ReviewDecision = {
        itemId: item.id,
        ref: { start: { chapter: item.chapter, verse: item.verse } },
        selectedText: selectionFromWords(verseText, selected, { chapter: item.chapter, verse: item.verse }),
        sessionId: String(ctx.issueNumber || ctx.taskId),
        stageId: "afinacion",
        status,
        reviewer: session.username,
        timestamp: new Date().toISOString(),
        note: note.trim() || undefined,
        textHash: hash,
      };
      await appendMyDecision(session, { owner: data.draft.owner, repo: data.draft.repo, branch: data.draft.branch }, data.book, decision);
      setDecisions((prev) => [...prev, decision]);
      setPending(null);
      announce(`${STANCE_LABEL[status]}: guardado`);
      if (position < visible.length - 1) setPosition((p) => p + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function saveFix() {
    if (!session || !data || !item || !ctx) return;
    const text = fixText.trim();
    if (!text) return;
    setSaving(true);
    setError("");
    try {
      const result = await saveCorrection({
        session,
        target: { owner: data.draft.owner, repo: data.draft.repo, branch: data.draft.branch },
        filepath: data.draft.filepath,
        chapter: item.chapter,
        verse: item.verse,
        text,
        reason: fixReason,
        book: data.book,
      });
      const before = data.draftVerses[item.verse] ?? "";
      setData({ ...data, draftVerses: { ...data.draftVerses, [item.verse]: text } });
      setFixing(false);
      setFixReason("");
      announce(`Corregiste ${data.book} ${item.chapter}:${item.verse}`);
      if (result.clearedVerses.length) {
        announce(`Se perdió la alineación del versículo ${item.verse}: el texto cambió por completo.`);
      }
      // Tell whoever had answered on the old text, in the subtarea of this task.
      const ids = data.items.filter((i) => i.verse === item.verse).map((i) => i.id);
      // Whoever checked the alignment of this verse is told too.
      ids.push(`al:${item.chapter}:${item.verse}`, `al-done:${item.chapter}:${item.verse}`);
      const who = new Set<string>();
      for (const id of ids) {
        for (const login of reviewersToNotifyAfterEdit({ itemId: id, decisions, newHash: textFingerprint(text), editor: session.username })) who.add(login);
      }
      if (who.size && ctx.issueNumber && ctx.pmOrg && before !== text) {
        const why = fixReason.trim();
        const logins = [...who];
        const summary = `${logins.map((w) => `@${w}`).join(" ")} Corregí ${data.book} ${item.chapter}:${item.verse}. Vuelvan a revisarlo.${why ? ` Motivo: ${why}` : ""}`;
        await commentOnIssue(
          session,
          ctx.pmOrg,
          ctx.issueNumber,
          formatChatEvent({
            type: "afinacion-correccion",
            emitter: "afinacion",
            issue: ctx.issueNumber,
            summary,
            mentions: logins,
            data: { book: data.book, chapter: item.chapter, verse: item.verse, reason: why, by: session.username },
          }),
        ).catch(() => undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const total = visible.length;

  return (
    <div className="af">
      <header className="af-head">
        <button type="button" className="af-back" onClick={onClose} aria-label="Volver">
          ← Volver
        </button>
        <div className="af-title">
          <h1>{TITLE[stepProp]}</h1>
          <p>{data ? `${data.book} ${data.chapter} · ${data.resource === "tps" ? "TPS" : "TPL"}` : ctx ? `${ctx.book} ${ctx.chapter}` : ""}</p>
        </div>
        {summary ? (
          <div className="af-progress" aria-label="Avance de la ronda">
            <span>
              {summary.agreed} de {data?.items.length} acordadas
            </span>
            <span className="af-bar">
              <i style={{ width: `${data?.items.length ? (summary.agreed / data.items.length) * 100 : 0}%` }} />
            </span>
          </div>
        ) : null}
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {busy ? <p className="hub-hint">Cargando las notas y los textos…</p> : null}

      {data && item ? (
        <>
          <section className="af-dock" aria-label="Textos del versículo">
            <div className="af-dock__bar">
              <strong>
                {data.book} {item.chapter}:{item.verse}
              </strong>
              <button type="button" className="af-link" onClick={() => setDockOpen((v) => !v)} aria-expanded={dockOpen}>
                {dockOpen ? "Ocultar original" : "Mostrar original"}
              </button>
            </div>
            {dockOpen ? (
              <>
                <div className="af-row">
                  <span className="af-lbl">{data.originalLabel}</span>
                  <span className="af-orig" lang="grc">
                    <Words text={data.originalVerses[item.verse] ?? ""} marked={origMarked} />
                  </span>
                </div>
                <div className="af-row">
                  <span className="af-lbl">{data.gatewayLabel} (inglés)</span>
                  <Words text={data.gatewayVerses[item.verse] ?? ""} marked={item.phraseTokens} />
                </div>
              </>
            ) : null}
            <div className="af-row">
              <span className="af-lbl">Borrador {data.resource === "tps" ? "TPS" : "TPL"}</span>
              <Words text={verseText} onTap={(i) => setSelected((prev) => toggleWord(prev, i))} selected={selected} />
            </div>
            <div className="af-actions">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setFixText(verseText);
                  setFixing(true);
                }}
              >
                Corregir este versículo
              </Button>
            </div>
            {fixing ? (
              <div className="af-fix" role="group" aria-label="Corregir el versículo">
                <label htmlFor="af-fix-text" className="af-lbl">
                  Texto del versículo
                </label>
                <textarea id="af-fix-text" className="af-textarea" rows={4} value={fixText} onChange={(e) => setFixText(e.target.value)} />
                <label htmlFor="af-fix-reason" className="af-lbl">
                  Por qué (opcional)
                </label>
                <input id="af-fix-reason" className="af-input" value={fixReason} onChange={(e) => setFixReason(e.target.value)} />
                <p className="af-hint">Las respuestas anteriores a este versículo pedirán volver a revisarse y se avisará a quienes las dieron.</p>
                <div className="af-buttons">
                  <Button type="button" disabled={saving || !fixText.trim()} onClick={() => void saveFix()}>
                    {saving ? "Guardando…" : "Guardar corrección"}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setFixing(false)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="af-card" aria-label="Nota">
            <div className="af-card__top">
              <span className="af-chip">{item.categoryLabel}</span>
              {tally ? <span className="af-state" data-state={tally.state}>{STATE_LABEL[tally.state]}</span> : null}
            </div>
            <h2 className="af-phrase">
              {termSlug ? `${termLabel(termSlug, termTitles)}${item.phrase ? ` · «${item.phrase}»` : ""}` : item.phrase ? `«${item.phrase}»` : item.quote ? item.quote : "Todo el versículo"}
            </h2>
            {item.note ? <p className="af-note">{item.note}</p> : null}
            {comparison ? (
              <div className="af-compare" aria-label="Cómo se tradujo en el libro">
                <p className="af-lbl">En todo el libro</p>
                {preferredTerms[termSlug] ? (
                  <p className="af-preferred">
                    Traducción preferida: <b>«{preferredTerms[termSlug]!.text}»</b>
                    {canChoosePreferred ? (
                      <button type="button" className="af-use" disabled={saving} onClick={() => void choosePreferred("")}>
                        Quitar
                      </button>
                    ) : null}
                  </p>
                ) : null}
                {comparison.renderings.length ? (
                  <ul className="af-renderings">
                    {comparison.renderings.map((r) => (
                      <li key={r.text} className="af-rendering">
                        <b>«{r.text}»</b> · {r.uses.length} {r.uses.length === 1 ? "uso" : "usos"}
                        {canChoosePreferred && preferredTerms[termSlug]?.text.trim().toLowerCase() !== r.text.trim().toLowerCase() ? (
                          <button type="button" className="af-use" disabled={saving} onClick={() => void choosePreferred(r.text)}>
                            Usar como preferida
                          </button>
                        ) : null}
                        <span className="af-uses">
                          {r.uses.map((u) => (
                            <button key={u.id} type="button" className="af-use" onClick={() => jumpToUse(u)}>
                              {u.chapter}:{u.verse}
                            </button>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="af-hint">Nadie ha marcado todavía cómo se tradujo este término.</p>
                )}
                {comparison.differing.length ? (
                  <p className="af-stale">
                    {comparison.differing.length} {comparison.differing.length === 1 ? "uso no dice" : "usos no dicen"} lo mismo que la traducción preferida:{" "}
                    {comparison.differing.map((u) => `${u.chapter}:${u.verse}`).join(", ")}.
                  </p>
                ) : null}
                {comparison.renderings.length > 1 ? (
                  <p className="af-stale">Hay {comparison.renderings.length} traducciones distintas de este término.</p>
                ) : null}
                {comparison.unmarked.length ? (
                  <p className="af-hint">
                    Sin marcar: {comparison.unmarked.length} {comparison.unmarked.length === 1 ? "uso" : "usos"}.
                  </p>
                ) : null}
              </div>
            ) : null}
            <p className="af-question">{QUESTION[stepProp][data.resource]}</p>
            <p className="af-hint">
              {item.phrase ? `Toca en el borrador las palabras que dicen «${item.phrase}».` : termSlug ? "Toca en el borrador las palabras que traducen el término." : "Toca en el borrador las palabras a las que se refiere la nota."}
            </p>

            {staleMine ? <p className="af-stale">El versículo cambió después de tu respuesta. Vuelve a revisarlo.</p> : null}
            {mine ? <p className="af-saved">Tu respuesta: {STANCE_LABEL[mine.status as ReviewStance]}</p> : null}

            {pending ? (
              <div className="af-why">
                <label htmlFor="af-note" className="af-lbl">
                  {pending === "revise" ? "¿Qué cambio propones?" : "¿Cuál es tu objeción?"}
                </label>
                <textarea id="af-note" className="af-textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            ) : null}
            <div className="af-buttons">
              <Button type="button" size="lg" disabled={saving} onClick={() => void answer("approved")}>
                De acuerdo
              </Button>
              <Button type="button" size="lg" variant="outline" disabled={saving} onClick={() => void answer("revise")}>
                Propongo un cambio
              </Button>
              <Button type="button" size="lg" variant="outline" disabled={saving} onClick={() => void answer("rejected")}>
                Tengo una objeción
              </Button>
            </div>
            {others.length ? (
              <ul className="af-others" aria-label="Respuestas del equipo">
                {others.map((a) => (
                  <li key={a.reviewer}>
                    <b>@{a.reviewer}</b> · {STANCE_LABEL[a.status as ReviewStance]}
                    {a.note ? `: ${a.note}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <nav className="af-nav" aria-label="Notas">
            <Button type="button" variant="secondary" disabled={position <= 0} onClick={() => setPosition((p) => Math.max(0, p - 1))}>
              Anterior
            </Button>
            <span className="af-count">
              {Math.min(position + 1, total)} de {total}
            </span>
            <Button type="button" variant="secondary" disabled={position >= total - 1} onClick={() => setPosition((p) => p + 1)}>
              Siguiente
            </Button>
          </nav>
          <div className="af-filter">
            <label htmlFor="af-cat" className="af-lbl">
              Categoría
            </label>
            <select
              id="af-cat"
              className="af-input"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPosition(0);
              }}
            >
              <option value="all">Todas ({data.items.length})</option>
              {groups.map((g) => (
                <option key={g.category} value={g.category}>
                  {g.label} ({g.items.length})
                </option>
              ))}
            </select>
          </div>
        </>
      ) : null}

      {data && !item && !busy ? (
        <div className="hub-empty-panel">
          <h2 className="hub-empty-panel__title">{stepProp === "palabras" ? "No hay palabras clave en este capítulo" : "No hay notas en este capítulo"}</h2>
          <p className="hub-empty-panel__body">Las notas se leen de {data.notesSource}.</p>
        </div>
      ) : null}
    </div>
  );
}
