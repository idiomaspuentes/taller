/**
 * «Unidad de traspaso»: a whole chapter moves from one phase to the next, unless whoever prepares the book splits a
 * long one; then each stretch moves on by itself. Inside a phase the work is still shared out by portion.
 */
import assert from "node:assert/strict";
import type { DcsIssue } from "@ip-lms/dcs-client";
import { cutsOfChapter, longChapters, normalizeHandoffUnits, splitChapter, suggestedCuts, unitIdOfPortion, unitsOfChapter } from "../src/domain/handoff";
import { normalizeAssignmentsDoc } from "../src/domain/store";
import type { AssignmentsDoc, InventoryDoc, Portion, ProjectTask } from "../src/domain/types";
import { waitBlocks } from "../src/domain/waits";
import { encodeWorkOrderMarker, planUnassignedLots, type WorkOrder } from "../src/domain/workOrder";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const portion = (chapter: number, id: string, from: number, to: number): Portion =>
  ({
    id,
    ref: `${chapter}:${from}-${to}`,
    chapter,
    verses: Array.from({ length: to - from + 1 }, (_, i) => from + i),
    tpl: 1, tps: 1, notas: 0, preguntas: 0,
    tplItems: [{ id: `tpl:${id}`, ref: `${chapter}:${from}-${to}`, chapter, portionId: id, resource: "tpl" }],
    tpsItems: [], notasItems: [], preguntasItems: [], academia: [], palabras: [],
  }) as unknown as Portion;

// Psalm-119-like: chapter 3 is long (four portions); chapters 1 and 2 are ordinary.
const inventory = {
  book: "PSA",
  portions: [portion(1, "c1p1", 1, 6), portion(2, "c2p1", 1, 7), portion(2, "c2p2", 8, 12), portion(3, "c3p1", 1, 8), portion(3, "c3p2", 9, 16), portion(3, "c3p3", 17, 24), portion(3, "c3p4", 25, 32)],
  articles: [],
} as unknown as InventoryDoc;
const chapter3 = ["c3p1", "c3p2", "c3p3", "c3p4"];

test("sin partir nada, cada capítulo es una unidad", () => {
  assert.equal(unitIdOfPortion(undefined, "c2p2", 2), "chapter:2");
  assert.deepEqual(unitsOfChapter(undefined, 3, chapter3).map((u) => [u.id, u.portionIds.length]), [["chapter:3", 4]]);
  assert.deepEqual(cutsOfChapter(undefined, 3, chapter3), []);
});

test("un capítulo largo se parte en tramos, y volver a unirlo lo deja como estaba", () => {
  const units = splitChapter(undefined, 3, chapter3, [1]);
  assert.deepEqual(units.map((u) => u.portionIds), [["c3p1", "c3p2"], ["c3p3", "c3p4"]]);
  assert.deepEqual(cutsOfChapter(units, 3, chapter3), [1]);
  assert.equal(unitIdOfPortion(units, "c3p3", 3), "chapter:3:2");
  assert.deepEqual(unitsOfChapter(units, 3, chapter3).map((u) => u.label), ["Capítulo 3 · parte 1", "Capítulo 3 · parte 2"]);
  assert.deepEqual(splitChapter(units, 3, chapter3, []), [], "sin cortes, el capítulo vuelve a ser una unidad");
});

test("partir un capítulo no toca los cortes de otro: puede ser mixto", () => {
  const first = splitChapter(undefined, 3, chapter3, [0, 2]);
  const both = splitChapter(first, 2, ["c2p1", "c2p2"], [0]);
  assert.equal(both.length, 5);
  assert.deepEqual(cutsOfChapter(both, 3, chapter3), [0, 2]);
  assert.deepEqual(cutsOfChapter(both, 2, ["c2p1", "c2p2"]), [0]);
  assert.deepEqual(cutsOfChapter(both, 1, ["c1p1"]), []);
});

test("lo guardado se lee bien: una porción pertenece a una sola unidad y lo vacío se descarta", () => {
  const units = normalizeHandoffUnits([
    { id: "a", portionIds: ["x", "y"] },
    { id: "b", portionIds: ["y", "z"] },
    { id: "a", portionIds: ["w"] },
    { id: "c", portionIds: [] },
  ]);
  assert.deepEqual(units, [{ id: "a", portionIds: ["x", "y"] }, { id: "b", portionIds: ["z"] }]);
  const doc = normalizeAssignmentsDoc({ schema: "gateway-assignments-2", projectId: "PSA", settings: { handoffUnits: units }, workflowId: "w", workflowVersion: 3 }, { lang: "es-419", book: "PSA", contentOrg: "o", pmOrg: "o" } as never);
  assert.equal(doc.settings?.handoffUnits?.length, 2);
  assert.equal(doc.workflowVersion, 3, "el proyecto recuerda la versión de su plantilla");
});

// ---------------------------------------------------------------- the subtareas of a task that works by unit
const byUnit = { id: "afinar", name: "Afinar", description: "", phaseId: "p2", memberIds: [], scope: ["tpl"], rules: [{ resource: "tpl", articleFilter: "all" }], bundle: { enabled: true, grain: "chapter" }, distributeUnit: "chapter", distributePolicy: "manual", waitsFor: [{ taskId: "traducir", scope: "chapter" }] } as unknown as ProjectTask;
const byPortion = { id: "traducir", name: "Traducir", description: "", phaseId: "p1", memberIds: [], scope: ["tpl"], rules: [{ resource: "tpl", articleFilter: "all" }] } as unknown as ProjectTask;

test("una tarea que trabaja por unidad tiene una subtarea por capítulo, y una por tramo donde el capítulo se partió", () => {
  const whole = planUnassignedLots(byUnit, inventory, "PSA", {});
  assert.deepEqual(whole.map((o) => o.portionIds.length), [1, 2, 4]);
  const units = splitChapter(undefined, 3, chapter3, [1]);
  const split = planUnassignedLots(byUnit, inventory, "PSA", { handoffUnits: units });
  assert.deepEqual(split.map((o) => o.portionIds), [["c1p1"], ["c2p1", "c2p2"], ["c3p1", "c3p2"], ["c3p3", "c3p4"]]);
  const each = planUnassignedLots(byPortion, inventory, "PSA", { handoffUnits: units });
  assert.equal(each.length, 7, "dentro de la fase, Traducción sigue repartida por porción");
});

// ---------------------------------------------------------------- waiting, unit by unit
let n = 0;
const issueOf = (order: WorkOrder, taskId: string): DcsIssue =>
  ({ id: ++n, number: n, title: `PSA ${order.label}`, state: "open", body: encodeWorkOrderMarker(order), labels: [{ name: `pm/tarea:${taskId}` }, { name: `pm/cap:${order.chapter}` }], assignee: null, assignees: [] }) as unknown as DcsIssue;

test("cada tramo pasa solo a la fase siguiente: el segundo no frena al primero", () => {
  const units = splitChapter(undefined, 3, chapter3, [1]);
  const board = { teams: [byPortion, byUnit], phases: [], settings: { handoffUnits: units } } as unknown as AssignmentsDoc;
  const translate = planUnassignedLots(byPortion, inventory, "PSA", { handoffUnits: units }).filter((o) => o.chapter === 3).map((o) => issueOf(o, "traducir"));
  const tune = planUnassignedLots(byUnit, inventory, "PSA", { handoffUnits: units }).filter((o) => o.chapter === 3).map((o) => issueOf(o, "afinar"));
  const [part1, part2] = tune as [DcsIssue, DcsIssue];
  const all = [...translate, ...tune];
  assert.equal(waitBlocks(part1, board, all).length, 1, "el tramo 1 espera a su Traducción");
  const firstHalfDone = all.filter((i) => !translate.slice(0, 2).includes(i));
  assert.equal(waitBlocks(part1, board, firstHalfDone).length, 0, "traducidas sus dos porciones, el tramo 1 arranca");
  assert.equal(waitBlocks(part2, board, firstHalfDone).length, 1, "el tramo 2 sigue esperando a las suyas");

  // The same chapter, not split: one unit waits for the four portions.
  const wholeBoard = { teams: [byPortion, byUnit], phases: [] } as unknown as AssignmentsDoc;
  const wholeTune = issueOf(planUnassignedLots(byUnit, inventory, "PSA", {}).find((o) => o.chapter === 3)!, "afinar");
  assert.equal(waitBlocks(wholeTune, wholeBoard, [...firstHalfDone.filter((i) => !tune.includes(i)), wholeTune]).length, 1, "sin partir, el capítulo espera a todas sus porciones");
});

test("un capítulo que pasa del máximo de versículos se sugiere partir, en tramos parejos y sin pasarse", () => {
  assert.deepEqual(suggestedCuts([10, 10, 10], 40), [], "si cabe entero no se parte");
  assert.deepEqual(suggestedCuts([10, 12, 9, 11, 10], 40), [1], "52 versículos: dos tramos de 22 y 30, no 40 y 12");
  assert.deepEqual(suggestedCuts([20, 20, 20, 20, 20, 16], 40), [1, 3], "116 versículos: tres tramos de 40, 40 y 36");
  assert.deepEqual(suggestedCuts([50, 5], 40), [0], "una porción más larga que el máximo queda sola");
  assert.deepEqual(suggestedCuts([60], 40), [], "con una sola porción no hay dónde cortar");
  const portion = (chapter: number, index: number, verses: number) => ({ id: `c${chapter}p${index}`, ref: `${chapter}:${index}`, chapter, verses: Array.from({ length: verses }, (_, i) => i + 1) });
  const portions = [portion(1, 1, 20), portion(2, 1, 25), portion(2, 2, 25), portion(3, 1, 30), portion(3, 2, 30)];
  assert.deepEqual(longChapters(portions, undefined, 40).map((row) => [row.chapter, row.verses, row.cuts]), [[2, 50, [0]], [3, 60, [0]]]);
  const split = splitChapter(undefined, 2, ["c2p1", "c2p2"], [0]);
  assert.deepEqual(longChapters(portions, split, 40).map((row) => row.chapter), [3], "el que ya se partió no se vuelve a sugerir");
  assert.deepEqual(longChapters(portions, undefined, 60), [], "y el máximo lo dice el proyecto");
});

console.log(`\nverify-handoff: ${passed} checks passed.`);
