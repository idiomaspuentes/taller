/**
 * Saving the text of a verse must not erase the word alignment of the words
 * that did not change. Run with `--tsconfig tsconfig.scripts.json` (see package.json).
 */
import assert from "node:assert/strict";
import { applyVerseEdits, listVerseSpans } from "../src/domain/usfmEdit";
import { applyVerseEditsKeepingAlignment, usfmHasAlignment } from "../src/domain/alignmentKeep";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const z = (strong: string, lemma: string, content: string, word: string) =>
  String.raw`\zaln-s |x-strong="${strong}" x-lemma="${lemma}" x-morph="Gr,N,,,,,NMS," x-occurrence="1" x-occurrences="1" x-content="${content}"\*\w ${word}|x-occurrence="1" x-occurrences="1"\w*\zaln-e\*`;

const aligned = [
  String.raw`\id TIT`,
  String.raw`\c 1`,
  String.raw`\p`,
  String.raw`\v 1 ${z("G39720", "Παῦλος", "Παῦλος", "Pablo")} ${z("G14010", "δοῦλος", "δοῦλος", "siervo")}`,
  String.raw`\v 2 ${z("G19110", "ἐλπίς", "ἐλπίδι", "esperanza")}`,
  "",
].join("\n");

const groupsIn = (usfm: string, verse: number): string[] =>
  [...(listVerseSpans(usfm).find((s) => s.verse === verse)?.rawBody.matchAll(/\\w ([^|\\]+)\|/g) ?? [])].map((m) => m[1]!);

test("el modo simple borra las marcas del versículo que se guarda (el problema)", () => {
  const out = applyVerseEdits(aligned, 1, [{ verse: 1, text: "Pablo, esclavo" }]);
  assert.equal(groupsIn(out, 1).length, 0);
  assert.deepEqual(groupsIn(out, 2), ["esperanza"], "los demás versículos no se tocan");
});

test("con la alineación: se conservan las palabras que no cambiaron", () => {
  const res = applyVerseEditsKeepingAlignment(aligned, 1, [{ verse: 1, text: "Pablo, esclavo" }]);
  assert.deepEqual(groupsIn(res.usfm, 1), ["Pablo"], "«Pablo» sigue unida al original");
  assert.deepEqual(res.reducedVerses, [1]);
  assert.deepEqual(res.clearedVerses, []);
  assert.deepEqual(groupsIn(res.usfm, 2), ["esperanza"]);
  assert.match(res.usfm, /\\v 1 .*esclavo/s, "el texto nuevo quedó");
});

test("si se cambia todo el versículo se pierden sus vínculos y se avisa", () => {
  const res = applyVerseEditsKeepingAlignment(aligned, 1, [{ verse: 1, text: "Otro texto distinto" }]);
  assert.equal(groupsIn(res.usfm, 1).length, 0);
  assert.deepEqual(res.clearedVerses, [1]);
  assert.deepEqual(groupsIn(res.usfm, 2), ["esperanza"]);
});

test("un versículo que no se edita conserva sus vínculos", () => {
  const res = applyVerseEditsKeepingAlignment(aligned, 1, [{ verse: 2, text: "esperanza" }]);
  assert.deepEqual(groupsIn(res.usfm, 1), ["Pablo", "siervo"]);
  assert.deepEqual(groupsIn(res.usfm, 2), ["esperanza"]);
  assert.deepEqual([res.clearedVerses, res.reducedVerses], [[], []]);
});

test("unir versículos en un rango suelta los vínculos de los que se unen", () => {
  const res = applyVerseEditsKeepingAlignment(aligned, 1, [{ from: 1, to: 2, text: "Pablo, siervo, esperanza" }]);
  assert.deepEqual(res.clearedVerses.sort(), [1, 2]);
  assert.equal(groupsIn(res.usfm, 1).length, 0);
});

test("sin alineación se comporta exactamente como el guardado de siempre", () => {
  const plain = "\\id TIT\n\\c 1\n\\p\n\\v 1 uno\n\\v 2 dos\n";
  assert.equal(usfmHasAlignment(plain), false);
  const res = applyVerseEditsKeepingAlignment(plain, 1, [{ verse: 2, text: "tres" }]);
  assert.equal(res.usfm, applyVerseEdits(plain, 1, [{ verse: 2, text: "tres" }]));
  assert.equal(usfmHasAlignment(aligned), true);
});

// ---------------------------------------------------------------- what is next to a verse and is not the verse

/** A word linked to one of the original, with the number it has among the words of its verse. */
const zn = (content: string, word: string, occurrence = 1, occurrences = 1) =>
  String.raw`\zaln-s |x-strong="H1" x-lemma="${content}" x-occurrence="1" x-occurrences="1" x-content="${content}"\*\w ${word}|x-occurrence="${occurrence}" x-occurrences="${occurrences}"\w*\zaln-e\*`;
const wordsIn = (text: string): string[] => [...text.matchAll(/\\w ([^|\\]+)\|x-occurrence="(\d+)" x-occurrences="(\d+)"/g)].map((m) => `${m[1]}#${m[2]}/${m[3]}`);

test("corregir un versículo de un salmo deja el título del salmo, y el del siguiente, con sus vínculos", () => {
  const psalms = [
    String.raw`\id PSA`,
    String.raw`\c 3`,
    String.raw`\d ${zn("מזמור", "Salmo")} ${zn("לדוד", "de", 1, 2)} ${zn("לדוד2", "David")}, hijo ${zn("בן", "de", 2, 2)} Isaí`,
    String.raw`\q1 \v 1 ${zn("יהוה", "Jehová")}, ${zn("מה", "cuántos")} son.`,
    String.raw`\q1 \v 2 ${zn("ישועה", "Salvación")} ${zn("ליהוה", "de")} Jehová.`,
    String.raw`\c 4`,
    String.raw`\d ${zn("למנצח", "Al")} músico; ${zn("מזמור", "salmo")} ${zn("לדוד", "de")} David.`,
    String.raw`\q1 \v 1 ${zn("ענני", "Respóndeme")}.`,
    "",
  ].join("\n");
  const title = (usfm: string, chapter: number) => wordsIn(/\\d [\s\S]*?(?=\\q1)/.exec(usfm.slice(usfm.indexOf(`\\c ${chapter}`)))![0]);
  const res = applyVerseEditsKeepingAlignment(psalms, 3, [{ verse: 2, text: "Salvación viene de Jehová." }]);
  assert.deepEqual(title(res.usfm, 3), ["Salmo#1/1", "de#1/2", "David#1/1", "de#2/2"], "cada palabra del título, con su número entre las del título");
  assert.deepEqual(title(res.usfm, 4), ["Al#1/1", "salmo#1/1", "de#1/1"], "el título del salmo siguiente no es parte del último versículo de este");
  assert.deepEqual(groupsIn(res.usfm, 2), ["Salvación", "de"], "el versículo corregido conserva lo que no cambió");
  assert.match(res.usfm, /\\v 2 .*viene/s);
  assert.deepEqual([res.clearedVerses, res.reducedVerses], [[], []]);
});

test("un título escrito en medio de un versículo no se queda con el vínculo de una palabra que repite", () => {
  const split = [
    String.raw`\id TIT`,
    String.raw`\c 1`,
    String.raw`\p`,
    String.raw`\v 1 la ${zn("οἶκος", "casa", 1, 2)} de`,
    String.raw`\s1 La casa nueva`,
    String.raw`\p la ${zn("οἶκος2", "casa", 2, 2)} grande`,
    String.raw`\v 2 ${zn("ἐλπίς", "esperanza")}`,
    "",
  ].join("\n");
  const res = applyVerseEditsKeepingAlignment(split, 1, [{ verse: 2, text: "esperanza viva" }]);
  assert.ok(res.usfm.includes("\\s1 La casa nueva\n"), "el título queda en palabras llanas");
  assert.deepEqual(wordsIn(res.usfm), ["casa#1/2", "casa#2/2", "esperanza#1/1"]);
  assert.match(res.usfm, /\\s1 La casa nueva\n\\p la\s+\\zaln-s [^\n]*\\w casa\|x-occurrence="2"/, "la segunda «casa» del versículo es la que sigue al título");
});

console.log(`\nverify-alignment-keep: ${passed} checks passed.`);
