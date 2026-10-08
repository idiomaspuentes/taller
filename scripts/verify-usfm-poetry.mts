/**
 * A verse of a poem is several lines, each begun by its mark (`\q1`, `\q2`). The app took a verse for one line of
 * text: a psalm somebody touched came out as prose, the mark that opened the next verse went with it, and a book
 * begun here had one paragraph to a chapter. Each of the places a verse is written in is gone through here with
 * Jonah 2: reading it for the editor, saving it (with and without alignment), delivering it, beginning the book.
 * Run: npm run verify:usfm-poetry
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applyVerseEditsKeepingAlignment, versesChangedBesides } from "../src/domain/alignmentKeep";
import { patchTrunkByVerse } from "../src/domain/usfmTrunkPatch";
import { extractDraftVerses } from "../src/domain/usfmAst";
import { applyVerseEdits, buildBookUsfmSkeleton, chunkStarts, draftSlots, listVerseSpans, skeletonUsfm, skeletonUsfmFromSource, textInLines, textLines, verseLeads, withChunkMarksOf, verseLinesText, verseParts } from "../src/domain/usfmEdit";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const span = (usfm: string, chapter: number, verse: number) => listVerseSpans(usfm).find((s) => s.chapter === chapter && s.verse === verse)!;
const parts = (usfm: string, chapter: number, verse: number) => verseParts(usfm, span(usfm, chapter, verse));

// ---------------------------------------------------------------- a psalm with no alignment, as a team has it

const psalm = [
  "\\id JON EN_GLT es-419_Español",
  "\\usfm 3.0",
  "\\h Jonás",
  "\\mt Jonás",
  "\\c 2",
  "\\cl Capítulo 2",
  "\\nb",
  "\\v 1 Y Jonás oró a Jehová su Dios desde el abdomen del pez.",
  "\\v 2 Y él dijo:",
  "\\q Clamé a Jehová desde mi angustia y él me respondió;",
  "\\q2 desde el vientre del Seol clamé, tú escuchaste mi voz.",
  "\\q",
  "\\v 3 Ahora me echaste a lo profundo;",
  "\\q2 todas tus ondas y olas pasaron sobre mí.",
  "\\b",
  "\\q",
  "\\v 4 Yo mismo dije: \"Yo he sido apartado\";",
  "\\q2 pero aún así podría mirar tu santo templo.",
  "\\s1 La respuesta",
  "\\p",
  "\\v 5 Entonces Jehová habló al pez.",
  "",
].join("\n");

test("un versículo se lee en sus renglones, cada uno con la marca con que empieza", () => {
  assert.deepEqual(parts(psalm, 2, 1).lines, [{ lead: "", text: "Y Jonás oró a Jehová su Dios desde el abdomen del pez." }], "uno de prosa es un renglón");
  assert.deepEqual(parts(psalm, 2, 2).lines, [
    { lead: "", text: "Y él dijo:" },
    { lead: "\\q", text: "Clamé a Jehová desde mi angustia y él me respondió;" },
    { lead: "\\q2", text: "desde el vientre del Seol clamé, tú escuchaste mi voz." },
  ]);
  assert.equal(verseLinesText(psalm, span(psalm, 2, 3)), "Ahora me echaste a lo profundo;\ntodas tus ondas y olas pasaron sobre mí.");
  assert.deepEqual(textLines("  uno  \n\n dos \r\n"), ["uno", "dos"]);
});

test("lo que sigue al texto de un versículo no es suyo: la marca que abre el siguiente, una línea en blanco, un título", () => {
  assert.equal(parts(psalm, 2, 2).tail, "\n\\q\n", "la \\q que abre 2:3");
  assert.equal(parts(psalm, 2, 3).tail, "\n\\b\n\\q\n", "la línea en blanco entre estrofas y la \\q de 2:4");
  assert.equal(parts(psalm, 2, 4).tail, "\n\\s1 La respuesta\n\\p\n", "el título y el párrafo de 2:5");
  assert.equal(parts(psalm, 2, 5).tail, "\n");
  const s = span(psalm, 2, 4);
  assert.equal(psalm.slice(parts(psalm, 2, 4).textEnd, s.end), parts(psalm, 2, 4).tail);
});

test("se lee igual como lo escriben las herramientas de unfoldingWord: la marca sola en su línea, un grupo por línea", () => {
  const z = (word: string) => `\\zaln-s |x-strong="H1" x-lemma="" x-occurrence="1" x-occurrences="1" x-content="א"\\*\\w ${word}|x-occurrence="1" x-occurrences="1"\\w*\\zaln-e\\*`;
  const aligned = ["\\c 2", "\\p", `\\v 2 ${z("Y")}`, `${z("dijo")}:`, "\\q1", `${z("Clamé")}`, `${z("a")};`, "\\q2", `${z("desde")}.`, "", "\\ts\\*", "\\q1", `\\v 3 ${z("Ahora")}`, ""].join("\n");
  assert.deepEqual(parts(aligned, 2, 2).lines, [
    { lead: "", text: "Y dijo:" },
    { lead: "\\q1", text: "Clamé a;" },
    { lead: "\\q2", text: "desde." },
  ]);
  assert.equal(parts(aligned, 2, 2).tail, "\n\n\\ts\\*\n\\q1\n", "la marca de trozo y la \\q1 de 2:3 quedan fuera");
  assert.equal(span(aligned, 2, 2).text, "Y dijo: Clamé a; desde.", "ni un trozo de la marca en el texto del versículo");
  const speech = "\\c 1\n\\p\n\\v 1 Dijo: \\qt-s |who=\"Dios\"\\*Sal.\\qt-e\\*\n\\v 2 Y salió.\n";
  assert.equal(span(speech, 1, 1).text, "Dijo: Sal.", "ni de otra marca que se cierra sola");
});

test("una marca sin texto en medio del versículo va con el renglón que le sigue; un versículo vacío no tiene renglones", () => {
  const stanza = ["\\c 1", "\\q1", "\\v 1 Uno;", "\\b", "\\q1 dos.", "\\q1", "\\v 2", "\\q2", "\\v 3 Tres.", ""].join("\n");
  assert.deepEqual(parts(stanza, 1, 1).lines, [{ lead: "", text: "Uno;" }, { lead: "\\b\n\\q1", text: "dos." }]);
  assert.deepEqual(parts(stanza, 1, 2), { lines: [], textEnd: span(stanza, 1, 2).start + "\\v 2".length, tail: "\n\\q2\n" });
});

test("una marca de trozo colgada del final del último renglón queda fuera del texto", () => {
  // As a writer leaves it when the file has no alignment: at the end of the line before.
  const hanging = ["\\c 1", "\\p", "\\v 1 Uno. \\ts\\*", "\\p", "\\v 2 Dos.", ""].join("\n");
  assert.deepEqual(parts(hanging, 1, 1).lines, [{ lead: "", text: "Uno." }]);
  assert.equal(parts(hanging, 1, 1).tail, " \\ts\\*\n\\p\n");
  assert.equal(applyVerseEdits(hanging, 1, [{ verse: 1, text: "Uno, cambiado." }]), ["\\c 1", "\\p", "\\v 1 Uno, cambiado.", "\\ts\\*", "\\p", "\\v 2 Dos.", ""].join("\n"));
});

// ---------------------------------------------------------------- saving a verse

/** The document with one verse cut out, to see that nothing else moved. */
const without = (usfm: string, chapter: number, verse: number) => {
  const s = span(usfm, chapter, verse);
  return usfm.slice(0, s.start) + usfm.slice(verseParts(usfm, s).textEnd);
};

test("cambiar una palabra de un versículo del salmo lo deja en sus renglones, y al siguiente con su marca", () => {
  const edited = applyVerseEdits(psalm, 2, [{ verse: 2, text: "Y él dijo:\nClamé a Jehová desde mi aflicción y él me respondió;\ndesde el vientre del Seol clamé, tú escuchaste mi voz." }]);
  assert.equal(edited, psalm.replace("angustia", "aflicción"), "solo cambió esa palabra");
});

test("el título, la línea en blanco y la marca de trozo que siguen a un versículo se quedan donde estaban", () => {
  const four = applyVerseEdits(psalm, 2, [{ verse: 4, text: "Yo dije: \"He sido apartado\";\npero aún así podría mirar tu santo templo." }]);
  assert.ok(four.includes("\\q2 pero aún así podría mirar tu santo templo.\n\\s1 La respuesta\n\\p\n\\v 5 "), "el título y el párrafo de 2:5");
  assert.equal(without(four, 2, 4), without(psalm, 2, 4));
  const three = applyVerseEdits(psalm, 2, [{ verse: 3, text: "Me echaste a lo profundo;\ntodas tus ondas pasaron sobre mí." }]);
  assert.ok(three.includes("\\q2 todas tus ondas pasaron sobre mí.\n\\b\n\\q\n\\v 4 "));
  assert.equal(without(three, 2, 3), without(psalm, 2, 3));
});

test("los renglones son los que la persona deja: menos, más, y uno más toma la marca del anterior", () => {
  const two = applyVerseEdits(psalm, 2, [{ verse: 2, text: "Y él dijo: Clamé a Jehová y él me respondió;\ndesde el Seol clamé." }]);
  assert.ok(two.includes("\\v 2 Y él dijo: Clamé a Jehová y él me respondió;\n\\q desde el Seol clamé.\n\\q\n\\v 3 "), "dos renglones: el segundo con la marca del segundo");
  const four = applyVerseEdits(psalm, 2, [{ verse: 2, text: "Y él dijo:\nClamé a Jehová;\ndesde el Seol clamé,\ntú escuchaste mi voz." }]);
  assert.ok(four.includes("\\v 2 Y él dijo:\n\\q Clamé a Jehová;\n\\q2 desde el Seol clamé,\n\\q2 tú escuchaste mi voz.\n\\q\n\\v 3 "));
  const one = applyVerseEdits(psalm, 2, [{ verse: 2, text: "Y él dijo que clamó." }]);
  assert.ok(one.includes("\\v 2 Y él dijo que clamó.\n\\q\n\\v 3 "), "en uno solo, 2:3 sigue abriendo su renglón");
  const none = applyVerseEdits(psalm, 2, [{ verse: 2, text: "" }]);
  assert.ok(none.includes("\\v 1 Y Jonás oró a Jehová su Dios desde el abdomen del pez.\n\\v 2\n\\q\n\\v 3 "));
});

test("un versículo de prosa se escribe en una línea aunque se escriba con saltos; con los del original toma sus marcas", () => {
  const prose = applyVerseEdits(psalm, 2, [{ verse: 1, text: "Y Jonás oró\na su Dios." }]);
  assert.ok(prose.includes("\\nb\n\\v 1 Y Jonás oró a su Dios.\n\\v 2 Y él dijo:"));
  // The source has that verse in three lines: a translation that did not have them takes its marks.
  const withSource = applyVerseEdits(psalm, 2, [{ from: 1, to: 1, text: "Y Jonás oró\na su Dios\ndesde el pez.", leads: ["", "\\q1", "\\q2"] }]);
  assert.ok(withSource.includes("\\v 1 Y Jonás oró\n\\q1 a su Dios\n\\q2 desde el pez.\n\\v 2 Y él dijo:"));
});

test("los finales de línea del archivo se conservan, y dos versículos unidos quedan en una línea con lo que les seguía", () => {
  const crlf = psalm.replace(/\n/g, "\r\n");
  const edited = applyVerseEdits(crlf, 2, [{ verse: 3, text: "Me echaste;\ntodas tus olas pasaron." }]);
  assert.ok(edited.includes("\\v 3 Me echaste;\r\n\\q2 todas tus olas pasaron.\r\n\\b\r\n\\q\r\n\\v 4 "));
  assert.ok(!/[^\r]\n/.test(edited));
  const joined = applyVerseEdits(psalm, 2, [{ from: 2, to: 3, text: "Y él dijo que clamó y fue echado." }]);
  assert.ok(joined.includes("\\v 2-3 Y él dijo que clamó y fue echado.\n\\b\n\\q\n\\v 4 "));
});

test("al editor llegan los renglones del versículo, y lo que vuelve de él sin tocar no cambia el archivo", () => {
  const rows = draftSlots(psalm, { chapter: 2, from: 1, to: 5 });
  assert.equal(rows[0]!.text, "Y Jonás oró a Jehová su Dios desde el abdomen del pez.");
  assert.equal(rows[1]!.text, "Y él dijo:\nClamé a Jehová desde mi angustia y él me respondió;\ndesde el vientre del Seol clamé, tú escuchaste mi voz.");
  assert.equal(rows[3]!.text.split("\n").length, 2);
  assert.equal(applyVerseEdits(psalm, 2, rows), psalm, "guardar lo mismo deja el archivo igual, byte por byte");
});

test("el editor recibe cada versículo en sus renglones, como lo lee quien lo guarda", () => {
  const extracted = extractDraftVerses(psalm, { chapter: 2, from: 1, to: 5 });
  assert.equal(extracted.via, "ast", "el analizador leyó el archivo");
  assert.deepEqual(extracted.slots, draftSlots(psalm, { chapter: 2, from: 1, to: 5 }));
  assert.equal(extracted.slots[2]!.text, "Ahora me echaste a lo profundo;\ntodas tus ondas y olas pasaron sobre mí.");
  assert.equal(applyVerseEdits(psalm, 2, extracted.slots), psalm);
});

/** A chapter that ends before a heading, a note, and the label of the next chapter. */
const withWhatFollows = [
  "\\id JON",
  "\\c 2",
  "\\cl Capítulo 2",
  "\\p",
  "\\v 9 Pero yo cumpliré.\\f + \\fr 2:9 \\ft Algunos manuscritos dicen otra cosa.\\f*",
  "\\s1 El pez obedece",
  "\\p",
  "\\v 10 Y Jehová le habló al pez.",
  "\\c 3",
  "\\cl Capítulo 3",
  "\\p",
  "\\v 1 Y la palabra de Jehová vino a Jonás.",
  "",
].join("\n");

test("al editor no llega con el versículo lo que viene después de él: la etiqueta del capítulo siguiente, un título, una nota", () => {
  const rows = extractDraftVerses(withWhatFollows, { chapter: 2, from: 9, to: 10 }).slots;
  assert.deepEqual(rows.map((row) => row.text), ["Pero yo cumpliré.", "Y Jehová le habló al pez."]);
  // Saved as they came, nothing is written: the note of 2:9 is still there, and 2:10 did not gain two words.
  assert.equal(applyVerseEditsKeepingAlignment(withWhatFollows, 2, rows).usfm, withWhatFollows);
  assert.equal(applyVerseEdits(withWhatFollows, 2, rows), withWhatFollows);
});

test("guardar una porción no vuelve a escribir los versículos que nadie tocó: conservan su nota y lo marcado en ellos", () => {
  const rows = extractDraftVerses(withWhatFollows, { chapter: 2, from: 9, to: 10 }).slots;
  rows[1] = { ...rows[1]!, text: "Y Jehová le habló al gran pez." };
  const saved = applyVerseEditsKeepingAlignment(withWhatFollows, 2, rows).usfm;
  assert.equal(saved, withWhatFollows.replace("al pez.", "al gran pez."), "solo cambió 2:10; la nota de 2:9 sigue ahí");
  // A verse written in two parts, and one with words marked in it.
  const marked = "\\id JON\n\\c 1\n\\p\n\\v 1 La palabra de \\nd Jehová\\nd* vino.\n\\v 2a Levántate,\n\\p\n\\v 2b ve a Nínive.\n\\v 3 Pero Jonás huyó.\n";
  const all = extractDraftVerses(marked, { chapter: 1, from: 1, to: 3 }).slots;
  assert.deepEqual(all.map((row) => row.text), ["La palabra de Jehová vino.", "Levántate, ve a Nínive.", "Pero Jonás huyó."]);
  assert.equal(applyVerseEdits(marked, 1, all), marked);
  all[2] = { ...all[2]!, text: "Pero Jonás se levantó para huir." };
  assert.equal(applyVerseEdits(marked, 1, all), marked.replace("Pero Jonás huyó.", "Pero Jonás se levantó para huir."));
  // The one that is edited keeps what was marked in it too (`npm run verify:usfm-notes` goes through all of that).
  all[0] = { ...all[0]!, text: "La palabra de Jehová llegó." };
  assert.ok(applyVerseEdits(marked, 1, all).includes("\\v 1 La palabra de \\nd Jehová\\nd* llegó.\n\\v 2a Levántate,"));
});

// ---------------------------------------------------------------- a correction that came as one run of text

test("un texto que llega corrido se parte donde el versículo se parte: después de las mismas palabras", () => {
  const lines = ["Y él dijo:", "Clamé a Jehová desde mi angustia y él me respondió;", "desde el vientre del Seol clamé, tú escuchaste mi voz."];
  assert.equal(textInLines(lines.join(" "), lines), lines.join("\n"), "el mismo texto, en sus renglones");
  assert.equal(textInLines(lines.join(" ").replace("angustia", "gran aflicción"), lines), lines.join("\n").replace("angustia", "gran aflicción"), "una palabra cambiada en medio de un renglón");
  // The word a line ends with, and the one the next begins with.
  assert.equal(textInLines("Y él habló: Clamé a Jehová desde mi angustia y él me contestó; Del vientre del Seol clamé, tú escuchaste mi voz.", lines), "Y él habló:\nClamé a Jehová desde mi angustia y él me contestó;\nDel vientre del Seol clamé, tú escuchaste mi voz.");
  assert.equal(textInLines("Y él dijo: Clamé a Jehová desde mi angustia y él me respondió;", lines), "Y él dijo:\nClamé a Jehová desde mi angustia y él me respondió;", "un renglón que ya no está");
  assert.equal(textInLines("Clamé a Jehová y me respondió; desde el Seol clamé y oíste.", lines.slice(1)), "Clamé a Jehová y me respondió;\ndesde el Seol clamé y oíste.");
  assert.equal(textInLines("uno dos tres cuatro cinco seis", ["a b", "c d e f"]), "uno dos\ntres cuatro cinco seis", "sin una palabra en común, en la misma proporción");
  assert.equal(textInLines("uno\ndos", ["uno dos"]), "uno dos", "un versículo de prosa es una línea");
  assert.equal(textInLines("", lines), "");
});

test("una corrección hecha donde el versículo se lee corrido no vuelve prosa un versículo del salmo", () => {
  const corrected = applyVerseEdits(psalm, 2, [{ verse: 2, text: "Y él dijo: Clamé a Jehová desde mi aflicción y él me respondió; desde el vientre del Seol clamé, tú escuchaste mi voz.", flat: true }]);
  assert.equal(corrected, psalm.replace("angustia", "aflicción"));
  const prose = applyVerseEdits(psalm, 2, [{ verse: 1, text: "Y Jonás oró a su Dios.", flat: true }]);
  assert.equal(prose, psalm.replace("Y Jonás oró a Jehová su Dios desde el abdomen del pez.", "Y Jonás oró a su Dios."));
  // Given by its number alone, an edit keeps what it says of its lines.
  const leads = applyVerseEdits(psalm, 2, [{ verse: 1, text: "Y Jonás oró\na su Dios.", leads: ["", "\\q1"] }]);
  assert.ok(leads.includes("\\v 1 Y Jonás oró\n\\q1 a su Dios.\n\\v 2 Y él dijo:"));
});

// ---------------------------------------------------------------- with alignment

const Z = (content: string, word: string, occurrence = 1, occurrences = 1) =>
  `\\zaln-s |x-strong="H${content.length}" x-lemma="" x-morph="He,V" x-occurrence="1" x-occurrences="1" x-content="${content}"\\*\\w ${word}|x-occurrence="${occurrence}" x-occurrences="${occurrences}"\\w*\\zaln-e\\*`;
/** Jonah 2:1-4 as unfoldingWord's tools write a gateway text: a group to a line. */
const alignedPsalm = [
  "\\id JON EN_GLT es-419_Español",
  "\\usfm 3.0",
  "\\h Jonás",
  "\\mt Jonás",
  "\\c 2",
  "\\p",
  `\\v 1 ${Z("ו", "Y")}`,
  `${Z("יונה", "Jonás")}`,
  `${Z("פלל", "oró")}.`,
  `\\v 2 ${Z("ויאמר", "Y")}`,
  `${Z("אמר", "dijo")}:`,
  `\\q ${Z("קראתי", "Clamé")}`,
  `${Z("אל", "a")}`,
  `${Z("יהוה", "Jehová")}`,
  `${Z("מצרה", "desde", 1, 2)}`,
  `${Z("לי", "mi")}`,
  `${Z("צרה", "angustia")};`,
  `\\q2 ${Z("מבטן", "desde", 2, 2)}`,
  `${Z("בטן", "el")}`,
  `${Z("שאול", "vientre")}.`,
  "\\q",
  `\\v 3 ${Z("ותשליכני", "Ahora")}`,
  `${Z("שלך", "me")}`,
  `${Z("מצולה", "echaste")};`,
  `\\q2 ${Z("כל", "todas")}`,
  `${Z("גליך", "tus")}`,
  `${Z("משבריך", "ondas")}.`,
  "\\q",
  `\\v 4 ${Z("ואני", "Yo")}`,
  `${Z("אמרתי", "dije")}: "${Z("נגרשתי", "He")}`,
  `${Z("מנגד", "sido")}`,
  `${Z("עיניך", "apartado")}".`,
  "",
].join("\n");

const linkedWords = (usfm: string, verse: number) => [...span(usfm, 2, verse).rawBody.matchAll(/\\w ([^|\\]+)\|/g)].map((m) => m[1]);
const structure = (usfm: string) => (usfm.match(/\\(?:c \d+|v \d+|q\d?|p|b|nb|ts\\\*)(?=\s|$)/gm) ?? []).join(" ");

test("con alineación: lo que el editor devuelve sin tocar no escribe nada", () => {
  const rows = draftSlots(alignedPsalm, { chapter: 2, from: 1, to: 4 });
  assert.equal(rows[1]!.text, "Y dijo:\nClamé a Jehová desde mi angustia;\ndesde el vientre.");
  const same = applyVerseEditsKeepingAlignment(alignedPsalm, 2, rows);
  assert.equal(same.usfm, alignedPsalm);
  // The same words on one line (a text kept from before verses were edited in their lines) are not a change either.
  const flat = applyVerseEditsKeepingAlignment(alignedPsalm, 2, [{ verse: 2, text: "Y dijo: Clamé a Jehová desde mi angustia; desde el vientre." }]);
  assert.equal(flat.usfm, alignedPsalm, "no vuelve prosa un versículo que nadie tocó");
});

test("con alineación: tampoco llega al editor lo que sigue al versículo, y guardarlo sin tocar no lo escribe", () => {
  const aligned = withWhatFollows.replace("Y Jehová le habló al pez.", `${Z("ויאמר", "Y")}\n${Z("יהוה", "Jehová")} le habló al pez.`);
  const rows = extractDraftVerses(aligned, { chapter: 2, from: 9, to: 10 }).slots;
  assert.deepEqual(rows.map((row) => row.text), ["Pero yo cumpliré.", "Y Jehová le habló al pez."]);
  assert.equal(applyVerseEditsKeepingAlignment(aligned, 2, rows).usfm, aligned);
});

test("con alineación: cambiar una palabra de un versículo del salmo conserva sus renglones, sus otras palabras alineadas y todo lo demás", () => {
  const rows = draftSlots(alignedPsalm, { chapter: 2, from: 1, to: 4 });
  rows[1] = { ...rows[1]!, text: rows[1]!.text.replace("angustia", "aflicción") };
  const saved = applyVerseEditsKeepingAlignment(alignedPsalm, 2, rows);
  assert.deepEqual(parts(saved.usfm, 2, 2).lines, [
    { lead: "", text: "Y dijo:" },
    { lead: "\\q", text: "Clamé a Jehová desde mi aflicción;" },
    { lead: "\\q2", text: "desde el vientre." },
  ]);
  assert.deepEqual(linkedWords(saved.usfm, 2), ["Y", "dijo", "Clamé", "a", "Jehová", "desde", "mi", "desde", "el", "vientre"], "solo la palabra que cambió pierde su enlace");
  assert.deepEqual(saved.reducedVerses, [2]);
  assert.deepEqual(saved.clearedVerses, []);
  assert.equal(structure(saved.usfm), structure(alignedPsalm), "párrafos y renglones donde estaban");
  for (const verse of [1, 3, 4]) {
    assert.equal(span(saved.usfm, 2, verse).text, span(alignedPsalm, 2, verse).text, `el texto de 2:${verse}`);
    assert.deepEqual(linkedWords(saved.usfm, verse), linkedWords(alignedPsalm, verse), `la alineación de 2:${verse}`);
  }
  assert.ok(saved.usfm.includes(`${Z("אמרתי", "dije")}: "${Z("נגרשתי", "He")}`), "las comillas de 2:4, donde estaban");
  assert.deepEqual(versesChangedBesides(alignedPsalm, saved.usfm, 2, [{ from: 2, to: 2 }]), []);
});

test("con alineación: se guarda en el formato del original, un grupo por línea, y volver a guardar no cambia nada", () => {
  const rows = draftSlots(alignedPsalm, { chapter: 2, from: 1, to: 4 });
  rows[2] = { ...rows[2]!, text: "Ahora me echaste;\ntodas tus olas." };
  const saved = applyVerseEditsKeepingAlignment(alignedPsalm, 2, rows).usfm;
  const lines = saved.split("\n");
  assert.ok(Math.max(...lines.map((line) => line.length)) < 400, "ninguna línea con un versículo entero");
  const groupLines = (usfm: string) => usfm.split("\n").filter((line) => line.startsWith("\\zaln-s")).length;
  assert.equal(groupLines(saved), groupLines(alignedPsalm) - 1, "cada grupo en su línea, menos el de la palabra que cambió («ondas»)");
  assert.ok(!/\\w\*[^\s\\]+\\zaln-e/.test(saved), "la puntuación va después del grupo");
  assert.equal(lines.slice(0, 4).join("\n"), alignedPsalm.split("\n").slice(0, 4).join("\n"), "lo que el libro dice de sí mismo");
  const again = applyVerseEditsKeepingAlignment(saved, 2, draftSlots(saved, { chapter: 2, from: 1, to: 4 }));
  assert.equal(again.usfm, saved);
  // Everything that was not touched is written as it was, line by line.
  const untouched = (usfm: string) => usfm.slice(0, span(usfm, 2, 3).start) + usfm.slice(span(usfm, 2, 4).start);
  assert.equal(untouched(saved), untouched(alignedPsalm));
});

test("con alineación: romper de otro modo los renglones de un versículo también se guarda", () => {
  const rows = draftSlots(alignedPsalm, { chapter: 2, from: 2, to: 2 });
  const saved = applyVerseEditsKeepingAlignment(alignedPsalm, 2, [{ ...rows[0]!, text: "Y dijo: Clamé a Jehová\ndesde mi angustia;\ndesde el vientre." }]);
  assert.deepEqual(parts(saved.usfm, 2, 2).lines.map((line) => line.text), ["Y dijo: Clamé a Jehová", "desde mi angustia;", "desde el vientre."]);
  assert.equal(linkedWords(saved.usfm, 2).length, 11, "las once palabras siguen alineadas");
});

test("con alineación: una corrección que llega corrida conserva los renglones y la alineación de lo que no cambió", () => {
  const corrected = applyVerseEditsKeepingAlignment(alignedPsalm, 2, [{ verse: 2, text: "Y dijo: Clamé a Jehová desde mi aflicción; desde el vientre.", flat: true }]);
  assert.deepEqual(parts(corrected.usfm, 2, 2).lines, [
    { lead: "", text: "Y dijo:" },
    { lead: "\\q", text: "Clamé a Jehová desde mi aflicción;" },
    { lead: "\\q2", text: "desde el vientre." },
  ]);
  assert.deepEqual(linkedWords(corrected.usfm, 2), ["Y", "dijo", "Clamé", "a", "Jehová", "desde", "mi", "desde", "el", "vientre"]);
  assert.equal(structure(corrected.usfm), structure(alignedPsalm));
  // The same text, as one run: nothing is written.
  assert.equal(applyVerseEditsKeepingAlignment(alignedPsalm, 2, [{ verse: 2, text: "Y dijo: Clamé a Jehová desde mi angustia; desde el vientre.", flat: true }]).usfm, alignedPsalm);
});

test("lo que cambiaría en versículos que nadie tocó se detecta: sus palabras, o cuántas tienen alineadas", () => {
  const moved = alignedPsalm.replace(`: "${Z("נגרשתי", "He")}`, `: " ${Z("נגרשתי", "Hemos")}`);
  assert.deepEqual(versesChangedBesides(alignedPsalm, moved, 2, [{ from: 2, to: 2 }]), ["2:4"]);
  const lost = alignedPsalm.replace(Z("שלך", "me"), "me");
  assert.deepEqual(versesChangedBesides(alignedPsalm, lost, 2, [{ from: 2, to: 2 }]), ["2:3"]);
  assert.deepEqual(versesChangedBesides(alignedPsalm, lost, 2, [{ from: 3, to: 3 }]), [], "el que se editó puede cambiar");
  // How it is laid out and spaced is not a change.
  assert.deepEqual(versesChangedBesides(alignedPsalm, alignedPsalm.replace(/\n(?=\\zaln-s)/g, " "), 2, []), []);
});

// ---------------------------------------------------------------- the delivery

test("la entrega lleva al borrador del equipo los renglones del versículo que cambió, y nada más", () => {
  const work = applyVerseEdits(psalm, 2, [{ verse: 2, text: "Y él dijo:\nClamé a Jehová desde mi aflicción y él me respondió;\ndesde el vientre del Seol clamé." }]);
  const patched = patchTrunkByVerse(psalm, [work], { ancestor: psalm, scope: { chapter: 2, from: 1, to: 5 } });
  assert.deepEqual(patched.patched, [{ chapter: 2, from: 2, to: 2 }]);
  assert.equal(patched.usfm, work, "igual que como lo guardó quien lo tradujo");
  assert.equal(without(patched.usfm, 2, 2), without(psalm, 2, 2), "lo demás, byte por byte");
});

test("la entrega no toca la marca que sigue al versículo en el borrador, aunque la rama de trabajo tenga otra", () => {
  // The trunk gained a chunk mark and a heading after 2:2 while the work branch was being written.
  const trunk = psalm.replace("escuchaste mi voz.\n\\q\n\\v 3", "escuchaste mi voz.\n\n\\ts\\*\n\\s1 El abismo\n\\q\n\\v 3");
  const work = applyVerseEdits(psalm, 2, [{ verse: 2, text: "Y él dijo:\nClamé y él me respondió;\ndesde el Seol clamé." }]);
  const patched = patchTrunkByVerse(trunk, [work], { ancestor: psalm, scope: { chapter: 2, from: 1, to: 5 } });
  assert.ok(patched.usfm.includes("\\v 2 Y él dijo:\n\\q Clamé y él me respondió;\n\\q2 desde el Seol clamé.\n\n\\ts\\*\n\\s1 El abismo\n\\q\n\\v 3 "));
});

test("la entrega de un versículo alineado lleva sus grupos, línea por línea", () => {
  const rows = draftSlots(alignedPsalm, { chapter: 2, from: 2, to: 2 });
  const work = applyVerseEditsKeepingAlignment(alignedPsalm, 2, [{ ...rows[0]!, text: rows[0]!.text.replace("angustia", "aflicción") }]).usfm;
  const patched = patchTrunkByVerse(alignedPsalm, [work], { ancestor: alignedPsalm, scope: { chapter: 2, from: 1, to: 4 } });
  assert.equal(patched.usfm, work);
  assert.deepEqual(linkedWords(patched.usfm, 2).length, 10);
});

// ---------------------------------------------------------------- a book begun here

/** Jonah 2 of a source text, as unfoldingWord writes it. */
const source = [
  "\\id JON EN_ULT en_English_ltr",
  "\\usfm 3.0",
  "\\h Jonah",
  "\\mt1 Jonah",
  "",
  "\\ts\\*",
  "\\c 1",
  "\\p",
  "\\v 1 And the word of Yahweh came.",
  "\\v 2 “Get up.”",
  "",
  "\\ts\\*",
  "\\c 2",
  "\\s1 A prayer",
  "\\p",
  `\\v 1 ${Z("x", "And")}`,
  `${Z("y", "Jonah")}.`,
  `\\v 2 ${Z("z", "And")}`,
  `${Z("w", "said")},`,
  "\\q1",
  `${Z("a", "“I")}`,
  `${Z("b", "cried")};`,
  "\\q2",
  `${Z("c", "From")}.`,
  "",
  "\\ts\\*",
  "\\q1",
  `\\v 3 ${Z("d", "Now")};`,
  `\\q2 ${Z("e", "all")}.`,
  "\\b",
  "\\q1 \\v 4-5 But I.",
  "\\m",
  "\\v 6 Then.",
  "",
].join("\n");

test("un libro que empieza aquí nace con los párrafos, la poesía y los trozos del original, y sin su texto", () => {
  const skeleton = skeletonUsfmFromSource("JON", source, "Jonás");
  assert.equal(
    skeleton,
    [
      "\\id JON", "\\usfm 3.0", "\\ide UTF-8", "\\h Jonás", "\\toc1 Jonás", "\\toc2 Jonás", "\\toc3 Jon", "\\mt Jonás",
      "", "\\ts\\*", "\\c 1", "\\p", "\\v 1", "\\v 2",
      "", "\\ts\\*", "\\c 2", "\\p", "\\v 1", "\\v 2",
      "", "\\ts\\*", "\\q1", "\\v 3", "\\b", "\\q1", "\\v 4-5", "\\m", "\\v 6", "",
    ].join("\n"),
  );
  assert.ok(!/Yahweh|prayer/.test(skeleton), "ni el texto ni los títulos del original");
  assert.deepEqual(chunkStarts(skeleton), chunkStarts(source), "los mismos trozos que el original");
  assert.equal(listVerseSpans(skeleton).map((s) => `${s.chapter}:${s.verse}`).join(" "), "1:1 1:2 2:1 2:2 2:3 2:4 2:6");
});

// ---------------------------------------------------------------- the chunks of the source

test("los trozos de un texto son los versículos que siguen a cada marca de trozo", () => {
  assert.deepEqual(chunkStarts(source), ["1:1", "2:1", "2:3"]);
  assert.deepEqual(chunkStarts(psalm), [], "un texto sin marcas no tiene trozos");
  assert.deepEqual(chunkStarts("\\c 1\n\\p\n\\v 1 Uno. \\ts\\*\n\\v 2 Dos.\n\n\\ts\\*\n\\v 3-4 Tres.\n\\ts\\*\n"), ["1:2", "1:3"], "colgada del renglón anterior, ante un puente, y la que no abre nada");
});

/** Jonah 1–2 of a team, with no chunk marks: prose, a psalm, a heading, a chapter label. */
const unmarked = [
  "\\id JON EN_GLT es-419_Español",
  "\\usfm 3.0",
  "\\h Jonás",
  "\\mt Jonás",
  "\\c 1",
  "\\cl Capítulo 1",
  "\\p",
  "\\v 1 Y la palabra de Jehová vino.",
  "\\v 2 «Levántate». ",
  "\\c 2",
  "\\cl Capítulo 2",
  "\\p",
  "\\v 1 Y Jonás oró.",
  "\\v 2 Y él dijo:",
  "\\q Clamé a Jehová;",
  "\\q2 desde el vientre clamé.",
  "\\s1 El abismo",
  "\\q",
  "\\v 3 Ahora me echaste;",
  "\\q2 todas tus ondas.",
  "\\b",
  "\\q",
  "\\v 4 Yo dije.",
  "\\v 5 Las aguas.",
  "\\m",
  "\\v 6 Entonces.",
  "",
].join("\n");

test("un texto del equipo toma las marcas de trozo de su original, ante los mismos versículos, y nada más cambia", () => {
  const marked = withChunkMarksOf(unmarked, source);
  assert.deepEqual(chunkStarts(marked), ["1:1", "2:1", "2:3"]);
  assert.equal(
    marked,
    unmarked
      .replace("\\mt Jonás\n\\c 1", "\\mt Jonás\n\n\\ts\\*\n\\c 1")
      .replace("«Levántate». \n\\c 2", "«Levántate». \n\n\\ts\\*\n\\c 2")
      .replace("desde el vientre clamé.\n\\s1 El abismo", "desde el vientre clamé.\n\n\\ts\\*\n\\s1 El abismo"),
    "tras una línea vacía, sola en su línea, antes del capítulo, del título y del renglón que el trozo abre",
  );
  // Taken out again, the text is what it was, byte for byte.
  assert.equal(marked.replace(/\n\n\\ts\\\*(?=\n)/g, "").replace("\n\\ts\\*\n\\c 1", "\\c 1"), unmarked);
  const texts = (usfm: string) => listVerseSpans(usfm).map((s) => `${s.chapter}:${s.verse} ${s.text}`);
  assert.deepEqual(texts(marked), texts(unmarked), "cada versículo dice lo mismo");
  assert.deepEqual(parts(marked, 2, 2).lines, parts(unmarked, 2, 2).lines, "y tiene los mismos renglones");
  assert.equal(parts(marked, 2, 2).tail, "\n\n\\ts\\*\n\\s1 El abismo\n\\q\n", "la marca queda fuera del versículo anterior");
});

test("poner las marcas de trozo otra vez no cambia nada, y las que el equipo ya tiene se quedan", () => {
  const marked = withChunkMarksOf(unmarked, source);
  assert.equal(withChunkMarksOf(marked, source), marked);
  // A mark of the team's own, where the source has none, and one where it has: neither is touched nor doubled.
  const own = unmarked.replace("\\m\n\\v 6", "\n\\ts\\*\n\\m\n\\v 6").replace("\\q\n\\v 3", "\\ts\\*\n\\q\n\\v 3");
  const both = withChunkMarksOf(own, source);
  assert.deepEqual(chunkStarts(both), ["1:1", "2:1", "2:3", "2:6"]);
  assert.equal((both.match(/\\ts\\\*/g) ?? []).length, 4);
  assert.ok(both.includes("\\s1 El abismo\n\\ts\\*\n\\q\n\\v 3"), "la del equipo, donde la puso");
  assert.equal(withChunkMarksOf(unmarked, psalm), unmarked, "un original sin marcas no pone ninguna");
});

test("un trozo que el original empieza dentro de dos versículos que el equipo unió no tiene dónde ir", () => {
  const bridged = unmarked.replace("\\v 2 Y él dijo:", "\\v 2-3 Y él dijo:").replace("\\s1 El abismo\n\\q\n\\v 3 Ahora me echaste;", "\\q Ahora me echaste;");
  assert.deepEqual(chunkStarts(withChunkMarksOf(bridged, source)), ["1:1", "2:1"]);
  // A verse in two parts takes its mark before the first.
  const parted = "\\id JON\n\\c 1\n\\p\n\\v 1 Uno.\n\\v 2a Dos,\n\\p\n\\v 2b y tres.\n";
  const src = "\\id JON\n\n\\ts\\*\n\\c 1\n\\p\n\\v 1 One.\n\n\\ts\\*\n\\v 2 Two.\n";
  assert.equal(withChunkMarksOf(parted, src), "\\id JON\n\n\\ts\\*\n\\c 1\n\\p\n\\v 1 Uno.\n\n\\ts\\*\n\\v 2a Dos,\n\\p\n\\v 2b y tres.\n");
});

test("con alineación y con finales de línea de dos caracteres, la marca va tras el último grupo del versículo anterior", () => {
  const aligned = withChunkMarksOf(alignedPsalm, source);
  assert.deepEqual(chunkStarts(aligned), ["2:1", "2:3"]);
  assert.ok(aligned.includes(`${Z("שאול", "vientre")}.\n\n\\ts\\*\n\\q\n\\v 3 `), "antes del renglón que abre 2:3");
  assert.ok(aligned.includes("\\mt Jonás\n\n\\ts\\*\n\\c 2\n"));
  for (const verse of [1, 2, 3, 4]) assert.deepEqual(linkedWords(aligned, verse), linkedWords(alignedPsalm, verse), `la alineación de 2:${verse}`);
  // Saved again from the editor, untouched: nothing is written, and the marks are still there.
  assert.equal(applyVerseEditsKeepingAlignment(aligned, 2, draftSlots(aligned, { chapter: 2, from: 1, to: 4 })).usfm, aligned);
  const edited = applyVerseEditsKeepingAlignment(aligned, 2, [{ verse: 2, text: "Y dijo:\nClamé a Jehová desde mi aflicción;\ndesde el vientre." }]).usfm;
  assert.deepEqual(chunkStarts(edited), ["2:1", "2:3"], "editar el versículo anterior a una marca no la quita");
  const crlf = withChunkMarksOf(unmarked.replace(/\n/g, "\r\n"), source);
  assert.ok(crlf.includes("desde el vientre clamé.\r\n\r\n\\ts\\*\r\n\\s1 El abismo") && !/[^\r]\n/.test(crlf));
});

test("la entrega de un versículo no quita la marca de trozo que le sigue en el borrador del grupo", () => {
  const trunk = withChunkMarksOf(unmarked, source);
  const work = applyVerseEdits(unmarked, 2, [{ verse: 2, text: "Y él dijo:\nClamé a Jehová;\ndesde el Seol clamé." }]);
  const patched = patchTrunkByVerse(trunk, [work], { ancestor: unmarked, scope: { chapter: 2, from: 1, to: 6 } });
  assert.deepEqual(chunkStarts(patched.usfm), ["1:1", "2:1", "2:3"]);
  assert.ok(patched.usfm.includes("\\q2 desde el Seol clamé.\n\n\\ts\\*\n\\s1 El abismo"));
});

test("sin el nombre del libro dice su código, y sin original, un párrafo con sus versículos", () => {
  assert.ok(skeletonUsfmFromSource("JON", source).startsWith("\\id JON\n\\usfm 3.0\n\\ide UTF-8\n\\h JON\n\n\\ts\\*\n\\c 1\n"));
  assert.equal(skeletonUsfm("1JN", 1, 1, 2, "1 Juan"), "\\id 1JN\n\\usfm 3.0\n\\ide UTF-8\n\\h 1 Juan\n\\toc1 1 Juan\n\\toc2 1 Juan\n\\toc3 1Jn\n\\mt 1 Juan\n\\c 1\n\\p\n\\v 1\n\\v 2\n");
  assert.equal(buildBookUsfmSkeleton({ book: "JON", fallbackRange: { chapter: 2, from: 1, to: 1 }, name: "Jonás" }), skeletonUsfm("JON", 2, 1, 1, "Jonás"));
});

test("al escribir un versículo de ese libro, sus renglones toman las marcas que el original tiene en ese versículo", () => {
  const leads = verseLeads(source, 2);
  assert.deepEqual(leads, { 2: ["", "\\q1", "\\q2"], 3: ["", "\\q2"] }, "solo los versículos con más de un renglón");
  const book = skeletonUsfmFromSource("JON", source, "Jonás");
  const written = applyVerseEdits(book, 2, [
    { from: 1, to: 1, text: "Y Jonás oró." },
    { from: 2, to: 2, text: "Y él dijo:\nClamé a Jehová;\ndesde el vientre clamé.", leads: leads[2] },
    { from: 3, to: 3, text: "Ahora me echaste;\ntodas tus ondas.", leads: leads[3] },
  ]);
  assert.ok(written.includes(["\\c 2", "\\p", "\\v 1 Y Jonás oró.", "\\v 2 Y él dijo:", "\\q1 Clamé a Jehová;", "\\q2 desde el vientre clamé.", "", "\\ts\\*", "\\q1", "\\v 3 Ahora me echaste;", "\\q2 todas tus ondas.", "\\b", "\\q1", "\\v 4-5", "\\m", "\\v 6"].join("\n")));
  assert.deepEqual(chunkStarts(written), chunkStarts(source), "escribir los versículos no mueve los trozos");
});

// ---------------------------------------------------------------- the whole book of a team

const fixture = (name: string) => fileURLToPath(new URL(`../../usfm-ast/packages/usfm-parser/tests/fixtures/usfm/${name}`, import.meta.url));
if (existsSync(fixture("jud.ult-aligned.usfm")) && existsSync(fixture("jud.tpl-nested-writer.usfm"))) {
  const ult = readFileSync(fixture("jud.ult-aligned.usfm"), "utf8").replace(/\r\n/g, "\n");
  const team = readFileSync(fixture("jud.tpl-nested-writer.usfm"), "utf8").replace(/\r\n/g, "\n");

  test("Judas entero: el texto del equipo, que no tenía ninguna, toma las once marcas de trozo del ULT", () => {
    assert.equal(chunkStarts(ult).length, 11);
    assert.deepEqual(chunkStarts(team), []);
    const marked = withChunkMarksOf(team, ult);
    assert.deepEqual(chunkStarts(marked), chunkStarts(ult), "ante los mismos versículos");
    const said = (usfm: string) => listVerseSpans(usfm).map((s) => `${s.verse} ${s.text} ${[...s.rawBody.matchAll(/\\zaln-s\b/g)].length}`);
    assert.deepEqual(said(marked), said(team), "cada versículo, con su texto y su alineación, como estaba");
    assert.equal(marked.split("\n").filter((line) => line !== "" && line !== "\\ts\\*").join("\n"), team.split("\n").filter((line) => line !== "").join("\n"), "solo se agregaron líneas");
    assert.equal(withChunkMarksOf(marked, ult), marked);
  });
} else {
  console.log("--  Judas entero: no están los archivos de prueba de usfm-ast; no se ejecutó.");
}

const real = fileURLToPath(new URL("../../usfm-ast/packages/usfm-parser/tests/fixtures/usfm/jon.tpl-aligned.usfm", import.meta.url));
if (existsSync(real)) {
  const jonah = readFileSync(real, "utf8").replace(/\r\n/g, "\n");
  /**
   * Each word of each verse with the words of the original it is linked to. How many groups that is written in
   * is the writer's to choose (two neighbours of the same original word are written as one).
   */
  const groups = (usfm: string) =>
    listVerseSpans(usfm).map((s) => {
      const open: string[] = [];
      const pairs: string[] = [];
      for (const mark of s.rawBody.matchAll(/\\zaln-s\s*\|([^\\]*)\\\*|\\zaln-e\\\*|\\w\s+([^|\\]+)\|[^\\]*?x-occurrence="(\d+)"/g)) {
        if (mark[0].startsWith("\\zaln-s")) open.push(`${/x-content="([^"]*)"/.exec(mark[1]!)?.[1]}#${/x-occurrence="(\d+)"/.exec(mark[1]!)?.[1]}`);
        else if (mark[0].startsWith("\\zaln-e")) open.pop();
        else pairs.push(`${mark[2]}#${mark[3]}=${[...open].sort().join("+")}`);
      }
      return `${s.chapter}:${s.verse} ${pairs.join(" ")}`;
    });
  const texts = (usfm: string) => listVerseSpans(usfm).map((s) => `${s.chapter}:${s.verse} ${s.text}`);
  const marks = (usfm: string) => (usfm.match(/\\(?:c \d+|v \d+|q\d?|p|m|b|nb|cl)(?=\s|$)/gm) ?? []).join(" ");

  test("Jonás entero, como lo tiene un equipo: cambiar una palabra de 2:2 no cambia nada más del libro", () => {
    const rows = draftSlots(jonah, { chapter: 2, from: 1, to: 10 });
    assert.equal(rows[1]!.text.split("\n").length, 3, "2:2 llega al editor en sus tres renglones");
    rows[1] = { ...rows[1]!, text: rows[1]!.text.replace("angustia", "aflicción") };
    const saved = applyVerseEditsKeepingAlignment(jonah, 2, rows).usfm;
    const [was, now] = [texts(jonah), texts(saved)];
    assert.deepEqual(now.filter((line, index) => line !== was[index]), [`2:2 ${span(jonah, 2, 2).text.replace("angustia", "aflicción")}`], "el texto de los otros 47 versículos, igual");
    const [had, has] = [groups(jonah), groups(saved)];
    assert.deepEqual(has.filter((line, index) => line !== had[index]).map((line) => line.split(" ")[0]), ["2:2"], "la alineación de los otros 47, igual");
    // In the verse itself, the word that changed lost its link and no other did: its groups come in the order of
    // the original («desde … angustia», then «mi», which stands between them), and most of them were lost.
    const of = (lines: string[]) => lines.find((line) => line.startsWith("2:2 "))!.split(" ").slice(1);
    assert.deepEqual(of(has), of(had).filter((pair) => !pair.startsWith("angustia#")), "en 2:2 solo «angustia» pierde su enlace");
    assert.ok(of(had).length >= 20, "y eran más de veinte palabras enlazadas");
    assert.equal(marks(saved), marks(jonah), "los 9 \\q y los 8 \\q2 del salmo, y todo lo demás, donde estaban");
    assert.equal(parts(saved, 2, 2).lines.length, 3);
    assert.ok(saved.includes("x-lemma=\"\" x-morph=\"He,R"), "los prefijos del hebreo conservan su lema vacío y su morfología");
  });

  test("Jonás entero: lo que el editor devuelve sin tocar no escribe, capítulo por capítulo", () => {
    for (const chapter of [1, 2, 3, 4]) {
      const last = Math.max(...listVerseSpans(jonah).filter((s) => s.chapter === chapter).map((s) => s.verseTo));
      // The rows as the editor gets them.
      const rows = extractDraftVerses(jonah, { chapter, from: 1, to: last }).slots;
      assert.equal(rows.length, last);
      assert.ok(!rows.some((row) => /Capítulo/.test(row.text)), `la etiqueta del capítulo ${chapter + 1} no es del último versículo del ${chapter}`);
      assert.equal(applyVerseEditsKeepingAlignment(jonah, chapter, rows).usfm, jonah, `capítulo ${chapter}`);
    }
  });

  test("Jonás entero: una corrección que llega corrida deja 2:2 en sus tres renglones y a 2:3 con su marca", () => {
    const flat = span(jonah, 2, 2).text.replace("angustia", "aflicción");
    const corrected = applyVerseEditsKeepingAlignment(jonah, 2, [{ verse: 2, text: flat, flat: true }]).usfm;
    assert.deepEqual(parts(corrected, 2, 2).lines.map((line) => line.lead), parts(jonah, 2, 2).lines.map((line) => line.lead));
    assert.equal(span(corrected, 2, 2).text, flat);
    assert.equal(marks(corrected), marks(jonah));
    assert.deepEqual(groups(corrected).filter((line, index) => line !== groups(jonah)[index]).map((line) => line.split(" ")[0]), ["2:2"]);
  });

  test("Jonás entero: la entrega de ese cambio lleva al borrador solo 2:2", () => {
    const rows = draftSlots(jonah, { chapter: 2, from: 2, to: 2 });
    const work = applyVerseEditsKeepingAlignment(jonah, 2, [{ ...rows[0]!, text: rows[0]!.text.replace("angustia", "aflicción") }]).usfm;
    const patched = patchTrunkByVerse(jonah, [work], { ancestor: jonah, scope: { chapter: 2, from: 1, to: 10 } });
    assert.deepEqual(patched.patched, [{ chapter: 2, from: 2, to: 2 }]);
    assert.equal(without(patched.usfm, 2, 2), without(jonah, 2, 2), "el borrador del equipo conserva cada byte de lo demás");
    assert.equal(parts(patched.usfm, 2, 2).lines.length, 3);
  });
} else {
  console.log("--  Jonás entero: no está el archivo de prueba de usfm-ast (jon.tpl-aligned.usfm); no se ejecutó.");
}

console.log(`\nverify-usfm-poetry: ${passed} checks passed.`);
