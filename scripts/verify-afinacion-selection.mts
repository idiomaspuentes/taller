/** Marking the words of a verse, and finding them again after the text changed. */
import assert from "node:assert/strict";
import { resolveTextReference } from "@usfm-tools/checking";
import { referenceExcerpt, selectionFromWords, selectionWindow, shownWords, stretchesOf, toggleWord, wordSpans, wordsOfSelection } from "../src/domain/afinacionSelection";

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

test("el versículo se muestra entero si es corto, y si es largo, un tramo alrededor de lo elegido", () => {
  assert.deepEqual(selectionWindow(20, [3, 5]), { from: 0, to: 20 }, "corto: entero");
  assert.deepEqual(selectionWindow(60, [0, 2]), { from: 0, to: 11 }, "al principio: desde la primera palabra");
  assert.deepEqual(selectionWindow(60, [30]), { from: 22, to: 39 });
  assert.deepEqual(selectionWindow(60, [55, 58]), { from: 47, to: 60 }, "al final: hasta la última");
  assert.deepEqual(selectionWindow(60, []), { from: 0, to: 60 });
});

test("la referencia de los pasos 2 y 3 muestra lo resaltado con tres palabras a cada lado, y entera si se ahorraría poco", () => {
  assert.deepEqual(referenceExcerpt(20, [10]), [7, 8, 9, 10, 11, 12, 13]);
  assert.deepEqual(referenceExcerpt(20, [1, 2]), [0, 1, 2, 3, 4, 5], "al principio, desde la primera palabra");
  assert.deepEqual(referenceExcerpt(20, [6, 12]), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], "lo resaltado en dos partes va con lo que hay entre ellas");
  assert.equal(referenceExcerpt(10, [5]), null, "se quitarían tres palabras: el versículo entero");
  assert.equal(referenceExcerpt(20, []), null, "nada resaltado: entero");
});

console.log(`\nverify-afinacion-selection: ${passed} checks passed.`);
