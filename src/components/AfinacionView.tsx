import { ToolHeader } from "./ToolHeader";
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadSession, type GtSession } from "../dcs/auth";
import { loadAfinacionNotes, loadArticleBody, loadArticleInfo, loadTermTitles, type AfinacionNotesData, type AfinacionStep } from "../dcs/afinacionLoad";
import { appendMyDecision, loadDecisionFiles, savePreferredTerm, saveCorrection } from "../dcs/afinacionStore";
import { commentOnIssue } from "../dcs/issues";
import { formatChatEvent } from "../domain/chatEvent";
import { loadAssignmentsFromDcs } from "../dcs/persist";
import { articleName, articlePathOf, articleShortName, groupByCategory, type ArticleInfo, type NoteItem } from "../domain/afinacionNotes";
import { HelpMarkdownView } from "./HelpMarkdownView";
import { BookA, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { HelpMessages } from "./HelpMessages";
import { termMessageKey } from "../domain/studyNotes";
import { compareTermRenderings, termLabel, type PreferredTerms, type TermItem } from "../domain/afinacionWords";
import { selectionFromWords, toggleWord, wordSpans, wordsOfSelection } from "../domain/afinacionSelection";
import { alignedGatewayQuoteForHelpQuote, matchHelpQuoteToTokenIndices, tokenizeVersePlainText } from "../domain/helpQuoteMatch";
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
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fixing, setFixing] = useState(false);
  const [fixText, setFixText] = useState("");
  const [fixReason, setFixReason] = useState("");
  const [preferredTerms, setPreferredTerms] = useState<PreferredTerms>({});
  const [termTitles, setTermTitles] = useState<Record<string, string>>({});
  const [articles, setArticles] = useState<Record<string, ArticleInfo>>({});
  /** How many messages each note has for the team that will work on the notes. */
  const [noteMessages, setNoteMessages] = useState<Record<string, number>>({});
  /** What the draft is compared with, kept from one item to the next. */
  /** The help or context open under the answer: the article, the note, the renderings in the book. */
  const [compare, setCompare] = useState<"article" | "note" | "book">("article");
  /** The text the draft is read against: the original unless the person chose another. */
  const [refText, setRefText] = useState<"orig" | "ult" | "ust">("orig");
  /** «Revisar» (the item in hand) or «Capítulo» (whole chapters of a text, to read around it). */
  const [pane, setPane] = useState<"review" | "chapter">("review");
  const [readChapter, setReadChapter] = useState(0);
  /** The text read in «Leer el capítulo»: the original, an English text, or what the team's draft has so far. */
  const [chapterText, setChapterText] = useState<"orig" | "ult" | "ust" | "draft">("orig");
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
    if (reading?.path === path && reading.body !== undefined) return;
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


  // Words step: how this term was rendered in every use across the book.
  const termSlug = item && "termSlug" in item ? (item as TermItem).termSlug : "";
  const termKey = termSlug ? termMessageKey((item as TermItem).termKind, termSlug) : "";
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
  /** Words of a verse by their positions, in order; a gap between them is said with «…». */
  const wordsAt = (text: string, positions: number[]) => {
    const words = wordSpans(text);
    const picked = [...positions].sort((x, y) => x - y);
    return picked.map((index, at) => `${at && index !== picked[at - 1]! + 1 ? "… " : ""}${words[index]?.text ?? ""}`).join(" ")
      // Punctuation at either end is not part of what is asked about.
      .replace(/^[\s.,;:!?¡¿«»“”"'()]+|[\s.,;:!?¡¿«»“”"'()]+$/g, "");
  };
  /** The words of the draft the person marked. */
  const chosenWords = useMemo(() => wordsAt(verseText, selected), [selected, verseText]);
  const messageKeyOf = stepProp === "notas" ? (item?.id ?? "") : termKey;
  const messagesHere = noteMessages[messageKeyOf] ?? 0;
  const compareTabs = [
    ...(stepProp === "notas" ? [{ id: "article" as const, label: t("af.tabArticle") }] : [{ id: "book" as const, label: t("af.inWholeBook") }]),
    { id: "note" as const, label: `${t(stepProp === "notas" ? "af.tabNote" : "af.tabMessage")}${messagesHere ? ` · ${messagesHere}` : ""}` },
  ];
  const helpsTab = compareTabs.some((tab) => tab.id === compare) ? compare : compareTabs[0]!.id;
  // The words the item is about, marked in the text it is read against: in the original from the quote, in the
  // English texts through their alignment with it.
  const reference = data?.references.find((row) => row.id === refText) ?? data?.references[0];
  const refVerse = item && reference ? (reference.book[`${item.chapter}:${item.verse}`] ?? "") : "";
  const refMarked = useMemo(() => {
    if (!item || !reference || !refVerse) return [] as number[];
    if (reference.id === "orig") return item.quote ? matchHelpQuoteToTokenIndices(tokenizeVersePlainText(refVerse), item.quote, item.occurrence) : [];
    return alignedGatewayQuoteForHelpQuote({ verseText: refVerse, quote: item.quote, occurrence: item.occurrence, alignments: reference.alignments, book: data!.book, chapter: item.chapter, verse: item.verse }).tokenIndices;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, reference?.id, refVerse]);
  /** What is marked in the reference, to say in the draft which words to look for. */
  const markedWords = useMemo(() => wordsAt(refVerse, refMarked), [refVerse, refMarked]);
  const chapterTexts = useMemo(
    () => (data ? [...data.references, { id: "draft" as const, label: t("af.draftLabel").replace("{res}", data.resource === "tps" ? "TPS" : "TPL"), book: data.bookDraft }] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  );
  const chapterSource = chapterTexts.find((row) => row.id === chapterText) ?? chapterTexts[0];
  const lastChapter = useMemo(() => Math.max(0, ...Object.keys(reference?.book ?? {}).map((key) => Number(key.split(":")[0]))), [reference]);
  // The article is read when its tab is opened, and again for each new figure while it stays open.
  useEffect(() => {
    if (helpsTab !== "article" || !item) return;
    const path = articlePathOf(item.supportRef);
    if (path && reading?.path !== path) void readArticle(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [helpsTab, item?.id]);

  return (
    <div className="af af--round">
      <ToolHeader
        title={t(TITLE[stepProp])}
        onBack={onClose}
        meta={[data ? `${data.book} ${data.chapter} · ${data.resource === "tps" ? "TPS" : "TPL"}` : ctx ? `${ctx.book} ${ctx.chapter}` : "", summary && data ? t("af.nAgreed").replace("{a}", String(summary.agreed)).replace("{n}", String(data.items.length)) : ""].filter(Boolean).join(" · ")}
        actions={
          data ? (
            <a className="th-icon" href={`#/glosario?libro=${encodeURIComponent(data.book)}&c=${data.chapter}&de=1&a=200`} target="_blank" rel="noreferrer" aria-label={t("gl.open")} title={t("gl.open")}>
              <BookA size={18} aria-hidden />
            </a>
          ) : null
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {busy ? <p className="hub-hint">{t("af.loading")}</p> : null}

      {summary ? (
        <RoundPanel summary={summary} labelOf={labelOfItem} onJump={jumpToItem} closesHere={closesHere} stepDone={stepDone} busy={closing} onClose={() => void closeRound()} />
      ) : null}

      {data && item ? (
        <div className="fam-tabs af-panes" role="tablist">
          <button type="button" role="tab" className="fam-tab" aria-selected={pane === "review"} onClick={() => setPane("review")}>
            {t("af.paneReview")}
          </button>
          <button
            type="button"
            role="tab"
            className="fam-tab"
            aria-selected={pane === "chapter"}
            onClick={() => {
              setReadChapter(item.chapter);
              setPane("chapter");
            }}
          >
            {t("af.paneChapter")}
          </button>
        </div>
      ) : null}

      {data && item && pane === "chapter" ? (
        // Whole chapters of the text chosen, to read the item in its place: the original unless another is chosen.
        <section className="af-chapter">
          <div className="af-ref__bar">
            <div className="af-ref__texts" role="tablist" aria-label={t("af.readAgainst")}>
              {chapterTexts.map((row) => (
                <button key={row.id} type="button" role="tab" aria-selected={chapterSource?.id === row.id} onClick={() => setChapterText(row.id)}>
                  {row.id === "orig" ? t("af.tabOriginal") : row.label}
                </button>
              ))}
            </div>
            <label className="af-pick">
              <span className="sr-only">{t("af.chapterPick")}</span>
              <select value={readChapter || item.chapter} onChange={(e) => setReadChapter(Number(e.target.value))}>
                {Array.from({ length: Math.max(lastChapter, item.chapter) }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {t("af.chapterN").replace("{n}", String(n))}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} aria-hidden />
            </label>
          </div>
          {chapterSource?.id === "draft" ? <p className="af-hint">{t("af.draftSoFar")}</p> : null}
          <div className={chapterSource?.id === "orig" ? "af-chapter__text af-orig" : "af-chapter__text"} lang={chapterSource?.id === "orig" ? "grc" : undefined}>
            {Object.entries(chapterSource?.book ?? {})
              .filter(([key]) => Number(key.split(":")[0]) === (readChapter || item.chapter))
              .sort(([a], [b]) => Number(a.split(":")[1]) - Number(b.split(":")[1]))
              .map(([key, text]) => {
                const verse = Number(key.split(":")[1]);
                return (
                  <p key={key} className="hs-v" data-here={(readChapter || item.chapter) === item.chapter && verse === item.verse ? "true" : undefined}>
                    <sup>{verse}</sup> {text}
                  </p>
                );
              })}
          </div>
        </section>
      ) : null}

      {data && item && pane === "review" ? (
        <>
          <section className="af-focus" aria-label={t("af.noteAria")}>
            {/* What this item is: the category of the note (or the key term). Everything below is about it. */}
            <div className="af-focus__top">
              <p className="af-kind">{stepProp === "notas" ? t("af.kindNote").replace("{ref}", `${item.chapter}:${item.verse}`) : t("af.kindTerm").replace("{ref}", `${item.chapter}:${item.verse}`)}</p>
              {tally ? <span className="af-state" data-state={tally.state}>{t(STATE_KEY[tally.state])}</span> : null}
            </div>
            <h2 className="af-category">{stepProp === "notas" ? nameOf(item) : termSlug ? termLabel(termSlug, termTitles) : item.phrase ? `«${item.phrase}»` : item.quote || t("af.wholeVerse")}</h2>

            {/* 1. Where it is: marked in the text the draft is read against, the original unless another is chosen. */}
            <div className="af-ref">
              <div className="af-ref__bar">
                <span className="af-lbl">{t("af.marked")}</span>
                <div className="af-ref__texts" role="tablist" aria-label={t("af.readAgainst")}>
                  {(data.references ?? []).map((row) => (
                    <button key={row.id} type="button" role="tab" aria-selected={reference?.id === row.id} onClick={() => setRefText(row.id)}>
                      {row.id === "orig" ? t("af.tabOriginal") : row.label}
                    </button>
                  ))}
                </div>
              </div>
              <span className={reference?.id === "orig" ? "af-orig" : undefined} lang={reference?.id === "orig" ? "grc" : undefined}>
                <Words text={refVerse} marked={refMarked} />
              </span>
            </div>

            <div className="af-draft">
              <div className="af-draft__bar">
                <span className="af-draft__name">
                  <span className="af-lbl">{t("af.draftStep")}</span>
                  {/* Which text the words tapped belong to: the literal or the simple translation. */}
                  <span className="af-res">{data.resource === "tps" ? "TPS" : "TPL"}</span>
                </span>
                {fixing ? null : (
                  <button
                    type="button"
                    className="af-link"
                    onClick={() => {
                      setFixText(verseText);
                      setFixing(true);
                    }}
                  >
                    {t("af.fixShort")}
                  </button>
                )}
              </div>
              {fixing ? (
                <div className="af-fix" role="group" aria-label={t("af.fixAria")}>
                  <textarea id="af-fix-text" className="af-textarea" rows={4} value={fixText} aria-label={t("af.verseText")} onChange={(e) => setFixText(e.target.value)} />
                  <input id="af-fix-reason" className="af-input" value={fixReason} placeholder={t("af.why")} aria-label={t("af.why")} onChange={(e) => setFixReason(e.target.value)} />
                  <p className="af-hint">{t("af.fixHint")}</p>
                  <div className="af-row-buttons">
                    <Button type="button" size="sm" disabled={saving || !fixText.trim()} onClick={() => void saveFix()}>
                      {saving ? t("af.saving") : t("af.saveFix")}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setFixing(false)}>
                      {t("af.cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <Words text={verseText} onTap={(i) => setSelected((prev) => toggleWord(prev, i))} selected={selected} />
                  <p className="af-hint">
                    {t("af.tapMarked")
                      .replace("{res}", data.resource === "tps" ? "TPS" : "TPL")
                      .replace("{marked}", markedWords ? `«${markedWords}»` : t(termSlug ? "af.theTerm" : "af.theMarked"))}
                  </p>
                </>
              )}
            </div>

            <div className="af-ask">
              <p className="af-lbl">{t("af.judgeStep")}</p>
              <p className="af-question">
                {stepProp === "notas"
                  ? t(QUESTION[stepProp][data.resource]).replace("{figure}", nameOf(item)).replace("{words}", chosenWords ? `«${chosenWords}»` : t("af.theWords"))
                  : t(QUESTION[stepProp][data.resource])}
              </p>
              {stepProp === "notas" ? <p className="af-hint">{t(data.resource === "tps" ? "af.guideTps" : "af.guideTpl")}</p> : null}
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
            </div>
            {/* Helps and context, one at a time: they explain the category, they are not what is judged. */}
            <p className="af-lbl af-helps-title">{t("af.helps")}</p>
            <div className="af-compare-tabs" role="tablist" aria-label={t("af.helps")}>
              {compareTabs.map((tab) => (
                <button key={tab.id} type="button" role="tab" className="mde-kind" aria-selected={helpsTab === tab.id} onClick={() => setCompare(tab.id)}>
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="af-compare-pane" role="tabpanel">
              {helpsTab === "article" ? (
                <>
                  {articles[articlePathOf(item.supportRef)]?.question ? <p className="af-article-q">{articles[articlePathOf(item.supportRef)]!.question}</p> : null}
                  {reading?.path === articlePathOf(item.supportRef) ? (
                    reading.body === undefined ? <p className="af-hint">{t("af.loadingArticle")}</p> : reading.body ? <HelpMarkdownView content={reading.body} /> : <p className="af-hint">{t("af.noArticle")}</p>
                  ) : null}
                </>
              ) : helpsTab === "note" ? (
                <>
                  {item.note ? <HelpMarkdownView className="af-note af-note--md" content={item.note} /> : null}
                  {session && ctx?.pmOrg && ctx.projectId && (stepProp === "notas" || termSlug) ? (
                    // Refining is about the text, not the helps: a disagreement with a note or a term is left for whoever harmonizes it.
                    <HelpMessages
                      key={stepProp === "notas" ? item.id : termKey}
                      session={session}
                      pmOrg={ctx.pmOrg}
                      lang={ctx.lang}
                      projectId={ctx.projectId}
                      book={data.book}
                      chapter={item.chapter}
                      verse={item.verse}
                      about={stepProp === "notas" ? item.id : termKey}
                      resource={stepProp === "notas" ? "notas" : "palabras"}
                      taskName={ctx.taskName}
                      lede={t(stepProp === "notas" ? "hm.ledeLeave" : "hm.ledeLeaveTerm")}
                      onCount={(count) => setNoteMessages((prev) => (prev[messageKeyOf] === count ? prev : { ...prev, [messageKeyOf]: count }))}
                    />
                  ) : null}
                </>
              ) : comparison ? (
                <div className="af-compare" aria-label={t("af.compareAria")}>
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
                  {comparison.renderings.length > 1 ? <p className="af-stale">{t("af.manyRenderings").replace("{n}", String(comparison.renderings.length))}</p> : null}
                  {comparison.unmarked.length ? <p className="af-hint">{t(comparison.unmarked.length === 1 ? "af.unmarkedOne" : "af.unmarkedMany").replace("{n}", String(comparison.unmarked.length))}</p> : null}
                </div>
              ) : null}
            </div>

          </section>

          <nav className="af-nav" aria-label={t("af.notesNavAria")}>
            <Button type="button" variant="secondary" aria-label={t("af.prev")} disabled={position <= 0} onClick={() => setPosition((p) => Math.max(0, p - 1))}>
              <ChevronLeft size={16} aria-hidden /> <span className="af-nav__word">{t("af.prev")}</span>
            </Button>
            <div className="af-nav__mid">
              {groups.length > 1 ? (
              // Which figure is reviewed: one picker instead of a row of every kind of the chapter.
              <label className="af-pick">
                <span className="sr-only">{t(stepProp === "notas" ? "af.figuresAria" : "af.category")}</span>
                <select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setPosition(0);
                  }}
                >
                  {[{ category: "all", label: "", items: data.items }, ...groups].map((group) => {
                    const done = summary ? group.items.filter((row) => summary.items.find((tally) => tally.itemId === row.id)?.state === "agreed").length : 0;
                    const name = group.category === "all" ? t("af.allFigures") : stepProp === "notas" ? articleShortName(group.items[0]!, articles[articlePathOf(group.items[0]!.supportRef)], (label) => localizeAfinacion(label, language)) : localizeAfinacion(group.label, language);
                    return (
                      <option key={group.category} value={group.category}>
                        {`${name} · ${done}/${group.items.length}`}
                      </option>
                    );
                  })}
                </select>
                <ChevronDown size={14} aria-hidden />
              </label>
              ) : null}
              <span className="af-count">{t("af.countOf").replace("{a}", String(Math.min(position + 1, total))).replace("{b}", String(total))}</span>
            </div>
            <Button type="button" variant="secondary" aria-label={t("af.next")} disabled={position >= total - 1} onClick={() => setPosition((p) => p + 1)}>
              <span className="af-nav__word">{t("af.next")}</span> <ChevronRight size={16} aria-hidden />
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
