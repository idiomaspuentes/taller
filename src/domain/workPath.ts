import type { AssignmentsDoc, Phase, ProjectTask, TaskStep, WaitRule } from "./types";

/**
 * The path a piece of work goes along inside its phase, as the plan's waits draw it: the tasks before it (whose work
 * it starts from), its own steps, and the tasks after it. A card of «Mis tareas» showed how many of its own steps were
 * done, and a group reading looked as far along as a draft just begun (24 November). Pure; no process is named here.
 */

export type PathSegment = { taskId: string; step: TaskStep; state: "done" | "now" | "todo" };
export type PathNext = { kind: "step"; step: TaskStep; taskId: string } | { kind: "phase"; phase: Phase };
export type WorkPath = { segments: PathSegment[]; now?: TaskStep; next?: PathNext };

type Plan = Pick<AssignmentsDoc, "teams">;
type PlanWithPhases = Pick<AssignmentsDoc, "teams" | "phases">;

const taskIn = (board: Plan, id: string | undefined) => (id ? board.teams.find((task) => task.id === id) : undefined);

/**
 * The rule that links a task to the one before it on the path: it waits, chapter by chapter, for another task of its
 * own phase. What waits for earlier chapters, for a whole phase or for the source project is not a step of the way.
 */
export function chainRule(task: ProjectTask, board: Plan): WaitRule | undefined {
  return (task.waitsFor ?? []).find((rule) => {
    if (rule.source || rule.scope !== "chapter" || !rule.taskId || rule.taskId === task.id) return false;
    return taskIn(board, rule.taskId)?.phaseId === task.phaseId;
  });
}

/** The tasks before `taskId` on its path, the earliest first. */
export function chainBefore(taskId: string, board: Plan): ProjectTask[] {
  const seen = new Set([taskId]);
  const before: ProjectTask[] = [];
  let at = taskIn(board, taskId);
  while (at) {
    const previous = taskIn(board, chainRule(at, board)?.taskId);
    if (!previous || seen.has(previous.id)) break;
    seen.add(previous.id);
    before.unshift(previous);
    at = previous;
  }
  return before;
}

/** The tasks after `taskId` on its path: at each turn, the first in the plan's order that waits for the one before. */
export function chainAfter(taskId: string, board: Plan): ProjectTask[] {
  const seen = new Set([taskId]);
  const after: ProjectTask[] = [];
  let at = taskId;
  for (;;) {
    const following = board.teams.find((task) => !seen.has(task.id) && chainRule(task, board)?.taskId === at);
    if (!following) break;
    seen.add(following.id);
    after.push(following);
    at = following.id;
  }
  return after;
}

/**
 * The phase the work goes to when its path in this phase ends: that of the first task of another phase that waits,
 * chapter by chapter, for this task or for its whole phase.
 */
export function nextPhaseAfter(taskId: string, board: PlanWithPhases): Phase | undefined {
  const task = taskIn(board, taskId);
  if (!task) return undefined;
  const waiting = board.teams.find(
    (other) =>
      other.phaseId !== task.phaseId &&
      (other.waitsFor ?? []).some((rule) => !rule.source && rule.scope === "chapter" && (rule.taskId === task.id || (!rule.taskId && rule.phaseId === task.phaseId))),
  );
  return waiting ? board.phases.find((phase) => phase.id === waiting.phaseId) : undefined;
}

/**
 * The bar of a card: the steps of the tasks before as done (the path, not how far other people are), its own steps as
 * the subtarea has them, and the steps after as still to come. Whoever reviews somebody's draft sees the same bar.
 */
export function workPath(taskId: string, board: PlanWithPhases, doneStepIds: string[]): WorkPath | undefined {
  const task = taskIn(board, taskId);
  if (!task) return undefined;
  const before = chainBefore(taskId, board);
  const after = chainAfter(taskId, board);
  const segments: PathSegment[] = [];
  for (const prior of before) for (const step of prior.steps ?? []) segments.push({ taskId: prior.id, step, state: "done" });
  let now: TaskStep | undefined;
  for (const step of task.steps ?? []) {
    const done = doneStepIds.includes(step.id);
    const state = done ? "done" : now ? "todo" : "now";
    if (state === "now") now = step;
    segments.push({ taskId, step, state });
  }
  for (const later of after) for (const step of later.steps ?? []) segments.push({ taskId: later.id, step, state: "todo" });
  if (!segments.length) return undefined;
  // After «now», the segment that follows it; with every step of the task done, the first one still to come.
  const following = now ? segments[segments.findIndex((segment) => segment.state === "now") + 1] : segments.find((segment) => segment.state === "todo");
  const last = after.at(-1)?.id ?? taskId;
  const phase = following ? undefined : nextPhaseAfter(last, board);
  const next: PathNext | undefined = following ? { kind: "step", step: following.step, taskId: following.taskId } : phase ? { kind: "phase", phase } : undefined;
  return { segments, ...(now ? { now } : {}), ...(next ? { next } : {}) };
}

/** Where the work goes once it is handed in: the first step of the task after it on its path, or the next phase. */
export function handOffTarget(taskId: string, board: PlanWithPhases): PathNext | undefined {
  const [following] = chainAfter(taskId, board);
  const step = following?.steps?.[0];
  if (following && step) return { kind: "step", step, taskId: following.id };
  const phase = nextPhaseAfter(taskId, board);
  return phase ? { kind: "phase", phase } : undefined;
}
