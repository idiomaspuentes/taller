/**
 * Fixing the quote of a note by marking words in the aligned text: the quote of the original is worked out from the
 * alignment, in the order of the original.
 */
import assert from "node:assert/strict";
import type { AlignmentGroup } from "@usfm-tools/types";
import { originalTokens, quoteFromSelection, withQuote } from "../src/domain/quoteFromSelection";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const w = (word: string) => `\\w ${word}|lemma="x" strong="G1"\\w*`;
const original = ["\\id TIT", "\\c 2", "\\p", `\\v 1 ${w("σὺ")} ${w("δὲ")} ${w("λάλει")} ${w("ἃ")} ${w("πρέπει")} ${w("τῇ")} ${w("ὑγιαινούσῃ")} ${w("διδασκαλίᾳ")}.`, `\\v 2 ${w("τῇ")} ${w("πίστει")}, ${w("τῇ")} ${w("ἀγάπῃ")}`, ""].join("\n");

test("las palabras del original salen en orden, con su ocurrencia", () => {
  assert.deepEqual(originalTokens(original, 2, 1).map((t) => t.content), ["σὺ", "δὲ", "λάλει", "ἃ", "πρέπει", "τῇ", "ὑγιαινούσῃ", "διδασκαλίᾳ"]);
  assert.deepEqual(originalTokens(original, 2, 2).map((t) => `${t.content}#${t.occurrence}`), ["τῇ#1", "πίστει#1", "τῇ#2", "ἀγάπῃ#1"]);
  assert.deepEqual(originalTokens(original, 2, 9), []);
});

const src = (content: string, occurrence = 1) => ({ strong: "", lemma: "", content, occurrence, occurrences: 1 });
const tgt = (word: string, occurrence = 1) => ({ word, occurrence, occurrences: 1 });
// Pero tú habla lo que conviene a la sana doctrina
const verseTokens = ["Pero", "tú", "habla", "lo", "que", "conviene", "a", "la", "sana", "doctrina:"];
const groups: AlignmentGroup[] = [
  { sources: [src("σὺ")], targets: [tgt("tú")] },
  { sources: [src("δὲ")], targets: [tgt("Pero")] },
  { sources: [src("λάλει")], targets: [tgt("habla")] },
  { sources: [src("ἃ")], targets: [tgt("lo"), tgt("que")] },
  { sources: [src("πρέπει")], targets: [tgt("conviene"), tgt("a")] },
  { sources: [src("τῇ")], targets: [tgt("la")] },
  { sources: [src("ὑγιαινούσῃ")], targets: [tgt("sana")] },
  { sources: [src("διδασκαλίᾳ")], targets: [tgt("doctrina")] },
];
const tokens = originalTokens(original, 2, 1);

test("marcar palabras seguidas da la cita en el orden del original, no en el del español", () => {
  // «Pero tú» → σὺ δὲ (the original has them the other way round)
  assert.deepEqual(quoteFromSelection({ verseTokens, selected: [0, 1], groups, original: tokens }), { quote: "σὺ δὲ", occurrence: 1 });
  assert.deepEqual(quoteFromSelection({ verseTokens, selected: [8, 9], groups, original: tokens }), { quote: "ὑγιαινούσῃ διδασκαλίᾳ", occurrence: 1 });
});

test("palabras que no están juntas en el original se unen con «&»", () => {
  assert.equal(quoteFromSelection({ verseTokens, selected: [2, 9], groups, original: tokens })!.quote, "λάλει & διδασκαλίᾳ");
  assert.equal(quoteFromSelection({ verseTokens, selected: [0, 1, 2, 9], groups, original: tokens })!.quote, "σὺ δὲ λάλει & διδασκαλίᾳ");
});

test("una palabra repetida lleva la ocurrencia de la que se marcó; lo no alineado no da cita", () => {
  const faith = ["en", "la", "fe,", "en", "el", "amor"];
  const twice: AlignmentGroup[] = [
    { sources: [src("τῇ", 1)], targets: [tgt("en", 1), tgt("la")] },
    { sources: [src("πίστει")], targets: [tgt("fe")] },
    { sources: [src("τῇ", 2)], targets: [tgt("en", 2), tgt("el")] },
    { sources: [src("ἀγάπῃ")], targets: [tgt("amor")] },
  ];
  const v2 = originalTokens(original, 2, 2);
  assert.deepEqual(quoteFromSelection({ verseTokens: faith, selected: [3, 4, 5], groups: twice, original: v2 }), { quote: "τῇ ἀγάπῃ", occurrence: 2 });
  assert.equal(quoteFromSelection({ verseTokens: ["suelta"], selected: [0], groups: twice, original: v2 }), null);
});

test("la cita se cambia en su fila y nada más", () => {
  const tsv = "Reference\tID\tTags\tSupportReference\tQuote\tOccurrence\tNote\r\n2:1\tgp2z\t\t\tvieja\t1\tNota\r\n2:2\tabcd\t\t\tq\t1\tOtra\r\n";
  const next = withQuote(tsv, "gp2z", "σὺ δὲ", 1)!;
  assert.equal(next.split("\r\n")[1], "2:1\tgp2z\t\t\tσὺ δὲ\t1\tNota");
  assert.equal(next.split("\r\n")[2], "2:2\tabcd\t\t\tq\t1\tOtra");
  assert.equal(withQuote(tsv, "zzzz", "x", 1), null);
});

console.log(`\nverify-quote-selection: ${passed} checks passed.`);
