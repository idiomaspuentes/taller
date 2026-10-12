/** Marking the words of a verse, and finding them again after the text changed. */
import assert from "node:assert/strict";
import { resolveTextReference } from "@usfm-tools/checking";
import { selectionFromWords, stretchesOf, toggleWord, touchWords, wordSpans, wordsOfSelection } from "../src/domain/afinacionSelection";

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

test("muchas palabras se marcan con pocos toques: la primera y la última, y las de en medio van con ellas", () => {
  let marked = touchWords([], 1);
  assert.deepEqual(marked, [1], "el primer toque marca una palabra");
  marked = touchWords(marked, 5);
  assert.deepEqual(marked, [1, 2, 3, 4, 5], "el segundo, hasta ahí");
  assert.deepEqual(touchWords(marked, 0), [0, 1, 2, 3, 4, 5], "un toque antes del principio lo alarga hacia allá");
  assert.deepEqual(touchWords(marked, 5), [1, 2, 3, 4], "un toque en una marcada la quita");
  assert.deepEqual(touchWords(marked, 3), [1, 2, 4, 5], "también en medio, y solo esa");
  assert.deepEqual(touchWords([3], 3), []);
});

test("varios tramos: cuatro palabras, dos que no van y dos más son cuatro toques", () => {
  // La primera y la última, y luego las dos que no van.
  let marked = touchWords(touchWords([], 0), 7);
  marked = touchWords(touchWords(marked, 4), 5);
  assert.deepEqual(marked, [0, 1, 2, 3, 6, 7]);
  assert.deepEqual(stretchesOf(marked), [{ from: 0, to: 3 }, { from: 6, to: 7 }]);
  // Con dos tramos marcados, una palabra nueva se une al más cercano, sin llenar el hueco del otro lado.
  assert.deepEqual(touchWords([0, 1, 6, 7], 9), [0, 1, 6, 7, 8, 9]);
  assert.deepEqual(touchWords([0, 1, 6, 7], 3), [0, 1, 2, 3, 6, 7]);

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
