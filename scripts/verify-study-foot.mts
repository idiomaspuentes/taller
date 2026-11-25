/**
 * «Estudiar» (Fase 1, C1): the way on is one button always in view at the foot, and the notes do not repeat the
 * introductions already read.
 */
import assert from "node:assert/strict";
import { notesToStudy, studyFoot } from "../src/domain/studyFoot";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const parts = ["book", "chapter", "passage", "notes"];

test("con partes sin leer, el botón es leer la abierta", () => {
  assert.deepEqual(studyFoot({ parts, read: new Set(["book"]), open: "passage", done: false }), { kind: "read", part: "passage" });
});

test("con la abierta ya leída, lleva a la primera sin leer sin marcarla", () => {
  assert.deepEqual(studyFoot({ parts, read: new Set(["book", "passage"]), open: "passage", done: false }), { kind: "goto", part: "chapter" });
  assert.deepEqual(studyFoot({ parts, read: new Set(), open: null, done: false }), { kind: "goto", part: "book" }, "sin parte abierta, la primera");
  assert.deepEqual(studyFoot({ parts, read: new Set(), open: "apuntes", done: false }), { kind: "goto", part: "book" }, "con «Apuntes» abierto, nada se da por leído");
});

test("todo leído: terminar", () => {
  assert.deepEqual(studyFoot({ parts, read: new Set(parts), open: "notes", done: false }), { kind: "finish" });
});

test("el paso ya hecho: volver", () => {
  assert.deepEqual(studyFoot({ parts, read: new Set(), open: "book", done: true }), { kind: "back" });
  assert.deepEqual(studyFoot({ parts, read: new Set(parts), open: "book", done: true }), { kind: "back" });
});

test("las notas no repiten las introducciones", () => {
  const rows = [{ ref: "front:intro" }, { ref: "1:intro" }, { ref: "1:1" }, { ref: "1:3-4" }, { ref: "1:INTRO " }, { ref: "1:intro · v1fp" }, { ref: "front:intro · abcd" }, { ref: "1:2 · x7k2" }];
  assert.deepEqual(notesToStudy(rows), [{ ref: "1:1" }, { ref: "1:3-4" }, { ref: "1:2 · x7k2" }]);
});

console.log(`\n${passed} pruebas pasaron.`);
