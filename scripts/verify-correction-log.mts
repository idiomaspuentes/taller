/**
 * The record of the corrections made to a text: what is kept of each one, how a person's file is read back, and
 * what a book's corrections add up to.
 */
import assert from "node:assert/strict";
import {
  CORRECTION_REASONS,
  correctionsFilePath,
  correctionsOfVerse,
  mergeCorrectionFiles,
  normalizeCorrection,
  normalizeReasons,
  parseCorrectionsFile,
  serializeCorrectionsFile,
  summarizeCorrections,
  type Correction,
} from "../src/domain/correctionLog";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const row = (over: Partial<Correction> = {}): Correction => ({ chapter: 1, verse: 2, before: "Que la misericordia sea con ustedes.", after: "Que la misericordia les sea multiplicada.", reasons: ["meaning"], by: "ana", at: "2026-10-06T15:00:00Z", ...over });

test("cada persona tiene su archivo de correcciones por libro, junto a sus respuestas", () => {
  assert.equal(correctionsFilePath("jud", "Ana"), "checkings/corrections/JUD.ana.corrections.json");
  assert.notEqual(correctionsFilePath("jud", "ana"), correctionsFilePath("jud", "bea"), "dos personas nunca escriben el mismo");
});

test("de una corrección se guarda qué decía, qué dice, por qué y qué se tenía en la mano", () => {
  const kept = normalizeCorrection({ ...row(), reasons: ["meaning", "no-existe", "spelling"], note: "  «multiplicada» está en el griego  ", from: { issue: 13, task: "afinar", step: "notas", item: "x7k2", label: "mercy … be multiplied", otra: 1 } });
  assert.deepEqual(kept, {
    chapter: 1, verse: 2, before: "Que la misericordia sea con ustedes.", after: "Que la misericordia les sea multiplicada.",
    reasons: ["spelling", "meaning"], note: "«multiplicada» está en el griego",
    from: { issue: 13, task: "afinar", step: "notas", item: "x7k2", label: "mercy … be multiplied" },
    by: "ana", at: "2026-10-06T15:00:00Z",
  }, "los motivos, en el orden en que se ofrecen; lo que no es un motivo no se guarda");
  assert.deepEqual(normalizeReasons("meaning"), []);
  assert.deepEqual(normalizeReasons([...CORRECTION_REASONS].reverse()), [...CORRECTION_REASONS]);
  // A first wording has no «before»: it is still a correction. A change that changes nothing is not one.
  assert.equal(normalizeCorrection(row({ before: "" }))?.before, "");
  assert.equal(normalizeCorrection(row({ after: row().before })), null);
  assert.equal(normalizeCorrection(row({ after: "  " })), null);
  assert.equal(normalizeCorrection({ ...row(), by: "" }), null, "sin quién no es un registro");
  assert.equal(normalizeCorrection({ ...row(), from: { issue: 0, task: " " } })?.from, undefined);
});

test("un archivo se escribe y se vuelve a leer igual; lo mal formado se deja fuera sin perder lo demás", () => {
  const file = { book: "JUD", corrections: [row(), row({ verse: 3, reasons: [], at: "2026-10-06T16:00:00Z" })] };
  assert.deepEqual(parseCorrectionsFile(serializeCorrectionsFile(file), "jud"), file);
  const mixed = JSON.stringify({ corrections: [row(), { chapter: "x" }, null, row({ verse: 9 })] });
  assert.deepEqual(parseCorrectionsFile(mixed, "jud")?.corrections.map((c) => c.verse), [2, 9]);
  assert.equal(parseCorrectionsFile(mixed, "jud")?.book, "JUD");
  assert.equal(parseCorrectionsFile("no es json", "jud"), null);
  assert.equal(parseCorrectionsFile('{"book":"JUD"}', "jud"), null);
});

const all = mergeCorrectionFiles([
  { book: "JUD", corrections: [row({ at: "2026-10-06T15:00:00Z", from: { item: "x7k2", label: "mercy" } }), row({ verse: 5, reasons: ["wordChoice", "meaning"], at: "2026-10-08T10:00:00Z", from: { item: "x7k2" } })] },
  { book: "JUD", corrections: [row({ by: "Bea", reasons: [], at: "2026-10-07T09:00:00Z", before: "Que la misericordia les sea multiplicada.", after: "Que la misericordia se les multiplique.", from: { item: "kt/mercy", label: "misericordia" } })] },
]);

test("los archivos de todos se leen como una lista, en el orden en que se corrigió", () => {
  assert.deepEqual(all.map((c) => `${c.by} ${c.chapter}:${c.verse}`), ["ana 1:2", "Bea 1:2", "ana 1:5"]);
  assert.deepEqual(correctionsOfVerse(all, 1, 2).map((c) => c.by), ["Bea", "ana"], "de un versículo, la última primero");
  assert.deepEqual(correctionsOfVerse(all, 1, 9), []);
});

test("las correcciones de un libro, contadas: cuántas, de qué clase, de quién y qué las trajo", () => {
  const sum = summarizeCorrections(all);
  assert.deepEqual([sum.total, sum.verses], [3, 2]);
  assert.deepEqual(sum.byReason, [{ reason: "meaning", count: 2 }, { reason: "none", count: 1 }, { reason: "wordChoice", count: 1 }], "la que da dos motivos cuenta en los dos; la que no da ninguno también se cuenta");
  assert.deepEqual(sum.byPerson, [{ login: "ana", count: 2 }, { login: "bea", count: 1 }]);
  assert.deepEqual(sum.byItem, [{ item: "x7k2", label: "mercy", count: 2 }, { item: "kt/mercy", label: "misericordia", count: 1 }], "la nota que más correcciones trajo, primero, con el nombre con que se vio");
  assert.deepEqual(summarizeCorrections([]), { total: 0, verses: 0, byReason: [], byPerson: [], byItem: [] });
});

console.log(`\nverify-correction-log: ${passed} checks passed.`);
