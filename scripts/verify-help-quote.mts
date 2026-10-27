/**
 * The words of a text a help's quote of the original points at, found through the alignment: which occurrence of
 * the quote, when the verse says it more than once.
 */
import assert from "node:assert/strict";
import type { AlignmentGroup } from "@usfm-tools/types";
import { alignedGatewayQuoteForHelpQuote, helpQuoteInTexts, matchHelpEntryToTokenIndicesByAlignment, matchHelpQuoteThroughOriginal, matchHelpQuoteToTokenIndices, tokenizeVersePlainText, tokensSayingTheSame } from "../src/domain/helpQuoteMatch";

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

test("las palabras de un texto que dicen lo que dice una palabra del otro: las enlazadas al mismo original", () => {
  // The simple text of the same verse: it says «sirvo» where the literal one says «siervo», and «Dios» once.
  const simple = tokenizeVersePlainText("Yo, Pablo, sirvo a Dios y soy apóstol de Jesucristo.");
  const simpleGroups: AlignmentGroup[] = [
    group(src("Παῦλος"), tgt("Yo"), tgt("Pablo")),
    group(src("δοῦλος"), tgt("sirvo")),
    group(src("Θεοῦ", 1, 2), tgt("a"), tgt("Dios")),
    group(src("ἀπόστολος"), tgt("soy"), tgt("apóstol")),
    group(src("Ἰησοῦ"), tgt("de"), tgt("Jesucristo")),
  ];
  const literal = { tokens, groups };
  const other = { tokens: simple, groups: simpleGroups };
  const says = (index: number, to = other) => tokensSayingTheSame({ from: literal, indices: [index], to }).map((i) => `${i}:${to.tokens[i]}`);
  assert.deepEqual(says(1), ["2:sirvo"], "«siervo»");
  assert.deepEqual(says(0), ["0:Yo,", "1:Pablo,"], "una palabra del literal puede ser dos del sencillo");
  assert.deepEqual(says(3), ["3:a", "4:Dios"], "el primer «Dios»");
  assert.deepEqual(says(16), [], "el segundo «Dios» del literal no está en el sencillo: no se marca el primero");
  assert.deepEqual(says(3, literal), ["2:de", "3:Dios"], "y en su propio texto, lo que va con ella");
  // The other way round, from the simple text to the literal one.
  assert.deepEqual(tokensSayingTheSame({ from: other, indices: [6], to: literal }).map((i) => tokens[i]), ["apóstol"]);
  assert.deepEqual(tokensSayingTheSame({ from: literal, indices: [1], to: { tokens: simple } }), [], "un texto sin alinear no marca nada");
});

// Jude 1:3–4 as the team's literal text has them aligned by hand in QA: «τῆς» and «ὑμῖν» have no word of their own
// in Spanish and were left untied, and «nuestra salvación común» says the three words in another order than the
// original («κοινῆς ἡμῶν σωτηρίας»).
const jude3 = tokenizeVersePlainText("Amados, haciendo todo esfuerzo por escribirles sobre nuestra salvación común, tengo necesidad de escribirles,");
const jude3Groups: AlignmentGroup[] = [
  group(src("ἀγαπητοί"), tgt("Amados")),
  group(src("ποιούμενος"), tgt("haciendo")),
  group(src("πᾶσαν"), tgt("todo")),
  group(src("σπουδὴν"), tgt("esfuerzo")),
  group(src("γράφειν"), tgt("por"), tgt("escribirles", 1, 2)),
  group(src("περὶ"), tgt("sobre")),
  group(src("ἡμῶν"), tgt("nuestra")),
  group(src("σωτηρίας"), tgt("salvación")),
  group(src("κοινῆς"), tgt("común")),
  group(src("ἔσχον"), tgt("tengo")),
  group(src("ἀνάγκην"), tgt("necesidad")),
  group(src("γράψαι"), tgt("de"), tgt("escribirles", 2, 2)),
];
const greek = (text: string) => {
  const seen = new Map<string, number>();
  return text.split(" ").map((content) => {
    seen.set(content, (seen.get(content) ?? 0) + 1);
    return { content, occurrence: seen.get(content)! };
  });
};
const jude3Original = greek("ἀγαπητοί πᾶσαν σπουδὴν ποιούμενος γράφειν ὑμῖν περὶ τῆς κοινῆς ἡμῶν σωτηρίας ἀνάγκην ἔσχον γράψαι ὑμῖν");

test("una palabra de la cita que el texto no dice no esconde el resto: «τῆς … σωτηρίας» marca «salvación»", () => {
  const through = (quote: string) => (matchHelpQuoteThroughOriginal(jude3, quote, 1, jude3Groups, jude3Original) ?? []).map((i) => jude3[i]);
  // The two notes and the key term of «salvación»: with «τῆς» untied, they had no place in the verse.
  assert.deepEqual(through("περὶ τῆς κοινῆς ἡμῶν σωτηρίας"), ["sobre", "nuestra", "salvación", "común,"]);
  assert.deepEqual(through("τῆς & σωτηρίας"), ["salvación"]);
  assert.deepEqual(through("πᾶσαν σπουδὴν ποιούμενος γράφειν ὑμῖν"), ["haciendo", "todo", "esfuerzo", "por", "escribirles"]);
  assert.deepEqual(through("τῆς"), [], "una cita de la que el texto no dice nada no marca nada");
  assert.equal(matchHelpQuoteThroughOriginal(jude3, "χάρις", 1, jude3Groups, jude3Original), null, "y la que no está en el versículo se busca de la otra manera");
  // Without the original at hand, the same quotes are found too.
  const guessed = (quote: string) => matchHelpEntryToTokenIndicesByAlignment(jude3, quote, 1, jude3Groups).map((i) => jude3[i]);
  assert.deepEqual(guessed("περὶ τῆς κοινῆς ἡμῶν σωτηρίας"), ["sobre", "nuestra", "salvación", "común,"]);
  assert.deepEqual(guessed("τῆς & σωτηρίας"), ["salvación"]);
  assert.deepEqual(guessed("τῆς"), []);
  // And by the way the screens ask for it.
  const asked = alignedGatewayQuoteForHelpQuote({ verseText: jude3.join(" "), quote: "τῆς & σωτηρίας", occurrence: 1, alignments: { "JUD 1:3": jude3Groups }, book: "JUD", chapter: 1, verse: 3, original: jude3Original });
  assert.deepEqual(asked, { gatewayText: "salvación", tokenIndices: [8] });
});

test("de una palabra que el versículo dice dos veces se marca la de la cita, no la primera que aparece", () => {
  // Jude 1:4: «…la gracia de nuestro Dios en libertinaje y niegan a nuestro único Amo y Señor, Jesucristo».
  const four = tokenizeVersePlainText("la gracia de nuestro Dios en libertinaje y niegan a nuestro único Amo y Señor, Jesucristo.");
  const fourGroups: AlignmentGroup[] = [
    group(src("χάριτα"), tgt("la"), tgt("gracia")),
    group(src("Θεοῦ"), tgt("de"), tgt("Dios")),
    group(src("ἡμῶν", 1, 2), tgt("nuestro", 1, 2)),
    group(src("ἀσέλγειαν"), tgt("en"), tgt("libertinaje")),
    group(src("καὶ", 1, 2), tgt("y", 1, 2)),
    group(src("ἀρνούμενοι"), tgt("niegan"), tgt("a")),
    group(src("ἡμῶν", 2, 2), tgt("nuestro", 2, 2)),
    group(src("μόνον"), tgt("único")),
    group(src("Δεσπότην"), tgt("Amo")),
    group(src("καὶ", 2, 2), tgt("y", 2, 2)),
    group(src("Κύριον"), tgt("Señor")),
    group(src("Ἰησοῦν"), tgt("Jesucristo")),
  ];
  const fourOriginal = greek("Θεοῦ ἡμῶν χάριτα ἀσέλγειαν καὶ τὸν μόνον Δεσπότην καὶ Κύριον ἡμῶν Ἰησοῦν Χριστὸν ἀρνούμενοι");
  const quote = "τὸν μόνον Δεσπότην καὶ Κύριον ἡμῶν, Ἰησοῦν Χριστὸν, ἀρνούμενοι";
  assert.deepEqual((matchHelpQuoteThroughOriginal(four, quote, 1, fourGroups, fourOriginal) ?? []).map((i) => `${i}:${four[i]}`), ["8:niegan", "9:a", "10:nuestro", "11:único", "12:Amo", "13:y", "14:Señor,", "15:Jesucristo."]);
  // Guessed from the alignment alone it took the first «nuestro», of «nuestro Dios», and left the one quoted out.
  assert.ok(matchHelpEntryToTokenIndicesByAlignment(four, quote, 1, fourGroups).includes(3), "sin el original, sigue tomando el primero");
});

test("una palabra que el versículo dice dos veces con acentos distintos se marca solo donde la cita la dice", () => {
  // Esther 1:10: «הַ⁠מֶּ֖לֶךְ» of «the heart of the king» and «הַ⁠מֶּ֥לֶךְ» of «before the king», each the first of
  // its exact form. The quote is about the first: «ante el rostro del rey» was marked too.
  const ten = tokenizeVersePlainText("cuando el corazón del rey estaba alegre por el vino, los siete eunucos que servían ante el rostro del rey Asuero");
  const first = "הַ⁠מֶּ֖לֶךְ";
  const second = "הַ⁠מֶּ֥לֶךְ";
  const tenGroups: AlignmentGroup[] = [
    group(src("כְּ⁠ט֥וֹב"), tgt("cuando"), tgt("estaba"), tgt("alegre")),
    group(src("לֵב"), tgt("el", 1, 4), tgt("corazón"), tgt("del", 1, 2)),
    group(src(first), tgt("rey", 1, 2)),
    group(src("בַּ⁠יָּ֑יִן"), tgt("por"), tgt("el", 2, 4), tgt("vino,")),
    { sources: [src("פְּנֵ֖י"), src(second)], targets: [tgt("ante"), tgt("el", 4, 4), tgt("rostro"), tgt("del", 2, 2), tgt("rey", 2, 2)] },
  ];
  const tenOriginal = [first, second, "כְּ⁠ט֥וֹב", "לֵב", "בַּ⁠יָּ֑יִן", "פְּנֵ֖י"].map((content) => ({ content: content.normalize("NFC"), occurrence: 1 }));
  const order = ["כְּ⁠ט֥וֹב", "לֵב", first, "בַּ⁠יָּ֑יִן", "פְּנֵ֖י", second].map((content) => ({ content: content.normalize("NFC"), occurrence: 1 }));
  const marked = (matchHelpQuoteThroughOriginal(ten, `כְּ⁠ט֥וֹב לֵב־${first} בַּ⁠יָּ֑יִן`, 1, tenGroups, order) ?? []).map((i) => ten[i]);
  assert.ok(marked.includes("corazón") && marked.includes("vino,"), "marca lo que la cita dice");
  assert.ok(!marked.includes("rostro") && !marked.includes("ante"), `no marca «ante el rostro del rey»: ${marked.join(" ")}`);
  assert.equal(tenOriginal.length, 6);
});

test("en la revisión del versículo, la cita de cada nota se marca en el TPL y en el TPS, cada uno por su alineación", () => {
  // The TPS says it in other words, and is aligned on its own: «Θεοῦ» is «Dios» there, without the «de».
  const tps = "Pablo sirve a Dios y es apóstol de Jesucristo";
  const tpsGroups: AlignmentGroup[] = [group(src("Παῦλος"), tgt("Pablo")), group(src("δοῦλος"), tgt("sirve"), tgt("a")), group(src("Θεοῦ", 1, 2), tgt("Dios")), group(src("ἀπόστολος"), tgt("es"), tgt("apóstol")), group(src("Ἰησοῦ"), tgt("de"), tgt("Jesucristo"))];
  const texts = { tpl: { verses: { 1: verse }, alignments: { "TIT 1:1": groups } }, tps: { verses: { 1: tps }, alignments: { "TIT 1:1": tpsGroups } } };
  const marks = (quote: string, occurrence = 1) => helpQuoteInTexts({ texts, help: { quote, occurrence, chapter: 1, verse: 1 }, book: "TIT" });
  assert.deepEqual(marks("δοῦλος Θεοῦ"), { tpl: { gatewayText: "siervo de Dios", tokenIndices: [1, 2, 3] }, tps: { gatewayText: "sirve a Dios", tokenIndices: [1, 2, 3] } });
  // The second «Θεοῦ» the TPS does not say: marked in the TPL alone, so it is seen that the TPS leaves it out.
  assert.deepEqual(marks("Θεοῦ", 2), { tpl: { gatewayText: "de Dios", tokenIndices: [15, 16] }, tps: { gatewayText: null, tokenIndices: [] } });
  assert.deepEqual(helpQuoteInTexts({ texts: { ...texts, tps: { verses: { 1: tps } } }, help: { quote: "δοῦλος", occurrence: 1, chapter: 1, verse: 1 }, book: "TIT" }).tps, { gatewayText: null, tokenIndices: [] }, "un texto sin alinear no marca nada");
  assert.deepEqual(helpQuoteInTexts({ texts, help: { chapter: 1, verse: 1 }, book: "TIT" }), { tpl: { gatewayText: null, tokenIndices: [] }, tps: { gatewayText: null, tokenIndices: [] } }, "una ayuda sin cita no marca nada");
});

console.log(`\nverify-help-quote: ${passed} checks passed.`);
