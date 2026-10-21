import { toolHeading } from "./toolHeading";
import { helpsAddressOf } from "../config";
import { ToolHeader } from "./ToolHeader";
import { StepAsk } from "./StepAsk";
import { HelpMessages } from "./HelpMessages";
import { HelpMarkdownView } from "./HelpMarkdownView";
import { HelpVersions } from "./HelpVersions";
import { articlePathOf, categoryFromSupportRef, categoryLabel } from "../domain/afinacionNotes";
import { localizeAfinacion } from "../domain/afinacionNames";
import { missingWork, verseIsAligned, verseList, type MissingWork } from "../domain/checklistReady";
import { articleMessageKey, termMessageKey } from "../domain/studyNotes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Circle, Clock3, Info, Maximize2, Pencil, Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ChapterPair } from "./ChapterReader";
import { bookLabel } from "../domain/books";
import { MoreMenu } from "./MoreMenu";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { loadSession, type GtSession } from "../dcs/auth";
import { appendCheckAnswers, loadCheckAnswers } from "../dcs/checkStore";
import { chapterTextOf, loadArticleBody, loadTermTitles, type ChapterText } from "../dcs/afinacionLoad";
import { resolveSourcePackage, sourcePackageLang } from "../domain/sourcePackage";
import { articleBody, termArticlePath, termLabel, type TermKind } from "../domain/afinacionWords";
import { loadChecklist, type ChecklistData, type ChecklistItem, type ChecklistKind, type ChecklistText } from "../dcs/checklistLoad";
import { commentOnIssue } from "../dcs/issues";
import { completeStepFromTool, stepIsDone } from "../dcs/roundClose";
import { goOnAfterStep } from "../dcs/nextStep";
import { useStepWork } from "../dcs/stepWork";
import { freshRowId } from "../domain/helpsDraft";
import { consultReply, groupInView, groupsOf, questionsFor, summarizeChecklist, withVerseStops, type CheckAnswer, type CheckItem, type CheckOutcome, type ThreadLine } from "../domain/checklist";
import { PROPOSAL_FREE, loadTrialChecks, proposalAnswer, proposalSaying, proposalsOf, readable, saveTrialChecks, withoutWithdrawn, type ProposalPayload } from "../domain/checkProposal";
import { uid } from "../domain/assignment";
import { ownerLabel } from "../domain/resourceOwner";
import { PROPOSAL_STATE_KEY, ProposalDiff, ProposalSheet, type ProposalDraft, type ProposalTarget } from "./ProposalSheet";
import { listIssueComments } from "@ip-lms/dcs-client";
import { dcsConfig } from "../dcs/config";
import { PM_REPO_NAME } from "../domain/types";
import { alignedGatewayQuoteForHelpQuote, tokenizeVersePlainText } from "../domain/helpQuoteMatch";
import { coordinatorsOf } from "../domain/levels";
import { localized, stepPurpose } from "../domain/processes";
import { decodeSolverLaunchContext, type SolverLaunchContext } from "../domain/solverLaunch";
import { textFingerprint } from "../domain/reviewRound";
import { closesInItsTool, stepMinAssignees } from "../domain/stepClaim";
import { useUiLanguage } from "../i18n/language";
import { tNow, useT, type MessageKey } from "../i18n/messages";
import { scopeLabel } from "../domain/resourceNames";
import { originalTokens, quoteFromSelection, quoteUnits, toggleQuoteWord, wholeQuoteWords } from "../domain/quoteFromSelection";
import { DEFAULT_PM_CONFIG } from "../domain/roles";
import { verseFromSid } from "../domain/usfmAst";
import { readTeamArticle, saveNoteQuote, type TeamArticle } from "../dcs/teamHelps";
import { explainError } from "../dcs/userError";
import { LoadingState } from "./LoadingState";
import { QuoteVerse as Verse } from "./QuoteVerse";

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

const OUTCOME_KEY: Record<CheckOutcome, MessageKey> = { fixed: "ck.fixed", created: "ck.created", consult: "ck.consult", proposal: "ck.proposal" };
const excerpt = (text: string) => (text.length > 120 ? `${text.slice(0, 119).trimEnd()}…` : text);
/**
 * How a question stands, as its mark says it: answered «yes», a «no» with nothing done about it yet, or a «no»
 * that something settles (a change proposed, or made, or an answer from whoever was asked). The two kinds of «no»
 * had one mark, a cross: a step where a change had been proposed read as one that had gone wrong.
 */
type Mark = "none" | "yes" | "no" | "change" | "wait";
/**
 * How an answer is marked. A consultation not answered yet (an article waiting to be translated) is «waiting», not
 * a fault: it was an X in red, the same as a «no» left without a change (20 October).
 */
const markOf = (answer: CheckAnswer | undefined): Mark =>
  !answer ? "none" : answer.value === "yes" ? "yes" : answer.outcome === "proposal" || answer.outcome === "fixed" || answer.outcome === "created" || (answer.outcome === "consult" && answer.resolved) ? "change" : answer.outcome === "consult" ? "wait" : "no";
const verseKeyOf = (item: Pick<ChecklistItem, "chapter" | "verse">) => `${item.chapter}:${item.verse}`;

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
  /**
   * A change being proposed: the question that was answered «no» (or none: something seen in passing), and the
   * reason it starts with. `onlyVerse`: the question is about the verse as a whole, not about the help in view.
   */
  const [proposing, setProposing] = useState<{
    answerItemId: string;
    questionId: string;
    reason: string;
    onlyVerse?: boolean;
    /** Opened to propose a note that is missing. */
    newNote?: boolean;
    /** The other questions that failed, which the same proposal answers. */
    others?: { answerItemId: string; questionId: string }[];
  } | null>(null);
  /** «Hay algo que cambiar» was touched: what is wrong is chosen among the questions of the step in view. */
  const [choosing, setChoosing] = useState(false);
  /**
   * The chapter around the help, opened from a text's box as in afinación (20 October): the texts of the step side
   * by side, the original a touch away, with the verse in view standing out and what the help quotes marked.
   */
  const [chapterOpen, setChapterOpen] = useState(false);
  const [pairShown, setPairShown] = useState<string[]>([]);
  /** What was marked as failing, while choosing: one or several questions of the step, or something else. */
  const [failing, setFailing] = useState<string[]>([]);
  /** Fixing the quote of the note in view: the words marked in the text so far. */
  const [picking, setPicking] = useState<number[] | null>(null);

  const textsKey = texts.join(",");
  /** A note's quote is fixed on the first text of the step, the one its quote is read against. */
  const canPick = (resource: ChecklistText) => kind === "notas" && resource === texts[0] && Boolean(data?.original) && !data?.fromSource && (firstGroup || Boolean(picking));
  /** What the project's process calls each text. */
  const textLabel = (resource: ChecklistText) => scopeLabel(resource, data?.board?.settings?.resourceNames, language);
  const storeKey = ctx ? `${(ctx.book || ctx.projectId).toUpperCase()}.${ctx.issueNumber || ctx.taskId}.${ctx.stepId || "paso"}` : "";
  /**
   * Opened to try it (see `trialLaunchContext`): what is answered stays on this screen. Opened that way it wrote
   * every answer to the project all the same, under the name of the task, where no subtarea would ever read it.
   */
  const trying = Boolean(ctx?.lab && !ctx.labAllowWrite);

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
      // A trial keeps its answers in this tab (see `loadTrialChecks`), so the agreement can be tried after it.
      setAnswers(decoded.lab && !decoded.labAllowWrite ? loadTrialChecks(key) : await loadCheckAnswers(session, loaded.target, key));
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
  /** The walk: every help, and a stop for each verse after its last help (see `withVerseStops`). */
  const checkItems: CheckItem[] = useMemo(
    () => withVerseStops((data?.items ?? []).map((item) => ({ id: item.id, verseKey: verseKeyOf(item), text: item.body, linked: Boolean(item.supportRef), ...(kind === "notas" && item.supportRef ? { article: articlePathOf(item.supportRef) } : {}) })), data?.step?.checklist ?? []),
    [data],
  );
  // What each verse reads now in the texts on screen: an answer given before a change of the text is checked again.
  const hashes = useMemo(() => {
    const out: Record<string, string> = {};
    for (const row of data?.items ?? []) out[verseKeyOf(row)] = textFingerprint(texts.map((x) => data?.texts[x]?.verses[row.verse] ?? "").join("|"));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, textsKey]);
  const summary = useMemo(() => summarizeChecklist({ items: checkItems, questions, answers: withoutWithdrawn(answers), currentHashes: hashes }), [checkItems, questions, answers, hashes]);
  useStepWork(session, ctx, summary.done, checkItems.length, { on: !stepDone && !closing });
  // What was said in the conversation of the subtarea, read while a consultation waits: its answer is shown here.
  const [thread, setThread] = useState<ThreadLine[]>([]);
  const consulting = summary.consulting.length;
  useEffect(() => {
    if (!consulting || !session || !ctx?.pmOrg || !ctx.issueNumber) return;
    let alive = true;
    void listIssueComments(dcsConfig(session.host), ctx.pmOrg, PM_REPO_NAME, ctx.issueNumber, session.token)
      .then((rows) => alive && setThread(rows.map((row) => ({ by: row.user?.login ?? "", at: row.created_at ?? "", body: row.body ?? "" }))))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulting, session?.token, ctx?.pmOrg, ctx?.issueNumber]);
  const replyTo = (answer: CheckAnswer | undefined) => (answer?.outcome === "consult" && !answer.resolved ? consultReply(answer, thread) : null);
  /** Where the walk is: a help, or the stop of a verse. */
  const entry = checkItems[Math.min(position, Math.max(checkItems.length - 1, 0))];
  /** The stop of a verse in view, where its questions are answered with every help of it read. */
  const verseStop = entry?.stop ? entry : undefined;
  /** The help in view; at a verse's stop, its first help, which places what is proposed there in that verse. */
  const item = entry ? data?.items.find((row) => (verseStop ? verseKeyOf(row) === verseStop.verseKey : row.id === entry.id)) : undefined;
  const tally = entry ? summary.items.find((row) => row.itemId === entry.id) : undefined;
  /**
   * The questions of the help in view. A list that checks a help against several things (two texts, its article)
   * asks them a group at a time: what the group is read against is put on screen, its few questions are answered,
   * and the next group follows. They were a list for each, and every note of a unit was read three times.
   */
  const rowsHere = entry ? questionsFor(entry, checkItems, questions) : [];
  const groups = groupsOf(rowsHere);
  // A verse's stop asks its questions together, against both texts.
  const grouped = !verseStop && groups.length > 1;
  /** The group somebody asked for, of the help it was asked for: another help starts at what it has left. */
  const [asked, setAsked] = useState<{ itemId: string; about: string } | null>(null);
  const group = groupInView(groups, (id) => Boolean(tally?.answers[id]), asked && asked.itemId === item?.id ? asked.about : undefined);
  const rowsShown = grouped ? (group?.rows ?? []) : rowsHere;
  const pendingHere = rowsShown.filter(({ question }) => !tally?.answers[question.id]);
  /** Another group of this help has something left to answer. */
  const pendingElsewhere = grouped && groups.some((other) => other !== group && other.rows.some((row) => !tally?.answers[row.question.id]));
  /** The texts on screen: up to the one the group is read against; all of them when the list is not asked in groups. */
  const aboutText = texts.indexOf((group?.about ?? "") as ChecklistText);
  const textsShown = !grouped ? texts : aboutText >= 0 ? texts.slice(0, aboutText + 1) : texts.slice(0, 1);
  /** The group is read against the article of the help, not against a text. */
  const aboutArticle = grouped && aboutText < 0 && Boolean(group?.about);
  /**
   * The first group, or a list that has none. What is only of use while the help is first read against its text
   * (which words it is about, said in a line; fixing its quote) is left out of the groups that follow: with it,
   * and with the article, a second text or the article open left no room for the note itself on a phone, and the
   * question was whether the note explains what was on screen.
   */
  const firstGroup = !grouped || group === groups[0];
  // A key term is shown by the name the team gives it (the title of its article), not by its code in English.
  const [termTitles, setTermTitles] = useState<Record<string, string>>({});
  /** Those names have been read (or could not be): until then a term has no name to show but its code in English. */
  const [titlesRead, setTitlesRead] = useState(false);
  useEffect(() => {
    const sess = loadSession();
    if (!sess?.token || !ctx || data?.kind !== "palabras" || !data.items.length) return;
    let cancelled = false;
    const uses = data.items.flatMap((row) => {
      const [termKind, ...slug] = (row.supportRef ?? "").split("/");
      return termKind && slug.length ? [{ termKind: termKind as TermKind, termSlug: slug.join("/") }] : [];
    });
    // Where the team has no article of its own yet, the source's title (in its language) beats the code it is filed under.
    void loadTermTitles(sess, resolveSourcePackage(data.board?.settings), uses, ctx)
      .then((titles) => !cancelled && setTermTitles(titles))
      .catch(() => undefined)
      .then(() => !cancelled && setTitlesRead(true));
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
  // The article of the item opens on the section the step is about, when the process names one.
  const focusHeads = (rowsShown.find((row) => row.question.articleFocus?.length)?.question.articleFocus ?? data?.step?.articleFocus ?? []).join("\u0000");
  const shownArticle = `${position}|${Object.keys(articles).length}|${group?.about ?? ""}`;
  useEffect(() => {
    const box = document.querySelector<HTMLElement>(".ck-article");
    // A group with no section of its own reads the article from its beginning.
    if (!focusHeads) {
      if (box && grouped) box.scrollTop = 0;
      return;
    }
    const wanted = focusHeads.split("\u0000").map((head) => head.toLowerCase());
    const head = box ? [...box.querySelectorAll<HTMLElement>("h1, h2, h3, h4")].find((el) => wanted.includes((el.textContent ?? "").trim().toLowerCase())) : undefined;
    if (box && head) box.scrollTop = head.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 4;
  }, [focusHeads, shownArticle]);
  const slug = kind === "palabras" && termKind ? termSlug.join("/") : "";
  // The Academy article a note points to. Its checklist asks whether the article teaches the difficulty of the
  // note and whether it is published in this language, and showed its name alone: neither could be answered here.
  const articlePath = kind === "notas" && item?.supportRef ? articlePathOf(item.supportRef) : "";
  const [academy, setAcademy] = useState<Record<string, TeamArticle | null>>({});
  /** The article as the source has it, to compare the team's with (20 October). */
  const [academySource, setAcademySource] = useState<Record<string, string | null>>({});
  useEffect(() => {
    if (!articlePath || !session?.token || !ctx || !data || articlePath in academy) return;
    let cancelled = false;
    const pkg = resolveSourcePackage(data.board?.settings);
    void Promise.all([
      readTeamArticle({ session, ctx, pmConfig: data.pmConfig ?? DEFAULT_PM_CONFIG, board: data.board, pkg, resource: "academia", path: articlePath }).catch(() => null),
      loadArticleBody(session, ctx, pkg, articlePath, { teamFirst: false }).catch(() => null),
    ]).then(([article, source]) => {
      if (cancelled) return;
      setAcademy((prev) => ({ ...prev, [articlePath]: article }));
      setAcademySource((prev) => ({ ...prev, [articlePath]: source }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articlePath, session?.token, ctx?.issueNumber, data]);
  useEffect(() => {
    if (!slug || !session?.token || !ctx || !data || slug in articles) return;
    let cancelled = false;
    // As the team has it now: an article it translated for this book is on its draft, not published yet.
    void readTeamArticle({ session, ctx, pmConfig: data.pmConfig ?? DEFAULT_PM_CONFIG, board: data.board, pkg: resolveSourcePackage(data.board?.settings), resource: "palabras", path: termArticlePath(termKind as TermKind, slug) })
      .catch(() => null)
      .then((article) => !cancelled && setArticles((prev) => ({ ...prev, [slug]: article?.text?.trim() ? article.text : null })));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, Boolean(data)]);
  // On to another group, or to another help: the screen is placed so that the help starts right under the text and
  // its questions clear the bar at the foot. The text a group is read against had come on screen above, and its
  // questions were left under the bar (the first at 788 px of 812); in the group after, the note itself was under
  // the two texts. The first help opened is left where it is, under the name of the step and how far it has come.
  const checksRef = useRef<HTMLUListElement>(null);
  const shownFor = useRef("");
  const groupKey = `${group?.about ?? ""}|${aboutArticle ? Object.keys(academy).length : 0}`;
  useEffect(() => {
    const was = shownFor.current;
    shownFor.current = item?.id ?? "";
    const list = checksRef.current;
    // The screen scrolls inside itself (`.af`), not in the window.
    const screen = list?.closest<HTMLElement>(".af");
    if (!grouped || !item || !list || !screen || !was) return;
    // The steps, the heading and what is checked, in sight from the top: what the step asks is read first, and
    // then the help and its texts under it (20 October). Only up: a screen already at its top stays.
    const card = screen.querySelector<HTMLElement>(".af-card");
    const place = () => {
      const anchor = screen.querySelector<HTMLElement>(".ck-steps--top") ?? screen.querySelector<HTMLElement>(".ck-heading");
      if (!anchor) return;
      const by = anchor.getBoundingClientRect().top - screen.getBoundingClientRect().top - 8;
      if (by < -1) screen.scrollBy({ top: by });
    };
    place();
    if (!card) return;
    // What the group brings may take its size a moment later (an article is laid out after it is put in: the
    // questions were placed, and then pushed 226 px down, under the bar). The place is taken again as the card
    // changes, for a few seconds or until the person moves the screen themselves.
    const changes = new MutationObserver(place);
    changes.observe(card, { childList: true, subtree: true, characterData: true });
    const sizes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    sizes?.observe(card);
    const moved = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    const stop = () => {
      changes.disconnect();
      sizes?.disconnect();
      window.clearTimeout(timer);
      for (const name of moved) screen.removeEventListener(name, stop);
    };
    const timer = window.setTimeout(stop, 4000);
    for (const name of moved) screen.addEventListener(name, stop, { passive: true });
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupKey, item?.id]);
  const messageKey = kind === "palabras" && termKind && termSlug.length ? termMessageKey(termKind, termSlug.join("/")) : (item?.id ?? "");
  const closesHere = Boolean(data?.step && closesInItsTool(data.step) && ctx?.issueNumber);

  // What this checklist needs done before it: the helps translated and each text aligned. What is missing is said,
  // and its team told, instead of checking against half-done work.
  const missing = useMemo<MissingWork[]>(
    () => (data ? missingWork({ helps: kind, fromSource: data.fromSource, chapter: data.chapter, verses: data.items.map((row) => row.verse), texts: texts.map((resource) => ({ resource, ...data.texts[resource] })) }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, kind, textsKey],
  );
  /** The tasks, among those this one waits for, that work on a resource: whose work a missing piece is. */
  const awaitedFor = (resource: string) => {
    if (!data?.board || !data.task) return [];
    const awaited = (data.task.waitsFor ?? []).flatMap((rule) => (rule.taskId ? data.board!.teams.filter((task) => task.id === rule.taskId) : data.board!.teams.filter((task) => task.phaseId === rule.phaseId)));
    return awaited.filter((task) => task.rules.some((rule) => rule.resource === resource));
  };
  /** The coordinators of the teams whose work a missing piece is. */
  const ownersOf = (resource: string) => [...new Set(awaitedFor(resource).flatMap((task) => coordinatorsOf(data!.levelBook, task.orgTeamName)))];
  /**
   * The article of the note in view reached harmonizing untranslated: the team that translates articles did not
   * finish it. It cannot be checked, and this part of the help waits for it (20 October): the team is told, once per
   * article, and the step stays «waiting for an answer» until it comes.
   */
  /** The helps of the verse in view, in their order: which of them this is, of how many. */
  const helpsOfVerse = useMemo(() => (item && !verseStop ? checkItems.filter((row) => !row.stop && row.verseKey === verseKeyOf(item)).map((row) => row.id) : []), [checkItems, item, verseStop]);
  /** The questions of the step are known once answered for a few other helps: then they are one folded line. */
  // Counted by the answers given, not by the helps they count for: one said of an article counts for sixteen notes.
  const guideKnown = Boolean(item) && new Set(summary.items.flatMap((row) => (row.itemId === item?.id ? [] : rowsShown.map(({ question }) => row.answers[question.id]).filter(Boolean)))).size >= 3 * Math.max(1, rowsShown.length);
  const guideOpen = !guideKnown || rowsShown.some(({ question }) => tally?.answers[question.id]);
  /** The article in view was checked already in this task: what is asked once per article is answered. */
  const articleSeen = rowsShown.some(({ question }) => question.per === "article") && rowsShown.filter(({ question }) => question.per === "article").every(({ question }) => tally?.answers[question.id]);
  const articleInSource = Boolean(!verseStop && aboutArticle && articlePath && academy[articlePath]?.where === "source");
  const articleTitle = articlePath ? academy[articlePath]?.title || localizeAfinacion(categoryLabel(categoryFromSupportRef(item?.supportRef ?? "")), language) : "";
  const articleTask = awaitedFor("academia")[0];
  const articleNote = t("ck.articleUntranslatedNote").replace("{title}", articleTitle);
  const articleToldKey = `taller.ck-article-told.${storeKey}.${articlePath}`;
  const articleTold = (() => {
    if (!articleInSource) return false;
    if (answers.some((row) => row.outcome === "consult" && row.note === articleNote)) return true;
    try {
      return window.localStorage.getItem(articleToldKey) === "1";
    } catch {
      return false;
    }
  })();
  /** Leaves this part of the help waiting for the article, telling its team the first time. */
  async function waitForArticle() {
    if (!item || !pendingHere.length) return;
    await save(pendingHere.map(({ question, answerItemId }) => stamp(answerItemId, question.id, "no", { outcome: "consult", note: articleNote })), t("ck.articleWaiting"));
    if (!articleTold && !trying && session && ctx?.pmOrg && ctx.issueNumber) {
      const who = ownersOf("academia").map((login) => `@${login}`).join(" ");
      await commentOnIssue(session, ctx.pmOrg, ctx.issueNumber, t("ck.articleUntranslatedComment").replace("{who}", who).replace("{title}", articleTitle).replace("{where}", `${data?.book ?? ""} ${item.chapter}:${item.verse}`).trim()).catch(() => undefined);
    }
    try {
      window.localStorage.setItem(articleToldKey, "1");
    } catch {
      /* told all the same */
    }
    setAsked(null);
    nextPending();
  }
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
    if (trying) {
      setAnswers((prev) => {
        const all = [...prev, ...next];
        saveTrialChecks(storeKey, all);
        return all;
      });
      announce(t("ck.tryKept"));
      return;
    }
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

  /**
   * How many of the team have to be for a proposal, its author among them: what the step where the team agrees
   * asks for. And whether the team maintains a resource; what it does not is asked of whoever does.
   */
  const agreement = data?.task?.steps?.find((step) => step.closing === "consensus");
  const needed = agreement ? stepMinAssignees(agreement) : 2;
  const ours = (resource: string) => Boolean(data?.task?.rules.some((rule) => rule.resource === resource));
  const teamOf = (resource: string) => ownerLabel(resource, data?.board, data?.task, language);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const proposals = useMemo(() => proposalsOf(answers, needed, ours), [answers, needed, data?.task]);

  const isMine = (by: string) => by.toLowerCase() === (session?.username ?? "").toLowerCase();
  /** The new versions still to be settled of something, oldest first. */
  const versionsOf = (target: Pick<ProposalTarget, "resource" | "rowId" | "path" | "field">, where: string) =>
    proposals.filter((view) => (view.state === "open" || view.state === "agreed") && Boolean(view.proposal.after) && view.proposal.resource === target.resource && view.proposal.rowId === target.rowId && view.proposal.path === target.path && view.proposal.field === target.field && (Boolean(target.rowId || target.path) || view.proposal.where === where));
  /**
   * The new version still to be settled of something that another starts from: this person's own, the latest, or
   * else the latest of anybody. Over one's own it takes its place: two versions of one note cannot both be written,
   * the second would undo the first. Over somebody else's it goes beside it, and the team chooses: it took its
   * place, and a counterproposal answered with «Hacer otro cambio» hid the version it answered (20 October).
   */
  const priorOf = (target: Pick<ProposalTarget, "resource" | "rowId" | "path" | "field">, where: string) => {
    const all = versionsOf(target, where);
    return [...all].reverse().find((view) => isMine(view.by)) ?? all[all.length - 1];
  };
  const helpKey = item && kind !== "palabras" ? { resource: kind, rowId: item.id, field: kind === "notas" ? "Note" : "Response" } : undefined;
  /** What is proposed for the help in view itself: read with it, since the next group checks the help as it would be. */
  const proposedHelp = helpKey ? priorOf(helpKey, "") : undefined;
  /** Every version proposed for it, when there is more than one: all of them are read, each with whose it is. */
  const helpVersions = helpKey ? versionsOf(helpKey, "") : [];
  /**
   * The versions proposed for the article of the term in view, each with whose it is. None was shown in this
   * step: the team's proposals for the articles and the answers to them were seen only in «Acuerdo del equipo»
   * (20 October).
   */
  const termVersions = kind === "palabras" && slug && termKind ? versionsOf({ resource: "palabras", path: termArticlePath(termKind as TermKind, slug) }, "") : [];

  /** The id a note proposed as new would have, the same while its sheet is open: none of the notes of the unit has it. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const newRowId = useMemo(() => freshRowId((data?.items ?? []).map((row) => row.id)), [proposing]);

  /** What a proposal about the help in view can be about: the help, its article, and the texts it is checked against. */
  const targets = useMemo<ProposalTarget[]>(() => {
    if (!item || !data) return [];
    const where = `${item.chapter}:${item.verse}`;
    const whose = (resource: string) => (ours(resource) ? {} : { team: teamOf(resource) });
    // A note that is missing is proposed as what it is, a new note of that verse, written out: it could only be
    // said to be missing, and the editor the list sent people to has no way to add one.
    // The words it is about are marked in the first text, when that verse is aligned: the words of the original
    // under them are what a note quotes.
    const first = data.texts[texts[0]!];
    const markable = Boolean(data.original) && !data.fromSource && verseIsAligned(first?.alignments, item.chapter, item.verse) ? tokenizeVersePlainText(first?.verses[item.verse] ?? "") : [];
    // Which of those words go together in a quote: those tied to the same words of the original.
    const sid = Object.keys(first?.alignments ?? {}).find((key) => verseFromSid(key, item.chapter) === item.verse);
    const units = markable.length ? quoteUnits(markable, sid ? first!.alignments![sid]! : []) : [];
    // The words a quote is, in that text: what each half of a note parted in two starts from. Over a change
    // already proposed for the note, the quotes it gave them: another change is made over that one.
    const quoteAt = (quote: string | undefined, occurrence: number | string | undefined) =>
      markable.length && quote ? (alignedGatewayQuoteForHelpQuote({ verseText: first?.verses[item.verse] ?? "", quote, occurrence: Number(occurrence ?? 1) || 1, alignments: first?.alignments, book: data.book, chapter: item.chapter, verse: item.verse, ...(data.original ? { original: originalTokens(data.original, item.chapter, item.verse) } : {}) }).tokenIndices ?? []) : [];
    const before = proposedHelp?.proposal;
    const quoted = before?.fields?.Quote ? quoteAt(before.fields.Quote, before.fields.Occurrence) : quoteAt(item.quote, item.occurrence);
    const halfQuoted = before?.split?.fields?.Quote ? quoteAt(before.split.fields.Quote, before.split.fields.Occurrence) : quoted;
    const fresh: ProposalTarget[] = kind === "notas" && ours(kind) ? [{ id: "new", label: t("pr.targetNewNote").replace("{ref}", where), resource: kind, rowId: newRowId, field: "Note", text: "", format: "note" as const, add: true, ...(markable.length ? { words: markable, units } : {}) }] : [];
    const help: ProposalTarget[] = proposing?.onlyVerse
      ? [...fresh, { id: "verse", label: t("pr.targetVerse").replace("{what}", scopeLabel(kind, data.board?.settings?.resourceNames, language)).replace("{ref}", where), resource: kind, commentOnly: true, ...whose(kind) }]
      : kind === "notas"
        ? // A note of the team can be parted in two as well: what is taken out of it becomes a new note beside it.
          [{ id: "help", label: t("pr.targetNote"), resource: kind, rowId: item.id, field: "Note", text: item.body, format: "note" as const, ...(ours(kind) ? { split: { rowId: before?.split?.rowId ?? newRowId, ...(markable.length ? { words: markable, units, ...(quoted.length ? { marked: quoted } : {}), ...(halfQuoted.length ? { newMarked: halfQuoted } : {}) } : {}) } } : {}), ...whose(kind) }]
        : kind === "preguntas"
          ? [
              { id: "answer", label: t("pr.targetAnswer"), resource: kind, rowId: item.id, field: "Response", text: item.body, ...whose(kind) },
              { id: "question", label: t("pr.targetQuestion"), resource: kind, rowId: item.id, field: "Question", text: item.title, ...whose(kind) },
            ]
          : [];
    const article: ProposalTarget[] = proposing?.onlyVerse
      ? []
      : articlePath
        ? [{ id: "article", label: t("pr.targetArticle"), resource: "academia", path: `${articlePath}/01.md`, text: academy[articlePath]?.text ?? undefined, format: "markdown" as const, ...whose("academia") }]
        : slug
          ? [{ id: "article", label: t("pr.targetArticle"), resource: kind, path: termArticlePath(termKind as TermKind, slug), text: articles[slug] ?? undefined, format: "markdown" as const, ...whose(kind) }]
          : [];
    const read = texts.map<ProposalTarget>((resource) => ({ id: resource, label: t("pr.targetText").replace("{name}", textLabel(resource)), resource, text: data.texts[resource]?.verses[item.verse], ...whose(resource) }));
    // A step, or a group, that goes over the articles starts from the article.
    // A note that is missing is always one of the things to propose, last of them, and first when that is what
    // the sheet was opened for. It was offered only from the question that asks for it and from «Proponer un
    // cambio», and nobody knew it was there.
    const also = proposing?.onlyVerse ? [] : fresh;
    const offered = [...(onlyLinked || aboutArticle ? [...article, ...help] : [...help, ...article]), ...read];
    return (proposing?.newNote ? [...also, ...offered] : [...offered, ...also]).map((target) => {
      const prior = target.commentOnly ? undefined : priorOf(target, where);
      return prior ? { ...target, start: prior.proposal.after, ...(isMine(prior.by) ? {} : { startBy: prior.by }) } : target;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, data, proposing?.onlyVerse, proposing?.newNote, newRowId, academy, articles, articlePath, slug, textsKey, language, proposals, aboutArticle, proposedHelp]);

  /** The words of the original under the words marked for a new note, and how those read: what the note quotes. */
  function quotedBy(words: string[] | undefined, marked: number[] | undefined): Pick<ProposalPayload, "fields" | "about"> {
    if (!data || !item || !marked?.length || !words) return {};
    const text = data.texts[texts[0]!];
    const sid = Object.keys(text?.alignments ?? {}).find((key) => verseFromSid(key, item.chapter) === item.verse);
    const found = quoteFromSelection({ verseTokens: words, selected: marked, groups: sid ? text!.alignments![sid]! : [], original: originalTokens(data.original ?? "", item.chapter, item.verse) });
    const about = marked.map((index) => words[index]).join(" ");
    return found ? { fields: { Quote: found.quote, Occurrence: String(found.occurrence) }, about } : { about };
  }

  /** The quote of the half of a note that stays, when it is not the one the note has: only then is it written. */
  function keptQuote(found: Pick<ProposalPayload, "fields" | "about">): Pick<ProposalPayload, "fields" | "about"> {
    const same = found.fields?.Quote === item?.quote && Number(found.fields?.Occurrence ?? 1) === (item?.occurrence ?? 1);
    return found.fields && !same ? found : {};
  }

  async function sendProposal(draft: ProposalDraft) {
    if (!proposing || !item || !session) return;
    const payload: ProposalPayload = {
      id: `pr-${uid()}`,
      resource: draft.target.resource,
      where: `${item.chapter}:${item.verse}`,
      ...(draft.target.field ? { field: draft.target.field } : {}),
      ...(draft.target.path ? { path: draft.target.path } : {}),
      ...(draft.target.rowId ? { rowId: draft.target.rowId } : {}),
      ...(draft.target.text !== undefined && !draft.target.add ? { before: draft.target.text } : {}),
      ...(draft.after ? { after: draft.after } : {}),
      ...(draft.target.add ? { add: true as const, ...quotedBy(draft.target.words, draft.marked) } : {}),
      ...(draft.split && draft.target.split ? { split: { rowId: draft.target.split.rowId, after: draft.split.after, ...quotedBy(draft.target.split.words, draft.split.marked) } } : {}),
      // The note that stays may be about other words than before, once part of what it said went to the other.
      ...(draft.split && draft.target.split && draft.keepMarked ? keptQuote(quotedBy(draft.target.split.words, draft.keepMarked)) : {}),
      // It takes the place only of one's own version: written over somebody else's, it goes beside it.
      ...(draft.after && draft.target.start && !draft.target.startBy ? { replaces: priorOf(draft.target, `${item.chapter}:${item.verse}`)?.proposal.id } : {}),
    };
    // The proposal answers each question marked as failing: the first carries it, the others the same one.
    const answered = [{ answerItemId: proposing.answerItemId, questionId: proposing.questionId }, ...(proposing.others ?? [])].map((row) => {
      const base = stamp(row.answerItemId, row.questionId, "no");
      return proposalAnswer({ itemId: base.itemId, questionId: base.questionId, by: base.by, at: base.at, reason: draft.reason, proposal: payload, textHash: base.textHash });
    });
    await save(answered, draft.target.team ? t("ck.proposedOther").replace("{team}", draft.target.team) : t("ck.proposed"));
    setProposing(null);
  }

  /** Whoever made a proposal takes it back: its «no» is unanswered again. */
  const withdraw = (proposalId: string) => save([proposalSaying(proposalId, session?.username ?? "", new Date().toISOString(), false)], t("ck.withdrawn"));

  /** The verse of the text a quote is marked in, in words, and the groups of its alignment. */
  const pickVerse = useMemo(() => {
    const text = data && item ? data.texts[texts[0]!] : undefined;
    if (!text || !item) return null;
    const sid = Object.keys(text.alignments ?? {}).find((key) => verseFromSid(key, item.chapter) === item.verse);
    const tokens = tokenizeVersePlainText(text.verses[item.verse] ?? "");
    const groups = sid ? text.alignments![sid]! : [];
    return { tokens, groups, units: quoteUnits(tokens, groups) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, item?.id, textsKey]);
  /** The quote the words marked would be, said while they are marked: what is saved is seen before. */
  const pickedQuote = picking?.length && pickVerse && data && item ? quoteFromSelection({ verseTokens: pickVerse.tokens, selected: picking, groups: pickVerse.groups, original: originalTokens(data.original ?? "", item.chapter, item.verse) }) : null;

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
    if (trying) {
      setData({ ...data, items: data.items.map((row) => (row.id === item.id ? { ...row, quote: found.quote, occurrence: found.occurrence } : row)) });
      setPicking(null);
      announce(t("ck.tryKept"));
      return;
    }
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
      // On to what follows, as the other tools do: the next list of the same task when it is this person's, or
      // their tasks. The screen stayed on a list with every answer given, «Paso cerrado», and nothing to press.
      await goOnAfterStep(session, ctx, onClose);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setSaving(false);
    }
  }

  const jump = (itemId: string) => {
    const at = checkItems.findIndex((row) => row.id === itemId);
    if (at >= 0) setPosition(at);
  };

  const nextPending = () => {
    if (!data) return;
    // What this help has left, in another group, comes before the next help.
    if (pendingElsewhere) return setAsked(null);
    const order = [...checkItems.slice(position + 1), ...checkItems.slice(0, position + 1)];
    const found = order.find((row) => summary.items.find((s) => s.itemId === row.id)?.state !== "ok");
    if (found) jump(found.id);
  };
  /**
   * Nothing wrong in what is asked of the help in view: every question on screen still to be answered is «yes»,
   * and on to its next group, or to the next help. It was a touch for each question: 1,274 answers in one task of
   * the run, nearly all of them «yes».
   */
  const allGood = () => {
    if (!data || !item) return;
    if (pendingHere.length) void save(pendingHere.map(({ question, answerItemId }) => stamp(answerItemId, question.id, "yes")), t("ck.saved"));
    setAsked(null);
    if (pendingElsewhere) return;
    const order = [...checkItems.slice(position + 1), ...checkItems.slice(0, position)];
    const found = order.find((row) => summary.items.find((s) => s.itemId === row.id)?.state !== "ok");
    if (found) jump(found.id);
  };
  const labelOf = (itemId: string) => {
    const stop = checkItems.find((row) => row.id === itemId && row.stop);
    if (stop) return `${stop.verseKey} · ${t("ck.kindVerse")}`;
    const found = data?.items.find((row) => row.id === itemId);
    return found ? `${found.chapter}:${found.verse}${found.title ? ` · ${found.title}` : ""}` : itemId;
  };

  const stepName = data?.step ? localized(data.step.name, data.step.names, language) : t("ck.title");
  useEffect(() => setChoosing(false), [item?.id, group?.about]);
  useEffect(() => setFailing([]), [choosing, item?.id, group?.about]);
  /**
   * The proposal for what was marked as failing: one, answering every question marked (20 October). It was one
   * question at a time, chosen from a list of buttons, when a note can fail two or three of them at once.
   */
  const proposeFailing = () => {
    if (!item) return;
    const rows = rowsShown.filter(({ question }) => failing.includes(question.id));
    setChoosing(false);
    if (!rows.length) return setProposing({ answerItemId: verseStop?.id ?? item.id, questionId: PROPOSAL_FREE, reason: "" });
    if (grouped) setAsked({ itemId: item.id, about: group?.about ?? "" });
    const [first, ...rest] = rows;
    setProposing({
      answerItemId: first!.answerItemId,
      questionId: first!.question.id,
      reason: rows.map(({ question }) => localized(question.text, question.texts, language)).join(" · "),
      onlyVerse: rows.every(({ question }) => question.per === "verse"),
      others: rest.map(({ question, answerItemId }) => ({ answerItemId, questionId: question.id })),
    });
  };
  /**
   * What the step in view asks, said once as its heading and once as the question over the answer: «Comprueba la
   * nota frente al TPL», «¿Está bien la nota frente al TPL?». The screen said «Ester 1:1» and a list of questions,
   * each to be ticked or refused, and what was being checked against what was left to work out (19 October).
   */
  const what = t(kind === "notas" ? "ck.whatNote" : kind === "preguntas" ? "ck.whatQuestion" : "ck.whatTerm");
  const against = grouped && !aboutArticle && group?.about ? textLabel(group.about as ChecklistText) : "";
  const stepWords = (plain: MessageKey, withText: MessageKey, ofArticle: MessageKey) => {
    const said = (aboutArticle ? t(ofArticle) : against ? t(withText).replace("{text}", against) : t(plain)).replace("{what}", what);
    // «A nota está bem…?»: a sentence that starts with what is checked takes its capital, after any «¿».
    return said.replace(/^(¿?)(\p{Ll})/u, (_, mark: string, first: string) => mark + first.toUpperCase());
  };
  /** What a verse's helps are called, in the plural. */
  const whats = t(kind === "notas" ? "ck.whatsNote" : kind === "preguntas" ? "ck.whatsQuestion" : "ck.whatsTerm");
  const heading = verseStop ? t("ck.verseHead").replace("{whats}", whats) : stepWords("ck.head", "ck.headAgainst", "ck.headArticle");
  const asking = verseStop ? t("ck.verseAsk") : stepWords("ck.ask", "ck.askAgainst", "ck.askArticle");
  /** The texts the chapter is read in: those of the step, as loaded, and the original when there is one. */
  const chapterTexts = useMemo<{ key: string; text: ChapterText }[]>(() => {
    if (!chapterOpen || !data) return [];
    const own = texts.flatMap((resource, index) => {
      const verses = data.texts[resource]?.verses;
      if (!verses) return [];
      const book = Object.fromEntries(Object.entries(verses).map(([verse, body]) => [`${data.chapter}:${verse}`, body]));
      return [{ key: resource as string, text: { id: index === 0 ? ("draft" as const) : ("other" as const), label: textLabel(resource), book } }];
    });
    let orig: { key: string; text: ChapterText }[] = [];
    try {
      orig = data.original ? [{ key: "orig", text: chapterTextOf("orig", t("af.tabOriginal"), data.original) }] : [];
    } catch {
      /* an original that cannot be read: the chapter is read in the texts of the step */
    }
    return [...orig, ...own];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterOpen, data, textsKey, language]);

  /** The words of the first text the note in view quotes, when they are found there through the alignment. */
  const noteQuote = useMemo(() => {
    if (kind !== "notas" || !item?.quote || verseStop || !data) return "";
    const first = data.texts[texts[0]!];
    const verse = first?.verses[item.verse] ?? "";
    if (!verse) return "";
    return alignedGatewayQuoteForHelpQuote({ verseText: verse, quote: item.quote, occurrence: item.occurrence ?? 1, alignments: first?.alignments, book: data.book, chapter: item.chapter, verse: item.verse, ...(data.original ? { original: originalTokens(data.original, item.chapter, item.verse) } : {}) }).gatewayText ?? "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, item?.id, item?.quote, item?.occurrence, verseStop, data, textsKey]);

  /** The helps of the verse whose stop is in view, in their order. */
  const verseHelps = verseStop && data ? data.items.filter((row) => verseKeyOf(row) === verseStop.verseKey) : [];

  /** The help in view as it reads (or as a change proposed for it would make it read). */
  const helpRead = item ? (
    <>
    {item.title ? (
      // The code of a term («Jesus») was shown until its name came, and then changed under the eyes.
      <h2 className="af-phrase" aria-busy={kind === "palabras" && !titlesRead ? true : undefined}>
        {kind !== "palabras" ? item.title : titlesRead ? termLabel(item.title, termTitles) : "\u00a0"}
      </h2>
    ) : null}
    {termVersions.length ? (
      <section className="ck-versions" aria-label={t(termVersions.length > 1 ? "ck.versionsLead" : "ck.versionOne").replace("{n}", String(termVersions.length))}>
        <p className="ck-versions__lead">{t(termVersions.length > 1 ? "ck.versionsLead" : "ck.versionOne").replace("{n}", String(termVersions.length))}</p>
        {termVersions.map((view) => (
          <div key={view.proposal.id} className="ck-version">
            <b className="ck-proposed__label">{isMine(view.by) ? t("ag.optMine") : t("ag.optBy").replace("{who}", view.by)}</b>
            {/* An article is pages long: what each version changes in it, a touch away, a few words around each change. */}
            <details className="ck-version__fold">
              <summary>{t("ag.showChange")}</summary>
              <span className="ag-diff ck-version__text">
                <ProposalDiff before={view.proposal.before ?? articles[slug] ?? ""} after={view.proposal.after ?? ""} plain />
              </span>
            </details>
          </div>
        ))}
      </section>
    ) : null}
    {helpVersions.length > 1 ? (
      // Two people proposed a version of it (a counterproposal answers a proposal): the help as it is, and each
      // version with whose it is, to be chosen in «Acuerdo del equipo». Only the latest was read here, as «Con el
      // cambio propuesto» and with no name, and the version it answered was nowhere on this screen (20 October).
      <>
        <HelpMarkdownView className="af-note af-note--md" content={item.body} />
        <section className="ck-versions" aria-label={t("ck.versionsLead").replace("{n}", String(helpVersions.length))}>
          <p className="ck-versions__lead">{t("ck.versionsLead").replace("{n}", String(helpVersions.length))}</p>
          {helpVersions.map((view) => (
            <div key={view.proposal.id} className="ck-version">
              <b className="ck-proposed__label">{isMine(view.by) ? t("ag.optMine") : t("ag.optBy").replace("{who}", view.by)}</b>
              {view.proposal.split ? (
                <span className="ck-version__text">
                  {readable(view.proposal.after ?? "")}
                  <span className="ck-proposed__split">
                    <b className="ck-proposed__label">{t("ag.splitNew")}</b> {readable(view.proposal.split.after)}
                  </span>
                </span>
              ) : (
                <span className="ag-diff ck-version__text">
                  <ProposalDiff before={item.body} after={view.proposal.after ?? ""} whole plain />
                </span>
              )}
            </div>
          ))}
        </section>
      </>
    ) : proposedHelp ? (
      // With a change proposed for it, the help is read as it would be, what goes out struck and what comes
      // in marked: the steps that follow check that version. It was shown under the help as well, a third
      // time counting the one under its question, and the help no longer fitted over its questions.
      <p className="af-note ck-proposed">
        <b className="ck-proposed__label">{isMine(proposedHelp.by) ? t("ck.proposedHere") : t("ck.proposedBy").replace("{who}", proposedHelp.by)}</b>{" "}
        {proposedHelp.proposal.split ? (
          // Parted in two, each note is read as it would be. Struck out in the first, what goes to the
          // second was read twice, and a note of five lines took fourteen over its questions.
          <>
            {readable(proposedHelp.proposal.after ?? "")}
            <span className="ck-proposed__split">
              <b className="ck-proposed__label">{t("ag.splitNew")}</b> {readable(proposedHelp.proposal.split.after)}
            </span>
          </>
        ) : (
          <span className="ag-diff">
            <ProposalDiff before={proposedHelp.proposal.before ?? item.body} after={proposedHelp.proposal.after ?? ""} whole plain />
          </span>
        )}
      </p>
    ) : null}
    {proposedHelp && !stepDone ? (
      // Another change once one is proposed: it was there only as «Hay algo que cambiar», asking again which
      // question failed, and nobody looked for it there (20 October). It is made over the change proposed, and
      // takes its place: two versions of one note cannot both be written, the second would undo the first.
      <button type="button" className="af-link ck-proposed__more" disabled={saving} onClick={() => setProposing({ answerItemId: item.id, questionId: PROPOSAL_FREE, reason: "" })}>
        <Pencil size={16} aria-hidden /> {t(isMine(proposedHelp.by) ? "ck.changeMore" : "ck.otherVersion")}
      </button>
    ) : null}
    {!proposedHelp && item.body ? (
      <>
        {kind === "preguntas" ? <p className="af-lbl">{t("ck.answerLbl")}</p> : null}
        <HelpMarkdownView className={kind === "preguntas" ? "af-note af-note--md ck-answer" : "af-note af-note--md"} content={item.body} />
      </>
    ) : null}
    </>
  ) : null;

  return (
    <div className="af ck">
      <ToolHeader
        title={toolHeading(ctx, language, stepName).title}
        onBack={onClose}
        meta={toolHeading(ctx, language, stepName).where}
      >
        {data ? (
          <div className="af-progress" aria-label={t("ck.progressAria")}>
            <span>{t("ck.nChecked").replace("{a}", String(summary.done)).replace("{n}", String(checkItems.length))}</span>
            <span className="af-bar">
              <i style={{ width: `${checkItems.length ? (summary.done / checkItems.length) * 100 : 0}%` }} />
            </span>
          </div>
        ) : null}
      </ToolHeader>
      <div className="step-ask-bar">
        <StepAsk session={session} ctx={ctx} />
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {busy ? <LoadingState shape="tool" label={t("af.loading")} /> : null}
      {trying ? (
        <p className="ck-trying" role="status">
          {t("ck.trying")}
        </p>
      ) : null}
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
            // Opened again once closed: there is nothing left to do here, and the way out is said.
            <div className="round__done round__done--leave">
              <p>{t("ck.stepClosed")}</p>
              <Button type="button" size="lg" variant="outline" onClick={onClose}>
                {t("fa.back")}
              </Button>
            </div>
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
                          {Object.values(row.answers).some((a) => replyTo(a)) ? <b> · {t("ck.repliedShort")}</b> : null}
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
          {/* The point's row, as in afinación (19 October): what it is, where, and the way to the next. The count
              was at the foot, in a second bar over the answers. */}
          <div className="af-head ck-head">
            {/* Which help of its verse, of how many: going on to the next note of a verse of eight, the screen was
                the same and only the words of the note changed (20 October). The state chip and a second count
                («1 de 162», beside «0 de 162 comprobados» over it) are gone: three counters, and none of them this. */}
            <p className="af-kind af-kind--top ck-where">
              {/* The book is in the header: said here too, it pushed the kind and the verse out of a phone's row. */}
              {verseStop
                ? `${t("ck.kindVerse")} · ${item.chapter}:${item.verse}`
                : (helpsOfVerse.length > 1 ? t("ck.whereOf").replace("{a}", String(helpsOfVerse.indexOf(item.id) + 1)).replace("{b}", String(helpsOfVerse.length)) : "{kind}")
                    .replace("{kind}", t(kind === "notas" ? "ck.kindNote" : kind === "preguntas" ? "ck.kindQuestion" : "ck.kindTerm"))
                    .concat(` · ${item.chapter}:${item.verse}${item.verseTo ? `–${item.verseTo}` : ""}`)}
            </p>
            <span className="af-step ck-arrows">
              <button type="button" className="th-icon" aria-label={t("af.prev")} title={t("af.prev")} disabled={position <= 0} onClick={() => setPosition((p) => Math.max(0, p - 1))}>
                <ChevronLeft size={20} aria-hidden />
              </button>
              <button type="button" className="th-icon" aria-label={t("af.next")} title={t("af.next")} disabled={position >= checkItems.length - 1} onClick={() => setPosition((p) => p + 1)}>
                <ChevronRight size={20} aria-hidden />
              </button>
            </span>
          </div>
          {grouped ? (
            // The steps of the help, before what each puts on screen: under the note and its messages they were
            // found after the texts they choose (19 October). Numbered and joined by a line; each says how it stands.
            <ol className="ck-steps ck-steps--top" aria-label={t("ck.stepsAria")}>
              {groups.map((row, index) => {
                const said = row.rows.map(({ question }) => markOf(tally?.answers[question.id]));
                // A «no» with nothing done about it shows at once; a step is ticked, or marked as bringing a
                // change, once all of it is answered.
                const state: Mark = said.includes("no") ? "no" : said.includes("wait") ? "wait" : said.includes("none") ? "none" : said.includes("change") ? "change" : "yes";
                return (
                  <li key={row.about} data-state={state}>
                    <button type="button" aria-current={row === group ? "step" : undefined} onClick={() => setAsked({ itemId: item.id, about: row.about })}>
                      <span className="ck-steps__n">{state === "yes" ? <Check size={14} aria-hidden /> : state === "no" ? <X size={14} aria-hidden /> : state === "change" ? <Pencil size={13} aria-hidden /> : state === "wait" ? <Clock3 size={13} aria-hidden /> : index + 1}</span>
                      <span className="ck-steps__name">{scopeLabel(row.about, data.board?.settings?.resourceNames, language)}</span>
                      {state === "wait" ? <span className="sr-only">{t("ck.stepWaiting")}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : null}
          <h2 className="af-heading ck-heading">{heading}</h2>
          {/* What is checked in this step, under its heading and before what it is checked on: it is what the step is
              for, and at the foot of the card, in small grey lines, it read as something secondary (20 October). It
              is answered once, at the foot of the screen; what was said of a line is shown on it. */}
          {/* Open while its questions are new (the first notes of a step), and whenever something was said of one of
              them here; folded to one line after: the same three questions for 141 notes pushed the note under the
              bar of a phone, and «Sí, seguir» could be touched without the note seen (20 October). */}
          <details key={`${item.id}|${group?.about ?? ""}`} className="ck-guide" open={guideOpen}>
            <summary className="ck-guide__lead" id="ck-guide-title">
              <span>{t("ck.lookAt")}</span>
              <span className="ck-guide__n">{t("ck.lookAtN").replace("{n}", String(rowsShown.length))}</span>
              <ChevronDown size={18} aria-hidden className="ck-guide__chev" />
            </summary>
        <ul className="ck-checks ck-checks--guide" ref={checksRef}>
          {rowsShown.map(({ question }) => {
            const answer = tally?.answers[question.id];
            const proposal = answer?.outcome === "proposal" ? proposals.find((view) => view.proposal.id === answer.proposal?.id) : undefined;
            const name = localized(question.text, question.texts, language);
            return (
              <li key={question.id} data-state={markOf(answer)}>
                <span className="ck-check ck-check--read">
                  <span className="ck-check__mark" aria-hidden="true">
                    {markOf(answer) === "yes" ? <Check size={16} /> : markOf(answer) === "no" ? <X size={16} /> : markOf(answer) === "change" ? <Pencil size={14} /> : <Circle size={6} />}
                  </span>
                  <span className="ck-check__text">
                    {name}
                    {question.per === "verse" && !verseStop ? <span className="ck-question__scope"> {t("ck.perVerse")}</span> : null}
                  </span>
                  <span className="sr-only">{t(markOf(answer) === "yes" ? "ck.yes" : markOf(answer) === "change" ? "ck.withChange" : markOf(answer) === "no" ? "ck.no" : "ck.notYet")}</span>
                </span>
                {answer?.value === "no" ? (
                  <div className="ck-question__outcome" data-outcome={answer.outcome ?? "none"}>
                    {proposal ? (
                      <>
                        <b>{t(PROPOSAL_STATE_KEY[proposal.state]).replace("{team}", teamOf(proposal.proposal.resource))}</b>
                        {proposal.proposal.id === proposedHelp?.proposal.id ? null : (
                          // What is proposed for the help itself is read in the help, above: here, what is about something else.
                          <span className="ag-diff">
                            <b>{proposal.proposal.add ? t("ag.newNote") : scopeLabel(proposal.proposal.resource, data.board?.settings?.resourceNames, language)}:</b> {proposal.proposal.after ? <ProposalDiff before={proposal.proposal.before ?? ""} after={proposal.proposal.after} plain /> : excerpt(proposal.reason)}
                          </span>
                        )}
                        {proposal.state === "open" && proposal.by.toLowerCase() === (session?.username ?? "").toLowerCase() && !stepDone ? (
                          <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void withdraw(proposal.proposal.id)}>
                            {t("ck.withdraw")}
                          </Button>
                        ) : null}
                      </>
                    ) : (
                      <>
                        {/* Waiting for an article to be translated is said as that, not as a change asked for. */}
                        {answer.outcome === "consult" && answer.note === articleNote ? t("ck.articleWaitingShort") : answer.outcome ? t(OUTCOME_KEY[answer.outcome]) : t("ck.noOutcome")}
                        {answer.note && answer.note !== articleNote ? `: ${answer.note}` : ""}
                        {replyTo(answer) ? (
                          <span className="ck-question__reply">
                            {t("ck.replied").replace("{who}", replyTo(answer)!.by)} «{replyTo(answer)!.text}»
                          </span>
                        ) : null}
                        {answer.outcome === "consult" && !answer.resolved ? (
                          <Button type="button" size="sm" variant={replyTo(answer) ? "default" : "outline"} disabled={saving} onClick={() => void save([{ ...answer, resolved: true, by: session?.username ?? "", at: new Date().toISOString() }], t("ck.saved"))}>
                            {t("ck.answered")}
                          </Button>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
          </details>

          {!verseStop && !aboutArticle ? (
            // The help first, under the heading: what is checked, and then what it is checked against. A question and
            // its answer were (19 October); a note was under its texts, and on a phone under the bar (20 October).
            <section className="af-card ck-first" aria-label={t("ck.itemAria")}>
              {/* What the note is about, as the first text says it, over the note in its card (Abel, 21 October): read
                  first, it says what the note explains before the note is read. */}
              {noteQuote ? (
                <p className="ck-note-quote">
                  <span className="ck-chip">{t("ck.noteChip")} · {bookLabel(data.book, language)} {item.chapter}:{item.verse}</span> <span className="ck-note-quote__words">«{noteQuote}»</span>
                </p>
              ) : null}
              {helpRead}
            </section>
          ) : null}
          {/* In the article's step its texts are hidden: the box stayed, empty, over the note (20 October). */}
          {aboutArticle ? null : (
          <section className="af-dock" aria-label={t("ck.textsAria")}>
            {textsShown.map((resource) => {
              const text = data.texts[resource];
              // A question about verses 22 and 23 is checked against both: with the first alone, «¿se puede
              // responder con los textos?» had no honest answer.
              const verse = item.verseTo
                ? Array.from({ length: item.verseTo - item.verse + 1 }, (_, i) => text?.verses[item.verse + i] ?? "").filter(Boolean).join(" ")
                : (text?.verses[item.verse] ?? "");
              // The item's quote is in the original language: its words in this text come from the alignment.
              const hit = item.quote && verse ? alignedGatewayQuoteForHelpQuote({ verseText: verse, quote: item.quote, occurrence: item.occurrence ?? 1, alignments: text?.alignments, book: data.book, chapter: item.chapter, verse: item.verse, ...(data.original ? { original: originalTokens(data.original, item.chapter, item.verse) } : {}) }) : null;
              return (
                <div key={resource} className="af-row">
                  {/* Named as the draft is in afinación, «TPL» in its tag. */}
                  {/* The verse it is, in its label: with the note's, which verse each card is of is read at once. */}
                  <span className="af-res ck-res">
                    {textLabel(resource)} · {bookLabel(data.book, language)} {item.chapter}:{item.verse}
                    {item.verseTo ? `–${item.verseTo}` : ""}
                  </span>
                  {verse ? (
                    <Verse
                      text={verse}
                      marked={verseStop ? [] : canPick(resource) && picking ? picking : hit?.tokenIndices ?? []}
                      // A word goes with every word tied to the same words of the original: a quote is in the
                      // original, and «los» of «en los días de» alone is no quote (20 October).
                      onToggle={!verseStop && canPick(resource) && picking ? (index) => setPicking(toggleQuoteWord(picking, index, pickVerse?.units ?? [])) : undefined}
                      loose={!verseStop && canPick(resource) && picking && pickVerse?.units.some(Boolean) ? (index) => !pickVerse.units[index] : undefined}
                    />
                  ) : (
                    <span className="af-hint">{t("ck.noText").replace("{text}", textLabel(resource))}</span>
                  )}
                  {/* What the note quotes is seen highlighted: said in words only when it is not found in the text. */}
                  {!verseStop && item.quote && verse && !hit?.gatewayText ? (
                    <span className="ck-quote" data-found={hit?.gatewayText ? "true" : "false"}>
                      {hit?.gatewayText ? t("ck.quoteIs").replace("{quote}", hit.gatewayText) : t("ck.quoteMissing").replace("{text}", textLabel(resource))}
                    </span>
                  ) : null}
                  {verse && !picking ? (
                    // What else can be done with the text, in one row at its foot, as in afinación.
                    <span className="af-draft__acts ck-expand">
                      {canPick(resource) && !stepDone && !verseStop && verseIsAligned(data.texts[resource]?.alignments, item.chapter, item.verse) ? (
                        // A quiet link at the foot of the text: as a button it read as one of the answers.
                        <button type="button" className="af-link ck-quote-fix" onClick={() => setPicking(wholeQuoteWords(hit?.tokenIndices ?? [], pickVerse?.units ?? []))}>
                          {t("ck.quoteFix")}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="af-link"
                        aria-label={t("ck.expandAria")}
                        onClick={() => {
                          setPairShown(textsShown.filter((id) => data.texts[id]));
                          setChapterOpen(true);
                        }}
                      >
                        <Maximize2 size={14} aria-hidden /> {t("af.expand")}
                      </button>
                    </span>
                  ) : null}
                  {verseStop ? null : canPick(resource) && verse && !stepDone && !verseIsAligned(data.texts[resource]?.alignments, item.chapter, item.verse) ? (
                    <span className="af-hint">{t("ck.quoteNeedsAlignment")}</span>
                  ) : canPick(resource) && verse && !stepDone ? (
                    picking ? (
                      <span className="af-buttons">
                        <span className="af-hint">{t("ck.quotePickHint")}</span>
                        {/* What would be saved, in the original, as it is marked. */}
                        {pickedQuote ? (
                          <span className="ck-quote-preview">
                            {t("ck.quotePreview")}{" "}
                            <span className="ck-quote-preview__orig" lang={/[\u0590-\u05FF]/.test(pickedQuote.quote) ? "hbo" : "grc"} dir="auto">
                              {pickedQuote.quote}
                            </span>
                          </span>
                        ) : null}
                        <Button type="button" size="sm" disabled={closing || !picking.length} onClick={() => void saveQuote(resource)}>
                          {t("ck.quoteSave")}
                        </Button>
                        <Button type="button" size="sm" variant="secondary" disabled={closing} onClick={() => setPicking(null)}>
                          {t("af.cancel")}
                        </Button>
                      </span>
                    ) : null
                  ) : null}
                </div>
              );
            })}
          </section>
          )}

          <section className="af-card" aria-label={t("ck.itemAria")}>
            {verseStop ? (
              // Every help of the verse, each with what it resolves (its kind of difficulty) and not only the words
              // it quotes, and a touch away: whether a difficulty is left without one is read here (20 October).
              <div className="ck-vh">
                <p className="ck-guide__lead">{t("ck.verseHelps").replace("{whats}", whats).replace("{n}", String(verseHelps.length))}</p>
                <ul className="ck-vh__list">
                  {verseHelps.map((row) => {
                    const first = data.texts[texts[0]!];
                    const words = row.quote && first?.verses[row.verse] ? alignedGatewayQuoteForHelpQuote({ verseText: first.verses[row.verse]!, quote: row.quote, occurrence: row.occurrence ?? 1, alignments: first.alignments, book: data.book, chapter: row.chapter, verse: row.verse, ...(data.original ? { original: originalTokens(data.original, row.chapter, row.verse) } : {}) }).gatewayText : "";
                    const what = kind === "notas" ? localizeAfinacion(categoryLabel(categoryFromSupportRef(row.supportRef ?? "")), language) : kind === "palabras" ? (titlesRead ? termLabel(row.title, termTitles) : "") : "";
                    const state = summary.items.find((one) => one.itemId === row.id)?.state;
                    return (
                      <li key={row.id}>
                        <button type="button" className="ck-vh__one" data-state={state} onClick={() => jump(row.id)}>
                          <span className="ck-vh__words">{kind === "preguntas" ? row.title : words ? `«${words}»` : row.title || row.quote}</span>
                          {what ? <span className="ck-vh__what">{what}</span> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <>
            {/* In the article's step the note is what the article is checked for: named, as context. */}
            {aboutArticle && !articleInSource ? <span className="ck-chip">{t("ck.noteChip")}</span> : null}
            {aboutArticle ? helpRead : null}
            {slug ? articles[slug] === undefined ? <p className="af-hint">{t("ur.readingArticle")}</p> : articles[slug] === null ? <p className="af-hint">{t("ur.noArticle")}</p> : <HelpMarkdownView className="ur-md ur-article ck-article" content={articleBody(articles[slug]!)} /> : null}
            {/* A term is already named by its title above: the path of its article says nothing to who checks it. */}
            {articleInSource ? (
              <p className="ck-untranslated">
                <Info size={16} aria-hidden />{" "}
                <span>{articleTask ? t("ck.articleUntranslatedBy").replace("{task}", localized(articleTask.name, articleTask.names, language)) : t("ck.articleUntranslated")}</span>
              </p>
            ) : null}
            {aboutArticle && !articleInSource && articlePath && articleSeen && academy[articlePath]?.text ? (
              // Read and checked already in this task (whether it is published is asked once per article): a line, and
              // the article a touch away. It was read whole again for each of the sixteen notes that link it.
              <details className="ck-read ck-article-seen">
                <summary>{t("ck.articleSeen").replace("{title}", articleTitle)}</summary>
                <HelpMarkdownView className="ur-md ur-article ck-article" content={academy[articlePath]!.text!} />
              </details>
            ) : aboutArticle && !articleInSource && articlePath ? (
              // What is checked in this step, read as in afinación (20 October): named «Artículo», «Borrador» while it
              // is one, the source's beside it to compare, its title, and all of it at the size of reading. It was a
              // fold under the note, in small print, in a box of its own 150 px high. Read whole here, the suggestions
              // of translation too: the translated article is what is checked.
              academy[articlePath] === undefined ? (
                <p className="af-hint">{t("ur.readingArticle")}</p>
              ) : academy[articlePath]?.text ? (
                <section className="ck-article-step" aria-label={articleTitle}>
                  <HelpVersions
                    label={<span className="ck-chip">{t("ck.articleChip")}</span>}
                    team={academy[articlePath]!.where === "draft" || academy[articlePath]!.where === "published" ? { text: academy[articlePath]!.text!, draft: academy[articlePath]!.where === "draft" } : null}
                    source={academySource[articlePath] ?? ""}
                    teamLang={ctx?.lang ?? ""}
                    sourceLang={sourcePackageLang(resolveSourcePackage(data.board?.settings))}
                    draftLabel={t("hv.draft")}
                  >
                    {(text, lang) => (
                      <div lang={lang} className="ck-article-read">
                        <h3 className="ck-article-read__title">{articleTitle}</h3>
                        <HelpMarkdownView className="ur-md ck-article-read__body" content={text} />
                      </div>
                    )}
                  </HelpVersions>
                </section>
              ) : (
                <p className="af-hint">{t("ur.noArticle")}</p>
              )
            ) : grouped && !aboutArticle ? null : articlePath ? (
              // Closed until asked for: an article is several screens long, and the questions come after it.
              <details key={`${item.id}|${aboutArticle}|${articleInSource}`} className="ck-read" open={aboutArticle && !articleInSource}>
                <summary>{articleInSource ? t("ck.articleSourceSummary").replace("{title}", articleTitle) : t("ck.support").replace("{ref}", articleTitle)}</summary>
                {academy[articlePath] === undefined ? (
                  <p className="af-hint">{t("ur.readingArticle")}</p>
                ) : academy[articlePath]?.text ? (
                  <HelpMarkdownView className="ur-md ur-article ck-article" content={academy[articlePath]!.text!} />
                ) : (
                  <p className="af-hint">{t("ur.noArticle")}</p>
                )}
              </details>
            ) : item.supportRef && kind !== "palabras" ? (
              <p className="af-hint">{t("ck.support").replace("{ref}", kind === "notas" ? localizeAfinacion(categoryLabel(categoryFromSupportRef(item.supportRef)), language) : item.supportRef)}</p>
            ) : null}
            {articlePath && academy[articlePath] && !grouped && !articleInSource ? (
              <p className="af-hint ck-read__where" data-where={academy[articlePath]!.where}>
                {t(`ck.article.${academy[articlePath]!.where}` as MessageKey)}
              </p>
            ) : null}
            {session && ctx?.pmOrg && ctx.projectId && data && !aboutArticle ? (
              // What the teams before this one said about this very help: folded under one line with how many, so
              // the help and what is checked of it keep the attention (19 October). Nothing said, no line.
              <HelpMessages key={item.id} session={session} pmOrg={ctx.pmOrg} lang={ctx.lang} projectId={ctx.projectId} book={data.book} chapter={item.chapter} verse={item.verse} about={messageKey} resource={kind} taskName={ctx.taskName} lede={t("hm.ledeRead")} onlyIfAny canAttend folded foldLabel={t("ck.messagesFold")} />
            ) : null}
            {session && ctx?.pmOrg && ctx.projectId && data && articlePath ? (
              // And what they said about the article this note links to, which this team maintains too.
              <HelpMessages key={`ta:${item.id}`} session={session} pmOrg={ctx.pmOrg} lang={ctx.lang} projectId={ctx.projectId} book={data.book} chapter={item.chapter} verse={item.verse} about={articleMessageKey(articlePath)} resource="academia" taskName={ctx.taskName} lede={t("hm.ledeReadArticle")} onlyIfAny canAttend folded foldLabel={t("ck.messagesFoldArticle")} />
            ) : null}

              </>
            )}
          </section>

          {/* One question and its answer, at the foot of the screen: «Sí, seguir» says every line of the step is
              right; «Hay algo que cambiar» asks which, and opens the proposal for it. A note that is missing, or
              something else, is one of the choices: they were a button and a «Proponer un cambio» of their own. */}
          {stepDone ? null : (
            <div className="ck-go" data-on data-choosing={choosing || undefined}>
              {choosing ? (
                <div className="ck-choose" role="group" aria-labelledby="ck-choose-q">
                  <p id="ck-choose-q" className="ck-ask">{t("ck.whatFails")}</p>
                  <p className="ck-choose__hint">{t("ck.markAll")}</p>
                  {[...rowsShown.map(({ question }) => ({ id: question.id, name: localized(question.text, question.texts, language) })), { id: PROPOSAL_FREE, name: t("ck.otherThing") }].map((row) => (
                    <label key={row.id} className="ck-choose__one ck-choose__mark">
                      <input
                        type="checkbox"
                        checked={failing.includes(row.id)}
                        onChange={() => setFailing((prev) => (prev.includes(row.id) ? prev.filter((id) => id !== row.id) : [...prev, row.id]))}
                      />
                      <span>{row.name}</span>
                    </label>
                  ))}
                  <div className="ck-choose__go">
                    <Button type="button" size="lg" disabled={saving || !failing.length} onClick={proposeFailing}>
                      {t("ck.proposeChange")}
                    </Button>
                    <Button type="button" size="lg" variant="ghost" onClick={() => setChoosing(false)}>
                      {t("af.cancel")}
                    </Button>
                  </div>
                  {/* A note that is missing is another kind of proposal: apart, under the choice. */}
                  {kind === "notas" && ours(kind) ? (
                    <button type="button" className="af-link ck-choose__new" disabled={saving} onClick={() => { setChoosing(false); setProposing({ answerItemId: verseStop?.id ?? item.id, questionId: PROPOSAL_FREE, reason: "", newNote: true }); }}>
                      <Plus size={16} aria-hidden /> {t("ck.missingNote").replace("{ref}", `${item.chapter}:${item.verse}`)}
                    </button>
                  ) : null}
                </div>
              ) : (
                articleInSource && pendingHere.length ? (
                <>
                  <p className="ck-ask">{articleTold ? t("ck.articleTold") : t("ck.articleAsk")}</p>
                  <div className="ck-go__buttons">
                    <Button type="button" size="lg" disabled={saving} onClick={() => void waitForArticle()}>
                      {t(articleTold ? "ck.articleWait" : "ck.articleTell")}
                    </Button>
                    <Button type="button" size="lg" variant="outline" disabled={saving} onClick={() => { setAsked(null); nextPending(); }}>
                      {t("ck.articleSkip")}
                    </Button>
                  </div>
                </>
                ) : (
                <>
                  {pendingHere.length ? <p className="ck-ask">{asking}</p> : null}
                  <div className="ck-go__buttons">
                    {pendingHere.length ? (
                      <Button type="button" size="lg" disabled={saving} onClick={allGood}>
                        <Check size={16} aria-hidden /> {t(verseStop ? "ck.verseYes" : pendingHere.length < rowsShown.length ? "ck.restGood" : "ck.yesGo")}
                      </Button>
                    ) : !summary.complete ? (
                      <Button type="button" size="lg" onClick={nextPending}>
                        {t("ck.nextPending")}
                      </Button>
                    ) : closesHere ? (
                      <Button type="button" size="lg" disabled={saving} onClick={() => void closeStep()}>
                        {t("ck.closeStep")}
                      </Button>
                    ) : null}
                    <Button type="button" size="lg" variant="outline" disabled={saving} onClick={() => setChoosing(true)}>
                      {t(verseStop ? "ck.verseMissing" : "ck.somethingWrong")}
                    </Button>
                  </div>
                </>
                )
              )}
            </div>
          )}
        </>
      ) : null}
      <Dialog open={chapterOpen && Boolean(item && data)} onOpenChange={setChapterOpen}>
        <DialogContent className="fix-sheet af-pair-sheet" aria-describedby={undefined}>
          <header className="fx-head">
            {chapterOpen && data ? (
              <div className="af-ref__bar af-pair-bar">
                {/* Each text is touched to add it or take it away; one is always read. */}
                <div className="af-ref__texts" role="group" aria-label={t("cr.sideLabel")}>
                  {chapterTexts.map((row) => {
                    const shown = pairShown.includes(row.key);
                    return (
                      <button key={row.key} type="button" aria-pressed={shown} disabled={shown && pairShown.length <= 1} onClick={() => setPairShown(shown ? pairShown.filter((id) => id !== row.key) : chapterTexts.map((other) => other.key).filter((id) => id === row.key || pairShown.includes(id)))}>
                        {row.text.label}
                      </button>
                    );
                  })}
                </div>
                <MoreMenu items={[]} bare />
              </div>
            ) : null}
          </header>
          <div className="fx-body af-pair-sheet__body">
            <DialogTitle className="sr-only">{data && item ? `${bookLabel(data.book, language)} ${item.chapter}` : ""}</DialogTitle>
            {chapterOpen && data && item ? <h3 className="af-pair-title ck-pair-title">{`${bookLabel(data.book, language)} ${item.chapter}`}</h3> : null}
            {chapterOpen && data && item ? (
              <ChapterPair
                chapter={item.chapter}
                verse={item.verse}
                texts={chapterTexts.filter((row) => pairShown.includes(row.key)).map((row) => row.text)}
                renderVerse={(text, key, body) => {
                  // What the help quotes, marked in the verse it is about, in each text of the step.
                  const resource = texts.find((id) => id === chapterTexts.find((row) => row.text === text)?.key);
                  if (key !== `${item.chapter}:${item.verse}` || !resource || !item.quote) return body;
                  const hit = alignedGatewayQuoteForHelpQuote({ verseText: body, quote: item.quote, occurrence: item.occurrence ?? 1, alignments: data.texts[resource]?.alignments, book: data.book, chapter: item.chapter, verse: item.verse, ...(data.original ? { original: originalTokens(data.original, item.chapter, item.verse) } : {}) });
                  return hit.tokenIndices?.length ? <Verse text={body} marked={hit.tokenIndices} /> : body;
                }}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <ProposalSheet
        open={Boolean(proposing)}
        onClose={() => setProposing(null)}
        targets={targets}
        // What the step reads the help against, beside the help: in the TPL's step the note, or the TPL itself, may be
        // what needs the change.
        primary={aboutArticle ? ["article", "help"] : group?.about && texts.includes(group.about as ChecklistText) ? ["help", group.about] : undefined}
        startSplit={proposedHelp?.proposal.split?.after} failed={proposing?.reason || undefined} rule={data?.task ? stepPurpose(data.task.id, data.step ?? undefined, language).criterion : undefined} reason="" book={data?.book} saving={saving} address={helpsAddressOf(ctx?.pmOrg)} onSend={(draft) => void sendProposal(draft)} />
    </div>
  );
}
