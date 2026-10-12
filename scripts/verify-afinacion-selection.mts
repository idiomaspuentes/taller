/** Marking the words of a verse, and finding them again after the text changed. */
import assert from "node:assert/strict";
import { resolveTextReference } from "@usfm-tools/checking";
import { fillBetween, selectionFromWords, stretchesOf, toggleWord, unmarkedBetween, wordSpans, wordsOfSelection } from "../src/domain/afinacionSelection";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const verse = "con la esperanza de la vida eterna";

test("las palabras se cuentan por espacios y llevan su posición en el texto", () => {
  const spans = wordSpans(verse);
  assert.equal(spans.length, 7);
  assert.deepEqual([spans[2]!.text, spans[2]!.start, spans[2]!.end], ["esperanza", 7, 16]);
});

test("tocar una palabra la marca y volver a tocarla la desmarca, siempre en orden", () => {
  let sel: number[] = [];
  sel = toggleWord(sel, 5);
  sel = toggleWord(sel, 2);
  assert.deepEqual(sel, [2, 5]);
  assert.deepEqual(toggleWord(sel, 2), [5]);
});

test("un toque marca una palabra sola; las de en medio se ofrecen, y se marcan de un toque", () => {
  // Una palabra, otras que no van, y una más: dos toques, y nada entre ellas.
  const apart = toggleWord(toggleWord([], 1), 6);
  assert.deepEqual(apart, [1, 6]);
  assert.equal(unmarkedBetween(apart), 4, "se ofrece marcar las cuatro de en medio");
  // Muchas seguidas: la primera, la última, y lo que se ofrece.
  assert.deepEqual(fillBetween(apart), [1, 2, 3, 4, 5, 6]);
  assert.equal(unmarkedBetween(fillBetween(apart)), 0, "ya no hay nada que ofrecer");
  assert.equal(unmarkedBetween([3]), 0);
  assert.equal(unmarkedBetween([]), 0);
  assert.deepEqual(fillBetween([]), []);
});

test("varios tramos: cuatro palabras, dos que no van y dos más", () => {
  // La primera y la cuarta, lo de en medio, y las otras dos.
  let marked = fillBetween(toggleWord(toggleWord([], 0), 3));
  marked = toggleWord(toggleWord(marked, 6), 7);
  assert.deepEqual(marked, [0, 1, 2, 3, 6, 7]);
  assert.deepEqual(stretchesOf(marked), [{ from: 0, to: 3 }, { from: 6, to: 7 }]);
  assert.equal(unmarkedBetween(marked), 2);

  const long = "uno dos tres cuatro cinco seis siete ocho";
  const kept = selectionFromWords(long, marked, { chapter: 1, verse: 2 })!;
  assert.equal(kept.text, long, "el texto va de la primera a la última, como siempre");
  assert.deepEqual(kept.parts?.map((part) => part.text), ["uno dos tres cuatro", "siete ocho"], "y cada tramo se guarda aparte");
  assert.deepEqual(wordsOfSelection(long, kept), [0, 1, 2, 3, 6, 7], "al volver a abrir, las de en medio no están marcadas");
  assert.equal(selectionFromWords(long, [2, 3], { chapter: 1, verse: 2 })!.parts, undefined, "un solo tramo se guarda como antes");
  // Si el versículo cambió: los tramos se hallan donde estén; si uno ya no está, hay que marcar de nuevo.
  assert.deepEqual(wordsOfSelection(`y ${long}`, kept), [1, 2, 3, 4, 7, 8]);
  assert.deepEqual(wordsOfSelection("uno dos tres cuatro cinco seis siete nueve", kept), []);
  // Una respuesta guardada antes de este cambio, sin tramos, se lee como siempre.
  assert.deepEqual(wordsOfSelection(long, { text: "dos tres", startOffset: 4, endOffset: 12 }), [1, 2]);
});

test("la selección guarda el texto entre la primera y la última palabra y una copia del versículo", () => {
  const s = selectionFromWords(verse, [2, 3], { chapter: 1, verse: 2 })!;
  assert.equal(s.text, "esperanza de");
  assert.deepEqual([s.startOffset, s.endOffset], [7, 19]);
  assert.deepEqual(s.verseSnapshots, [{ chapter: 1, verse: 2, text: verse }]);
  assert.equal(selectionFromWords(verse, [], { chapter: 1, verse: 2 }), undefined);
});

test("al volver a abrir, la selección recupera sus palabras si el texto sigue igual", () => {
  const s = selectionFromWords(verse, [2, 3], { chapter: 1, verse: 2 })!;
  assert.deepEqual(wordsOfSelection(verse, s), [2, 3]);
});

test("si el versículo cambió pero la frase sigue, se encuentra en su nuevo lugar", () => {
  const s = selectionFromWords(verse, [2], { chapter: 1, verse: 2 })!;
  const moved = "y con la esperanza de la vida eterna";
  assert.deepEqual(wordsOfSelection(moved, s), [3]);
  assert.equal(resolveTextReference(s, [{ chapter: 1, verse: 2, text: moved }]).status, "relocated");
});

test("si la frase ya no está, no se marca nada y se sabe que quedó obsoleta", () => {
  const s = selectionFromWords(verse, [2], { chapter: 1, verse: 2 })!;
  const changed = "con la confianza de la vida eterna";
  assert.deepEqual(wordsOfSelection(changed, s), []);
  assert.equal(resolveTextReference(s, [{ chapter: 1, verse: 2, text: changed }]).status, "stale", "la palabra marcada ya no está: hay que volver a marcar");
  assert.equal(resolveTextReference(s, [{ chapter: 1, verse: 2, text: "otra cosa por completo distinta aquí" }]).status, "stale");
});

console.log(`\nverify-afinacion-selection: ${passed} checks passed.`);
