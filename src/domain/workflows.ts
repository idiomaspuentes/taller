import type {
  AssignmentsDoc,
  Phase,
  ProjectTask,
  TaskTemplate,
  WorkflowTemplate,
} from "./types";
import { scopeFromRules, uid } from "./assignment";
import { normalizePhases, normalizeTaskSteps, normalizeWorkflowTemplate } from "./store";

/** Snapshot an org workflow into a project board (replaces phases/tasks). */
export function applyWorkflowToBoard(
  board: AssignmentsDoc,
  template: WorkflowTemplate,
): AssignmentsDoc {
  const wf = normalizeWorkflowTemplate(template);
  if (!wf) return board;
  const phases = normalizePhases(wf.phases, []);
  const phaseIds = new Set(phases.map((p) => p.id));
  const teams: ProjectTask[] = wf.tasks.map((t) => taskFromTemplate(t, phaseIds, phases));
  const releaseProfiles = wf.releaseProfiles?.map((p) => ({
    ...p,
    requiredPhaseIds: p.requiredPhaseIds.filter((id) => phaseIds.has(id)),
  }));
  const { releaseProfiles: _previous, resourceNames: _names, ...kept } = board.settings ?? {};
  const settings = { ...kept, ...(wf.resourceNames ? { resourceNames: wf.resourceNames } : {}), ...(wf.nextBookAt ? { nextBookAt: wf.nextBookAt } : {}), ...(wf.maxChapterVerses ? { maxChapterVerses: wf.maxChapterVerses } : {}) };
  return {
    ...board,
    settings: releaseProfiles?.length ? { ...settings, releaseProfiles } : settings,
    phases,
    teams,
    activeTeamId: teams[0]?.id ?? "",
    workflowId: wf.id,
    workflowVersion: wf.version,
    workflowAppliedAt: new Date().toISOString(),
  };
}

function taskFromTemplate(
  t: TaskTemplate,
  phaseIds: Set<string>,
  phases: Phase[],
): ProjectTask {
  const steps = normalizeTaskSteps(t.steps);
  return {
    id: t.id || uid(),
    name: t.name,
    names: t.names,
    description: t.description ?? "",
    phaseId: phaseIds.has(t.phaseId) ? t.phaseId : phases[0]?.id ?? "phase-default",
    memberIds: [],
    rules: t.rules,
    ...(t.general ? { general: true } : {}),
    scope: scopeFromRules(t.rules),
    scriptureScope: { mode: "project" },
    distributeUnit: t.distributeUnit,
    distributePolicy: t.distributePolicy,
    everyUnit: t.everyUnit,
    bundle: t.bundle
      ? {
          enabled: t.bundle.enabled,
          grain: t.bundle.grain,
        }
      : undefined,
    orgTeamId: t.orgTeamId,
    orgTeamName: t.orgTeamName,
    solverAppId: t.solverAppId,
    steps: steps.length ? steps : undefined,
    waitsFor: t.waitsFor?.length ? t.waitsFor.map((r) => ({ ...r })) : undefined,
    minLevel: t.minLevel,
  };
}

/** Build a reusable workflow from an existing project board. */
export function boardToWorkflowTemplate(
  board: AssignmentsDoc,
  meta: { id?: string; name: string; description?: string },
): WorkflowTemplate {
  const name = meta.name.trim();
  const tasks: TaskTemplate[] = board.teams.map((t) => ({
    id: t.id,
    name: t.name,
    names: t.names,
    description: t.description?.trim() || undefined,
    phaseId: t.phaseId,
    rules: t.rules.map((r) => ({
      resource: r.resource,
      articleFilter: r.articleFilter,
      grain: r.grain,
      stayInChapter: r.stayInChapter,
      includeDuplicates: r.includeDuplicates,
    })),
    ...(t.general ? { general: true } : {}),
    distributeUnit: t.distributeUnit,
    distributePolicy: t.distributePolicy,
    everyUnit: t.everyUnit,
    bundle: t.bundle
      ? { enabled: t.bundle.enabled, grain: t.bundle.grain }
      : undefined,
    orgTeamId: t.orgTeamId,
    orgTeamName: t.orgTeamName,
    solverAppId: t.solverAppId,
    steps: t.steps?.length ? [...t.steps] : undefined,
    waitsFor: t.waitsFor?.length ? t.waitsFor.map((r) => ({ ...r })) : undefined,
    minLevel: t.minLevel,
  }));
  const phases = normalizePhases(board.phases, board.teams);
  const releaseProfiles = board.settings?.releaseProfiles?.map((p) => ({
    ...p,
    requiredPhaseIds: [...p.requiredPhaseIds],
  }));
  return {
    id: meta.id?.trim() || uid(),
    name: name || "Plantilla",
    description: meta.description?.trim() || undefined,
    phases,
    tasks,
    ...(releaseProfiles?.length ? { releaseProfiles } : {}),
    ...(board.settings?.resourceNames ? { resourceNames: board.settings.resourceNames } : {}),
    ...(board.settings?.maxChapterVerses ? { maxChapterVerses: board.settings.maxChapterVerses } : {}),
  };
}

export function emptyWorkflow(name = "Flujo estándar"): WorkflowTemplate {
  const phaseId = "phase-default";
  return {
    id: uid(),
    name,
    phases: [{ id: phaseId, name: "Fase 1", slug: "fase-1", order: 0 }],
    tasks: [],
  };
}

/** What bringing a project up to a newer version of its process added. */
export type WorkflowUpgrade = {
  board: AssignmentsDoc;
  phases: string[];
  tasks: string[];
  /** `task › step` of every step added to a task the project already had. */
  steps: string[];
  /** Steps that took the name the process gives them now, as «the old name → the new one». */
  renamed: string[];
  /** Tasks or steps that only gained settings they did not have. */
  completed: number;
};

/** The newer version of the process a project was created from, when there is one. */
export function workflowUpdateFor(board: AssignmentsDoc, templates: WorkflowTemplate[]): WorkflowTemplate | undefined {
  if (!board.workflowId) return undefined;
  const template = templates.find((workflow) => workflow.id === board.workflowId);
  if (!template?.version || template.version <= (board.workflowVersion ?? 0)) return undefined;
  return template;
}

/** `into` with every field of `from` it does not have. Never replaces a value. */
function fillMissing<T extends object>(into: T, from: Partial<T>): { next: T; filled: boolean } {
  const next = { ...into } as Record<string, unknown>;
  let filled = false;
  for (const [key, value] of Object.entries(from)) {
    if (value === undefined || next[key] !== undefined) continue;
    next[key] = value;
    filled = true;
  }
  return { next: next as T, filled };
}

/**
 * Bring a project up to a newer version of its process without undoing anything the project did: phases, tasks and
 * steps the project lacks are added in the place the process gives them, and what already exists only gains the
 * settings it did not have. Nothing is removed or replaced, and people stay where they are.
 */
export function upgradeBoardToWorkflow(board: AssignmentsDoc, template: WorkflowTemplate): WorkflowUpgrade {
  const wf = normalizeWorkflowTemplate(template);
  const out: WorkflowUpgrade = { board, phases: [], tasks: [], steps: [], renamed: [], completed: 0 };
  if (!wf) return out;

  const wanted = normalizePhases(wf.phases, []);
  const phases = [...board.phases];
  for (const phase of wanted) {
    if (phases.some((p) => p.id === phase.id)) continue;
    phases.push({ ...phase, order: Math.max(phase.order, ...phases.map((p) => p.order + 1)) });
    out.phases.push(phase.name);
  }
  const phaseIds = new Set(phases.map((p) => p.id));

  const teams = [...board.teams];
  wf.tasks.forEach((source, index) => {
    const fresh = taskFromTemplate(source, phaseIds, phases);
    const at = teams.findIndex((task) => task.id === fresh.id);
    if (at < 0) {
      // After the task that precedes it in the process, when the project has that one.
      const before = wf.tasks.slice(0, index).reverse().map((t) => teams.findIndex((task) => task.id === t.id)).find((i) => i >= 0);
      teams.splice(before === undefined ? teams.length : before + 1, 0, fresh);
      out.tasks.push(fresh.name);
      return;
    }
    const current = teams[at]!;
    const { steps: freshSteps, memberIds: _nobody, ...settings } = fresh;
    const base = fillMissing(current, settings as Partial<ProjectTask>);
    let changed = base.filled;
    let steps = current.steps ? [...current.steps] : undefined;
    for (const [stepIndex, step] of (freshSteps ?? []).entries()) {
      const have = steps?.findIndex((s) => s.id === step.id) ?? -1;
      if (have >= 0) {
        const mine = steps![have]!;
        // The one thing that is replaced: a name the process itself gave the step and has changed since. The project
        // did not choose it, and kept showing a name the process no longer uses (a name it wrote itself stays).
        const renamed = mine.name !== step.name && Boolean(step.formerNames?.includes(mine.name));
        const merged = fillMissing(renamed ? { ...mine, name: step.name, names: step.names } : mine, step);
        if (merged.filled || renamed) {
          steps![have] = merged.next;
          changed = true;
        }
        if (renamed) out.renamed.push(`${mine.name} → ${step.name}`);
        continue;
      }
      // The project may already have this step under another id: a step it edited by hand into what the process
      // now says (same tool, same way of closing, same way of taking it). Adding it again would ask for the same
      // work twice, so it counts as there.
      if (steps?.some((mine) => Boolean(step.solverAppId) && mine.solverAppId === step.solverAppId && mine.closing === step.closing && (mine.claimMode ?? "") === (step.claimMode ?? "") && !(freshSteps ?? []).some((other) => other.id === mine.id))) continue;
      steps ??= [];
      const before = (freshSteps ?? []).slice(0, stepIndex).reverse().map((s) => steps!.findIndex((mine) => mine.id === s.id)).find((i) => i >= 0);
      steps.splice(before === undefined ? (stepIndex === 0 ? 0 : steps.length) : before + 1, 0, step);
      out.steps.push(`${current.name} › ${step.name}`);
    }
    const added = (steps?.length ?? 0) !== (current.steps?.length ?? 0);
    if (changed || added) {
      teams[at] = { ...base.next, steps };
      if (changed) out.completed++;
    }
  });

  const profiles = [...(board.settings?.releaseProfiles ?? [])];
  for (const profile of wf.releaseProfiles ?? []) {
    if (!profiles.some((p) => p.id === profile.id)) profiles.push({ ...profile, requiredPhaseIds: profile.requiredPhaseIds.filter((id) => phaseIds.has(id)) });
  }

  out.board = {
    ...board,
    phases,
    teams,
    settings: {
      ...board.settings,
      ...(profiles.length ? { releaseProfiles: profiles } : {}),
      // Names the project lacks come from the process; a name the project has stays.
      ...(wf.resourceNames ? { resourceNames: { ...wf.resourceNames, ...board.settings?.resourceNames } } : {}),
      ...(wf.nextBookAt && board.settings?.nextBookAt === undefined ? { nextBookAt: wf.nextBookAt } : {}),
      ...(wf.maxChapterVerses && board.settings?.maxChapterVerses === undefined ? { maxChapterVerses: wf.maxChapterVerses } : {}),
    },
    // `workflowAppliedAt` stays: it is when the project started, which tells which book came first.
    workflowVersion: wf.version,
  };
  return out;
}
