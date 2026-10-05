import { Checks, StepAsk } from "./StepAsk";
import { readRaw } from "../dcs/afinacionLoad";
import { resolveSourcePackage } from "../domain/sourcePackage";
import { itemChecks, paragraphsFor } from "../domain/stepChecks";
import { activeRules, ruleText } from "../domain/teamRules";
import { useTeamRules } from "../useTeamRules";
import { ToolHeader } from "./ToolHeader";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DcsIssue } from "@ip-lms/dcs-client";
import { Check, MessageSquare } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { loadSession, type GtSession } from "../dcs/auth";
import { loadPmConfig, setIssueTaskProgress } from "../dcs/issues";
import { loadAssignmentsFromDcs, loadInventoryFromDcs } from "../dcs/persist";
import { commentOnPortionPr, ensurePortionPr, getPmIssue, loadLinkedPull, loadLinkedPullFiles, submitPortionPrApproval } from "../dcs/portionPr";
import type { DcsPull } from "../dcs/pulls";
import { readRepoFile } from "../dcs/repoFile";
import { loadReviewComments, type ReviewComment as Comment } from "../dcs/reviewComments";
import { explainError } from "../dcs/userError";
import { bookLabel } from "../domain/books";
import { parsePortionPrMarker, stepNeedsOpenPortionPr, translatorLoginFromHead, type PortionPrMarker } from "../domain/portionPr";
import { englishScriptureKindRef, loadEnglishHelpsForRange, loadEnglishScriptureKindUsfm, loadNotesForRange, type ReferenceHelpRow } from "../domain/referenceResources";
import { articleItems, diffWords, introItems, refComment, reviewItems, type IntroItem, type ReviewItem } from "../domain/reviewItems";
import { selectTsvRowsForPortion, tsvRowId } from "../domain/helpsDraft";
import { helpsTsvFilename } from "../domain/helpsTarget";
import { parseTsvTable } from "../prep/tsv";
import { DEFAULT_PM_CONFIG } from "../domain/roles";
import { decodeSolverLaunchContext, type SolverLaunchContext } from "../domain/solverLaunch";
import { approveStep, askForChanges, canApproveStep, canAskForChanges, canClaimStep, changesPending, claimStep, isEligibleForStep, isStepUnlocked } from "../domain/stepClaim";
import { getStepRuntime, isStepDone, parseTaskProgressMarker } from "../domain/taskProgress";
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
function Composer({ placeholder, busy, actions, focus }: { placeholder: string; busy: boolean; focus?: boolean; actions: { label: string; primary?: boolean; run: (text: string) => Promise<boolean> }[] }) {
  const [text, setText] = useState("");
  return (
    <div className="rv-composer">
      <textarea className="af-textarea" rows={2} autoFocus={focus} value={text} placeholder={placeholder} aria-label={placeholder} onChange={(e) => setText(e.target.value)} />
      <div className="rv-composer__row">
        {actions.map((action) => (
          <Button key={action.label} type="button" size="sm" variant={action.primary ? "default" : "outline"} disabled={busy || !text.trim()} onClick={() => void action.run(text).then((sent) => sent && setText(""))}>
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
  const teamRules = useTeamRules(teamName || undefined);
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
  const [showSources, setShowSources] = useState(true);
  const [showChanges, setShowChanges] = useState(true);
  const [commenting, setCommenting] = useState("");
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");

  const loadComments = useCallback(async (sess: GtSession, linked: PortionPrMarker) => setComments(await loadReviewComments(sess, linked)), []);

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
      const progressNow = parseTaskProgressMarker(nextIssue.body);
      setStepId((current) => current || (taskSteps.find((row) => stepNeedsOpenPortionPr(row) && !isStepDone(progressNow, row.id))?.id ?? ""));
      const linked = parsePortionPrMarker(nextIssue.body);
      setMarker(linked);

      // What helps to judge the draft comes apart from it: a source that fails to load does not hide the draft.
      const pmConfig = await loadPmConfig(sess, ctx.pmOrg).catch(() => DEFAULT_PM_CONFIG);
      void Promise.all((["ult", "ust"] as const).map((kind) => loadEnglishScriptureKindUsfm(sess, kind, ctx.book).catch(() => null))).then((loaded) =>
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
      void loadComments(sess, linked).catch(() => setComments([]));
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

  const draftOwner = marker ? translatorLoginFromHead(marker.head, [author, me]) : (author ?? "");
  const mine = Boolean(draftOwner) && draftOwner.toLowerCase() === me.toLowerCase();

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
      if (linked && stepNeedsOpenPortionPr(step)) await submitPortionPrApproval(session, linked, { stepName: step.name, issueNumber: fresh.number });
      const next = approveStep(current, step, me, author);
      setIssue(await setIssueTaskProgress(session, ctx.pmOrg, fresh, next));
      announce(tNow(isStepDone(next, step.id) ? "rv.approvedDone" : "rv.approvedWait"));
    });

  /** A comment, about one piece (`ref`) or about the whole draft; asking for changes names the author. */
  const comment = (ref: string, text: string, askChanges = false) =>
    act(async () => {
      if (!session || !ctx || !marker) return;
      const body = `${askChanges && draftOwner && !mine ? `@${draftOwner} ` : ""}${askChanges ? `${tNow("rv.changesAsked")} ` : ""}${text.trim()}`;
      await commentOnPortionPr(session, marker, ref ? refComment(ctx.book, ref, body) : body);
      if (askChanges && step) {
        // The draft goes back to its author. Read again first: a seat or an approval saved meanwhile is kept.
        const fresh = await getPmIssue(session, ctx.pmOrg, ctx.issueNumber);
        const next = askForChanges(parseTaskProgressMarker(fresh.body), steps, step, me);
        setIssue(await setIssueTaskProgress(session, ctx.pmOrg, fresh, next));
      }
      setCommenting("");
      announce(tNow(askChanges ? "rv.changesSent" : "pr.commentSent"));
      await loadComments(session, marker).catch(() => undefined);
    });

  const stepName = step ? localized(step.name, step.names, language) : mode === "group" ? t("pr.group") : t("pr.pairs");
  const passageName = ctx ? [bookLabel(ctx.book, language), ctx.ref].filter(Boolean).join(/^\d/.test(ctx.ref ?? "") ? " " : " · ") : stepName;
  // What is reviewed is an article, not a passage of the book: the screen calls it that.
  const article = ctx?.resource === "academia" || ctx?.resource === "palabras";
  const changed = items.filter((item) => item.state !== "same" && item.state !== "empty").length;
  /** The words of a help's row in the source package: what tells a row still in the source language from a translated one. */
  const rowVocabulary = (key: string) => (sourceRows[key] ? vocabularyOf(`${sourceRows[key]!.text} ${sourceRows[key]!.secondary ?? ""}`) : null);
  // Still as the source has it: there is nothing to review yet, and it is said so instead of shown as a translation.
  const rowPending = (item: ReviewItem) => {
    const vocabulary = item.help ? rowVocabulary(item.key) : null;
    return Boolean(item.help && vocabulary && item.state !== "removed" && untranslated(`${item.help.text} ${item.help.secondary ?? ""}`, vocabulary));
  };
  // The draft changed a row that was already in the team's language: what changed is marked. A row translated from the
  // source changed in every word, and marking them all says nothing.
  const rowCorrected = (item: ReviewItem) => {
    const vocabulary = item.help ? rowVocabulary(item.key) : null;
    return Boolean(item.help && sourceRowsRead && item.state === "changed" && item.help.before.trim() && !(vocabulary && untranslated(`${item.help.before} ${item.help.beforeSecondary ?? ""}`, vocabulary)));
  };
  const helpRowsRead = items.filter((item) => item.help && item.state !== "removed" && sourceRows[item.key]);
  const helpRowsDone = helpRowsRead.filter((item) => !rowPending(item)).length;
  const notesOf = (verse: number) => notes.filter((note) => note.verse === verse);
  const when = (iso: string) => (iso ? new Date(iso).toLocaleDateString(language, { day: "numeric", month: "short" }) : "");

  const commentRow = (row: Comment) => (
    <li key={row.id} className="rv-comment">
      <p className="rv-comment__text">{row.text}</p>
      <p className="rv-comment__meta">{[row.by ? `@${row.by}` : "", when(row.at)].filter(Boolean).join(" · ")}</p>
    </li>
  );

  /** What the person can do now, said in one line next to the button that does it. */
  const status = !step
    ? ""
    : stepDone
      ? t("rv.stepDone")
      : approved
        ? t("rv.youApproved")
        : !unlocked
          ? t(sentBack ? (mine ? "rv.changesForYou" : seated ? "rv.youAskedChanges" : "rv.changesPending") : mine ? "rv.finishDraftFirst" : "rv.draftNotFinished")
        : canApprove
          ? t(mine ? "rv.agreeOwn" : article ? "rv.readThenApproveArticle" : "rv.readThenApprove")
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
  const versesOf = (verse: number) =>
    sources.length ? (
      <dl className="rv-sources">
        {sources.map((source) =>
          source.verses[verse] ? (
            <div key={source.short}>
              <dt>{source.short}</dt>
              <dd>{source.verses[verse]}</dd>
            </div>
          ) : null,
        )}
      </dl>
    ) : null;

  /** One piece of what is reviewed that is not an article shown by its own pieces: a verse, a row of a help, a whole file. */
  const itemRow = (item: ReviewItem) => {
    const verseNotes = notesOf(item.verse);
    // What this item's own source calls for. A verse is matched against the English text it translates;
    // a note, a question or an article against its English. Without it, every check that has words.
    const text = ctx?.resource === "tpl" || ctx?.resource === "tps";
    const kind = ctx?.resource === "tps" ? /ust|gst|tps/i : /ult|glt|tpl/i;
    const itemSource = text ? (sources.find((source) => kind.test(source.short)) ?? sources[ctx?.resource === "tps" ? 1 : 0])?.verses[item.verse] : english[item.key];
    const own: { id: string; text: string; texts?: Partial<Record<string, string>>; when?: string[]; by?: string }[] = [
      ...itemChecks(step?.checks ?? [], itemSource),
      ...itemChecks(teamRules ? activeRules(teamRules) : [], itemSource).map((rule) => ({ id: `team-${rule.id}`, text: ruleText(rule, language), when: rule.when, by: rule.by })),
    ];
    const about = comments.filter((row) => row.ref === item.ref);

    // A row of a help is read as what it says, against what the source says: its other columns only place it.
    const help = item.help;
    const source = help ? sourceRows[item.key] : undefined;
    const pending = rowPending(item);
    const corrected = rowCorrected(item);
    const firstOfVerse = items.find((other) => other.chapter === item.chapter && other.verse === item.verse)?.key === item.key;
    const stateSaid = help ? (item.state === "changed" ? corrected : item.state !== "same") && !pending : item.state !== "same";

    return (
      <li key={item.key} className="rv-item" data-ref={item.ref} data-state={pending ? "same" : item.state}>
        <div className="rv-item__head">
          <span className="rv-item__ref">{item.ref}</span>
          {stateSaid ? <span className="rv-item__state">{t(`rv.state.${item.state}`)}</span> : null}
        </div>
        {!showSources ? null : help?.quote !== undefined ? (
          <NoteQuote sources={helpSources} book={(ctx?.book || "").toUpperCase()} chapter={item.chapter} verse={item.verse} quote={help.quote} occurrence={help.occurrence ?? 1} />
        ) : help ? (
          // Several questions may be of one verse: it is read once, with the first of them.
          firstOfVerse ? versesOf(item.verse) : null
        ) : (
          versesOf(item.verse)
        )}
        {help ? (
          <div className="rv-help" data-kind={help.secondary !== undefined ? "question" : undefined}>
            {source ? (
              <div className="rv-help__source">
                <HelpMarkdownView content={source.text} />
                {source.secondary ? <HelpMarkdownView content={source.secondary} /> : null}
              </div>
            ) : null}
            <div className="rv-help__now">
              {item.state === "removed" ? (
                <p className="rv-item__text">
                  <del>{[help.before, help.beforeSecondary].filter(Boolean).join("\n")}</del>
                </p>
              ) : pending ? (
                <p className="rv-help__none">{t("ab.untranslated")}</p>
              ) : corrected && showChanges ? (
                <>
                  <p className="rv-item__text">{marked(help.before, help.text)}</p>
                  {help.secondary !== undefined ? <p className="rv-item__text">{marked(help.beforeSecondary ?? "", help.secondary)}</p> : null}
                </>
              ) : (
                <>
                  <HelpMarkdownView content={help.text} />
                  {help.secondary ? <HelpMarkdownView content={help.secondary} /> : null}
                </>
              )}
            </div>
          </div>
        ) : item.state === "empty" ? (
          <p className="rv-item__text rv-item__text--none">{t("rv.notWritten")}</p>
        ) : !item.chapter && !(item.state === "changed" && showChanges) && item.state !== "removed" ? (
          // An article is read with its headings and lists; its marks are shown only where words are compared.
          <HelpMarkdownView className="rv-item__text rv-item__text--article" content={item.now} />
        ) : (
          <p className={`rv-item__text${item.chapter ? "" : " rv-item__text--raw"}`}>{item.state === "changed" && showChanges ? marked(item.before, item.now) : item.state === "removed" ? <del>{item.before}</del> : item.now}</p>
        )}
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
        {own.length && item.state !== "removed" && item.state !== "empty" && !pending ? (
          <div className="rv-checks">
            <Checks
              scope={`${ctx?.issueNumber ?? ""}:${step?.id ?? ""}:${item.key}`}
              lines={own.map((check) => {
                const said = check.texts?.[language] ?? check.text;
                // In an article the check says in which paragraphs of the English it comes up.
                const where = !item.chapter && itemSource ? paragraphsFor(check, itemSource) : [];
                return { id: check.id, by: check.by, text: where.length ? `${said} · ${t(where.length === 1 ? "rv.paragraphOne" : "rv.paragraphMany").replace("{n}", where.join(", "))}` : said };
              })}
            />
          </div>
        ) : null}
        {about.length ? <ul className="rv-comments">{about.map(commentRow)}</ul> : null}
        {commenting === item.key ? (
          <Composer focus placeholder={t("rv.commentOn").replace("{ref}", item.ref)} busy={acting} actions={[{ label: t("rv.comment"), primary: true, run: (text) => comment(item.ref, text) }]} />
        ) : (
          <button type="button" className="rv-item__add" onClick={() => setCommenting(item.key)}>
            <MessageSquare size={14} aria-hidden /> {t("rv.comment")}
          </button>
        )}
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
  const general = comments.filter((row) => !row.ref || !(items.some((item) => item.ref === row.ref) || pieceRefs.has(row.ref)));

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

  // Opened from a comment about a verse: its row is brought to the top.
  const rowFocused = useRef(false);
  useEffect(() => {
    if (rowFocused.current || busy || !ctx?.focus || !items.length) return;
    const row = pieces.pane.current?.querySelector(`.rv-item[data-ref="${CSS.escape(ctx.focus)}"]`);
    if (!row) return;
    rowFocused.current = true;
    row.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, busy, ctx?.focus]);

  /** What goes with the piece being read: what its source calls for, the comments about it, and a box to add one. */
  const underPiece = (ref: string, source: string, pending: boolean) => {
    const about = comments.filter((row) => row.ref === ref);
    const own: { id: string; text: string; texts?: Partial<Record<string, string>>; by?: string }[] = pending
      ? []
      : [...itemChecks(step?.checks ?? [], source), ...itemChecks(teamRules ? activeRules(teamRules) : [], source).map((rule) => ({ id: `team-${rule.id}`, text: ruleText(rule, language), by: rule.by }))];
    return (
      <>
        {own.length ? (
          <div className="rv-checks">
            <Checks scope={`${ctx?.issueNumber ?? ""}:${step?.id ?? ""}:${ref}`} lines={own.map((check) => ({ id: check.id, by: check.by, text: check.texts?.[language] ?? check.text }))} />
          </div>
        ) : null}
        {about.length ? <ul className="rv-comments">{about.map(commentRow)}</ul> : null}
        {commenting === ref ? (
          <Composer focus placeholder={t("rv.commentPiece")} busy={acting} actions={[{ label: t("rv.comment"), primary: true, run: (text) => comment(ref, text) }]} />
        ) : (
          <button type="button" className="rv-item__add" onClick={() => setCommenting(ref)}>
            <MessageSquare size={14} aria-hidden /> {t("rv.comment")}
          </button>
        )}
      </>
    );
  };

  return (
    <div className="scripture-editor fam">
      <ToolHeader
        title={passageName}
        onBack={onClose}
        meta={
          <>
            {[stepName, ctx?.taskName ? localizeName(ctx.taskName, language) : "", draftOwner ? (mine ? t("pr.yourDraft") : t("pr.draftOf").replace("{who}", draftOwner)) : ""].filter(Boolean).join(" · ")}
            {pull?.merged ? t("pr.merged") : ""}
          </>
        }
      />
      <div className="step-ask-bar">
        <StepAsk session={session} ctx={ctx ? { ...ctx, stepId: stepId || ctx.stepId } : ctx} byItem />
      </div>

      {error ? (
        <Alert variant="destructive" className="mx-4 mt-3">
          <AlertDescription>{localizeThread(error, language)}</AlertDescription>
        </Alert>
      ) : null}

      {busy ? (
        <p className="scripture-editor__loading">{t("pr.loading")}</p>
      ) : issue && range ? (
        <>
        <div className="fam__body" ref={pieces.pane}>
          {!marker ? (
            <div className="rv-empty">
              <p>{t(article ? "rv.noDraftYetArticle" : "rv.noDraftYet")}</p>
              <Button type="button" variant="outline" disabled={acting} onClick={() => void openReview()}>
                {acting ? t("se.opening") : t("rv.lookForDraft")}
              </Button>
            </div>
          ) : (
            <>
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
                          open={pieces.active?.id === file.filename ? pieces.active.index : null}
                          onOpen={(index, element) => pieces.open(file.filename, index, element)}
                          onProgress={(done, total, firstPending, count) => pieces.report(file.filename, done, total, firstPending, count)}
                          hasNext={pieces.active?.id === file.filename ? Boolean(pieces.after(longIds, file.filename, pieces.active.index)) : false}
                          onNext={(index) => pieces.next(longIds, file.filename, index)}
                          marksOf={(index) => comments.filter((row) => row.ref === pieceRef(file.filename, index)).length}
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
              <div className="rv-bar">
                <p className="rv-bar__count">
                  {!items.length
                    ? ""
                    : helpRowsRead.length
                      ? // A help is translated row by row: how far the passage is says more than how many rows differ.
                        t("rv.helpsDone").replace("{n}", String(helpRowsDone)).replace("{total}", String(helpRowsRead.length))
                      : changed
                        ? t(changed === 1 ? "rv.changedOne" : "rv.changedMany").replace("{n}", String(changed)).replace("{of}", String(items.length))
                        : t("rv.nothingChanged")}
                </p>
                {sources.length ? (
                  <label className="rv-toggle">
                    <input type="checkbox" checked={showSources} onChange={(e) => setShowSources(e.target.checked)} /> {t("rv.showSources")}
                  </label>
                ) : null}
                {items.some((item) => item.state === "changed" && (!item.help || rowCorrected(item))) ? (
                  <label className="rv-toggle">
                    <input type="checkbox" checked={showChanges} onChange={(e) => setShowChanges(e.target.checked)} /> {t("rv.showChanges")}
                  </label>
                ) : null}
              </div>

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
                        open={pieces.active?.id === intro.key ? pieces.active.index : null}
                        onOpen={(index, element) => pieces.open(intro.key, index, element)}
                        onProgress={(done, total, firstPending, count) => pieces.report(intro.key, done, total, firstPending, count)}
                        hasNext={pieces.active?.id === intro.key ? Boolean(pieces.after(longIds, intro.key, pieces.active.index)) : false}
                        onNext={(index) => pieces.next(longIds, intro.key, index)}
                        marksOf={(index) => comments.filter((row) => row.ref === introPieceRef(intro.chapter, index)).length}
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
                <h2 className="fam-panel__title">{t(article ? "rv.generalTitleArticle" : "rv.generalTitle")}</h2>
                {general.length ? <ul className="rv-comments">{general.map(commentRow)}</ul> : <p className="pe-hint">{t("rv.noGeneral")}</p>}
                <Composer
                  placeholder={t("rv.generalPlaceholder")}
                  busy={acting}
                  actions={[{ label: t("rv.comment"), run: (text) => comment("", text) }, ...(canSendBack && !mine ? [{ label: t("rv.askChanges"), run: (text: string) => comment("", text, true) }] : [])]}
                />
              </section>
            </>
          )}

        </div>
          {/* Without a draft there is nothing to read yet: the empty state says so, and a second line saying "you can read it" contradicted it. */}
          {status && marker ? (
            <div className="tool-foot">
              <p>{status}</p>
              {stepDone || approved ? (
                <Button type="button" onClick={onClose}>
                  {t("fa.back")}
                </Button>
              ) : canApprove ? (
                <Button type="button" disabled={acting} onClick={() => void approve()}>
                  <Check size={16} aria-hidden /> {acting ? t("wf.saving") : t(mine ? "rv.agree" : "rv.approve")}
                </Button>
              ) : canTake ? (
                <Button type="button" disabled={acting} onClick={() => void take()}>
                  {acting ? t("wf.saving") : t("rv.take")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
