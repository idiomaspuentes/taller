/** How much of a chapter reached its group reading: which passages arrived, which are missing and who has them. */
import assert from "node:assert/strict";
import type { DcsIssue } from "@ip-lms/dcs-client";
import { readingArrivals } from "../src/domain/readingArrivals";
import { encodeTaskProgressMarker } from "../src/domain/taskProgress";
import { WORK_ORDER_SCHEMA } from "../src/domain/workOrder";
import type { ProjectTask } from "../src/domain/types";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

const reading = {
  id: "grupo",
  name: "Revisión grupal TPL",
  phaseId: "p1",
  waitsFor: [{ taskId: "grupo", scope: "before" }, { taskId: "par", scope: "chapter", partial: true }],
  steps: [{ id: "lectura", name: "Lectura grupal", closing: "consensus", claimMode: "pool" }],
} as unknown as ProjectTask;

let n = 0;
function issue(opts: { task: string; title: string; assignee?: string; items?: string[]; seats?: string[]; state?: "open" | "closed" }): DcsIssue {
  n++;
  const order = opts.items ? `<!-- gateway-work-order ${JSON.stringify({ schema: WORK_ORDER_SCHEMA, key: `k${n}`, teamId: opts.task, book: "NEH", resource: "ult", portionIds: [], itemIds: opts.items })} -->` : "";
  const progress = opts.seats ? encodeTaskProgressMarker({ schema: "gateway-task-progress-2", doneStepIds: [], steps: { lectura: { assignees: opts.seats, approvals: [] } } } as never) : "";
  return {
    id: n, number: n, title: opts.title, state: opts.state ?? "open", body: `${order}\n${progress}`,
    labels: [{ id: 1, name: `pm/tarea:${opts.task}` }],
    assignee: opts.assignee ? { login: opts.assignee } : null,
    assignees: opts.assignee ? [{ login: opts.assignee }] : [],
  } as unknown as DcsIssue;
}

const five = ["porcion:NEH 3:1-6", "porcion:NEH 3:7-13", "porcion:NEH 3:14-19", "porcion:NEH 3:20-24", "porcion:NEH 3:25-32"];

await test("llegaron 3 de 5 pasajes: cuáles, cuántos versículos, y quién tiene los que faltan", () => {
  const group = issue({ task: "grupo", title: "NEH 3 · Revisión grupal TPL", items: five });
  const withAna = issue({ task: "par", title: "NEH 3:20–24 · TPL", assignee: "ana" });
  const untaken = issue({ task: "par", title: "NEH 3:25–32 · TPL" });
  const otherChapter = issue({ task: "par", title: "NEH 4:1–5 · TPL", assignee: "bea" });
  const got = readingArrivals(group, reading, [group, withAna, untaken, otherChapter])!;
  assert.equal(got.chapter, 3);
  assert.deepEqual(got.arrived, [{ from: 1, to: 6 }, { from: 7, to: 13 }, { from: 14, to: 19 }]);
  assert.deepEqual(got.missing, [{ from: 20, to: 24, who: "ana" }, { from: 25, to: 32 }]);
  assert.equal(got.arrivedVerses, 19);
  assert.equal(got.totalVerses, 32);
});

await test("con todo entregado, no falta nada", () => {
  const group = issue({ task: "grupo", title: "NEH 3 · Revisión grupal TPL", items: five });
  const got = readingArrivals(group, reading, [group])!;
  assert.equal(got.missing.length, 0);
  assert.equal(got.arrived.length, 5);
  assert.equal(got.arrivedVerses, got.totalVerses);
});

await test("una subtarea de origen de todo el capítulo cubre todos los pasajes", () => {
  const group = issue({ task: "grupo", title: "NEH 3 · Revisión grupal TPL", items: five });
  const whole = issue({ task: "par", title: "NEH 3 · TPL", assignee: "ana" });
  assert.equal(readingArrivals(group, reading, [group, whole])!.arrived.length, 0);
});

await test("si no se sabe qué está abierto, no se dice nada de lo que llegó", () => {
  const group = issue({ task: "grupo", title: "NEH 3 · Revisión grupal TPL", items: five });
  assert.equal(readingArrivals(group, reading, undefined), undefined);
});

await test("una tarea sin espera parcial, o una subtarea sin pasajes, no tiene llegadas", () => {
  const group = issue({ task: "grupo", title: "NEH 3 · Revisión grupal TPL", items: five });
  const plain = { ...reading, waitsFor: [{ taskId: "par", scope: "chapter" }] } as unknown as ProjectTask;
  assert.equal(readingArrivals(group, plain, [group]), undefined);
  const bare = issue({ task: "grupo", title: "NEH 3 · Revisión grupal TPL" });
  assert.equal(readingArrivals(bare, reading, [bare]), undefined);
});

await test("quiénes se unieron a la lectura", () => {
  const group = issue({ task: "grupo", title: "NEH 3 · Revisión grupal TPL", items: five, seats: ["rut", "miguel", "carla"] });
  assert.deepEqual(readingArrivals(group, reading, [group])!.joined, ["rut", "miguel", "carla"]);
});

console.log(`\nverify-reading-arrivals: ${passed} checks passed.`);
