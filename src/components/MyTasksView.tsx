import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { RowMenu, type RowMenuItem } from "./RowMenu";
import { waitBlocks, waitReason } from "../domain/waits";
import { audienceOf, type AudienceHold } from "../domain/audience";
import { levelOf, type PersonLevel } from "../domain/levels";
import { loadPmConfig } from "../dcs/issues";
import { hadWorkKey, useHadWork } from "../hadWork";
import { useT } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";
import { localizeName } from "../domain/templateNames";
import { appName } from "../brand";
import type { MentionRow } from "../dcs/mentions";
import type { DcsIssue } from "@ip-lms/dcs-client";
import type { GtSession } from "../dcs/auth";
import {
  claimIssue,
  isIssueAssignedTo,
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
  listStepClaimOffers,
  loadMyTasksProjects,
  type MyTasksFilter,
  type MyTasksProjectBucket,
  type StepClaimOffer,
} from "../domain/myTasks";
import {
  approveStep,
  canApproveStep,
  canClaimStep,
  claimStep,
  stepClaimMode,
} from "../domain/stepClaim";
import {
  buildSolverLaunchContext,
  chapterFromIssue,
  openSolverApp,
  resolveSolverLaunchUrl,
  solverLaunchBlockReason,
  type SolverLaunchContext,
} from "../domain/solverLaunch";
import {
  DEFAULT_SOLVERS_CATALOG,
  FAMILIARIZE_SOLVER_ID,
  findSolverApp,
  isFamiliarizeSolver,
  resolveSolverForIssue,
  solverActionLabel,
  type SolverApp,
  type SolversCatalog,
} from "../domain/solvers";
import {
  allStepsDone,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { recordOwnAction, recordOwnClose } from "../domain/pendingEvents";
import { cn } from "@/lib/utils";

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
  mode?: "ahora" | "avisos" | "lista";
};

const COLLAPSE_CHAPTERS_AT = 12;

type AttentionRow = {
  issue: DcsIssue;
  bucket?: MyTasksProjectBucket;
  activity: RowActivity;
  /** Closed with a verse conflict still to decide. */
  decide?: boolean;
};

function rowDomId(issueNumber: number): string {
  return `subtarea-${issueNumber}`;
}

function taskLabelFor(issue: DcsIssue, board: AssignmentsDoc): string {
  const taskId = issueTaskId(issue);
  const task = taskId ? board.teams.find((t) => t.id === taskId) : undefined;
  return task ? teamPhaseLabel(task) : "";
}

type ChapterGroup = { chapter: number; issues: DcsIssue[] };
type TaskGroup = {
  taskId: string;
  label: string;
  phaseId: string;
  chapters: ChapterGroup[];
  issueCount: number;
};
type PhaseGroup = {
  phaseId: string;
  label: string;
  tasks: TaskGroup[];
  issueCount: number;
};

function projectCollapseKey(projectId: string): string {
  return `p:${projectId}`;
}

function phaseCollapseKey(projectId: string, phaseId: string): string {
  return `f:${projectId}:${phaseId}`;
}

function taskCollapseKey(projectId: string, taskId: string): string {
  return `t:${projectId}:${taskId}`;
}

function chapterCollapseKey(projectId: string, taskId: string, chapter: number): string {
  return `c:${projectId}:${taskId}:${chapter}`;
}

function assigneeLabel(issue: DcsIssue): string {
  const login =
    issue.assignee?.login ||
    issue.assignees?.[0]?.login ||
    "";
  return login ? `@${login}` : "Sin asignar";
}

function issueChapter(issue: DcsIssue): number {
  return chapterFromIssue(issue);
}

function shortTitle(issue: DcsIssue): string {
  // Prefer range fragment after book code: "NEH 13:30–31 · TPL" → "13:30–31 · TPL"
  const stripped = issue.title.replace(/^[A-Z0-9]{3}\s+/i, "").trim();
  return stripped || issue.title;
}

function groupByChapter(issues: DcsIssue[]): ChapterGroup[] {
  const map = new Map<number, DcsIssue[]>();
  for (const issue of issues) {
    const chapter = issueChapter(issue);
    const list = map.get(chapter) ?? [];
    list.push(issue);
    map.set(chapter, list);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([chapter, rows]) => ({ chapter, issues: rows }));
}

/**
 * Same hierarchy as Tareas / Asignar: fase → tarea → capítulo.
 */
function groupQueue(board: AssignmentsDoc, issues: DcsIssue[]): PhaseGroup[] {
  const byTask = new Map<string, DcsIssue[]>();
  for (const issue of issues) {
    const taskId = issueTaskId(issue) || "_";
    const list = byTask.get(taskId) ?? [];
    list.push(issue);
    byTask.set(taskId, list);
  }

  const phaseOrder = new Map(
    [...board.phases]
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "es"))
      .map((p, i) => [p.id, i]),
  );
  const taskOrder = new Map(board.teams.map((t, i) => [t.id, i]));
  const phaseName = new Map(board.phases.map((p) => [p.id, p.name]));

  const taskGroups: TaskGroup[] = [...byTask.entries()]
    .map(([taskId, rows]) => {
      const task = taskId !== "_" ? board.teams.find((t) => t.id === taskId) : undefined;
      const phaseId = task?.phaseId || "_";
      return {
        taskId,
        label: task ? teamPhaseLabel(task) : taskId === "_" ? "Sin tarea" : taskId,
        phaseId,
        chapters: groupByChapter(rows),
        issueCount: rows.length,
      };
    })
    .sort((a, b) => {
      const pa = phaseOrder.get(a.phaseId) ?? 999;
      const pb = phaseOrder.get(b.phaseId) ?? 999;
      if (pa !== pb) return pa - pb;
      const ta = taskOrder.get(a.taskId) ?? 999;
      const tb = taskOrder.get(b.taskId) ?? 999;
      if (ta !== tb) return ta - tb;
      return a.label.localeCompare(b.label, "es");
    });

  const byPhase = new Map<string, TaskGroup[]>();
  for (const group of taskGroups) {
    const list = byPhase.get(group.phaseId) ?? [];
    list.push(group);
    byPhase.set(group.phaseId, list);
  }

  return [...byPhase.entries()].map(([phaseId, tasks]) => ({
    phaseId,
    label:
      phaseId === "_"
        ? "Sin fase"
        : phaseName.get(phaseId) || phaseId,
    tasks,
    issueCount: tasks.reduce((n, t) => n + t.issueCount, 0),
  }));
}

function searchHaystack(issue: DcsIssue, board: AssignmentsDoc): string {
  const taskId = issueTaskId(issue);
  const task = taskId ? board.teams.find((t) => t.id === taskId) : undefined;
  const taskName = task ? teamPhaseLabel(task) : taskId;
  const phaseName =
    task?.phaseId ? board.phases.find((p) => p.id === task.phaseId)?.name ?? "" : "";
  return `${issue.number} ${issue.title} ${taskName} ${phaseName} ${assigneeLabel(issue)}`.toLowerCase();
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
  const [projects, setProjects] = useState<MyTasksProjectBucket[]>([]);
  useDecisionReminders(session, pmOrg, projects);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [acting, setActing] = useState<number | null>(null);
  const [conflictIssues, setConflictIssues] = useState<DcsIssue[]>([]);
  const [myLevel, setMyLevel] = useState<PersonLevel | undefined>(undefined);
  const [filter, setFilter] = useState<MyTasksFilter>("mine");
  const [filterTouched, setFilterTouched] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [collapseSeeded, setCollapseSeeded] = useState(false);
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
      const [nextProjects, catalog, conflicted] = await Promise.all([
        loadMyTasksProjects({ session, pmOrg, lang, contentOrg }),
        loadSolversCatalog(session, pmOrg),
        listMyConflictIssues(session, pmOrg).catch(() => [] as DcsIssue[]),
      ]);
      setProjects(nextProjects);
      setConflictIssues(conflicted);
      setSolversCatalog(catalog);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setLoaded(true);
    }
  }, [session, pmOrg, lang, contentOrg]);

  useEffect(() => {
    setLoaded(false);
    setFilterTouched(false);
    setCollapseSeeded(false);
    void reload();
  }, [reload]);

  useEffect(() => {
    if (decisionIssues) setConflictIssues(decisionIssues);
  }, [decisionIssues]);

  const hasBrowse = useMemo(
    () => projects.some((p) => p.browseProject),
    [projects],
  );

  const mineCount = useMemo(
    () =>
      projects.reduce(
        (n, p) =>
          n +
          filterProjectIssues(p.issues, "mine", session.username, p.board).length,
        0,
      ),
    [projects, session.username],
  );
  const availableCount = useMemo(
    () =>
      projects.reduce(
        (n, p) => (p.browseProject ? n + p.issues.filter(isIssueUnassigned).length : n),
        0,
      ),
    [projects],
  );

  const stepOffers = useMemo(
    () => (pmOrg ? listStepClaimOffers(session, pmOrg, projects) : []),
    [session, pmOrg, projects],
  );

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

  useEffect(() => {
    if (!loaded || filterTouched || !hasBrowse) return;
    if (mineCount === 0 && availableCount > 0) setFilter("available");
  }, [loaded, filterTouched, hasBrowse, mineCount, availableCount]);

  const visibleProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects
      .map((bucket) => {
        let issues = filterProjectIssues(
          bucket.issues,
          filter,
          session.username,
          bucket.board,
        );
        if (q) {
          issues = issues.filter((issue) => searchHaystack(issue, bucket.board).includes(q));
        }
        return { ...bucket, issues };
      })
      .filter((bucket) => bucket.issues.length > 0 || (filter === "all" && bucket.browseProject && !q));
  }, [projects, filter, session.username, search]);

  // Seed collapse once per load when the list is dense: project, tasks, chapters.
  useEffect(() => {
    if (!loaded || collapseSeeded || !visibleProjects.length) return;
    const next = new Set<string>();
    for (const bucket of visibleProjects) {
      if (bucket.issues.length < COLLAPSE_CHAPTERS_AT) continue;
      next.add(projectCollapseKey(bucket.projectId));
      const phases = groupQueue(bucket.board, bucket.issues);
      for (const [phaseIndex, phase] of phases.entries()) {
        // Keep the first phase open so dense queues still show a foothold.
        if (phaseIndex > 0) {
          next.add(phaseCollapseKey(bucket.projectId, phase.phaseId));
        }
        for (const [taskIndex, task] of phase.tasks.entries()) {
          // Keep the first task open so dense queues still show a foothold.
          if (taskIndex > 0) {
            next.add(taskCollapseKey(bucket.projectId, task.taskId));
          }
          for (const chapter of task.chapters) {
            next.add(chapterCollapseKey(bucket.projectId, task.taskId, chapter.chapter));
          }
        }
      }
    }
    // Multiple projects: collapse all but the first so the hub stays scannable.
    if (visibleProjects.length > 1) {
      for (const bucket of visibleProjects.slice(1)) {
        next.add(projectCollapseKey(bucket.projectId));
      }
    }
    setCollapsed(next);
    setCollapseSeeded(true);
  }, [loaded, collapseSeeded, visibleProjects]);

  function toggleCollapsed(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function start(issue: DcsIssue) {
    setActing(issue.number);
    try {
      await markIssueInProgress(session, pmOrg, issue);
      announce(`#${issue.number} en curso`);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(null);
    }
  }

  async function resolve(
    issue: DcsIssue,
    board: MyTasksProjectBucket["board"],
    opts?: { step?: TaskStep; app?: SolverApp },
  ) {
    const app =
      opts?.app ||
      (opts?.step?.solverAppId
        ? findSolverApp(solversCatalog, opts.step.solverAppId)
        : undefined) ||
      resolveSolverForIssue(solversCatalog, board, issue);
    if (!app) {
      setError("Esta subtarea no tiene herramienta de resolución.");
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
      setError("No se pudo armar el contexto para la herramienta.");
      return;
    }
    onMarkSeen?.(issue.number);
    setActing(issue.number);
    setError("");
    try {
      openSolverApp(app, ctx);
      announce(
        opts?.step
          ? `Abriendo «${app.name}» · ${opts.step.name} (#${issue.number})`
          : `Abriendo «${app.name}» para #${issue.number}`,
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
        announce(`Revisión abierta para #${issue.number}`);
      }
    } catch (err) {
      announce(
        `El paso se guardó, pero no se pudo abrir la revisión: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async function toggleChecklistStep(
    issue: DcsIssue,
    board: MyTasksProjectBucket["board"],
    stepId: string,
  ) {
    const taskId = issueTaskId(issue);
    const task = taskId ? board.teams.find((t) => t.id === taskId) : undefined;
    const steps = task?.steps ?? [];
    const step = steps.find((s) => s.id === stepId);
    if (!step) return;
    if (stepClaimMode(step) !== "none") {
      setError("Este paso se completa con Tomar / Aprobar, no con la casilla.");
      return;
    }
    const current = parseTaskProgressMarker(issue.body);
    const wasDone = current.doneStepIds.includes(stepId);
    let next = toggleStepDone(current, stepId);
    // Seat the worker on free checklist steps so later exclusive/pool exclusions work.
    if (!wasDone && next.doneStepIds.includes(stepId)) {
      const runtime = getStepRuntime(next, stepId);
      if (!runtime.assignees.length) {
        next = withStepRuntime(next, stepId, {
          ...runtime,
          assignees: [session.username],
        });
      }
    }
    setActing(issue.number);
    setError("");
    try {
      const updated = await setIssueTaskProgress(session, pmOrg, issue, next);
      if (
        !wasDone &&
        next.doneStepIds.includes(stepId) &&
        stepCompletesDraftForReview(steps, stepId)
      ) {
        await tryEnsurePortionPr(updated, board);
      }
      announce(
        next.doneStepIds.includes(stepId)
          ? `Paso marcado en #${issue.number}`
          : `Paso desmarcado en #${issue.number}`,
      );
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(null);
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
      setError("No puedes tomar este paso ahora.");
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
      announce(`Tomaste «${step.name}» en #${issue.number}`);
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
      setError("No puedes aprobar este paso ahora.");
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
          ? `«${step.name}» completado en #${issue.number}`
          : `Aprobaste «${step.name}» en #${issue.number}`,
      );
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
          ? ` · no se supo quién más escribió ${posted.unknownOther.join(", ")}`
          : "";
      }
      if (publishError) {
        setError(`#${issue.number} se cerró, pero no se pudo dejar el conflicto en la conversación: ${publishError}`);
      }
      announce(
        merge.status === "verses"
          ? conflictCount
            ? `#${issue.number} cerrado · versículos guardados en el borrador grupal · ${conflictCount} conflicto(s): decídelo en la conversación${conflictNote}`
            : `#${issue.number} cerrado · versículos guardados en el borrador grupal`
          : merge.status === "merged"
            ? `#${issue.number} cerrado · guardado en el borrador grupal`
            : `#${issue.number} cerrado`,
      );
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(null);
    }
  }

  async function take(issue: DcsIssue, board: MyTasksProjectBucket["board"]) {
    if (!canClaimIssue(session, pmOrg, issue, board, myLevel)) {
      setError("No puedes tomar esta subtarea.");
      return;
    }
    setActing(issue.number);
    try {
      await claimIssue(session, pmOrg, issue.number);
      announce(`Tomaste #${issue.number}`);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(null);
    }
  }

  async function liberar(issue: DcsIssue, browseProject: boolean) {
    if (!canUnassignIssue(session, issue, browseProject)) {
      setError("No puedes liberar la asignación de otro.");
      return;
    }
    setActing(issue.number);
    try {
      await unclaimIssue(session, pmOrg, issue.number);
      announce(`Liberada #${issue.number}`);
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
  const waitingText = (issue: DcsIssue, bucket: MyTasksProjectBucket): string => holdFor(issue, bucket)?.text ?? "";

  function renderQueueRow(issue: DcsIssue, bucket: MyTasksProjectBucket, featured = false) {
    return (
            <QueueRow
              key={issue.id}
              issue={issue}
              activity={rowActivity(cursor, issue.number)}
              canOpenThread={canOpenConversation(
                issue,
                session.username,
                canManage,
                opensAsTeamDecision(session, pmOrg, bucket.board, issue),
              )}
              onOpenThread={() => onOpenThread(issue.number)}
              now={now}
              session={session}
              pmOrg={pmOrg}
              board={bucket.board}
              browseProject={bucket.browseProject}
              solversCatalog={solversCatalog}
              acting={acting}
              onTake={() =>
                void take(issue, bucket.board)
              }
              onStart={() => void start(issue)}
              lang={lang}
              contentOrg={contentOrg}
              onResolve={(step) =>
                void resolve(issue, bucket.board, {
                  step,
                  app: step?.solverAppId
                    ? findSolverApp(
                        solversCatalog,
                        step.solverAppId,
                      )
                    : undefined,
                })
              }
              onToggleStep={(stepId) =>
                void toggleChecklistStep(
                  issue,
                  bucket.board,
                  stepId,
                )
              }
              onClaimStep={(step) =>
                void claimStepOnIssue(
                  issue,
                  bucket.board,
                  step,
                )
              }
              onApproveStep={(step) =>
                void approveStepOnIssue(
                  issue,
                  bucket.board,
                  step,
                )
              }
              onClose={() =>
                void close(issue, bucket.board)
              }
              featured={featured}
              waiting={waitingText(issue, bucket)}
              holdKind={holdFor(issue, bucket)?.kind}
              myLevel={myLevel}
              onBegin={() => void begin(issue, bucket.board)}
              onLiberar={() =>
                void liberar(
                  issue,
                  bucket.browseProject,
                )
              }
            />
    );
  }

  /** «Empezar»: take the subtarea if it is free, then open its editor. */
  async function begin(issue: DcsIssue, board: MyTasksProjectBucket["board"]) {
    const holder = projects.find((p) => p.board === board);
    if (holder && waitingText(issue, holder)) {
      setError(waitingText(issue, holder));
      return;
    }
    if (isIssueUnassigned(issue)) {
      if (!canClaimIssue(session, pmOrg, issue, board, myLevel)) {
        setError("No puedes tomar esta subtarea.");
        return;
      }
      setActing(issue.number);
      try {
        await claimIssue(session, pmOrg, issue.number);
        announce(`Tomaste #${issue.number}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setActing(null);
        return;
      }
    }
    await resolve(issue, board);
  }

  // «Ahora»: the one thing to do next. Decisions first, then work in progress, then the rest of mine.
  const nowDecide = attentionRows.find((row) => row.decide);
  const ready = mineRows.filter((row) => !waitingText(row.issue, row.bucket));
  const nowMine = ready.find((row) => issueIsInProgress(row.issue)) ?? ready[0];
  const nowFree = !nowDecide && !nowMine ? freeRows[0] : undefined;

  const showEmpty =
    loaded &&
    !busy &&
    Boolean(pmOrg) &&
    visibleProjects.length === 0 &&
    stepOffers.length === 0;
  const showQueue = visibleProjects.length > 0 || stepOffers.length > 0;
  const t = useT();
  const language = useUiLanguage();
  const hadWork = useHadWork(
    hadWorkKey(session.host, session.username, pmOrg),
    loaded && !busy,
    Boolean(nowDecide || nowMine || nowFree),
  );

  return (
    <div className="hub">
      <div className="hub-header">
        <div>
          <h1 className="hub-title">{mode === "ahora" ? t("nav.now") : mode === "avisos" ? t("nav.alerts") : t("mt.title")}</h1>
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

      {pmOrg && mode === "lista" ? (
        <div className="hub-toolbar">
          <div className="hub-filters" role="tablist" aria-label={t("mt.filterLabel")}>
            {(
              [
                { id: "mine" as const, label: t("mt.filterMine"), count: mineCount },
                ...(hasBrowse
                  ? [
                      {
                        id: "all" as const,
                        label: t("mt.filterAll"),
                        count: projects.reduce((n, p) => n + p.issues.length, 0),
                      },
                      {
                        id: "available" as const,
                        label: t("mt.filterAvailable"),
                        count: availableCount,
                      },
                    ]
                  : []),
              ] as { id: MyTasksFilter; label: string; count: number }[]
            ).map(({ id, label, count }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={filter === id}
                className={filter === id ? "hub-filter hub-filter--active" : "hub-filter"}
                onClick={() => {
                  setFilterTouched(true);
                  setFilter(id);
                  setCollapseSeeded(false);
                }}
              >
                {label}{" "}
                <span className="hub-filter__count">{busy && !loaded ? "—" : count}</span>
              </button>
            ))}
          </div>
          {showQueue || search ? (
            <Input
              className="hub-toolbar__search"
              placeholder={t("mt.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t("mt.searchLabel")}
            />
          ) : null}
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}


      {pmOrg && loaded && mode === "ahora" && (nowDecide || nowMine || nowFree) ? (
        <section className="hub-now" aria-labelledby="hub-now-title">
          <p className="hub-now__kicker" id="hub-now-title">{t("nav.now")}</p>
          {nowDecide ? (
            <div className="hub-now__decide">
              <h2 className="hub-now__title">{localizeName(nowDecide.issue.title, language)}</h2>
              <p className="hub-now__text">{t("mt.decideText")}</p>
              <Button type="button" size="lg" onClick={() => onOpenThread(nowDecide.issue.number)}>
                {t("mt.decide")}
              </Button>
            </div>
          ) : nowMine ? (
            <div className="hub-now__row">{renderQueueRow(nowMine.issue, nowMine.bucket, true)}</div>
          ) : nowFree ? (
            <div className="hub-now__row">{renderQueueRow(nowFree.issue, nowFree.bucket, true)}</div>
          ) : null}
        </section>
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
              const line = previewLine(activity.latest);
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

      {pmOrg && loaded && !busy && mode === "ahora" && !nowDecide && !nowMine && !nowFree ? (
        <div className="hub-empty-panel">
          <span className="hub-empty-panel__kicker">{t("empty.now")}</span>
          <h2 className="hub-empty-panel__title">{hadWork ? t("empty.upTitle") : t("empty.firstTitle")}</h2>
          <p className="hub-empty-panel__body">{hadWork ? t("empty.upBody") : t("empty.firstBody")}</p>
        </div>
      ) : null}

      {pmOrg && loaded && mode === "ahora" && attentionRows.length ? (
        <a className="hub-now__link" href="#/avisos">
          {attentionRows.length === 1
            ? t("mt.oneAlert")
            : t("mt.nAlerts").replace("{n}", String(attentionRows.length))}
          <ChevronRight aria-hidden />
        </a>
      ) : null}

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

      {showEmpty && mode === "lista" ? (
        <div className="hub-empty-panel">
          <span className="hub-empty-panel__kicker">{t("mt.emptyKicker")}</span>
          <h2 className="hub-empty-panel__title">
            {search.trim()
              ? t("mt.noMatches")
              : !hadWork && filter === "mine"
                ? t("empty.firstTitle")
                : filter === "available"
                ? t("mt.nothingAvailable")
                : filter === "all"
                  ? t("mt.noSubtasks")
                  : t("mt.nothingAssigned")}
          </h2>
          <p className="hub-empty-panel__body">
            {search.trim()
              ? t("mt.tryOther")
              : !hadWork && filter === "mine" && availableCount === 0
                ? t("empty.firstBody")
                : filter === "mine" && availableCount > 0
                ? t("mt.freeAvailable").replace("{n}", String(availableCount))
                : hasBrowse
                  ? t("mt.useAvailable")
                  : t("mt.managerWillAssign")}
          </p>
          <div className="hub-empty-panel__actions">
            {filter === "mine" && availableCount > 0 && !search.trim() ? (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setFilterTouched(true);
                  setFilter("available");
                  setCollapseSeeded(false);
                }}
              >
                {t("mt.seeAvailable").replace("{n}", String(availableCount))}
              </Button>
            ) : null}
            {search.trim() ? (
              <Button type="button" size="sm" variant="secondary" onClick={() => setSearch("")}>
                {t("mt.clearSearch")}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void reload()}
              >
                {t("mt.checkAgain")}
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {showQueue && mode === "lista" ? (
        <>
          <div className="grid gap-1.5">
            <button
              type="button"
              className="w-fit text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setHelpOpen((v) => !v)}
            >
              {helpOpen ? t("mt.hideHelp") : t("mt.howItWorks")}
            </button>
            {helpOpen ? (
              <>
                <p className="hub-hint">
                  {hasBrowse ? t("mt.helpBrowse") : t("mt.helpNoBrowse")}
                </p>
                <p className="hub-hint">{t("mt.helpDot").replace("{app}", appName(language))}</p>
              </>
            ) : null}
          </div>

          {stepOffers.length ? (
            <div className="hub-queue hub-queue--claims">
              <div className="hub-queue-head hub-queue-head--static">
                <div className="hub-queue-head__text">
                  <h2 className="hub-queue-head__title">{t("mt.reviews")}</h2>
                  <div className="hub-queue-head__meta text-xs text-muted-foreground">
                    {t("mt.reviewsMeta")}
                  </div>
                </div>
                <span className="hub-queue-head__count text-xs text-muted-foreground tabular-nums">
                  {stepOffers.length}
                </span>
              </div>
              <div className="hub-queue-list">
                {stepOffers.map((offer) => {
                  const busyOffer = acting === offer.issue.number;
                  const modeLabel =
                    offer.step.claimMode === "pool" ? t("mt.modeGroup") : t("mt.modePairs");
                  const seatsLabel =
                    offer.step.claimMode === "pool"
                      ? `${offer.seated}/${offer.minSeats}`
                      : offer.seated ? t("mt.seatTaken") : t("mt.seatFree");
                  return (
                    <div
                      key={`${offer.issue.number}:${offer.step.id}:${offer.action}`}
                      className="hub-queue-item"
                    >
                      <div className="hub-queue-item__row">
                        <div className="hub-queue-item__main min-w-0">
                          <div className="hub-queue-item__title">
                            <span className="hub-queue-item__num">
                              #{offer.issue.number}
                            </span>
                            <span className="hub-queue-item__label">
                              {localizeName(offer.step.name, language)} · {localizeName(shortTitle(offer.issue), language)}
                            </span>
                          </div>
                          <div className="hub-queue-item__meta">
                            <Badge variant="secondary">{modeLabel}</Badge>
                            <span className="text-xs text-muted-foreground">
                              {offer.projectTitle}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {seatsLabel}
                            </span>
                          </div>
                        </div>
                        <div className="hub-queue-item__actions">
                          {offer.action === "claim" ? (
                            <Button
                              type="button"
                              size="sm"
                              disabled={busyOffer}
                              onClick={() => void takeStepClaim(offer)}
                            >
                              {offer.step.claimMode === "pool"
                                ? t("mt.takeReview")
                                : t("mt.take")}
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              disabled={busyOffer}
                              onClick={() => void approveStepClaim(offer)}
                            >
                              {t("mt.approve")}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="hub-queue">
            {visibleProjects.map((bucket) => {
              const phases = groupQueue(bucket.board, bucket.issues);
              const projectKey = projectCollapseKey(bucket.projectId);
              const projectCollapsed = collapsed.has(projectKey);
              return (
                <section key={bucket.projectId} className="hub-queue-group">
                  <button
                    type="button"
                    className="hub-queue-head"
                    aria-expanded={!projectCollapsed}
                    onClick={() => toggleCollapsed(projectKey)}
                  >
                    <ChevronDown
                      className={cn(
                        "hub-queue-chapter__chevron",
                        projectCollapsed && "hub-queue-chapter__chevron--collapsed",
                      )}
                      aria-hidden
                    />
                    <div className="hub-queue-head__identity min-w-0">
                      <div className="font-semibold text-foreground">{bucket.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {bucket.projectId}
                        {bucket.browseProject ? t("mt.selfAssign") : ""}
                        {filter === "mine"
                          ? t("mt.nInProgress").replace("{n}", String(bucket.issues.filter((i) => issueIsInProgress(i)).length))
                          : ""}
                      </div>
                    </div>
                    <span className="hub-queue-head__count text-xs text-muted-foreground tabular-nums">
                      {bucket.issues.length}{" "}
                      {bucket.issues.length === 1 ? t("mt.subtask") : t("mt.subtasks")}
                    </span>
                  </button>

                  {!projectCollapsed
                    ? phases.map((phase) => {
                        const phaseKey = phaseCollapseKey(bucket.projectId, phase.phaseId);
                        const phaseCollapsed = collapsed.has(phaseKey);
                        return (
                          <div key={phaseKey} className="hub-queue-phase">
                            <button
                              type="button"
                              className="hub-queue-phase__head"
                              aria-expanded={!phaseCollapsed}
                              onClick={() => toggleCollapsed(phaseKey)}
                            >
                              <ChevronDown
                                className={cn(
                                  "hub-queue-chapter__chevron",
                                  phaseCollapsed && "hub-queue-chapter__chevron--collapsed",
                                )}
                                aria-hidden
                              />
                              <span className="hub-queue-phase__title">{localizeName(phase.label, language)}</span>
                              <span className="hub-queue-chapter__count">{phase.issueCount}</span>
                            </button>
                            {!phaseCollapsed
                              ? phase.tasks.map((task) => {
                                  const taskKey = taskCollapseKey(
                                    bucket.projectId,
                                    task.taskId,
                                  );
                                  const taskCollapsed = collapsed.has(taskKey);
                                  return (
                                    <div key={taskKey} className="hub-queue-task">
                                      <button
                                        type="button"
                                        className="hub-queue-task__head"
                                        aria-expanded={!taskCollapsed}
                                        onClick={() => toggleCollapsed(taskKey)}
                                      >
                                        <ChevronDown
                                          className={cn(
                                            "hub-queue-chapter__chevron",
                                            taskCollapsed &&
                                              "hub-queue-chapter__chevron--collapsed",
                                          )}
                                          aria-hidden
                                        />
                                        <span className="hub-queue-task__title">{localizeName(task.label, language)}</span>
                                        <span className="hub-queue-chapter__count">
                                          {task.issueCount}
                                        </span>
                                      </button>
                                      {!taskCollapsed
                                        ? task.chapters.map((group) => {
                                            const key = chapterCollapseKey(
                                              bucket.projectId,
                                              task.taskId,
                                              group.chapter,
                                            );
                                            const isCollapsed = collapsed.has(key);
                                            const label =
                                              group.chapter > 0
                                                ? t("mt.chapter").replace("{n}", String(group.chapter))
                                                : t("mt.noChapter");
                                            return (
                                              <div key={key} className="hub-queue-chapter">
                                                <button
                                                  type="button"
                                                  className="hub-queue-chapter__head"
                                                  aria-expanded={!isCollapsed}
                                                  onClick={() => toggleCollapsed(key)}
                                                >
                                                  <ChevronDown
                                                    className={cn(
                                                      "hub-queue-chapter__chevron",
                                                      isCollapsed &&
                                                        "hub-queue-chapter__chevron--collapsed",
                                                    )}
                                                    aria-hidden
                                                  />
                                                  <span className="hub-queue-chapter__title">
                                                    {label}
                                                  </span>
                                                  <span className="hub-queue-chapter__count">
                                                    {group.issues.length}
                                                  </span>
                                                </button>
                                                {!isCollapsed
                                                  ? group.issues.map((issue) => renderQueueRow(issue, bucket))
                                                  : null}
                                              </div>
                                            );
                                          })
                                        : null}
                                    </div>
                                  );
                                })
                              : null}
                          </div>
                        );
                      })
                    : null}
                </section>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

function SolverLaunchControl({
  app,
  ctx,
  busy,
  variant = "outline",
  onClick,
}: {
  app: SolverApp;
  ctx: SolverLaunchContext | null;
  busy: boolean;
  variant?: "default" | "outline";
  onClick?: () => void;
}) {
  const label = solverActionLabel(app);
  const reason = ctx
    ? solverLaunchBlockReason(app, ctx)
    : "No se pudo armar el contexto para la herramienta.";
  const href = ctx && !reason ? resolveSolverLaunchUrl(app, ctx) : "";
  if (href && (app.kind === "url" || app.openMode === "external")) {
    return (
      <a
        className="btn"
        data-size="sm"
        data-variant={variant}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {label}
      </a>
    );
  }
  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      disabled={busy || Boolean(reason)}
      title={reason ?? undefined}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

function QueueRow({
  issue,
  activity,
  canOpenThread,
  onOpenThread,
  now,
  session,
  pmOrg,
  lang,
  contentOrg,
  board,
  browseProject,
  solversCatalog,
  acting,
  onTake,
  onStart,
  onResolve,
  onToggleStep,
  onClaimStep,
  onApproveStep,
  onClose,
  onLiberar,
  featured = false,
  onBegin,
  waiting = "",
  holdKind,
  myLevel,
}: {
  issue: DcsIssue;
  activity: RowActivity;
  canOpenThread: boolean;
  onOpenThread: () => void;
  now: Date;
  session: GtSession;
  pmOrg: string;
  lang: string;
  contentOrg: string;
  board: MyTasksProjectBucket["board"];
  browseProject: boolean;
  solversCatalog: SolversCatalog;
  acting: number | null;
  onTake: () => void;
  onStart: () => void;
  onResolve: (step?: TaskStep) => void;
  onToggleStep: (stepId: string) => void;
  onClaimStep: (step: TaskStep) => void;
  onApproveStep: (step: TaskStep) => void;
  onClose: () => void;
  onLiberar: () => void;
  /** «Ahora» card: bigger row; a free subtarea starts with one button. */
  featured?: boolean;
  onBegin?: () => void;
  /** Reason this subtarea cannot start yet (it waits for other work, or asks for a level). */
  waiting?: string;
  holdKind?: "espera" | "nivel";
  myLevel?: PersonLevel;
}) {
  const t = useT();
  const language = useUiLanguage();
  const mine = isIssueAssignedTo(issue, session.username);
  const open = isIssueUnassigned(issue);
  const inProgress = issueIsInProgress(issue);
  // A decision of the team has nobody assigned on purpose: people vote on it, they do not take it.
  const decision = isDecisionIssue(issue);
  const claimable = !decision && canClaimIssue(session, pmOrg, issue, board, myLevel);
  const liberable = canUnassignIssue(session, issue, browseProject);
  const busy = acting === issue.number;
  const taskId = issueTaskId(issue);
  const task = taskId ? board.teams.find((t) => t.id === taskId) : undefined;
  // A team decision is not the task's work: it has no steps of its own.
  const steps = decision ? [] : (task?.steps ?? []);
  const progress = parseTaskProgressMarker(issue.body);
  const issueAssignee =
    issue.assignee?.login || issue.assignees?.[0]?.login || undefined;
  const checklistDone = allStepsDone(
    steps.map((s) => s.id),
    progress,
  );
  const taskSolver = findSolverApp(solversCatalog, task?.solverAppId);
  const fallbackSolver = !steps.length
    ? resolveSolverForIssue(solversCatalog, board, issue)
    : undefined;
  const taskLevelSolver = taskSolver || (!steps.length ? fallbackSolver : undefined);
  const canResolveTask = Boolean(mine && taskLevelSolver);
  const familiarizeApp = findSolverApp(solversCatalog, FAMILIARIZE_SOLVER_ID);
  const launchCtx = buildSolverLaunchContext({
    username: session.username,
    lang,
    pmOrg,
    contentOrg,
    board,
    issue,
  });
  const showChecklist =
    !waiting &&
    steps.length > 0 &&
    (mine ||
      steps.some(
        (step) =>
          canClaimStep(
            session.username,
            steps,
            progress,
            step,
            undefined,
            issueAssignee,
          ) || canApproveStep(session.username, progress, step, issueAssignee),
      ));

  let status: ReactNode = null;
  if (decision && !waiting) status = <span className="status-chip" data-status="libre">{t("mt.statusDecision")}</span>;
  else if (waiting) status = <span className="status-chip" data-status="espera">{holdKind === "nivel" ? t("mt.statusNotYet") : t("mt.statusWaiting")}</span>;
  else if (open) status = <span className="status-chip" data-status="libre">{t("mt.statusAvailable")}</span>;
  else if (inProgress && mine) status = <span className="status-chip" data-status="curso">{t("mt.statusInProgress")}</span>;
  else if (mine) status = <span className="status-chip" data-status="tuya">{t("mt.statusMine")}</span>;
  else status = <span className="status-chip" data-status="otra">{localizeName(assigneeLabel(issue), language)}</span>;

  let primary: ReactNode = null;
  if (decision && canOpenThread) {
    primary = (
      <Button type="button" size="sm" onClick={onOpenThread}>
        {t("mt.vote")}
      </Button>
    );
  } else if (claimable && featured && onBegin) {
    primary = (
      <Button type="button" size="lg" disabled={busy} onClick={onBegin}>
        {t("mt.start")}
      </Button>
    );
  } else if (claimable) {
    primary = (
      <Button type="button" size="sm" disabled={busy} onClick={onTake}>
        {t("mt.take")}
      </Button>
    );
  } else if (mine && steps.length && checklistDone) {
    primary = (
      <Button type="button" size="sm" disabled={busy} onClick={onClose}>
        {t("mt.close")}
      </Button>
    );
  } else if (canResolveTask && !steps.length && taskLevelSolver) {
    primary = (
      <SolverLaunchControl
        app={taskLevelSolver}
        ctx={launchCtx}
        busy={busy}
        variant="default"
        onClick={() => onResolve()}
      />
    );
  } else if (mine && !inProgress) {
    primary = (
      <Button type="button" size="sm" disabled={busy} onClick={onStart}>
        {t("mt.start")}
      </Button>
    );
  } else if (mine && inProgress && (!steps.length || checklistDone)) {
    primary = (
      <Button type="button" size="sm" disabled={busy} onClick={onClose}>
        {t("mt.close")}
      </Button>
    );
  } else if (canResolveTask && taskLevelSolver) {
    primary = (
      <SolverLaunchControl
        app={taskLevelSolver}
        ctx={launchCtx}
        busy={busy}
        variant="default"
        onClick={() => onResolve()}
      />
    );
  }

  if (waiting) primary = null;

  const activityLine = previewLine(activity.latest);

  // One primary button per row; the rest lives in the "⋯" menu.
  const menuItems: RowMenuItem[] = [];
  if (mine && inProgress && canOpenThread) {
    menuItems.push({ id: "comment", label: t("mt.comment"), onSelect: onOpenThread });
  }
  if (mine && !claimable && !waiting && !(steps.length && checklistDone)) {
    menuItems.push({ id: "close", label: t("mt.closeTask"), onSelect: onClose, disabled: busy });
  }
  if (liberable && !claimable) {
    menuItems.push({ id: "release", label: t("mt.release"), onSelect: onLiberar, disabled: busy, danger: true });
  }

  return (
    <div
      className="hub-queue-item"
      id={rowDomId(issue.number)}
      data-unread={activity.unread ? "true" : "false"}
    >
      <div className="hub-queue-item__row">
        <div className="hub-queue-item__main min-w-0">
          {canOpenThread ? (
            <button
              type="button"
              className="hub-queue-item__title hub-queue-item__title--open"
              onClick={onOpenThread}
            >
              {activity.unread ? (
                <span className="hub-queue-item__dot" role="img" aria-label={t("mt.unread")} />
              ) : null}
              {activity.isNew ? (
                <span className="hub-attention__tag hub-attention__tag--new">{t("mt.tagNew")}</span>
              ) : null}
              <span className="hub-queue-item__label">{localizeName(shortTitle(issue), language)}</span>
              <ChevronRight className="hub-attention__chevron" aria-hidden />
            </button>
          ) : (
            <span className="hub-queue-item__title">
              {activity.isNew ? (
                <span className="hub-attention__tag hub-attention__tag--new">{t("mt.tagNew")}</span>
              ) : null}
              <span className="hub-queue-item__label">{localizeName(shortTitle(issue), language)}</span>
            </span>
          )}
          {activityLine && activity.latest ? (
            <div className="hub-queue-item__activity">
              <span className="hub-queue-item__preview">{activityLine}</span>
              <time className="hub-queue-item__time" dateTime={activity.latest.at}>
                {formatRelativeEs(activity.latest.at, now, language)}
              </time>
            </div>
          ) : null}
          <div className="hub-queue-item__meta">
            {status}
            {waiting ? <span className="text-xs text-muted-foreground">{waiting}</span> : null}
            {canResolveTask && taskLevelSolver ? (
              <span className="text-xs text-muted-foreground">{taskLevelSolver.name}</span>
            ) : null}
            {steps.length ? (
              <span className="text-xs text-muted-foreground">
                {progress.doneStepIds.filter((id) => steps.some((s) => s.id === id)).length}/
                {steps.length} {t("mt.steps")}
              </span>
            ) : null}
          </div>
        </div>
        <div className="hub-queue-item__actions">
          {primary}
          <RowMenu items={menuItems} />
        </div>
      </div>
      {showChecklist ? (
        <div className="hub-queue-checklist" role="list">
          {steps.map((step) => {
            const done = progress.doneStepIds.includes(step.id);
            const mode = stepClaimMode(step);
            const stepApp = findSolverApp(solversCatalog, step.solverAppId);
            const canClaim =
              mode !== "none" &&
              canClaimStep(
                session.username,
                steps,
                progress,
                step,
                undefined,
                issueAssignee,
              );
            const canApprove =
              mode !== "none" &&
              canApproveStep(session.username, progress, step, issueAssignee);
            const seating = getStepRuntime(progress, step.id);
            return (
              <div key={step.id} className="hub-queue-checklist__row" role="listitem">
                <label>
                  <input
                    type="checkbox"
                    checked={done}
                    disabled={busy || mode !== "none"}
                    onChange={() => {
                      if (mode === "none") onToggleStep(step.id);
                    }}
                  />
                  <span className={done ? "line-through text-muted-foreground" : undefined}>
                    {localizeName(step.name, language)}
                    {mode === "pool" && !done ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {seating.assignees.length}/
                        {Math.max(1, step.minAssignees ?? 2)}
                      </span>
                    ) : null}
                  </span>
                </label>
                <div className="flex flex-wrap items-center gap-1">
                  {canClaim ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => onClaimStep(step)}
                    >
                      {mode === "pool" ? t("mt.takeReview") : t("mt.take")}
                    </Button>
                  ) : null}
                  {canApprove ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={() => onApproveStep(step)}
                    >
                      {t("mt.approve")}
                    </Button>
                  ) : null}
                  {familiarizeApp && mine && stepApp ? (
                    <SolverLaunchControl
                      app={familiarizeApp}
                      ctx={launchCtx}
                      busy={busy}
                    />
                  ) : null}
                  {stepApp && mine && !isFamiliarizeSolver(stepApp) ? (
                    <SolverLaunchControl
                      app={stepApp}
                      ctx={launchCtx}
                      busy={busy}
                      onClick={() => onResolve(step)}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
