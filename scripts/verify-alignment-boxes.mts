/** The box model of the alignment editor, used from here: fill boxes, join them, take words out. */
import assert from "node:assert/strict";
import type { OriginalWordToken, WordToken } from "@usfm-tools/editor-core";
import {
  addSourcesToBox,
  computeAlignedSourceIndices,
  deriveAlignmentBoxes,
  detachTargetRefFromGroup,
  mergeAlignmentBoxes,
  removeSourcesFromBox,
  splitAlignmentGroupPure,
} from "@usfm-ast/alignment-box-model";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const ref = (index: number, surface: string): OriginalWordToken =>
  ({ verseSid: "TIT 1:1", surface, strong: `G${index}`, lemma: surface, occurrence: 1, occurrences: 1, index }) as OriginalWordToken;
const tr = (index: number, surface: string): WordToken =>
  ({ verseSid: "TIT 1:1", surface, occurrence: 1, occurrences: 1, index }) as WordToken;

// «Παῦλος δοῦλος Θεοῦ» ↔ «Pablo, siervo de Dios»
const refTok = [ref(0, "Παῦλος"), ref(1, "δοῦλος"), ref(2, "Θεοῦ")];
const trTok = [tr(0, "Pablo,"), tr(1, "siervo"), tr(2, "de"), tr(3, "Dios")];
const words = (g: { sources: { content: string }[]; targets: { word: string }[] }) =>
  `${g.sources.map((s) => s.content).join("+")}=${g.targets.map((t) => t.word).join("+")}`;

test("sin uniones hay una caja por palabra del original", () => {
  const boxes = deriveAlignmentBoxes(refTok, [], trTok);
  assert.deepEqual(boxes.map((b) => b.id), ["u0", "u1", "u2"]);
  assert.deepEqual(computeAlignedSourceIndices(trTok, boxes), [false, false, false, false]);
});

test("varias palabras del borrador caen en una caja, en el orden del texto", () => {
  let groups = addSourcesToBox(refTok, trTok, [], "u1", [2, 1]);
  assert.deepEqual(groups.map(words), ["δοῦλος=siervo+de"]);
  groups = addSourcesToBox(refTok, trTok, groups, "u0", [0]);
  assert.deepEqual(groups.map(words), ["Παῦλος=Pablo,", "δοῦλος=siervo+de"]);
  assert.deepEqual(computeAlignedSourceIndices(trTok, deriveAlignmentBoxes(refTok, groups, trTok)), [true, true, true, false]);
});

test("una palabra que pasa a otra caja sale de la anterior", () => {
  let groups = addSourcesToBox(refTok, trTok, [], "u1", [1, 2]);
  groups = addSourcesToBox(refTok, trTok, groups, "u2", [2, 3]);
  assert.deepEqual(groups.map(words), ["δοῦλος=siervo", "Θεοῦ=de+Dios"]);
});

test("juntar dos cajas deja un solo grupo con las palabras de las dos", () => {
  let groups = addSourcesToBox(refTok, trTok, [], "u1", [1]);
  groups = addSourcesToBox(refTok, trTok, groups, "u2", [2, 3]);
  const boxes = deriveAlignmentBoxes(refTok, groups, trTok);
  const merged = mergeAlignmentBoxes(refTok, trTok, groups, boxes.filter((b) => b.targetTokenIndices[0]! >= 1).map((b) => b.id), boxes[1]!.id);
  assert.deepEqual(merged?.map(words), ["δοῦλος+Θεοῦ=siervo+de+Dios"]);
});

test("separar una caja juntada devuelve cada palabra del original a su caja", () => {
  const ow = (i: number) => ({ strong: `G${i}`, lemma: refTok[i]!.surface, content: refTok[i]!.surface, occurrence: 1, occurrences: 1 });
  const aw = (i: number) => ({ word: trTok[i]!.surface, occurrence: 1, occurrences: 1 });
  const joined = [{ sources: [ow(1), ow(2)], targets: [aw(1), aw(3)] }];
  const split = splitAlignmentGroupPure(refTok, trTok, joined, 0);
  assert.deepEqual(split?.map(words), ["δοῦλος=siervo", "Θεοῦ=Dios"]);
});

test("sacar una palabra del original de una caja juntada la deja sin unir", () => {
  const ow = (i: number) => ({ strong: `G${i}`, lemma: refTok[i]!.surface, content: refTok[i]!.surface, occurrence: 1, occurrences: 1 });
  const joined = [{ sources: [ow(1), ow(2)], targets: [{ word: "siervo", occurrence: 1, occurrences: 1 }] }];
  const detached = detachTargetRefFromGroup(refTok, trTok, joined, 0, 2);
  assert.deepEqual(detached?.map(words), ["δοῦλος=siervo"]);
  assert.equal(deriveAlignmentBoxes(refTok, detached!, trTok).filter((b) => b.groupIndex === null).length, 2);
});

test("quitar la última palabra de una caja borra el grupo", () => {
  let groups = addSourcesToBox(refTok, trTok, [], "u1", [1]);
  groups = removeSourcesFromBox(refTok, trTok, groups, "g0", [1]);
  assert.deepEqual(groups, []);
});

console.log(`\nverify-alignment-boxes: ${passed} checks passed.`);
