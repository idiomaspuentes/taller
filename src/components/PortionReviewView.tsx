import { StepAsk } from "./StepAsk";
import { ToolHeader } from "./ToolHeader";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DcsIssue } from "@ip-lms/dcs-client";
import { Check, MessageSquare } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { loadSession, type GtSession } from "../dcs/auth";
import { loadPmConfig, setIssueTaskProgress } from "../dcs/issues";
import { loadAssignmentsFromDcs } from "../dcs/persist";
import { commentOnPortionPr, ensurePortionPr, getPmIssue, loadLinkedPull, loadLinkedPullFiles, submitPortionPrApproval } from "../dcs/portionPr";
import type { DcsPull } from "../dcs/pulls";
import { readRepoFile } from "../dcs/repoFile";
import { loadReviewComments, type ReviewComment as Comment } from "../dcs/reviewComments";
import { explainError } from "../dcs/userError";
import { bookLabel } from "../domain/books";
import { parsePortionPrMarker, stepNeedsOpenPortionPr, translatorLoginFromHead, type PortionPrMarker } from "../domain/portionPr";
import { englishScriptureKindRef, loadEnglishScriptureKindUsfm, loadNotesForRange, type ReferenceHelpRow } from "../domain/referenceResources";
import { articleItems, diffWords, refComment, reviewItems, type ReviewItem } from "../domain/reviewItems";
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

type Props = {
  ctxEncoded: string;
  mode: "pair" | "group";
  onClose: () => void;
  announce: (msg: string) => void;
};

type Source = { short: string; verses: VerseTextMap };

/** One box to write a comment in; `Enter` alone makes a new line, so a comment can have several. */
function Composer({ placeholder, busy, actions }: { placeholder: string; busy: boolean; actions: { label: string; primary?: boolean; run: (text: string) => Promise<boolean> }[] }) {
  const [text, setText] = useState("");
  return (
    <div className="rv-composer">
      <textarea className="af-textarea" rows={2} value={text} placeholder={placeholder} aria-label={placeholder} onChange={(e) => setText(e.target.value)} />
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
  const [notes, setNotes] = useState<ReferenceHelpRow[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
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
      void loadNotesForRange(sess, ctx, range, pmConfig)
        .then((loaded) => setNotes(loaded.notes))
        .catch(() => setNotes([]));

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
        return;
      }
      const filename = names.find((name) => /\.(usfm|sfm|tsv)$/i.test(name)) ?? bookUsfmName(ctx.book);
      const read = (branch: string) => readAt(filename, branch);
      const [now, before] = await Promise.all([read(linked.head), read(linked.base)]);
      // Once the draft is in the team's text its own copy may be gone: what is reviewed then is the team's text.
      setItems(reviewItems({ filename, now: now ?? before ?? "", before: before ?? "", range }));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }, [ctx, range, loadComments]);

  useEffect(() => {
    void load();
  }, [load]);

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
  const passageName = ctx ? `${bookLabel(ctx.book, language)} ${ctx.ref}` : stepName;
  const changed = items.filter((item) => item.state !== "same" && item.state !== "empty").length;
  const general = comments.filter((row) => !row.ref || !items.some((item) => item.ref === row.ref));
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
          ? t(mine ? "rv.agreeOwn" : "rv.readThenApprove")
          : canTake
            ? t(runtime?.assignees.length ? "rv.takeOneMore" : "rv.takeFirst")
            : mine
              ? t("rv.waitingReviewers")
              : seated
                ? t("rv.seatedWait")
                : keptOut
                  ? t("rv.keptOut")
                  : t("rv.onlyRead");

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
        <StepAsk session={session} ctx={ctx ? { ...ctx, stepId: stepId || ctx.stepId } : ctx} />
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
        <div className="fam__body">
          {!marker ? (
            <div className="rv-empty">
              <p>{t("rv.noDraftYet")}</p>
              <Button type="button" variant="outline" disabled={acting} onClick={() => void openReview()}>
                {acting ? t("se.opening") : t("rv.lookForDraft")}
              </Button>
            </div>
          ) : (
            <>
              <div className="rv-bar">
                <p className="rv-bar__count">{items.length ? (changed ? t(changed === 1 ? "rv.changedOne" : "rv.changedMany").replace("{n}", String(changed)).replace("{of}", String(items.length)) : t("rv.nothingChanged")) : ""}</p>
                {sources.length ? (
                  <label className="rv-toggle">
                    <input type="checkbox" checked={showSources} onChange={(e) => setShowSources(e.target.checked)} /> {t("rv.showSources")}
                  </label>
                ) : null}
                {items.some((item) => item.state === "changed") ? (
                  <label className="rv-toggle">
                    <input type="checkbox" checked={showChanges} onChange={(e) => setShowChanges(e.target.checked)} /> {t("rv.showChanges")}
                  </label>
                ) : null}
              </div>

              {!items.length ? <p className="pe-hint">{t("rv.noText")}</p> : null}

              <ol className="rv-list">
                {items.map((item) => {
                  const verseNotes = notesOf(item.verse);
                  const about = comments.filter((row) => row.ref === item.ref);
                  return (
                    <li key={item.key} className="rv-item" data-state={item.state}>
                      <div className="rv-item__head">
                        <span className="rv-item__ref">{item.ref}</span>
                        {item.state !== "same" ? <span className="rv-item__state">{t(`rv.state.${item.state}`)}</span> : null}
                      </div>
                      {showSources && sources.length ? (
                        <dl className="rv-sources">
                          {sources.map((source) =>
                            source.verses[item.verse] ? (
                              <div key={source.short}>
                                <dt>{source.short}</dt>
                                <dd>{source.verses[item.verse]}</dd>
                              </div>
                            ) : null,
                          )}
                        </dl>
                      ) : null}
                      {item.state === "empty" ? (
                        <p className="rv-item__text rv-item__text--none">{t("rv.notWritten")}</p>
                      ) : !item.chapter && !(item.state === "changed" && showChanges) && item.state !== "removed" ? (
                        // An article is read with its headings and lists; its marks are shown only where words are compared.
                        <HelpMarkdownView className="rv-item__text rv-item__text--article" content={item.now} />
                      ) : (
                        <p className={`rv-item__text${item.chapter ? "" : " rv-item__text--raw"}`}>
                          {item.state === "changed" && showChanges
                            ? diffWords(item.before, item.now).map((part, index) => (part.kind === "same" ? part.text : part.kind === "added" ? <ins key={index}>{part.text}</ins> : <del key={index}>{part.text}</del>))
                            : item.state === "removed"
                              ? <del>{item.before}</del>
                              : item.now}
                        </p>
                      )}
                      {verseNotes.length ? (
                        <details className="rv-notes">
                          <summary>{t(verseNotes.length === 1 ? "rv.notesOne" : "rv.notesMany").replace("{n}", String(verseNotes.length))}</summary>
                          <ul className="fam-notes">
                            {verseNotes.map((note) => (
                              <li key={note.id}>
                                <p className="fam-notes__quote">{note.title}</p>
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
                      {about.length ? <ul className="rv-comments">{about.map(commentRow)}</ul> : null}
                      {commenting === item.key ? (
                        <Composer placeholder={t("rv.commentOn").replace("{ref}", item.ref)} busy={acting} actions={[{ label: t("rv.comment"), primary: true, run: (text) => comment(item.ref, text) }]} />
                      ) : (
                        <button type="button" className="rv-item__add" onClick={() => setCommenting(item.key)}>
                          <MessageSquare size={14} aria-hidden /> {t("rv.comment")}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>

              <section className="rv-general">
                <h2 className="fam-panel__title">{t("rv.generalTitle")}</h2>
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
