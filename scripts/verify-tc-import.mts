/** What a team checked in translationCore becomes the answers this app keeps, and what was left becomes the work to do. */
import assert from "node:assert/strict";
import { wordsOfSelection } from "../src/domain/afinacionSelection";
import { tallyItem, textFingerprint } from "../src/domain/reviewRound";
import { decisionsFromTcChecks, itemIdOfTcCheck, tcCheckerOf, tcProgressByChapter, wordsOfTcSelections, type TcCheck } from "../src/domain/tcImport";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

// Ezra 1:1 of the simple text as the team has it, and the check of a note as translationCore keeps it.
const verse = "Durante el primer año después de que Ciro, rey de Persia, conquistó el reino de Babilonia, Jehová motivó a Ciro a escribir un mensaje. Jehová hizo esto para cumplir una profecía.";
const texts: Record<string, string> = { "1:1": verse, "1:2": "Ciro dijo esto y Ciro lo escribió." };
const verseText = (chapter: number, v: number) => texts[`${chapter}:${v}`];
const check = (checkId: string, v: number | string, more: Partial<TcCheck>): TcCheck => ({ selections: false, nothingToSelect: false, contextId: { checkId, tool: "translationNotes", groupId: "figs-metaphor", reference: { bookId: "ezr", chapter: 1, verse: v } }, ...more });
const base = { tool: "translationNotes" as const, verseText, reviewer: "coordina", timestamp: "2026-10-12T12:00:00.000Z", sessionId: "import", stageId: "afinacion" };

test("the id of a note is its own, and the id of a use of a term is kept apart from the notes", () => {
  assert.equal(itemIdOfTcCheck(check("cz5n", 1, {}), "translationNotes"), "cz5n");
  assert.equal(itemIdOfTcCheck(check("kcnr", 1, {}), "translationWords"), "w:kcnr");
  assert.equal(itemIdOfTcCheck({ contextId: { reference: { chapter: 1, verse: 1 } } }, "translationNotes"), null);
});

test("two stretches marked in translationCore are the same two stretches here", () => {
  const { decisions, leftOut } = decisionsFromTcChecks({ ...base, checks: [check("cz5n", 1, { selections: [{ text: "motivó a Ciro", occurrence: 1 }, { text: "Jehová hizo esto", occurrence: 1 }] })] });
  assert.equal(leftOut.length, 0);
  const d = decisions[0]!;
  assert.equal(d.itemId, "cz5n");
  assert.equal(d.status, "approved");
  assert.equal(d.textHash, textFingerprint(verse));
  const parts = (d.selectedText as { parts?: { text: string }[] }).parts!.map((part) => part.text);
  assert.deepEqual(parts, ["motivó a Ciro", "Jehová hizo esto"]);
  // The screen finds the same words again from what was kept.
  assert.equal(wordsOfSelection(verse, d.selectedText).length, 6);
});

test("the second time a word is said is the one marked, when translationCore says so", () => {
  assert.deepEqual(wordsOfTcSelections(texts["1:2"]!, [{ text: "Ciro", occurrence: 2 }]), [4]);
  assert.deepEqual(wordsOfTcSelections(texts["1:2"]!, [{ text: "Ciro", occurrence: 1 }]), [0]);
});

test("a mark that ends inside a word takes the whole word, with its comma", () => {
  assert.deepEqual(wordsOfTcSelections(verse, [{ text: "Ciro", occurrence: 1 }]), [7]);
});

test("a check with nothing to mark is an answer without words", () => {
  const { decisions } = decisionsFromTcChecks({ ...base, checks: [check("abcd", 1, { nothingToSelect: true })] });
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0]!.selectedText, undefined);
});

test("what was never checked, what translationCore invalidated and what is no longer in the verse are left to do", () => {
  const result = decisionsFromTcChecks({
    ...base,
    checks: [
      check("aaaa", 1, {}),
      check("bbbb", 1, { selections: [{ text: "motivó a Ciro", occurrence: 1 }], invalidated: true }),
      check("cccc", 1, { selections: [{ text: "despertó el espíritu", occurrence: 1 }] }),
      check("dddd", 9, { selections: [{ text: "Ciro", occurrence: 1 }] }),
      check("eeee", "2", { selections: [{ text: "lo escribió", occurrence: 1 }] }),
    ],
  });
  assert.deepEqual(result.leftOut.map((row) => `${row.itemId} ${row.why}`), ["aaaa pending", "bbbb invalidated", "cccc words-not-found", "dddd no-verse"]);
  assert.deepEqual(result.decisions.map((d) => d.itemId), ["eeee"]);
  assert.deepEqual(tcProgressByChapter(result), { 1: { done: 1, total: 5 } });
});

test("an older project, whose checks have no id, is counted and not guessed", () => {
  const result = decisionsFromTcChecks({ ...base, checks: [{ selections: [{ text: "Ciro", occurrence: 1 }], contextId: { reference: { chapter: 1, verse: 1 } } }] });
  assert.equal(result.withoutId, 1);
  assert.equal(result.decisions.length, 0);
});

test("brought as the decision of the team, a check settles its item without asking each person again", () => {
  const { decisions } = decisionsFromTcChecks({ ...base, final: true, note: "Traído de translationCore", checks: [check("cz5n", 1, { selections: [{ text: "motivó a Ciro", occurrence: 1 }] })] });
  const tally = (confirmers: string[]) => tallyItem({ itemId: "cz5n", decisions, currentHash: textFingerprint(verse), levels: {}, authors: [], thresholds: { minAgree: 2, minIndependent: 1 }, confirmers });
  assert.equal(tally(["coordina"]).state, "agreed");
  assert.equal(tally(["coordina"]).decided?.note, "Traído de translationCore");
  // Recorded by somebody who may not decide for the team, it is one answer more.
  assert.equal(tally([]).state, "pending");
  // And a verse corrected afterwards asks for it again.
  assert.equal(tallyItem({ itemId: "cz5n", decisions, currentHash: textFingerprint("otro texto"), levels: {}, authors: [], thresholds: { minAgree: 2, minIndependent: 1 }, confirmers: ["coordina"] }).state, "pending");
});

test("una respuesta traída de translationCore se atribuye a quien la comprobó allí, no a quien la importó", () => {
  assert.equal(tcCheckerOf({ note: "Comprobación hecha en translationCore (Keneramk)" }), "Keneramk");
  assert.equal(tcCheckerOf({ note: "No hay personificación." }), undefined);
  assert.equal(tcCheckerOf({}), undefined);
});

console.log(`\n${passed} passed`);
