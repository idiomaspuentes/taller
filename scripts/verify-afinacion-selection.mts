/** Marking the words of a verse, and finding them again after the text changed. */
import assert from "node:assert/strict";
import { resolveTextReference } from "@usfm-tools/checking";
import { fillBetween, moveEnd, phrasesOf, selectionFromWords, stretchesOf, togglePhrase, toggleWord, unmarkedBetween, wordSpans, wordsOfSelection } from "../src/domain/afinacionSelection";

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

test("un toque marca una palabra sola; las que hay entre las dos últimas tocadas se ofrecen, y se marcan de un toque", () => {
  // Una palabra, otras que no van, y una más: dos toques, y nada entre ellas.
  const apart = toggleWord(toggleWord([], 1), 6);
  assert.deepEqual(apart, [1, 6]);
  assert.equal(unmarkedBetween(apart, 1, 6), 4, "se ofrece marcar las cuatro de en medio");
  // Muchas seguidas: la primera, la última, y lo que se ofrece.
  assert.deepEqual(fillBetween(apart, 1, 6), [1, 2, 3, 4, 5, 6]);
  assert.equal(unmarkedBetween(fillBetween(apart, 1, 6), 1, 6), 0, "ya no hay nada que ofrecer");
  assert.equal(unmarkedBetween([3, 4], 3, 4), 0, "entre dos vecinas no hay nada");
  assert.deepEqual(fillBetween([2], 6, 4), [2, 4, 5, 6], "da igual cuál de las dos se tocó primero");
});

test("una palabra, varias que no van y luego varias que sí: solo se llena entre las dos últimas tocadas", () => {
  // «uno», y después de «cuatro» a «siete»: la primera queda aparte.
  const marked = toggleWord(toggleWord(toggleWord([], 0), 3), 6);
  assert.deepEqual(marked, [0, 3, 6]);
  assert.equal(unmarkedBetween(marked, 3, 6), 2, "se ofrecen las dos que hay entre las dos últimas");
  const filled = fillBetween(marked, 3, 6);
  assert.deepEqual(filled, [0, 3, 4, 5, 6], "«dos» y «tres» siguen sin marcar");
  assert.deepEqual(stretchesOf(filled), [{ from: 0, to: 0 }, { from: 3, to: 6 }]);
});

test("varios tramos: cuatro palabras, dos que no van y dos más", () => {
  // La primera y la cuarta, lo de en medio, y las otras dos.
  let marked = fillBetween(toggleWord(toggleWord([], 0), 3), 0, 3);
  marked = toggleWord(toggleWord(marked, 6), 7);
  assert.deepEqual(marked, [0, 1, 2, 3, 6, 7]);
  assert.deepEqual(stretchesOf(marked), [{ from: 0, to: 3 }, { from: 6, to: 7 }]);
  assert.equal(unmarkedBetween(marked, 6, 7), 0, "y no se ofrece llenar el hueco que se dejó a propósito");

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

// ---------------------------------------------------------------- dos propuestas que se están probando

const jonah = "Y él dijo: Clamé a Jehová desde mi angustia y él me contestó; desde el vientre del Seol clamé, tú escuchaste mi voz.";
const said = (text: string, pieces: { from: number; to: number }[]) => pieces.map((piece) => wordSpans(text).slice(piece.from, piece.to + 1).map((word) => word.text).join(" "));

test("propuesta A: el versículo se parte en frases, por su puntuación y, si una es larga, antes de lo que une", () => {
  assert.deepEqual(said(jonah, phrasesOf(jonah)), ["Y él dijo:", "Clamé a Jehová desde mi angustia", "y él me contestó;", "desde el vientre del Seol clamé,", "tú escuchaste mi voz."]);
  assert.deepEqual(said("para hacer juicio contra todos y para reprender a toda alma", phrasesOf("para hacer juicio contra todos y para reprender a toda alma")), ["para hacer juicio contra todos", "y para reprender a toda alma"], "sin puntuación, se corta en el «y»");
  assert.deepEqual(said("Pablo, siervo de Dios y apóstol de Jesucristo", phrasesOf("Pablo, siervo de Dios y apóstol de Jesucristo")), ["Pablo,", "siervo de Dios y apóstol de Jesucristo"], "una frase corta no se corta más");
  // Cada palabra está en una frase, y solo en una.
  const pieces = phrasesOf(jonah);
  assert.deepEqual(pieces.flatMap((piece) => Array.from({ length: piece.to - piece.from + 1 }, (_, i) => piece.from + i)), wordSpans(jonah).map((word) => word.index));
  assert.deepEqual(phrasesOf(""), []);
});

test("propuesta A: un toque marca la frase entera, y otro la quita; el paralelismo de Jonás 2:2 son cuatro toques", () => {
  const pieces = phrasesOf(jonah);
  let marked: number[] = [];
  for (const piece of pieces.slice(1)) marked = togglePhrase(marked, piece);
  assert.equal(selectionFromWords(jonah, marked, { chapter: 2, verse: 2 })!.text, jonah.slice("Y él dijo: ".length));
  assert.deepEqual(togglePhrase(marked, pieces[2]!).length, marked.length - 4, "«y él me contestó;» se quita entera");
  // Una frase marcada a medias (palabra por palabra) se completa con un toque.
  assert.deepEqual(togglePhrase([3], pieces[1]!), [3, 4, 5, 6, 7, 8]);
});

test("propuesta B: un tramo se corrige por sus extremos, una palabra cada vez", () => {
  // «Jonás» y «la presencia de Jehová»: a la propuesta le faltan dos palabras al principio del segundo tramo.
  const proposed = [1, 10, 11, 12, 13];
  const second = () => stretchesOf(marked)[1]!;
  let marked = moveEnd(proposed, { from: 10, to: 13 }, "startEarlier", 14);
  marked = moveEnd(marked, second(), "startEarlier", 14);
  assert.deepEqual(marked, [1, 8, 9, 10, 11, 12, 13], "empieza dos palabras antes, y el otro tramo no se toca");
  assert.deepEqual(moveEnd(marked, second(), "endEarlier", 14), [1, 8, 9, 10, 11, 12]);
  assert.deepEqual(moveEnd(marked, second(), "startLater", 14), [1, 9, 10, 11, 12, 13]);
  assert.deepEqual(moveEnd(marked, second(), "endLater", 14), marked, "no hay palabra después de la última");
  assert.deepEqual(moveEnd(marked, { from: 1, to: 1 }, "startLater", 14), marked, "un tramo de una palabra no se queda sin ninguna");
  assert.deepEqual(moveEnd([0], { from: 0, to: 0 }, "startEarlier", 14), [0]);
  // Dos tramos que se tocan pasan a ser uno.
  assert.deepEqual(stretchesOf(moveEnd([1, 3, 4], { from: 1, to: 1 }, "endLater", 14)), [{ from: 1, to: 4 }]);
});

console.log(`\nverify-afinacion-selection: ${passed} checks passed.`);
