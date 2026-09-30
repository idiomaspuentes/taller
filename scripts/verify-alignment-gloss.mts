/** The English gloss of each word of the original, read from the aligned ULT. */
import assert from "node:assert/strict";
import type { OriginalWordToken } from "@usfm-tools/editor-core";
import type { AlignmentGroup } from "@usfm-tools/types";
import { glossesFor, shortGloss } from "../src/domain/alignmentGloss";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const tok = (index: number, surface: string, occurrence = 1, occurrences = 1) =>
  ({ verseSid: "NEH 1:1", surface, strong: `H${index}`, lemma: surface, occurrence, occurrences, index }) as OriginalWordToken;
const ow = (content: string, occurrence = 1) => ({ strong: "H1", lemma: content, content, occurrence, occurrences: 1 });
const aw = (word: string, occurrence = 1) => ({ word, occurrence, occurrences: 1 });

// «דִּבְרֵי נְחֶמְיָה בֶּן־חֲכַלְיָה» ↔ "The words of Nehemiah the son of Hacaliah"
const original = [tok(0, "דִּבְרֵ֥י"), tok(1, "נְחֶמְיָ֖ה"), tok(2, "בֶּן"), tok(3, "חֲכַלְיָ֑ה")];
const groups: AlignmentGroup[] = [
  { sources: [ow("דִּבְרֵי")], targets: [aw("The"), aw("words"), aw("of")] },
  { sources: [ow("נְחֶמְיָה")], targets: [aw("Nehemiah")] },
  { sources: [ow("בֶּן"), ow("חֲכַלְיָה")], targets: [aw("the"), aw("son"), aw("of"), aw("Hacaliah")] },
];

test("cada palabra del original recibe las palabras inglesas que el ULT le une, sin importar los signos del hebreo", () => {
  assert.deepEqual(glossesFor(original, groups), ["The words of", "Nehemiah", "the son of Hacaliah", "the son of Hacaliah"]);
});

test("una palabra que el ULT no une a nada se queda sin glosa", () => {
  assert.deepEqual(glossesFor(original, groups.slice(0, 2)), ["The words of", "Nehemiah", "", ""]);
});

test("una palabra repetida se distingue por su ocurrencia", () => {
  const two = [tok(0, "אֱלֹהֵי", 1, 2), tok(1, "אֱלֹהֵי", 2, 2)];
  const g: AlignmentGroup[] = [
    { sources: [ow("אֱלֹהֵי", 1)], targets: [aw("God")] },
    { sources: [ow("אֱלֹהֵי", 2)], targets: [aw("gods")] },
  ];
  assert.deepEqual(glossesFor(two, g), ["God", "gods"]);
});

test("la glosa larga se acorta en una palabra entera", () => {
  assert.equal(shortGloss("the son of Hacaliah"), "the son of Hacaliah");
  assert.equal(shortGloss("in the month of Kislev in the year twenty", 22), "in the month of…");
  assert.equal(shortGloss("  "), "");
});

console.log(`\nverify-alignment-gloss: ${passed} checks passed.`);
