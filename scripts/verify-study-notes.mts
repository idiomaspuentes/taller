/**
 * Study notes: who sees which, and which ones matter for the passage in hand.
 *
 *   npm run verify:study-notes
 */
import assert from "node:assert/strict";
import { normalizeStudyNotes, notesByResource, studyNotesFor, studyNotesPath, visibleStudyNotes, type StudyNote } from "../src/domain/studyNotes";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const note = (id: string, by: string, shared: boolean, chapter: number, verse?: number, book = "3JN"): StudyNote => ({ id, by, book, chapter, ...(verse ? { verse } : {}), kind: "found", text: id, shared, at: `2026-10-02T10:00:0${id.length}Z` });
const all = [note("a", "ana", false, 1, 2), note("b", "ana", true, 1), note("c", "bea", true, 1, 3), note("d", "bea", false, 1, 1), note("e", "bea", true, 1, 9), note("f", "ana", true, 0), note("g", "ana", true, 2, 1), note("h", "ana", true, 1, 1, "2JN")];

test("cada quien ve sus apuntes y los que los demás compartieron, nunca los privados de otra persona", () => {
  assert.deepEqual(visibleStudyNotes(all, "Ana").map((n) => n.id).sort(), ["a", "b", "c", "e", "f", "g", "h"]);
  assert.deepEqual(visibleStudyNotes(all, "bea").map((n) => n.id).sort(), ["b", "c", "d", "e", "f", "g", "h"]);
  assert.ok(!visibleStudyNotes(all, "carla").some((n) => !n.shared));
});

test("al trabajar un pasaje salen primero sus versículos, luego el capítulo y luego el libro; lo demás no", () => {
  const here = studyNotesFor(visibleStudyNotes(all, "ana"), { book: "3jn", chapter: 1, from: 1, to: 4 });
  assert.deepEqual(here.map((n) => n.id), ["a", "c", "b", "f"]);
  assert.deepEqual(studyNotesFor(all, { book: "3JN", chapter: 1 }).map((n) => n.id).sort(), ["a", "b", "c", "d", "e", "f"], "sin pasaje, todo el capítulo");
  const about = { ...note("p", "ana", true, 1, 5), to: 8 };
  assert.deepEqual(studyNotesFor([about], { book: "3JN", chapter: 1, from: 7, to: 10 }).map((n) => n.id), ["p"], "un apunte de un pasaje sale donde sus versículos se cruzan con los que se trabajan");
  assert.deepEqual(studyNotesFor([about], { book: "3JN", chapter: 1, from: 9, to: 10 }), []);
});

test("cada persona tiene su archivo, y lo que dice un archivo es de su dueño", () => {
  assert.equal(studyNotesPath("es-419", "3jn", "Valeska"), "es-419/3JN/apuntes/valeska.json");
  const read = normalizeStudyNotes({ notes: [{ id: "x", by: "otra", book: "3jn", chapter: 1, text: " Hola ", shared: true }, { id: "x", book: "3JN", chapter: 1, text: "repetida" }, { id: "y", book: "3JN", chapter: 1, text: "" }] }, "valeska");
  assert.deepEqual(read.map((n) => [n.id, n.by, n.book, n.text, n.shared, n.kind]), [["x", "valeska", "3JN", "Hola", true, "found"]]);
  assert.deepEqual(normalizeStudyNotes(null, "valeska"), []);
});

test("los apuntes son del recurso en el que se escribieron: primero los de ese recurso, aparte los de los demás", () => {
  const ofText = { ...note("t", "ana", true, 1, 1), resource: "tpl", resourceName: "TPL", task: "Traducir TPL" };
  const ofNotes = { ...note("n", "bea", true, 1, 1), resource: "notas", resourceName: "Notas", task: "Traducir Notas" };
  const general = note("g", "ana", true, 1);
  const split = notesByResource([ofText, ofNotes, general], "TPL");
  assert.deepEqual([split.own.map((n) => n.id), split.others.map((n) => n.id)], [["t", "g"], ["n"]]);
  assert.deepEqual(notesByResource([ofText, ofNotes, general], undefined).others, [], "en una tarea de varios recursos se ven todos juntos");
  const read = normalizeStudyNotes({ notes: [{ id: "x", book: "3JN", chapter: 1, text: "a", resource: "NOTAS", resourceName: " Notas ", task: "Traducir Notas" }] }, "bea")[0]!;
  assert.deepEqual([read.resource, read.resourceName, read.task], ["notas", "Notas", "Traducir Notas"]);
});

console.log(`\nverify-study-notes: ${passed} checks passed.`);
