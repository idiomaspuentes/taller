/**
 * The group review of a deliverable: passages are read as they arrive, and it closes only when all arrived and all
 * is agreed.
 *
 *   npm run verify:group-reading
 */
import assert from "node:assert/strict";
import { passagesOf, readingItemId, readingPassages, readingProgress } from "../src/domain/groupReading";
import { tallyItem, textFingerprint, type ItemTally, type ReviewDecision } from "../src/domain/reviewRound";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

test("los pasajes del entregable salen de la subtarea, en orden; sin lista, el capítulo entero", () => {
  assert.deepEqual(passagesOf(["porcion:3JN 1:5-8", "porcion:3JN 1:1-4", "porcion:3JN 2:1-3", "porcion:3JN 1:9–15"], 1, 15), [{ from: 1, to: 4 }, { from: 5, to: 8 }, { from: 9, to: 15 }]);
  assert.deepEqual(passagesOf([], 1, 15), [{ from: 1, to: 15 }]);
});

const tpl = { resource: "tpl", verses: { 1: "El anciano a Gayo.", 2: "Amado, oro por ti." } };
const tps = { resource: "tps", verses: {} };
const passages = readingPassages([{ from: 1, to: 2 }, { from: 3, to: 4 }], [tpl, tps]);
const levels = { ana: "habilitada", bea: "habilitada", carla: "habilitada" } as const;
const answer = (who: string, resource: string, verse: number, text: string, status = "approved"): ReviewDecision =>
  ({ itemId: readingItemId(resource, 1, verse), reviewer: who, status, timestamp: "2026-10-02T10:00:00Z", textHash: textFingerprint(text), ref: { start: { chapter: 1, verse } }, sessionId: "1", stageId: "lectura" }) as ReviewDecision;
const tally = (decisions: ReviewDecision[], texts = [tpl, tps]) => {
  const map = new Map<string, ItemTally>();
  for (const text of texts) {
    for (const [verse, body] of Object.entries(text.verses)) {
      const itemId = readingItemId(text.resource, 1, Number(verse));
      map.set(itemId, tallyItem({ itemId, decisions, currentHash: textFingerprint(body as string), levels: levels as never, authors: ["ana"], thresholds: { minAgree: 2, minIndependent: 1 } }));
    }
  }
  return map;
};

test("un pasaje se lee en cuanto llega; lo que no llegó se espera y no deja cerrar", () => {
  assert.deepEqual(passages.map((p) => [p.from, p.arrived]), [[1, { tpl: true, tps: false }], [3, { tpl: false, tps: false }]]);
  const all = [answer("ana", "tpl", 1, tpl.verses[1]), answer("bea", "tpl", 1, tpl.verses[1]), answer("ana", "tpl", 2, tpl.verses[2]), answer("bea", "tpl", 2, tpl.verses[2])];
  const progress = readingProgress(passages, [tpl, tps], 1, tally(all));
  assert.deepEqual([progress.items, progress.agreed, progress.missing, progress.complete], [2, 2, 3, false]);
});

test("un borrador que parte de un texto que ya existía: llega lo que se entregó, no lo que tiene letras", () => {
  const seeded = { resource: "tpl", verses: { 1: "a", 2: "b", 3: "c", 4: "d" }, pending: [{ from: 3, to: 4 }] };
  assert.deepEqual(readingPassages([{ from: 1, to: 2 }, { from: 3, to: 4 }], [seeded]).map((p) => p.arrived.tpl), [true, false]);
});

test("cuando todo llegó y todo está acordado, se puede cerrar; una duda o una corrección lo reabre", () => {
  const whole = readingPassages([{ from: 1, to: 2 }], [tpl]);
  const all = [answer("ana", "tpl", 1, tpl.verses[1]), answer("bea", "tpl", 1, tpl.verses[1]), answer("ana", "tpl", 2, tpl.verses[2]), answer("bea", "tpl", 2, tpl.verses[2])];
  assert.equal(readingProgress(whole, [tpl], 1, tally(all, [tpl])).complete, true);
  const doubt = [...all, { ...answer("carla", "tpl", 2, tpl.verses[2], "revise"), note: "¿oro o ruego?" }];
  const withDoubt = readingProgress(whole, [tpl], 1, tally(doubt, [tpl]));
  assert.deepEqual([withDoubt.agreed, withDoubt.disputed, withDoubt.complete], [1, 1, false]);
  const fixed = { resource: "tpl", verses: { ...tpl.verses, 2: "Amado, ruego por ti." } };
  const afterFix = readingProgress(readingPassages([{ from: 1, to: 2 }], [fixed]), [fixed], 1, tally(all, [fixed]));
  assert.deepEqual([afterFix.agreed, afterFix.complete], [1, false], "las respuestas sobre el texto viejo ya no cuentan");
});

test("quien tradujo el versículo puede estar de acuerdo, pero hace falta alguien más", () => {
  const whole = readingPassages([{ from: 1, to: 1 }], [{ resource: "tpl", verses: { 1: tpl.verses[1] } }]);
  const one = { resource: "tpl", verses: { 1: tpl.verses[1] } };
  const map = new Map<string, ItemTally>();
  const itemId = readingItemId("tpl", 1, 1);
  map.set(itemId, tallyItem({ itemId, decisions: [answer("ana", "tpl", 1, tpl.verses[1]), answer("bea", "tpl", 1, tpl.verses[1])], currentHash: textFingerprint(tpl.verses[1]), levels: levels as never, authors: ["ana", "bea"], thresholds: { minAgree: 2, minIndependent: 1 } }));
  assert.equal(readingProgress(whole, [one], 1, map).complete, false);
});

console.log(`\nverify-group-reading: ${passed} checks passed.`);
