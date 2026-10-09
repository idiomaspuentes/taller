/**
 * A walkthrough of a process: the same tasks, steps and tools, with no waits and one seat where there were several,
 * so that one person can try every step on a chapter of a book that is already done.
 *
 *   npm run verify:walkthrough
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shippedWorkflows } from "../src/domain/processes";
import { tallyItem, type ReviewDecision } from "../src/domain/reviewRound";
import { inheritTeams, limitedToChapters, phasesAtStart, tasksWithoutTeam } from "../src/domain/startBook";
import { canClaimStep, claimStep } from "../src/domain/stepClaim";
import { normalizeInventory, normalizeWorkflowTemplate } from "../src/domain/store";
import { emptyTaskProgress, markStepDone } from "../src/domain/taskProgress";
import type { AssignmentsDoc, InventoryDoc, TaskStep, WorkflowTemplate } from "../src/domain/types";
import { isWalkthroughId, processOf, walkthroughId, walkthroughOf } from "../src/domain/walkthrough";
import { publishableWorkOrders } from "../src/domain/workOrder";
import { applyWorkflowToBoard } from "../src/domain/workflows";
import { runPrep } from "../src/prep/index";
import { statusToDict } from "../src/status/emit";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const processes = shippedWorkflows();
assert.ok(processes.length, "hay al menos un proceso con el que probar");
const walk = (workflow: WorkflowTemplate) => walkthroughOf(workflow, { name: `Recorrido de prueba · ${workflow.name}`, description: "Para probar." });
const empty = (book: string) => ({ projectId: book, book, books: [book], teams: [], phases: [], people: [], assignments: [] }) as unknown as AssignmentsDoc;
const boardOf = (workflow: WorkflowTemplate, book = "TIT") => applyWorkflowToBoard(empty(book), workflow);
const stepsOf = (workflow: WorkflowTemplate) => workflow.tasks.flatMap((task) => (task.steps ?? []).map((step) => ({ task, step })));
const thresholdsOf = (step: TaskStep) => ({ minAgree: step.minAgree ?? step.minAssignees ?? 3, minIndependent: step.minIndependent ?? 2 });

test("un recorrido se reconoce por su id, y dice de qué proceso es", () => {
  for (const workflow of processes) {
    const id = walkthroughId(workflow.id);
    assert.ok(isWalkthroughId(id) && !isWalkthroughId(workflow.id));
    assert.equal(processOf(id), workflow.id);
    assert.equal(processOf(workflow.id), workflow.id, "un proceso es su propio proceso");
    assert.equal(walk(workflow).id, id);
  }
  assert.equal(processOf(undefined), "");
});

test("tiene las fases, las tareas, los pasos y las herramientas de su proceso, y ninguna espera", () => {
  for (const workflow of processes) {
    const trial = walk(workflow);
    assert.deepEqual(trial.phases, workflow.phases);
    assert.deepEqual(trial.tasks.map((task) => [task.id, task.phaseId, task.rules, task.minLevel, task.distributeUnit, task.bundle]), workflow.tasks.map((task) => [task.id, task.phaseId, task.rules, task.minLevel, task.distributeUnit, task.bundle]));
    assert.deepEqual(stepsOf(trial).map(({ step }) => [step.id, step.solverAppId, step.closing, step.claimMode, step.scope, step.checklist]), stepsOf(workflow).map(({ step }) => [step.id, step.solverAppId, step.closing, step.claimMode, step.scope, step.checklist]));
    assert.ok(workflow.tasks.some((task) => task.waitsFor?.length), "el proceso encadena sus tareas");
    assert.ok(trial.tasks.every((task) => !task.waitsFor?.length), "el recorrido no");
    assert.ok(phasesAtStart(boardOf(trial)).every((phase) => phase.ready), "todas las fases pueden empezar desde el principio");
    assert.ok(phasesAtStart(boardOf(workflow)).some((phase) => !phase.ready));
    assert.equal(trial.version, workflow.version);
  }
});

test("un paso que toman varias personas tiene un solo asiento, y no pide a nadie más", () => {
  for (const workflow of processes) {
    const trial = normalizeWorkflowTemplate(walk(workflow))!;
    const pools = stepsOf(trial).filter(({ step }) => step.claimMode === "pool");
    assert.ok(pools.length, "el proceso tiene pasos de varias personas");
    for (const { step } of pools) {
      assert.equal(step.minAssignees, 1);
      assert.ok((step.maxAssignees ?? 0) >= 1);
      assert.equal(step.minIndependent, 0, "y se dice con un 0: sin decirlo, las herramientas piden dos");
      assert.equal(step.minAgree, undefined);
      assert.equal(step.excludePriorStepIds, undefined);
      assert.equal(step.excludeIssueAssignee, undefined);
      assert.deepEqual(thresholdsOf(step), { minAgree: 1, minIndependent: 0 });
    }
    // On a project, and written and read again, it still says so.
    const board = JSON.parse(JSON.stringify(boardOf(trial))) as AssignmentsDoc;
    for (const task of board.teams) for (const step of task.steps ?? []) if (step.claimMode === "pool") assert.deepEqual([step.minAssignees, step.minIndependent], [1, 0]);
  }
});

test("el proceso de verdad no cambia: sus pasos piden a las personas que pedían", () => {
  for (const workflow of processes) {
    const again = normalizeWorkflowTemplate(JSON.parse(JSON.stringify(workflow)))!;
    assert.deepEqual(stepsOf(again).map(({ step }) => [step.id, step.minAssignees, step.maxAssignees, step.minAgree, step.minIndependent]), stepsOf(workflow).map(({ step }) => [step.id, step.minAssignees, step.maxAssignees, step.minAgree, step.minIndependent]));
    assert.ok(stepsOf(workflow).every(({ step }) => step.minIndependent !== 0), "ninguno dice 0");
  }
});

test("quien hizo un paso puede tomar el siguiente, que en el proceso es de otras personas", () => {
  let tried = 0;
  for (const workflow of processes) {
    const trial = walk(workflow);
    for (const task of workflow.tasks) {
      const steps = task.steps ?? [];
      const at = steps.findIndex((step) => step.claimMode === "pool" && step.excludePriorStepIds?.length);
      if (at < 1) continue;
      tried++;
      // The person did every step before it.
      let progress = emptyTaskProgress();
      for (const before of steps.slice(0, at)) progress = markStepDone(claimStep(progress, before, "ana"), before.id);
      assert.equal(canClaimStep("ana", steps, progress, steps[at]!), false, `${task.id}: en el proceso no puede`);
      const mine = trial.tasks.find((row) => row.id === task.id)!.steps!;
      assert.equal(canClaimStep("ana", mine, progress, mine[at]!), true, `${task.id}: en el recorrido sí`);
    }
  }
  assert.ok(tried > 0, "algún proceso tiene un paso así");
});

test("la revisión que hace otra persona sigue pidiendo a otra persona", () => {
  let reviews = 0;
  for (const workflow of processes) {
    const trial = walk(workflow);
    for (const { task, step } of stepsOf(workflow)) {
      if (step.claimMode !== "exclusive" || !step.excludeIssueAssignee) continue;
      reviews++;
      const mine = trial.tasks.find((row) => row.id === task.id)!.steps!;
      assert.deepEqual(mine.find((row) => row.id === step.id), step, `${task.id} · ${step.id}: igual que en el proceso`);
      let progress = emptyTaskProgress();
      for (const before of mine.slice(0, mine.findIndex((row) => row.id === step.id))) progress = markStepDone(claimStep(progress, before, "ana"), before.id);
      const review = mine.find((row) => row.id === step.id)!;
      assert.equal(canClaimStep("ana", mine, progress, review, undefined, "ana"), false, "quien tiene la subtarea no la revisa");
      assert.equal(canClaimStep("bea", mine, progress, review, undefined, "ana"), true, "otra persona, sí");
    }
  }
  assert.ok(reviews > 0, "algún proceso tiene una revisión así");
});

test("una persona habilitada que aprueba deja el punto acordado, aunque sea quien escribió el texto", () => {
  const approved: ReviewDecision = { itemId: "1:1", reviewer: "ana", status: "approved", timestamp: "2026-10-08T10:00:00Z" } as ReviewDecision;
  const tally = (step: TaskStep) => tallyItem({ itemId: "1:1", decisions: [approved], levels: { ana: "habilitada" }, authors: ["ana"], thresholds: thresholdsOf(step) }).state;
  let rounds = 0;
  for (const workflow of processes) {
    const trial = walk(workflow);
    for (const { task, step } of stepsOf(workflow)) {
      if (step.claimMode !== "pool" || step.closing !== "consensus") continue;
      rounds++;
      assert.equal(tally(step), "pending", `${task.id} · ${step.id}: en el proceso hace falta más gente`);
      assert.equal(tally(trial.tasks.find((row) => row.id === task.id)!.steps!.find((row) => row.id === step.id)!), "agreed");
    }
  }
  assert.ok(rounds > 0);
});

test("lo hacen los equipos que hacen el proceso: se heredan del último libro, en los dos sentidos", () => {
  const workflow = processes[0]!;
  const real = boardOf(workflow, "TIT");
  const titus = { ...real, people: [{ id: "ana", name: "Ana" }], teams: real.teams.map((task) => ({ ...task, orgTeamId: 11, orgTeamName: `equipo-${task.phaseId}` })) } as AssignmentsDoc;
  const trial = inheritTeams(boardOf(walk(workflow), "JON"), titus);
  assert.equal(tasksWithoutTeam(trial).length, 0);
  assert.deepEqual(trial.teams.map((task) => task.orgTeamName), titus.teams.map((task) => task.orgTeamName));
  assert.equal(tasksWithoutTeam(inheritTeams(boardOf(workflow, "RUT"), trial)).length, 0, "y un libro de verdad, del recorrido");
  assert.equal(tasksWithoutTeam(inheritTeams(boardOf(walk(workflow), "JON"), { ...titus, workflowId: "otro" })).length, real.teams.length, "de otro proceso, no");
});

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "prep", "__fixtures__");
const read = (name: string) => readFileSync(join(fixtures, name), "utf-8");
// The second half of reading a book (the state of its articles) needs the network; with no articles it is only a shape.
const inventory: InventoryDoc = normalizeInventory(
  statusToDict([], {
    book: "TIT",
    dcs: { base: "", org: "", ta_repo: "", tw_repo: "", branch: "", fetch: "contents" },
    subjects: {},
    prep: runPrep({ book: "TIT", ultText: read("57-TIT-sample.usfm"), ultPath: "TIT", tn: { path: "tn_TIT.tsv", text: read("tn_TIT.tsv") }, tq: { path: "tq_TIT.tsv", text: read("tq_TIT.tsv") }, twl: { path: "twl_TIT.tsv", text: read("twl_TIT.tsv") } }),
  } as never) as never,
);

test("se recorre un capítulo: las subtareas son las de ese capítulo, de todas las tareas que lo trabajan", () => {
  const chapters = [...new Set(inventory.portions.map((portion) => portion.chapter))];
  assert.ok(chapters.length > 1, "el libro de prueba tiene más de un capítulo");
  const chapter = chapters[1]!;
  const chapterOf = new Map(inventory.portions.map((portion) => [portion.id, portion.chapter]));
  for (const workflow of processes) {
    const whole = boardOf(walk(workflow));
    const one = limitedToChapters(whole, "TIT", [chapter]);
    assert.equal(limitedToChapters(whole, "TIT", []), whole, "sin capítulo, el libro entero");
    assert.equal(limitedToChapters(whole, "TIT", undefined), whole);
    const all = publishableWorkOrders(whole, inventory);
    const mine = publishableWorkOrders(one, inventory);
    assert.ok(mine.length > 0 && mine.length < all.length, `${mine.length} de ${all.length}`);
    for (const order of mine) {
      for (const id of order.portionIds) assert.equal(chapterOf.get(id), chapter, `${order.label}: una porción de otro capítulo`);
      if (order.chapter) assert.equal(order.chapter, chapter, order.label);
    }
    const tasksWith = (orders: typeof mine) => new Set(orders.map((order) => order.teamId));
    const inChapter = new Set(all.filter((order) => order.chapter === chapter || order.portionIds.some((id) => chapterOf.get(id) === chapter)).map((order) => order.teamId));
    assert.deepEqual([...tasksWith(mine)].sort(), [...inChapter].sort(), "ninguna tarea que trabaja el capítulo se queda sin su subtarea");
  }
});

console.log(`\nverify-walkthrough: ${passed} checks passed.`);
