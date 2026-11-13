/**
 * How far the work is: a step by what its tool counts, a subtarea by its steps, a tarea by its subtareas, and the
 * same up to the project. All of it read from the subtareas, with nothing kept apart.
 */
import assert from "node:assert/strict";
import type { DcsIssue } from "@ip-lms/dcs-client";
import { emptyTaskProgress, encodeTaskProgressMarker, markStepDone, parseTaskProgressMarker, withStepRuntime, withStepWork, type TaskProgressMarker } from "../src/domain/taskProgress";
import type { AssignmentsDoc, ProjectTask } from "../src/domain/types";
import { countedIssues, issueFraction, percentOf, projectTally, stepFraction, subtaskFraction } from "../src/domain/workProgress";
import { paceOf } from "../src/domain/pace";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const STEPS = ["estudio", "borrador", "pares"];

test("un paso va por lo que su herramienta cuenta; cerrado, está entero", () => {
  const empty = emptyTaskProgress();
  assert.equal(stepFraction(empty, "borrador"), 0);
  const half = withStepWork(empty, "borrador", { done: 6, total: 12 });
  assert.equal(stepFraction(half, "borrador"), 0.5);
  assert.equal(stepFraction(markStepDone(half, "borrador"), "borrador"), 1, "cerrado con 6 de 12 anotados sigue siendo un paso cerrado");
  const all = withStepWork(empty, "borrador", { done: 12, total: 12 });
  assert.ok(stepFraction(all, "borrador") < 1, "con todo anotado y el paso sin cerrar, no está terminado");
  assert.equal(percentOf(stepFraction(all, "borrador")), 99);
  // What is noted survives being written to the subtarea and read back, and somebody taking a seat on the step.
  const read = parseTaskProgressMarker(encodeTaskProgressMarker(half));
  assert.deepEqual(read.steps?.borrador?.work, { done: 6, total: 12 });
  assert.deepEqual(withStepRuntime(read, "borrador", { assignees: ["ana"], approvals: [] }).steps?.borrador?.work, { done: 6, total: 12 });
});

test("no se escribe por nada: la misma cuenta, un paso cerrado o una cuenta que no lo es dejan la subtarea igual", () => {
  const half = withStepWork(emptyTaskProgress(), "borrador", { done: 6, total: 12 });
  assert.equal(withStepWork(half, "borrador", { done: 6, total: 12 }), half);
  assert.notEqual(withStepWork(half, "borrador", { done: 7, total: 12 }), half);
  const closed = markStepDone(half, "borrador");
  assert.equal(withStepWork(closed, "borrador", { done: 12, total: 12 }), closed);
  assert.equal(withStepWork(half, "borrador", { done: 3, total: 0 }), half);
  assert.equal(withStepWork(half, "", { done: 3, total: 9 }), half);
  // «Nothing yet» of a step that never said anything is not news; going back to nothing after having said something is.
  assert.equal(withStepWork(half, "pares", { done: 0, total: 9 }), half);
  assert.deepEqual(withStepWork(half, "borrador", { done: 0, total: 12 }).steps?.borrador?.work, { done: 0, total: 12 });
  // More than there is, or less than nothing, is brought back to what can be.
  assert.deepEqual(withStepWork(half, "pares", { done: 40, total: 9 }).steps?.pares?.work, { done: 9, total: 9 });
  assert.equal(withStepWork(half, "pares", { done: -2, total: 9 }), half, "menos que nada es nada");
  assert.equal(parseTaskProgressMarker('<!-- gateway-task-progress {"doneStepIds":[],"steps":{"a":{"work":{"done":"x","total":4}}}} -->').steps?.a?.work, undefined);
});

test("una subtarea va por sus pasos, y el que está abierto cuenta por lo que lleva", () => {
  let marker: TaskProgressMarker = emptyTaskProgress();
  assert.equal(subtaskFraction(STEPS, marker), 0);
  marker = markStepDone(marker, "estudio");
  assert.equal(percentOf(subtaskFraction(STEPS, marker)), 33);
  marker = withStepWork(marker, "borrador", { done: 6, total: 12 });
  assert.equal(percentOf(subtaskFraction(STEPS, marker)), 50, "un paso entero y medio paso, de tres");
  marker = markStepDone(markStepDone(marker, "borrador"), "pares");
  assert.equal(subtaskFraction(STEPS, marker), 1);
  assert.equal(subtaskFraction(STEPS, emptyTaskProgress(), true), 1, "cerrada, está terminada");
  assert.equal(subtaskFraction([], emptyTaskProgress()), 0, "sin pasos, o está cerrada o no ha empezado");
});

test("un porcentaje no dice «100» de lo que falta ni «0» de lo empezado", () => {
  assert.equal(percentOf(0), 0);
  assert.equal(percentOf(1), 100);
  assert.equal(percentOf(0.999), 99);
  assert.equal(percentOf(0.001), 1);
  assert.equal(percentOf(0.5), 50);
  assert.equal(percentOf(Number.NaN), 0);
});

const rule = { resource: "tpl" as const, articleFilter: "pending" as const };
const task = (id: string, phaseId: string, steps: string[]): ProjectTask => ({ id, name: id, description: "", phaseId, memberIds: [], scope: ["tpl"], rules: [rule], steps: steps.map((step) => ({ id: step, name: step })) }) as ProjectTask;
const board: Pick<AssignmentsDoc, "teams" | "phases"> = {
  phases: [{ id: "f2", name: "Afinación", slug: "a", order: 1 }, { id: "f1", name: "Traducción", slug: "t", order: 0 }, { id: "f3", name: "Validación", slug: "v", order: 2 }],
  teams: [task("tpl", "f1", STEPS), task("notas", "f1", ["borrador", "pares"]), task("afinar", "f2", ["afinar"]), task("validar", "f3", ["leer"])],
};

let n = 0;
function issue(taskId: string, o: { closed?: boolean; marker?: TaskProgressMarker; key?: string; plain?: boolean } = {}): DcsIssue {
  n++;
  const order = JSON.stringify({ schema: "gateway-work-order-1", key: o.key ?? `${taskId}|p${n}`, book: "JUD", teamId: taskId, resource: "tpl", portionIds: [`p${n}`], itemIds: [] });
  return {
    id: n, number: n, title: `JUD · ${taskId}`, state: o.closed ? "closed" : "open",
    body: `${o.plain ? "" : `<!-- gateway-work-order ${order} -->`}\n${o.marker ? encodeTaskProgressMarker(o.marker) : ""}`,
    labels: [{ name: `pm/tarea:${taskId}` }],
  } as unknown as DcsIssue;
}
const done = (ids: string[]) => ids.reduce((marker, id) => markStepDone(marker, id), emptyTaskProgress());

test("una tarea va por sus subtareas; una fase y el proyecto, por las de sus tareas", () => {
  const issues = [
    issue("tpl", { closed: true, marker: done(STEPS) }),
    issue("tpl", { marker: withStepWork(done(["estudio"]), "borrador", { done: 6, total: 12 }) }),
    issue("tpl"),
    issue("notas", { marker: done(["borrador"]) }),
    issue("afinar"),
  ];
  const all = projectTally(issues, board);
  assert.deepEqual(all.phases.map((phase) => phase.phaseId), ["f1", "f2"], "en el orden del plan, y sin la fase que no tiene subtareas todavía");
  const [tpl, notas] = all.phases[0]!.tasks;
  assert.deepEqual([tpl!.taskId, tpl!.done, tpl!.total, percentOf(tpl!.fraction)], ["tpl", 1, 3, 50]);
  assert.deepEqual([notas!.taskId, notas!.done, notas!.total, percentOf(notas!.fraction)], ["notas", 0, 1, 50]);
  assert.deepEqual([all.phases[0]!.done, all.phases[0]!.total, percentOf(all.phases[0]!.fraction)], [1, 4, 50]);
  assert.deepEqual([all.phases[1]!.done, all.phases[1]!.total, all.phases[1]!.fraction], [0, 1, 0]);
  assert.deepEqual([all.done, all.total, percentOf(all.fraction)], [1, 5, 40]);
  assert.deepEqual(projectTally([], board), { phases: [], fraction: 0, done: 0, total: 0 });
});

test("no cuenta lo que no es trabajo: una decisión del equipo, ni la subtarea que el plan retiró", () => {
  assert.equal(issueFraction(issue("tpl", { key: "tpl|decision:1" }), board), null);
  assert.equal(issueFraction(issue("tpl", { plain: true }), board), null, "una incidencia cualquiera del repositorio");
  // Closed with steps left undone: nobody finished it, the plan dropped it. It would count as done otherwise.
  assert.equal(issueFraction(issue("tpl", { closed: true, marker: done(["estudio"]) }), board), null);
  assert.equal(issueFraction(issue("tpl", { closed: true, marker: done(STEPS) }), board), 1);
  const dropped = projectTally([issue("tpl", { closed: true }), issue("tpl", { closed: true, marker: done(STEPS) })], board);
  assert.deepEqual([dropped.done, dropped.total], [1, 1]);
});

test("las porciones juntadas en su capítulo cuentan una sola vez, y el capítulo hecho solo para guardarlas no cuenta", () => {
  // Ezra's «Frases con nota TPS» on 13 November: chapter 3 was finished by passage, chapter 4 half, then gathered.
  const part = (taskId: string, portions: string[], o: { closed?: boolean; marker?: TaskProgressMarker; at: string; extra?: boolean }) => {
    n++;
    const order = JSON.stringify({ schema: "gateway-work-order-1", key: `${taskId}|${portions.join(",")}|${n}`, book: "EZR", teamId: taskId, resource: "tpl", portionIds: portions, itemIds: o.extra ? ["extra:1"] : [] });
    return {
      id: n, number: n, title: `EZR · ${portions.join(",")}`, state: o.closed ? "closed" : "open", created_at: o.at, closed_at: o.closed ? o.at : undefined,
      body: `<!-- gateway-work-order ${order} -->\n${o.marker ? encodeTaskProgressMarker(o.marker) : ""}`,
      labels: [{ name: `pm/tarea:${taskId}` }],
    } as unknown as DcsIssue;
  };
  const gatheredMark = { ...done(["afinar"]), brought: { from: "porciones", at: "2026-11-13T21:58:00Z" } };
  const three = [part("afinar", ["c3a"], { closed: true, marker: done(["afinar"]), at: "2026-11-01T00:00:00Z" }), part("afinar", ["c3b"], { closed: true, marker: done(["afinar"]), at: "2026-11-02T00:00:00Z" })];
  const record3 = part("afinar", ["c3a", "c3b"], { closed: true, marker: gatheredMark, at: "2026-11-13T21:58:00Z" });
  const four = [part("afinar", ["c4a"], { closed: true, marker: done(["afinar"]), at: "2026-11-03T00:00:00Z" }), part("afinar", ["c4b"], { closed: true, at: "2026-11-13T21:58:00Z" })];
  const chapter4 = part("afinar", ["c4a", "c4b"], { marker: withStepWork(emptyTaskProgress(), "afinar", { done: 1, total: 4 }), at: "2026-11-13T21:58:00Z" });
  const correction = part("afinar", ["c4a"], { at: "2026-11-14T00:00:00Z", extra: true });
  const issues = [...three, record3, ...four, chapter4, correction];
  const counted = countedIssues(issues, board).map((issue) => issue.number);
  assert.deepEqual(counted, [three[0]!.number, three[1]!.number, chapter4.number, correction.number], "las porciones de 3, el capítulo 4 en vez de sus porciones, y la corrección aparte");
  const tally = projectTally(issues, board);
  // Chapter 3's two passages, chapter 4 at a quarter and the correction not begun; the withdrawn passage counts for nothing.
  assert.deepEqual([tally.done, tally.total, tally.fraction], [2, 4, (1 + 1 + 0.25 + 0) / 4]);
  const pace = paceOf(issues, board, new Date("2026-11-14T12:00:00Z"));
  assert.equal(pace.left, 0.75 + 1, "lo que falta, sin contar dos veces lo del capítulo 4");
  assert.equal(pace.weeks.reduce((a, b) => a + b, 0), 3, "las tres porciones terminadas, en su semana; el capítulo de registro, no");
});

console.log(`\nverify-work-progress: ${passed} checks passed.`);
