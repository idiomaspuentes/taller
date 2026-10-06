import { toolHeading } from "./toolHeading";
import { ToolHeader } from "./ToolHeader";
import { HelpMessages } from "./HelpMessages";
import { HelpMarkdownView } from "./HelpMarkdownView";
import { categoryFromSupportRef, categoryLabel } from "../domain/afinacionNotes";
import { bookLabel } from "../domain/books";
import { localizeAfinacion } from "../domain/afinacionNames";
import { missingWork, verseIsAligned, verseList, type MissingWork } from "../domain/checklistReady";
import { termMessageKey } from "../domain/studyNotes";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { loadSession, type GtSession } from "../dcs/auth";
import { appendCheckAnswers, loadCheckAnswers } from "../dcs/checkStore";
import { loadTermArticle, loadTermTitles } from "../dcs/afinacionLoad";
import { resolveSourcePackage } from "../domain/sourcePackage";
import { articleBody, termLabel, type TermKind } from "../domain/afinacionWords";
import { loadChecklist, type ChecklistData, type ChecklistItem, type ChecklistKind, type ChecklistText } from "../dcs/checklistLoad";
import { commentOnIssue } from "../dcs/issues";
import { completeStepFromTool, stepIsDone } from "../dcs/roundClose";
import { useStepWork } from "../dcs/stepWork";
import { helpAtWord, questionsFor, summarizeChecklist, verseCoverage, type CheckAnswer, type CheckItem, type CheckOutcome } from "../domain/checklist";
import { alignedGatewayQuoteForHelpQuote, tokenizeVersePlainText } from "../domain/helpQuoteMatch";
import { coordinatorsOf } from "../domain/levels";
import { localized } from "../domain/processes";
import { decodeSolverLaunchContext, encodeSolverLaunchContext, type SolverLaunchContext } from "../domain/solverLaunch";
import { textFingerprint } from "../domain/reviewRound";
import { closesInItsTool } from "../domain/stepClaim";
import { useUiLanguage } from "../i18n/language";
import { tNow, useT, type MessageKey } from "../i18n/messages";
import { scopeLabel } from "../domain/resourceNames";
import { originalTokens, quoteFromSelection } from "../domain/quoteFromSelection";
import { DEFAULT_PM_CONFIG } from "../domain/roles";
import { verseFromSid } from "../domain/usfmAst";
import { saveNoteQuote } from "../dcs/teamHelps";
import { explainError } from "../dcs/userError";

type Props = {
  ctxEncoded: string;
  /** What the checklist goes over, and the text each item is checked against: the process says it per step. */
  kind: ChecklistKind;
  texts: ChecklistText[];
  /** Go over only the items that link to a support article. */
  onlyLinked?: boolean;
  onClose: () => void;
  announce: (msg: string) => void;
};

const OUTCOME_KEY: Record<CheckOutcome, MessageKey> = { fixed: "ck.fixed", created: "ck.created", consult: "ck.consult" };
const verseKeyOf = (item: Pick<ChecklistItem, "chapter" | "verse">) => `${item.chapter}:${item.verse}`;

/**
 * A verse with the words a quote points at marked. With `onToggle`, each word can be marked or unmarked. `covered`:
 * the words another help of the verse is about (see `verseCoverage`); they are underlined, and a touch on one goes
 * to that help (`onOpen`). The words of the help in view are touched too when another help shares them.
 */
function Verse({ text, marked, onToggle, covered, onOpen }: { text: string; marked: number[]; onToggle?: (index: number) => void; covered?: (index: number) => boolean; onOpen?: (index: number) => void }) {
  const tokens = tokenizeVersePlainText(text);
  const on = new Set(marked);
  return (
    <span className="ck-verse">
      {tokens.map((token, index) =>
        onToggle ? (
          <button key={index} type="button" className="ck-word" aria-pressed={on.has(index)} onClick={() => onToggle(index)}>
            {token}
          </button>
        ) : covered?.(index) && onOpen ? (
          <span key={index}>
            <button type="button" className="ck-covered" data-here={on.has(index) || undefined} onClick={() => onOpen(index)}>
              {token}
            </button>{" "}
          </span>
        ) : (
          <span key={index}>
            {on.has(index) ? <mark>{token}</mark> : token}{" "}
          </span>
        ),
      )}
    </span>
  );
}

/**
 * A step that closes by a checklist: every item of the passage, with the yes/no questions the process declares for
 * the step. The screen knows how to show notes, questions and terms beside a text; which questions are asked, and of
 * what, comes from the template.
 */
export function ChecklistView({ ctxEncoded, kind, texts, onlyLinked, onClose, announce }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const [session] = useState<GtSession | undefined>(() => loadSession());
  const [ctx, setCtx] = useState<SolverLaunchContext | null>(null);
  const [data, setData] = useState<ChecklistData | null>(null);
  const [answers, setAnswers] = useState<CheckAnswer[]>([]);
  const [position, setPosition] = useState(0);
  const [busy, setBusy] = useState(false);
  const [closing, setSaving] = useState(false);
  /** Answers on their way to Door43. */
  const [writing, setWriting] = useState(0);
  const saving = closing || writing > 0;
  const [error, setError] = useState("");
  const [stepDone, setStepDone] = useState(false);
  /** A «no» being explained: which question, what was done about it and the note. */
  const [draft, setDraft] = useState<{ answerItemId: string; questionId: string; outcome: CheckOutcome; note: string } | null>(null);
  /** Fixing the quote of the note in view: the words marked in the text so far. */
  const [picking, setPicking] = useState<number[] | null>(null);

  const textsKey = texts.join(",");
  /** A note's quote is fixed on the first text of the step, the one its quote is read against. */
  const canPick = (resource: ChecklistText) => kind === "notas" && resource === texts[0] && Boolean(data?.original) && !data?.fromSource;
  /** What the project's process calls each text. */
  const textLabel = (resource: ChecklistText) => scopeLabel(resource, data?.board?.settings?.resourceNames, language);
  const storeKey = ctx ? `${(ctx.book || ctx.projectId).toUpperCase()}.${ctx.issueNumber || ctx.taskId}.${ctx.stepId || "paso"}` : "";

  const load = useCallback(async () => {
    const decoded = decodeSolverLaunchContext(ctxEncoded);
    if (!decoded) return setError(tNow("af.badLink"));
    setCtx(decoded);
    if (!session?.token) return setError(tNow("af.expired"));
    setBusy(true);
    setError("");
    try {
      const loaded = await loadChecklist({ session, ctx: decoded, kind, texts: textsKey.split(",").filter(Boolean) as ChecklistText[], onlyLinked });
      setData(loaded);
      const key = `${(decoded.book || decoded.projectId).toUpperCase()}.${decoded.issueNumber || decoded.taskId}.${decoded.stepId || "paso"}`;
      setAnswers(await loadCheckAnswers(session, loaded.target, key));
      if (decoded.pmOrg && decoded.issueNumber && decoded.stepId) {
        setStepDone(await stepIsDone({ session, pmOrg: decoded.pmOrg, issueNumber: decoded.issueNumber, stepId: decoded.stepId }).catch(() => false));
      }
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }, [ctxEncoded, session, kind, textsKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const questions = data?.step?.checklist ?? [];
  const checkItems: CheckItem[] = useMemo(() => (data?.items ?? []).map((item) => ({ id: item.id, verseKey: verseKeyOf(item) })), [data]);
  // What each verse reads now in the texts on screen: an answer given before a change of the text is checked again.
  const hashes = useMemo(() => {
    const out: Record<string, string> = {};
    for (const row of data?.items ?? []) out[verseKeyOf(row)] = textFingerprint(texts.map((x) => data?.texts[x]?.verses[row.verse] ?? "").join("|"));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, textsKey]);
  const summary = useMemo(() => summarizeChecklist({ items: checkItems, questions, answers, currentHashes: hashes }), [checkItems, questions, answers, hashes]);
  useStepWork(session, ctx, summary.done, data?.items.length ?? 0, { on: !stepDone && !closing });
  const item = data?.items[Math.min(position, Math.max((data?.items.length ?? 1) - 1, 0))];
  // A key term is shown by the name the team gives it (the title of its article), not by its code in English.
  const [termTitles, setTermTitles] = useState<Record<string, string>>({});
  useEffect(() => {
    const sess = loadSession();
    if (!sess?.token || !ctx || data?.kind !== "palabras" || !data.items.length) return;
    let cancelled = false;
    const uses = data.items.flatMap((row) => {
      const [termKind, ...slug] = (row.supportRef ?? "").split("/");
      return termKind && slug.length ? [{ termKind: termKind as TermKind, termSlug: slug.join("/") }] : [];
    });
    void loadTermTitles(sess, null, uses, ctx)
      .then((titles) => !cancelled && setTermTitles(titles))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.kind, data?.items]);
  // A message about a key term names the term (it holds for every use of it); about a note or a question, that row.
  const [termKind, ...termSlug] = (item?.supportRef ?? "").split("/");
  // The article of the term in view. The checklist asks whether its definition is right for this verse, and showed
  // only its title: whoever checked had to know the article, or go and find it. Read once per term, as it comes up.
  const [articles, setArticles] = useState<Record<string, string | null>>({});
  const slug = kind === "palabras" && termKind ? termSlug.join("/") : "";
  useEffect(() => {
    if (!slug || !session?.token || !ctx || !data || slug in articles) return;
    let cancelled = false;
    void loadTermArticle(session, resolveSourcePackage(data.board?.settings), { termSlug: slug, termKind: termKind as TermKind }, ctx, data.pmConfig ?? DEFAULT_PM_CONFIG)
      .catch(() => null)
      .then((article) => !cancelled && setArticles((prev) => ({ ...prev, [slug]: article?.trim() ? article : null })));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, Boolean(data)]);
  const messageKey = kind === "palabras" && termKind && termSlug.length ? termMessageKey(termKind, termSlug.join("/")) : (item?.id ?? "");
  const tally = item ? summary.items.find((row) => row.itemId === item.id) : undefined;
  const closesHere = Boolean(data?.step && closesInItsTool(data.step) && ctx?.issueNumber);

  /** Who to tell when the problem is in a text this team may not change: the coordinators of the tasks it waits for. */
  const owners = useMemo(() => {
    if (!data?.board || !data.task) return [] as string[];
    const awaited = (data.task.waitsFor ?? []).flatMap((rule) => (rule.taskId ? data.board!.teams.filter((task) => task.id === rule.taskId) : data.board!.teams.filter((task) => task.phaseId === rule.phaseId)));
    return [...new Set(awaited.filter((task) => task.rules.some((rule) => texts.includes(rule.resource as ChecklistText))).flatMap((task) => coordinatorsOf(data.levelBook, task.orgTeamName)))];
  }, [data, textsKey]);

  // What this checklist needs done before it: the helps translated and each text aligned. What is missing is said,
  // and its team told, instead of checking against half-done work.
  const missing = useMemo<MissingWork[]>(
    () => (data ? missingWork({ helps: kind, fromSource: data.fromSource, chapter: data.chapter, verses: data.items.map((row) => row.verse), texts: texts.map((resource) => ({ resource, ...data.texts[resource] })) }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, kind, textsKey],
  );
  /** The coordinators of the teams whose work a missing piece is: of the tasks, among those this one waits for, that work on that resource. */
  const ownersOf = (resource: string) => {
    if (!data?.board || !data.task) return [] as string[];
    const awaited = (data.task.waitsFor ?? []).flatMap((rule) => (rule.taskId ? data.board!.teams.filter((task) => task.id === rule.taskId) : data.board!.teams.filter((task) => task.phaseId === rule.phaseId)));
    return [...new Set(awaited.filter((task) => task.rules.some((rule) => rule.resource === resource)).flatMap((task) => coordinatorsOf(data.levelBook, task.orgTeamName)))];
  };
  const missingText = (row: MissingWork) =>
    row.kind === "helps"
      ? t("ck.missHelps").replace("{what}", scopeLabel(row.resource, data?.board?.settings?.resourceNames, language))
      : t(row.kind === "text" ? (row.verses.length === 1 ? "ck.missTextOne" : "ck.missText") : row.verses.length === 1 ? "ck.missAlignmentOne" : "ck.missAlignment").replace("{text}", scopeLabel(row.resource, data?.board?.settings?.resourceNames, language)).replace("{verses}", verseList(row.verses));
  const missingKey = `taller.ck-told.${storeKey}.${missing.map((row) => `${row.kind}:${row.resource}:${"verses" in row ? row.verses.join(",") : ""}`).join("|")}`;
  const [told, setTold] = useState(false);
  useEffect(() => {
    try {
      setTold(Boolean(missing.length) && window.localStorage.getItem(missingKey) === "1");
    } catch {
      setTold(false);
    }
  }, [missingKey, missing.length]);

  /** Tell the teams whose work is missing, in the conversation of this subtarea: each coordinator is named with what is theirs. */
  async function tellMissing() {
    if (!session || !ctx?.pmOrg || !ctx.issueNumber || !data || !missing.length) return;
    setSaving(true);
    setError("");
    try {
      const lines = missing.map((row) => `- ${ownersOf(row.resource).map((login) => `@${login}`).join(" ")} ${missingText(row)}`.replace("-  ", "- "));
      await commentOnIssue(session, ctx.pmOrg, ctx.issueNumber, `${t("ck.missComment").replace("{where}", `${data.book} ${ctx.ref || data.chapter}`)}\n${lines.join("\n")}`);
      try {
        window.localStorage.setItem(missingKey, "1");
      } catch {
        /* told all the same */
      }
      setTold(true);
      announce(t("ck.missTold"));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  /**
   * An answer shows at once and is written behind: the person goes on to the next question without waiting for
   * Door43. If the write fails the answer is taken back and the error is said.
   */
  async function save(next: CheckAnswer[], said: string) {
    if (!session || !data) return;
    setAnswers((prev) => [...prev, ...next]);
    setWriting((n) => n + 1);
    setError("");
    try {
      await appendCheckAnswers(session, data.target, storeKey, next);
      announce(said);
    } catch (err) {
      setAnswers((prev) => prev.filter((row) => !next.includes(row)));
      setError(explainError(err));
    } finally {
      setWriting((n) => n - 1);
    }
  }

  const stamp = (answerItemId: string, questionId: string, value: "yes" | "no", extra: Partial<CheckAnswer> = {}): CheckAnswer => ({
    itemId: answerItemId,
    questionId,
    value,
    by: session?.username ?? "",
    at: new Date().toISOString(),
    textHash: hashes[answerItemId.startsWith("verse:") ? answerItemId.slice("verse:".length) : (checkItems.find((row) => row.id === answerItemId)?.verseKey ?? "")],
    ...extra,
  });

  async function saveNo() {
    if (!draft || !item || !session || !ctx) return;
    await save([stamp(draft.answerItemId, draft.questionId, "no", { outcome: draft.outcome, note: draft.note.trim() })], t("ck.saved"));
    if (draft.outcome === "consult" && ctx.pmOrg && ctx.issueNumber) {
      const where = `${data?.book ?? ""} ${item.chapter}:${item.verse}`;
      const who = owners.map((login) => `@${login}`).join(" ");
      await commentOnIssue(session, ctx.pmOrg, ctx.issueNumber, `${who ? `${who} ` : ""}Consulta sobre ${texts.map((x) => textLabel(x)).join(" y ")} ${where}: ${draft.note.trim()}`).catch(() => undefined);
    }
    setDraft(null);
  }

  /** The quote of the note in view becomes the words of the original under the words marked in the text. */
  async function saveQuote(resource: ChecklistText) {
    if (!session || !ctx || !data || !item || !picking?.length) return;
    const text = data.texts[resource];
    const sid = Object.keys(text?.alignments ?? {}).find((key) => verseFromSid(key, item.chapter) === item.verse);
    const found = quoteFromSelection({
      verseTokens: tokenizeVersePlainText(text?.verses[item.verse] ?? ""),
      selected: picking,
      groups: sid ? text!.alignments![sid]! : [],
      original: originalTokens(data.original ?? "", item.chapter, item.verse),
    });
    if (!found) return setError(t("ck.quoteNotAligned"));
    setSaving(true);
    setError("");
    try {
      await saveNoteQuote({ session, ctx, pmConfig: data.pmConfig ?? DEFAULT_PM_CONFIG, board: data.board, noteId: item.id, quote: found.quote, occurrence: found.occurrence });
      setData({ ...data, items: data.items.map((row) => (row.id === item.id ? { ...row, quote: found.quote, occurrence: found.occurrence } : row)) });
      setPicking(null);
      announce(t("ck.quoteSaved"));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  async function closeStep() {
    if (!session || !ctx?.pmOrg || !ctx.issueNumber || !ctx.stepId) return;
    setSaving(true);
    try {
      await completeStepFromTool({ session, pmOrg: ctx.pmOrg, issueNumber: ctx.issueNumber, stepId: ctx.stepId });
      setStepDone(true);
      announce(t("ck.stepClosed"));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  const jump = (itemId: string) => {
    const at = data?.items.findIndex((row) => row.id === itemId) ?? -1;
    if (at >= 0) setPosition(at);
  };

  // What the verse in view has a help for, in each text on screen. The checklist goes note by note, and a note
  // marks its own words; but «does every difficulty of this verse have a note?» is answered by looking at the
  // verse. Every word some help of the verse is about is underlined, and a touch on it goes to that help.
  const verseOf = item ? verseKeyOf(item) : "";
  const coverage = useMemo(() => {
    const out: Partial<Record<ChecklistText, Map<number, string[]>>> = {};
    if (!data || !item) return out;
    const helps = data.items.filter((row) => row.quote && row.chapter === item.chapter && row.verse === item.verse);
    for (const resource of texts) {
      const text = data.texts[resource];
      const verse = text?.verses[item.verse] ?? "";
      if (!verse || helps.length < 2) continue;
      out[resource] = verseCoverage(helps.map((row) => ({ id: row.id, words: alignedGatewayQuoteForHelpQuote({ verseText: verse, quote: row.quote!, occurrence: row.occurrence ?? 1, alignments: text?.alignments, book: data.book, chapter: row.chapter, verse: row.verse }).tokenIndices })));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, verseOf, textsKey]);
  const others = (resource: ChecklistText, index: number) => helpAtWord(coverage[resource]?.get(index), item?.id);
  const anyCovered = texts.some((resource) => [...(coverage[resource]?.values() ?? [])].some((ids) => ids.some((id) => id !== item?.id)));
  const nextPending = () => {
    if (!data) return;
    const order = [...data.items.slice(position + 1), ...data.items.slice(0, position + 1)];
    const found = order.find((row) => summary.items.find((s) => s.itemId === row.id)?.state !== "ok");
    if (found) jump(found.id);
  };
  const labelOf = (itemId: string) => {
    const found = data?.items.find((row) => row.id === itemId);
    return found ? `${found.chapter}:${found.verse}${found.title ? ` · ${found.title}` : ""}` : itemId;
  };

  const stepName = data?.step ? localized(data.step.name, data.step.names, language) : t("ck.title");
  // The helps editor opens for one resource: this checklist's.
  const editorHref = ctx && kind !== "palabras" ? `#/solver/helps?ctx=${encodeURIComponent(encodeSolverLaunchContext({ ...ctx, resource: kind }))}` : "";

  return (
    <div className="af ck">
      <ToolHeader
        title={toolHeading(ctx, language, stepName).title}
        onBack={onClose}
        meta={toolHeading(ctx, language, stepName).where}
      >
        {data ? (
          <div className="af-progress" aria-label={t("ck.progressAria")}>
            <span>{t("ck.nChecked").replace("{a}", String(summary.done)).replace("{n}", String(data.items.length))}</span>
            <span className="af-bar">
              <i style={{ width: `${data.items.length ? (summary.done / data.items.length) * 100 : 0}%` }} />
            </span>
          </div>
        ) : null}
      </ToolHeader>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {busy ? <p className="hub-hint">{t("af.loading")}</p> : null}
      {data && missing.length ? (
        <div className="ck-missing" role="status">
          <p className="ck-missing__title">{t("ck.missTitle")}</p>
          <ul>
            {missing.map((row) => (
              <li key={`${row.kind}-${row.resource}`}>{missingText(row)}</li>
            ))}
          </ul>
          {ctx?.issueNumber ? (
            told ? (
              <p className="af-hint">{t("ck.missAlreadyTold")}</p>
            ) : (
              <Button type="button" size="sm" disabled={saving} onClick={() => void tellMissing()}>
                {t("ck.missTell")}
              </Button>
            )
          ) : null}
        </div>
      ) : null}
      {data && !questions.length ? <p className="af-stale">{t("ck.noQuestions")}</p> : null}
      {data && !data.items.length ? <p className="hub-hint">{t("ck.noItems")}</p> : null}

      {data && data.items.length ? (
        <section className="round" aria-label={t("ck.standingAria")}>
          {stepDone ? (
            <p className="round__done">{t("ck.stepClosed")}</p>
          ) : summary.complete && closesHere ? (
            <div className="round__ready">
              <p>{t("ck.allChecked")}</p>
              <Button type="button" size="lg" disabled={saving} onClick={() => void closeStep()}>
                {t("ck.closeStep")}
              </Button>
            </div>
          ) : null}
          {(
            [
              ["ck.openList", summary.open],
              ["ck.consultList", summary.consulting],
              ["ck.changedList", summary.changed],
            ] as const
          ).map(([key, rows]) =>
            rows.length ? (
              <details key={key} className="ck-list" data-kind={key}>
                <summary>{t(key).replace("{n}", String(rows.length))}</summary>
                <ul className="round__list">
                  {rows.map((row) => (
                    <li key={row.itemId}>
                      <button type="button" className="round__item" onClick={() => jump(row.itemId)}>
                        <span>{labelOf(row.itemId)}</span>
                        <span className="round__who">
                          {Object.values(row.answers).filter((a) => a?.value === "no").map((a) => a!.note).filter(Boolean).join(" · ")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null,
          )}
        </section>
      ) : null}

      {data && item ? (
        <>
          <section className="af-dock" aria-label={t("ck.textsAria")}>
            <div className="af-dock__bar">
              <strong>
                {bookLabel(data.book, language)} {item.chapter}:{item.verse}
              </strong>
              {/* Beside the verse's name, not as one more line under two texts that already take half a phone. */}
              {anyCovered && !picking ? <span className="af-hint ck-covered-hint">{t(kind === "palabras" ? "ck.coveredTerms" : "ck.coveredNotes")}</span> : null}
            </div>
            {texts.map((resource) => {
              const text = data.texts[resource];
              const verse = text?.verses[item.verse] ?? "";
              // The item's quote is in the original language: its words in this text come from the alignment.
              const hit = item.quote && verse ? alignedGatewayQuoteForHelpQuote({ verseText: verse, quote: item.quote, occurrence: item.occurrence ?? 1, alignments: text?.alignments, book: data.book, chapter: item.chapter, verse: item.verse }) : null;
              return (
                <div key={resource} className="af-row">
                  <span className="af-lbl">{textLabel(resource)}</span>
                  {verse ? (
                    <Verse
                      text={verse}
                      marked={canPick(resource) && picking ? picking : hit?.tokenIndices ?? []}
                      onToggle={canPick(resource) && picking ? (index) => setPicking(picking.includes(index) ? picking.filter((i) => i !== index) : [...picking, index]) : undefined}
                      covered={(index) => Boolean(others(resource, index))}
                      onOpen={(index) => {
                        const next = others(resource, index);
                        if (next) jump(next);
                      }}
                    />
                  ) : (
                    <span className="af-hint">{t("ck.noText").replace("{text}", textLabel(resource))}</span>
                  )}
                  {item.quote && verse ? (
                    <span className="ck-quote" data-found={hit?.gatewayText ? "true" : "false"}>
                      {hit?.gatewayText ? t("ck.quoteIs").replace("{quote}", hit.gatewayText) : t("ck.quoteMissing").replace("{text}", textLabel(resource))}
                    </span>
                  ) : null}
                  {canPick(resource) && verse && !stepDone && !verseIsAligned(data.texts[resource]?.alignments, item.chapter, item.verse) ? (
                    <span className="af-hint">{t("ck.quoteNeedsAlignment")}</span>
                  ) : canPick(resource) && verse && !stepDone ? (
                    picking ? (
                      <span className="af-buttons">
                        <span className="af-hint">{t("ck.quotePickHint")}</span>
                        <Button type="button" size="sm" disabled={closing || !picking.length} onClick={() => void saveQuote(resource)}>
                          {t("ck.quoteSave")}
                        </Button>
                        <Button type="button" size="sm" variant="secondary" disabled={closing} onClick={() => setPicking(null)}>
                          {t("af.cancel")}
                        </Button>
                      </span>
                    ) : (
                      <Button type="button" size="sm" variant="ghost" onClick={() => setPicking(hit?.tokenIndices ?? [])}>
                        {t("ck.quoteFix")}
                      </Button>
                    )
                  ) : null}
                </div>
              );
            })}
          </section>

          <section className="af-card" aria-label={t("ck.itemAria")}>
            <div className="af-card__top">
              <span className="af-chip">{t(kind === "notas" ? "ck.kindNote" : kind === "preguntas" ? "ck.kindQuestion" : "ck.kindTerm")}</span>
              {tally ? <span className="af-state" data-state={tally.state === "ok" ? "agreed" : tally.state === "pending" ? "pending" : "disputed"}>{t(`ck.state.${tally.state}` as MessageKey)}</span> : null}
            </div>
            {item.title ? <h2 className="af-phrase">{kind === "palabras" ? termLabel(item.title, termTitles) : item.title}</h2> : null}
            {item.body ? <HelpMarkdownView className="af-note af-note--md" content={item.body} /> : null}
            {slug ? articles[slug] === undefined ? <p className="af-hint">{t("ur.readingArticle")}</p> : articles[slug] === null ? <p className="af-hint">{t("ur.noArticle")}</p> : <HelpMarkdownView className="ur-md ur-article ck-article" content={articleBody(articles[slug]!)} /> : null}
            {/* A term is already named by its title above: the path of its article says nothing to who checks it. */}
            {item.supportRef && kind !== "palabras" ? <p className="af-hint">{t("ck.support").replace("{ref}", kind === "notas" ? localizeAfinacion(categoryLabel(categoryFromSupportRef(item.supportRef)), language) : item.supportRef)}</p> : null}
            {session && ctx?.pmOrg && ctx.projectId && data ? (
              // What the teams before this one said about this very help (those who refined the text, say).
              <HelpMessages key={item.id} session={session} pmOrg={ctx.pmOrg} lang={ctx.lang} projectId={ctx.projectId} book={data.book} chapter={item.chapter} verse={item.verse} about={messageKey} resource={kind} taskName={ctx.taskName} lede={t("hm.ledeRead")} />
            ) : null}
            {editorHref ? (
              <a className="af-link" href={editorHref} target="_blank" rel="noopener noreferrer">
                {t("ck.openEditor")}
              </a>
            ) : null}

            <ul className="ck-questions">
              {questionsFor({ id: item.id, verseKey: verseKeyOf(item) }, checkItems, questions).map(({ question, answerItemId }) => {
                const answer = tally?.answers[question.id];
                const writing = draft && draft.answerItemId === answerItemId && draft.questionId === question.id;
                return (
                  <li key={question.id} className="ck-question">
                    <p className="ck-question__text">
                      {localized(question.text, question.texts, language)}
                      {question.per === "verse" ? <span className="ck-question__scope"> {t("ck.perVerse")}</span> : null}
                    </p>
                    <div className="ck-question__buttons">
                      <Button type="button" variant={answer?.value === "yes" ? "default" : "outline"} aria-pressed={answer?.value === "yes"} disabled={closing || stepDone} onClick={() => void save([stamp(answerItemId, question.id, "yes")], t("ck.saved"))}>
                        {t("ck.yes")}
                      </Button>
                      <Button type="button" variant={answer?.value === "no" ? "default" : "outline"} aria-pressed={answer?.value === "no"} disabled={closing || stepDone} onClick={() => setDraft({ answerItemId, questionId: question.id, outcome: answer?.outcome ?? "fixed", note: answer?.note ?? "" })}>
                        {t("ck.no")}
                      </Button>
                    </div>
                    {answer?.value === "no" && !writing ? (
                      <p className="ck-question__outcome" data-outcome={answer.outcome ?? "none"}>
                        {answer.outcome ? t(OUTCOME_KEY[answer.outcome]) : t("ck.noOutcome")}
                        {answer.note ? `: ${answer.note}` : ""}
                        {answer.outcome === "consult" && !answer.resolved ? (
                          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void save([{ ...answer, resolved: true, by: session?.username ?? "", at: new Date().toISOString() }], t("ck.saved"))}>
                            {t("ck.answered")}
                          </Button>
                        ) : null}
                      </p>
                    ) : null}
                    {writing ? (
                      <div className="ck-no" role="group" aria-label={t("ck.whatDone")}>
                        <p className="af-lbl">{t("ck.whatDone")}</p>
                        <div className="ck-no__outcomes">
                          {(["fixed", "created", "consult"] as CheckOutcome[]).map((outcome) => (
                            <button key={outcome} type="button" aria-pressed={draft.outcome === outcome} onClick={() => setDraft({ ...draft, outcome })}>
                              {t(OUTCOME_KEY[outcome])}
                            </button>
                          ))}
                        </div>
                        <label htmlFor="ck-note" className="af-lbl">
                          {t(draft.outcome === "consult" ? "ck.reason" : "ck.whatChanged")}
                        </label>
                        <textarea id="ck-note" className="af-textarea" rows={3} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
                        {draft.outcome === "consult" ? <p className="af-hint">{owners.length ? t("ck.consultTo").replace("{who}", owners.map((o) => `@${o}`).join(", ")) : t("ck.consultNobody")}</p> : null}
                        <div className="af-buttons">
                          <Button type="button" disabled={saving || !draft.note.trim()} onClick={() => void saveNo()}>
                            {saving ? t("af.saving") : t("ck.saveNo")}
                          </Button>
                          <Button type="button" variant="secondary" onClick={() => setDraft(null)}>
                            {t("af.cancel")}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          <nav className="af-nav" aria-label={t("ck.navAria")}>
            <Button type="button" variant="secondary" disabled={position <= 0} onClick={() => setPosition((p) => Math.max(0, p - 1))}>
              {t("af.prev")}
            </Button>
            <span className="af-count">{t("af.countOf").replace("{a}", String(position + 1)).replace("{b}", String(data.items.length))}</span>
            <Button type="button" variant="secondary" disabled={position >= data.items.length - 1} onClick={() => setPosition((p) => p + 1)}>
              {t("af.next")}
            </Button>
          </nav>
          {!summary.complete ? (
            <Button type="button" variant="outline" onClick={nextPending}>
              {t("ck.nextPending")}
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
