/**
 * The articles of Academia and Palabras are work of their own: one subtarea for each article that still has to be
 * translated, never one for a passage with several inside, and never the same article twice.
 *
 *   npm run verify:article-work
 */
import assert from "node:assert/strict";
import { shippedWorkflows } from "../src/domain/processes";
import { normalizeInventory } from "../src/domain/store";
import type { AssignmentsDoc, InventoryDoc } from "../src/domain/types";
import { publishableWorkOrders } from "../src/domain/workOrder";
import { applyWorkflowToBoard } from "../src/domain/workflows";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const cite = (...ids: string[]) => ids.map((id) => ({ id, firstSeenInBook: true }));
const portion = (n: number, from: number, to: number, academia: string[], palabras: string[]) => {
  const id = `JUD-01-0${n}`;
  const ref = `JUD 1:${from}-${to}`;
  const items = (resource: string) => [{ id: `${resource}-${id}`, ref, chapter: 1, portionId: id, resource }];
  return {
    id, ref, chapter: 1, verses: Array.from({ length: to - from + 1 }, (_, i) => from + i),
    tpl: 1, tps: 1, notas: 1, preguntas: 1,
    tplItems: items("tpl"), tpsItems: items("tps"), notasItems: items("notas"), preguntasItems: items("preguntas"),
    academia: cite(...academia), palabras: cite(...palabras),
  };
};

/** Three passages. `figs-metaphor` and `grace` are linked from two of them; some are translated already. */
const inventory: InventoryDoc = normalizeInventory({
  book: "JUD",
  portions: [
    portion(1, 1, 2, ["figs-metaphor", "translate-names"], ["grace", "mercy"]),
    portion(2, 3, 4, ["figs-pastforfuture", "figs-metaphor"], ["grace", "age-timeperiod"]),
    portion(3, 5, 6, ["writing-pronouns"], ["mercy"]),
  ],
  articles: [
    { id: "figs-metaphor", kind: "Translation Academy", path: "translate/figs-metaphor", status: "english", title: "Metaphor" },
    { id: "translate-names", kind: "Translation Academy", path: "translate/translate-names", status: "translated", title: "Cómo traducir los nombres" },
    { id: "figs-pastforfuture", kind: "Translation Academy", path: "translate/figs-pastforfuture", status: "english", title: "Predictive Past" },
    { id: "writing-pronouns", kind: "Translation Academy", path: "translate/writing-pronouns", status: "missing" },
    { id: "grace", kind: "Translation Words", path: "bible/kt/grace", status: "english", title: "grace" },
    { id: "mercy", kind: "Translation Words", path: "bible/kt/mercy", status: "translated", title: "misericordia" },
    { id: "age-timeperiod", kind: "Translation Words", path: "bible/other/age-timeperiod", status: "missing" },
  ],
} as never);

const empty = { projectId: "JUD", book: "JUD", books: ["JUD"], teams: [], phases: [], people: [], assignments: [] } as unknown as AssignmentsDoc;
const board = applyWorkflowToBoard(empty, shippedWorkflows()[0]!);
const firstPhase = [...board.phases].sort((a, b) => a.order - b.order)[0]!.id;
/** The translation task of an article resource: the first task of the plan with it. */
const translating = (resource: string) => board.teams.find((task) => task.phaseId === firstPhase && task.rules.some((rule) => rule.resource === resource))!;
const orders = publishableWorkOrders(board, inventory);
const of = (resource: string) => orders.filter((order) => order.teamId === translating(resource).id);

test("cada artículo por traducir es una subtarea, con un solo artículo dentro", () => {
  for (const resource of ["academia", "palabras"]) {
    assert.ok(of(resource).length > 0, `${resource}: hay subtareas`);
    for (const order of of(resource)) assert.equal(order.itemIds.length, 1, `«${order.label}» lleva un solo artículo`);
  }
  assert.deepEqual(of("academia").map((order) => order.itemIds[0]).sort(), ["articulo:figs-metaphor", "articulo:figs-pastforfuture", "articulo:writing-pronouns"]);
  assert.deepEqual(of("palabras").map((order) => order.itemIds[0]).sort(), ["articulo:age-timeperiod", "articulo:grace"]);
});

test("un artículo que enlazan varios pasajes se traduce una sola vez", () => {
  const all = [...of("academia"), ...of("palabras")].map((order) => order.itemIds[0]);
  assert.equal(new Set(all).size, all.length, "sin repeticiones");
  assert.equal(all.filter((id) => id === "articulo:figs-metaphor").length, 1);
  assert.equal(all.filter((id) => id === "articulo:grace").length, 1);
});

test("los artículos ya traducidos no se piden", () => {
  const all = [...of("academia"), ...of("palabras")].map((order) => order.itemIds[0]);
  assert.ok(!all.includes("articulo:translate-names") && !all.includes("articulo:mercy"));
});

test("la subtarea se llama como su artículo, no como un pasaje", () => {
  const byItem = (id: string) => [...of("academia"), ...of("palabras")].find((order) => order.itemIds[0] === `articulo:${id}`)!;
  assert.ok(byItem("figs-pastforfuture").label.startsWith("Predictive Past · "), byItem("figs-pastforfuture").label);
  assert.ok(byItem("writing-pronouns").label.startsWith("writing-pronouns · "), "sin título conocido, por su nombre de archivo");
  for (const order of [...of("academia"), ...of("palabras")]) assert.ok(!/^\d+:\d/.test(order.label), `«${order.label}» no empieza por un pasaje`);
});

test("cada una va con el primer pasaje que enlaza su artículo, para verlo en uso y para saber de qué capítulo es", () => {
  const where = (id: string) => [...of("academia"), ...of("palabras")].find((order) => order.itemIds[0] === `articulo:${id}`)!;
  assert.deepEqual(where("figs-metaphor").portionIds, ["JUD-01-01"]);
  assert.deepEqual(where("figs-pastforfuture").portionIds, ["JUD-01-02"]);
  assert.deepEqual(where("writing-pronouns").portionIds, ["JUD-01-03"]);
  assert.deepEqual(where("age-timeperiod").portionIds, ["JUD-01-02"]);
  assert.equal(where("grace").chapter, 1);
});

test("los textos y las ayudas por versículo siguen siendo una subtarea por pasaje", () => {
  for (const resource of ["tpl", "notas"]) {
    assert.equal(of(resource).length, 3, `${resource}: una por pasaje`);
    for (const order of of(resource)) assert.ok(/^\d+:\d/.test(order.label), `«${order.label}» se llama por su pasaje`);
  }
});

console.log(`\nverify-article-work: ${passed} checks passed.`);
