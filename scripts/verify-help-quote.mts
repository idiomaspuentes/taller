/**
 * The words of a text a help's quote of the original points at, found through the alignment: which occurrence of
 * the quote, when the verse says it more than once.
 */
import assert from "node:assert/strict";
import type { AlignmentGroup } from "@usfm-tools/types";
import { alignedGatewayQuoteForHelpQuote, matchHelpEntryToTokenIndicesByAlignment, matchHelpQuoteToTokenIndices, tokenizeVersePlainText } from "../src/domain/helpQuoteMatch";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const src = (content: string, occurrence = 1, occurrences = 1) => ({ strong: "", lemma: content, content, occurrence, occurrences });
const tgt = (word: string, occurrence = 1, occurrences = 1) => ({ word, occurrence, occurrences });
const group = (source: ReturnType<typeof src>, ...targets: ReturnType<typeof tgt>[]): AlignmentGroup => ({ sources: [source], targets });

// Titus 1:1 as the team's literal text has it aligned: «Θεοῦ» twice, each over its own «de Dios».
const verse = "Pablo, siervo de Dios y apóstol de Jesucristo, conforme a la fe de los elegidos de Dios y al conocimiento";
const tokens = tokenizeVersePlainText(verse);
const groups: AlignmentGroup[] = [
  group(src("Παῦλος"), tgt("Pablo")),
  group(src("δοῦλος"), tgt("siervo")),
  group(src("Θεοῦ", 1, 2), tgt("de", 1, 4), tgt("Dios", 1, 2)),
  group(src("δὲ"), tgt("y", 1, 2)),
  group(src("ἀπόστολος"), tgt("apóstol")),
  group(src("Ἰησοῦ"), tgt("de", 2, 4), tgt("Jesucristo")),
  group(src("κατὰ"), tgt("conforme")),
  group(src("πίστιν"), tgt("a"), tgt("la"), tgt("fe")),
  group(src("ἐκλεκτῶν"), tgt("de", 3, 4), tgt("los"), tgt("elegidos")),
  group(src("Θεοῦ", 2, 2), tgt("de", 4, 4), tgt("Dios", 2, 2)),
  group(src("καὶ"), tgt("y", 2, 2)),
  group(src("ἐπίγνωσιν"), tgt("al"), tgt("conocimiento")),
];
const at = (quote: string, occurrence: number) => matchHelpEntryToTokenIndicesByAlignment(tokens, quote, occurrence, groups).map((i) => `${i}:${tokens[i]}`);

test("la segunda vez que el versículo dice una palabra es la segunda, no otra vez la primera", () => {
  assert.deepEqual(at("Θεοῦ", 1), ["2:de", "3:Dios"]);
  // It used to be «2:de 3:Dios» again: every word before the first «Θεοῦ» found that same one, and each was counted.
  assert.deepEqual(at("Θεοῦ", 2), ["15:de", "16:Dios"]);
  assert.deepEqual(at("Θεοῦ", 3), [], "no hay una tercera");
  assert.deepEqual(at("δοῦλος", 1), ["1:siervo"]);
  assert.deepEqual(at("δοῦλος", 2), [], "ni una segunda de lo que se dice una vez");
});

test("una cita de varias palabras también cuenta sus apariciones una vez cada una", () => {
  assert.deepEqual(at("δοῦλος Θεοῦ", 1), ["1:siervo", "2:de", "3:Dios"]);
  assert.deepEqual(at("ἐκλεκτῶν Θεοῦ", 1), ["12:de", "13:los", "14:elegidos", "15:de", "16:Dios"]);
  assert.deepEqual(at("ἐκλεκτῶν Θεοῦ", 2), []);
  // Two parts joined by «&» are found each on its own.
  assert.deepEqual(at("δοῦλος & ἀπόστολος", 1), ["1:siervo", "5:apóstol"]);
});

test("la frase que se le muestra a la persona es la del lugar correcto", () => {
  const phrase = (occurrence: number) => alignedGatewayQuoteForHelpQuote({ verseText: verse, quote: "Θεοῦ", occurrence, alignments: { "TIT 1:1": groups }, book: "TIT", chapter: 1, verse: 1 });
  assert.deepEqual(phrase(1), { gatewayText: "de Dios", tokenIndices: [2, 3] });
  assert.deepEqual(phrase(2), { gatewayText: "de Dios", tokenIndices: [15, 16] }, "dice lo mismo, pero está en otro sitio del versículo");
  assert.deepEqual(alignedGatewayQuoteForHelpQuote({ verseText: verse, quote: "χάρις", occurrence: 1, alignments: { "TIT 1:1": groups }, book: "TIT", chapter: 1, verse: 1 }), { gatewayText: null, tokenIndices: [] });
});

test("una cita con una coma dentro se encuentra en el versículo, que también la tiene", () => {
  // Jude 1:1–2 as the notes quote them: the comma is inside the quote.
  const one = tokenizeVersePlainText("Ἰούδας, Ἰησοῦ Χριστοῦ δοῦλος, ἀδελφὸς δὲ Ἰακώβου; τοῖς ἐν Θεῷ Πατρὶ ἠγαπημένοις,");
  assert.deepEqual(matchHelpQuoteToTokenIndices(one, "Ἰησοῦ Χριστοῦ δοῦλος, ἀδελφὸς δὲ Ἰακώβου", 1), [1, 2, 3, 4, 5, 6]);
  const two = tokenizeVersePlainText("ἔλεος ὑμῖν, καὶ εἰρήνη, καὶ ἀγάπη πληθυνθείη.");
  assert.deepEqual(matchHelpQuoteToTokenIndices(two, "ἔλεος ὑμῖν, καὶ εἰρήνη, καὶ ἀγάπη πληθυνθείη", 1), [0, 1, 2, 3, 4, 5, 6]);
  // In two stretches, the second with commas of its own.
  assert.deepEqual(matchHelpQuoteToTokenIndices(two, "ἔλεος & καὶ εἰρήνη, καὶ ἀγάπη πληθυνθείη", 1), [0, 2, 3, 4, 5, 6]);
  // What was found before is found as before.
  assert.deepEqual(matchHelpQuoteToTokenIndices(two, "ὑμῖν", 1), [1]);
  assert.deepEqual(matchHelpQuoteToTokenIndices(two, "καὶ", 2), [4]);
  assert.deepEqual(matchHelpQuoteToTokenIndices(one, "ἀδελφὸς & Ἰακώβου", 1), [4, 6]);
});

console.log(`\nverify-help-quote: ${passed} checks passed.`);
