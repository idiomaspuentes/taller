/** The key terms of a chapter, and how each one was rendered across the book. */
import assert from "node:assert/strict";
import {
  compareTermRenderings,
  groupByTerm,
  parseArticleTitle,
  parsePreferredTerms,
  parseTermRows,
  serializePreferredTerms,
  termArticlePath,
  withPreferredTerm,
  termFromLink,
  termLabel,
} from "../src/domain/afinacionWords";
import { textFingerprint, type ReviewDecision } from "../src/domain/reviewRound";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const row = (o: Record<string, string>) => ({ Reference: "", ID: "", Tags: "", OrigWords: "", Occurrence: "1", TWLink: "", ...o });
const rows = [
  row({ Reference: "front:intro", ID: "i", TWLink: "rc://*/tw/dict/bible/kt/god" }),
  row({ Reference: "1:1", ID: "a1", OrigWords: "אֱלֹהֵי", TWLink: "rc://*/tw/dict/bible/kt/god" }),
  row({ Reference: "1:2", ID: "a2", OrigWords: "נְחֶמְיָה", TWLink: "rc://*/tw/dict/bible/names/nehemiah" }),
  row({ Reference: "1:5", ID: "a3", OrigWords: "אֱלֹהֵי", Occurrence: "2", TWLink: "rc://*/tw/dict/bible/kt/god" }),
  row({ Reference: "2:4", ID: "b1", OrigWords: "אֱלֹהֵי", TWLink: "rc://*/tw/dict/bible/kt/god" }),
  row({ Reference: "2:5", ID: "b2", OrigWords: "x", TWLink: "rc://*/tw/dict/bible/other/stronghold" }),
  row({ Reference: "2:6", ID: "", OrigWords: "x", TWLink: "rc://*/tw/dict/bible/kt/god" }),
  row({ Reference: "2:7", ID: "b3", OrigWords: "x", TWLink: "" }),
];

test("el vínculo dice el tipo y el término", () => {
  assert.deepEqual(termFromLink("rc://*/tw/dict/bible/kt/god"), { kind: "kt", slug: "god" });
  assert.deepEqual(termFromLink("rc://*/tw/dict/bible/names/nehemiah"), { kind: "names", slug: "nehemiah" });
  assert.equal(termFromLink("rc://*/ta/man/translate/figs-metaphor"), null);
  assert.equal(termLabel("biblical-time-year"), "Biblical time year");
});

test("entran las apariciones del capítulo con id y término, sin introducciones", () => {
  assert.deepEqual(parseTermRows(rows, 1).map((i) => i.id), ["w:a1", "w:a2", "w:a3"]);
  assert.deepEqual(parseTermRows(rows, 2).map((i) => i.id), ["w:b1", "w:b2"]);
  assert.equal(parseTermRows(rows).length, 5, "sin capítulo se lee el libro entero");
  const a3 = parseTermRows(rows, 1).find((i) => i.id === "w:a3")!;
  assert.deepEqual([a3.occurrence, a3.categoryLabel, a3.termSlug], [2, "Términos clave", "god"]);
});

test("los términos se agrupan en el orden en que aparecen, con sus usos en orden del libro", () => {
  const groups = groupByTerm(parseTermRows(rows));
  assert.deepEqual(groups.map((g) => [g.slug, g.uses.map((u) => u.id)]), [
    ["god", ["w:a1", "w:a3", "w:b1"]],
    ["nehemiah", ["w:a2"]],
    ["stronghold", ["w:b2"]],
  ]);
});

const god = groupByTerm(parseTermRows(rows)).find((g) => g.slug === "god")!.uses;
const verses: Record<string, string> = { "1:1": "el Dios del cielo", "1:5": "Dios del cielo", "2:4": "a la divinidad" };
const verseText = (c: number, v: number) => verses[`${c}:${v}`] ?? "";
let t = 0;
const mark = (itemId: string, text: string, chapter: number, verse: number, reviewer = "ana"): ReviewDecision =>
  ({
    itemId: `w:${itemId}`, reviewer, status: "approved", sessionId: "s", stageId: "afinacion",
    ref: { start: { chapter, verse } },
    selectedText: { text, startOffset: 0, endOffset: text.length, verseSnapshots: [] },
    textHash: textFingerprint(verseText(chapter, verse)),
    timestamp: new Date(Date.UTC(2026, 9, 1, 12, ++t)).toISOString(),
  }) as ReviewDecision;

test("se agrupa por cómo se tradujo y se ve si es consistente", () => {
  const same = compareTermRenderings({ uses: god.slice(0, 2), decisions: [mark("a1", "Dios", 1, 1), mark("a3", "dios", 1, 5)], verseText });
  assert.equal(same.consistent, true, "«Dios» y «dios» es la misma traducción");
  assert.equal(same.renderings.length, 1);
  assert.equal(same.renderings[0]!.uses.length, 2);

  const mixed = compareTermRenderings({ uses: god, decisions: [mark("a1", "Dios", 1, 1), mark("a3", "Dios", 1, 5), mark("b1", "divinidad", 2, 4)], verseText });
  assert.equal(mixed.consistent, false);
  assert.deepEqual(mixed.renderings.map((r) => [r.text, r.uses.length]), [["Dios", 2], ["divinidad", 1]], "la más usada primero");
});

test("lo que nadie marcó queda aparte, y una marca de un versículo que cambió ya no vale", () => {
  const r = compareTermRenderings({ uses: god, decisions: [mark("a1", "Dios", 1, 1)], verseText });
  assert.deepEqual(r.unmarked.map((u) => u.id), ["w:a3", "w:b1"]);
  const oldMark = mark("a1", "Dios", 1, 1);
  verses["1:1"] = "el Señor del cielo";
  const after = compareTermRenderings({ uses: god, decisions: [oldMark], verseText: (c, v) => (c === 1 && v === 1 ? "el Señor del cielo" : verseText(c, v)) });
  assert.deepEqual(after.unmarked.map((u) => u.id), ["w:a1", "w:a3", "w:b1"]);
});

test("cuenta la marca más reciente de cada uso", () => {
  verses["1:1"] = "el Dios del cielo";
  const r = compareTermRenderings({ uses: god.slice(0, 1), decisions: [mark("a1", "divinidad", 1, 1, "bea"), mark("a1", "Dios", 1, 1, "ana")], verseText });
  assert.deepEqual(r.renderings.map((x) => x.text), ["Dios"]);
});

test("el título del artículo es su primer encabezado; sin artículo se usa el nombre del término", () => {
  const NL = String.fromCharCode(10);
  assert.equal(parseArticleTitle(["# Dios", "", "## Definición", "Texto"].join(NL)), "Dios");
  assert.equal(parseArticleTitle(["Sin encabezado", "## Otro"].join(NL)), null);
  assert.equal(termArticlePath("kt", "god"), "bible/kt/god.md");
  assert.equal(termLabel("god", { god: "Dios" }), "Dios");
  assert.equal(termLabel("biblical-time-year", {}), "Biblical time year");
});

test("la traducción preferida se elige, se cambia y se quita", () => {
  let terms = withPreferredTerm({}, "god", " Dios ", "ana", "2026-10-01");
  assert.deepEqual(terms, { god: { text: "Dios", by: "ana", at: "2026-10-01" } });
  terms = withPreferredTerm(terms, "god", "Elohim", "bea", "2026-10-02");
  assert.equal(terms.god?.text, "Elohim");
  assert.deepEqual(withPreferredTerm(terms, "god", "  ", "bea", "x"), {});
  assert.deepEqual(parsePreferredTerms(serializePreferredTerms(terms)), terms);
  assert.deepEqual(parsePreferredTerms("no es json"), {});
});

test("los usos que no dicen lo mismo que la preferida se marcan", () => {
  const uses = parseTermRows(rows, 1).filter((u) => u.termSlug === "god");
  const mark = (id: string, text: string): ReviewDecision =>
    ({ itemId: id, reviewer: "ana", status: "approved", selectedText: { text }, textHash: textFingerprint("v"), timestamp: "2026-10-01T10:00:00Z", ref: { start: { chapter: 1, verse: 1 } }, sessionId: "s", stageId: "afinacion" }) as unknown as ReviewDecision;
  const cmp = compareTermRenderings({ uses, decisions: [mark(uses[0]!.id, "Dios"), mark(uses[1]!.id, "Señor")], verseText: () => "v", preferred: "dios" });
  assert.deepEqual(cmp.differing.map((u) => u.id), [uses[1]!.id]);
  assert.deepEqual(compareTermRenderings({ uses, decisions: [], verseText: () => "v" }).differing, []);
});

console.log(`\nverify-afinacion-words: ${passed} checks passed.`);
