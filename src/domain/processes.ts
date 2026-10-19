import { tallerConfig } from "../../taller.config";
import { DEFAULT_LOAD_LIMITS, type LoadLimits } from "./processLoad";
import type { ProcessPackage } from "../config/types";
import { DEFAULT_SOLVERS_CATALOG } from "./solvers";
import { normalizeWorkflowTemplate } from "./store";
import type { Localized, TaskStep, WorkflowTemplate } from "./types";
import { processProblems } from "./workflowCheck";

/**
 * The processes an organization works with are data: JSON packages listed in `taller.config.ts` (`processes/`).
 * This is the only door through which the engine sees them. Nothing here, or anywhere else in `src/`, names a
 * process, a phase, a task or a tool of its own (`verify:decoupling` checks it).
 */

/** Templates shipped with the app, as the process packages define them. */
/** The limits of a well shared out step: the organization's, over the engine's. */
export function loadLimits(): LoadLimits {
  return { ...DEFAULT_LOAD_LIMITS, ...tallerConfig.workLoad };
}

export function shippedWorkflows(packages: ProcessPackage[] = tallerConfig.processes): WorkflowTemplate[] {
  const out: WorkflowTemplate[] = [];
  const seen = new Set<string>();
  for (const pack of packages) {
    for (const raw of pack.workflows ?? []) {
      const workflow = normalizeWorkflowTemplate(raw);
      if (!workflow || seen.has(workflow.id)) continue;
      seen.add(workflow.id);
      out.push(workflow);
    }
  }
  return out;
}

/** A copy of a shipped template (its own arrays), to start a new one from. */
export function shippedWorkflow(id: string, packages: ProcessPackage[] = tallerConfig.processes): WorkflowTemplate | undefined {
  return shippedWorkflows(packages).find((workflow) => workflow.id === id);
}

/**
 * The tool a step opens in the process as it is shipped now. A project keeps the copy of the process it was created
 * from: a step that got a screen later has none there, and trying it takes the screen from here.
 */
export function shippedStepTool(taskId: string, stepId: string, packages: ProcessPackage[] = tallerConfig.processes): string | undefined {
  for (const workflow of shippedWorkflows(packages)) {
    const tool = workflow.tasks.find((task) => task.id === taskId)?.steps?.find((step) => step.id === stepId)?.solverAppId;
    if (tool) return tool;
  }
  return undefined;
}

/**
 * What a step is for and what it is measured against (`purpose`, `criterion`), as the project has them or, for a
 * project made before the process said them, as the process is shipped now: Ezra was created on 15 October and its
 * tuning steps said neither.
 */
export function stepPurpose(
  taskId: string,
  step: Pick<TaskStep, "id" | "purpose" | "purposes" | "criterion" | "criteria" | "description" | "descriptions"> | undefined,
  language: string,
  packages: ProcessPackage[] = tallerConfig.processes,
): { purpose?: string; criterion?: string; description?: string } {
  if (!step) return {};
  const shipped = shippedWorkflows(packages).flatMap((workflow) => workflow.tasks.filter((task) => task.id === taskId))[0]?.steps?.find((row) => row.id === step.id);
  const own = step.purpose || step.criterion ? step : shipped;
  if (!own) return {};
  // A rule the process gave a step after a project was made (the harmonization rules, 16 October) reaches it too:
  // a plan keeps the steps it was made with, and Esther's had what each step is for but no rule.
  const ruled = own.criterion ? own : shipped?.criterion ? shipped : own;
  // How the step is done goes with what it is for: the same version of the process says both.
  return {
    ...(own.purpose ? { purpose: localized(own.purpose, own.purposes, language) } : {}),
    ...(ruled.criterion ? { criterion: localized(ruled.criterion, ruled.criteria, language) } : {}),
    ...(own.description ? { description: localized(own.description, own.descriptions, language) } : {}),
  };
}

/**
 * The steps the process gives a task now that a project's copy of the task does not have. A project keeps the steps
 * it was created with (its lists, one for each text, where the process now has one for both): trying the step as it
 * is now takes it from here.
 */
export function shippedStepsMissing(task: { id: string; steps?: { id: string }[] }, packages: ProcessPackage[] = tallerConfig.processes): TaskStep[] {
  const have = new Set((task.steps ?? []).map((step) => step.id));
  const shipped = shippedWorkflows(packages).flatMap((workflow) => workflow.tasks.filter((row) => row.id === task.id))[0];
  return (shipped?.steps ?? []).filter((step) => !have.has(step.id));
}

/**
 * The tasks the process asks to look again at the verses of a text that was corrected (`TaskTemplate.redoAfter`),
 * by their ids. Read from the process as it is shipped: a project keeps the copy of the tasks it was created with,
 * which may be older than this.
 */
export function tasksToRedoAfter(resource: string, packages: ProcessPackage[] = tallerConfig.processes): string[] {
  const ids = shippedWorkflows(packages).flatMap((workflow) => workflow.tasks.filter((task) => task.redoAfter?.includes(resource)).map((task) => task.id));
  return [...new Set(ids)];
}

/** `names[language]`, or the stored name. */
/** The titles of the sections left out of an article read to understand a point, of every package (see `readingOmits`). */
export function readingOmits(packages: ProcessPackage[] = tallerConfig.processes): string[] {
  return [...new Set(packages.flatMap((pack) => (Array.isArray(pack.readingOmits) ? pack.readingOmits.filter((x): x is string => typeof x === "string" && Boolean(x.trim())) : [])))];
}

export function localized(name: string, names: Localized | undefined, language: string): string {
  return names?.[language]?.trim() || name;
}

/**
 * Stored name → name in `language`, for everything the packages define: the names of phases, tasks and steps (plans
 * and issue titles repeat them as plain text) and each package's own glossary of older names.
 */
export function processGlossary(language: string, packages: ProcessPackage[] = tallerConfig.processes): [string, string][] {
  const table = new Map<string, string>();
  const add = (name: string | undefined, names: Localized | undefined) => {
    const to = names?.[language]?.trim();
    if (name && to && to !== name) table.set(name, to);
  };
  for (const pack of packages) {
    for (const [from, to] of Object.entries(pack.glossary?.[language] ?? {})) if (from && to && from !== to) table.set(from, to);
  }
  for (const workflow of shippedWorkflows(packages)) {
    add(workflow.name, workflow.names);
    for (const phase of workflow.phases) add(phase.name, phase.names);
    for (const task of workflow.tasks) {
      add(task.name, task.names);
      for (const step of task.steps ?? []) add(step.name, step.names);
    }
  }
  return [...table];
}

// A package with a mistake is said out loud while developing, instead of being quietly repaired when read.
if (import.meta.env?.DEV) {
  for (const pack of tallerConfig.processes) {
    const problems = processProblems(pack, { tools: DEFAULT_SOLVERS_CATALOG.solvers, languages: tallerConfig.uiLanguages });
    if (problems.length) console.error([`El paquete de proceso «${pack.id}» tiene problemas:`, ...problems.map((problem) => `- ${problem}`)].join("\n"));
  }
}
