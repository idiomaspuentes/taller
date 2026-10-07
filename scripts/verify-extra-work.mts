/**
 * What whoever prepares a project adds to what the process lays out: subtareas by hand, and portions cut their way.
 *
 *   npm run verify:extra-work
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { correctionOutcome, correctionRows, refOfAsk } from "../src/domain/corrections";
import { addExtraWork, askedFrom, cutAt, extraItemId, extraWorkOf, extraWorkOrders, joinWithNext, normalizeExtraWork, normalizePortionStarts, portionStartsOfBook, portionsMatchStarts, removeExtraWork, startsOf, withoutGonePortions, withPortionStarts, withoutPortionStarts } from "../src/domain/extraWork";
import { selectTsvRowsForPortion } from "../src/domain/helpsDraft";
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

test("al cortar de nuevo las porciones de un proyecto en marcha, lo que alguien tenía de una porción que ya no existe sale del plan", () => {
  const base = inventory();
  const chapter = base.portions.find((portion) => base.portions.filter((p) => p.chapter === portion.chapter).length > 1)!.chapter;
  const own = base.portions.filter((portion) => portion.chapter === chapter);
  const elsewhere = base.portions.find((portion) => portion.chapter !== chapter)!;
  const task = board.teams.find((team) => !team.waitsFor?.length && team.rules.some((rule) => rule.resource === "tpl"))!;
  const has = (ref: string, n: number) => ({ id: `a${n}`, person: "ana", personId: "ana", teamId: task.id, itemType: "porcion" as const, itemId: ref, note: "", state: "en curso" as const });
  // Ana has the first portion of the chapter and one of another chapter; the first is joined with the second.
  const planned: AssignmentsDoc = { ...board, people: [{ id: "ana", name: "Ana" }] as AssignmentsDoc["people"], assignments: [has(own[0]!.ref, 1), has(elsewhere.ref, 2)] };
  const cut = inventory({ [chapter]: joinWithNext(startsOf(own), 0) });
  const ofTask = (doc: AssignmentsDoc) => publishableWorkOrders(doc, cut).filter((order) => order.teamId === task.id);
  const after = withoutGonePortions(planned, cut);
  assert.deepEqual(after.assignments.map((row) => row.itemId), [elsewhere.ref], "la porción que sigue existiendo se conserva con quien la tiene");
  assert.equal(ofTask(after).length, cut.portions.length, "una subtarea por porción, ni una más");
  assert.equal(ofTask(after).filter((order) => order.assignee).length, 1);
  assert.equal(withoutGonePortions(after, cut), after, "sin nada que quitar, el plan es el mismo");
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

test("las notas de introducción son trabajo de alguien: las del libro y las del capítulo van con la primera porción", () => {
  const base = inventory();
  const chapterOne = base.portions.filter((portion) => portion.chapter === 1).sort((a, b) => a.verses[0]! - b.verses[0]!);
  const ids = (portion: (typeof chapterOne)[number]) => portion.notasItems.map((item) => item.id);
  assert.deepEqual(ids(chapterOne[0]!).slice(0, 2), ["m2jl", "abc1"], "la introducción al libro y la del capítulo 1, antes de las notas de sus versículos");
  assert.equal(chapterOne[0]!.notas, chapterOne[0]!.notasItems.length, "y cuentan en el tamaño de la subtarea");
  for (const other of base.portions.filter((portion) => portion !== chapterOne[0])) {
    assert.ok(!ids(other).includes("m2jl") && !ids(other).includes("abc1"), `${other.ref}: una sola porción las lleva`);
  }
  // Whoever opens the notes of that passage gets them; whoever opens the next passage does not.
  const rows = [
    { Reference: "front:intro", ID: "m2jl" },
    { Reference: "1:intro", ID: "abc1" },
    { Reference: `1:${chapterOne[0]!.verses[0]}`, ID: "v1" },
  ];
  const launch = (portion: (typeof chapterOne)[number]) => ({ resource: "notas", portionIds: [portion.id], itemIds: [`porcion:${portion.ref}`], ref: portion.ref, chapter: 1 }) as never;
  assert.deepEqual(selectTsvRowsForPortion(rows, launch(chapterOne[0]!), base).map((row) => row.ID), ["m2jl", "abc1", "v1"]);
  if (chapterOne[1]) assert.deepEqual(selectTsvRowsForPortion(rows, launch(chapterOne[1]), base).map((row) => row.ID), []);
});

test("una corrección que pide un comité va a su versículo, y recuerda quién la pidió y desde dónde", () => {
  assert.equal(refOfAsk({ where: "1:12 «arrecifes ocultos»" }), "1:12");
  assert.equal(refOfAsk({ where: "1:3 §x7k2" }), "1:3");
  assert.equal(refOfAsk({ where: "" }), undefined);
  const inv = inventory();
  const committee = board.teams[board.teams.length - 1]!;
  const resource = board.teams.find((task) => task.id !== committee.id && task.rules.length)!.rules[0]!.resource;
  const portion = inv.portions.find((p) => p.verses.length > 1)!;
  const verse = `${portion.chapter}:${portion.verses[1]}`;
  const asks = [
    { about: resource, where: `${verse} «algo»`, text: "No se entiende.", by: "hulda" },
    { about: resource, where: "", text: "Revisar el tono de todo el libro.", by: "natan" },
  ];
  const { settings, added } = correctionRows(board, committee, asks, portion.id, 145);
  assert.equal(added.length, 2);
  assert.deepEqual([added[0]!.ref, added[0]!.askedBy, added[0]!.askedIn, added[0]!.portionId], [verse, "hulda", 145, portion.id]);
  assert.equal(added[1]!.ref, undefined, "la que no nombra un versículo es de la porción entera");
  const orders = extraWorkOrders({ ...board, settings }, inv);
  assert.ok(orders[0]!.label.startsWith(`${verse} · Corrección`), `la subtarea se llama por su versículo, que es lo que abren sus herramientas: ${orders[0]!.label}`);
  assert.deepEqual(orders[0]!.portionIds, [portion.id], "y sigue siendo de su porción");
  assert.ok(!orders[1]!.label.startsWith(`${verse} ·`));
  assert.deepEqual(normalizeExtraWork(JSON.parse(JSON.stringify(settings.extraWork))), settings.extraWork, "se guarda y se lee completa");
  assert.equal(correctionRows({ ...board, settings }, committee, asks, portion.id, 145).added.length, 0, "pedir otra vez lo mismo no crea nada");
});

test("de lo que se pidió desde una subtarea se sabe qué sigue en curso y qué volvió", () => {
  const settings = { extraWork: [{ id: "a", taskId: "t", title: "Una", askedIn: 145 }, { id: "b", taskId: "t", title: "Otra", askedIn: 145 }, { id: "c", taskId: "t", title: "De otra", askedIn: 9 }, { id: "d", taskId: "t", title: "A mano" }] };
  assert.deepEqual(askedFrom(settings, 145, [extraItemId("a"), extraItemId("c")]).map((row) => [row.row.id, row.open]), [["a", true], ["b", false]]);
  assert.deepEqual(askedFrom(settings, 7, []), []);
  assert.equal(extraWorkOf(settings, ["porcion:1:1-4", extraItemId("b")])?.title, "Otra");
  assert.equal(extraWorkOf(settings, ["porcion:1:1-4"]), undefined);
});

test("terminada una corrección, se le dice a quien la pidió qué respondieron y si faltan otras", () => {
  const say = (key: string) => ({ "cx.attended": "Se atendió: «{title}».", "cx.attendedSaid": "{who} respondió: «{text}»", "cx.stillOpen": "Faltan {n}.", "cx.allBack": "Ya volvieron todas." })[key]!;
  const row = { title: "Corrección 1:12: no se entiende", askedBy: "hulda" };
  const comments = [
    { body: "@abigail ¿lo miras tú?", by: "tomas" },
    { body: "**JUD 1:12** — @abigail @hulda El TPL es literal; la nota y el TPS lo explican.", by: "tomas" },
    { body: "@abigail Todo quedó de acuerdo: ya se puede cerrar la revisión.\n<!-- gt:mientras-abierta -->", by: "tomas" },
  ];
  assert.equal(correctionOutcome(row, comments, 0, say), "@hulda Se atendió: «Corrección 1:12: no se entiende». tomas respondió: «**JUD 1:12** — El TPL es literal; la nota y el TPS lo explican.» Ya volvieron todas.");
  assert.equal(correctionOutcome({ title: "Otra" }, [], 2, say), "Se atendió: «Otra». Faltan 2.", "sin nadie a quien nombrar ni nada dicho, se avisa igual");
});

console.log(`\nverify-extra-work: ${passed} checks passed.`);
