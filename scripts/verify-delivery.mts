/**
 * What walking a book through the app found: a subtarea must carry the resource of its task (so it is delivered to
 * the right repository), a step done in a shared tool opens no personal review, and an empty success answer from
 * Door43 (merging a pull request) is a success.
 */
import assert from "node:assert/strict";
import { request } from "@ip-lms/dcs-client";
import { stepNeedsOpenPortionPr, taskWorksOnSharedDraft } from "../src/domain/portionPr";
import type { AssignmentsDoc, InventoryDoc, Portion, ProjectTask, TaskStep } from "../src/domain/types";
import { planUnassignedLots, publishableWorkOrders, taskResource } from "../src/domain/workOrder";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

const portion = (chapter: number, id: string, from: number, to: number): Portion =>
  ({
    id,
    ref: `${chapter}:${from}-${to}`,
    chapter,
    verses: Array.from({ length: to - from + 1 }, (_, i) => from + i),
    tpl: 1, tps: 1, notas: 1, preguntas: 1,
    tplItems: [], tpsItems: [], notasItems: [], preguntasItems: [], academia: [], palabras: [],
  }) as unknown as Portion;

const inventory = { portions: [portion(2, "P1", 1, 8), portion(2, "P2", 9, 15)], articles: [] } as unknown as InventoryDoc;

const task = (id: string, resources: string[], extra: Partial<ProjectTask> = {}): ProjectTask =>
  ({
    id,
    name: id,
    description: "",
    memberIds: [],
    rules: resources.map((resource) => ({ resource, articleFilter: "pending" })),
    distributePolicy: "manual",
    ...extra,
  }) as unknown as ProjectTask;

await test("la tarea trabaja el recurso que nombran sus reglas", () => {
  assert.equal(taskResource(task("tps", ["tps"])), "tps");
  assert.equal(taskResource(task("notas", ["notas"])), "notas");
  assert.equal(taskResource(task("vieja", [])), "tpl", "un tablero antiguo sin reglas sigue siendo TPL");
  assert.equal(taskResource(task("validar", ["tpl", "tps"])), "bundle", "varias: es un lote");
});

await test("una subtarea por porción lleva el recurso de su tarea, no siempre TPL", () => {
  for (const resource of ["tpl", "tps", "notas", "preguntas"]) {
    const orders = planUnassignedLots(task(`t-${resource}`, [resource]), inventory, "TIT", {});
    assert.ok(orders.length > 0, `${resource}: hay subtareas`);
    for (const order of orders) assert.equal(order.resource, resource, `${resource}: la subtarea sale como ${order.resource}`);
  }
});

await test("una subtarea por capítulo también lleva el recurso de su tarea", () => {
  const byChapter = task("afinar-tps", ["tps"], { bundle: { enabled: true, grain: "chapter" }, distributeUnit: "chapter" } as Partial<ProjectTask>);
  const orders = planUnassignedLots(byChapter, inventory, "TIT", {});
  assert.equal(orders.length, 1);
  assert.equal(orders[0]!.resource, "tps");
});

await test("una tarea que recorre cada unidad tiene una subtarea por capítulo, aunque solo nombre artículos", () => {
  const twoChapters = {
    portions: [portion(2, "P1", 1, 8), portion(2, "P2", 9, 15), portion(3, "P3", 1, 15)],
    articles: [{ id: "grace", kind: "Translation Words", path: "kt/grace", status: "english", title: "grace" }],
  } as unknown as InventoryDoc;
  const base = { bundle: { enabled: true, grain: "chapter" }, distributeUnit: "chapter" } as Partial<ProjectTask>;
  const byArticle = publishableWorkOrders({ teams: [task("armonizar-palabras", ["palabras"], base)], assignments: [], people: [], phases: [], book: "TIT" } as unknown as AssignmentsDoc, twoChapters);
  assert.equal(byArticle.length, 1, "por artículos: el artículo se planifica una sola vez");
  const everyUnit = publishableWorkOrders({ teams: [task("armonizar-palabras", ["palabras"], { ...base, everyUnit: true })], assignments: [], people: [], phases: [], book: "TIT" } as unknown as AssignmentsDoc, twoChapters);
  assert.deepEqual(everyUnit.map((order) => order.chapter), [2, 3], "una por capítulo");
  assert.ok(everyUnit.every((order) => order.resource === "palabras" && order.itemIds.every((id) => id.startsWith("porcion:"))));
});

const step = (extra: Partial<TaskStep>): TaskStep => ({ id: "s", name: "s", ...extra }) as TaskStep;

await test("un paso que se cierra en su herramienta no abre revisión personal", () => {
  assert.equal(stepNeedsOpenPortionPr(step({ claimMode: "exclusive" })), true, "revisión en pares: sí");
  assert.equal(stepNeedsOpenPortionPr(step({ claimMode: "pool", closing: "consensus", solverAppId: "afinar-notas" })), false, "consenso en su pantalla: no");
  assert.equal(stepNeedsOpenPortionPr(step({ claimMode: "pool", closing: "checklist", solverAppId: "fcr-checklist" })), false, "lista de comprobación: no");
});

await test("una tarea hecha entera en herramientas compartidas se entrega sin borrador propio", () => {
  const shared = [step({ closing: "consensus", solverAppId: "a" }), step({ closing: "consensus", solverAppId: "b" })];
  assert.equal(taskWorksOnSharedDraft(shared), true);
  assert.equal(taskWorksOnSharedDraft([...shared, step({})]), false, "con un paso libre ya no");
  assert.equal(taskWorksOnSharedDraft([]), false);
  assert.equal(taskWorksOnSharedDraft(undefined), false);
});

await test("una respuesta 200 sin cuerpo (fusionar una revisión) es un éxito", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("", { status: 200 })) as typeof fetch;
  try {
    const result = await request<void>({ host: "https://example.invalid" } as Parameters<typeof request>[0], { method: "POST", path: "/repos/o/r/pulls/1/merge", token: "t", body: { Do: "merge" } });
    assert.equal(result, undefined);
    globalThis.fetch = (async () => new Response('{"number":7}', { status: 201 })) as typeof fetch;
    const parsed = await request<{ number: number }>({ host: "https://example.invalid" } as Parameters<typeof request>[0], { path: "/x" });
    assert.equal(parsed.number, 7, "un cuerpo JSON se sigue leyendo");
  } finally {
    globalThis.fetch = realFetch;
  }
});

console.log(`\nverify-delivery: ${passed} checks passed.`);
