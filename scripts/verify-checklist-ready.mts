/**
 * What a checklist of helps needs done before it: the helps translated and the texts aligned.
 *
 *   npm run verify:checklist-ready
 */
import assert from "node:assert/strict";
import { missingWork, verseIsAligned, verseList } from "../src/domain/checklistReady";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const group = [{ sources: [], targets: [] }] as never;
const tpl = { resource: "tpl", verses: { 1: "El anciano a Gayo", 2: "Amado", 3: "Me alegré" }, alignments: { "3JN 1:1": group, "3JN 1:2": [] as never } };

test("un versículo está alineado cuando su alineación une alguna palabra con el original", () => {
  assert.equal(verseIsAligned(tpl.alignments, 1, 1), true);
  assert.equal(verseIsAligned(tpl.alignments, 1, 2), false, "tiene entrada, pero vacía");
  assert.equal(verseIsAligned(tpl.alignments, 1, 3), false);
  assert.equal(verseIsAligned(undefined, 1, 1), false);
});

test("se dice qué falta y de qué recurso: las ayudas sin traducir, el texto sin alinear o sin escribir", () => {
  const missing = missingWork({ helps: "notas", fromSource: true, chapter: 1, verses: [1, 1, 2, 3, 4], texts: [tpl, { resource: "tps" }] });
  assert.deepEqual(missing, [
    { kind: "helps", resource: "notas" },
    { kind: "text", resource: "tpl", verses: [4] },
    { kind: "alignment", resource: "tpl", verses: [2, 3] },
    { kind: "text", resource: "tps", verses: [1, 2, 3, 4] },
  ]);
});

test("con las notas traducidas y los versículos de las notas alineados no falta nada", () => {
  assert.deepEqual(missingWork({ helps: "notas", fromSource: false, chapter: 1, verses: [1], texts: [tpl] }), []);
});

test("los versículos seguidos se dicen como un tramo", () => {
  assert.equal(verseList([5, 3, 4, 9, 11, 12]), "3–5, 9, 11–12");
});

console.log(`\nverify-checklist-ready: ${passed} checks passed.`);
