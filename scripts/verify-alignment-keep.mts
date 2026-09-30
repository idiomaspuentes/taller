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

console.log(`\nverify-alignment-keep: ${passed} checks passed.`);
