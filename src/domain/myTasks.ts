import type { DcsIssue } from "@ip-lms/dcs-client";
import type { GtSession } from "../dcs/auth";
import {
  isIssueAssignedTo,
  isIssueUnassigned,
  listMyIssues,
  listProjectOpenIssues,
} from "../dcs/issues";
import { loadAssignmentsFromDcs, listPmProjects } from "../dcs/persist";
import { parsePmFacetValue } from "./roles";
import {
  canClaimStep,
  canApproveStep,
  isStepActor,
  stepMaxAssignees,
  stepMinAssignees,
} from "./stepClaim";
import {
  emptyAssignments,
  loadLocalAssignments,
  projectAllowsSelfAssign,
  userInvolvedInProject,
} from "./store";
import {
  getStepRuntime,
  parseTaskProgressMarker,
  type TaskProgressMarker,
} from "./taskProgress";
import type { AssignmentsDoc, ProjectTask, TaskStep } from "./types";
import { parseWorkOrderMarker } from "./workOrder";
import { meetsLevel, type PersonLevel } from "./levels";

export type MyTasksFilter = "mine" | "all" | "available";

export type MyTasksProjectBucket = {
  projectId: string;
  title: string;
  /** Self-assign is on and the user is on a linked org team. */
  browseProject: boolean;
  board: AssignmentsDoc;
  issues: DcsIssue[];
  /**
   * Every OPEN subtarea of the project, when known. Used to tell which
   * tasks are still waiting for others (see `waits.ts`); absent = unknown.
   */
  openIssues?: DcsIssue[];
};

/**
 * Overlay local `solverAppId` / `steps` onto the DCS plan. Binding a tool or
 * claim policy in Fases y tareas is saved locally immediately; Mis tareas
 * previously only saw DCS and missed it until Entregar.
 */
export function mergeLocalSolverBindings(
  remote: AssignmentsDoc,
  local: AssignmentsDoc | null,
): AssignmentsDoc {
  if (!local?.teams?.length) return remote;
  const localById = new Map(local.teams.map((t) => [t.id, t]));
  let changed = false;
  const teams: ProjectTask[] = remote.teams.map((task) => {
    const loc = localById.get(task.id);
    if (!loc) return task;
    const solverAppId = loc.solverAppId?.trim() || task.solverAppId;
    const steps = loc.steps?.length ? loc.steps : task.steps;
    if (solverAppId === task.solverAppId && steps === task.steps) return task;
    changed = true;
    return {
      ...task,
      solverAppId: solverAppId || undefined,
      steps: steps?.length ? steps : undefined,
    };
  });
  return changed ? { ...remote, teams } : remote;
}

export function userOnTaskTeam(
  session: GtSession,
  pmOrg: string,
  task: ProjectTask | undefined,
): boolean {
  if (session.canManage) return true;
  const orgTeamName = task?.orgTeamName?.trim();
  if (!orgTeamName) return false;
  return (session.teams ?? []).some(
    (t) => t.organization?.name === pmOrg && t.name === orgTeamName,
  );
}

export function issueProjectId(issue: DcsIssue): string {
  return (
    issue.milestone?.title ||
    parseWorkOrderMarker(issue.body)?.book ||
    ""
  ).trim();
}

/** `pm/tarea:{id}` or work-order marker `teamId`. */
export function issueTaskId(issue: DcsIssue): string {
  return (
    (issue.labels ?? []).map((l) => parsePmFacetValue(l.name, "tarea")).find(Boolean) ||
    parseWorkOrderMarker(issue.body)?.teamId ||
    ""
  );
}

/** Member of the org team linked to this issue’s task. */
export function canClaimIssue(
  session: GtSession,
  pmOrg: string,
  issue: DcsIssue,
  board: AssignmentsDoc,
  /** The signed-in person's level (see `levels.ts`); unknown = not filtered. */
  myLevel?: PersonLevel,
): boolean {
  if (!projectAllowsSelfAssign(board) || !isIssueUnassigned(issue)) return false;
  if (session.canManage) return true;
  const taskId = issueTaskId(issue);
  const task = taskId ? board.teams.find((t) => t.id === taskId) : undefined;
  if (!meetsLevel(myLevel, task?.minLevel)) return false;
  const orgTeamName = task?.orgTeamName;
  if (!orgTeamName) return false;
  return (session.teams ?? []).some(
    (t) => t.organization?.name === pmOrg && t.name === orgTeamName,
  );
}

/**
 * Liberar: own work when self-assign is on; any assignee when `canManage`.
 */
export function canUnassignIssue(
  session: GtSession,
  issue: DcsIssue,
  browseProject: boolean,
): boolean {
  if (isIssueUnassigned(issue)) return false;
  if (session.canManage) return true;
  if (!browseProject) return false;
  return isIssueAssignedTo(issue, session.username);
}

export function filterProjectIssues(
  issues: DcsIssue[],
  filter: MyTasksFilter,
  username: string,
  board?: AssignmentsDoc,
): DcsIssue[] {
  if (filter === "all") return issues;
  if (filter === "available") return issues.filter(isIssueUnassigned);
  return issues.filter(
    (issue) =>
      isIssueAssignedTo(issue, username) ||
      (board ? userHasActiveStepRole(username, board, issue) : false),
  );
}

/**
 * Projects the worker should see: own open issues, plus full queues for
 * projects with `settings.allowSelfAssign` where the user is involved
 * (or is a gestor verifying the queue).
 */
export async function loadMyTasksProjects(params: {
  session: GtSession;
  pmOrg: string;
  lang: string;
  contentOrg: string;
}): Promise<MyTasksProjectBucket[]> {
  const { session, pmOrg, lang, contentOrg } = params;
  const [mine, index] = await Promise.all([
    listMyIssues(session, pmOrg),
    listPmProjects(session, pmOrg, lang).catch(() => [] as Awaited<ReturnType<typeof listPmProjects>>),
  ]);

  const titleById = new Map(index.map((row) => [row.projectId.toUpperCase(), row.title]));
  const projectIds = new Set<string>();
  for (const row of index) projectIds.add(row.projectId);
  for (const issue of mine) {
    const id = issueProjectId(issue);
    if (id) projectIds.add(id);
  }

  const buckets: MyTasksProjectBucket[] = [];
  for (const projectId of [...projectIds].sort((a, b) => a.localeCompare(b, "es"))) {
    const fromDcs = await loadAssignmentsFromDcs(session, pmOrg, lang, projectId, contentOrg);
    const local = loadLocalAssignments(lang, projectId, contentOrg, pmOrg);
    const doc =
      fromDcs && fromDcs.teams.length
        ? mergeLocalSolverBindings(fromDcs, local)
        : local.teams.length
          ? local
          : fromDcs ?? emptyAssignments(projectId, lang, contentOrg, pmOrg);
    const involved = userInvolvedInProject(doc, session.teams, pmOrg);
    const allow = projectAllowsSelfAssign(doc);
    // Gestores can browse open queues to verify publish; workers need team link.
    const browseProject = allow && (involved || Boolean(session.canManage));
    const mineInProject = mine.filter(
      (issue) => issueProjectId(issue).toUpperCase() === projectId.toUpperCase(),
    );

    if (!browseProject && !mineInProject.length) continue;

    const issues = browseProject
      ? await listProjectOpenIssues(session, pmOrg, projectId)
      : mineInProject;
    // Waiting only needs the other open subtareas of the project: fetched when the plan has rules.
    const hasWaits = doc.teams.some((t) => t.waitsFor?.length);
    const openIssues = browseProject
      ? issues
      : hasWaits
        ? await listProjectOpenIssues(session, pmOrg, projectId).catch(() => undefined)
        : undefined;

    buckets.push({
      projectId: doc.projectId || projectId,
      title: doc.title || titleById.get(projectId.toUpperCase()) || projectId,
      browseProject,
      board: doc,
      issues,
      openIssues,
    });
  }

  return buckets;
}

export type StepClaimOffer = {
  projectId: string;
  projectTitle: string;
  issue: DcsIssue;
  task: ProjectTask;
  step: TaskStep;
  progress: TaskProgressMarker;
  seated: number;
  minSeats: number;
  maxSeats: number;
  action: "claim" | "approve";
};

function issueAssigneeLogin(issue: DcsIssue): string | undefined {
  return issue.assignee?.login || issue.assignees?.[0]?.login || undefined;
}

/** User is seated (or approving author) on an unfinished claim-mode step. */
export function userHasActiveStepRole(
  username: string,
  board: AssignmentsDoc,
  issue: DcsIssue,
): boolean {
  const taskId = issueTaskId(issue);
  const task = taskId ? board.teams.find((t) => t.id === taskId) : undefined;
  const steps = task?.steps ?? [];
  if (!steps.length) return false;
  const progress = parseTaskProgressMarker(issue.body ?? "");
  const fallback = issueAssigneeLogin(issue);
  return steps.some(
    (step) =>
      (step.claimMode === "exclusive" || step.claimMode === "pool") &&
      isStepActor(username, progress, step, fallback),
  );
}

/**
 * Exclusive/pool steps the current user can claim or approve now.
 * Scans open issues in browsable projects — independent of issue assignee.
 */
export function listStepClaimOffers(
  session: GtSession,
  pmOrg: string,
  buckets: MyTasksProjectBucket[],
): StepClaimOffer[] {
  const login = session.username;
  const offers: StepClaimOffer[] = [];

  for (const bucket of buckets) {
    if (!bucket.browseProject) continue;
    for (const issue of bucket.issues) {
      if ((issue.state ?? "").toLowerCase() === "closed") continue;
      const taskId = issueTaskId(issue);
      const task = taskId
        ? bucket.board.teams.find((t) => t.id === taskId)
        : undefined;
      if (!task || !userOnTaskTeam(session, pmOrg, task)) continue;
      const steps = task.steps ?? [];
      if (!steps.length) continue;
      const progress = parseTaskProgressMarker(issue.body ?? "");
      const issueAssignee = issueAssigneeLogin(issue);
      for (const step of steps) {
        const mode = step.claimMode ?? "none";
        if (mode !== "exclusive" && mode !== "pool") continue;
        const seating = getStepRuntime(progress, step.id);
        const base = {
          projectId: bucket.projectId,
          projectTitle: bucket.title,
          issue,
          task,
          step,
          progress,
          seated: seating.assignees.length,
          minSeats: stepMinAssignees(step),
          maxSeats: stepMaxAssignees(step),
        };
        if (canClaimStep(login, steps, progress, step, undefined, issueAssignee)) {
          offers.push({ ...base, action: "claim" });
        } else if (canApproveStep(login, progress, step, issueAssignee)) {
          offers.push({ ...base, action: "approve" });
        }
      }
    }
  }

  return offers.sort((a, b) => {
    const byAction = a.action.localeCompare(b.action);
    if (byAction) return byAction;
    const byProj = a.projectTitle.localeCompare(b.projectTitle, "es");
    if (byProj) return byProj;
    const byBook = a.issue.title.localeCompare(b.issue.title, "es");
    if (byBook) return byBook;
    return a.step.name.localeCompare(b.step.name, "es");
  });
}
