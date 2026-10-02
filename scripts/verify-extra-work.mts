/**
 * What whoever prepares a project adds to what the process lays out: subtareas by hand, and portions cut their way.
 *
 *   npm run verify:extra-work
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addExtraWork, cutAt, extraWorkOrders, joinWithNext, normalizeExtraWork, normalizePortionStarts, portionStartsOfBook, portionsMatchStarts, removeExtraWork, startsOf, withPortionStarts, withoutPortionStarts } from "../src/domain/extraWork";
import { addTask, boardWithPlan, planOfBoard } from "../src/domain/plan";
import { shippedWorkflows } from "../src/domain/processes";
import { normalizeInventory } from "../src/domain/store";
import type { AssignmentsDoc, InventoryDoc } from "../src/domain/types";
import { indexWorkIssues, parseWorkOrderMarker, planKeeps, publishableWorkOrders, workOrderIssueBody } from "../src/domain/workOrder";
import { applyWorkflowToBoard } from "../src/domain/workflows";
import { runPrep } from "../src/prep/index";
import { statusToDict } from "../src/status/emit";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "prep", "__fixtures__");
const read = (name: string) => readFileSync(join(fixtures, name), "utf-8");
const prep = (portionStarts?: Record<number, number[]>) =>
  runPrep({ book: "TIT", ultText: read("57-TIT-sample.usfm"), ultPath: "TIT", tn: { path: "tn_TIT.tsv", text: read("tn_TIT.tsv") }, tq: { path: "tq_TIT.tsv", text: read("tq_TIT.tsv") }, twl: { path: "twl_TIT.tsv", text: read("twl_TIT.tsv") }, portionStarts });
// The second half of reading a book (the state of its articles) needs the network; with no articles it is only a shape.
const inventory = (starts?: Record<number, number[]>): InventoryDoc =>
  normalizeInventory(statusToDict([], { book: "TIT", dcs: { base: "", org: "", ta_repo: "", tw_repo: "", branch: "", fetch: "contents" }, subjects: {}, prep: prep(starts) } as never) as never);

const empty = { projectId: "TIT", book: "TIT", books: ["TIT"], teams: [], phases: [], people: [], assignments: [] } as unknown as AssignmentsDoc;
const board = applyWorkflowToBoard(empty, shippedWorkflows()[0]!);

test("las porciones de un capítulo se cortan donde el proyecto dice, sin perder ni mover versículos", () => {
  const base = inventory();
  const chapter = base.portions.find((portion) => base.portions.filter((p) => p.chapter === portion.chapter).length > 1 && portion.verses.length > 1)!.chapter;
  const own = base.portions.filter((portion) => portion.chapter === chapter);
  const starts = startsOf(own);
  const joined = inventory({ [chapter]: joinWithNext(starts, 0) }).portions.filter((portion) => portion.chapter === chapter);
  assert.equal(joined.length, own.length - 1);
  assert.deepEqual(joined[0]!.verses, [...own[0]!.verses, ...own[1]!.verses]);
  assert.deepEqual(joined.flatMap((p) => p.verses), own.flatMap((p) => p.verses));
  assert.equal(joined[0]!.notas, own[0]!.notas + own[1]!.notas, "y las notas de las dos van con la porción unida");
  const long = own.find((portion) => portion.verses.length > 1)!;
  const middle = long.verses[1]!;
  const cut = inventory({ [chapter]: cutAt(starts, middle) }).portions.filter((portion) => portion.chapter === chapter);
  assert.equal(cut.length, own.length + 1);
  assert.ok(cut.some((portion) => portion.verses[0] === middle));
  assert.deepEqual(cut.flatMap((p) => p.verses), own.flatMap((p) => p.verses));
  const other = base.portions.filter((portion) => portion.chapter !== chapter);
  assert.deepEqual(
    inventory({ [chapter]: cutAt(starts, middle) }).portions.filter((portion) => portion.chapter !== chapter).map((p) => p.ref),
    other.map((p) => p.ref),
    "los demás capítulos no cambian",
  );
});

test("los cortes se guardan por libro y capítulo, y se sabe si el libro se leyó con ellos", () => {
  const base = inventory();
  const chapter = base.portions.find((portion) => base.portions.filter((p) => p.chapter === portion.chapter).length > 1)!.chapter;
  const starts = joinWithNext(startsOf(base.portions.filter((p) => p.chapter === chapter)), 0);
  const settings = withPortionStarts(undefined, "tit", chapter, starts);
  assert.deepEqual(portionStartsOfBook(settings, "TIT"), { [chapter]: starts });
  assert.equal(portionsMatchStarts(settings, base), false, "el inventario viejo ya no vale");
  assert.equal(portionsMatchStarts(settings, inventory({ [chapter]: starts })), true);
  assert.deepEqual(withoutPortionStarts(settings, "TIT", chapter), {});
  assert.deepEqual(normalizePortionStarts({ tit: { "1": [5, 1, 5, "x"], "0": [1] } }), { TIT: { "1": [1, 5] } });
});

test("una subtarea añadida a mano sigue a su tarea y se publica junto a las del libro", () => {
  const withGeneral = boardWithPlan(board, addTask(planOfBoard(board), board.phases[0]!.id, "Reunión de arranque").plan);
  const general = withGeneral.teams.find((task) => task.name === "Reunión de arranque")!;
  const inv = inventory();
  const portion = inv.portions[0]!;
  let settings = addExtraWork(withGeneral.settings, { taskId: general.id, title: "Leer juntos la introducción" });
  settings = addExtraWork(settings, { taskId: withGeneral.teams[0]!.id, title: "Segunda mirada", portionId: portion.id });
  settings = addExtraWork(settings, { taskId: "no-existe", title: "Huérfana" });
  const doc = { ...withGeneral, settings };
  const extra = extraWorkOrders(doc, inv);
  assert.equal(extra.length, 2, "la de una tarea que ya no existe no se publica");
  assert.deepEqual([extra[0]!.resource, extra[0]!.chapter, extra[0]!.portionIds, extra[0]!.label], ["bundle", 0, [], "Leer juntos la introducción"]);
  assert.deepEqual([extra[1]!.resource, extra[1]!.chapter, extra[1]!.portionIds], [withGeneral.teams[0]!.rules[0]!.resource, portion.chapter, [portion.id]]);
  assert.ok(extra[1]!.label.endsWith("· Segunda mirada"));
  const all = publishableWorkOrders(doc, inv);
  assert.equal(all.length, publishableWorkOrders(withGeneral, inv).length + 2);
  assert.equal(new Set(all.map((order) => order.key)).size, all.length, "ninguna comparte clave con otra");
});

test("volver a publicar no duplica una subtarea a mano, y quitarla la retira del plan", () => {
  const settings = addExtraWork(board.settings, { taskId: board.teams[0]!.id, title: "Segunda mirada" });
  const doc = { ...board, settings };
  const inv = inventory();
  const [order] = extraWorkOrders(doc, inv);
  const issue = { body: workOrderIssueBody(order!) };
  assert.equal(indexWorkIssues([issue]).find(order!), issue);
  const marker = parseWorkOrderMarker(issue.body)!;
  assert.equal(planKeeps(publishableWorkOrders(doc, inv))(marker), true);
  const without = { ...board, settings: removeExtraWork(settings, settings.extraWork![0]!.id) };
  assert.equal(planKeeps(publishableWorkOrders(without, inv))(marker), false);
  assert.equal(without.settings.extraWork, undefined);
});

test("lo que se guarda de las subtareas a mano se lee limpio", () => {
  assert.deepEqual(normalizeExtraWork([{ id: "a", taskId: "t", title: " Uno " }, { id: "a", taskId: "t", title: "Repetida" }, { id: "b", taskId: "", title: "Sin tarea" }, null]), [{ id: "a", taskId: "t", title: "Uno" }]);
  assert.equal(normalizeExtraWork([]), undefined);
  assert.deepEqual(addExtraWork(undefined, { taskId: "t", title: "  " }), {}, "sin título no se añade");
});

console.log(`\nverify-extra-work: ${passed} checks passed.`);
