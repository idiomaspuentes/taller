import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { waitBlocks, waitReason } from "../domain/waits";
import { audienceOf, type AudienceHold } from "../domain/audience";
import { levelOf, type PersonLevel } from "../domain/levels";
import { listMyClosedIssues, loadPmConfig } from "../dcs/issues";
import { boardCount, buildBoard, type BoardCard } from "../domain/myTasksBoard";
import { ConfirmDialog, MyTasksBoard, type CardHandlers } from "./MyTasksBoard";
import { isUrlSolver as isOutsideTool } from "../domain/solvers";
import { hadWorkKey, useHadWork } from "../hadWork";
import { useT } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";
import { localizeHold, localizeName } from "../domain/templateNames";
import { localizeThread } from "../domain/threadNames";
import type { MentionRow } from "../dcs/mentions";
import type { DcsIssue } from "@ip-lms/dcs-client";
import type { GtSession } from "../dcs/auth";
import {
  claimIssue,
  isIssueUnassigned,
  issueIsInProgress,
  listMyConflictIssues,
  loadSolversCatalog,
  markIssueInProgress,
  setIssueTaskProgress,
  unclaimIssue,
} from "../dcs/issues";
import { ensurePortionPr, submitPortionPrApproval } from "../dcs/portionPr";
import { closeSubtask } from "../dcs/closeSubtask";
import {
  parsePortionPrMarker,
  stepCompletesDraftForReview,
  stepNeedsOpenPortionPr,
} from "../domain/portionPr";
import { teamPhaseLabel } from "../domain/assignment";
import {
  canClaimIssue,
  canUnassignIssue,
  filterProjectIssues,
  issueProjectId,
  issueTaskId,
  loadMyTasksProjects,
  type MyTasksProjectBucket,
  type StepClaimOffer,
} from "../domain/myTasks";
import {
  approveStep,
  canApproveStep,
  canClaimStep,
  claimStep,
} from "../domain/stepClaim";
import {
  buildSolverLaunchContext,
  openSolverApp,
} from "../domain/solverLaunch";
import {
  DEFAULT_SOLVERS_CATALOG,
  findSolverApp,
  resolveSolverForIssue,
  type SolverApp,
  type SolversCatalog,
} from "../domain/solvers";
import {
  getStepRuntime,
  parseTaskProgressMarker,
  toggleStepDone,
  withStepRuntime,
} from "../domain/taskProgress";
import type { AssignmentsDoc, TaskStep } from "../domain/types";
import type { ReadCursorDoc } from "../domain/readCursor";
import { useDecisionReminders } from "../useDecisionReminders";
import { isDecisionIssue, opensAsTeamDecision } from "../domain/decisionAccess";
import { canOpenConversation } from "../domain/conversation";
import {
  attentionRank,
  formatRelativeEs,
  previewLine,
  rowActivity,
  type RowActivity,
} from "../domain/attention";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { recordOwnAction, recordOwnClose } from "../domain/pendingEvents";

type Props = {
  session: GtSession;
  pmOrg: string;
  lang: string;
  contentOrg: string;
  announce: (msg: string) => void;
  /** Local read cursor (this browser only); drives dots and "Necesitan tu atención". */
  cursor: ReadCursorDoc;
  /** Reports the "Mías" rows so step-role subtareas also feed the badge poll. */
  onMineIssues?: (issues: DcsIssue[]) => void;
  /** Free subtareas of my teams worth a notice, and the ones held back (waiting / level). */
  onAudience?: (audience: { free: DcsIssue[]; held: number[] }) => void;
  onRefreshActivity?: () => void;
  /** Pending decisions from the background poll; keeps "decidir" rows current without Actualizar. */
  decisionIssues?: DcsIssue[] | null;
  /** Opening a subtarea (mini-app launch) clears its "nueva" tag. */
  onMarkSeen?: (issue: number) => void;
  /** `effectiveCanManage`: gestor view may open any subtarea's thread. */
  canManage: boolean;
  onOpenThread: (issue: number) => void;
  /** Unread Door43 notifications of the project (mentions, replies), and how to mark one read. */
  mentions?: MentionRow[];
  onMentionRead?: (id: number) => void;
  /** ahora: the next thing to do · avisos: what needs attention · lista: every subtarea. */
  mode?: "avisos" | "lista";
};

type AttentionRow = {
  issue: DcsIssue;
  bucket?: MyTasksProjectBucket;
  activity: RowActivity;
  /** Closed with a verse conflict still to decide. */
  decide?: boolean;
};

function taskLabelFor(issue: DcsIssue, board: AssignmentsDoc): string {
  const taskId = issueTaskId(issue);
  const task = taskId ? board.teams.find((t) => t.id === taskId) : undefined;
  return task ? teamPhaseLabel(task) : "";
}

function shortTitle(issue: DcsIssue): string {
  // Prefer range fragment after book code: "NEH 13:30–31 · TPL" → "13:30–31 · TPL"
  const stripped = issue.title.replace(/^[A-Z0-9]{3}\s+/i, "").trim();
  return stripped || issue.title;
}


export function MyTasksView({
  session,
  pmOrg,
  lang,
  contentOrg,
  announce,
  cursor,
  onMineIssues,
  onAudience,
  onRefreshActivity,
  decisionIssues,
  onMarkSeen,
  canManage,
  onOpenThread,
  mentions = [],
  onMentionRead,
  mode = "lista",
}: Props) {
  // Declared first: helpers below (waiting reasons, messages) use them while the component renders.
  const t = useT();
  const language = useUiLanguage();
  const [projects, setProjects] = useState<MyTasksProjectBucket[]>([]);
  useDecisionReminders(session, pmOrg, projects);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [acting, setActing] = useState<number | null>(null);
  const [conflictIssues, setConflictIssues] = useState<DcsIssue[]>([]);
  const [closedIssues, setClosedIssues] = useState<DcsIssue[]>([]);
  const [confirm, setConfirm] = useState<{ title: string; text: string; yes: string; run: () => void } | null>(null);
  const [myLevel, setMyLevel] = useState<PersonLevel | undefined>(undefined);
  const [solversCatalog, setSolversCatalog] =
    useState<SolversCatalog>(DEFAULT_SOLVERS_CATALOG);

  const reload = useCallback(async () => {
    if (!pmOrg) {
      setProjects([]);
      setSolversCatalog(DEFAULT_SOLVERS_CATALOG);
      setLoaded(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const [nextProjects, catalog, conflicted, closed] = await Promise.all([
        loadMyTasksProjects({ session, pmOrg, lang, contentOrg }),
        loadSolversCatalog(session, pmOrg),
        listMyConflictIssues(session, pmOrg).catch(() => [] as DcsIssue[]),
        mode === "lista" ? listMyClosedIssues(session, pmOrg).catch(() => [] as DcsIssue[]) : Promise.resolve([] as DcsIssue[]),
      ]);
      setProjects(nextProjects);
      setConflictIssues(conflicted);
      setClosedIssues(closed);
      setSolversCatalog(catalog);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setLoaded(true);
    }
  }, [session, pmOrg, lang, contentOrg, mode]);

  // Coming back to the app (from a tool, another app, the phone's home screen): show what changed.
  useEffect(() => {
    let last = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 20_000) return;
      last = Date.now();
      void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  useEffect(() => {
    setLoaded(false);
    void reload();
  }, [reload]);

  useEffect(() => {
    if (decisionIssues) setConflictIssues(decisionIssues);
  }, [decisionIssues]);




  const mineRows = useMemo(() => {
    const seen = new Set<number>();
    const rows: Array<{ issue: DcsIssue; bucket: MyTasksProjectBucket }> = [];
    for (const bucket of projects) {
      for (const issue of filterProjectIssues(bucket.issues, "mine", session.username, bucket.board)) {
        if (seen.has(issue.number)) continue;
        seen.add(issue.number);
        rows.push({ issue, bucket });
      }
    }
    return rows;
  }, [projects, session.username]);

  useEffect(() => {
    if (!loaded) return;
    const open = mineRows.map((row) => row.issue);
    const seen = new Set(open.map((issue) => issue.number));
    onMineIssues?.([...open, ...conflictIssues.filter((issue) => !seen.has(issue.number))]);
  }, [loaded, mineRows, conflictIssues, onMineIssues]);

  // Only the worker's own rows (assigned or step role) can need attention.
  const attentionRows = useMemo<AttentionRow[]>(() => {
    const rows: AttentionRow[] = mineRows
      .map(({ issue, bucket }) => ({ issue, bucket, activity: rowActivity(cursor, issue.number) }))
      .filter((row) => row.activity.needsAttention);
    const listed = new Set(mineRows.map((row) => row.issue.number));
    const decide: AttentionRow[] = conflictIssues
      .filter((issue) => !listed.has(issue.number))
      .map((issue) => ({
        issue,
        bucket: projects.find((p) => p.projectId === issueProjectId(issue)),
        activity: rowActivity(cursor, issue.number, { decision: true }),
        decide: true,
      }));
    return [
      ...decide.sort((a, b) => attentionRank(a.activity, b.activity)),
      ...rows.sort((a, b) => attentionRank(a.activity, b.activity)),
    ];
  }, [mineRows, conflictIssues, projects, cursor]);

  // Free subtareas of my teams that are ready to take, and everything held back.
  const freeRows = useMemo(() => {
    const rows: Array<{ issue: DcsIssue; bucket: MyTasksProjectBucket }> = [];
    for (const bucket of projects) {
      if (!bucket.browseProject) continue;
      for (const issue of bucket.issues) {
        if (audienceOf({ issue, project: bucket, session, pmOrg, myLevel }).relation === "free") rows.push({ issue, bucket });
      }
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, session, pmOrg, myLevel]);
  const freeReady = useMemo(
    () =>
      freeRows.filter(({ issue, bucket }) => audienceOf({ issue, project: bucket, session, pmOrg, myLevel }).notify),
    [freeRows, session, pmOrg, myLevel],
  );
  const freeNew = useMemo(
    () => freeReady.filter(({ issue }) => rowActivity(cursor, issue.number).isNew),
    [freeReady, cursor],
  );
  const heldNumbers = useMemo(() => {
    const held: number[] = [];
    for (const bucket of projects) {
      for (const issue of bucket.issues) {
        const audience = audienceOf({ issue, project: bucket, session, pmOrg, myLevel });
        if (audience.relation !== "other" && audience.hold) held.push(issue.number);
      }
    }
    return held;
  }, [projects, session, pmOrg, myLevel]);
  useEffect(() => {
    if (!loaded) return;
    onAudience?.({ free: freeReady.map((row) => row.issue), held: heldNumbers });
  }, [loaded, freeReady, heldNumbers, onAudience]);

  useEffect(() => {
    if (!pmOrg) return;
    let cancelled = false;
    void loadPmConfig(session, pmOrg).then((config) => {
      if (!cancelled) setMyLevel(levelOf(config.levels, session.username));
    });
    return () => {
      cancelled = true;
    };
  }, [session, pmOrg]);

  const now = new Date();

  async function resolve(
    issue: DcsIssue,
    board: MyTasksProjectBucket["board"],
    opts?: { step?: TaskStep; app?: SolverApp; newTab?: boolean },
  ) {
    const app =
      opts?.app ||
      (opts?.step?.solverAppId
        ? findSolverApp(solversCatalog, opts.step.solverAppId)
        : undefined) ||
      resolveSolverForIssue(solversCatalog, board, issue);
    if (!app) {
      setError(t("mt.noTool"));
      return;
    }
    const ctx = buildSolverLaunchContext({
      username: session.username,
      lang,
      pmOrg,
      contentOrg,
      board,
      issue,
      stepId: opts?.step?.id,
      stepName: opts?.step?.name,
    });
    if (!ctx) {
      setError(t("mt.noContext"));
      return;
    }
    onMarkSeen?.(issue.number);
    setActing(issue.number);
    setError("");
    try {
      openSolverApp(app, ctx, { newTab: opts?.newTab });
      announce(
        opts?.step
          ? t("mt.openingStep").replace("{app}", app.name).replace("{step}", localizeName(opts.step.name, language)).replace("{n}", String(issue.number))
          : t("mt.openingFor").replace("{app}", app.name).replace("{n}", String(issue.number)),
      );
      if (!issueIsInProgress(issue)) {
        await markIssueInProgress(session, pmOrg, issue);
        await reload();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(null);
    }
  }

  async function tryEnsurePortionPr(
    issue: DcsIssue,
    board: MyTasksProjectBucket["board"],
  ) {
    try {
      const result = await ensurePortionPr({
        session,
        pmOrg,
        lang,
        contentOrg,
        board,
        issue,
      });
      if (result.created) {
        announce(t("mt.reviewOpened").replace("{n}", String(issue.number)));
      }
    } catch (err) {
      announce(
        t("mt.reviewFailed").replace("{err}", err instanceof Error ? err.message : String(err)),
      );
    }
  }

  async function takeStepClaim(offer: StepClaimOffer) {
    const { issue, task, step } = offer;
    const steps = task.steps ?? [];
    const current = parseTaskProgressMarker(issue.body);
    const issueAssignee =
      issue.assignee?.login || issue.assignees?.[0]?.login || undefined;
    if (
      !canClaimStep(
        session.username,
        steps,
        current,
        step,
        undefined,
        issueAssignee,
      )
    ) {
      setError(t("mt.cannotTakeStep"));
      return;
    }
    const next = claimStep(current, step, session.username);
    setActing(issue.number);
    setError("");
    try {
      const updated = await setIssueTaskProgress(session, pmOrg, issue, next);
      const board =
        projects.find((p) => p.projectId === offer.projectId)?.board ??
        projects.find((p) => p.issues.some((i) => i.number === issue.number))
          ?.board;
      if (board && stepNeedsOpenPortionPr(step)) {
        await tryEnsurePortionPr(updated, board);
      }
      announce(t("mt.tookStep").replace("{step}", localizeName(step.name, language)).replace("{n}", String(issue.number)));
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(null);
    }
  }

  async function approveStepClaim(offer: StepClaimOffer) {
    const { issue, step } = offer;
    const current = parseTaskProgressMarker(issue.body);
    const issueAssignee =
      issue.assignee?.login || issue.assignees?.[0]?.login || undefined;
    if (!canApproveStep(session.username, current, step, issueAssignee)) {
      setError(t("mt.cannotApproveStep"));
      return;
    }
    const next = approveStep(current, step, session.username, issueAssignee);
    setActing(issue.number);
    setError("");
    try {
      const linked = parsePortionPrMarker(issue.body);
      if (linked && stepNeedsOpenPortionPr(step)) {
        await submitPortionPrApproval(session, linked, {
          stepName: step.name,
          issueNumber: issue.number,
        });
      }
      await setIssueTaskProgress(session, pmOrg, issue, next);
      announce(
        next.doneStepIds.includes(step.id)
          ? t("mt.stepCompleted").replace("{step}", localizeName(step.name, language)).replace("{n}", String(issue.number))
          : t("mt.stepApproved").replace("{step}", localizeName(step.name, language)).replace("{n}", String(issue.number)),
      );
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(null);
    }
  }

  /** A free step (nobody has to take or approve it): the person doing it says it is done, or takes that back. */
  async function toggleFreeStep(issue: DcsIssue, board: AssignmentsDoc, step: TaskStep) {
    const steps = board.teams.find((task) => task.id === issueTaskId(issue))?.steps ?? [];
    const current = parseTaskProgressMarker(issue.body);
    const wasDone = current.doneStepIds.includes(step.id);
    let next = toggleStepDone(current, step.id);
    // Seat the person on the step, so later steps can exclude whoever did this one.
    if (!wasDone) {
      const runtime = getStepRuntime(next, step.id);
      if (!runtime.assignees.length) next = withStepRuntime(next, step.id, { ...runtime, assignees: [session.username] });
    }
    setActing(issue.number);
    setError("");
    try {
      const updated = await setIssueTaskProgress(session, pmOrg, issue, next);
      if (!wasDone && stepCompletesDraftForReview(steps, step.id)) await tryEnsurePortionPr(updated, board);
      announce(t(wasDone ? "mt.stepUnmarked" : "mt.stepMarked").replace("{n}", String(issue.number)));
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(null);
    }
  }

  async function claimStepOnIssue(
    issue: DcsIssue,
    board: AssignmentsDoc,
    step: TaskStep,
  ) {
    const taskId = issueTaskId(issue);
    const task = taskId ? board.teams.find((t) => t.id === taskId) : undefined;
    if (!task) return;
    await takeStepClaim({
      projectId: board.projectId,
      projectTitle: board.title || board.projectId,
      issue,
      task,
      step,
      progress: parseTaskProgressMarker(issue.body),
      seated: getStepRuntime(parseTaskProgressMarker(issue.body), step.id)
        .assignees.length,
      minSeats: 2,
      maxSeats: 2,
      action: "claim",
    });
  }

  async function approveStepOnIssue(
    issue: DcsIssue,
    board: AssignmentsDoc,
    step: TaskStep,
  ) {
    const taskId = issueTaskId(issue);
    const task = taskId ? board.teams.find((t) => t.id === taskId) : undefined;
    if (!task) return;
    await approveStepClaim({
      projectId: board.projectId,
      projectTitle: board.title || board.projectId,
      issue,
      task,
      step,
      progress: parseTaskProgressMarker(issue.body),
      seated: getStepRuntime(parseTaskProgressMarker(issue.body), step.id)
        .assignees.length,
      minSeats: 2,
      maxSeats: 2,
      action: "approve",
    });
  }

  async function close(issue: DcsIssue, board: MyTasksProjectBucket["board"]) {
    setActing(issue.number);
    try {
      const resource = (
        buildSolverLaunchContext({
          username: session.username,
          lang,
          pmOrg,
          contentOrg,
          board,
          issue,
        })?.resource || ""
      ).toLowerCase();
      const { merge, posted, publishError } = await closeSubtask({
        session,
        pmOrg,
        issue,
        resource,
        lang,
        ensurePr: async () =>
          (await ensurePortionPr({ session, pmOrg, lang, contentOrg, board, issue })).issue,
      });
      const own = { host: session.host, username: session.username, pmOrg };
      recordOwnClose(own, issue.number);
      const conflictCount = merge.conflicts.length;
      let conflictNote = "";
      if (posted) {
        for (const item of posted.ownItems) {
          recordOwnAction(own, issue.number, { ...item, reconcileKey: item.key, key: `local:${item.key}` });
        }
        conflictNote = posted.unknownOther.length
          ? t("mt.unknownOther").replace("{who}", posted.unknownOther.join(", "))
          : "";
      }
      if (publishError) {
        setError(t("mt.closedNoConflict").replace("{n}", String(issue.number)).replace("{err}", publishError));
      }
      announce(
        merge.status === "verses"
          ? conflictCount
            ? t("mt.closedVersesConflict").replace("{n}", String(issue.number)).replace("{c}", String(conflictCount)).replace("{note}", conflictNote)
            : t("mt.closedVerses").replace("{n}", String(issue.number))
          : merge.status === "merged"
            ? t("mt.closedMerged").replace("{n}", String(issue.number))
            : t("mt.closedPlain").replace("{n}", String(issue.number)),
      );
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(null);
    }
  }

  async function liberar(issue: DcsIssue, browseProject: boolean) {
    if (!canUnassignIssue(session, issue, browseProject)) {
      setError(t("mt.cannotRelease"));
      return;
    }
    setActing(issue.number);
    try {
      await unclaimIssue(session, pmOrg, issue.number);
      announce(t("mt.released").replace("{n}", String(issue.number)));
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(null);
    }
  }

  /** What holds this subtarea back (waits for other work, or asks for a higher level). */
  function holdFor(issue: DcsIssue, bucket: MyTasksProjectBucket): AudienceHold | undefined {
    const audience = audienceOf({ issue, project: bucket, session, pmOrg, myLevel });
    if (audience.hold) return audience.hold;
    if (bucket.openIssues) {
      const blocks = waitBlocks(issue, bucket.board, bucket.openIssues);
      if (blocks.length) return { kind: "espera", text: waitReason(blocks, bucket.board) };
    }
    return undefined;
  }
  const waitingText = (issue: DcsIssue, bucket: MyTasksProjectBucket): string => localizeHold(holdFor(issue, bucket)?.text ?? "", language);

  /** «Empezar»: take the subtarea if it is free, then open its editor. */
  async function begin(issue: DcsIssue, board: MyTasksProjectBucket["board"], step?: TaskStep) {
    const holder = projects.find((p) => p.board === board);
    if (holder && waitingText(issue, holder)) {
      setError(waitingText(issue, holder));
      return;
    }
    if (isIssueUnassigned(issue)) {
      if (!canClaimIssue(session, pmOrg, issue, board, myLevel)) {
        setError(t("mt.cannotTake"));
        return;
      }
      setActing(issue.number);
      try {
        await claimIssue(session, pmOrg, issue.number);
        announce(t("mt.tookIssue").replace("{n}", String(issue.number)));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setActing(null);
        return;
      }
    }
    await resolve(issue, board, { step });
  }

  // «Ahora»: the one thing to do next. Decisions first, then work in progress, then the rest of mine.
  const nowDecide = attentionRows.find((row) => row.decide);
  const ready = mineRows.filter((row) => !waitingText(row.issue, row.bucket));
  const nowMine = ready.find((row) => issueIsInProgress(row.issue)) ?? ready[0];
  const nowFree = !nowDecide && !nowMine ? freeRows[0] : undefined;

  const hadWork = useHadWork(
    hadWorkKey(session.host, session.username, pmOrg),
    loaded && !busy,
    Boolean(nowDecide || nowMine || nowFree),
  );

  const taskBoard = useMemo(
    () => buildBoard({ session, pmOrg, projects, decisionIssues: conflictIssues, closedIssues, cursor, myLevel }),
    [session, pmOrg, projects, conflictIssues, closedIssues, cursor, myLevel],
  );

  if (mode === "lista") {
    const toolOf = (card: BoardCard) => {
      const step = card.action.kind === "begin" || card.action.kind === "continue" ? card.action.step : undefined;
      const id = step?.solverAppId ?? card.task?.solverAppId;
      return id ? findSolverApp(solversCatalog, id) : card.bucket ? resolveSolverForIssue(solversCatalog, card.bucket.board, card.issue) : undefined;
    };
    const handlers: CardHandlers = {
      isExternal: (card) => {
        const app = toolOf(card);
        return Boolean(app && (app.openMode === "external" || isOutsideTool(app)));
      },
      onPrimary: (card) => {
        const board = card.bucket?.board;
        const a = card.action;
        if (a.kind === "vote") return onOpenThread(card.issue.number);
        if (!board) return;
        if (a.kind === "begin") return void begin(card.issue, board, a.step);
        if (a.kind === "continue") return void resolve(card.issue, board, { step: a.step });
        if (a.kind === "claimStep") return void claimStepOnIssue(card.issue, board, a.step);
        if (a.kind === "approveStep") return void approveStepOnIssue(card.issue, board, a.step);
        if (a.kind === "deliver") return handlers.onDeliver(card);
      },
      onOpenThread: (card) =>
        card.bucket && canOpenConversation(card.issue, session.username, canManage, opensAsTeamDecision(session, pmOrg, card.bucket.board, card.issue))
          ? () => onOpenThread(card.issue.number)
          : undefined,
      onDeliver: (card) =>
        setConfirm({
          title: t("tb.deliverTitle"),
          text: t("tb.deliverAsk"),
          yes: t("tb.deliverYes"),
          run: () => card.bucket && void close(card.issue, card.bucket.board),
        }),
      onRelease: (card) =>
        setConfirm({
          title: t("tb.releaseTitle"),
          text: t("tb.releaseAsk"),
          yes: t("tb.releaseYes"),
          run: () => card.bucket && void liberar(card.issue, card.bucket.browseProject),
        }),
      onOpenNewTab: (card) => {
        const a = card.action;
        if (!card.bucket || (a.kind !== "begin" && a.kind !== "continue")) return;
        void resolve(card.issue, card.bucket.board, { step: a.step, newTab: true });
      },
      onClaimStep: (card, step) => card.bucket && void claimStepOnIssue(card.issue, card.bucket.board, step),
      onApproveStep: (card, step) => card.bucket && void approveStepOnIssue(card.issue, card.bucket.board, step),
      onToggleStep: (card, step) => card.bucket && void toggleFreeStep(card.issue, card.bucket.board, step),
    };
    const count = boardCount(taskBoard);
    const name = session.username.charAt(0).toUpperCase() + session.username.slice(1);
    return (
      <div className="hub task-home">
        <div className="task-home__head">
          <div>
            <h1 className="hub-title">{t("mt.title")}</h1>
            <p className="task-home__hello">{t("tb.hello").replace("{name}", name)}</p>
          </div>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { void reload(); onRefreshActivity?.(); }}>
            {busy ? t("mt.refreshing") : t("mt.refresh")}
          </Button>
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {!pmOrg ? (
          <div className="hub-empty-panel">
            <h2 className="hub-empty-panel__title">{t("mt.chooseOrgTitle")}</h2>
            <p className="hub-empty-panel__body">{t("mt.chooseOrgBody")}</p>
          </div>
        ) : busy && !loaded ? (
          <p className="hub-hint">{t("mt.loading")}</p>
        ) : loaded && count === 0 && taskBoard.done.length === 0 ? (
          <div className="hub-empty-panel">
            <h2 className="hub-empty-panel__title">{hadWork ? t("empty.upTitle") : t("empty.firstTitle")}</h2>
            <p className="hub-empty-panel__body">{hadWork ? t("empty.upBody") : t("empty.firstBody")}</p>
          </div>
        ) : loaded ? (
          <>
            {count === 0 ? <p className="hub-hint">{t("empty.upBody")}</p> : null}
            <MyTasksBoard board={taskBoard} login={session.username} now={now} acting={acting} handlers={handlers} />
          </>
        ) : null}
        {import.meta.env.DEV ? (
          <a className="task-home__dev" href="#/mis-tareas/prueba">
            Probar un conflicto (solo en desarrollo)
          </a>
        ) : null}
        <ConfirmDialog
          open={Boolean(confirm)}
          title={confirm?.title ?? ""}
          text={confirm?.text ?? ""}
          yes={confirm?.yes ?? ""}
          onNo={() => setConfirm(null)}
          onYes={() => {
            const run = confirm?.run;
            setConfirm(null);
            run?.();
          }}
        />
      </div>
    );
  }

  return (
    <div className="hub">
      <div className="hub-header">
        <div>
          <h1 className="hub-title">{t("nav.alerts")}</h1>
          <p className="hub-lede">
            {t("mt.workOf")} <strong>@{session.username}</strong>
            {pmOrg ? (
              <>
                {" "}
                · <span className="font-mono">{pmOrg}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {import.meta.env.DEV ? (
            <a className="btn" data-size="sm" data-variant="ghost" href="#/mis-tareas/prueba">
              Probar un conflicto
            </a>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !pmOrg}
            onClick={() => {
              void reload();
              onRefreshActivity?.();
            }}
          >
            {busy ? t("mt.refreshing") : t("mt.refresh")}
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}



      {pmOrg && mode === "avisos" && attentionRows.length ? (
        <section className="hub-attention" aria-labelledby="hub-attention-title">
          <div className="hub-attention__head">
            <h2 id="hub-attention-title" className="hub-attention__title">
              {t("mt.needAttention")}
            </h2>
            <span className="hub-queue-head__count text-xs text-muted-foreground tabular-nums">
              {attentionRows.length}
            </span>
          </div>
          <div>
            {attentionRows.map((row) => {
              const { issue, bucket, activity } = row;
              const resource = bucket ? taskLabelFor(issue, bucket.board) || bucket.title : "";
              const line = previewLine(activity.latest, (text) => localizeThread(text, language));
              return (
                <button
                  key={issue.number}
                  type="button"
                  className="hub-attention__row"
                  onClick={() => onOpenThread(issue.number)}
                >
                  {activity.unread ? (
                    <span className="hub-queue-item__dot" role="img" aria-label={t("mt.unread")} />
                  ) : null}
                  <span className="hub-attention__main">
                    <span className="hub-attention__label">
                      {row.decide ? <span className="hub-attention__tag">{t("mt.tagDecide")}</span> : null}
                      {activity.isNew ? (
                        <span className="hub-attention__tag hub-attention__tag--new">{t("mt.tagNew")}</span>
                      ) : null}
                      <span>{localizeName(issue.title, language)}</span>
                      {resource ? (
                        <span className="hub-attention__resource">· {resource}</span>
                      ) : null}
                    </span>
                    {line ? (
                      <span className="hub-queue-item__activity">
                        <span className="hub-queue-item__preview">{line}</span>
                        {activity.latest ? (
                          <time className="hub-queue-item__time" dateTime={activity.latest.at}>
                            {formatRelativeEs(activity.latest.at, now, language)}
                          </time>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                  <ChevronRight className="hub-attention__chevron" aria-hidden />
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {!pmOrg ? (
        <div className="hub-empty-panel">
          <span className="hub-empty-panel__kicker">{t("workspace.title")}</span>
          <h2 className="hub-empty-panel__title">{t("mt.chooseOrgTitle")}</h2>
          <p className="hub-empty-panel__body">{t("mt.chooseOrgBody")}</p>
        </div>
      ) : null}

      {busy && !loaded ? <p className="hub-hint">{t("mt.loading")}</p> : null}


      {pmOrg && mode === "avisos" && mentions.length ? (
        <section className="hub-attention" aria-labelledby="hub-mentions-title">
          <div className="hub-attention__head">
            <h2 id="hub-mentions-title" className="hub-attention__title">
              {t("mt.mentions")}
            </h2>
            <span className="hub-queue-head__count text-xs text-muted-foreground tabular-nums">{mentions.length}</span>
          </div>
          <div className="grid gap-2 p-3">
            {mentions.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 font-semibold">{row.title}</span>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    onMentionRead?.(row.id);
                    onOpenThread(row.issue);
                  }}
                >
                  {t("mt.open")}
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {pmOrg && mode === "avisos" && freeNew.length ? (
        <section className="hub-attention" aria-labelledby="hub-free-title">
          <div className="hub-attention__head">
            <h2 id="hub-free-title" className="hub-attention__title">
              {t("mt.freeForTeam")}
            </h2>
            <span className="hub-queue-head__count text-xs text-muted-foreground tabular-nums">
              {freeNew.length}
            </span>
          </div>
          <div className="grid gap-2 p-3">
            {freeNew.map(({ issue, bucket }) => (
              <div key={issue.number} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 font-semibold">{localizeName(shortTitle(issue), language)}</span>
                <span className="flex gap-2">
                  {isDecisionIssue(issue) ? (
                    <Button type="button" size="sm" onClick={() => onOpenThread(issue.number)}>
                      {t("mt.vote")}
                    </Button>
                  ) : (
                    <Button type="button" size="sm" onClick={() => void begin(issue, bucket.board)}>
                      {t("mt.takeAndStart")}
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="ghost" onClick={() => onMarkSeen?.(issue.number)}>
                    {t("push.later")}
                  </Button>
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {pmOrg && loaded && !busy && mode === "avisos" && !attentionRows.length && !freeNew.length && !mentions.length ? (
        <div className="hub-empty-panel">
          <span className="hub-empty-panel__kicker">{t("nav.alerts")}</span>
          <h2 className="hub-empty-panel__title">{t("empty.alertsTitle")}</h2>
          <p className="hub-empty-panel__body">{t("empty.alertsBody")}</p>
        </div>
      ) : null}

    </div>
  );
}
