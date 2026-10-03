import { tallerConfig } from "../../taller.config";
import { DEFAULT_LOAD_LIMITS, type LoadLimits } from "./processLoad";
import type { ProcessPackage } from "../config/types";
import { DEFAULT_SOLVERS_CATALOG } from "./solvers";
import { normalizeWorkflowTemplate } from "./store";
import type { Localized, WorkflowTemplate } from "./types";
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

/** `names[language]`, or the stored name. */
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
