/** The list of a chapter's helps: where each stands for the person looking, by section, and where help is needed. */
import assert from "node:assert/strict";
import { inSections, nextNeeding, rosterCounts, rosterFilters, rosterOf, searchRoster, sectionsOf, type RosterRow } from "../src/domain/chapterRoster";
import type { CheckItem, CheckItemTally, CheckSlot, ChecklistSummary, CheckTurn } from "../src/domain/checklist";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const slot = (voices: string[]): CheckSlot => ({ yesBy: voices, open: [], disputed: [], decided: false, voices, settled: false });
const tally = (itemId: string, state: CheckItemTally["state"], turn?: CheckTurn, voices: string[] = []): CheckItemTally => ({
  itemId,
  state,
  answers: {},
  slots: { sentido: slot(voices) },
  ...(turn ? { turn } : {}),
  changed: false,
});
const summaryOf = (items: CheckItemTally[]): ChecklistSummary => ({ items, done: items.filter((i) => i.state === "ok").length, complete: false, open: [], consulting: [], changed: [] });

const items: CheckItem[] = [
  { id: "n2", verseKey: "1:2" },
  { id: "n3", verseKey: "1:3" },
  { id: "n5", verseKey: "1:5" },
  { id: "n6", verseKey: "1:6" },
];
const summary = summaryOf([
  tally("n2", "ok", "done", ["ana", "bea", "carla"]),
  tally("n3", "pending", "mine", ["bea"]),
  tally("n5", "pending", "waiting", ["ana"]),
  tally("n6", "pending", "new"),
]);
const sections = sectionsOf(["1:1-4", "1:5-6"], 1);

test("las secciones salen de las porciones de la subtarea", () => {
  assert.deepEqual(sections, [
    { ref: "1:1-4", from: 1, to: 4 },
    { ref: "1:5-6", from: 5, to: 6 },
  ]);
  assert.deepEqual(sectionsOf(["1:1-4", "EST-x"], 1), [{ ref: "1:1-4", from: 1, to: 4 }], "un id que no es referencia se ignora");
  assert.deepEqual(sectionsOf(["EST-x"], 1), [{ ref: "1", from: 1, to: 200 }], "sin referencias, el capítulo entero");
});

test("una porción dada por su id se busca en el inventario", () => {
  const portions = [{ id: "EST-01-01", ref: "EST 1:1-4" }, { id: "EST-01-02", ref: "EST 1:5-6" }];
  assert.deepEqual(sectionsOf(["EST-01-01", "EST-01-02"], 1, portions), [
    { ref: "1:1-4", from: 1, to: 4 },
    { ref: "1:5-6", from: 5, to: 6 },
  ]);
  assert.deepEqual(sectionsOf(["EST-01-09"], 1, portions), [{ ref: "1", from: 1, to: 200 }], "un id que no está en el inventario no da sección");
});

test("cada ítem dice dónde está para quien mira: lista, te toca, esperando a otros, sin revisar", () => {
  const rows = rosterOf({ items, summary, sections });
  assert.deepEqual(rows.map((r) => r.status), ["ready", "mine", "waiting", "unread"]);
  assert.deepEqual(rows.map((r) => r.section), ["1:1-4", "1:1-4", "1:5-6", "1:5-6"]);
  assert.deepEqual(rows.map((r) => [r.chapter, r.verse]), [[1, 2], [1, 3], [1, 5], [1, 6]]);
  assert.deepEqual(rows[0]!.voices, ["ana", "bea", "carla"]);
});

test("lo que alguien empezó y no terminó le toca a esa persona", () => {
  const started = summaryOf([tally("n2", "pending", "new", ["ana"])]);
  const rows = rosterOf({ items: [items[0]!], summary: started, sections, me: "Ana" });
  assert.equal(rows[0]!.status, "mine");
  assert.equal(rosterOf({ items: [items[0]!], summary: started, sections, me: "bea" })[0]!.status, "unread");
});

test("una sección sin ítems no aparece, y un tramo deja fuera lo que no es suyo", () => {
  const withEmpty = rosterOf({ items, summary, sections: sectionsOf(["1:1-4", "1:5-6", "1:7-9"], 1) });
  assert.ok(!withEmpty.some((r) => r.section === "1:7-9"));
  const stretch = rosterOf({ items, summary, sections: sectionsOf(["1:5-6"], 1) });
  assert.deepEqual(stretch.map((r) => r.itemId), ["n5", "n6"]);
});

test("la subtarea de un tramo carga solo los ítems de su tramo; la del capítulo entero, todos", () => {
  const portions = [{ id: "EST-01-01", ref: "EST 1:1-4" }, { id: "EST-01-02", ref: "EST 1:5-6" }];
  const all = [{ id: "a", verse: 2 }, { id: "b", verse: 5 }, { id: "c", verse: 6 }];
  assert.deepEqual(inSections(all, sectionsOf(["EST-01-02"], 1, portions)).map((i) => i.id), ["b", "c"]);
  assert.deepEqual(inSections(all, sectionsOf(["EST-01-01", "EST-01-02"], 1, portions)).map((i) => i.id), ["a", "b", "c"]);
  assert.deepEqual(inSections(all, sectionsOf([], 1, portions)).map((i) => i.id), ["a", "b", "c"], "sin secciones, todo el capítulo");
});

test("un ítem de todo el versículo va en la sección de su versículo", () => {
  const rows = rosterOf({ items: [...items, { id: "verse:1:3", verseKey: "1:3", stop: true }], summary: summaryOf([...summary.items, tally("verse:1:3", "pending", "new")]), sections });
  assert.equal(rows.find((r) => r.itemId === "verse:1:3")!.section, "1:1-4");
});

test("el avance cuenta cada estado y la parte lista", () => {
  assert.deepEqual(rosterCounts(rosterOf({ items, summary, sections })), { ready: 1, mine: 1, waiting: 1, unread: 1, total: 4, readyShare: 0.25 });
  assert.deepEqual(rosterCounts([]), { ready: 0, mine: 0, waiting: 0, unread: 0, total: 0, readyShare: 0 });
});

const row = (itemId: string, verse: number, status: RosterRow["status"], voices: string[] = []): RosterRow => ({ itemId, chapter: 1, verse, section: "1", status, voices });

test("Seguir lleva primero a lo que te toca", () => {
  const rows = rosterOf({ items, summary, sections });
  assert.equal(nextNeeding(rows, { me: "ana", needed: 3 }), "n3");
});

test("Seguir salta lo que ya tiene a las personas que hacen falta, contando a quien está ahora", () => {
  const rows = [row("a", 1, "waiting", ["bea", "carla"]), row("b", 2, "unread"), row("c", 3, "unread")];
  assert.equal(nextNeeding(rows, { me: "ana", needed: 3, present: { a: ["dina"] } }), "b");
  assert.equal(nextNeeding(rows, { me: "ana", needed: 3, present: { a: ["ana"] } }), "a", "la propia persona no cuenta");
});

test("con dos personas ya en una nota que nadie revisó, Seguir lleva a la siguiente", () => {
  const rows = [row("a", 1, "unread", ["bea"]), row("b", 2, "unread")];
  assert.equal(nextNeeding(rows, { me: "ana", needed: 3, present: { a: ["carla", "dina"] } }), "b");
  assert.equal(nextNeeding(rows, { me: "ana", needed: 3, present: { a: ["carla"] } }), "a", "con una sola presente todavía falta gente");
});

test("quien ya respondió y sigue en la nota cuenta una sola vez", () => {
  const rows = [row("a", 1, "waiting", ["bea", "carla"]), row("b", 2, "unread")];
  assert.equal(nextNeeding(rows, { me: "ana", needed: 3, present: { a: ["Bea"] } }), "a");
});

test("si todo está cubierto, Seguir lleva a lo que no revisaste; si revisaste todo, a nada", () => {
  const covered = [row("a", 1, "waiting", ["bea", "carla", "dina"]), row("b", 2, "ready", ["bea", "carla", "dina"])];
  assert.equal(nextNeeding(covered, { me: "ana", needed: 3 }), "a");
  const mineAll = [row("a", 1, "waiting", ["ana"]), row("b", 2, "ready", ["ana"])];
  assert.equal(nextNeeding(mineAll, { me: "ana", needed: 3 }), null);
});

test("Seguir empieza después del ítem en que se está, y da la vuelta", () => {
  const rows = [row("a", 1, "unread"), row("b", 2, "unread"), row("c", 3, "unread")];
  assert.equal(nextNeeding(rows, { me: "ana", needed: 3, after: "a" }), "b");
  assert.equal(nextNeeding(rows, { me: "ana", needed: 3, after: "c" }), "a");
});

test("un filtro aparece solo si tiene algo; con solo «Todas» no hay fila de filtros", () => {
  const counts = (mine: number, unread: number) => rosterCounts([...Array.from({ length: mine }, (_, i) => row(`m${i}`, 1, "mine")), ...Array.from({ length: unread }, (_, i) => row(`u${i}`, 2, "unread")), row("w", 3, "waiting")]);
  assert.deepEqual(rosterFilters(counts(1, 8)), ["all", "mine", "unread"]);
  assert.deepEqual(rosterFilters(counts(0, 8)), ["all", "unread"]);
  assert.deepEqual(rosterFilters(counts(2, 0)), ["all", "mine"]);
  assert.deepEqual(rosterFilters(counts(0, 0)), [], "«Esperando a otros» nunca es filtro");
});

test("el buscador encuentra por id, por versículo o por las palabras, sin importar mayúsculas ni tildes", () => {
  const rows = [row("jd31", 19, "mine"), row("asf1", 10, "unread"), row("qey5", 1, "ready"), row("b7k2", 12, "unread")];
  const words: Record<string, string> = { jd31: "Memucán se dirige al rey", asf1: "cuando el corazón del rey", qey5: "Y sucedió", b7k2: "Pero la reina Vasti se negó a ir" };
  const ids = (query: string) => searchRoster(rows, query, (id) => words[id] ?? "").map((r) => r.itemId);
  assert.deepEqual(ids("JD31"), ["jd31"]);
  assert.deepEqual(ids(" jd3"), ["jd31"], "un id a medio escribir ya filtra");
  assert.deepEqual(ids("1:1"), ["qey5"], "un versículo es ese versículo, no 1:10 ni 1:19");
  assert.deepEqual(ids("corazon"), ["asf1"]);
  assert.deepEqual(ids("negó"), ["b7k2"]);
  assert.deepEqual(ids("rey"), ["jd31", "asf1"]);
  assert.deepEqual(ids(""), ["jd31", "asf1", "qey5", "b7k2"], "sin nada escrito, todas");
  assert.deepEqual(ids("zzz"), []);
});

test("te toca dice por qué", () => {
  const rows = rosterOf({ items, summary, sections, reasons: new Map([["n3", "Ana propone un cambio"], ["n5", "no se dice"]]) });
  assert.equal(rows.find((row) => row.itemId === "n3")!.reason, "Ana propone un cambio");
  assert.equal(rows.find((row) => row.itemId === "n5")!.reason, undefined, "solo cuando te toca");
  assert.equal(rosterOf({ items, summary, sections })[1]!.reason, undefined);
});

console.log(`\nverify-chapter-roster: ${passed} checks passed.`);
