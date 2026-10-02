/**
 * The plan a template, a draft and a project share, and the operations the one editor uses on it.
 *
 *   npm run verify:plan
 */
import assert from "node:assert/strict";
import { shippedWorkflows } from "../src/domain/processes";
import {
  addPhase,
  addStep,
  addTask,
  boardWithPlan,
  duplicateTask,
  movePhase,
  moveStep,
  moveTask,
  moveTaskToPhase,
  orderedPhases,
  planImpact,
  planOfBoard,
  planOfWorkflow,
  removePhase,
  removeStep,
  removeTask,
  setTaskResources,
  stepClosing,
  stepWho,
  withStepSeats,
  withStepWho,
  type Plan,
} from "../src/domain/plan";
import { SCOPE_KEYS, type AssignmentsDoc, type TaskStep } from "../src/domain/types";
import { applyWorkflowToBoard } from "../src/domain/workflows";
import { normalizeWorkflowTemplate } from "../src/domain/store";
import { workflowProblems } from "../src/domain/workflowCheck";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const shipped = shippedWorkflows()[0]!;
const plan = (): Plan => structuredClone(planOfWorkflow(shipped));
const empty = (book: string) => ({ projectId: book, book, teams: [], phases: [], people: [], assignments: [] }) as unknown as AssignmentsDoc;

test("una fase nueva va al final y una tarea nueva al final de su fase", () => {
  const withPhase = addPhase(plan(), "Lectura pública");
  assert.equal(orderedPhases(withPhase.plan).at(-1)?.id, withPhase.id);
  const first = orderedPhases(plan())[0]!.id;
  const added = addTask(plan(), first, "Revisar la introducción");
  const inPhase = added.plan.tasks.filter((task) => task.phaseId === first);
  assert.equal(inPhase.at(-1)?.id, added.id);
  assert.equal(added.plan.tasks.find((task) => task.id === added.id)?.rules.length, 0, "empieza como trabajo general, sin recurso");
});

test("dos tareas con el mismo nombre no comparten identificador", () => {
  const first = orderedPhases(plan())[0]!.id;
  const one = addTask(plan(), first, "Revisar");
  const two = addTask(one.plan, first, "Revisar");
  assert.notEqual(one.id, two.id);
});

test("mover una fase cambia el orden sin tocar sus tareas", () => {
  const phases = orderedPhases(plan());
  const moved = movePhase(plan(), phases[1]!.id, -1);
  assert.equal(orderedPhases(moved)[0]!.id, phases[1]!.id);
  assert.deepEqual(moved.tasks, plan().tasks);
  assert.equal(movePhase(plan(), phases[0]!.id, -1).phases.length, phases.length, "la primera no sube más");
});

test("quitar una tarea quita también los «espera a» que la nombraban", () => {
  const base = plan();
  const awaited = base.tasks.find((task) => base.tasks.some((other) => other.waitsFor?.some((rule) => rule.taskId === task.id && !rule.source)));
  assert.ok(awaited, "el proceso de ejemplo tiene una tarea a la que otra espera");
  const next = removeTask(base, awaited.id);
  assert.ok(!next.tasks.some((task) => task.waitsFor?.some((rule) => rule.taskId === awaited.id)));
});

test("quitar una fase se lleva sus tareas y las esperas a esa fase", () => {
  const base = plan();
  const phase = orderedPhases(base)[0]!;
  const next = removePhase(base, phase.id);
  assert.ok(!next.tasks.some((task) => task.phaseId === phase.id));
  assert.ok(!next.tasks.some((task) => task.waitsFor?.some((rule) => rule.phaseId === phase.id)));
});

test("una tarea se mueve dentro de su fase y a otra fase", () => {
  const base = plan();
  const phase = orderedPhases(base)[0]!.id;
  const [a, b] = base.tasks.filter((task) => task.phaseId === phase);
  const swapped = moveTask(base, b!.id, -1).tasks.filter((task) => task.phaseId === phase);
  assert.deepEqual([swapped[0]!.id, swapped[1]!.id], [b!.id, a!.id]);
  const other = orderedPhases(base)[1]!.id;
  const moved = moveTaskToPhase(base, a!.id, other);
  assert.equal(moved.tasks.filter((task) => task.phaseId === other).at(-1)?.id, a!.id);
});

test("una copia tiene pasos propios y sus exclusiones apuntan a ellos", () => {
  const base = plan();
  const source = base.tasks.find((task) => task.steps?.some((step) => step.excludePriorStepIds?.length))!;
  const copy = duplicateTask(base, source.id, `${source.name} (copia)`)!;
  const made = copy.plan.tasks.find((task) => task.id === copy.id)!;
  const ids = new Set(made.steps!.map((step) => step.id));
  assert.ok(made.steps!.every((step) => !source.steps!.some((old) => old.id === step.id)));
  assert.ok(made.steps!.flatMap((step) => step.excludePriorStepIds ?? []).every((id) => ids.has(id)));
});

test("los recursos de una tarea se eligen y una sin ninguno es trabajo general", () => {
  const task = plan().tasks[0]!;
  const two = setTaskResources(task, ["notas", "tpl"], SCOPE_KEYS);
  assert.deepEqual(two.rules.map((rule) => rule.resource), ["tpl", "notas"], "en el orden habitual");
  assert.equal(setTaskResources({ ...two, bundle: { enabled: true, grain: "portion" } }, ["tpl"], SCOPE_KEYS).bundle, undefined, "«juntos» solo con varios");
  const general = setTaskResources(task, [], SCOPE_KEYS);
  assert.deepEqual([general.rules, general.general], [[], true]);
  assert.equal(two.general, undefined);
  const saved = normalizeWorkflowTemplate({ ...shipped, tasks: [...shipped.tasks, { ...general, id: "general", name: "Reunión de cierre" }] })!;
  assert.ok(saved.tasks.some((row) => row.id === "general" && row.general), "y una plantilla la conserva al guardarse");
  const lone = { id: "general", name: "Reunión de cierre", phaseId: shipped.phases[0]!.id, rules: [], general: true };
  assert.ok(!workflowProblems({ ...shipped, tasks: [lone] }).some((problem) => problem.includes("Reunión de cierre")), "y no es un error que no nombre un recurso");
  assert.ok(workflowProblems({ ...shipped, tasks: [{ ...lone, general: undefined }] }).some((problem) => problem.includes("recurso")), "salvo que tampoco diga que es trabajo general");
});

test("quién hace un paso se dice en tres formas y cada una deja el paso coherente", () => {
  const step: TaskStep = { id: "s", name: "Revisar" };
  assert.equal(stepWho(step), "owner");
  assert.equal(stepClosing(step), "self");
  const one = withStepWho(step, "one");
  assert.deepEqual([one.claimMode, one.excludeIssueAssignee, stepClosing(one)], ["exclusive", true, "approval"]);
  const several = withStepWho(one, "several");
  assert.deepEqual([several.claimMode, several.minAssignees, several.maxAssignees], ["pool", 2, 2]);
  const back = withStepWho({ ...several, closing: "consensus", minIndependent: 2, excludePriorStepIds: ["x"] }, "owner");
  assert.deepEqual([back.claimMode, back.minAssignees, back.minIndependent, back.excludePriorStepIds, back.closing], [undefined, undefined, undefined, undefined, "self"]);
  assert.equal(withStepWho({ ...step, closing: "checklist" }, "one").closing, "checklist", "una forma de completar que sigue valiendo se conserva");
});

test("el máximo de personas nunca queda por debajo del mínimo", () => {
  const seats = withStepSeats({ id: "s", name: "x", claimMode: "pool", minIndependent: 3 }, 3, 2);
  assert.deepEqual([seats.minAssignees, seats.maxAssignees, seats.minIndependent], [3, 3, 3]);
  assert.equal(withStepSeats({ id: "s", name: "x", claimMode: "pool", minIndependent: 3 }, 2, 4).minIndependent, 2);
});

test("un paso solo excluye a quien hizo pasos anteriores, también después de moverlo o de quitar uno", () => {
  const base = plan();
  const task = base.tasks.find((row) => row.steps?.some((step) => (step.excludePriorStepIds?.length ?? 0) > 0))!;
  const step = task.steps!.find((row) => row.excludePriorStepIds?.length)!;
  const prior = step.excludePriorStepIds![0]!;
  const withoutPrior = removeStep(base, task.id, prior).tasks.find((row) => row.id === task.id)!;
  assert.ok(!withoutPrior.steps!.find((row) => row.id === step.id)!.excludePriorStepIds?.includes(prior));
  let moved = base;
  for (let i = 0; i < task.steps!.length; i++) moved = moveStep(moved, task.id, step.id, -1);
  assert.equal(moved.tasks.find((row) => row.id === task.id)!.steps![0]!.id, step.id);
  assert.equal(moved.tasks.find((row) => row.id === task.id)!.steps![0]!.excludePriorStepIds, undefined);
});

test("un proyecto conserva de cada tarea lo que el plan no dice, y las tareas nuevas abarcan todo el libro", () => {
  const board = applyWorkflowToBoard(empty("3JN"), shipped);
  const before = { ...board, teams: board.teams.map((task, i) => (i === 0 ? { ...task, memberIds: ["ana"], orgTeamId: 7, orgTeamName: "pm-uno" } : task)) };
  const edited = addStep(addTask(planOfBoard(before), before.phases[0]!.id, "Revisar la introducción").plan, before.teams[0]!.id, "Leer en voz alta").plan;
  const after = boardWithPlan(before, edited);
  assert.deepEqual(after.teams[0]!.memberIds, ["ana"]);
  assert.equal(after.teams[0]!.orgTeamName, "pm-uno");
  assert.equal(after.teams[0]!.steps!.at(-1)?.name, "Leer en voz alta");
  const added = after.teams.find((task) => task.name === "Revisar la introducción")!;
  assert.deepEqual([added.memberIds, added.scriptureScope, added.scope], [[], { mode: "project" }, []]);
});

test("antes de guardar se sabe qué tareas desaparecen y cuáles cambian de pasos", () => {
  const base = plan();
  const [first, second] = base.tasks;
  const next = addStep(removeTask(base, first!.id), second!.id, "Otro").plan;
  const impact = planImpact(base, next);
  assert.deepEqual(impact.removedTasks.map((task) => task.id), [first!.id]);
  assert.deepEqual(impact.changedSteps.map((task) => task.id), [second!.id]);
  assert.deepEqual(planImpact(base, plan()), { removedTasks: [], changedSteps: [] });
});

console.log(`\nverify-plan: ${passed} checks passed.`);
