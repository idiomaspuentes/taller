import { LEVEL_ORDER } from "./levels";
import type { ProcessPackage } from "../config/types";
import { WALK_UNITS, type SolverApp } from "./solvers";
import { stepClaimMode, stepMaxAssignees, stepMinAssignees } from "./stepClaim";
import { SCOPE_KEYS } from "./types";

/**
 * What is wrong with a template, in plain words; empty when it can be used. It reads the template as written (not
 * after `normalizeWorkflowTemplate`, which quietly repairs things), so nothing is fixed behind the author's back.
 * Nothing here knows a process: it only checks that the pieces of any template fit together.
 */

type Raw = Record<string, unknown>;

const CLOSINGS = ["self", "approval", "consensus", "checklist", "automatic"];
const STEP_SCOPES = ["subtask", "unit", "chapter-once"];
const ID = /^[a-z0-9][a-z0-9_-]*$/;

const isObject = (value: unknown): value is Raw => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const list = (value: unknown): Raw[] => (Array.isArray(value) ? value.filter(isObject) : []);
const text = (value: unknown): string => String(value ?? "").trim();

function checkLocalized(value: unknown, where: string, languages: string[], problems: string[]): void {
  if (value === undefined) return;
  if (!isObject(value)) {
    problems.push(`${where}: los nombres por idioma deben ser un objeto como { "pt": "…" }.`);
    return;
  }
  for (const [lang, name] of Object.entries(value)) {
    if (!languages.includes(lang)) problems.push(`${where}: el idioma «${lang}» no es un idioma de la interfaz.`);
    if (!text(name)) problems.push(`${where}: el texto en «${lang}» está vacío.`);
  }
}

/** Would following «espera a» from `start` come back to it? */
function waitsLoop(start: string, waitsOf: Map<string, string[]>): boolean {
  const seen = new Set<string>();
  const stack = [...(waitsOf.get(start) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === start) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(waitsOf.get(id) ?? []));
  }
  return false;
}

export function workflowProblems(raw: unknown, opts: { tools?: SolverApp[]; languages?: string[] } = {}): string[] {
  const problems: string[] = [];
  const languages = opts.languages ?? [];
  const toolIds = opts.tools ? new Set(opts.tools.map((tool) => tool.id)) : null;
  if (!isObject(raw)) return ["La plantilla no es un objeto."];

  const name = text(raw.name) || text(raw.id) || "(sin nombre)";
  if (!text(raw.id)) problems.push(`«${name}»: falta el id de la plantilla.`);
  if (!text(raw.name)) problems.push(`«${name}»: falta el nombre de la plantilla.`);
  if (raw.version !== undefined && !(Number.isInteger(raw.version) && Number(raw.version) > 0)) problems.push(`«${name}»: la versión debe ser un número entero mayor que cero.`);
  if (raw.maxChapterVerses !== undefined && !(Number.isInteger(raw.maxChapterVerses) && Number(raw.maxChapterVerses) >= 1)) problems.push(`«${name}»: el máximo de versículos por capítulo debe ser un número entero mayor que cero.`);
  checkLocalized(raw.names, `«${name}»`, languages, problems);

  const phases = list(raw.phases);
  const tasks = list(raw.tasks);
  if (!phases.length) problems.push(`«${name}»: no tiene fases.`);
  if (!tasks.length) problems.push(`«${name}»: no tiene tareas.`);

  const phaseIds = new Set<string>();
  for (const phase of phases) {
    const id = text(phase.id);
    const where = `fase «${text(phase.name) || id}»`;
    if (!id) problems.push(`${where}: falta el id.`);
    else if (phaseIds.has(id)) problems.push(`${where}: el id «${id}» está repetido.`);
    phaseIds.add(id);
    if (!text(phase.name)) problems.push(`${where}: falta el nombre.`);
    checkLocalized(phase.names, where, languages, problems);
  }

  const taskIds = new Set<string>();
  const taskPhase = new Map<string, string>();
  for (const task of tasks) {
    const id = text(task.id);
    if (id && taskIds.has(id)) problems.push(`tarea «${text(task.name) || id}»: el id «${id}» está repetido.`);
    taskIds.add(id);
    taskPhase.set(id, text(task.phaseId));
  }

  // What each task waits for, as task ids (a phase stands for all its tasks).
  const waitsOf = new Map<string, string[]>();
  for (const task of tasks) {
    const targets: string[] = [];
    for (const wait of list(task.waitsFor)) {
      // A wait on the source project is about another project's task: it is not part of this one's order.
      if (wait.source === true) continue;
      if (text(wait.taskId)) targets.push(text(wait.taskId));
      if (text(wait.phaseId)) targets.push(...[...taskPhase].filter(([, phase]) => phase === text(wait.phaseId)).map(([taskId]) => taskId));
    }
    waitsOf.set(text(task.id), targets);
  }

  for (const task of tasks) {
    const id = text(task.id);
    const where = `tarea «${text(task.name) || id}»`;
    if (!id) problems.push(`${where}: falta el id.`);
    else if (!ID.test(id)) problems.push(`${where}: el id «${id}» solo puede tener minúsculas, números, guiones y guiones bajos.`);
    if (!text(task.name)) problems.push(`${where}: falta el nombre.`);
    checkLocalized(task.names, where, languages, problems);
    if (!phaseIds.has(text(task.phaseId))) problems.push(`${where}: su fase «${text(task.phaseId)}» no existe.`);
    if (task.minLevel !== undefined && !(LEVEL_ORDER as string[]).includes(text(task.minLevel))) problems.push(`${where}: el nivel «${text(task.minLevel)}» no existe.`);
    const rules = list(task.rules);
    if (!rules.length && task.general !== true) problems.push(`${where}: no dice sobre qué recurso trabaja (rules).`);
    for (const rule of rules) if (!(SCOPE_KEYS as string[]).includes(text(rule.resource))) problems.push(`${where}: el recurso «${text(rule.resource)}» no existe.`);
    if (toolIds && text(task.solverAppId) && !toolIds.has(text(task.solverAppId))) problems.push(`${where}: la herramienta «${text(task.solverAppId)}» no está en el catálogo.`);

    for (const wait of list(task.waitsFor)) {
      const taskId = text(wait.taskId);
      const phaseId = text(wait.phaseId);
      if (Boolean(taskId) === Boolean(phaseId)) problems.push(`${where}: cada «espera a» nombra una tarea o una fase, no las dos ni ninguna.`);
      if (wait.source === true) {
        if (!taskId) problems.push(`${where}: una espera al proyecto fuente nombra una tarea de ese proyecto.`);
        continue;
      }
      if (taskId && !taskIds.has(taskId)) problems.push(`${where}: espera a la tarea «${taskId}», que no existe.`);
      if (phaseId && !phaseIds.has(phaseId)) problems.push(`${where}: espera a la fase «${phaseId}», que no existe.`);
      if (phaseId && phaseId === text(task.phaseId)) problems.push(`${where}: espera a su propia fase.`);
    }
    if (id && waitsLoop(id, waitsOf)) problems.push(`${where}: sus esperas dan la vuelta y vuelven a ella.`);

    const steps = list(task.steps);
    const stepIds = steps.map((step) => text(step.id));
    steps.forEach((step, index) => {
      const stepId = text(step.id);
      const at = `${where}, paso «${text(step.name) || stepId}»`;
      if (!stepId) problems.push(`${at}: falta el id.`);
      else if (!ID.test(stepId)) problems.push(`${at}: el id «${stepId}» solo puede tener minúsculas, números, guiones y guiones bajos.`);
      else if (stepIds.indexOf(stepId) !== index) problems.push(`${at}: el id «${stepId}» está repetido en la tarea.`);
      if (!text(step.name)) problems.push(`${at}: falta el nombre.`);
      checkLocalized(step.names, at, languages, problems);
      checkLocalized(step.actionLabels, `${at}, botón`, languages, problems);
      if (step.actionLabels !== undefined && !text(step.actionLabel)) problems.push(`${at}: tiene el botón en otros idiomas pero no en el principal (actionLabel).`);
      if (toolIds && text(step.solverAppId) && !toolIds.has(text(step.solverAppId))) problems.push(`${at}: la herramienta «${text(step.solverAppId)}» no está en el catálogo.`);

      const claim = text(step.claimMode) || "none";
      if (!["none", "exclusive", "pool"].includes(claim)) problems.push(`${at}: «${claim}» no es una forma de tomar el paso (none, exclusive, pool).`);
      const typed = step as never;
      if (claim === "pool") {
        const min = stepMinAssignees(typed);
        const max = stepMaxAssignees(typed);
        if (Number(step.maxAssignees) < Number(step.minAssignees)) problems.push(`${at}: el máximo de personas es menor que el mínimo.`);
        if (step.minIndependent !== undefined && Number(step.minIndependent) > min) problems.push(`${at}: pide más personas independientes (${step.minIndependent}) que el mínimo de personas (${min}).`);
        if (max < 1) problems.push(`${at}: necesita al menos una persona.`);
      } else if (step.minAssignees !== undefined || step.maxAssignees !== undefined || step.minIndependent !== undefined) {
        problems.push(`${at}: mínimos y máximos de personas solo valen cuando varias personas se suman (pool).`);
      }
      for (const prior of Array.isArray(step.excludePriorStepIds) ? step.excludePriorStepIds.map(String) : []) {
        const priorIndex = stepIds.indexOf(prior);
        if (priorIndex < 0) problems.push(`${at}: excluye a quien hizo «${prior}», que no es un paso de la tarea.`);
        else if (priorIndex >= index) problems.push(`${at}: excluye a quien hizo «${prior}», que no es un paso anterior.`);
      }

      const closing = step.closing === undefined ? undefined : text(step.closing);
      if (closing !== undefined && !CLOSINGS.includes(closing)) problems.push(`${at}: «${closing}» no es una regla de cierre (${CLOSINGS.join(", ")}).`);
      if (closing === "checklist" && !list(step.checklist).length) problems.push(`${at}: se cierra con una lista de comprobación, pero no tiene preguntas.`);
      // Questions also serve a report each person hands in (closing: "approval"); elsewhere they would never be asked.
      if (closing !== "checklist" && closing !== "approval" && step.checklist !== undefined) problems.push(`${at}: tiene preguntas, pero ni se cierra con ellas (closing: "checklist") ni son las de un reporte (closing: "approval").`);
      if (closing === "approval" && stepClaimMode(typed) === "none") problems.push(`${at}: lo aprueba otra persona, así que alguien tiene que poder tomarlo (exclusive o pool).`);
      if (step.decisionRule !== undefined && !["majority", "unanimous"].includes(text(step.decisionRule))) problems.push(`${at}: la regla de decisión es "majority" o "unanimous".`);
      if (step.scope !== undefined && !STEP_SCOPES.includes(text(step.scope))) problems.push(`${at}: «${text(step.scope)}» no es un alcance de paso (${STEP_SCOPES.join(", ")}).`);
      const questionIds = new Set<string>();
      for (const question of list(step.checklist)) {
        const questionId = text(question.id);
        if (!questionId || !text(question.text)) problems.push(`${at}: una pregunta no tiene id o texto.`);
        if (questionIds.has(questionId)) problems.push(`${at}: la pregunta «${questionId}» está repetida.`);
        questionIds.add(questionId);
        checkLocalized(question.texts, `${at}, pregunta «${questionId}»`, languages, problems);
        if (question.per !== undefined && !["item", "verse"].includes(text(question.per))) problems.push(`${at}, pregunta «${questionId}»: «per» es "item" o "verse".`);
      }
    });
  }

  for (const profile of list(raw.releaseProfiles)) {
    for (const phaseId of Array.isArray(profile.requiredPhaseIds) ? profile.requiredPhaseIds.map(String) : []) {
      if (!phaseIds.has(phaseId)) problems.push(`versión «${text(profile.name) || text(profile.id)}»: pide la fase «${phaseId}», que no existe.`);
    }
  }
  return problems;
}

/** Problems of a whole process package: its tools and each of its templates. */
export function processProblems(pack: ProcessPackage, opts: { tools: SolverApp[]; languages: string[] }): string[] {
  const problems: string[] = [];
  if (!text(pack.id)) problems.push("El paquete no tiene id.");
  const toolIds = new Set<string>();
  for (const tool of list(pack.tools)) {
    const id = text(tool.id);
    if (!id || !text(tool.name) || !text(tool.launchUrl)) problems.push(`herramienta «${id || "(sin id)"}»: necesita id, nombre y launchUrl.`);
    if (toolIds.has(id)) problems.push(`herramienta «${id}»: el id está repetido.`);
    toolIds.add(id);
    for (const resource of Array.isArray(tool.resources) ? tool.resources.map(String) : []) {
      if (!(SCOPE_KEYS as string[]).includes(resource)) problems.push(`herramienta «${id}»: el recurso «${resource}» no existe.`);
    }
    if (tool.walks !== undefined) {
      const walk = isObject(tool.walks) ? tool.walks : {};
      if (!(WALK_UNITS as string[]).includes(text(walk.unit))) problems.push(`herramienta «${id}»: «walks.unit» debe ser uno de ${WALK_UNITS.join(", ")}.`);
      if (walk.times !== undefined && !(Number(walk.times) > 0)) problems.push(`herramienta «${id}»: «walks.times» debe ser un número mayor que cero.`);
      checkLocalized(walk.labels, `herramienta «${id}» (walks)`, opts.languages, problems);
    }
  }
  const workflowIds = new Set<string>();
  for (const workflow of pack.workflows ?? []) {
    const id = isObject(workflow) ? text(workflow.id) : "";
    if (id && workflowIds.has(id)) problems.push(`La plantilla «${id}» está repetida en el paquete.`);
    workflowIds.add(id);
    problems.push(...workflowProblems(workflow, opts));
  }
  for (const [lang, words] of Object.entries(pack.glossary ?? {})) {
    if (!opts.languages.includes(lang)) problems.push(`glosario: el idioma «${lang}» no es un idioma de la interfaz.`);
    for (const [from, to] of Object.entries(words)) if (!from.trim() || !String(to).trim()) problems.push(`glosario «${lang}»: hay una entrada vacía.`);
  }
  return problems.map((problem) => `[${pack.id}] ${problem}`);
}
