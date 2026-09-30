/** What a decision shows about a verse: the text before and after, changed boxes, objected boxes. */
import assert from "node:assert/strict";
import type { OriginalWordToken } from "@usfm-tools/editor-core";
import { addSourcesToBox } from "@usfm-ast/alignment-box-model";
import {
  boxKey,
  boxesOf,
  changedBoxKeys,
  groupsAfterTextEdit,
  objectedBoxKeys,
  sameText,
  tokensFromText,
  viewFromTokens,
  wordDiff,
} from "../src/domain/verseEditView";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const so = (i: number, surface: string) => ({ verseSid: "NEH 1:1", surface, strong: `H${i}`, lemma: surface, occurrence: 1, occurrences: 1, index: i }) as OriginalWordToken;
const original = [so(0, "דִּבְרֵי"), so(1, "נְחֶמְיָה"), so(2, "בֶּן")];
const text = "Las palabras de Nehemías hijo";
const tokens = tokensFromText(text, "NEH 1:1");
const gloss = ["The words of", "Nehemiah", "the son of"];
const groupsA = addSourcesToBox(original, tokens, addSourcesToBox(original, tokens, addSourcesToBox(original, tokens, [], "u0", [0, 1, 2]), "u1", [3]), "u2", [4]);
const viewA = viewFromTokens({ rtl: true, original, gloss, draftBefore: tokens });
const linesOf = (groups: ReturnType<typeof addSourcesToBox>) => groups.map((g) => `${g.sources.map((s) => s.content).join("+")}=${g.targets.map((t) => t.word).join("+")}`);

test("el diff dice qué palabras se quedan, cuáles salen y cuáles entran", () => {
  const d = wordDiff("Las palabras de Nehemías hijo", "Las palabras de Nehemías, el hijo");
  assert.deepEqual(d.map((p) => `${p.kind}:${p.text}`), ["same:Las palabras de Nehemías,", "ins:el", "same:hijo"], "la puntuación no cuenta como un cambio");
  const r = wordDiff("Las palabras de Nehemías hijo", "Las palabras de Jacalías hijo");
  assert.deepEqual(r.map((p) => `${p.kind}:${p.text}`), ["same:Las palabras de", "del:Nehemías", "ins:Jacalías", "same:hijo"]);
  assert.deepEqual(wordDiff("a b c", "a b c").map((p) => p.kind), ["same"]);
  assert.equal(sameText("Las  palabras\nde", "Las palabras de"), true);
  assert.equal(sameText("Las palabras", "Las palabras de"), false);
});

test("las palabras repetidas tienen su ocurrencia", () => {
  const t = tokensFromText("de la de", "x");
  assert.deepEqual(t.map((w) => `${w.surface}${w.occurrence}/${w.occurrences}`), ["de1/2", "la1/1", "de2/2"]);
});

test("al cambiar el texto se conservan las uniones de las palabras que siguen y se caen las que no", () => {
  const after = groupsAfterTextEdit(groupsA, text, "Las palabras de Nehemías el hijo");
  assert.deepEqual(linesOf(after), ["דִּבְרֵי=Las+palabras+de", "נְחֶמְיָה=Nehemías", "בֶּן=hijo"], "la palabra nueva queda sin unir, las demás igual");
  const removed = groupsAfterTextEdit(groupsA, text, "Las palabras Nehemías hijo");
  assert.deepEqual(linesOf(removed), ["דִּבְרֵי=Las+palabras", "נְחֶמְיָה=Nehemías", "בֶּן=hijo"]);
});

test("una caja cambió si tiene otras palabras o no existía; las demás no", () => {
  const before = boxesOf(viewA, viewA.draftBefore, groupsA, "NEH 1:1");
  const movedDe = addSourcesToBox(original, tokens, addSourcesToBox(original, tokens, addSourcesToBox(original, tokens, [], "u0", [0, 1]), "u1", [2, 3]), "u2", [4]);
  const after = boxesOf(viewA, viewA.draftBefore, movedDe, "NEH 1:1");
  const changed = changedBoxKeys(before, after);
  assert.deepEqual([...changed].sort(), ["0", "1"], "cambian la primera y la segunda; la tercera sigue igual");
  assert.equal(changed.has(boxKey(after[2]!)), false);
  assert.equal(changedBoxKeys(before, before).size, 0);
});

test("una objeción marca las cajas que tienen las palabras señaladas", () => {
  const boxes = boxesOf(viewA, viewA.draftBefore, groupsA, "NEH 1:1");
  assert.deepEqual([...objectedBoxKeys(boxes, ["נְחֶמְיָה#1"])], ["1"]);
  assert.deepEqual([...objectedBoxKeys(boxes, [])], []);
});

test("la vista guarda el original con su glosa y las palabras del borrador antes y después", () => {
  assert.deepEqual(viewA.original.map((o) => o.gloss), gloss);
  assert.deepEqual(viewA.draftAfter, viewA.draftBefore);
  const edited = viewFromTokens({ rtl: true, original, gloss, draftBefore: tokens, draftAfter: tokensFromText("Las palabras", "NEH 1:1") });
  assert.equal(edited.draftAfter.length, 2);
  assert.equal(edited.draftBefore.length, 5);
});

console.log(`\nverify-verse-edit-view: ${passed} checks passed.`);
