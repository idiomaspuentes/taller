import type { DcsIssue } from "@ip-lms/dcs-client";
import { isDecisionIssue } from "./decisionAccess";
import { isExtraItemId } from "./extraWork";
import { issueTaskId } from "./myTasks";
import { isStepDone, parseTaskProgressMarker, type TaskProgressMarker } from "./taskProgress";
import type { AssignmentsDoc } from "./types";
import { parseWorkOrderMarker } from "./workOrder";

/**
 * How far the work is, at each of its sizes: a step (by what its tool counts: verses written, notes translated,
 * items agreed), a subtarea (its steps, each worth the same), a tarea (its subtareas), a phase and a project.
 *
 * Every number comes from the subtareas themselves: nothing else is stored, so a bar can never say something the
 * plan does not.
 */

/** What an open step counts for at most: everything its tool counts may be done, and the step still to be closed. */
export const OPEN_STEP_MOST = 0.99;

/**
 * A step: closed, or as far as its tool last said, or not begun. Between 0 and 1, and 1 only when it is closed:
 * the four verses of a group reading that had arrived were all agreed, and the card read «100 %» with four
 * passages of the chapter still being translated.
 */
export function stepFraction(marker: TaskProgressMarker, stepId: string): number {
  if (isStepDone(marker, stepId)) return 1;
  const work = marker.steps?.[stepId]?.work;
  return work && work.total > 0 ? Math.min(OPEN_STEP_MOST, Math.max(0, work.done / work.total)) : 0;
}

/** A subtarea: closed, or the part of its steps that is done, the open one counting for what it has. */
export function subtaskFraction(stepIds: string[], marker: TaskProgressMarker, closed = false): number {
  if (closed) return 1;
  if (!stepIds.length) return 0;
  return stepIds.reduce((sum, id) => sum + stepFraction(marker, id), 0) / stepIds.length;
}

/**
 * A fraction as people read it. Never «100 %» of something that is not finished, nor «0 %» of something begun:
 * the two ends say «done» and «not started», and a rounding must not say either for it.
 */
export function percentOf(fraction: number): number {
  if (!(fraction > 0)) return 0;
  if (fraction >= 1) return 100;
  return Math.min(99, Math.max(1, Math.round(fraction * 100)));
}

export type WorkTally = {
  /** Between 0 and 1: the mean of its subtareas. */
  fraction: number;
  /** Subtareas finished, and how many there are. */
  done: number;
  total: number;
};

const EMPTY: WorkTally = { fraction: 0, done: 0, total: 0 };

function tally(fractions: number[]): WorkTally {
  if (!fractions.length) return EMPTY;
  return { fraction: fractions.reduce((sum, value) => sum + value, 0) / fractions.length, done: fractions.filter((value) => value >= 1).length, total: fractions.length };
}

export type TaskTally = WorkTally & { taskId: string; phaseId: string };
export type PhaseTally = WorkTally & { phaseId: string; tasks: TaskTally[] };
export type ProjectTally = WorkTally & { phases: PhaseTally[] };

/**
 * How far one subtarea is, or null when it is not work to count: a decision of the team, or a subtarea the plan
 * dropped (closed with steps left undone: nobody finished it, it was taken away).
 */
export function issueFraction(issue: DcsIssue, board: Pick<AssignmentsDoc, "teams">): number | null {
  if (!parseWorkOrderMarker(issue.body ?? undefined) || isDecisionIssue(issue)) return null;
  const task = board.teams.find((row) => row.id === issueTaskId(issue));
  const stepIds = (task?.steps ?? []).map((step) => step.id);
  const marker = parseTaskProgressMarker(issue.body ?? undefined);
  const closed = issue.state === "closed";
  if (closed && stepIds.some((id) => !isStepDone(marker, id))) return null;
  return subtaskFraction(stepIds, marker, closed);
}

/**
 * `brought.from` of a chapter subtask made closed only to keep passages that were all finished, so that publishing the
 * plan again never opens that chapter (`regroupByChapter.ts`). Its passages are the record of that work, with their
 * dates: the chapter counts for nothing.
 */
export const GATHERED_FROM = "porciones";

export function isGatheredRecord(issue: DcsIssue): boolean {
  return issue.state === "closed" && parseTaskProgressMarker(issue.body ?? undefined).brought?.from === GATHERED_FROM;
}

/**
 * The subtareas to count, each piece of work once. A subtarea whose passages all fall inside a later one of the same
 * task (its chapter, after gathering) is that one's work: the chapter counts its items, answers included, and the
 * passage again would count them twice. A chapter record of finished passages counts for nothing (see
 * `GATHERED_FROM`). A correction or a passage done again (extra work) is never inside anything: it is work of its own.
 * A wider subtarea the plan withdrew (closed with steps undone) gathers nothing.
 */
export function countedIssues(issues: DcsIssue[], board: Pick<AssignmentsDoc, "teams">): DcsIssue[] {
  type Row = { issue: DcsIssue; task: string; portions: Set<string>; at: number; extra: boolean };
  const rows: Row[] = [];
  for (const issue of issues) {
    const marker = parseWorkOrderMarker(issue.body ?? undefined);
    if (!marker || isGatheredRecord(issue)) continue;
    rows.push({ issue, task: issueTaskId(issue), portions: new Set(marker.portionIds), at: Date.parse(issue.created_at ?? "") || 0, extra: marker.itemIds.some(isExtraItemId) });
  }
  const wide = rows.filter((row) => row.portions.size > 1 && !row.extra && issueFraction(row.issue, board) !== null);
  const inside = (row: Row) =>
    !row.extra &&
    row.portions.size > 0 &&
    wide.some((w) => w !== row && w.task === row.task && w.portions.size > row.portions.size && w.at >= row.at && [...row.portions].every((id) => w.portions.has(id)));
  const gathered = new Set(rows.filter(inside).map((row) => row.issue));
  return issues.filter((issue) => !gathered.has(issue) && !isGatheredRecord(issue));
}

/** A project by its phases and tareas, in the order of the plan. Tareas without subtareas yet are left out. */
export function projectTally(issues: DcsIssue[], board: Pick<AssignmentsDoc, "teams" | "phases">): ProjectTally {
  const byTask = new Map<string, number[]>();
  for (const issue of countedIssues(issues, board)) {
    const fraction = issueFraction(issue, board);
    if (fraction === null) continue;
    const taskId = issueTaskId(issue);
    byTask.set(taskId, [...(byTask.get(taskId) ?? []), fraction]);
  }
  const phases: PhaseTally[] = [...board.phases]
    .sort((a, b) => a.order - b.order)
    .map((phase) => {
      const tasks = board.teams.filter((task) => task.phaseId === phase.id && byTask.has(task.id)).map((task) => ({ taskId: task.id, phaseId: phase.id, ...tally(byTask.get(task.id)!) }));
      return { phaseId: phase.id, tasks, ...tally(tasks.flatMap((task) => byTask.get(task.taskId)!)) };
    })
    .filter((phase) => phase.tasks.length);
  return { phases, ...tally(phases.flatMap((phase) => phase.tasks.flatMap((task) => byTask.get(task.taskId)!))) };
}
