import type { DcsIssue } from "@ip-lms/dcs-client";
import { stepMaxAssignees } from "./stepClaim";
import { emptyTaskProgress, parseTaskProgressMarker, upsertTaskProgressInBody, withStepRuntime, type TaskProgressMarker } from "./taskProgress";
import type { AssignmentsDoc, InventoryDoc, ProjectTask } from "./types";
import { indexWorkIssues, parseWorkOrderMarker, publishableWorkOrders, workOrderIssueBody, type WorkOrder } from "./workOrder";

/**
 * One subtask per chapter for a task of a project that was cut by passage (Abel, 13 November 2026: Ezra's tuning team
 * saw «4:11–13» on its own and wanted «the task of chapter 4», with everything already answered in it).
 *
 * Pure: what to write. The answers of a tuning task are kept per item beside the draft, not in its subtask, so a
 * subtask of the chapter shows every answer given in its passages. What a passage subtask carries (who sits in its
 * step) goes to the chapter's; its approvals and its count of work do not, because they were of the passage only.
 */

/**
 * The task as the newer process cuts it: one subtask per chapter (or per stretch of a split chapter). With `steps`,
 * its steps are the process's too: Alinear went from one person per passage and others reviewing to one step the
 * whole team shares in a chapter.
 */
export function cutByChapter(task: ProjectTask, steps?: ProjectTask["steps"]): ProjectTask {
  return { ...task, bundle: { ...(task.bundle ?? {}), enabled: true, grain: "chapter" }, distributeUnit: "chapter", distributePolicy: "manual", ...(steps ? { steps } : {}) };
}

export type ChapterSubtask = {
  order: WorkOrder;
  /** The chapter's subtask, when a run before already made it. */
  existing?: DcsIssue;
  /** The passage subtasks it gathers, open and closed. */
  from: DcsIssue[];
  /** Closed when all its passages were: made only so that publishing the plan again never opens it. */
  state: "open" | "closed";
  /** The body to create it with (none when it exists). */
  body?: string;
  begun: boolean;
  /** Somebody worked in one of its open passages: its conversation says what it gathered. */
  touched: boolean;
};

export type RegroupPlan = {
  board: AssignmentsDoc;
  chapters: ChapterSubtask[];
  /** Open passage subtasks to close, each into its chapter's; `touched`: somebody worked in it, so it says where. */
  close: Array<{ issue: DcsIssue; into: ChapterSubtask; touched: boolean }>;
};

/** Somebody sat in it, began it or wrote in it. Nehemiah's 290 untouched passages are closed without a word. */
export function isTouched(issue: DcsIssue): boolean {
  const progress = parseTaskProgressMarker(issue.body ?? "");
  const seated = Object.values(progress.steps ?? {}).some((step) => step?.assignees?.length);
  return seated || progress.doneStepIds.length > 0 || isBegun(issue) || (issue.comments ?? 0) > 0;
}

const begunMark = "<!-- gt:en-curso -->";

export function isBegun(issue: DcsIssue): boolean {
  return Boolean(issue.body?.includes(begunMark)) || (issue.labels ?? []).some((label) => /(^|[/:])en-curso$/.test(label?.name ?? ""));
}

/**
 * Everybody seated in each step of the passages, once each, up to the places of the step. When the chapter has one
 * step for the whole team (Alinear, 13 November), whoever sat in any step of a passage sits in it: who aligned and
 * who reviewed are both of the team now.
 */
function seatsOf(task: ProjectTask, from: DcsIssue[]): TaskProgressMarker {
  let progress = emptyTaskProgress();
  const single = (task.steps ?? []).length === 1;
  for (const step of task.steps ?? []) {
    const people = new Map<string, string>();
    for (const issue of from) {
      const steps = parseTaskProgressMarker(issue.body ?? "").steps ?? {};
      const seated = single ? Object.values(steps).flatMap((s) => s?.assignees ?? []) : steps[step.id]?.assignees ?? [];
      for (const login of seated) {
        if (login && !people.has(login.toLowerCase())) people.set(login.toLowerCase(), login);
      }
    }
    const seated = [...people.values()].slice(0, stepMaxAssignees(step));
    if (seated.length) progress = withStepRuntime(progress, step.id, { assignees: seated, approvals: [] });
  }
  return progress;
}

export function planRegroup(params: {
  board: AssignmentsDoc;
  inventory: InventoryDoc;
  taskId: string;
  /** Every subtask of the project, open and closed. */
  issues: DcsIssue[];
  /** When the passages were gathered, for the chapters already finished. */
  at: string;
  /** The steps the task takes now, when they changed with the cut (see `cutByChapter`). */
  steps?: ProjectTask["steps"];
}): RegroupPlan {
  const { inventory, taskId, issues, at } = params;
  const task = params.board.teams.find((t) => t.id === taskId);
  if (!task) throw new Error(`La tarea ${taskId} no está en el plan.`);
  const cut = cutByChapter(task, params.steps);
  const board: AssignmentsDoc = { ...params.board, teams: params.board.teams.map((t) => (t.id === taskId ? cut : t)) };
  const orders = publishableWorkOrders(board, inventory).filter((order) => order.teamId === taskId && !order.parentIssue);
  // The work subtasks of the task: not the decisions opened from them.
  const mine = issues.filter((issue) => {
    const marker = parseWorkOrderMarker(issue.body);
    return marker?.teamId === taskId && !marker.parentIssue;
  });
  const known = indexWorkIssues(mine);
  const chapters: ChapterSubtask[] = [];
  const close: RegroupPlan["close"] = [];
  for (const order of orders) {
    const existing = known.find(order);
    const inside = new Set(order.portionIds);
    const from = mine.filter((issue) => {
      if (issue === existing) return false;
      const portions = parseWorkOrderMarker(issue.body)?.portionIds ?? [];
      return portions.length > 0 && portions.every((id) => inside.has(id));
    });
    // A chapter with no passage subtask was never planned for this task: nothing is made for it.
    if (!existing && !from.length) continue;
    const open = from.filter((issue) => issue.state !== "closed");
    const begun = open.some(isBegun);
    const touched = open.some(isTouched);
    const chapter: ChapterSubtask = { order, from, state: open.length || existing?.state === "open" ? "open" : "closed", begun, touched };
    if (existing) chapter.existing = existing;
    else if (open.length) {
      const body = upsertTaskProgressInBody(workOrderIssueBody(order), seatsOf(cut, open));
      chapter.body = begun ? `${begunMark}\n${body}` : body;
    } else {
      // Every passage was finished: the chapter is, and its pace is not counted again.
      const done: TaskProgressMarker = { ...emptyTaskProgress(), doneStepIds: (cut.steps ?? []).map((step) => step.id), brought: { from: "porciones", at } };
      chapter.body = upsertTaskProgressInBody(workOrderIssueBody(order), done);
    }
    chapters.push(chapter);
    for (const issue of open) close.push({ issue, into: chapter, touched: isTouched(issue) });
  }
  return { board, chapters, close };
}

/** What a chapter's subtask says it gathered, for its conversation. */
export function gatheredNote(chapter: number, from: DcsIssue[]): string {
  const list = from
    .slice()
    .sort((a, b) => a.number - b.number)
    .map((issue) => `#${issue.number}${issue.state === "closed" ? " (cerrada)" : ""}`)
    .join(", ");
  return `Esta tarea junta las porciones del capítulo ${chapter}: ${list}. Lo que se respondió en ellas se ve aquí; la conversación de cada porción sigue en su número.`;
}

/** What a passage subtask says when it is closed into its chapter's. */
export function closedIntoNote(chapter: number, into: number): string {
  return `Esta porción se juntó en la tarea del capítulo ${chapter}: #${into}. Lo que se respondió aquí sigue allí.`;
}
