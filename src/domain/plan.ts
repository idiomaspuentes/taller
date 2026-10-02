/**
 * The plan of a process: its phases, their tasks and the steps of each task. A template, a project that has not been
 * created yet and a project under way all carry one, so they are edited with the same editor (`PlanEditor`) through
 * the operations here. Nothing in this file knows which of the three it is editing.
 */
import { scopeFromRules, uid } from "./assignment";
import { makePhase, slugifyPhase } from "./phaseSlug";
import type { AssignmentsDoc, Phase, ProjectTask, ScopeKey, ScopeRule, StepClosing, TaskStep, TaskTemplate, WaitRule, WorkflowTemplate } from "./types";

/** A task as the editor sees it: what a template says of it, plus who does it when a project says so. */
export type PlanTask = TaskTemplate;
export type Plan = { phases: Phase[]; tasks: PlanTask[] };

export function orderedPhases(plan: Pick<Plan, "phases">): Phase[] {
  return [...plan.phases].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "es"));
}

export function tasksOfPhase(plan: Plan, phaseId: string): PlanTask[] {
  return plan.tasks.filter((task) => task.phaseId === phaseId);
}

/* ---------------------------------------------------------------- phases */

export function addPhase(plan: Plan, name: string): { plan: Plan; id: string } {
  const order = plan.phases.length ? Math.max(...plan.phases.map((phase) => phase.order)) + 1 : 0;
  const taken = new Set(plan.phases.map((phase) => phase.id));
  let id = `fase-${slugifyPhase(name) || order + 1}`;
  while (taken.has(id)) id = `${id}-${uid().slice(0, 4)}`;
  const phase = makePhase({ id, name, order });
  return { plan: { ...plan, phases: [...plan.phases, phase] }, id };
}

/** The name people read changes; the slug (the prefix of its branches) stays, so nothing already written moves. */
export function renamePhase(plan: Plan, phaseId: string, name: string): Plan {
  return { ...plan, phases: plan.phases.map((phase) => (phase.id === phaseId ? { ...phase, name } : phase)) };
}

export function movePhase(plan: Plan, phaseId: string, dir: -1 | 1): Plan {
  const list = orderedPhases(plan);
  const at = list.findIndex((phase) => phase.id === phaseId);
  const to = at + dir;
  if (at < 0 || to < 0 || to >= list.length) return plan;
  [list[at], list[to]] = [list[to]!, list[at]!];
  const order = new Map(list.map((phase, index) => [phase.id, index]));
  return { ...plan, phases: plan.phases.map((phase) => ({ ...phase, order: order.get(phase.id) ?? phase.order })) };
}

/** Removes the phase with its tasks, and every «espera a» that named any of them. */
export function removePhase(plan: Plan, phaseId: string): Plan {
  const gone = new Set(plan.tasks.filter((task) => task.phaseId === phaseId).map((task) => task.id));
  const tasks = plan.tasks.filter((task) => !gone.has(task.id)).map((task) => withoutWaitsOn(task, gone, phaseId));
  return { phases: plan.phases.filter((phase) => phase.id !== phaseId), tasks };
}

/* ----------------------------------------------------------------- tasks */

function withoutWaitsOn(task: PlanTask, taskIds: Set<string>, phaseId?: string): PlanTask {
  if (!task.waitsFor?.length) return task;
  const waitsFor = task.waitsFor.filter((rule) => rule.source || !((rule.taskId && taskIds.has(rule.taskId)) || (phaseId && rule.phaseId === phaseId)));
  return waitsFor.length === task.waitsFor.length ? task : { ...task, waitsFor: waitsFor.length ? waitsFor : undefined };
}

function freshId(base: string, taken: Set<string>): string {
  const slug = slugifyPhase(base) || "tarea";
  if (!taken.has(slug)) return slug;
  let n = 2;
  while (taken.has(`${slug}-${n}`)) n += 1;
  return `${slug}-${n}`;
}

export function addTask(plan: Plan, phaseId: string, name: string): { plan: Plan; id: string } {
  const id = freshId(name, new Set(plan.tasks.map((task) => task.id)));
  const task: PlanTask = { id, name, phaseId, rules: [], general: true, steps: [{ id: uid(), name: "" }] };
  // After the last task of its phase, so the list reads in the order of the work.
  const last = plan.tasks.map((row) => row.phaseId).lastIndexOf(phaseId);
  const tasks = [...plan.tasks];
  tasks.splice(last < 0 ? tasks.length : last + 1, 0, task);
  return { plan: { ...plan, tasks }, id };
}

export function patchTask(plan: Plan, taskId: string, patch: Partial<PlanTask>): Plan {
  return { ...plan, tasks: plan.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)) };
}

/** Up or down among the tasks of its own phase. */
export function moveTask(plan: Plan, taskId: string, dir: -1 | 1): Plan {
  const task = plan.tasks.find((row) => row.id === taskId);
  if (!task) return plan;
  const siblings = plan.tasks.filter((row) => row.phaseId === task.phaseId);
  const other = siblings[siblings.indexOf(task) + dir];
  if (!other) return plan;
  const tasks = [...plan.tasks];
  const a = tasks.indexOf(task);
  const b = tasks.indexOf(other);
  [tasks[a], tasks[b]] = [tasks[b]!, tasks[a]!];
  return { ...plan, tasks };
}

export function moveTaskToPhase(plan: Plan, taskId: string, phaseId: string): Plan {
  const task = plan.tasks.find((row) => row.id === taskId);
  if (!task || task.phaseId === phaseId) return plan;
  const rest = plan.tasks.filter((row) => row.id !== taskId);
  const last = rest.map((row) => row.phaseId).lastIndexOf(phaseId);
  rest.splice(last < 0 ? rest.length : last + 1, 0, { ...task, phaseId });
  return { ...plan, tasks: rest };
}

/** A copy right after the original, with its own id and no «espera a» pointing at itself. */
export function duplicateTask(plan: Plan, taskId: string, name: string): { plan: Plan; id: string } | null {
  const at = plan.tasks.findIndex((row) => row.id === taskId);
  if (at < 0) return null;
  const source = plan.tasks[at]!;
  const id = freshId(name, new Set(plan.tasks.map((task) => task.id)));
  const ids = new Map((source.steps ?? []).map((step) => [step.id, uid()]));
  const steps = source.steps?.map((step) => ({
    ...step,
    id: ids.get(step.id)!,
    excludePriorStepIds: step.excludePriorStepIds?.map((prior) => ids.get(prior) ?? prior),
  }));
  const tasks = [...plan.tasks];
  tasks.splice(at + 1, 0, { ...structuredClone(source), id, name, names: undefined, steps });
  return { plan: { ...plan, tasks }, id };
}

export function removeTask(plan: Plan, taskId: string): Plan {
  const gone = new Set([taskId]);
  return { ...plan, tasks: plan.tasks.filter((task) => task.id !== taskId).map((task) => withoutWaitsOn(task, gone)) };
}

/** The resources a task works on, in the usual order. An empty list is a task of general work (no resource). */
export function setTaskResources(task: PlanTask, resources: ScopeKey[], order: ScopeKey[]): PlanTask {
  const wanted = order.filter((key) => resources.includes(key));
  const rules: ScopeRule[] = wanted.map((resource) => {
    const have = task.rules.find((rule) => rule.resource === resource);
    if (have) return have;
    const scripture = resource === "tpl" || resource === "tps";
    return { resource, articleFilter: "pending", grain: scripture ? "portion" : "item" };
  });
  // Working several resources as one subtarea only means something with more than one.
  const bundle = rules.length > 1 ? task.bundle : undefined;
  return { ...task, rules, bundle, general: rules.length ? undefined : true };
}

/* ----------------------------------------------------------------- steps */

function withSteps(plan: Plan, taskId: string, change: (steps: TaskStep[]) => TaskStep[]): Plan {
  return { ...plan, tasks: plan.tasks.map((task) => (task.id === taskId ? { ...task, steps: change(task.steps ?? []) } : task)) };
}

export function addStep(plan: Plan, taskId: string, name: string): { plan: Plan; id: string } {
  const id = uid();
  return { plan: withSteps(plan, taskId, (steps) => [...steps, { id, name }]), id };
}

export function patchStep(plan: Plan, taskId: string, stepId: string, patch: Partial<TaskStep>): Plan {
  return withSteps(plan, taskId, (steps) => steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)));
}

export function replaceStep(plan: Plan, taskId: string, next: TaskStep): Plan {
  return withSteps(plan, taskId, (steps) => steps.map((step) => (step.id === next.id ? next : step)));
}

/** Moves a step; a step can only leave out people of steps before it, so exclusions that no longer hold are dropped. */
export function moveStep(plan: Plan, taskId: string, stepId: string, dir: -1 | 1): Plan {
  return withSteps(plan, taskId, (steps) => {
    const at = steps.findIndex((step) => step.id === stepId);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= steps.length) return steps;
    const next = [...steps];
    [next[at], next[to]] = [next[to]!, next[at]!];
    return next.map((step, index) => keepEarlierExclusions(step, next.slice(0, index)));
  });
}

export function removeStep(plan: Plan, taskId: string, stepId: string): Plan {
  return withSteps(plan, taskId, (steps) => {
    const next = steps.filter((step) => step.id !== stepId);
    return next.map((step, index) => keepEarlierExclusions(step, next.slice(0, index)));
  });
}

function keepEarlierExclusions(step: TaskStep, earlier: TaskStep[]): TaskStep {
  if (!step.excludePriorStepIds?.length) return step;
  const ids = new Set(earlier.map((row) => row.id));
  const kept = step.excludePriorStepIds.filter((id) => ids.has(id));
  return kept.length === step.excludePriorStepIds.length ? step : { ...step, excludePriorStepIds: kept.length ? kept : undefined };
}

/* ------------------------------------------------- who does a step, in words */

/**
 * Who does a step, as a person thinks of it:
 * - `owner`: whoever has the subtarea.
 * - `one`: one person of the team takes it.
 * - `several`: several people of the team take it (between `min` and `max`).
 */
export type StepWho = "owner" | "one" | "several";

export function stepWho(step: TaskStep): StepWho {
  return step.claimMode === "exclusive" ? "one" : step.claimMode === "pool" ? "several" : "owner";
}

/** How a step is completed, whether it says so or leaves it to who does it. */
export function stepClosing(step: TaskStep): StepClosing {
  return step.closing ?? (stepWho(step) === "owner" ? "self" : "approval");
}

/**
 * Change who does a step. What only makes sense for the previous choice is dropped, and a way of completing the step
 * that the new choice cannot do (one person cannot «agree among several») falls back to the usual one.
 */
export function withStepWho(step: TaskStep, who: StepWho): TaskStep {
  if (who === stepWho(step)) return step;
  const closing = step.closing;
  if (who === "owner") {
    return {
      ...step,
      claimMode: undefined,
      minAssignees: undefined,
      maxAssignees: undefined,
      minIndependent: undefined,
      excludePriorStepIds: undefined,
      excludeIssueAssignee: undefined,
      includeAuthorInApproval: undefined,
      closing: closing === "approval" || closing === "consensus" ? "self" : closing,
    };
  }
  if (who === "one") {
    return {
      ...step,
      claimMode: "exclusive",
      minAssignees: undefined,
      maxAssignees: undefined,
      minIndependent: undefined,
      // Somebody else looking at the work is the reason to hand a step to another person.
      excludeIssueAssignee: step.excludeIssueAssignee ?? true,
      closing: closing === "self" || closing === undefined ? "approval" : closing,
    };
  }
  return {
    ...step,
    claimMode: "pool",
    minAssignees: step.minAssignees ?? 2,
    maxAssignees: step.maxAssignees ?? step.minAssignees ?? 2,
    includeAuthorInApproval: undefined,
    closing: closing === "self" || closing === undefined ? "approval" : closing,
  };
}

/** How many people a `several` step asks for; the most is never under the least. */
export function withStepSeats(step: TaskStep, min: number, max: number): TaskStep {
  const least = Math.max(1, Math.floor(min) || 1);
  const most = Math.max(least, Math.floor(max) || least);
  const independent = step.minIndependent !== undefined ? Math.min(step.minIndependent, least) : undefined;
  return { ...step, minAssignees: least, maxAssignees: most, minIndependent: independent || undefined };
}

/* --------------------------------------------- templates and projects as plans */

export function planOfWorkflow(workflow: Pick<WorkflowTemplate, "phases" | "tasks">): Plan {
  return { phases: workflow.phases, tasks: workflow.tasks };
}

export function workflowWithPlan<T extends Pick<WorkflowTemplate, "phases" | "tasks">>(workflow: T, plan: Plan): T {
  return { ...workflow, phases: plan.phases, tasks: plan.tasks };
}

export function planOfBoard(board: Pick<AssignmentsDoc, "phases" | "teams">): Plan {
  return { phases: board.phases, tasks: board.teams as PlanTask[] };
}

/**
 * The project with the plan the editor returns. A task the project already had keeps everything a plan does not speak
 * of (its people, its window of the book); a new one starts over the whole project.
 */
export function boardWithPlan<T extends Pick<AssignmentsDoc, "phases" | "teams" | "settings">>(board: T, plan: Plan): T {
  const before = new Map(board.teams.map((task) => [task.id, task]));
  const phaseIds = new Set(plan.phases.map((phase) => phase.id));
  const teams: ProjectTask[] = plan.tasks.map((task) => {
    const old = before.get(task.id);
    const base: ProjectTask = old ?? { id: task.id, name: task.name, description: "", phaseId: task.phaseId, memberIds: [], scope: [], rules: [], scriptureScope: { mode: "project" } };
    const waitsFor: WaitRule[] | undefined = task.waitsFor?.length ? task.waitsFor : undefined;
    return {
      ...base,
      ...task,
      description: task.description ?? "",
      scope: scopeFromRules(task.rules),
      bundle: task.bundle ? { ...base.bundle, ...task.bundle } : undefined,
      steps: task.steps?.length ? task.steps : undefined,
      waitsFor,
    };
  });
  const settings = board.settings?.releaseProfiles
    ? { ...board.settings, releaseProfiles: board.settings.releaseProfiles.map((profile) => ({ ...profile, requiredPhaseIds: profile.requiredPhaseIds.filter((id) => phaseIds.has(id)) })) }
    : board.settings;
  return { ...board, phases: plan.phases, teams, settings };
}

/** What a change of plan does to the tasks a project already had: which ones go, and which ones change their steps. */
export function planImpact(before: Plan, after: Plan): { removedTasks: PlanTask[]; changedSteps: PlanTask[] } {
  const next = new Map(after.tasks.map((task) => [task.id, task]));
  const removedTasks = before.tasks.filter((task) => !next.has(task.id));
  const changedSteps = before.tasks.filter((task) => {
    const now = next.get(task.id);
    if (!now) return false;
    const a = (task.steps ?? []).map((step) => step.id).join("\u0000");
    const b = (now.steps ?? []).map((step) => step.id).join("\u0000");
    return a !== b;
  });
  return { removedTasks, changedSteps };
}
