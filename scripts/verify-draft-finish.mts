/**
 * «Terminé el borrador» with verses still to write (8 November 2026). A translator of Nehemiah looked for a way to
 * save, found none on her phone but «Terminé», and her draft went to review with one verse of three written.
 * The editor now says what is missing before it hands the draft in, and leads to the first of it.
 */
import assert from "node:assert/strict";
import { versesLeft } from "../src/domain/draftFinish";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const row = (from: number, text: string, to = from) => ({ from, to, text });

test("con un versículo escrito de tres, faltan dos y el primero que falta es el 2", () => {
  // NEH 1:1–3 · TPS (#1633), as it was handed in on 6 November.
  assert.deepEqual(versesLeft([row(1, "En el mes de Quisleu…"), row(2, ""), row(3, "")]), { count: 2, first: 2 });
});

test("un versículo con solo espacios o saltos de línea no está escrito", () => {
  assert.deepEqual(versesLeft([row(1, "Uno."), row(2, "  \n "), row(3, "Tres.")]), { count: 1, first: 2 });
});

test("con todo escrito no falta nada, y no hay a dónde llevar", () => {
  assert.deepEqual(versesLeft([row(1, "Uno."), row(2, "Dos.")]), { count: 0, first: undefined });
});

test("versículos unidos cuentan como uno, nombrado por el primero", () => {
  assert.deepEqual(versesLeft([row(1, "Uno."), row(2, "", 3), row(4, "Cuatro.")]), { count: 1, first: 2 });
});

test("sin versículos no falta nada", () => {
  assert.deepEqual(versesLeft([]), { count: 0, first: undefined });
});

console.log(`\n${passed} pruebas pasaron`);
