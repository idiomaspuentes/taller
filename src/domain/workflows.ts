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
  const { releaseProfiles: _previous, ...settings } = board.settings ?? {};
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
