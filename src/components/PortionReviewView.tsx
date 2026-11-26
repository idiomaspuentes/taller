import { isOfTeam, Hints, StepAsk, useTextDecisions, useVerseDecisions } from "./StepAsk";
import { readRaw } from "../dcs/afinacionLoad";
import { resolveSourcePackage } from "../domain/sourcePackage";
import { itemChecks, paragraphsFor } from "../domain/stepChecks";
import { activeRules, ruleMadeFrom, ruleText } from "../domain/teamRules";
import { addRuleToTeam, useManagesTeamRules, useTeamRules } from "../useTeamRules";
import { saveGlossaryEntry } from "../dcs/glossaryStore";
import { entryFromSources, filedUnder, groupsOfVerse, newGlossaryId } from "../domain/glossary";
import { glossaryEntrySaved, useGlossaryEntries } from "../useGlossary";
import { CommentAsRule } from "./CommentAsRule";
import { ToolHeader } from "./ToolHeader";
import { ReviewGuide } from "./screenGuides";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { holdAt } from "./pieceMotion";
import type { DcsIssue } from "@ip-lms/dcs-client";
import { Check, MessageSquare } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { loadSession, type GtSession } from "../dcs/auth";
import { loadPmConfig, loadSolversCatalog, setIssueTaskProgress } from "../dcs/issues";
import { DEFAULT_SOLVERS_CATALOG, findSolverApp, resolveSolverForIssue } from "../domain/solvers";
import { loadAssignmentsFromDcs, loadInventoryFromDcs } from "../dcs/persist";
import { commentOnPortionPr, ensurePortionPr, getPmIssue, loadLinkedPull, loadLinkedPullFiles, submitPortionPrApproval } from "../dcs/portionPr";
import type { DcsPull } from "../dcs/pulls";
import { readRepoFile } from "../dcs/repoFile";
import { deleteReviewComment, editProposal, editReviewComment, loadReviewComments, markReviewCommentInGlossary, proposeWords, readReturnedSha, setReviewCommentResolved, type ReviewComment as Comment } from "../dcs/reviewComments";
import { canEditComment, canResolveComment, commentWords, openComments } from "../domain/reviewComments";
import { pieceTextAt, type PieceFile } from "../domain/pieceTextAt";
import { proposalUsed, samePiece, type PieceText, type Proposal } from "../domain/reviewProposals";
import { ProposalMarked } from "./ProposalMarked";
import { ProposalBox, type ProposalDraft } from "./ProposalBox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { StageWindow } from "./StageWindow";
import { door43Person } from "../dcs/door43People";
import { explainError } from "../dcs/userError";
import { bookLabel } from "../domain/books";
import { parsePortionPrMarker, stepNeedsOpenPortionPr, translatorLoginFromHead, type PortionPrMarker } from "../domain/portionPr";
import { englishScriptureKindRef, loadEnglishHelpsForRange, loadEnglishScriptureChapterUsfm, loadNotesForRange, type ReferenceHelpRow } from "../domain/referenceResources";
import { articleItems, changedSince, diffWords, helpRowRef, introItems, pendingParts, refComment, lastPieceToSee, reviewItems, secondRoundFor, wordsKnownFrom, type IntroItem, type ReviewItem } from "../domain/reviewItems";
import { selectTsvRowsForPortion, tsvRowId } from "../domain/helpsDraft";
import { helpsTsvFilename } from "../domain/helpsTarget";
import { parseTsvTable } from "../prep/tsv";
import { DEFAULT_PM_CONFIG } from "../domain/roles";
import { decodeSolverLaunchContext, openSolverApp, type SolverLaunchContext } from "../domain/solverLaunch";
import { approveStep, askForChanges, canApproveStep, canAskForChanges, canChangeReview, canClaimStep, canTakeBack, changeReview, changesPending, claimStep, isEligibleForStep, isStepUnlocked, readersOfMyDraft, reviewedStepId, takeBack, takenBackByAuthor } from "../domain/stepClaim";
import { allStepsDone, getStepRuntime, isStepDone, parseTaskProgressMarker } from "../domain/taskProgress";
import { markThen } from "../domain/returnTo";
import { localized } from "../domain/processes";
import { localizeName } from "../domain/templateNames";
import { localizeThread } from "../domain/threadNames";
import type { TaskStep } from "../domain/types";
import { extractDraftVerses, type VerseTextMap } from "../domain/usfmAst";
import { portionRange, type RefRange } from "../domain/usfmEdit";
import { bookUsfmName } from "../prep/discover";
import { useUiLanguage } from "../i18n/language";
import { tNow, useT } from "../i18n/messages";
import { HelpMarkdownView } from "./HelpMarkdownView";
import { NoteQuote, noteHeading, useHelpSources } from "./HelpSources";
import { noteFromTsv } from "../domain/helpMarkup";
import { ArticleBlocks } from "./ArticleBlocks";
import { usePieces } from "./usePieces";
import { articleFilesOf, introPieceRef, pieceRef, rowsPossible, untranslated, vocabularyOf, type ArticleFile } from "../domain/articleBlocks";
import { knownWords } from "../domain/helpTexts";
import { LoadingState } from "./LoadingState";

type Props = {
  ctxEncoded: string;
  mode: "pair" | "group";
  onClose: () => void;
  announce: (msg: string) => void;
};

type Source = { short: string; verses: VerseTextMap };

/**
 * One box to write a comment in; `Enter` alone makes a new line, so a comment can have several. `focus`: the box was
 * asked for with a touch («Comentar»), and is ready to be written in without another.
 */
/** The box for a comment about the whole passage, among the boxes kept by the screen. */
const GENERAL_BOX = "g:";

function Composer({
  placeholder,
  busy,
  actions,
  focus,
  initial = "",
  cancel,
  text: kept,
  onText,
  box,
}: {
  placeholder: string;
  busy: boolean;
  focus?: boolean;
  /** What the box starts with: the words of a comment being changed. */
  initial?: string;
  /** The way back without saving, when the box was opened to change something. */
  cancel?: { label: string; run: () => void };
  actions: { label: string; primary?: boolean; run: (text: string) => Promise<boolean> }[];
  /** The words, when the screen keeps them: several boxes may be open, and leaving asks while one has words. */
  text?: string;
  onText?: (text: string) => void;
  /** Which box this is, to bring the finger back to it. */
  box?: string;
}) {
  const [own, setOwn] = useState(initial);
  const text = onText ? (kept ?? "") : own;
  const setText = onText ?? setOwn;
  return (
    <div className="rv-composer">
      <textarea className="af-textarea" rows={2} autoFocus={focus} data-box={box} value={text} placeholder={placeholder} aria-label={placeholder} onChange={(e) => setText(e.target.value)} />
      <div className="rv-composer__row">
        {cancel ? (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={cancel.run}>
            {cancel.label}
          </Button>
        ) : null}
        {actions.map((action) => (
          <Button key={action.label} type="button" size="sm" variant={action.primary ? "default" : "outline"} disabled={busy || !text.trim() || (Boolean(initial) && text.trim() === initial.trim())} onClick={() => void action.run(text).then((sent) => sent && !onText && setOwn(""))}>
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * Reviewing a draft: the passage of the subtarea piece by piece (a verse, or a row of a help), in clean text, with
 * what changed marked by words, the sources and the notes next to it, and the comments where they belong. The
 * reviewer takes the review, comments, asks for changes or approves here; nothing of how the draft is kept
 * (files, branches, pull requests) is shown.
 */
export function PortionReviewView({ ctxEncoded, mode, onClose, announce }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const [session, setSession] = useState<GtSession | undefined>(() => loadSession());
  const ctx = useMemo<SolverLaunchContext | null>(() => decodeSolverLaunchContext(ctxEncoded), [ctxEncoded]);
  const range = useMemo<RefRange | null>(() => (ctx ? portionRange(ctx.ref, ctx.chapter) : null), [ctx]);
  const [issue, setIssue] = useState<DcsIssue | null>(null);
  const [steps, setSteps] = useState<TaskStep[]>([]);
  const [stepId, setStepId] = useState(() => decodeSolverLaunchContext(ctxEncoded)?.stepId ?? "");
  const [marker, setMarker] = useState<PortionPrMarker | null>(null);
  const [pull, setPull] = useState<DcsPull | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  /** The English of each note, question or article in review, by the item's key: what its checks are matched against. */
  const [english, setEnglish] = useState<Record<string, string>>({});
  /** The team that does this task: its own rules that are about a word show on the items that have it. */
  const [teamName, setTeamName] = useState("");
  /** The people the plan lists for that task: with the team's own, who may add a rule to it. */
  const [teamMembers, setTeamMembers] = useState<string[]>([]);
  const teamRules = useTeamRules(teamName || undefined);
  const glossary = useGlossaryEntries(session, ctx?.contentOrg, ctx?.lang);
  /** The comments made into a decision of the glossary in this visit. */
  const [decided, setDecided] = useState<string[]>([]);
  const managesRules = useManagesTeamRules(teamName || undefined);
  /** The comment being turned into a rule of the team, and how saving it goes. */
  const [ruling, setRuling] = useState<{ id: string; busy: boolean; failed: "" | "rule" | "glossary" } | null>(null);
  const [notes, setNotes] = useState<ReferenceHelpRow[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  /** An article in review, as the files it reads from (its title, the line under it, its body), each as its author left it. */
  const [articleFiles, setArticleFiles] = useState<(ArticleFile & { text: string })[]>([]);
  /** Whether the source of those files was read: until then it is not known which can be shown piece by piece. */
  const [sourcesRead, setSourcesRead] = useState(false);
  /** Each row of a help as the source package has it, by its id: what its translation is read against. */
  const [sourceRows, setSourceRows] = useState<Record<string, { text: string; secondary?: string }>>({});
  /** Whether those rows were read: until then a row cannot be told translated from corrected. */
  const [sourceRowsRead, setSourceRowsRead] = useState(false);
  /** The introductions (of the book, of the chapter) a draft of notes is reviewed with, each with its source. */
  const [intros, setIntros] = useState<(IntroItem & { source: string })[]>([]);
  const pieces = usePieces((id) => `rv-${id}`);
  const firstOpened = useRef(false);
  /** The place of the piece open among the verses and rows (an article's own pieces are `pieces.active`). */
  const [openItem, setOpenItem] = useState<string | null>(null);
  /** The places that were on the screen at some moment: what the foot counts as read. */
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  /** The places of the pieces on the screen, in reading order: which one is the last. */
  const [readingKeys, setReadingKeys] = useState<string[]>([]);
  /** Touching «Estoy de acuerdo» before the last piece was seen asks first. */
  const [agreeAsk, setAgreeAsk] = useState(false);
  /** After «Pedir cambios»: what happens next, in a short window. */
  const [askedWindow, setAskedWindow] = useState(false);
  /** The names people go by on Door43, by login (lowercase); until one is read, the screen says «@login». */
  const [names, setNames] = useState<Readonly<Record<string, string>>>({});
  /** The draft as the head of the review has it, file by file: what each piece says now (see `pieceTextAt`). */
  const [headFiles, setHeadFiles] = useState<{ filename: string; text: string }[]>([]);
  /** The English file of notes, which the paragraphs of an introduction are counted against. */
  const [sourceTsv, setSourceTsv] = useState("");
  /** The same files as they were when the draft went back to its author (second round); `null`: not read or not readable. */
  const [thenFiles, setThenFiles] = useState<{ filename: string; text: string }[] | null>(null);
  /** The other English text, shown as a support only when it is asked for (as in the editor). */
  const [support, setSupport] = useState(false);
  // Off at the start: the first round reads the text, and marks only where the team already had words (spec 3.5).
  const [showChanges, setShowChanges] = useState(false);
  /**
   * The comment boxes open, each with its words: `v:` and the item's key for a verse or a row, `p:` and the piece's
   * name for a paragraph, `g:` the box about the whole passage (always on screen; here once something is written).
   * Opening one used to close the other, and what was written in it was lost.
   */
  const [boxes, setBoxes] = useState<ReadonlyMap<string, string>>(() => new Map());
  const openBox = (key: string) => setBoxes((now) => (now.has(key) ? now : new Map(now).set(key, "")));
  // Only a box still open: words arriving after it was sent or cancelled do not open it again.
  const setBoxText = (key: string, text: string) => setBoxes((now) => (now.has(key) ? new Map(now).set(key, text) : now));
  const closeBox = (key: string) =>
    setBoxes((now) => {
      const next = new Map(now);
      next.delete(key);
      return next;
    });
  /** The proposals of other words being written, by the same keys as the boxes; `over` is how the piece stood when it was opened. */
  const [proposals, setProposals] = useState<ReadonlyMap<string, ProposalDraft>>(() => new Map());
  /** A proposal that differs from the piece or says why: an untouched, pre-filled one does not count as text. */
  const proposalTouched = (key: string) => {
    const draft = proposals.get(key);
    return Boolean(draft && (draft.why?.trim() || !samePiece(draft.over ?? draft.words, draft.words)));
  };
  const setProposal = (key: string, draft: ProposalDraft) => setProposals((now) => (now.has(key) ? new Map(now).set(key, draft) : now));
  const closeProposal = (key: string) =>
    setProposals((now) => {
      const next = new Map(now);
      next.delete(key);
      return next;
    });
  /** Which of the two boxes of a piece is shown when both have words (the other keeps its text and comes back when chosen). */
  const [shown, setShown] = useState<ReadonlyMap<string, "comment" | "proposal">>(() => new Map());
  const show = (key: string, which: "comment" | "proposal") => setShown((now) => new Map(now).set(key, which));
  /** The pieces where «No del todo…» was touched and the two ways are shown. */
  const [choosing, setChoosing] = useState<ReadonlySet<string>>(() => new Set());
  /** The comment whose «…» sheet is open, by its id. */
  const [menuFor, setMenuFor] = useState(0);
  /** The lists of comments shown whole (by their key); the others show the last two and fold the rest. */
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());
  /** Leaving, approving or asking for changes with words not sent: asked first; the answer settles the promise. */
  const [unsentAsk, setUnsentAsk] = useState<{ answer: (go: boolean) => void; leaving: boolean } | null>(null);
  /** The comment whose words are being changed, by its id. */
  const [editing, setEditing] = useState(0);
  /** A comment about to be taken back, asked first. */
  const [deleting, setDeleting] = useState<Comment | null>(null);
  /** «Cambiar mi revisión» was pressed: asked first, as it takes back approvals. */
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");

  /** `owner`: who wrote the draft, whose word does not close what was said about it. */
  const loadComments = useCallback(async (sess: GtSession, linked: PortionPrMarker, owner?: string) => setComments(await loadReviewComments(sess, linked, owner)), []);

  const load = useCallback(async () => {
    if (!ctx) return void setError(tNow("se.badContext"));
    const sess = loadSession();
    setSession(sess);
    if (!sess?.token) return void setError(tNow("pr.needSession"));
    if (!ctx.issueNumber) return void setError(tNow("pr.noIssue"));
    if (!range) return void setError(tNow("fa.badRef").replace("{ref}", ctx.ref));
    setBusy(true);
    setError("");
    try {
      const [nextIssue, board] = await Promise.all([getPmIssue(sess, ctx.pmOrg, ctx.issueNumber), loadAssignmentsFromDcs(sess, ctx.pmOrg, ctx.lang, ctx.projectId, ctx.contentOrg).catch(() => null)]);
      setIssue(nextIssue);
      const taskSteps = board?.teams.find((task) => task.id === ctx.taskId)?.steps ?? [];
      setSteps(taskSteps);
      setTeamName(board?.teams.find((task) => task.id === ctx.taskId)?.orgTeamName ?? "");
      setTeamMembers(board?.teams.find((task) => task.id === ctx.taskId)?.memberIds ?? []);
      const progressNow = parseTaskProgressMarker(nextIssue.body);
      setStepId((current) => current || (taskSteps.find((row) => stepNeedsOpenPortionPr(row) && !isStepDone(progressNow, row.id))?.id ?? ""));
      const linked = parsePortionPrMarker(nextIssue.body);
      setMarker(linked);

      // What helps to judge the draft comes apart from it: a source that fails to load does not hide the draft.
      const pmConfig = await loadPmConfig(sess, ctx.pmOrg).catch(() => DEFAULT_PM_CONFIG);
      void Promise.all((["ult", "ust"] as const).map((kind) => loadEnglishScriptureChapterUsfm(sess, kind, ctx.book, range.chapter).catch(() => null))).then((loaded) =>
        setSources(
          loaded.flatMap((pane, index) => (pane ? [{ short: pane.meta?.short || englishScriptureKindRef((["ult", "ust"] as const)[index]!, ctx.book).short, verses: extractDraftVerses(pane.usfm, range).verses }] : [])),
        ),
      );
      // The English of what is reviewed, item by item: each shows only the checks its own source calls for.
      if (ctx.resource === "notas" || ctx.resource === "preguntas") {
        void loadEnglishHelpsForRange(sess, ctx, range)
          .then((rows) => setEnglish(Object.fromEntries(rows.filter((row) => row.kind === (ctx.resource === "notas" ? "nota" : "pregunta")).map((row) => [row.id, `${row.title} ${row.body}`]))))
          .catch(() => undefined);
      }
      void loadNotesForRange(sess, ctx, range, pmConfig)
        .then((loaded) => setNotes(loaded.notes))
        .catch(() => setNotes([]));

      setArticleFiles([]);
      setSourcesRead(false);
      setIntros([]);
      setSourceRows({});
      setSourceRowsRead(false);
      setHeadFiles([]);
      setSourceTsv("");
      setThenFiles(null);
      setOpenItem(null);
      setSeen(new Set());
      pieces.reset();
      firstOpened.current = false;
      if (!linked) {
        setPull(null);
        setItems([]);
        setComments([]);
        return;
      }
      const [nextPull, files] = await Promise.all([loadLinkedPull(sess, linked), loadLinkedPullFiles(sess, linked).catch(() => [])]);
      setPull(nextPull);
      void loadComments(sess, linked, nextIssue.assignee?.login || nextIssue.assignees?.[0]?.login || undefined).catch(() => setComments([]));
      const names = files.map((file) => file.filename);
      const readAt = (filepath: string, branch: string) =>
        readRepoFile({ session: sess, owner: linked.owner, repo: linked.repo, filepath, branch })
          .then((file) => file.text)
          .catch(() => null);
      const articles = names.filter((name) => /\.md$/i.test(name));
      if (articles.length && !names.some((name) => /\.(usfm|sfm|tsv)$/i.test(name))) {
        // A draft of articles: each one is a piece, whole.
        const read = await Promise.all(articles.map(async (name) => ({ filename: name, now: (await readAt(name, linked.head)) ?? "", before: (await readAt(name, linked.base)) ?? "" })));
        setItems(articleItems(read));
        // The article as it reads: the files that were worked on, and with them the title and the line under it of
        // an Academy article even when nobody touched them (a title left in the source language is to be seen too).
        const files = articleFilesOf(articles, ctx.resource === "academia");
        const texts = await Promise.all(files.map(async (file) => read.find((row) => row.filename === file.filename)?.now ?? (await readAt(file.filename, linked.head)) ?? (await readAt(file.filename, linked.base)) ?? ""));
        setArticleFiles(files.map((file, index) => ({ ...file, text: texts[index]! })));
        setHeadFiles(files.map((file, index) => ({ filename: file.filename, text: texts[index]! })));
        // The source of each file, from the source package of the project: what each piece is read against, and
        // what says which checks a piece calls for.
        const pkg = resolveSourcePackage(board?.settings);
        void Promise.all(files.map((file) => readRaw(sess, pkg.owner, ctx.resource === "academia" ? pkg.ta : pkg.tw, file.filename).then((text) => [file.filename, text] as const).catch(() => [file.filename, null] as const))).then((pairs) => {
          setEnglish(Object.fromEntries(pairs.filter((pair): pair is readonly [string, string] => Boolean(pair[1]))));
          setSourcesRead(true);
        });
        return;
      }
      const filename = names.find((name) => /\.(usfm|sfm|tsv)$/i.test(name)) ?? bookUsfmName(ctx.book);
      const read = (branch: string) => readAt(filename, branch);
      const [now, before] = await Promise.all([read(linked.head), read(linked.base)]);
      // Once the draft is in the team's text its own copy may be gone: what is reviewed then is the team's text.
      setItems(reviewItems({ filename, now: now ?? before ?? "", before: before ?? "", range }));
      setHeadFiles([{ filename, text: now ?? before ?? "" }]);
      if ((ctx.resource === "notas" || ctx.resource === "preguntas") && /\.tsv$/i.test(filename)) {
        const text = now ?? before ?? "";
        const questions = ctx.resource === "preguntas";
        void (async () => {
          // Each row is read against the same row of the source package. The questions repository sits beside the
          // notes one: `en_tn` → `en_tq`.
          const pkg = resolveSourcePackage(board?.settings);
          const raw = await readRaw(sess, pkg.owner, questions ? pkg.tn.replace(/_tn$/, "_tq") : pkg.tn, helpsTsvFilename(questions ? "preguntas" : "notas", ctx.book)).catch(() => null);
          const said: Record<string, { text: string; secondary?: string }> = {};
          for (const row of raw ? parseTsvTable(raw).rows : []) {
            const id = tsvRowId(row);
            if (id) said[id] = questions ? { text: noteFromTsv(row.Question || "").trim(), secondary: noteFromTsv(row.Response || "").trim() } : { text: noteFromTsv(row.Note || "").trim() };
          }
          setSourceTsv(raw ?? "");
          setSourceRows(said);
          setSourceRowsRead(true);
          if (questions) return;
          // An introduction is a note of pages, and not on a verse: it is read as the long text it is, against its source.
          const inventory = await loadInventoryFromDcs(sess, ctx.pmOrg, ctx.lang, ctx.book).catch(() => null);
          const planned = new Set(selectTsvRowsForPortion(parseTsvTable(text).rows, ctx, inventory).map(tsvRowId));
          const found = introItems(text, before ?? "", range.chapter, (id) => planned.has(id));
          setIntros(found.map((row) => ({ ...row, source: said[row.key]?.text ?? "" })));
        })().catch(() => setSourceRowsRead(true));
      }
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }, [ctx, range, loadComments]);

  useEffect(() => {
    void load();
  }, [load]);

  // A note is about a phrase of the verse: it is found in the source texts through the alignment, as where it is
  // translated. Wanted wherever notes are shown: in their own review, and beside the verses of a text or a question.
  const helpSources = useHelpSources(session, (ctx?.book || "").toUpperCase(), range?.chapter ?? 0, Boolean(ctx && ctx.resource !== "academia" && ctx.resource !== "palabras"));
  // The English text a draft of the Bible is translated from, aligned with the original: what a decision of the
  // glossary is found by, at a verse. A help says English words of its own: its decisions are found by those.
  const alignments = (helpSources.find((source) => (ctx?.resource === "tps" ? /ust|gst|tps/i : /ult|glt|tpl/i).test(source.short)) ?? helpSources[ctx?.resource === "tps" ? 1 : 0])?.alignments;
  const decisionsAt = useVerseDecisions(session, ctx, alignments);
  const decisionsIn = useTextDecisions(session, ctx);

  const me = session?.username ?? "";
  const progress = useMemo(() => parseTaskProgressMarker(issue?.body), [issue]);
  const author = issue?.assignee?.login || issue?.assignees?.[0]?.login || undefined;
  // The step the tool was opened for; opened without one, the first review that was still open then (it stays
  // the same one after it is approved, so the person sees that it was completed).
  const step = useMemo(() => steps.find((row) => row.id === stepId), [steps, stepId]);
  const stepDone = Boolean(step && isStepDone(progress, step.id));
  const runtime = step ? getStepRuntime(progress, step.id) : null;
  const seated = Boolean(runtime?.assignees.some((login) => login.toLowerCase() === me.toLowerCase()));
  const approved = Boolean(runtime?.approvals.some((login) => login.toLowerCase() === me.toLowerCase()));
  // A review starts when what comes before it (the draft) is finished.
  const unlocked = Boolean(step && isStepUnlocked(steps, progress, step.id));
  const canSendBack = Boolean(step && me && canAskForChanges(me, steps, progress, step));
  // The work was sent back to its author and is not handed in again yet.
  const sentBack = Boolean(step && changesPending(steps, progress, step));
  // The process keeps whoever wrote or already reviewed the draft out of this review.
  const keptOut = Boolean(step && me && !seated && !isEligibleForStep(me, undefined, progress, step, author));
  const canTake = Boolean(step && me && canClaimStep(me, steps, progress, step, undefined, author));
  const canApprove = Boolean(unlocked && step && me && canApproveStep(me, progress, step, author));
  // The author may take the draft back to correct it while its review is open, and goes to it from here once it is back.
  const isAuthor = Boolean(author && me) && author!.toLowerCase() === me.toLowerCase();
  const canCorrect = Boolean(step && me && canTakeBack(me, steps, progress, step, author));
  const byAuthor = Boolean(step && takenBackByAuthor(steps, progress, step, author));
  // Who asked for the changes, where the subtarea says it; before it did, whoever sat on the review was taken to have.
  const askedByMe = runtime?.returnedBy ? runtime.returnedBy.toLowerCase() === me.toLowerCase() : seated;

  const draftOwner = marker ? translatorLoginFromHead(marker.head, [author, me]) : (author ?? "");
  const mine = Boolean(draftOwner) && draftOwner.toLowerCase() === me.toLowerCase();

  // What each piece says now, from the files this screen read from the head of the review (spec 4.3): what tells a
  // proposal that was used from one that was not. A step already closed compares nothing (`frozen`).
  const introSources = useMemo(() => Object.fromEntries(intros.map((row) => [row.key, row.source])), [intros]);
  const sourceOf = (filename: string) => english[filename] ?? (/\.tsv$/i.test(filename) ? sourceTsv : undefined);
  const textAt = useMemo(
    () => (range && headFiles.length ? pieceTextAt({ files: headFiles.map((file) => ({ ...file, source: english[file.filename] })), range, introSources }) : undefined),
    [range, headFiles, english, introSources],
  );
  // The second round: the draft as it was when it went back to its author, for whoever was seated then (spec 3.5).
  const returnedSha = runtime ? secondRoundFor(runtime, me) : null;
  useEffect(() => {
    setThenFiles(null);
    if (!returnedSha || !session || !marker || !headFiles.length) return;
    let live = true;
    void Promise.all(
      headFiles.map(async (file) => ({ filename: file.filename, text: (await readRepoFile({ session, owner: marker.owner, repo: marker.repo, filepath: file.filename, branch: returnedSha })).text })),
    )
      .then((read) => live && setThenFiles(read))
      // Without that version nothing is marked: it reads as a first round.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [returnedSha, session, marker, headFiles]);
  // Without that version (it could not be read) the screen reads as a first round.
  const roundSha = returnedSha && thenFiles ? returnedSha : null;
  const thenAt = useMemo(
    () => (range && thenFiles ? pieceTextAt({ files: thenFiles.map((file) => ({ ...file, source: english[file.filename] })), range, introSources }) : undefined),
    [range, thenFiles, english, introSources],
  );
  // The articles are counted by pieces against their English, and the notes' introductions against the English notes:
  // until those are read the paragraphs cannot be told apart.
  const roundReady = headFiles.length > 0 && (articleFiles.length ? sourcesRead : /\.tsv$/i.test(headFiles[0]!.filename) ? sourceRowsRead : true);
  const changedRefs = useMemo(
    () =>
      roundSha && thenFiles && range && roundReady
        ? headFiles.flatMap((file) => changedSince({ filename: file.filename, now: file.text, then: thenFiles.find((row) => row.filename === file.filename)?.text ?? "", range, source: sourceOf(file.filename) }))
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roundSha, thenFiles, range, roundReady, headFiles, english, sourceTsv],
  );
  const changedSet = useMemo(() => new Set(changedRefs ?? []), [changedRefs]);
  // Handed in: the subtarea closed, or its draft already in the team's text.
  const handedIn = (issue?.state ?? "open").toLowerCase() === "closed" || Boolean(pull?.merged);
  // What was said may be changed while the review is open (see `canEditComment`).
  const reviewOpen = !stepDone && !handedIn;
  // Whoever reviewed and approved may come back to the review until it is handed in (see `canChangeReview`).
  const canChange = Boolean(step && me && canChangeReview(me, steps, progress, step, author, handedIn));
  // Every step is done and the subtarea is the person's: what is left is to hand the text to the group, here where the
  // review ends (the same condition that gives a card «Entregar»). It took three touches away from this screen, and
  // if nobody made them the group never got the text. «Mis tareas» hands it in: one place does. A review opened in a
  // window of its own closes with it, with nobody to hand in on the way back: there, it stays on the card.
  // By the subtarea alone, as the card's «Entregar»: a draft already merged by a close that failed half-way is still
  // handed in from here.
  const canDeliver = isAuthor && (issue?.state ?? "open").toLowerCase() !== "closed" && steps.length > 0 && allStepsDone(steps.map((row) => row.id), progress) && !window.opener;
  const deliver = () => {
    markThen(ctx?.issueNumber ?? 0, "deliver");
    onClose();
  };

  async function act(run: () => Promise<void>): Promise<boolean> {
    setActing(true);
    setError("");
    try {
      await run();
      return true;
    } catch (err) {
      setError(explainError(err));
      return false;
    } finally {
      setActing(false);
    }
  }

  /** The draft has no review yet (it was finished before reviews were opened by themselves): open it. */
  const openReview = () =>
    act(async () => {
      if (!session || !ctx || !issue) return;
      const board = await loadAssignmentsFromDcs(session, ctx.pmOrg, ctx.lang, ctx.projectId, ctx.contentOrg);
      if (!board) throw new Error(tNow("pr.noPlan"));
      await ensurePortionPr({ session, pmOrg: ctx.pmOrg, lang: ctx.lang, contentOrg: ctx.contentOrg, board, issue });
      await load();
    });

  const take = () =>
    act(async () => {
      if (!session || !ctx || !step) return;
      // Read again first: a seat somebody took meanwhile must not be lost.
      const fresh = await getPmIssue(session, ctx.pmOrg, ctx.issueNumber);
      const current = parseTaskProgressMarker(fresh.body);
      if (!canClaimStep(me, steps, current, step, undefined, author)) {
        setIssue(fresh);
        throw new Error(tNow("mt.cannotTakeStep"));
      }
      setIssue(await setIssueTaskProgress(session, ctx.pmOrg, fresh, claimStep(current, step, me)));
      announce(tNow("rv.taken"));
    });

  /** What each piece says now, read again from the head of the review, for the files that have a proposal (the author may have corrected meanwhile). */
  const readTextAt = async (linked: PortionPrMarker, proposed: Comment[]): Promise<((ref: string) => PieceText | undefined) | undefined> => {
    if (!session || !range) return undefined;
    const files: PieceFile[] = [];
    const named = (await loadLinkedPullFiles(session, linked).catch(() => [])).map((file) => file.filename);
    for (const filename of named) {
      const article = /\.md$/i.test(filename);
      if (!article && !/\.(usfm|sfm|tsv)$/i.test(filename)) continue;
      // An article is named in its comments by its own folder: only those with a proposal are read.
      if (article && !proposed.some((row) => row.ref.startsWith(pieceRef(filename, 0).replace(/ ¶1$/, "")))) continue;
      const text = await readRepoFile({ session, owner: linked.owner, repo: linked.repo, filepath: filename, branch: linked.head })
        .then((file) => file.text)
        .catch(() => null);
      if (text !== null) files.push({ filename, text, source: english[filename] });
    }
    return pieceTextAt({ files, range, introSources: Object.fromEntries(intros.map((row) => [row.key, row.source])) });
  };

  const approve = () =>
    act(async () => {
      if (!session || !ctx || !step) return;
      const fresh = await getPmIssue(session, ctx.pmOrg, ctx.issueNumber);
      const current = parseTaskProgressMarker(fresh.body);
      if (!canApproveStep(me, current, step, author)) {
        setIssue(fresh);
        throw new Error(tNow("mt.cannotApproveStep"));
      }
      const linked = parsePortionPrMarker(fresh.body);
      // What was said is read again too: a comment written meanwhile holds the review as much as one already here.
      if (linked) {
        const owner = fresh.assignee?.login || fresh.assignees?.[0]?.login || undefined;
        const said = await loadReviewComments(session, linked, owner);
        // A proposal the draft now says is used and holds nothing: the files that have one are read again from the
        // head, as the author may have corrected meanwhile. A piece that is no longer there counts as open.
        const proposed = said.filter((row) => row.proposal && !row.resolved);
        const textAt = proposed.length ? await readTextAt(linked, proposed) : undefined;
        if (openComments(said, owner, textAt, stepDone).length) {
          setComments(said);
          throw new Error(tNow("rv.cannotApproveOpen"));
        }
      }
      if (linked && stepNeedsOpenPortionPr(step)) await submitPortionPrApproval(session, linked, { stepName: step.name, issueNumber: fresh.number });
      const next = approveStep(current, step, me, author);
      setIssue(await setIssueTaskProgress(session, ctx.pmOrg, fresh, next));
      announce(tNow(isStepDone(next, step.id) ? "rv.approvedDone" : "rv.approvedWait"));
    });

  /** The place in view (the paragraph that is open), to open the draft on it. */
  const placeInView = (): string | undefined => {
    if (openItem) return openItem;
    const active = pieces.active;
    if (!active) return ctx?.focus;
    const intro = intros.find((row) => row.key === active.id);
    return intro ? introPieceRef(intro.chapter, active.index) : pieceRef(active.id, active.index);
  };

  /** Open the tool where the draft is written, on the place in view. */
  const openDraft = async (fresh: DcsIssue, focus?: string) => {
    if (!session || !ctx || !step) return;
    const draftStep = steps.find((row) => row.id === reviewedStepId(steps, step));
    const [board, catalog] = await Promise.all([
      loadAssignmentsFromDcs(session, ctx.pmOrg, ctx.lang, ctx.projectId, ctx.contentOrg).catch(() => null),
      loadSolversCatalog(session, ctx.pmOrg).catch(() => DEFAULT_SOLVERS_CATALOG),
    ]);
    const task = board?.teams.find((row) => row.id === ctx.taskId);
    const app = findSolverApp(catalog, draftStep?.solverAppId) || findSolverApp(catalog, task?.solverAppId) || (board ? resolveSolverForIssue(catalog, board, fresh) : undefined);
    // Without a tool to open it in from here, the draft is in the person's list, under its own button.
    if (!app || !draftStep) return onClose();
    openSolverApp(app, { ...ctx, stepId: draftStep.id, stepName: draftStep.name, focus: focus || placeInView() });
  };

  /** «Corregir mi borrador»: the author takes the draft back (see `takeBack`) and is taken to where it is written. */
  const correct = (focus?: string) =>
    act(async () => {
      if (!session || !ctx || !step) return;
      // Read again first: an approval saved meanwhile may have finished the review.
      const fresh = await getPmIssue(session, ctx.pmOrg, ctx.issueNumber);
      const current = parseTaskProgressMarker(fresh.body);
      const owner = fresh.assignee?.login || fresh.assignees?.[0]?.login || undefined;
      if (!canTakeBack(me, steps, current, step, owner)) {
        setIssue(fresh);
        throw new Error(tNow("rv.cannotCorrect"));
      }
      const sha = marker ? await readReturnedSha(session, marker) : null;
      const saved = await setIssueTaskProgress(session, ctx.pmOrg, fresh, takeBack(current, steps, step, me, owner, sha ?? undefined));
      setIssue(saved);
      await openDraft(saved, focus);
    });

  /**
   * A comment, about one piece (`ref`) or about the whole draft; asking for changes names the author. `box`: the box
   * it was written in, closed once it is sent; a send that fails leaves it with its words.
   */
  const comment = (ref: string, text: string, askChanges = false, box?: string) =>
    act(async () => {
      if (!session || !ctx || !marker) return;
      const body = `${askChanges && draftOwner && !mine ? `@${draftOwner} ` : ""}${askChanges ? `${tNow("rv.changesAsked")} ` : ""}${text.trim()}`;
      await commentOnPortionPr(session, marker, ref ? refComment(ctx.book, ref, body) : body);
      if (askChanges && step) {
        // The draft goes back to its author. Read again first: a seat or an approval saved meanwhile is kept.
        const fresh = await getPmIssue(session, ctx.pmOrg, ctx.issueNumber);
        const sha = await readReturnedSha(session, marker);
        const next = askForChanges(parseTaskProgressMarker(fresh.body), steps, step, me, sha ?? undefined);
        setIssue(await setIssueTaskProgress(session, ctx.pmOrg, fresh, next));
      }
      if (box) closeBox(box);
      announce(tNow(askChanges ? "rv.changesSent" : "pr.commentSent"));
      await loadComments(session, marker, author).catch(() => undefined);
    });

  /** The sentence that is read in a proposal, in the language of the screen (a question and its answer, in two lines). */
  const proposalSentence = (words: PieceText) => `${tNow("rv.proposalVisible").replace("{words}", () => words.text.trim())}${words.secondary !== undefined ? `\n«${words.secondary.trim()}»` : ""}`;
  /** Other words for a piece, written on the review as a comment with its data (see `proposeWords`). `box`: the box it was written in. */
  const propose = (box: string, ref: string, over: PieceText, words: PieceText, why?: string) =>
    act(async () => {
      if (!session || !ctx || !marker) return;
      await proposeWords(session, marker, ctx.book, ref, { over, words, ...(why ? { why } : {}) }, proposalSentence(words));
      closeProposal(box);
      announce(tNow("rv.proposalSent"));
      await loadComments(session, marker, author).catch(() => undefined);
    });

  /** Give a comment as resolved, or open it again (see `reviewComments.ts`). */
  const resolve = (row: Comment, reopen: boolean) =>
    act(async () => {
      if (!session || !ctx || !marker) return;
      await setReviewCommentResolved(session, marker, row, ctx.issueNumber, !reopen);
      announce(tNow(reopen ? "rv.reopenedSaid" : "rv.resolvedSaid"));
      await loadComments(session, marker, author).catch(() => undefined);
    });

  /**
   * Change what a comment says, or take it back. Read again first: an answer written meanwhile means the comment is
   * no longer only its writer's (see `canEditComment`), and it is left as it is.
   */
  const changeComment = (row: Comment, words: string | null, edit?: { proposal: Proposal; visible: string }) =>
    act(async () => {
      if (!session || !ctx || !marker) return;
      const said = await loadReviewComments(session, marker, author);
      const now = said.find((other) => other.id === row.id);
      // A proposal the draft now says is used and is no longer changed: the head is read again for it.
      const used = Boolean(now?.proposal) && proposalUsed(now!.proposal!, (await readTextAt(marker, [now!]))?.(now!.ref));
      if (!now || !canEditComment(now, said, me, { reviewOpen, kept: Boolean(ruleMadeFrom(teamRules, String(row.id))) || decided.includes(String(row.id)), used })) {
        setComments(said);
        setEditing(0);
        throw new Error(tNow("rv.cannotEditNow"));
      }
      if (words === null) await deleteReviewComment(session, marker, now);
      // A proposal is written again whole: `editedCommentBody` would lose its marker.
      else if (now.proposal) {
        if (!edit) throw new Error(tNow("rv.cannotEditNow"));
        await editProposal(session, marker, now, edit.proposal, edit.visible);
      } else await editReviewComment(session, marker, now, words);
      setEditing(0);
      announce(tNow(words === null ? "rv.commentDeleted" : "rv.commentEdited"));
      await loadComments(session, marker, author).catch(() => undefined);
    });

  /** «Cambiar mi revisión»: the review is open again for whoever approved it (see `changeReview`). */
  const reopenMine = () =>
    act(async () => {
      if (!session || !ctx || !step) return;
      // Read again first: the work may have been handed in meanwhile, or the author may have agreed.
      const fresh = await getPmIssue(session, ctx.pmOrg, ctx.issueNumber);
      const current = parseTaskProgressMarker(fresh.body);
      const owner = fresh.assignee?.login || fresh.assignees?.[0]?.login || undefined;
      if (!canChangeReview(me, steps, current, step, owner, (fresh.state ?? "open").toLowerCase() === "closed" || Boolean(pull?.merged))) {
        setIssue(fresh);
        throw new Error(tNow("rv.cannotChangeReview"));
      }
      setIssue(await setIssueTaskProgress(session, ctx.pmOrg, fresh, changeReview(current, steps, step, me, owner)));
      announce(tNow("rv.reviewReopened"));
    });

  const stepName = step ? localized(step.name, step.names, language) : mode === "group" ? t("pr.group") : t("pr.pairs");
  const passageName = ctx ? [bookLabel(ctx.book, language), ctx.ref].filter(Boolean).join(/^\d/.test(ctx.ref ?? "") ? " " : " · ") : stepName;
  // What is reviewed is an article, not a passage of the book: the screen calls it that.
  const article = ctx?.resource === "academia" || ctx?.resource === "palabras";
  /** What a piece is called in this resource, for the line that says to touch one. */
  const pieceWord = ctx?.resource === "notas" ? "rv.pieceNote" : ctx?.resource === "preguntas" ? "rv.pieceQuestion" : article ? "rv.pieceParagraph" : "rv.pieceVerse";
  /** The words of a help's row in the source package: what tells a row still in the source language from a translated one. */
  const rowVocabulary = (key: string) => (sourceRows[key] ? vocabularyOf(`${sourceRows[key]!.text} ${sourceRows[key]!.secondary ?? ""}`) : null);
  // What the team's own sentences in this draft show to be words of its language too: a word both languages write
  // alike (a name, «altar») is then not said to be untranslated, here as where the draft is written (`writtenAlike`).
  const known = knownWords([
    ...articleFiles.filter((file) => english[file.filename]).map((file) => ({ source: english[file.filename]!, value: file.text })),
    ...intros.filter((intro) => intro.source).map((intro) => ({ source: intro.source, value: intro.now })),
  ]);
  for (const item of items) {
    if (item.help && item.state !== "removed") for (const word of wordsKnownFrom(item.help, sourceRows[item.key])) known.add(word);
  }
  // Still as the source has it: there is nothing to review yet, and it is said so instead of shown as a translation.
  // A question and its answer are told apart (`pendingParts`): one may be translated and the other not.
  const partsPending = (item: ReviewItem) => (item.help && item.state !== "removed" ? pendingParts(item.help, sourceRows[item.key], known) : { text: false, secondary: false });
  const rowPending = (item: ReviewItem) => partsPending(item).text || partsPending(item).secondary;
  // The draft changed a row that was already in the team's language: what changed is marked. A row translated from the
  // source changed in every word, and marking them all says nothing.
  const rowCorrected = (item: ReviewItem) => {
    const vocabulary = item.help ? rowVocabulary(item.key) : null;
    return Boolean(item.help && sourceRowsRead && item.state === "changed" && item.help.before.trim() && !(vocabulary && untranslated(`${item.help.before} ${item.help.beforeSecondary ?? ""}`, vocabulary)));
  };
  const helpRowsRead = items.filter((item) => item.help && item.state !== "removed" && sourceRows[item.key]);
  const helpRowsMissing = helpRowsRead.filter(rowPending);
  // The two notes left untranslated in a passage of thirty-five were sixteen and thirty screens down on a phone, with
  // nothing but the count to say they were there: the count leads to the first, and each of them to the next.
  const toMissing = (after?: string) => {
    const next = helpRowsMissing[(after ? helpRowsMissing.findIndex((item) => item.key === after) + 1 : 0) % helpRowsMissing.length];
    if (next) pieces.pane.current?.querySelector(`.rv-item[data-row="${CSS.escape(next.key)}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  /** Where a comment about an item is filed: a row of a help under its own name (`helpRowRef`), the rest under their reference. */
  const placeOf = (item: ReviewItem) => (item.help ? helpRowRef(item.ref, item.key) : item.ref);
  const notesOf = (verse: number) => notes.filter((note) => note.verse === verse);
  const when = (iso: string) => (iso ? new Date(iso).toLocaleDateString(language, { day: "numeric", month: "short" }) : "");

  // What a reviewer tells one person about one verse is often true of every verse that says the same: whoever said
  // it (or coordinates the team) keeps it as a rule of the team, from the comment itself. It was a box to write a
  // rule in, away from what had made anybody think of one.
  const ofTeam = isOfTeam(session, { orgTeamName: teamName, memberIds: teamMembers });
  const saveRule = async (row: Comment, text: string, words: string[]) => {
    setRuling({ id: String(row.id), busy: true, failed: "" });
    try {
      await addRuleToTeam(teamName, text, ctx?.issueNumber, words.length ? words : undefined, String(row.id));
      setRuling(null);
      announce(t("rv.ruleSaved"));
    } catch {
      setRuling({ id: String(row.id), busy: false, failed: "rule" });
    }
  };
  // How a word is translated is not a rule of one team: it is a decision of the glossary, for every team and text.
  // The words touched in the verse lead to the word of the original under them, and the entry is filed by that.
  // `text`: a verse of the Bible text in hand, filed by its own alignment. Otherwise a note, a question or a
  // paragraph: by the verse it is of when the word is there (in either English text), and if not by the English word.
  type Place = { chapter?: number; verse?: number; text: boolean };
  const underWords = (place: Place, words: string[]) => {
    const { chapter, verse } = place;
    const verses = !chapter || !verse ? [] : place.text ? [groupsOfVerse(alignments, chapter, verse)] : helpSources.map((source) => groupsOfVerse(source.alignments, chapter, verse));
    return filedUnder(glossary, words, verses, !place.text);
  };
  const saveDecision = async (row: Comment, place: Place, words: string[], rendering: string, why: string) => {
    const under = underWords(place, words);
    if (!under || !session || !ctx) return;
    setRuling({ id: String(row.id), busy: true, failed: "" });
    try {
      const base = under.existing ?? entryFromSources({ id: newGlossaryId(glossary.map((entry) => entry.id)), sources: under.sources, english: under.english, example: place.chapter && place.verse ? `${ctx.book.toUpperCase()} ${place.chapter}:${place.verse}` : "" });
      const entry = { ...base, rendering, note: base.note || why };
      await saveGlossaryEntry({ session, owner: ctx.contentOrg, lang: ctx.lang, entry, before: under.existing, reason: why });
      glossaryEntrySaved(session, ctx.contentOrg, ctx.lang, entry);
      setDecided((now) => [...now, String(row.id)]);
      setRuling(null);
      announce(t("rv.decisionSaved"));
      // Said on the review too, so the comment reads «Está en el glosario» to everyone and the author of the draft
      // learns of the decision. The entry is kept already: if this fails, the mark lasts this visit only.
      if (marker) {
        await markReviewCommentInGlossary(session, marker, row, ctx.issueNumber, t("gl.at").replace("{english}", under.english).replace("{rendering}", rendering), entry.id)
          .then(() => loadComments(session, marker, author))
          .catch(() => undefined);
      }
    } catch {
      setRuling({ id: String(row.id), busy: false, failed: "glossary" });
    }
  };
  /** What may be done with a comment now: the choices of its «…» sheet, and whether it was used (a proposal the draft says). */
  const factsOf = (row: Comment) => {
    const kept = Boolean(ruleMadeFrom(teamRules, String(row.id))) || decided.includes(String(row.id));
    const used = Boolean(row.proposal) && reviewOpen && proposalUsed(row.proposal!, textAt?.(row.ref));
    const editable = canEditComment(row, comments, me, { reviewOpen, kept, used });
    // A proposal is not a sentence to keep as a rule: its words are the piece's own.
    const canRule = !row.proposal && !kept && row.glossary === undefined && Boolean(teamName && ofTeam && (managesRules || row.by.toLowerCase() === me.toLowerCase()));
    return { kept, used, editable, canRule };
  };
  /** The words of a proposal as they are read: what changed over the piece, marked. */
  const proposalRead = (proposal: Proposal, ref: string) => <ProposalMarked proposal={proposal} against={mine && reviewOpen ? textAt?.(ref) : undefined} />;
  /**
   * `source`: the source of what the comment is about, whose words a rule made from it may be said to be about.
   * `place`: what it is about, as its words lead to the glossary (see `underWords`); none for the whole draft.
   */
  const commentRow = (row: Comment, source?: string | null, place?: Place, where?: string) => {
    const { kept, used, editable, canRule } = factsOf(row);
    if (editing === row.id && editable) {
      if (row.proposal) {
        const proposal = row.proposal;
        return (
          <li key={row.id} className="rv-comment rv-comment--editing" data-comment={row.id}>
            <ProposalBox
              initial={proposal.words}
              editing
              startWhy={proposal.why}
              busy={acting}
              onCancel={() => setEditing(0)}
              onSend={(words, why) => void changeComment(row, words.text, { proposal: { over: textAt?.(row.ref) ?? proposal.over, words, ...(why ? { why } : {}) }, visible: proposalSentence(words) })}
            />
          </li>
        );
      }
      const { words } = commentWords(row);
      return (
        <li key={row.id} className="rv-comment rv-comment--editing" data-comment={row.id}>
          <Composer
            focus
            initial={words}
            placeholder={t("rv.editPlaceholder")}
            busy={acting}
            cancel={{ label: t("rv.cancelEdit"), run: () => setEditing(0) }}
            actions={[{ label: t("rv.saveEdit"), primary: true, run: (text) => changeComment(row, text) }]}
          />
        </li>
      );
    }
    const resolvable = canResolveComment(row, me, { draftAuthor: author, canManage: session?.canManage });
    return (
    <li key={row.id} className="rv-comment" data-comment={row.id} data-resolved={row.resolved ? "true" : undefined} data-proposal={row.proposal ? "true" : undefined} data-used={used ? "true" : undefined}>
      {where ? <p className="rv-comment__where">{where}</p> : null}
      {row.proposal ? proposalRead(row.proposal, row.ref) : <p className="rv-comment__text">{row.text}</p>}
      {row.proposal && mine && !used && !row.resolved && reviewOpen && open.some((other) => other.id === row.id) && (canCorrect || (sentBack && isAuthor && issue)) ? (
        // She answers a proposal by correcting her draft: the editor opens at that place, where she can use the words.
        <Button type="button" variant="outline" className="rv-comment__fix" data-fix-draft disabled={acting} onClick={() => whenSent(() => void (canCorrect ? correct(row.ref) : act(() => openDraft(issue!, row.ref))), true)}>
          {t("rv.correct")}
        </Button>
      ) : null}
      <p className="rv-comment__meta">
        <span>{[row.by ? `@${row.by}` : "", when(row.at), row.edited ? t("rv.edited") : ""].filter(Boolean).join(" · ")}</span>
        {row.resolved ? (
          <span className="rv-comment__done">
            <Check size={12} aria-hidden /> {t("rv.resolved")}
          </span>
        ) : used ? (
          <span className="rv-comment__done" data-used="true">
            <Check size={12} aria-hidden /> {t("rv.usedBy").replace("{who}", draftOwner ? nameOf(draftOwner) : t("rv.theAuthor"))}
          </span>
        ) : null}
      </p>
      {resolvable || editable || canRule ? (
        <div className="rv-comment__foot">
          {resolvable ? (
            // Whoever made the comment says when it is answered: the review is not approved while one is open.
            <button type="button" className="rv-comment__act" disabled={acting} onClick={() => void resolve(row, Boolean(row.resolved))}>
              {t(row.resolved ? "rv.reopen" : "rv.resolve")}
            </button>
          ) : null}
          {editable || canRule ? (
            <button type="button" className="rv-comment__more" disabled={acting} aria-label={t("rv.moreTitle")} aria-haspopup="dialog" onClick={() => setMenuFor(row.id)}>
              …
            </button>
          ) : null}
        </div>
      ) : null}
      {kept || row.glossary !== undefined ? (
        <p className="rv-comment__rule">
          <Check size={12} aria-hidden /> {t(row.glossary !== undefined || decided.includes(String(row.id)) ? "rv.isDecision" : "rv.isRule")}
        </p>
      ) : ruling?.id === String(row.id) ? (
        <CommentAsRule
          text={row.text}
          source={source}
          busy={ruling.busy}
          failed={ruling.failed ? t(ruling.failed === "glossary" ? "rv.decisionError" : "sa.ruleError") : undefined}
          onSave={(text, words) => void saveRule(row, text, words)}
          decide={place ? (words) => underWords(place, words) : undefined}
          onDecide={place ? (words, rendering, why) => void saveDecision(row, place, words, rendering, why) : undefined}
          onCancel={() => setRuling(null)}
        />
      ) : null}
    </li>
    );
  };

  /**
   * The comments about a place: the last two, with «Ver 3 comentarios antes» over them for the rest. What is resolved
   * folds first, so the two that are seen are those still open when there are that many; a comment being changed is
   * never folded. `key` names the list for its «Ver…».
   */
  const commentList = (rows: Comment[], key: string, render: (row: Comment) => React.ReactNode) => {
    if (!rows.length) return null;
    const folding = rows.length > 2 && !unfolded.has(key);
    let shown = rows;
    if (folding) {
      const keep = new Set<Comment>();
      for (const row of [...rows].reverse().filter((row) => !row.resolved)) if (keep.size < 2) keep.add(row);
      for (const row of [...rows].reverse().filter((row) => row.resolved)) if (keep.size < 2) keep.add(row);
      for (const row of rows) if (row.id === editing) keep.add(row);
      shown = rows.filter((row) => keep.has(row));
    }
    const hidden = rows.length - shown.length;
    return (
      <>
        {hidden > 0 ? (
          <button type="button" className="rv-item__add rv-fold" onClick={() => setUnfolded((now) => new Set(now).add(key))}>
            {t(hidden === 1 ? "rv.seeBeforeOne" : "rv.seeBeforeMany").replace("{n}", String(hidden))}
          </button>
        ) : null}
        <ul className="rv-comments">{shown.map(render)}</ul>
      </>
    );
  };

  /**
   * What is under a piece to say something about it: «No del todo…» for whoever reviews, with its two ways (other words,
   * or a comment), and the box that was chosen. `initial`: the piece's words in the form of the author's box, where a
   * proposal can be made; without it «No del todo…» goes straight to the comment. The author does not say «No del todo…»
   * of her own draft: she has her «Comentar».
   */
  const sayUnder = (params: { key: string; ref: string; initial?: PieceText; placeholder: string; guide?: boolean }) => {
    const { key, ref, initial, placeholder, guide } = params;
    const proposing = proposals.get(key);
    const choose = (on: boolean) => setChoosing((now) => { const next = new Set(now); if (on) next.add(key); else next.delete(key); return next; });
    const which = shown.get(key);
    const comment_ = boxes.has(key) && (which !== "proposal" || !proposing || !initial);
    const box = comment_ ? (
        <Composer
          focus
          box={key}
          text={boxes.get(key)}
          onText={(text) => setBoxText(key, text)}
          cancel={{ label: t("rv.cancelEdit"), run: () => closeBox(key) }}
          placeholder={placeholder}
          busy={acting}
          actions={[{ label: t(mine ? "rv.reply" : "rv.comment"), primary: true, run: (text) => comment(ref, text, false, key) }]}
        />
    ) : proposing && initial ? (
        <ProposalBox
          initial={proposing.over ?? initial}
          box={key}
          busy={acting}
          value={proposing}
          onValue={(draft) => setProposal(key, draft)}
          onCancel={() => closeProposal(key)}
          onSend={(words, why) => void propose(key, ref, proposing.over ?? initial, words, why)}
        />
    ) : null;
    if (mine) {
      return (
        <>
          {box}
          {box ? null : (
            <button type="button" className="rv-item__add" data-guide={guide ? "rv-comment" : undefined} onClick={() => openBox(key)}>
              <MessageSquare size={14} aria-hidden /> {t("rv.reply")}
            </button>
          )}
        </>
      );
    }
    const choosingNow = choosing.has(key) && Boolean(initial);
    return (
      <>
        <button
          type="button"
          className="rv-item__add rv-notquite"
          data-guide={guide ? "rv-comment" : undefined}
          aria-expanded={initial ? choosingNow : undefined}
          onClick={() => {
            if (initial) return choose(!choosingNow);
            openBox(key);
            show(key, "comment");
          }}
        >
          {t("rv.notQuite")}
        </button>
        {choosingNow ? (
          <div className="rv-choose">
            <Button
              type="button"
              variant="outline"
              data-choice="propose"
              onClick={() => {
                choose(false);
                // What was written in it before stays.
                setProposals((now) => (now.has(key) ? now : new Map(now).set(key, { words: initial!, over: initial! })));
                show(key, "proposal");
              }}
            >
              {t("rv.proposeWords")}
            </Button>
            <Button
              type="button"
              variant="outline"
              data-choice="comment"
              onClick={() => {
                choose(false);
                openBox(key);
                show(key, "comment");
              }}
            >
              {t("rv.commentSomething")}
            </Button>
          </div>
        ) : null}
        {box}
      </>
    );
  };

  // What was said and is still open holds the review: nobody approves over it.
  const open = openComments(comments, author, textAt, stepDone);
  const openSaid = !open.length
    ? ""
    : open.every((row) => row.by.toLowerCase() === me.toLowerCase())
      ? t(open.length === 1 ? "rv.openMineOne" : "rv.openMineMany").replace("{n}", String(open.length))
      : t(open.length === 1 ? "rv.openOthersOne" : "rv.openOthersMany").replace("{n}", String(open.length));

  // Whoever reviews and has left comments must send the draft back for them to be attended. That was a second
  // button of the box for a comment on the whole passage, off until something was written there, and the foot of the
  // screen spoke only of approving: somebody who left three comments had nothing telling them what to do next.
  // Now the foot offers it, and it needs no writing.
  // Asking for changes needs only that something open is mine: other people's comments stay open for them, and nothing
  // is approved by sending the draft back.
  /** Where an author is taken by «Corregir mi borrador» at the foot: the first place with something open. */
  // In the order of the draft (verses by number), as the editor chooses the first commented place, not by when it was said.
  const verseNumber = (ref: string) => {
    const m = /^(\d+):(\d+)/.exec(ref);
    return m ? Number(m[1]) * 10000 + Number(m[2]) : Infinity;
  };
  const firstOpenPlace = open.filter((row) => row.ref).sort((a, b) => verseNumber(a.ref) - verseNumber(b.ref))[0]?.ref;
  const mineOpen = open.filter((row) => row.by.toLowerCase() === me.toLowerCase());
  const canAsk = canSendBack && !mine && mineOpen.length > 0;

  // Words written in a box and not sent are not seen by anybody: approving, asking for changes or leaving with them
  // asks first, and «Seguir escribiendo» brings the finger back to the first of them.
  const unsent: [string, string, "comment" | "proposal"][] = [
    ...[...boxes].filter(([, text]) => text.trim()).map(([key, text]): [string, string, "comment" | "proposal"] => [key, text, "comment"]),
    // A proposal counts once something in it differs from the piece's own words.
    ...[...proposals].filter(([key]) => proposalTouched(key)).map(([key]): [string, string, "comment" | "proposal"] => [key, "", "proposal"]),
  ];
  const unsentPlace = (key: string) => (key.startsWith("v:") ? (items.find((item) => item.key === key.slice(2))?.ref ?? "") : key.slice(2));
  const unsentProposals = unsent.filter(([, , kind]) => kind === "proposal").length;
  const unsentSaid =
    unsent.length !== 1
      ? t(unsentProposals === unsent.length ? "rv.unsentProposalMany" : "rv.unsentMany").replace("{n}", String(unsent.length))
      : unsent[0]![0] === GENERAL_BOX
        ? t(article ? "rv.unsentGeneralArticle" : "rv.unsentGeneral")
        : t(unsentProposals ? "rv.unsentProposalOne" : "rv.unsentOne").replace("{ref}", unsentPlace(unsent[0]![0]));
  /**
   * Whether to go on: at once without words unsent; otherwise as the person answers. `leaving`: the screen closes and
   * the words with it, so the way on says «Salir»; approving or asking for changes leaves the boxes as they are.
   */
  const confirmUnsent = (leaving = false, sending?: string) =>
    new Promise<boolean>((resolve) => (unsent.some(([key]) => key !== sending) ? setUnsentAsk({ answer: resolve, leaving }) : resolve(true)));
  const whenSent = (run: () => void, leaving = false) => void confirmUnsent(leaving).then((go) => go && run());
  const answerUnsent = (go: boolean) => {
    unsentAsk?.answer(go);
    setUnsentAsk(null);
    if (go) return;
    // After the dialog has given the focus back to the button that opened it.
    const first = unsent[0]?.[0];
    // The box that holds the words may be the one hidden by the other of the piece: it is shown first.
    if (first && unsent[0]![2] !== undefined && first !== GENERAL_BOX) show(first, unsent[0]![2]);
    window.setTimeout(() => {
      const box = first ? pieces.pane.current?.querySelector<HTMLTextAreaElement>(`textarea[data-box="${CSS.escape(first)}"]`) : null;
      box?.scrollIntoView({ block: "center" });
      box?.focus();
    }, 50);
  };

  const askNow = () => whenSent(() => void comment("", t(mineOpen.length === 1 ? "rv.changesAutoOne" : "rv.changesAutoMany").replace("{n}", String(mineOpen.length)), true).then((ok) => ok && setAskedWindow(true)));
  // A draft handed in with parts still as the source has them is not to be reviewed yet, and the app knows which
  // they are: it proposes to send it back, by a touch. Whoever reviewed had to find each part down the draft and
  // write under it that it was missing, and the foot offered only to approve.
  const missing =
    items.filter((item) => item.help && item.state !== "removed" && sourceRows[item.key] && rowPending(item)).length +
    Object.values(pieces.counts).reduce((sum, count) => sum + Math.max(0, count.total - count.done), 0);
  const askFinish = canSendBack && !mine && !open.length && missing > 0;
  const askFinishNow = () => whenSent(() => void comment("", t(missing === 1 ? "rv.missingAutoOne" : "rv.missingAutoMany").replace("{n}", String(missing)), true).then((ok) => ok && setAskedWindow(true)));
  // What counts as read: the last piece was on the screen once (in a second round, the last one that changed). If the
  // whole passage fits, it was on the screen when it opened. A push to read, not a lock.
  const lastKey = lastPieceToSee(readingKeys, roundSha && changedRefs?.length ? readingKeys.filter((key) => changedSet.has(key)) : null);
  // Before the pieces are on the screen nothing is known to be read: the button waits outlined, and asks.
  const readToEnd = readingKeys.length > 0 && Boolean(lastKey) && seen.has(lastKey!);
  // Somebody else left something open: no button, the line says who.
  const othersOpen = open.filter((row) => row.by.toLowerCase() !== me.toLowerCase());
  const openByOthers = !mine && othersOpen.length > 0;
  const nameOf = (login: string) => names[login.toLowerCase()] ?? `@${login}`;
  const othersNamed = [...new Set(othersOpen.map((row) => row.by))].map(nameOf).join(", ");
  // Who is still to approve, by name: «falta que apruebe alguien más» left whoever reviewed wondering who, and the
  // author was told the review would end «cuando quien revisa también apruebe» after the reviewer had approved.
  const approvals = (runtime?.approvals ?? []).map((login) => login.toLowerCase());
  const authorPending = Boolean(step?.includeAuthorInApproval && author && !approvals.includes(author.toLowerCase()));
  const reviewersDone = (runtime?.assignees ?? []).filter((login) => approvals.includes(login.toLowerCase()));
  const wanted = [...new Set([draftOwner, author, ...reviewersDone, ...othersOpen.map((row) => row.by)].filter(Boolean))].join("|");
  useEffect(() => {
    let live = true;
    // A person Door43 could not name comes back as their login, exactly: that is no name, and the screen keeps
    // «@login». «Ana» for «ana» is a name.
    for (const login of wanted ? wanted.split("|") : []) void door43Person(login).then((found) => live && found.name && found.name !== login && setNames((prev) => (prev[login.toLowerCase()] === found.name ? prev : { ...prev, [login.toLowerCase()]: found.name })));
    return () => {
      live = false;
    };
  }, [wanted]);


  /** What the person can do now, said in one line next to the button that does it. */
  const status = !step
    ? ""
    : stepDone
      ? t("rv.stepDone")
      : approved
        ? authorPending && !isAuthor
          ? t("rv.youApprovedAuthor").replace("{who}", author ? nameOf(author) : t("rv.theAuthor"))
          : t("rv.youApproved")
        : !unlocked
          ? sentBack
            ? byAuthor
              ? // The author took the draft back: nobody asked for changes, and saying so sent people looking for a request.
                isAuthor
                ? t("rv.correctingOwn")
                : t("rv.authorCorrecting").replace("{who}", author ? nameOf(author) : t("rv.theAuthor"))
              : t(mine ? "rv.changesForYou" : askedByMe ? "rv.youAskedChanges" : "rv.changesPending")
            : t(mine ? "rv.finishDraftFirst" : "rv.draftNotFinished")
        : canApprove
          ? canAsk
            ? `${t(mineOpen.length === 1 ? "rv.askForOne" : "rv.askForMany").replace("{n}", String(mineOpen.length)).replace("{who}", draftOwner ? nameOf(draftOwner) : t("rv.theAuthor"))}${othersOpen.length ? t("rv.askAlso").replace("{who}", othersNamed) : ""}`
            : askFinish
              ? t(missing === 1 ? "rv.missingAskOne" : "rv.missingAskMany").replace("{n}", String(missing))
              : openByOthers
                ? t(othersOpen.length === 1 ? "rv.openByOne" : "rv.openByMany").replace("{who}", othersNamed)
            : openSaid || (mine && reviewersDone.length ? t("rv.agreeOwnApproved").replace("{who}", reviewersDone.map(nameOf).join(", ")) : t(mine ? "rv.agreeOwn" : "rv.readThenApprove").replace("{piece}", t(pieceWord)))
          : canTake
            ? t(runtime?.assignees.length ? "rv.takeOneMore" : "rv.takeFirst")
            : mine
              ? t("rv.waitingReviewers")
              : seated
                ? t("rv.seatedWait")
                : keptOut
                  ? t("rv.keptOut")
                  : t("rv.onlyRead");

  const marked = (before: string, now: string) => diffWords(before, now).map((part, index) => (part.kind === "same" ? part.text : part.kind === "added" ? <ins key={index}>{part.text}</ins> : <del key={index}>{part.text}</del>));
  /** A piece of the second round that changed: what it said when the draft went back against what it says now, as the editor box has it. */
  const markedAt = (place: string): React.ReactNode | null => {
    if (!changedSet.has(place)) return null;
    const was = thenAt?.(place);
    const is = textAt?.(place);
    if (!was && !is) return null;
    const second = was?.secondary !== undefined || is?.secondary !== undefined;
    return (
      <>
        {marked(was?.text ?? "", is?.text ?? "")}
        {second ? <>{"\n"}{marked(was?.secondary ?? "", is?.secondary ?? "")}</> : null}
      </>
    );
  };
  /** The dots of a closed piece: it has a conversation; it has something open. */
  const dotsAt = (place: string) => {
    const about = comments.filter((row) => row.ref === place);
    return { talk: about.length > 0, open: about.some((row) => open.includes(row)) };
  };
  // «Ver lo que cambió» is for the first round, and only where the team's text already had words in that piece.
  const showChangesToggle = !roundSha && items.some((item) => item.state === "changed" && (!item.help || rowCorrected(item)));
  // The second round: said once, over the passage, and it leads to the first piece that changed.
  const roundLine =
    roundSha && changedRefs && marker ? (
      <p className="rv-round" data-round={changedRefs.length ? "changed" : "same"}>
        {(() => {
          const who = draftOwner ? nameOf(draftOwner) : t("rv.theAuthor");
          const verses = ctx?.resource === "tpl" || ctx?.resource === "tps";
          if (!changedRefs.length) return t("rv.sinceNone").replace("{who}", who);
          const said = t(`rv.since${verses ? "Verses" : "Pieces"}${changedRefs.length === 1 ? "One" : "Many"}`).replace("{who}", who).replace("{n}", String(changedRefs.length));
          return (
            <button type="button" className="rv-round__link" onClick={() => goToPiece(changedRefs[0]!)}>
              {said}
            </button>
          );
        })()}
      </p>
    ) : null;
  // The draft is compared with the text it translates: that one is shown. The two used to be shown together for
  // every verse, and whoever reviewed could not tell which of them the draft had to say the same as.
  const ownSource = sources.find((source) => (ctx?.resource === "tps" ? /ust|gst|tps/i : /ult|glt|tpl/i).test(source.short)) ?? sources[0];
  const versesOf = (verse: number) => {
    const others = sources.filter((source) => source !== ownSource && source.verses[verse]);
    if (!ownSource?.verses[verse] && !others.length) return null;
    return (
      <div className="rv-sources-box">
        <dl className="rv-sources">
          {(support ? [ownSource, ...others] : [ownSource]).map((source) =>
            source?.verses[verse] ? (
              <div key={source.short} data-support={source !== ownSource || undefined}>
                <dt>{source.short}</dt>
                <dd>{source.verses[verse]}</dd>
              </div>
            ) : null,
          )}
        </dl>
        {others.length ? (
          <button type="button" className="se-peek__more" aria-pressed={support} onClick={() => setSupport(!support)}>
            {t(support ? "se.supportHide" : "se.supportShow").replace("{name}", others.map((source) => source.short).join(", "))}
          </button>
        ) : null}
      </div>
    );
  };

  /** One piece of what is reviewed that is not an article shown by its own pieces: a verse, a row of a help, a whole file. */
  // The guide points at one verse: the first that changed, where there is one to read.
  const guideItem = (items.find((item) => item.state === "changed") ?? items[0])?.key;
  const itemRow = (item: ReviewItem) => {
    const verseNotes = notesOf(item.verse);
    // What this item's own source calls for. A verse is matched against the English text it translates;
    // a note, a question or an article against its English. Without it, every check that has words.
    const text = ctx?.resource === "tpl" || ctx?.resource === "tps";
    const kind = ctx?.resource === "tps" ? /ust|gst|tps/i : /ult|glt|tpl/i;
    const itemSource = text ? (sources.find((source) => kind.test(source.short)) ?? sources[ctx?.resource === "tps" ? 1 : 0])?.verses[item.verse] : english[item.key];
    // What the glossary decided about the words of this verse: found by the word of the original under each.
    const decided = text ? decisionsAt(item.chapter, item.verse, itemSource) : decisionsIn(itemSource);
    const own: { id: string; text: string; texts?: Partial<Record<string, string>>; when?: string[]; by?: string }[] = [
      ...itemChecks(step?.checks ?? [], itemSource),
      ...itemChecks(teamRules ? activeRules(teamRules) : [], itemSource).map((rule) => ({ id: `team-${rule.id}`, text: ruleText(rule, language), when: rule.when, by: rule.by })),
    ];
    // A row of a help is read as what it says, against what the source says: its other columns only place it.
    const help = item.help;
    const source = help ? sourceRows[item.key] : undefined;
    const pending = rowPending(item);
    const corrected = rowCorrected(item);
    const firstOfVerse = items.find((other) => other.chapter === item.chapter && other.verse === item.verse)?.key === item.key;
    // What was said about this note. A comment from before names only the verse: it goes once, with the first of them.
    const place = placeOf(item);
    const about = comments.filter((row) => (row.ref === place || (place !== item.ref && firstOfVerse && row.ref === item.ref)) && !(row.proposal && item.state === "removed"));
    const saidByMe = about.some((row) => !row.resolved && row.by.toLowerCase() === me.toLowerCase());
    // One piece open at a time; one with words written in its box stays open (A1).
    const isOpen = openItem === place || Boolean(boxes.get(`v:${item.key}`)?.trim()) || proposalTouched(`v:${item.key}`);
    const dots = { talk: about.length > 0, open: about.some((row) => open.includes(row)) };
    // Second round: what changed since the draft went back. First round: what the team's text said, if the toggle is on.
    const round = markedAt(place);
    const teamMarks = showChanges && !roundSha;
    const toggle = (event: React.MouseEvent<HTMLElement>) => {
      const row = event.currentTarget.closest("li");
      const top = row?.getBoundingClientRect().top ?? 0;
      flushSync(() => {
        pieces.setActive(null);
        setOpenItem(openItem === place ? null : place);
      });
      if (row && pieces.pane.current) holdAt(pieces.pane.current, row, top);
    };

    const readText = () => {
      if (help) {
        if (item.state === "removed") return <p className="rv-item__text"><del>{[help.before, help.beforeSecondary].filter(Boolean).join("\n")}</del></p>;
        if (pending) {
          // Of a question, the part that was translated is still read; the other is said to be missing.
          return (
            <>
              {help.secondary !== undefined && !partsPending(item).text ? <HelpMarkdownView content={help.text} /> : null}
              <p className="rv-help__none">
                {t(help.secondary === undefined || (partsPending(item).text && partsPending(item).secondary) ? "ab.untranslated" : partsPending(item).secondary ? "rv.answerUntranslated" : "rv.questionUntranslated")}
              </p>
              {help.secondary && !partsPending(item).secondary ? <HelpMarkdownView content={help.secondary} /> : null}
            </>
          );
        }
        if (round) return <p className="rv-item__text">{round}</p>;
        if (corrected && teamMarks) {
          return (
            <>
              <p className="rv-item__text">{marked(help.before, help.text)}</p>
              {help.secondary !== undefined ? <p className="rv-item__text">{marked(help.beforeSecondary ?? "", help.secondary)}</p> : null}
            </>
          );
        }
        return (
          <>
            <HelpMarkdownView content={help.text} />
            {help.secondary ? <HelpMarkdownView content={help.secondary} /> : null}
          </>
        );
      }
      if (item.state === "empty") return <p className="rv-item__text rv-item__text--none">{t("rv.notWritten")}</p>;
      if (round) return <p className="rv-item__text">{round}</p>;
      if (!item.chapter && !(item.state === "changed" && teamMarks) && item.state !== "removed") {
        // An article is read with its headings and lists; its marks are shown only where words are compared.
        return <HelpMarkdownView className="rv-item__text rv-item__text--article" content={item.now} />;
      }
      return <p className={`rv-item__text${item.chapter ? "" : " rv-item__text--raw"}`}>{item.state === "changed" && teamMarks ? marked(item.before, item.now) : item.state === "removed" ? <del>{item.before}</del> : (item.chapter ? textAt?.(place)?.text : undefined) || item.now}</p>;
    };

    return (
      <li key={item.key} className="rv-item rv-piece" data-guide={item.key === guideItem ? "rv-item" : undefined} data-piece="" data-ref={item.ref} data-place={place} data-row={help ? item.key : undefined} data-state={pending ? "same" : item.state} data-open={isOpen ? "true" : undefined} data-changed={round ? "true" : undefined}>
        {/* Closed, a piece is its place and its text: touching it opens what goes with it, under. */}
        <button type="button" className="rv-piece__read" aria-expanded={isOpen} onClick={toggle}>
          <span className="rv-piece__ref">{item.ref}</span>
          <div className="rv-piece__text">{readText()}</div>
          {dots.talk || dots.open ? (
            <span className="rv-dots">
              {dots.talk ? <span className="rv-dot" data-kind="talk" role="img" aria-label={t("rv.dotTalk")} /> : null}
              {dots.open ? <span className="rv-dot" data-kind="open" role="img" aria-label={t("rv.dotOpen")} /> : null}
            </span>
          ) : null}
        </button>
        {isOpen ? (
          <div className="rv-piece__more">
            {help?.quote !== undefined ? (
              <NoteQuote sources={helpSources} book={(ctx?.book || "").toUpperCase()} chapter={item.chapter} verse={item.verse} quote={help.quote} occurrence={help.occurrence ?? 1} />
            ) : help ? (
              // Several questions may be of one verse: it is read once, with the first of them.
              firstOfVerse ? versesOf(item.verse) : null
            ) : (
              versesOf(item.verse)
            )}
            {source ? (
              <div className="rv-help__source">
                <HelpMarkdownView content={source.text} />
                {source.secondary ? <HelpMarkdownView content={source.secondary} /> : null}
              </div>
            ) : null}
            {help && pending ? (
              <>
                {/* Said by a touch: there is nothing else to say about a note nobody translated. */}
                {!mine && !saidByMe ? (
                  <button type="button" className="rv-help__say" disabled={acting} onClick={() => comment(place, t("rv.missingSaid"))}>
                    <MessageSquare size={16} aria-hidden /> {t("rv.sayMissing")}
                  </button>
                ) : null}
                {helpRowsMissing.length > 1 ? (
                  <button type="button" className="rv-item__add" onClick={() => toMissing(item.key)}>
                    {t("rv.nextMissing")}
                  </button>
                ) : null}
              </>
            ) : null}
            {/* Under a note the notes of its verse would be itself and its neighbours again. */}
            {verseNotes.length && help?.quote === undefined ? (
              <details className="rv-notes">
                <summary>{t(verseNotes.length === 1 ? "rv.notesOne" : "rv.notesMany").replace("{n}", String(verseNotes.length))}</summary>
                <ul className="fam-notes">
                  {verseNotes.map((note) => (
                    <li key={note.id}>
                      {noteHeading(helpSources, (ctx?.book || "").toUpperCase(), item.chapter, note) ? <p className="fam-notes__quote">{noteHeading(helpSources, (ctx?.book || "").toUpperCase(), item.chapter, note)}</p> : null}
                      {note.body && note.body !== note.title ? (
                        <div className="fam-notes__body">
                          <HelpMarkdownView content={note.body} />
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {(own.length || decided.length) && item.state !== "removed" && item.state !== "empty" && !pending ? (
              <div className="rv-checks">
                <Hints
                  lead={t("sa.mind")}
                  context={{ ref: item.ref, source: itemSource, sourceName: text ? ownSource?.short : undefined, translation: help ? help.text : item.now }}
                  lines={[
                    ...decided,
                    ...own.map((check) => {
                      const said = check.texts?.[language] ?? check.text;
                      // In an article the check says in which paragraphs of the English it comes up.
                      const where = !item.chapter && itemSource ? paragraphsFor(check, itemSource) : [];
                      return { id: check.id, by: check.by, text: where.length ? `${said} · ${t(where.length === 1 ? "rv.paragraphOne" : "rv.paragraphMany").replace("{n}", where.join(", "))}` : said };
                    }),
                  ]}
                />
              </div>
            ) : null}
            {commentList(about, `v:${item.key}`, (row) => commentRow(row, itemSource, { chapter: item.chapter, verse: item.verse, text }))}
            {/* «No del todo…»: other words for this piece, or a comment. */}
            <div className="rv-say" data-slot="not-quite">
              {sayUnder({
                key: `v:${item.key}`,
                ref: place,
                initial: item.state === "removed" || item.state === "empty" || pending ? undefined : textAt?.(place),
                placeholder: t("rv.commentOn").replace("{ref}", item.ref),
                guide: item.key === guideItem,
              })}
            </div>
          </div>
        ) : null}
      </li>
    );
  };

  // An article: the files that can be read piece by piece, each piece against its source.
  const byPieces = (file: ArticleFile & { text: string }) => Boolean(english[file.filename]) && rowsPossible(english[file.filename]!, file.text);
  const inPieces = articleFiles.filter(byPieces).map((file) => file.filename);
  const introByPieces = (intro: IntroItem & { source: string }) => Boolean(intro.source) && rowsPossible(intro.source, intro.now);
  /** What is read piece by piece, as it follows on the screen: the introductions of a draft of notes, the files of an article. */
  const longIds = [...intros.filter(introByPieces).map((intro) => intro.key), ...inPieces];
  const pieceRefs = new Set([
    ...articleFiles.filter(byPieces).flatMap((file) => Array.from({ length: pieces.counts[file.filename]?.count ?? 0 }, (_, index) => pieceRef(file.filename, index))),
    ...intros.filter(introByPieces).flatMap((intro) => Array.from({ length: pieces.counts[intro.key]?.count ?? 0 }, (_, index) => introPieceRef(intro.chapter, index))),
  ]);
  const piecesDone = inPieces.reduce((sum, id) => sum + (pieces.counts[id]?.done ?? 0), 0);
  const piecesTotal = inPieces.reduce((sum, id) => sum + (pieces.counts[id]?.total ?? 0), 0);
  // What is said about a piece is shown with the piece; the rest is about the whole draft.
  // A proposal about a row that is no longer in the draft has no piece to be read under: it goes here, with its place.
  const general = comments.filter((row) => !row.ref || !(items.some((item) => (item.ref === row.ref || placeOf(item) === row.ref) && !(row.proposal && item.state === "removed")) || pieceRefs.has(row.ref)));
  const openPiece = openItem || pieces.active ? (placeInView() ?? null) : null;

  // Whoever comes to review finds the first piece open: where to start, and how the rest is opened.
  useEffect(() => {
    if (firstOpened.current || !longIds.length || longIds.some((id) => !pieces.counts[id])) return;
    firstOpened.current = true;
    // Opened from a comment about a paragraph (the conversation): that paragraph is the one found open.
    const named = (id: string, refOf: (index: number) => string) => {
      const index = ctx?.focus ? Array.from({ length: pieces.counts[id]?.count ?? 0 }, (_, at) => refOf(at)).indexOf(ctx.focus) : -1;
      return index >= 0 ? { id, index } : null;
    };
    const focused =
      articleFiles.filter(byPieces).map((file) => named(file.filename, (index) => pieceRef(file.filename, index))).find(Boolean) ??
      intros.filter(introByPieces).map((intro) => named(intro.key, (index) => introPieceRef(intro.chapter, index))).find(Boolean);
    const first = longIds.find((id) => pieces.counts[id]!.count > 0);
    if (focused) pieces.show(focused.id, focused.index);
    else if (first) pieces.show(first, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieces.counts, longIds.join("|")]);

  // «Tienes 2 comentarios sin resolver» was said at the foot of thirty screens of notes, with the two of them
  // somewhere in between: the foot leads to each in turn. One about a note or a verse is brought to the top; one about
  // a paragraph of an article or of an introduction opens that paragraph; one about the whole draft is at the end.
  const openAt = useRef(-1);
  /** Open the verse or row that holds what is said at `ref` (its comments are drawn only inside the open piece). */
  const openItemAt = (ref: string) => {
    const item = items.find((other) => placeOf(other) === ref) ?? items.find((other) => other.ref === ref);
    if (!item) return;
    flushSync(() => {
      pieces.setActive(null);
      setOpenItem(placeOf(item));
    });
  };
  const toOpenComment = () => {
    if (!open.length) return;
    openAt.current = (openAt.current + 1) % open.length;
    const row = open[openAt.current]!;
    const pane = pieces.pane.current;
    let shown = pane?.querySelector(`.rv-comment[data-comment="${row.id}"]`);
    if (!shown && row.ref) {
      openItemAt(row.ref);
      shown = pane?.querySelector(`.rv-comment[data-comment="${row.id}"]`);
    }
    if (shown) return (shown.closest(".rv-item") ?? shown).scrollIntoView({ block: "start", behavior: "smooth" });
    const at = (id: string, refOf: (index: number) => string) => Array.from({ length: pieces.counts[id]?.count ?? 0 }, (_, index) => refOf(index)).indexOf(row.ref);
    for (const file of articleFiles.filter(byPieces)) {
      const index = at(file.filename, (i) => pieceRef(file.filename, i));
      if (index >= 0) return pieces.show(file.filename, index);
    }
    for (const intro of intros.filter(introByPieces)) {
      const index = at(intro.key, (i) => introPieceRef(intro.chapter, i));
      if (index >= 0) return pieces.show(intro.key, index);
    }
    pane?.querySelector(".rv-general")?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  /** Bring a piece to the screen by its place: a verse or a row is scrolled to, a paragraph is opened. */
  const goToPiece = (ref: string) => {
    const pane = pieces.pane.current;
    const row = pane?.querySelector(`.rv-item[data-place="${CSS.escape(ref)}"]`);
    if (row) return row.scrollIntoView({ block: "start", behavior: "smooth" });
    const at = (id: string, refOf: (index: number) => string) => Array.from({ length: pieces.counts[id]?.count ?? 0 }, (_, index) => refOf(index)).indexOf(ref);
    for (const file of articleFiles.filter(byPieces)) {
      const index = at(file.filename, (i) => pieceRef(file.filename, i));
      if (index >= 0) return pieces.show(file.filename, index);
    }
    for (const intro of intros.filter(introByPieces)) {
      const index = at(intro.key, (i) => introPieceRef(intro.chapter, i));
      if (index >= 0) return pieces.show(intro.key, index);
    }
  };

  // What was on the screen, at some moment, inside the part that scrolls (not the window): the foot counts it as read.
  useEffect(() => {
    const root = pieces.pane.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const watch = new IntersectionObserver(
      (entries) => {
        const now = entries.filter((entry) => entry.isIntersecting).map((entry) => (entry.target as HTMLElement).dataset.place);
        const places = now.filter((place): place is string => Boolean(place));
        if (places.length) setSeen((prev) => (places.every((place) => prev.has(place)) ? prev : new Set([...prev, ...places])));
      },
      { root },
    );
    const found = Array.from(root.querySelectorAll<HTMLElement>("[data-piece][data-place]"));
    found.forEach((element) => watch.observe(element));
    const keys = [...new Set(found.map((element) => element.dataset.place!))];
    setReadingKeys((prev) => (prev.length === keys.length && prev.every((key, at) => key === keys[at]) ? prev : keys));
    return () => watch.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, intros, articleFiles, pieces.counts, pieces.active, openItem, busy, marker, sourcesRead]);

  // Opened from a comment about a verse: its row is brought to the top.
  const rowFocused = useRef(false);
  useEffect(() => {
    if (rowFocused.current || busy || !ctx?.focus || !items.length) return;
    const find = () => pieces.pane.current?.querySelector(`.rv-item[data-place="${CSS.escape(ctx.focus!)}"]`) ?? pieces.pane.current?.querySelector(`.rv-item[data-ref="${CSS.escape(ctx.focus!)}"]`);
    if (!find()) return;
    rowFocused.current = true;
    // A comment of a closed piece is drawn only when the piece is open: open it, then scroll.
    if (comments.some((comment) => comment.ref === ctx.focus)) openItemAt(ctx.focus);
    find()?.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, busy, ctx?.focus, comments]);

  /** What goes with the piece being read: what its source calls for, the comments about it, and a box to add one. */
  const underPiece = (ref: string, source: string, pending: boolean) => {
    const about = comments.filter((row) => row.ref === ref);
    const own: { id: string; text: string; texts?: Partial<Record<string, string>>; by?: string }[] = pending
      ? []
      : [...itemChecks(step?.checks ?? [], source), ...itemChecks(teamRules ? activeRules(teamRules) : [], source).map((rule) => ({ id: `team-${rule.id}`, text: ruleText(rule, language), by: rule.by }))];
    const decidedHere = pending ? [] : decisionsIn(source);
    return (
      <>
        {own.length || decidedHere.length ? (
          <div className="rv-checks">
            <Hints lead={t("sa.mind")} lines={[...decidedHere, ...own.map((check) => ({ id: check.id, by: check.by, text: check.texts?.[language] ?? check.text }))]} />
          </div>
        ) : null}
        {commentList(about, `p:${ref}`, (row) => commentRow(row, source, { text: false }))}
        {/* «No del todo…»: other words for this paragraph, or a comment. */}
        <div className="rv-say" data-slot="not-quite">
          {sayUnder({ key: `p:${ref}`, ref, initial: pending ? undefined : textAt?.(ref), placeholder: t("rv.commentPiece") })}
        </div>
      </>
    );
  };

  return (
    <div className="scripture-editor fam">
      <ToolHeader
        title={passageName}
        onBack={() => whenSent(onClose, true)}
        meta={
          <>
            {[stepName, ctx?.taskName ? localizeName(ctx.taskName, language) : "", draftOwner ? (mine ? t("pr.yourDraft") : t("pr.draftOf").replace("{who}", draftOwner)) : ""].filter(Boolean).join(" · ")}
            {pull?.merged ? t("pr.merged") : ""}
          </>
        }
      />
      <div className="step-ask-bar">
        <StepAsk session={session} ctx={ctx ? { ...ctx, stepId: stepId || ctx.stepId } : ctx} forAuthor={isAuthor && step?.closing === "approval" && author ? { readers: readersOfMyDraft(progress, step, author) } : undefined} />
      </div>
      {/* A draft found later in this screen brings the steps about reading it. */}
      <ReviewGuide open={openItem !== null} mine={mine} ready={!busy && Boolean(issue && range)} watch={`${marker ? "draft" : ""}:${items.length}`} />

      {error ? (
        <Alert variant="destructive" className="mx-4 mt-3">
          <AlertDescription>{localizeThread(error, language)}</AlertDescription>
        </Alert>
      ) : null}

      {busy ? (
        <LoadingState shape="tool" label={t("pr.loading")} />
      ) : issue && range ? (
        <>
        <div className="fam__body" ref={pieces.pane} data-seen={seen.size} data-open-piece={openPiece ?? undefined}>
          {!marker ? (
            <div className="rv-empty">
              <p>{t(article ? "rv.noDraftYetArticle" : "rv.noDraftYet")}</p>
              <Button type="button" variant="outline" disabled={acting} onClick={() => void openReview()}>
                {acting ? t("se.opening") : t("rv.lookForDraft")}
              </Button>
            </div>
          ) : (
            <>
              {roundLine}
              {articleFiles.length ? (
                // An article is read as an article: each piece opens against its source, with what is said about it.
                !sourcesRead ? (
                  <p className="pe-hint" aria-busy="true">{t("rv.sourceLoading")}</p>
                ) : (
                  <>
                    <p className="ab-hint">
                      {inPieces.length ? t("rv.piecesHint") : ""}
                      {piecesTotal ? ` ${t("rv.piecesDone").replace("{n}", String(piecesDone)).replace("{total}", String(piecesTotal))}.` : ""}
                    </p>
                    {articleFiles.map((file) =>
                      byPieces(file) ? (
                        <ArticleBlocks
                          key={file.filename}
                          id={`rv-${file.filename}`}
                          readOnly
                          part={file.part}
                          source={english[file.filename]!}
                          value={file.text}
                          known={known}
                          open={pieces.active?.id === file.filename ? pieces.active.index : null}
                          onOpen={(index, element) => {
                            setOpenItem(null);
                            pieces.open(file.filename, index, element);
                          }}
                          onProgress={(done, total, firstPending, count) => pieces.report(file.filename, done, total, firstPending, count)}
                          hasNext={pieces.active?.id === file.filename ? Boolean(pieces.after(longIds, file.filename, pieces.active.index)) : false}
                          onNext={(index) => pieces.next(longIds, file.filename, index)}
                          placeOf={(index) => pieceRef(file.filename, index)}
                          dotsOf={(index) => dotsAt(pieceRef(file.filename, index))}
                          markedOf={(index) => markedAt(pieceRef(file.filename, index))}
                          below={(index, row, pending) => underPiece(pieceRef(file.filename, index), row.source, pending)}
                        />
                      ) : items.some((item) => item.key === file.filename) ? (
                        // A file this screen cannot read by pieces (no source, or a format it would not write back the same): whole.
                        <ol key={file.filename} className="rv-list">
                          {items.filter((item) => item.key === file.filename).map(itemRow)}
                        </ol>
                      ) : null,
                    )}
                  </>
                )
              ) : (
              <>
              {helpRowsMissing.length || showChangesToggle ? (
                <div className="rv-bar">
                  {helpRowsMissing.length ? (
                    <button type="button" className="rv-bar__missing" onClick={() => toMissing()}>
                      {t(helpRowsMissing.length === 1 ? "rv.seeMissingOne" : "rv.seeMissingMany").replace("{n}", String(helpRowsMissing.length))}
                    </button>
                  ) : null}
                  {showChangesToggle ? (
                    <label className="rv-toggle">
                      <input type="checkbox" checked={showChanges} onChange={(e) => setShowChanges(e.target.checked)} /> {t("rv.showChanges")}
                    </label>
                  ) : null}
                </div>
              ) : null}

              {intros.map((intro) => (
                <section key={intro.key} className="he-intro">
                  <h2 className="he-intro__name">{intro.chapter ? t("fa.chapterIntro").replace("{n}", String(intro.chapter)) : t("fa.bookIntro")}</h2>
                  {introByPieces(intro) ? (
                    <>
                      <p className="ab-hint">{t("rv.piecesHint")}</p>
                      <ArticleBlocks
                        id={`rv-${intro.key}`}
                        readOnly
                        source={intro.source}
                        value={intro.now}
                        known={known}
                        open={pieces.active?.id === intro.key ? pieces.active.index : null}
                        onOpen={(index, element) => {
                          setOpenItem(null);
                          pieces.open(intro.key, index, element);
                        }}
                        onProgress={(done, total, firstPending, count) => pieces.report(intro.key, done, total, firstPending, count)}
                        hasNext={pieces.active?.id === intro.key ? Boolean(pieces.after(longIds, intro.key, pieces.active.index)) : false}
                        onNext={(index) => pieces.next(longIds, intro.key, index)}
                        placeOf={(index) => introPieceRef(intro.chapter, index)}
                        dotsOf={(index) => dotsAt(introPieceRef(intro.chapter, index))}
                        markedOf={(index) => markedAt(introPieceRef(intro.chapter, index))}
                        below={(index, row, pending) => underPiece(introPieceRef(intro.chapter, index), row.source, pending)}
                      />
                    </>
                  ) : (
                    // Without its source, or in a shape that cannot be read by pieces: as it is, whole.
                    <HelpMarkdownView className="rv-item__text rv-item__text--article" content={intro.now} />
                  )}
                </section>
              ))}

              {!items.length && !intros.length ? <p className="pe-hint">{t("rv.noText")}</p> : null}

              <ol className="rv-list">
                {items.map(itemRow)}
              </ol>
              </>
              )}

              <section className="rv-general">
                {boxes.has(GENERAL_BOX) ? (
                  <Composer
                    focus
                    placeholder={t("rv.generalPlaceholder")}
                    busy={acting}
                    box={GENERAL_BOX}
                    text={boxes.get(GENERAL_BOX) ?? ""}
                    onText={(text) => setBoxText(GENERAL_BOX, text)}
                    cancel={{ label: t("rv.cancelEdit"), run: () => closeBox(GENERAL_BOX) }}
                    actions={[{ label: t("rv.comment"), primary: true, run: (text) => comment("", text, false, GENERAL_BOX) }]}
                  />
                ) : (
                  <button type="button" className="rv-item__add" onClick={() => openBox(GENERAL_BOX)}>
                    <MessageSquare size={14} aria-hidden /> {t(article ? "rv.sayGeneralArticle" : "rv.sayGeneral")}
                  </button>
                )}
                {commentList(general, "g:", (row) => commentRow(row, undefined, undefined, row.ref || undefined))}
              </section>
            </>
          )}

        </div>
          {/* Without a draft there is nothing to read yet: the empty state says so, and a second line saying "you can read it" contradicted it. */}
          {status && marker ? (
            <div className="tool-foot rv-foot">
              <p className="rv-foot__line">
                {canDeliver ? t("rv.deliverLine") : status}
                {open.length && step && !stepDone ? (
                  <>
                    {" "}
                    <button type="button" className="tool-foot__link rv-foot__link" onClick={toOpenComment}>
                      {t(open.length === 1 ? "rv.seeOpenOne" : "rv.seeOpenMany")}
                    </button>
                  </>
                ) : null}
              </p>
              {/* Without a button (the draft is not finished yet), the guide has nothing here to point at. */}
              <div className="tool-foot__actions" data-guide="rv-foot">
                {canCorrect ? (
                  // What a reviewer says is usually answered by correcting: the author does not wait to be sent back.
                  // While something is open it is the one thing to do, and leads to the first place that is open.
                  <Button type="button" variant={isAuthor && open.length ? "default" : "outline"} disabled={acting} data-fix-draft onClick={() => whenSent(() => void correct(firstOpenPlace), true)}>
                    {t("rv.correct")}
                  </Button>
                ) : sentBack && isAuthor && issue ? (
                  <Button type="button" disabled={acting} data-fix-draft onClick={() => whenSent(() => void act(() => openDraft(issue, firstOpenPlace)), true)}>
                    {t("rv.openDraft")}
                  </Button>
                ) : null}
                {canChange ? (
                  // Approved, and something is to be changed: the review opens again for whoever made it.
                  <Button type="button" variant="outline" disabled={acting} onClick={() => setChanging(true)}>
                    {t("rv.changeReview")}
                  </Button>
                ) : null}
                {canDeliver ? (
                  <>
                    <Button type="button" disabled={acting} onClick={() => whenSent(deliver, true)}>
                      {t("rv.deliver")}
                    </Button>
                    <Button type="button" variant="ghost" className="tool-foot__back" onClick={() => whenSent(onClose, true)}>
                      {t("fa.back")}
                    </Button>
                  </>
                ) : stepDone || approved ? (
                  <Button type="button" onClick={() => whenSent(onClose, true)}>
                    {t("fa.back")}
                  </Button>
                ) : canApprove && canAsk && !askFinish ? (
                  <Button type="button" disabled={acting} onClick={askNow}>
                    {acting ? t("wf.saving") : t("rv.askChanges")}
                  </Button>
                ) : canApprove && askFinish ? (
                  <>
                    {/* Something the app takes for untranslated may be right as it is (a name): approving stays possible. */}
                    <Button type="button" variant="outline" disabled={acting} onClick={() => whenSent(() => void approve())}>
                      {t("rv.approveAnyway")}
                    </Button>
                    <Button type="button" disabled={acting} onClick={askFinishNow}>
                      {acting ? t("wf.saving") : t("rv.askFinish")}
                    </Button>
                  </>
                ) : canApprove ? (
                  <>
                    {mine ? (
                      // Nothing open: «Para mí está bien». With something open it is not offered, not even off: the way on is
                      // «Corregir mi borrador».
                      open.length > 0 ? null : (
                        <Button type="button" disabled={acting} onClick={() => whenSent(() => void approve())}>
                          <Check size={16} aria-hidden /> {acting ? t("wf.saving") : t("rv.agree")}
                        </Button>
                      )
                    ) : openByOthers ? null : (
                      // With a border until the last piece was seen; touching it then asks, it does not block.
                      <Button type="button" variant={readToEnd ? "default" : "outline"} disabled={acting} data-read={readToEnd} onClick={() => (readToEnd ? whenSent(() => void approve()) : setAgreeAsk(true))}>
                        <Check size={16} aria-hidden /> {acting ? t("wf.saving") : t("rv.iAgree")}
                      </Button>
                    )}
                  </>
                ) : canTake ? (
                  <Button type="button" disabled={acting} onClick={() => void take()}>
                    {acting ? t("wf.saving") : t("rv.take")}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      <ConfirmDialog
        open={agreeAsk}
        safe
        title={t("rv.agreeEarlyTitle")}
        text={t("rv.agreeEarlyText")}
        yes={t("rv.agreeEarlyYes")}
        no={t("rv.agreeEarlyKeep")}
        onYes={() => {
          setAgreeAsk(false);
          whenSent(() => void approve());
        }}
        onNo={() => setAgreeAsk(false)}
      />
      <StageWindow
        open={askedWindow}
        title={t("rv.askedTitle").replace("{who}", draftOwner ? nameOf(draftOwner) : t("rv.theAuthor"))}
        text={t("rv.askedText")}
        go={t("rv.askedGo")}
        onGo={() => {
          setAskedWindow(false);
          onClose();
        }}
        onClose={() => setAskedWindow(false)}
      />
      <ConfirmDialog
        open={changing}
        safe
        title={t("rv.changeReviewTitle")}
        text={t(author && approvals.includes(author.toLowerCase()) ? "rv.changeReviewTextAuthor" : "rv.changeReviewText").replace("{who}", author ?? "")}
        yes={t("rv.changeReviewYes")}
        onYes={() => {
          setChanging(false);
          void reopenMine();
        }}
        onNo={() => setChanging(false)}
      />
      <ConfirmDialog
        open={Boolean(unsentAsk)}
        safe
        title={unsentSaid}
        text={t(unsentProposals === 0 ? "rv.unsentHow" : unsentProposals === unsent.length ? "rv.unsentHowProposal" : "rv.unsentHowBoth")}
        yes={t(unsentAsk?.leaving ? "rv.unsentLeave" : "rv.unsentDrop")}
        no={t("rv.unsentKeep")}
        onYes={() => answerUnsent(true)}
        onNo={() => answerUnsent(false)}
      />
      {(() => {
        const row = comments.find((other) => other.id === menuFor);
        const facts = row ? factsOf(row) : null;
        return (
          <Dialog open={Boolean(row)} onOpenChange={(next) => (next ? undefined : setMenuFor(0))}>
            <DialogContent className="fix-sheet rv-menu" aria-describedby={undefined} showCloseButton={false}>
              <div className="fx-head">
                <DialogTitle className="fx-title">{t("rv.moreTitle")}</DialogTitle>
              </div>
              {row && facts ? (
                <div className="rv-menu__list">
                  {facts.editable ? (
                    <>
                      <button type="button" className="rv-menu__item" onClick={() => { setMenuFor(0); setEditing(row.id); }}>
                        {t("rv.editComment")}
                      </button>
                      <button type="button" className="rv-menu__item" onClick={() => { setMenuFor(0); setDeleting(row); }}>
                        {t("rv.deleteComment")}
                      </button>
                    </>
                  ) : null}
                  {facts.canRule ? (
                    <button type="button" className="rv-menu__item" onClick={() => { setMenuFor(0); setRuling({ id: String(row.id), busy: false, failed: "" }); }}>
                      {t("rv.asRule")}
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="rv-menu__foot">
                <Button type="button" variant="outline" className="rv-menu__close" onClick={() => setMenuFor(0)}>
                  {t("rv.cancelEdit")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        );
      })()}
      <ConfirmDialog
        open={Boolean(deleting)}
        safe
        title={t("rv.deleteCommentTitle")}
        text={deleting ? commentWords(deleting).words : ""}
        yes={t("rv.deleteCommentYes")}
        onYes={() => {
          const row = deleting;
          setDeleting(null);
          if (row) void changeComment(row, null);
        }}
        onNo={() => setDeleting(null)}
      />
    </div>
  );
}
