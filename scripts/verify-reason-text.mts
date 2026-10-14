/**
 * The reason of a proposal, made to open: the words of the original it quotes, found among the words of the verse,
 * and the notes it names.
 *
 *   npm run verify:reason-text
 */
import assert from "node:assert/strict";
import { findOriginal, originalKey, reasonPieces } from "../src/domain/reasonText";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

// As the words of Ezra 3:3 come in the original: cantillation, and a prefix joined by a word joiner.
const verse = ["וַ⁠יָּכִ֨ינוּ", "הַ⁠מִּזְבֵּ֜חַ", "כִּ֚י", "בְּ⁠אֵימָה֙", "עֲלֵי⁠הֶ֔ם", "מֵ⁠עַמֵּ֖י", "הָ⁠אֲרָצ֑וֹת"];

test("una palabra del original se encuentra sin los acentos ni la unión del prefijo, y con sus puntos o sin ellos", () => {
  assert.equal(originalKey("בְּ⁠אֵימָה֙"), originalKey("בְּאֵימָה"));
  assert.equal(findOriginal("בְּאֵימָה", verse), 3);
  assert.equal(findOriginal("עֲלֵיהֶם", verse), 4);
  assert.equal(findOriginal("מעמי", verse), 5, "sin puntos, por sus letras");
  assert.equal(findOriginal("שָׁלוֹם", verse), -1);
  assert.equal(findOriginal("λόγος", ["λόγος", "θεοῦ"]), 0);
  assert.equal(findOriginal("λογος", ["λόγος"]), 0, "el griego, sin sus acentos");
});

test("la razón se parte en texto, palabras del original y notas; lo que va en negrita sigue en negrita", () => {
  const notes = new Set(["n3m4", "czrg", "fr03"]);
  const [para] = reasonPieces("El hebreo dice בְּאֵימָה עֲלֵיהֶם, y la nota n3m4 explica el **terror**; «A causa de» traduce מֵעַמֵּי.", verse, notes);
  const kinds = para!.map((piece) => (piece.kind === "word" ? `w${piece.match}` : piece.kind === "note" ? `n:${piece.id}` : piece.strong ? "B" : "t"));
  assert.deepEqual(kinds, ["t", "w3", "t", "w4", "t", "n:n3m4", "t", "B", "t", "w5", "t"]);
  assert.equal(para!.map((piece) => piece.text).join(""), "El hebreo dice בְּאֵימָה עֲלֵיהֶם, y la nota n3m4 explica el terror; «A causa de» traduce מֵעַמֵּי.");
});

test("una lista de notas abre cada una; un id que el libro no tiene, o una palabra de cuatro letras, se queda como texto", () => {
  const notes = new Set(["d9rn", "fr03"]);
  const [para] = reasonPieces("las notas d9rn, fr03 y zzz9 lo dicen; como en 4:13", [], notes);
  assert.deepEqual(para!.filter((piece) => piece.kind === "note").map((piece) => piece.text), ["d9rn", "fr03"]);
  assert.match(para!.map((piece) => piece.text).join(""), /zzz9 lo dicen; como en 4:13$/);
  const [alone] = reasonPieces("Notas: fr03", [], notes);
  assert.deepEqual(alone!.filter((piece) => piece.kind === "note").map((piece) => piece.id), ["fr03"], "un id con número, suelto, también");
});

test("cada línea es un párrafo, y una palabra que el versículo no tiene se marca como no encontrada", () => {
  const paras = reasonPieces("Uno.\n\nDos dice שָׁלוֹם.", verse, new Set());
  assert.equal(paras.length, 2);
  assert.deepEqual(paras[1]!.find((piece) => piece.kind === "word"), { kind: "word", text: "שָׁלוֹם", match: -1 });
});

console.log(`\n${passed} pruebas de las razones que se abren pasaron.`);
