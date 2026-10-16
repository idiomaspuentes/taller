/** Marking the words of a verse, and finding them again after the text changed. */
import assert from "node:assert/strict";
import { resolveTextReference } from "@usfm-tools/checking";
import { selectionFromWords, shownWords, stretchesOf, toggleWord, wordSpans, wordsOfSelection } from "../src/domain/afinacionSelection";

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

test("varios tramos: cada uno se guarda aparte, y las palabras de en medio no quedan marcadas", () => {
  // «uno dos tres cuatro», no «cinco seis», y «siete ocho»: dos trazos del dedo.
  const marked = [0, 1, 2, 3, 6, 7];
  assert.deepEqual(stretchesOf(marked), [{ from: 0, to: 3 }, { from: 6, to: 7 }]);
  assert.deepEqual(stretchesOf([1, 5]), [{ from: 1, to: 1 }, { from: 5, to: 5 }], "dos palabras sueltas son dos tramos");
  assert.deepEqual(stretchesOf([]), []);

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

test("las llaves del texto simple no se muestran: lo que va dentro se ve como implícito, y el texto no cambia", () => {
  const text = "la gente, {antes de que regresaran allí}, comenzó";
  const shown = shownWords(wordSpans(text));
  assert.deepEqual(shown.map((w) => w.text), ["la", "gente,", "antes", "de", "que", "regresaran", "allí,", "comenzó"]);
  assert.deepEqual(shown.map((w) => w.implied), [false, false, true, true, true, true, true, false]);
  assert.equal(wordSpans(text)[2]!.text, "{antes", "las posiciones y lo que se guarda conservan las llaves");
});

console.log(`\nverify-afinacion-selection: ${passed} checks passed.`);
