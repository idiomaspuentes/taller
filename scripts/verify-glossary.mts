/**
 * The glossary of translation decisions: its TSV, what a passage shows, what is said beside a verse (found by the
 * word of the original under each English word), an entry born from a tap on an aligned word (small words left
 * out), and how a word was translated before.
 */
import assert from "node:assert/strict";
import type { AlignmentGroup } from "@usfm-tools/types";
import {
  avoided,
  baseStrong,
  changeNeedsAgreement,
  contentSources,
  decisionsForText,
  decisionsForVerse,
  departuresFrom,
  entriesForPassage,
  entriesUnder,
  entryFromSources,
  filedUnder,
  glossaryFileFor,
  groupOfWord,
  groupsOfVerse,
  indexRenderings,
  namedWordings,
  renderingsAcross,
  newGlossaryId,
  parseGlossary,
  renderingsOf,
  searchGlossary,
  serializeGlossary,
  sourcesUnder,
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
  // The decision is written as «redimir»; the text says «redimiese». It is the same word.
  assert.deepEqual(departuresFrom({ ...redeem, alternatives: [], variants: [] }, verses).map((r) => r.rendering), ["liberó"], "una forma conjugada no es apartarse");
});

// Jude 1:1 in the two English texts, each aligned with the same Greek.
const judeUlt: AlignmentGroup[] = [
  { sources: [src("G24550", "Ἰούδας", "Gr,N")], targets: [tgt("Jude,")] },
  { sources: [src("G14010", "δοῦλος", "Gr,N")], targets: [tgt("a"), tgt("servant")] },
  { sources: [src("G55470", "Χριστός", "Gr,N")], targets: [tgt("Christ")] },
  { sources: [src("G23850", "Ἰάκωβος", "Gr,N")], targets: [tgt("of"), tgt("James,")] },
];
const judeUst: AlignmentGroup[] = [
  { sources: [src("G24550", "Ἰούδας", "Gr,N")], targets: [tgt("Jude,")] },
  { sources: [src("G14010", "δοῦλος", "Gr,N")], targets: [tgt("serve")] },
  { sources: [src("G55470", "Χριστός", "Gr,N")], targets: [tgt("the"), tgt("Messiah,")] },
  { sources: [src("G23850", "Ἰάκωβος", "Gr,N")], targets: [tgt("of"), tgt("James.")] },
];
const entry = (over: Partial<GlossaryEntry>): GlossaryEntry => ({ ...redeem, alternatives: [], avoid: [], variants: [], examples: [], twLink: "", sense: "", note: "", scope: "all", status: "proposed", ...over });
const james = entry({ id: "ja01", lemma: "Ἰάκωβος", strong: "G23850", english: ["James"], rendering: "Jacobo", avoid: ["Santiago: es otro nombre en nuestras Biblias"] });
const christ = entry({ id: "ch01", lemma: "Χριστός", strong: "G55470", english: ["Christ"], rendering: "Cristo", status: "agreed" });
const servant = entry({ id: "se01", lemma: "δοῦλος", strong: "G14010", english: ["servant"], rendering: "siervo", scope: "tpl" });

test("junto a un versículo sale la decisión de cada palabra, hallada por la palabra del original que está debajo", () => {
  const said = (groups: AlignmentGroup[], text: "tpl" | "tps" | "helps", list = [james, christ, servant]) => decisionsForVerse(list, groups, text).map((d) => `${d.english} → ${d.entry.rendering}${d.decidedFor ? ` (${d.decidedFor})` : ""}`);
  // The decision was taken on «James» of one text: it is found at «James» of the other, by the Greek under both.
  // Of the two English words that stand on it («of James») the one the decision names is the one said.
  assert.deepEqual(said(judeUlt, "tpl"), ["Christ → Cristo", "James → Jacobo", "servant → siervo"], "lo acordado va primero");
  // Where the other text put the same word of the original another way, the decision is still that word's:
  // it says which English it was taken on, so nobody reads it as decided for this one.
  assert.deepEqual(said(judeUst, "tps"), ["the Messiah → Cristo (Christ)", "James → Jacobo"]);
  assert.deepEqual(said(judeUst, "tps", [{ ...servant, scope: "all" }]), ["serve → siervo"], "«serve» y «servant» son la misma palabra");
  // The same word of the original may have a decision for each English word: the verse's own is the one said.
  const messiah = entry({ id: "me01", lemma: "Χριστός", strong: "G55470", english: ["Messiah"], rendering: "Mesías" });
  assert.deepEqual(said(judeUst, "tps", [christ, messiah]), ["Messiah → Mesías"]);
  assert.deepEqual(said(judeUlt, "tpl", [christ, messiah]), ["Christ → Cristo"]);
  assert.deepEqual([entriesUnder([christ], "G55470", "Messiah").existing?.id, entriesUnder([christ], "G55470", "Messiah").other?.id], [undefined, "ch01"], "«Messiah» todavía no tiene decisión; se dice la de «Christ»");
  assert.equal(entriesUnder([christ, messiah], "G55470", "Messiah").existing?.id, "me01");
  assert.equal(entriesUnder([christ], "G55470", "Christ").existing?.id, "ch01");
  assert.deepEqual(entriesUnder([christ], "G23850", "James"), { existing: undefined, other: undefined });
  assert.deepEqual(said(judeUlt, "tpl", [entry({ id: "x", strong: "G23850", english: ["James"], rendering: "" })]), [], "una entrada sin traducción no dice nada");
  assert.deepEqual(said(judeUlt, "helps", [servant]), [], "lo decidido solo para el TPL no sale en otro texto");
  // An expression is there when every word of it is; a verse without the word has no decision.
  // It reads in the order of the verse, whatever the order its words were filed in.
  const expression = entry({ id: "ex01", lemma: "Χριστός + Ἰησοῦς", strong: "G55470;G24240", english: ["Jesus Christ"], rendering: "Jesucristo" });
  assert.deepEqual(said(judeUlt, "tpl", [expression]), []);
  assert.deepEqual(said([...judeUlt.slice(0, 2), { sources: [src("G24240", "Ἰησοῦς", "Gr,N")], targets: [tgt("of"), tgt("Jesus")] }, ...judeUlt.slice(2)], "tpl", [expression]), ["Jesus Christ → Jesucristo"]);
  assert.deepEqual(said([], "tpl"), []);
  // An entry that has no word of the original yet is found by its English term in the verse.
  const english = entry({ id: "en02", lemma: "sound teaching", strong: "", english: ["sound teaching"], rendering: "sana enseñanza" });
  assert.deepEqual(decisionsForVerse([english], [], "tpl", "speak what fits with sound teaching.").map((d) => d.english), ["sound teaching"]);
  assert.deepEqual(decisionsForVerse([english], [], "tpl", "speak of unsound teachings"), []);
  assert.deepEqual(avoided(james), ["Santiago"]);
});

test("las alineaciones de un versículo se encuentran por su referencia", () => {
  const book = { "JUD 1:1": judeUlt, "JUD 1:2": [], "JUD 1:11": judeUst };
  assert.equal(groupsOfVerse(book, 1, 1), judeUlt);
  assert.equal(groupsOfVerse(book, 1, 11), judeUst);
  assert.deepEqual(groupsOfVerse(book, 2, 1), []);
  assert.deepEqual(groupsOfVerse(undefined, 1, 1), []);
});

test("de un comentario sale una entrada: las palabras tocadas llevan a la del original, y el comentario ya nombra la traducción", () => {
  // «James» of the verse stands on Ἰάκωβος with «of»: the entry is filed by the Greek, and says «James».
  const under = sourcesUnder(judeUst, ["james"]);
  assert.deepEqual([under?.english, under?.strong, under?.sources.map((s) => s.lemma)], ["James", "G23850", ["Ἰάκωβος"]]);
  // Several words make an expression, in the order of the verse whatever the order they were touched in.
  assert.deepEqual([sourcesUnder(judeUst, ["messiah", "jude"])?.english, sourcesUnder(judeUst, ["messiah", "jude"])?.strong], ["Jude Messiah", "G24550;G55470"]);
  assert.equal(sourcesUnder(judeUst, ["writing"]), null, "una palabra sin alinear no tiene de dónde colgar");
  assert.equal(sourcesUnder(judeUst, []), null);
  // The entry it makes is found again at the verse, in either English text.
  const made = { ...entryFromSources({ id: "n1", sources: under!.sources, english: under!.english, example: "JUD 1:1" }), rendering: "Jacobo" };
  assert.deepEqual(decisionsForVerse([made], judeUlt, "tpl").map((d) => `${d.english} → ${d.entry.rendering}`), ["James → Jacobo"]);
  // What the comment says between quotation marks is offered to touch; without marks, its longer words.
  assert.deepEqual(namedWordings("Escribimos «Jacobo», no «Santiago»."), ["Jacobo", "Santiago"]);
  assert.deepEqual(namedWordings('Aquí es "siervo", y otra vez «siervo»'), ["siervo"]);
  assert.deepEqual(namedWordings("Usa Jacobo, no Santiago"), ["Jacobo", "Santiago"], "sin comillas, los nombres");
  assert.deepEqual(namedWordings("Falta traducir el título. Revisa también la definición."), [], "un comentario que no nombra ninguna no ofrece sus otras palabras");
  assert.deepEqual(namedWordings(""), []);
});

test("junto a una nota o un párrafo sale la decisión de las palabras inglesas que dice", () => {
  const said = (text: string, list = [james, christ, servant]) => decisionsForText(list, text).map((d) => `${d.english} → ${d.entry.rendering}`);
  // A note quotes the literal text in bold and explains it: what was decided on those words is said beside it.
  assert.deepEqual(said("**a brother of James** Here, Jude says that he is the brother of James."), ["James → Jacobo"]);
  assert.deepEqual(said("Paul calls himself one of the **servants** of Christ. See [[rc://*/tw/dict/bible/names/james]]."), ["Christ → Cristo", "servant → siervo"], "el plural es la misma palabra; la dirección de un enlace no es texto");
  assert.deepEqual(said("James' letter"), ["James → Jacobo"]);
  assert.deepEqual(said("The jameson family"), [], "dentro de otra palabra no cuenta");
  // What was decided for the simplified text alone is not a note's; an entry without a translation says nothing.
  assert.deepEqual(said("the Messiah", [entry({ id: "m", strong: "G55470", english: ["Messiah"], rendering: "Mesías", scope: "tps" })]), []);
  assert.deepEqual(said("James", [{ ...james, rendering: "" }]), []);
  assert.deepEqual(said(""), []);
  // An entry filed by its English word alone is found by it, in a note and in a verse.
  const english = entry({ id: "en03", lemma: "apostle", strong: "", english: [], rendering: "apóstol" });
  assert.deepEqual(said("the apostles were sent", [english]), ["apostle → apóstol"]);
});

test("de un comentario sobre una nota o un artículo también sale una entrada: por el original si la palabra está en el versículo, y si no por el inglés", () => {
  // A note of Jude 1:1 says «James»: the verse has it, in either English text, so the entry hangs from the Greek.
  const inVerse = filedUnder([], ["James"], [judeUlt, judeUst], true);
  assert.deepEqual([inVerse?.english, inVerse?.strong], ["James", "G23850"]);
  // «Messiah» is only in the simplified text: found in the second.
  assert.equal(filedUnder([], ["Messiah"], [judeUlt, judeUst], true)?.strong, "G55470");
  // A word that is in no verse (an article has none): filed by the English word, to be tied to the original later.
  const alone = filedUnder([], ["apostle"], [], true);
  assert.deepEqual([alone?.english, alone?.strong, alone?.sources], ["apostle", "", []]);
  assert.equal(entryFromSources({ id: "a1", sources: alone!.sources, english: alone!.english, example: "" }).lemma, "apostle");
  assert.equal(glossaryFileFor(alone!.strong), "tg_en.tsv");
  // A verse of a text is never filed by the English alone: a word of it that is not aligned has nothing to hang from.
  assert.equal(filedUnder([], ["writing"], [judeUst], false), null);
  // The entry that names the word already is the one there is, whichever way it was filed.
  assert.equal(filedUnder([james], ["James"], [], true)?.existing?.id, "ja01");
  assert.equal(filedUnder([james], ["James"], [judeUlt], false)?.existing?.id, "ja01");
});

console.log(`\nverify-glossary: ${passed} checks passed.`);
