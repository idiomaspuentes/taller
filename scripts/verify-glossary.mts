/**
 * The glossary of translation decisions: its TSV, what a passage shows, an entry born from a tap on an aligned word
 * (small words left out), and how a word was translated before.
 */
import assert from "node:assert/strict";
import type { AlignmentGroup } from "@usfm-tools/types";
import {
  baseStrong,
  changeNeedsAgreement,
  contentSources,
  departuresFrom,
  entriesForPassage,
  entryFromSources,
  glossaryFileFor,
  groupOfWord,
  indexRenderings,
  renderingsAcross,
  newGlossaryId,
  parseGlossary,
  renderingsOf,
  searchGlossary,
  serializeGlossary,
  upsertGlossaryEntry,
  type GlossaryEntry,
} from "../src/domain/glossary";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const src = (strong: string, lemma: string, morph: string, content = lemma) => ({ strong, lemma, morph, content, occurrence: 1, occurrences: 1 });
const tgt = (word: string, occurrence = 1) => ({ word, occurrence, occurrences: 1 });
const redeem: GlossaryEntry = {
  id: "r4k2", lemma: "λυτρόω", strong: "G30840", english: ["redeem", "ransom"], sense: "liberar pagando un precio", rendering: "redimir",
  alternatives: ["rescatar: liberación física"], avoid: ["liberar: pierde la idea del precio"], scope: "tpl", variants: ["redención"], twLink: "rc://*/tw/dict/bible/kt/redeem",
  examples: ["TIT 2:14"], status: "agreed", note: "Conserva la metáfora del rescate",
};

test("el archivo se lee y se escribe igual, con sus catorce columnas", () => {
  const tsv = serializeGlossary([redeem]);
  assert.equal(tsv.split("\n")[0]!.split("\t").length, 14);
  assert.deepEqual(parseGlossary(tsv), [redeem]);
  assert.deepEqual(parseGlossary(""), []);
  assert.equal(parseGlossary(serializeGlossary([{ ...redeem, note: "con\ttabulador\ny salto" }]))[0]!.note, "con tabulador y salto");
});

test("cada entrada va al archivo de su idioma de origen; el prefijo hebreo no cuenta", () => {
  assert.equal(glossaryFileFor("G30840"), "tg_grc.tsv");
  assert.equal(glossaryFileFor("b:H1004"), "tg_hbo.tsv");
  assert.equal(glossaryFileFor(""), "tg_en.tsv");
  assert.equal(baseStrong("c:d:H4428"), "H4428");
});

test("un identificador nuevo no repite ninguno", () => {
  const sequence = [0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5];
  let i = 0;
  assert.equal(newGlossaryId(["aaaa"], () => sequence[i++]!), "nsss");
  assert.match(newGlossaryId([]), /^[a-z][a-z0-9]{3}$/);
});

test("crear o trabajar una propuesta es libre; cambiar lo acordado pide acuerdo", () => {
  const proposed = { ...redeem, status: "proposed" as const };
  assert.equal(changeNeedsAgreement(undefined, proposed), false);
  assert.equal(changeNeedsAgreement(proposed, { ...proposed, rendering: "rescatar" }), false);
  assert.equal(changeNeedsAgreement(redeem, { ...redeem, rendering: "rescatar" }), true);
  assert.equal(changeNeedsAgreement(redeem, { ...redeem, examples: [...redeem.examples, "LUK 24:21"] }), false, "agregar un ejemplo no cambia la decisión");
  assert.deepEqual(upsertGlossaryEntry([redeem], { ...redeem, sense: "otro" }).map((e) => e.sense), ["otro"]);
  assert.equal(upsertGlossaryEntry([redeem], { ...redeem, id: "zzzz" }).length, 2);
});

test("se busca en cualquier idioma y sin importar los acentos", () => {
  const entries = [redeem, { ...redeem, id: "g1", lemma: "χάρις", strong: "G54850", english: ["grace"], rendering: "gracia", alternatives: [], variants: [] }];
  assert.deepEqual(searchGlossary(entries, "redencion").map((e) => e.id), ["r4k2"]);
  assert.deepEqual(searchGlossary(entries, "GRACE").map((e) => e.id), ["g1"]);
  assert.deepEqual(searchGlossary(entries, "χαρις").map((e) => e.id), ["g1"]);
  assert.equal(searchGlossary(entries, "").length, 2);
});

test("un pasaje muestra solo las entradas de sus palabras; una expresión, cuando están todas", () => {
  const expression = { ...redeem, id: "son1", lemma: "υἱός + ἄνθρωπος", strong: "G52070;G04440", english: ["Son of Man"] };
  const englishOnly = { ...redeem, id: "en01", lemma: "sound teaching", strong: "", english: ["sound teaching"] };
  const entries = [redeem, expression, englishOnly];
  const words = [src("G30840", "λυτρόω", "Gr,V"), src("G52070", "υἱός", "Gr,N")];
  assert.deepEqual(entriesForPassage(entries, words).map((e) => e.id), ["r4k2"]);
  assert.deepEqual(entriesForPassage(entries, [...words, src("G04440", "ἄνθρωπος", "Gr,N")]).map((e) => e.id), ["r4k2", "son1"]);
  assert.deepEqual(entriesForPassage(entries, [], "speak what fits with sound teaching.").map((e) => e.id), ["en01"]);
});

const group: AlignmentGroup = { sources: [src("G35880", "ὁ", "Gr,EA,,,,NFS,"), src("G54850", "χάρις", "Gr,N,,,,,NFS,")], targets: [tgt("the"), tgt("grace")] };

test("al tocar una palabra alineada se toma la de contenido y se dejan las pequeñas", () => {
  assert.deepEqual(contentSources(group).map((s) => s.lemma), ["χάρις"]);
  const hebrew: AlignmentGroup = { sources: [src("b:H1004", "בַּיִת", "He,R:Ncmsa")], targets: [tgt("in"), tgt("house")] };
  assert.deepEqual(contentSources(hebrew).map((s) => s.lemma), ["בַּיִת"], "el prefijo va con la palabra base");
  const small: AlignmentGroup = { sources: [src("G25320", "καί", "Gr,CC,,,,,,,,")], targets: [tgt("and")] };
  assert.deepEqual(contentSources(small).map((s) => s.lemma), ["καί"], "si solo hay pequeñas, se ofrecen");
  assert.equal(groupOfWord([group], "grace,", 1), group);
  assert.equal(groupOfWord([group], "grace", 2), undefined);
  const entry = entryFromSources({ id: "g1aa", sources: contentSources(group), english: "grace", example: "TIT 2:11" });
  assert.deepEqual([entry.lemma, entry.strong, entry.english, entry.examples, entry.status], ["χάρις", "G54850", ["grace"], ["TIT 2:11"], "proposed"]);
  assert.equal(entryFromSources({ id: "x", sources: [src("c:H4428", "מֶלֶךְ", "He,C:Ncmsa")], english: "king", example: "" }).strong, "H4428");
});

const verses: Record<string, AlignmentGroup[]> = {
  "TIT 2:14": [{ sources: [src("G30840", "λυτρόω", "Gr,V")], targets: [tgt("redimiese")] }],
  "TIT 3:5": [{ sources: [src("G30840", "λυτρόω", "Gr,V")], targets: [tgt("Liberó,")] }],
  "LUK 24:21": [{ sources: [src("G30840", "λυτρόω", "Gr,V")], targets: [tgt("liberó")] }, { sources: [src("G54850", "χάρις", "Gr,N")], targets: [tgt("gracia")] }],
};

test("cómo se tradujo antes sale de la alineación, con cuántas veces y dónde", () => {
  assert.deepEqual(renderingsOf("G30840", verses), [
    { rendering: "liberó", count: 2, examples: ["TIT 3:5", "LUK 24:21"] },
    { rendering: "redimiese", count: 1, examples: ["TIT 2:14"] },
  ]);
  assert.deepEqual(renderingsOf("", verses), []);
});

test("el índice de un libro tiene todas sus palabras, y varios libros se suman", () => {
  const titus = indexRenderings({ "TIT 2:14": verses["TIT 2:14"]!, "TIT 3:5": verses["TIT 3:5"]! });
  const luke = indexRenderings({ "LUK 24:21": verses["LUK 24:21"]! });
  assert.deepEqual(Object.keys(luke), ["G30840", "G54850"]);
  assert.deepEqual(titus["G30840"], renderingsOf("G30840", { "TIT 2:14": verses["TIT 2:14"]!, "TIT 3:5": verses["TIT 3:5"]! }), "igual que mirar una sola palabra");
  assert.deepEqual(renderingsAcross("G30840", [titus, luke]), renderingsOf("G30840", verses), "sumar los libros da lo mismo que tenerlos juntos");
  assert.deepEqual(renderingsAcross("b:G54850", [titus, luke]).map((r) => r.rendering), ["gracia"]);
  assert.deepEqual(renderingsAcross("G00000", [titus, luke]), []);
});

test("donde el texto se aparta de una decisión acordada", () => {
  const agreed = { ...redeem, rendering: "redimi", variants: [], alternatives: ["rescat: liberación física"] };
  assert.deepEqual(departuresFrom(agreed, verses).map((r) => r.rendering), ["liberó"]);
  assert.deepEqual(departuresFrom({ ...agreed, status: "proposed" }, verses), [], "una propuesta no obliga");
});

console.log(`\nverify-glossary: ${passed} checks passed.`);
