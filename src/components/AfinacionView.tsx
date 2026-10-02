import { useCallback, useEffect, useMemo, useState } from "react";
import { loadSession, type GtSession } from "../dcs/auth";
import { loadAfinacionNotes, loadArticleBody, loadArticleInfo, loadTermTitles, type AfinacionNotesData, type AfinacionStep } from "../dcs/afinacionLoad";
import { appendMyDecision, loadDecisionFiles, savePreferredTerm, saveCorrection } from "../dcs/afinacionStore";
import { commentOnIssue } from "../dcs/issues";
import { formatChatEvent } from "../domain/chatEvent";
import { loadAssignmentsFromDcs } from "../dcs/persist";
import { articleName, articlePathOf, articleShortName, groupByCategory, type ArticleInfo, type NoteItem } from "../domain/afinacionNotes";
import { HelpMarkdownView } from "./HelpMarkdownView";
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
import { canConfirmForTeam, confirmersOf, levelOf, levelsForTeam, meetsLevel } from "../domain/levels";
import { closesInItsTool } from "../domain/stepClaim";
import { completeStepFromTool, stepIsDone } from "../dcs/roundClose";
import { FinalDecision, RoundPanel } from "./RoundPanel";
import { decodeSolverLaunchContext, type SolverLaunchContext } from "../domain/solverLaunch";
import { resolveSourcePackage } from "../domain/sourcePackage";
import type { ProjectTask } from "../domain/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { tNow, useT, type MessageKey } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";
import { localizeThread } from "../domain/threadNames";
import { localizeAfinacion } from "../domain/afinacionNames";
import { explainError } from "../dcs/userError";

type Props = {
  ctxEncoded: string;
  /** `notas` or `palabras`. */
  step?: AfinacionStep;
  onClose: () => void;
  announce: (msg: string) => void;
};

const STANCE_KEY: Record<ReviewStance, MessageKey> = {
  approved: "rv.approved",
  revise: "rv.revise",
  rejected: "rv.rejected",
};

const QUESTION: Record<AfinacionStep, Record<"tpl" | "tps", MessageKey>> = {
  notas: { tpl: "af.qNotasTpl", tps: "af.qNotasTps" },
  palabras: { tpl: "af.qPalabrasTpl", tps: "af.qPalabrasTps" },
};

const TITLE: Record<AfinacionStep, MessageKey> = { notas: "af.titleNotas", palabras: "af.titlePalabras" };

const STATE_KEY = { agreed: "af.stAgreed", disputed: "af.stDisputed", pending: "af.stPending" } as const;

const isRtl = (text: string) => /[\u0590-\u05FF\u0600-\u06FF]/.test(text);

function Words({ text, marked, onTap, selected }: { text: string; marked?: number[]; onTap?: (i: number) => void; selected?: number[] }) {
  const t = useT();
  const words = wordSpans(text);
  if (!words.length) return <span className="af-empty">{t("af.noText")}</span>;
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
  const t = useT();
  const language = useUiLanguage();
  const stanceLabel = (status: string) => t(STANCE_KEY[status as ReviewStance] ?? "rv.approved");
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
  const [articles, setArticles] = useState<Record<string, ArticleInfo>>({});
  /** The article open to be read in full: its path, and its text once it arrives (`null` = it could not be read). */
  const [reading, setReading] = useState<{ path: string; body?: string | null } | null>(null);
  const [stepDone, setStepDone] = useState(false);
  const [closing, setClosing] = useState(false);

  const load = useCallback(async () => {
    const decoded = decodeSolverLaunchContext(ctxEncoded);
    if (!decoded) {
      setError(tNow("af.badLink"));
      return;
    }
    setCtx(decoded);
    if (!session?.token) {
      setError(tNow("af.expired"));
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
        throw new Error(tNow("af.noSource"));
      }
      const loaded = await loadAfinacionNotes({ session, ctx: decoded, sourceTaskId, step: stepProp, pkg: resolveSourcePackage(board?.settings), board });
      setData(loaded);
      setPreferredTerms(loaded.preferredTerms);
      const files = await loadDecisionFiles(session, { owner: loaded.draft.owner, repo: loaded.draft.repo, branch: loaded.draft.branch }, loaded.book);
      setDecisions(mergeDecisionFiles(files));
    } catch (err) {
      setError(err instanceof Error ? localizeThread(err.message, language) : String(err));
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

  // The Academy articles the notes point to: what each figure is called, and what the article answers.
  useEffect(() => {
    if (!session?.token || !ctx || !data || data.step !== "notas" || !data.items.length) return;
    let cancelled = false;
    void loadArticleInfo(session, ctx, data.sourcePackage, data.items.map((note) => articlePathOf(note.supportRef)))
      .then((found) => !cancelled && setArticles(found))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, data?.step, data?.items]);

  const nameOf = (note: Pick<NoteItem, "category" | "categoryLabel" | "supportRef">) => articleName(note, articles[articlePathOf(note.supportRef)], (label) => localizeAfinacion(label, language));

  async function readArticle(path: string) {
    if (!session || !ctx || !data) return;
    if (reading?.path === path) return void setReading(null);
    setReading({ path });
    const body = await loadArticleBody(session, ctx, data.sourcePackage, path).catch(() => null);
    setReading((current) => (current?.path === path ? { path, body } : current));
  }

  const groups = useMemo(() => (data ? groupByCategory(data.items) : []), [data]);
  const visible = useMemo(
    () => groups.filter((g) => category === "all" || g.category === category).flatMap((g) => g.items),
    [groups, category],
  );
  const item: NoteItem | undefined = visible[Math.min(position, Math.max(visible.length - 1, 0))];

  const taskStep = task?.steps?.find((s) => s.id === (ctx?.stepId || stepProp));
  // Who counts for the minimum is decided by the levels of this task's team.
  const teamLevels = useMemo(() => levelsForTeam(data?.levelBook, task?.orgTeamName), [data?.levelBook, task?.orgTeamName]);
  const thresholds = { minAgree: taskStep?.minAssignees ?? 3, minIndependent: taskStep?.minIndependent ?? 2 };
  const me = (session?.username ?? "").toLowerCase();
  // The team's final decision on a disputed item: its coordinator or a persona habilitada of the team.
  const confirmers = useMemo(() => confirmersOf(data?.levelBook, task?.orgTeamName), [data?.levelBook, task?.orgTeamName]);
  const canConfirm = Boolean(session) && canConfirmForTeam(data?.levelBook, task?.orgTeamName, me);
  const closesHere = Boolean(taskStep && closesInItsTool(taskStep) && ctx?.issueNumber);
  const verseText = item ? data?.draftVerses[item.verse] ?? "" : "";
  const hash = textFingerprint(verseText);

  const tally = item && data
    ? tallyItem({ itemId: item.id, decisions, currentHash: hash, levels: teamLevels, authors: [], thresholds, confirmers })
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
            levels: teamLevels,
            authors: [],
            thresholds,
            confirmers,
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, decisions, thresholds.minAgree, thresholds.minIndependent, teamLevels, confirmers],
  );

  // Was this step already closed in the subtarea?
  useEffect(() => {
    if (!session || !ctx?.pmOrg || !ctx.issueNumber || !taskStep) return;
    let cancelled = false;
    void stepIsDone({ session, pmOrg: ctx.pmOrg, issueNumber: ctx.issueNumber, stepId: taskStep.id })
      .then((done) => !cancelled && setStepDone(done))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session, ctx?.pmOrg, ctx?.issueNumber, taskStep?.id]);

  /** Every item is agreed: the step is completed in the subtarea, so the task can move on. */
  async function closeRound() {
    if (!session || !ctx?.pmOrg || !ctx.issueNumber || !taskStep) return;
    setClosing(true);
    setError("");
    try {
      await completeStepFromTool({ session, pmOrg: ctx.pmOrg, issueNumber: ctx.issueNumber, stepId: taskStep.id });
      setStepDone(true);
      announce(t("round.closedNow"));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setClosing(false);
    }
  }

  /** The team's final decision on the item in view, after talking it over. */
  async function decide(text: string) {
    if (!session || !data || !item || !ctx) return;
    setSaving(true);
    setError("");
    try {
      const decision: ReviewDecision = {
        itemId: item.id,
        ref: { start: { chapter: item.chapter, verse: item.verse } },
        sessionId: String(ctx.issueNumber || ctx.taskId),
        stageId: "afinacion",
        status: "approved",
        reviewer: session.username,
        timestamp: new Date().toISOString(),
        note: text,
        textHash: hash,
        final: true,
      };
      await appendMyDecision(session, { owner: data.draft.owner, repo: data.draft.repo, branch: data.draft.branch }, data.book, decision);
      setDecisions((prev) => [...prev, decision]);
      announce(t("round.decisionSaved"));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  function jumpToItem(id: string) {
    setCategory("all");
    const at = groups.flatMap((g) => g.items).findIndex((i) => i.id === id);
    if (at >= 0) setPosition(at);
  }

  function labelOfItem(id: string): string {
    const found = data?.items.find((i) => i.id === id);
    if (!found) return id;
    const what = "termSlug" in found ? termLabel((found as TermItem).termSlug, termTitles) : [nameOf(found), found.phrase ? `«${found.phrase}»` : ""].filter(Boolean).join(" ");
    return `${found.chapter}:${found.verse}${what ? ` · ${what}` : ""}`;
  }

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
  const canChoosePreferred = Boolean(data) && meetsLevel(levelOf(teamLevels, me), "habilitada");

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
      announce(text ? t("af.preferredSet").replace("{text}", text) : t("af.preferredCleared"));
    } catch (err) {
      setError(explainError(err));
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
      announce(t("af.savedAnswer").replace("{stance}", stanceLabel(status)));
      if (position < visible.length - 1) setPosition((p) => p + 1);
    } catch (err) {
      setError(explainError(err));
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
      announce(t("af.corrected").replace("{ref}", `${data.book} ${item.chapter}:${item.verse}`));
      if (result.clearedVerses.length) {
        announce(t("af.alignmentLost").replace("{v}", String(item.verse)));
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
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  const total = visible.length;

  return (
    <div className="af af--round">
      <header className="af-head">
        <button type="button" className="af-back" onClick={onClose} aria-label={t("af.back")}>
          {t("af.backArrow")}
        </button>
        <div className="af-title">
          <h1>{t(TITLE[stepProp])}</h1>
          <p>{data ? `${data.book} ${data.chapter} · ${data.resource === "tps" ? "TPS" : "TPL"}` : ctx ? `${ctx.book} ${ctx.chapter}` : ""}</p>
          {data ? (
            <a className="scripture-editor__glossary" href={`#/glosario?libro=${encodeURIComponent(data.book)}&c=${data.chapter}&de=1&a=200`} target="_blank" rel="noreferrer">
              {t("gl.open")}
            </a>
          ) : null}
        </div>
        {summary ? (
          <div className="af-progress" aria-label={t("af.progressAria")}>
            <span>
              {t("af.nAgreed").replace("{a}", String(summary.agreed)).replace("{n}", String(data?.items.length ?? 0))}
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
      {busy ? <p className="hub-hint">{t("af.loading")}</p> : null}

      {summary ? (
        <RoundPanel summary={summary} labelOf={labelOfItem} onJump={jumpToItem} closesHere={closesHere} stepDone={stepDone} busy={closing} onClose={() => void closeRound()} />
      ) : null}

      {data && data.items.length && groups.length > 1 ? (
        <div className="af-figures" role="group" aria-label={t(stepProp === "notas" ? "af.figuresAria" : "af.category")}>
          {[{ category: "all", label: "", items: data.items }, ...groups].map((group) => {
            const done = summary ? group.items.filter((row) => summary.items.find((tally) => tally.itemId === row.id)?.state === "agreed").length : 0;
            return (
              <button
                key={group.category}
                type="button"
                className="af-figure"
                aria-pressed={category === group.category}
                data-done={done === group.items.length ? "true" : undefined}
                onClick={() => {
                  setCategory(group.category);
                  setPosition(0);
                }}
              >
                {group.category === "all" ? t("af.allFigures") : stepProp === "notas" ? articleShortName(group.items[0]!, articles[articlePathOf(group.items[0]!.supportRef)], (label) => localizeAfinacion(label, language)) : localizeAfinacion(group.label, language)}
                <span>
                  {done}/{group.items.length}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {data && item ? (
        <>
          <section className="af-dock" aria-label={t("af.versesAria")}>
            <div className="af-dock__bar">
              <strong>
                {data.book} {item.chapter}:{item.verse}
              </strong>
              <button type="button" className="af-link" onClick={() => setDockOpen((v) => !v)} aria-expanded={dockOpen}>
                {dockOpen ? t("af.hideOriginal") : t("af.showOriginal")}
              </button>
            </div>
            {dockOpen ? (
              <>
                <div className="af-row af-row--ref">
                  <span className="af-lbl">{data.originalLabel}</span>
                  <span className="af-orig" lang="grc">
                    <Words text={data.originalVerses[item.verse] ?? ""} marked={origMarked} />
                  </span>
                </div>
                <div className="af-row af-row--ref">
                  <span className="af-lbl">{t("af.english").replace("{label}", data.gatewayLabel)}</span>
                  <Words text={data.gatewayVerses[item.verse] ?? ""} marked={item.phraseTokens} />
                </div>
              </>
            ) : null}
            <div className="af-row">
              <span className="af-lbl">{t("af.draft").replace("{res}", data.resource === "tps" ? "TPS" : "TPL")}</span>
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
                {t("af.fixVerse")}
              </Button>
            </div>
            {fixing ? (
              <div className="af-fix" role="group" aria-label={t("af.fixAria")}>
                <label htmlFor="af-fix-text" className="af-lbl">
                  {t("af.verseText")}
                </label>
                <textarea id="af-fix-text" className="af-textarea" rows={4} value={fixText} onChange={(e) => setFixText(e.target.value)} />
                <label htmlFor="af-fix-reason" className="af-lbl">
                  {t("af.why")}
                </label>
                <input id="af-fix-reason" className="af-input" value={fixReason} onChange={(e) => setFixReason(e.target.value)} />
                <p className="af-hint">{t("af.fixHint")}</p>
                <div className="af-buttons">
                  <Button type="button" disabled={saving || !fixText.trim()} onClick={() => void saveFix()}>
                    {saving ? t("af.saving") : t("af.saveFix")}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setFixing(false)}>
                    {t("af.cancel")}
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="af-card" aria-label={t("af.noteAria")}>
            <div className="af-card__top">
              <span className="af-chip">{stepProp === "notas" ? t("af.figureOf").replace("{ref}", `${item.chapter}:${item.verse}`) : localizeAfinacion(item.categoryLabel, language)}</span>
              {tally ? <span className="af-state" data-state={tally.state}>{t(STATE_KEY[tally.state])}</span> : null}
            </div>
            {stepProp === "notas" ? (
              <>
                <h2 className="af-phrase">{nameOf(item)}</h2>
                {articles[articlePathOf(item.supportRef)]?.question ? <p className="af-article-q">{articles[articlePathOf(item.supportRef)]!.question}</p> : null}
                <p className="af-where">
                  {item.phrase ? t("af.whereEnglish").replace("{label}", data.gatewayLabel).replace("{p}", item.phrase) : item.quote ? t("af.whereOriginal").replace("{p}", item.quote) : t("af.wholeVerse")}
                </p>
                <div className="af-links">
                  {articlePathOf(item.supportRef) ? (
                    <button type="button" className="af-link" aria-expanded={reading?.path === articlePathOf(item.supportRef)} onClick={() => void readArticle(articlePathOf(item.supportRef))}>
                      {t(reading?.path === articlePathOf(item.supportRef) ? "af.hideArticle" : "af.readArticle")}
                    </button>
                  ) : null}
                </div>
                {reading?.path === articlePathOf(item.supportRef) ? (
                  <div className="af-article">{reading.body === undefined ? <p className="af-hint">{t("af.loadingArticle")}</p> : reading.body ? <HelpMarkdownView content={reading.body} /> : <p className="af-hint">{t("af.noArticle")}</p>}</div>
                ) : null}
                {item.note ? (
                  <details className="af-note-box">
                    <summary>{t("af.seeNote")}</summary>
                    <p className="af-note">{item.note}</p>
                  </details>
                ) : null}
              </>
            ) : (
              <>
                <h2 className="af-phrase">{termSlug ? `${termLabel(termSlug, termTitles)}${item.phrase ? ` · «${item.phrase}»` : ""}` : item.phrase ? `«${item.phrase}»` : item.quote ? item.quote : t("af.wholeVerse")}</h2>
                {item.note ? <p className="af-note">{item.note}</p> : null}
              </>
            )}
            {comparison ? (
              <div className="af-compare" aria-label={t("af.compareAria")}>
                <p className="af-lbl">{t("af.inWholeBook")}</p>
                {preferredTerms[termSlug] ? (
                  <p className="af-preferred">
                    {t("af.preferred")}<b>«{preferredTerms[termSlug]!.text}»</b>
                    {canChoosePreferred ? (
                      <button type="button" className="af-use" disabled={saving} onClick={() => void choosePreferred("")}>
                        {t("af.remove")}
                      </button>
                    ) : null}
                  </p>
                ) : null}
                {comparison.renderings.length ? (
                  <ul className="af-renderings">
                    {comparison.renderings.map((r) => (
                      <li key={r.text} className="af-rendering">
                        <b>«{r.text}»</b> · {r.uses.length} {r.uses.length === 1 ? t("af.useOne") : t("af.useMany")}
                        {canChoosePreferred && preferredTerms[termSlug]?.text.trim().toLowerCase() !== r.text.trim().toLowerCase() ? (
                          <button type="button" className="af-use" disabled={saving} onClick={() => void choosePreferred(r.text)}>
                            {t("af.usePreferred")}
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
                  <p className="af-hint">{t("af.nobodyMarked")}</p>
                )}
                {comparison.differing.length ? (
                  <p className="af-stale">
                    {t(comparison.differing.length === 1 ? "af.differOne" : "af.differMany")
                      .replace("{n}", String(comparison.differing.length))
                      .replace("{list}", comparison.differing.map((u) => `${u.chapter}:${u.verse}`).join(", "))}
                  </p>
                ) : null}
                {comparison.renderings.length > 1 ? (
                  <p className="af-stale">{t("af.manyRenderings").replace("{n}", String(comparison.renderings.length))}</p>
                ) : null}
                {comparison.unmarked.length ? (
                  <p className="af-hint">
                    {t(comparison.unmarked.length === 1 ? "af.unmarkedOne" : "af.unmarkedMany").replace("{n}", String(comparison.unmarked.length))}
                  </p>
                ) : null}
              </div>
            ) : null}
            <p className="af-question">{stepProp === "notas" ? t(QUESTION[stepProp][data.resource]).replace("{figure}", nameOf(item)) : t(QUESTION[stepProp][data.resource])}</p>
            {stepProp === "notas" ? <p className="af-hint">{t(data.resource === "tps" ? "af.guideTps" : "af.guideTpl")}</p> : null}
            <p className="af-hint">
              {item.phrase ? t("af.tapPhrase").replace("{p}", item.phrase) : termSlug ? t("af.tapTerm") : t("af.tapNote")}
            </p>

            {staleMine ? <p className="af-stale">{t("af.staleMine")}</p> : null}
            {mine ? <p className="af-saved">{t("af.myAnswer").replace("{stance}", stanceLabel(mine.status))}</p> : null}

            {pending ? (
              <div className="af-why">
                <label htmlFor="af-note" className="af-lbl">
                  {pending === "revise" ? t("af.whatChange") : t("af.whatObjection")}
                </label>
                <textarea id="af-note" className="af-textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            ) : null}
            <div className="af-buttons af-answer">
              <Button type="button" size="lg" disabled={saving} onClick={() => void answer("approved")}>
                {t("rv.approved")}
              </Button>
              <Button type="button" size="lg" variant="outline" disabled={saving} onClick={() => void answer("revise")}>
                {t("rv.revise")}
              </Button>
              <Button type="button" size="lg" variant="outline" disabled={saving} onClick={() => void answer("rejected")}>
                {t("rv.rejected")}
              </Button>
            </div>
            {tally ? <FinalDecision key={item.id} tally={tally} canConfirm={canConfirm} busy={saving} onDecide={(text) => void decide(text)} /> : null}
            {others.length ? (
              <ul className="af-others" aria-label={t("af.teamAria")}>
                {others.map((a) => (
                  <li key={a.reviewer}>
                    <b>@{a.reviewer}</b> · {stanceLabel(a.status)}
                    {a.note ? `: ${a.note}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <nav className="af-nav" aria-label={t("af.notesNavAria")}>
            <Button type="button" variant="secondary" disabled={position <= 0} onClick={() => setPosition((p) => Math.max(0, p - 1))}>
              {t("af.prev")}
            </Button>
            <span className="af-count">
              {t("af.countOf").replace("{a}", String(Math.min(position + 1, total))).replace("{b}", String(total))}
            </span>
            <Button type="button" variant="secondary" disabled={position >= total - 1} onClick={() => setPosition((p) => p + 1)}>
              {t("af.next")}
            </Button>
          </nav>
        </>
      ) : null}

      {data && !item && !busy ? (
        <div className="hub-empty-panel">
          <h2 className="hub-empty-panel__title">{stepProp === "palabras" ? t("af.noKeywords") : t("af.noNotes")}</h2>
          <p className="hub-empty-panel__body">{t("af.notesFrom").replace("{src}", data.notesSource)}</p>
        </div>
      ) : null}
    </div>
  );
}
