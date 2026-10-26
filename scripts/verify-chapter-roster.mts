/** The list of a chapter's helps: where each stands for the person looking, by section, and where help is needed. */
import assert from "node:assert/strict";
import { nextNeeding, rosterCounts, rosterOf, sectionsOf, type RosterRow } from "../src/domain/chapterRoster";
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

test("cada ítem dice dónde está para quien mira: lista, te toca, esperando a otros, sin revisar", () => {
  const rows = rosterOf({ items, summary, sections });
  assert.deepEqual(rows.map((r) => r.status), ["ready", "mine", "waiting", "unread"]);
  assert.deepEqual(rows.map((r) => r.section), ["1:1-4", "1:1-4", "1:5-6", "1:5-6"]);
  assert.deepEqual(rows.map((r) => [r.chapter, r.verse]), [[1, 2], [1, 3], [1, 5], [1, 6]]);
  assert.deepEqual(rows[0]!.voices, ["ana", "bea", "carla"]);
});

test("una sección sin ítems no aparece, y un tramo deja fuera lo que no es suyo", () => {
  const withEmpty = rosterOf({ items, summary, sections: sectionsOf(["1:1-4", "1:5-6", "1:7-9"], 1) });
  assert.ok(!withEmpty.some((r) => r.section === "1:7-9"));
  const stretch = rosterOf({ items, summary, sections: sectionsOf(["1:5-6"], 1) });
  assert.deepEqual(stretch.map((r) => r.itemId), ["n5", "n6"]);
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

console.log(`\nverify-chapter-roster: ${passed} checks passed.`);
