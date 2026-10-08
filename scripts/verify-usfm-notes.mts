/**
 * A verse has more than its words: a footnote (`\f + \fr 1:5 \ft … \f*`), words marked in it (`\nd Jehová\nd*`,
 * `\add …\add*`, `\qs Selah\qs*`). Whoever edits a verse sees its words alone, and the verse was written again
 * from them alone: one word changed in Jude 1:5 took its footnote with it. Each way a verse is written is gone
 * through here with a note and with marked words: read for the editor, saved with a word changed before the
 * note, after it and under it, with and without alignment, in a verse of several lines, corrected as one run of
 * text, delivered; and each time every other verse of the book is, byte for byte, what it was.
 * Run: npm run verify:usfm-notes
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applyVerseEditsKeepingAlignment, versesChangedBesides } from "../src/domain/alignmentKeep";
import { extractDraftVerses } from "../src/domain/usfmAst";
import { applyVerseEdits, chapterMarkup, listVerseSpans, normalizeVerseText, verseMarkup, verseParts } from "../src/domain/usfmEdit";
import { patchTrunkByVerse } from "../src/domain/usfmTrunkPatch";
import { carryMarkup, readVerse, verseNotes } from "../src/domain/verseMarkup";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const span = (usfm: string, chapter: number, verse: number) => listVerseSpans(usfm).find((s) => s.chapter === chapter && s.verse === verse)!;
/** A verse as it is written, from its `\v` to the end of its text. */
const body = (usfm: string, chapter: number, verse: number) => {
  const s = span(usfm, chapter, verse);
  return usfm.slice(s.start, verseParts(usfm, s).textEnd);
};
/** The document with one verse cut out, to see that nothing else moved. */
const without = (usfm: string, chapter: number, verse: number) => {
  const s = span(usfm, chapter, verse);
  return usfm.slice(0, s.start) + usfm.slice(verseParts(usfm, s).textEnd);
};
const count = (text: string, piece: string) => text.split(piece).length - 1;

/**
 * A verse changed as the editor changes it: every verse of the chapter is sent back, one of them with other
 * words. Whatever the change, the rest of the book is what it was, byte for byte.
 */
function edited(usfm: string, chapter: number, verse: number, change: (text: string) => string): string {
  const verses = listVerseSpans(usfm).filter((s) => s.chapter === chapter);
  const rows = extractDraftVerses(usfm, { chapter, from: Math.min(...verses.map((s) => s.verse)), to: Math.max(...verses.map((s) => s.verseTo)) }).slots;
  const at = rows.findIndex((row) => row.from === verse);
  rows[at] = { ...rows[at]!, text: change(rows[at]!.text) };
  const saved = applyVerseEditsKeepingAlignment(usfm, chapter, rows).usfm;
  assert.equal(without(saved, chapter, verse), without(usfm, chapter, verse), `fuera de ${chapter}:${verse} no cambió ni un byte`);
  return saved;
}

// ---------------------------------------------------------------- a note, with no alignment

const NOTE = "\\f + \\fr 1:5 \\ft Algunos manuscritos antiguos dicen \\fqa el Señor\\fqa*.\\f*";
const NOTE6 = "\\f + \\fr 1:6 \\ft O \\fqa su posición de autoridad\\fqa*.\\f*";
const jude = [
  "\\id JUD EN_GLT es-419_Español",
  "\\usfm 3.0",
  "\\h Judas",
  "\\mt Judas",
  "\\c 1",
  "\\p",
  "\\v 4 Porque algunos hombres han entrado sin ser notados.",
  `\\v 5 Ahora quiero recordarles que Jesús,${NOTE} habiendo salvado a un pueblo de la tierra de Egipto, después destruyó a los que no creyeron.`,
  `\\v 6 Y a los ángeles que no guardaron su dominio${NOTE6} los ha guardado en cadenas.`,
  "\\s1 Los falsos maestros",
  "\\p",
  "\\v 7 Como Sodoma y Gomorra.",
  "",
].join("\n");
const FIVE = "Ahora quiero recordarles que Jesús, habiendo salvado a un pueblo de la tierra de Egipto, después destruyó a los que no creyeron.";

test("el versículo se lee sin su nota, y el editor recibe solo sus palabras", () => {
  const rows = extractDraftVerses(jude, { chapter: 1, from: 4, to: 7 }).slots;
  assert.equal(rows[1]!.text, FIVE);
  assert.equal(rows[2]!.text, "Y a los ángeles que no guardaron su dominio los ha guardado en cadenas.");
  assert.equal(span(jude, 1, 5).text, FIVE);
  const kept = verseMarkup(jude, span(jude, 1, 5));
  assert.equal(kept.text, FIVE);
  assert.deepEqual(kept.anchors, [{ at: FIVE.indexOf("Jesús,") + "Jesús,".length, side: "after", raw: NOTE, note: true }]);
  assert.deepEqual(kept.marks, []);
});

test("una nota, una marca o un hito no ocupan lugar en el texto: no dejan un espacio antes de un punto ni dentro de un paréntesis", () => {
  assert.equal(normalizeVerseText("la palabra\\f + \\ft nota\\f*, y más"), "la palabra, y más");
  assert.equal(normalizeVerseText("salvó al \\add pueblo\\add*."), "salvó al pueblo.");
  assert.equal(normalizeVerseText("vino (\\nd Jehová\\nd*) a él"), "vino (Jehová) a él");
  assert.equal(normalizeVerseText("dijo: «\\wj Yo soy\\wj*»."), "dijo: «Yo soy».");
  assert.equal(normalizeVerseText("Dijo: \"\\qt-s |who=\"Dios\"\\*Sal\\qt-e\\*\"."), "Dijo: \"Sal\".");
  // Between two letters they still part two words, as they always did.
  assert.equal(normalizeVerseText("que\\nd Jesús\\nd*salvó"), "que Jesús salvó");
  assert.equal(normalizeVerseText("uno\\f + \\ft nota\\f*dos"), "uno dos");
  // What a marked run says of itself is not of its text; a mark that is never closed is one that begins a line.
  assert.equal(normalizeVerseText("por \\w gracia|lemma=\"grace\"\\w* y \\jmp fe|link-href=\"x\"\\jmp*."), "por gracia y fe.");
  assert.equal(normalizeVerseText("\\q1 uno\n\\q2 dos \\qs Selah\\qs*\n\\s1 Un título\n\\p"), "uno dos Selah");
});

test("cambiar una palabra antes de la nota, o después, deja la nota donde estaba", () => {
  assert.equal(edited(jude, 1, 5, (text) => text.replace("recordarles", "advertirles")), jude.replace("recordarles", "advertirles"));
  assert.equal(edited(jude, 1, 5, (text) => text.replace("habiendo salvado", "que salvó")), jude.replace("habiendo salvado", "que salvó"));
  assert.equal(edited(jude, 1, 5, (text) => text.replace("no creyeron.", "no creyeron en él.")), jude.replace("no creyeron.", "no creyeron en él."));
  assert.equal(edited(jude, 1, 5, (text) => `Hermanos: ${text}`), jude.replace("\\v 5 Ahora", "\\v 5 Hermanos: Ahora"));
});

test("cambiar la palabra de la que cuelga la nota: la nota sigue a la que quedó en su lugar", () => {
  assert.equal(edited(jude, 1, 5, (text) => text.replace("Jesús,", "Jesucristo,")), jude.replace("Jesús,", "Jesucristo,"));
  assert.equal(edited(jude, 1, 5, (text) => text.replace("que Jesús,", "que el Señor Jesús,")), jude.replace("que Jesús,", "que el Señor Jesús,"));
  // Without its comma the note follows the word itself; with a comma written again, the comma.
  const bare = edited(jude, 1, 5, (text) => text.replace("Jesús,", "Jesús"));
  assert.equal(bare, jude.replace("Jesús,", "Jesús"));
  assert.equal(edited(bare, 1, 5, (text) => text.replace("Jesús ", "Jesús; ")), jude.replace("Jesús,", "Jesús;"));
  // What is written right after the note's word is not the note's word.
  assert.equal(edited(jude, 1, 5, (text) => text.replace("Jesús, habiendo", "Jesús, él mismo, habiendo")), jude.replace(" habiendo", " él mismo, habiendo"));
});

test("quitar la palabra de la que cuelga la nota la pasa a la palabra anterior; nunca se pierde", () => {
  const gone = edited(jude, 1, 5, (text) => text.replace("que Jesús, habiendo", "que habiendo"));
  assert.equal(body(gone, 1, 5), `\\v 5 Ahora quiero recordarles que${NOTE} habiendo salvado a un pueblo de la tierra de Egipto, después destruyó a los que no creyeron.`);
  // With no word left before it, it stands before the first word of the verse, and is read as no part of it.
  const first = jude.replace("\\v 4 Porque algunos", `\\v 4 Porque,${NOTE} algunos`);
  const start = edited(first, 1, 4, (text) => text.replace("Porque, algunos", "algunos"));
  assert.equal(body(start, 1, 4), `\\v 4 ${NOTE}algunos hombres han entrado sin ser notados.`);
  assert.equal(span(start, 1, 4).text, "algunos hombres han entrado sin ser notados.");
  assert.equal(body(edited(start, 1, 4, (text) => text.replace("han entrado", "entraron")), 1, 4), `\\v 4 ${NOTE}algunos hombres entraron sin ser notados.`);
  // Its word and the next written again as other words: as far into them as it was.
  assert.equal(body(edited(first, 1, 4, (text) => text.replace("Porque, algunos", "Ciertos")), 1, 4), `\\v 4 Ciertos${NOTE} hombres han entrado sin ser notados.`);
});

test("un versículo escrito todo de nuevo conserva su nota, y uno que se borra entero también", () => {
  const other = edited(jude, 1, 5, () => "Les recuerdo esto: el Señor rescató a los suyos y luego juzgó a los incrédulos.");
  assert.equal(count(body(other, 1, 5), NOTE), 1, "la nota está, una vez");
  assert.equal(span(other, 1, 5).text, "Les recuerdo esto: el Señor rescató a los suyos y luego juzgó a los incrédulos.");
  // Cleared to be written again (the editor saves by itself in between): the note waits in its verse.
  const cleared = edited(jude, 1, 5, () => "");
  assert.equal(body(cleared, 1, 5), `\\v 5 ${NOTE}`);
  assert.equal(extractDraftVerses(cleared, { chapter: 1, from: 5, to: 5 }).slots[0]!.text, "");
  assert.deepEqual(verseParts(cleared, span(cleared, 1, 5)).lines, [], "sin texto, no tiene renglones");
  assert.equal(body(edited(cleared, 1, 5, () => "Jesús salvó a un pueblo."), 1, 5), `\\v 5 Jesús salvó a un pueblo.${NOTE}`, "sin palabra de la que colgar, al final");
});

test("lo que el editor devuelve sin tocar no escribe nada, y lo guardado se lee como se escribió", () => {
  const rows = extractDraftVerses(jude, { chapter: 1, from: 4, to: 7 }).slots;
  assert.equal(applyVerseEdits(jude, 1, rows), jude);
  assert.equal(applyVerseEditsKeepingAlignment(jude, 1, rows).usfm, jude);
  const saved = edited(jude, 1, 5, (text) => text.replace("que Jesús, habiendo", "que habiendo"));
  const again = extractDraftVerses(saved, { chapter: 1, from: 4, to: 7 }).slots;
  assert.equal(again[1]!.text, FIVE.replace("que Jesús, habiendo", "que habiendo"));
  assert.equal(applyVerseEdits(saved, 1, again), saved);
});

test("cada nota de un versículo sigue a su palabra, y una nota en su propia línea es de su versículo", () => {
  const A = "\\f + \\ft primera\\f*";
  const B = "\\x - \\xo 1:1 \\xt Gn 1:1\\x*";
  const two = `\\id GEN\n\\c 1\n\\p\n\\v 1 En el principio${A} creó Dios los cielos${B} y la tierra.\n\\v 2 Y la tierra.\n`;
  assert.equal(edited(two, 1, 1, (text) => text.replace("creó Dios", "Dios hizo")), two.replace("creó Dios", "Dios hizo"));
  assert.equal(edited(two, 1, 1, (text) => text.replace("los cielos", "el cielo")), two.replace("los cielos", "el cielo"));
  // Both with their word gone: each after the word before it that is left, in their order.
  assert.equal(body(edited(two, 1, 1, (text) => text.replace("el principio creó Dios los cielos y", "él Dios hizo")), 1, 1), `\\v 1 En él${A} Dios hizo${B} la tierra.`);
  assert.equal(body(edited(two, 1, 1, (text) => text.replace(" el principio creó Dios los cielos", "tonces")), 1, 1), `\\v 1 Entonces${A}${B} y la tierra.`);
  const apart = `\\id JON\n\\c 2\n\\p\n\\v 9 Pero yo cumpliré.\n${A}\n\\s1 El pez obedece\n\\p\n\\v 10 Y Jehová habló.\n`;
  assert.equal(verseParts(apart, span(apart, 2, 9)).tail, "\n\\s1 El pez obedece\n\\p\n", "lo que sigue al versículo empieza después de su nota");
  assert.equal(extractDraftVerses(apart, { chapter: 2, from: 9, to: 10 }).slots[0]!.text, "Pero yo cumpliré.");
  assert.equal(edited(apart, 2, 9, (text) => text.replace("Pero yo", "Yo sí")), apart.replace(`Pero yo cumpliré.\n${A}`, `Yo sí cumpliré.${A}`));
});

test("al unir dos versículos cada nota sigue en su palabra, y los finales de línea del archivo se conservan", () => {
  const rows = extractDraftVerses(jude, { chapter: 1, from: 4, to: 7 }).slots;
  const joined = applyVerseEdits(jude, 1, [rows[0]!, { from: 5, to: 6, text: `${rows[1]!.text} ${rows[2]!.text}` }, rows[3]!]);
  assert.ok(joined.includes(`\\v 5-6 Ahora quiero recordarles que Jesús,${NOTE} habiendo salvado`));
  assert.ok(joined.includes(`su dominio${NOTE6} los ha guardado en cadenas.\n\\s1 Los falsos maestros\n`));
  const crlf = jude.replace(/\n/g, "\r\n");
  assert.equal(edited(crlf, 1, 5, (text) => text.replace("recordarles", "advertirles")), crlf.replace("recordarles", "advertirles"));
});

test("al separar dos versículos que estaban escritos como uno, la nota se queda con la parte que lleva su texto", () => {
  const A = "\\f + \\ft primera\\f*";
  const bridge = `\\id GEN\n\\c 1\n\\p\n\\v 1 Uno.\n\\q\n\\v 2-3 En el principio${A} creó Dios.\n\\v 4 Cuatro.\n`;
  // As the editor parts a row: the text stays in the first verse, and the second waits to be written.
  const parted = applyVerseEdits(bridge, 1, [{ from: 2, to: 2, text: "En el principio creó Dios." }, { from: 3, to: 3, text: "" }]);
  assert.equal(parted, bridge.replace("\\v 2-3 ", "\\v 2 ").replace("\\v 4", "\\v 3\n\\v 4"));
  const both = applyVerseEdits(bridge, 1, [{ from: 2, to: 2, text: "En el principio" }, { from: 3, to: 3, text: "creó Dios." }]);
  assert.ok(both.includes(`\\q\n\\v 2 En el principio${A}\n\\v 3 creó Dios.\n\\v 4 Cuatro.`));
});

// ---------------------------------------------------------------- words that are marked

const jonah = [
  "\\id JON EN_GLT es-419_Español",
  "\\c 1",
  "\\p",
  "\\v 1 La palabra de \\nd Jehová\\nd* vino a Jonás, hijo de Amitai (\\add el profeta\\add*).",
  "\\v 2 Levántate, ve a Nínive, la gran ciudad.",
  "\\v 3 Pero Jonás huyó de la presencia de \\add su Dios \\+nd Jehová\\+nd* el grande\\add*.",
  "",
].join("\n");

test("una palabra marcada que no cambia sigue marcada, cambie lo que cambie a su alrededor", () => {
  assert.equal(extractDraftVerses(jonah, { chapter: 1, from: 1, to: 3 }).slots[0]!.text, "La palabra de Jehová vino a Jonás, hijo de Amitai (el profeta).");
  assert.equal(edited(jonah, 1, 1, (text) => text.replace("vino", "llegó")), jonah.replace("vino", "llegó"));
  assert.equal(edited(jonah, 1, 1, (text) => text.replace("La palabra", "El mensaje")), jonah.replace("La palabra", "El mensaje"));
  assert.equal(edited(jonah, 1, 1, (text) => text.replace("hijo de Amitai (el profeta)", "el hijo de Amitai (el profeta)")), jonah.replace("hijo de Amitai", "el hijo de Amitai"));
  // What is written beside a marked word is not marked; what is written inside a marked run is.
  assert.equal(edited(jonah, 1, 1, (text) => text.replace("de Jehová", "de nuestro Jehová")), jonah.replace("de \\nd", "de nuestro \\nd"));
  assert.equal(edited(jonah, 1, 1, (text) => text.replace("el profeta", "el gran profeta")), jonah.replace("el profeta", "el gran profeta"));
});

test("una palabra marcada que se cambia por otra sigue marcada", () => {
  assert.equal(edited(jonah, 1, 1, (text) => text.replace("Jehová", "Yahvé")), jonah.replace("Jehová\\nd* vino", "Yahvé\\nd* vino"));
  assert.equal(edited(jonah, 1, 1, (text) => text.replace("Jehová", "el Señor")), jonah.replace("Jehová\\nd* vino", "el Señor\\nd* vino"), "otro nombre, de dos palabras");
  assert.equal(edited(jonah, 1, 1, (text) => text.replace("el profeta", "ese vidente")), jonah.replace("el profeta", "ese vidente"), "todas las de un tramo marcado");
  // With its neighbour, word for word.
  assert.equal(edited(jonah, 1, 1, (text) => text.replace("de Jehová", "del Señor")), jonah.replace("de \\nd Jehová", "del \\nd Señor"));
});

test("la marca se va solo cuando no queda nada de lo que marcaba", () => {
  const removed = edited(jonah, 1, 1, (text) => text.replace("La palabra de Jehová vino", "La palabra vino"));
  assert.equal(body(removed, 1, 1), "\\v 1 La palabra vino a Jonás, hijo de Amitai (\\add el profeta\\add*).");
  // Its words written again with others that nobody marked, not word for word: there is no telling which is the name.
  const blurred = edited(jonah, 1, 1, (text) => text.replace("palabra de Jehová vino", "palabra que él dio llegó"));
  assert.equal(body(blurred, 1, 1), "\\v 1 La palabra que él dio llegó a Jonás, hijo de Amitai (\\add el profeta\\add*).");
  const other = edited(jonah, 1, 1, () => "Dios habló con un hombre llamado Jonás.");
  assert.equal(body(other, 1, 1), "\\v 1 Dios habló con un hombre llamado Jonás.", "un versículo escrito todo de nuevo no tiene marcas");
  assert.equal(body(edited(jonah, 1, 1, (text) => text.replace(" (el profeta)", "")), 1, 1), "\\v 1 La palabra de \\nd Jehová\\nd* vino a Jonás, hijo de Amitai.");
});

test("una marca dentro de otra sigue dentro, y un hito sigue junto a su palabra", () => {
  assert.equal(extractDraftVerses(jonah, { chapter: 1, from: 3, to: 3 }).slots[0]!.text, "Pero Jonás huyó de la presencia de su Dios Jehová el grande.");
  assert.equal(edited(jonah, 1, 3, (text) => text.replace("su Dios", "nuestro Dios")), jonah.replace("su Dios", "nuestro Dios"));
  assert.equal(edited(jonah, 1, 3, (text) => text.replace("huyó", "escapó")), jonah.replace("huyó", "escapó"));
  assert.equal(body(edited(jonah, 1, 3, (text) => text.replace(" Jehová", "")), 1, 3), "\\v 3 Pero Jonás huyó de la presencia de \\add su Dios el grande\\add*.");
  assert.equal(body(edited(jonah, 1, 3, (text) => text.replace("su Dios Jehová el grande", "Jehová")), 1, 3), "\\v 3 Pero Jonás huyó de la presencia de \\add \\+nd Jehová\\+nd*\\add*.");
  const speech = "\\id JON\n\\c 1\n\\p\n\\v 2 Y le dijo: \\qt-s |who=\"Dios\"\\*Levántate y ve\\qt-e\\*, y él se fue.\n\\v 3 Pero huyó.\n";
  assert.equal(span(speech, 1, 2).text, "Y le dijo: Levántate y ve, y él se fue.");
  assert.equal(edited(speech, 1, 2, (text) => text.replace("él se fue", "Jonás se fue")), speech.replace("él se fue", "Jonás se fue"));
  assert.equal(edited(speech, 1, 2, (text) => text.replace("Levántate y ve", "Anda, levántate y camina")), speech.replace("Levántate y ve", "Anda, levántate y camina"));
});

// ---------------------------------------------------------------- a verse of several lines

const SELAH_NOTE = "\\f + \\fr 3:2 \\ft Hebreo: \\fqa en Elohim\\fqa*.\\f*";
const psalm = [
  "\\id PSA EN_GLT es-419_Español",
  "\\c 3",
  "\\q1",
  "\\v 1 ¡Oh \\nd Jehová\\nd*, cuánto se han multiplicado mis adversarios!",
  "\\q1",
  "\\v 2 Muchos dicen de mí:",
  `\\q2 «No hay salvación para él en Dios».${SELAH_NOTE} \\qs Selah\\qs*`,
  "\\q1",
  "\\v 3 Pero tú, \\nd Jehová\\nd*, eres escudo alrededor de mí;",
  "\\q2 mi gloria, y el que levanta mi cabeza.",
  "",
].join("\n");

test("en un versículo de varios renglones la nota y la marca siguen en su renglón", () => {
  const rows = extractDraftVerses(psalm, { chapter: 3, from: 1, to: 3 }).slots;
  assert.equal(rows[1]!.text, "Muchos dicen de mí:\n«No hay salvación para él en Dios». Selah");
  assert.equal(rows[2]!.text, "Pero tú, Jehová, eres escudo alrededor de mí;\nmi gloria, y el que levanta mi cabeza.");
  assert.equal(applyVerseEdits(psalm, 3, rows), psalm);
  assert.equal(edited(psalm, 3, 2, (text) => text.replace("Muchos dicen", "Muchos hablan")), psalm.replace("Muchos dicen", "Muchos hablan"));
  assert.equal(edited(psalm, 3, 2, (text) => text.replace("salvación", "socorro")), psalm.replace("salvación", "socorro"));
  assert.equal(edited(psalm, 3, 3, (text) => text.replace("mi gloria", "mi honra")), psalm.replace("mi gloria", "mi honra"));
  assert.equal(edited(psalm, 3, 3, (text) => text.replace("escudo", "un escudo")), psalm.replace("escudo", "un escudo"));
});

test("al romper de otro modo los renglones, la nota y la marca van con su palabra", () => {
  const three = edited(psalm, 3, 2, () => "Muchos dicen de mí:\n«No hay salvación para él en Dios».\nSelah");
  assert.equal(body(three, 3, 2), `\\v 2 Muchos dicen de mí:\n\\q2 «No hay salvación para él en Dios».${SELAH_NOTE}\n\\q2 \\qs Selah\\qs*`);
  const moved = edited(psalm, 3, 2, () => "Muchos dicen de mí: «No hay salvación\npara él en Dios». Selah");
  assert.equal(body(moved, 3, 2), `\\v 2 Muchos dicen de mí: «No hay salvación\n\\q2 para él en Dios».${SELAH_NOTE} \\qs Selah\\qs*`);
  const one = edited(psalm, 3, 2, () => "Muchos hablan de mí: «No hay salvación para él en Dios». Selah");
  assert.equal(body(one, 3, 2), `\\v 2 Muchos hablan de mí: «No hay salvación para él en Dios».${SELAH_NOTE} \\qs Selah\\qs*`);
  assert.ok(one.includes("\\qs Selah\\qs*\n\\q1\n\\v 3 Pero tú"), "3:3 sigue abriendo su renglón");
});

test("una corrección que llega como texto corrido conserva los renglones, la nota y la marca", () => {
  const flat = "Muchos dicen de mí: «No hay socorro para él en Dios». Selah";
  assert.equal(applyVerseEdits(psalm, 3, [{ verse: 2, text: flat, flat: true }]), psalm.replace("salvación", "socorro"));
  assert.equal(applyVerseEditsKeepingAlignment(psalm, 3, [{ verse: 2, text: flat, flat: true }]).usfm, psalm.replace("salvación", "socorro"));
  assert.equal(applyVerseEdits(psalm, 3, [{ verse: 2, text: flat.replace("socorro", "salvación"), flat: true }]), psalm, "el mismo texto no escribe nada");
});

test("un tramo marcado que pasa de un renglón al siguiente se cierra al final del renglón y se abre en el otro", () => {
  const words = ["\\id JHN", "\\c 14", "\\q1", "\\v 6 Jesús le dijo: «\\wj Yo soy el camino,", "\\q2 y la verdad, y la vida\\wj*».", "\\q1", "\\v 7 Si me conocieran.", ""].join("\n");
  assert.equal(extractDraftVerses(words, { chapter: 14, from: 6, to: 7 }).slots[0]!.text, "Jesús le dijo: «Yo soy el camino,\ny la verdad, y la vida».");
  assert.equal(applyVerseEdits(words, 14, extractDraftVerses(words, { chapter: 14, from: 6, to: 7 }).slots), words, "sin tocarlo, queda como está escrito");
  const saved = edited(words, 14, 6, (text) => text.replace("camino", "sendero"));
  assert.equal(body(saved, 14, 6), "\\v 6 Jesús le dijo: «\\wj Yo soy el sendero,\\wj*\n\\q2 \\wj y la verdad, y la vida\\wj*».");
  assert.equal(span(saved, 14, 6).text, "Jesús le dijo: «Yo soy el sendero, y la verdad, y la vida».");
  // Written on one line afterwards, each of the two is still around its words.
  assert.equal(body(edited(saved, 14, 6, (text) => text.replace("\n", " ").replace("verdad", "luz")), 14, 6), "\\v 6 Jesús le dijo: «\\wj Yo soy el sendero,\\wj* \\wj y la luz, y la vida\\wj*».");
});

// ---------------------------------------------------------------- with alignment

const Z = (content: string, word: string, occurrence = 1, occurrences = 1) =>
  `\\zaln-s |x-strong="G${content.length}" x-lemma="" x-morph="Gr,N" x-occurrence="1" x-occurrences="1" x-content="${content}"\\*\\w ${word}|x-occurrence="${occurrence}" x-occurrences="${occurrences}"\\w*\\zaln-e\\*`;
const ALIGNED_NOTE = "\\f + \\fr 1:5 \\ft Algunos manuscritos dicen \\fqa el Señor\\fqa*.\\f*";
/** Jude 1:4–6 as unfoldingWord's tools write a gateway text: a group to a line, the note after the comma of its word. */
const alignedJude = [
  "\\id JUD EN_GLT es-419_Español",
  "\\usfm 3.0",
  "\\h Judas",
  "\\mt Judas",
  "\\c 1",
  "\\p",
  `\\v 4 ${Z("γάρ", "Porque")}`,
  `${Z("τινες", "algunos")}`,
  `${Z("παρεισέδυσαν", "entraron")}.`,
  `\\v 5 ${Z("βούλομαι", "Quiero")}`,
  `${Z("ὑπομνῆσαι", "recordarles")}`,
  `${Z("ὅτι", "que")}`,
  `${Z("Ἰησοῦς", "Jesús")},${ALIGNED_NOTE}`,
  `${Z("σώσας", "habiendo")}`,
  `${Z("σώσας", "salvado")}`,
  `${Z("λαὸν", "al")}`,
  `${Z("λαὸν", "pueblo")}.`,
  `\\v 6 ${Z("ἀγγέλους", "Y")}`,
  `${Z("ἀγγέλους", "ángeles")}.`,
  "",
].join("\n");
const linkedWords = (usfm: string, chapter: number, verse: number) => [...span(usfm, chapter, verse).rawBody.matchAll(/\\w ([^|\\]+)\|/g)].map((m) => m[1]);

test("con alineación: el editor recibe las palabras, y lo que devuelve sin tocar no escribe nada", () => {
  const rows = extractDraftVerses(alignedJude, { chapter: 1, from: 4, to: 6 }).slots;
  assert.deepEqual(rows.map((row) => row.text), ["Porque algunos entraron.", "Quiero recordarles que Jesús, habiendo salvado al pueblo.", "Y ángeles."]);
  assert.equal(applyVerseEditsKeepingAlignment(alignedJude, 1, rows).usfm, alignedJude);
  assert.equal(verseMarkup(alignedJude, span(alignedJude, 1, 5)).anchors[0]!.raw, ALIGNED_NOTE);
});

test("con alineación: cambiar una palabra antes de la nota, o después, deja la nota tras su palabra y las demás palabras alineadas", () => {
  const before = edited(alignedJude, 1, 5, (text) => text.replace("recordarles", "advertirles"));
  assert.ok(body(before, 1, 5).includes(`\\w Jesús|x-occurrence="1" x-occurrences="1"\\w*\\zaln-e\\*,${ALIGNED_NOTE}\n`), "la nota, tras la coma de «Jesús»");
  assert.equal(count(before, ALIGNED_NOTE), 1);
  assert.deepEqual(linkedWords(before, 1, 5), ["Quiero", "que", "Jesús", "habiendo", "salvado", "al", "pueblo"], "solo la palabra que cambió pierde su enlace");
  assert.equal(span(before, 1, 5).text, "Quiero advertirles que Jesús, habiendo salvado al pueblo.");
  const after = edited(alignedJude, 1, 5, (text) => text.replace("al pueblo", "a su pueblo"));
  assert.ok(body(after, 1, 5).includes(`\\w Jesús|x-occurrence="1" x-occurrences="1"\\w*\\zaln-e\\*,${ALIGNED_NOTE}\n`));
  assert.deepEqual(linkedWords(after, 1, 5), ["Quiero", "recordarles", "que", "Jesús", "habiendo", "salvado", "pueblo"]);
  assert.deepEqual(versesChangedBesides(alignedJude, after, 1, [{ from: 5, to: 5 }]), []);
  // Saved again as it is read, nothing is written.
  assert.equal(applyVerseEditsKeepingAlignment(after, 1, extractDraftVerses(after, { chapter: 1, from: 4, to: 6 }).slots).usfm, after);
});

test("con alineación: al cambiar o quitar la palabra de la nota, la nota sigue a la que queda", () => {
  const changed = edited(alignedJude, 1, 5, (text) => text.replace("Jesús,", "Jesucristo,"));
  assert.ok(body(changed, 1, 5).includes(`Jesucristo,${ALIGNED_NOTE}\n`));
  assert.deepEqual(linkedWords(changed, 1, 5), ["Quiero", "recordarles", "que", "habiendo", "salvado", "al", "pueblo"]);
  const gone = edited(alignedJude, 1, 5, (text) => text.replace("que Jesús, habiendo", "que habiendo"));
  assert.ok(body(gone, 1, 5).includes(`\\w que|x-occurrence="1" x-occurrences="1"\\w*\\zaln-e\\*${ALIGNED_NOTE}\n`), "tras «que», que sigue alineada");
  assert.deepEqual(linkedWords(gone, 1, 5), ["Quiero", "recordarles", "que", "habiendo", "salvado", "al", "pueblo"]);
  const cleared = applyVerseEditsKeepingAlignment(alignedJude, 1, [{ verse: 5, text: "" }]);
  assert.equal(body(cleared.usfm, 1, 5), `\\v 5 ${ALIGNED_NOTE}`);
  assert.deepEqual(cleared.clearedVerses, [5]);
  assert.equal(without(cleared.usfm, 1, 5), without(alignedJude, 1, 5));
});

/** A psalm with a marked word that is aligned: the mark around its group. */
const alignedPsalm = [
  "\\id PSA EN_GLT es-419_Español",
  "\\usfm 3.0",
  "\\h Salmos",
  "\\mt Salmos",
  "\\c 3",
  "\\q1",
  `\\v 2 ${Z("רבים", "Muchos")}`,
  `${Z("אמרים", "dicen")}:`,
  `\\q2 ${Z("אין", "No")}`,
  `${Z("ישועתה", "hay")}`,
  `${Z("ישועתה", "salvación")}. \\qs ${Z("סלה", "Selah")}\\qs*`,
  "\\q1",
  `\\v 3 ${Z("ואתה", "Pero")}`,
  `${Z("ואתה", "tú")}.`,
  "",
].join("\n");

test("con alineación: una palabra marcada sigue marcada cuando se cambia su versículo, en sus renglones", () => {
  const rows = extractDraftVerses(alignedPsalm, { chapter: 3, from: 2, to: 3 }).slots;
  assert.deepEqual(rows.map((row) => row.text), ["Muchos dicen:\nNo hay salvación. Selah", "Pero tú."]);
  assert.equal(applyVerseEditsKeepingAlignment(alignedPsalm, 3, rows).usfm, alignedPsalm);
  const saved = edited(alignedPsalm, 3, 2, (text) => text.replace("dicen", "hablan"));
  assert.deepEqual(verseParts(saved, span(saved, 3, 2)).lines, [{ lead: "", text: "Muchos hablan:" }, { lead: "\\q2", text: "No hay salvación. Selah" }]);
  const kept = verseMarkup(saved, span(saved, 3, 2));
  assert.deepEqual(kept.marks.map((mark) => [mark.open, kept.text.slice(mark.from, mark.to), mark.close]), [["\\qs ", "Selah", "\\qs*"]]);
  // The marked word keeps its link too: the writer of the alignment writes the words inside a mark.
  assert.deepEqual(linkedWords(saved, 3, 2), ["Muchos", "No", "hay", "salvación", "Selah"], "solo «dicen», que cambió, pierde su enlace");
  // Its group is laid on a line of its own, as every group is: only the white space after `\qs` differs.
  assert.ok(body(saved, 3, 2).replace(/\\qs\s+/, "\\qs ").includes(`\\qs ${Z("סלה", "Selah")}\\qs*`), "«Selah», alineada dentro de su marca");
});

test("con alineación: guardar otro versículo no toca al que tiene una palabra marcada (antes no dejaba guardar)", () => {
  const saved = edited(alignedPsalm, 3, 3, (text) => text.replace("tú", "tú, Jehová"));
  assert.equal(body(saved, 3, 2), body(alignedPsalm, 3, 2));
  assert.deepEqual(linkedWords(saved, 3, 2), ["Muchos", "dicen", "No", "hay", "salvación", "Selah"]);
  assert.deepEqual(linkedWords(saved, 3, 3), ["Pero", "tú"]);
});

// ---------------------------------------------------------------- the delivery

test("la entrega lleva al borrador del equipo el versículo con su nota y sus marcas", () => {
  const work = edited(jude, 1, 5, (text) => text.replace("que Jesús, habiendo", "que habiendo"));
  const patched = patchTrunkByVerse(jude, [work], { ancestor: jude, scope: { chapter: 1, from: 4, to: 7 } });
  assert.deepEqual(patched.patched, [{ chapter: 1, from: 5, to: 5 }]);
  assert.equal(patched.usfm, work);
  const marked = edited(jonah, 1, 1, (text) => text.replace("Jehová", "el Señor"));
  assert.equal(patchTrunkByVerse(jonah, [marked], { ancestor: jonah, scope: { chapter: 1, from: 1, to: 3 } }).usfm, marked);
  // A note on a line of its own goes with its verse, and is not left twice in the draft.
  const A = "\\f + \\ft primera\\f*";
  const apart = `\\id JON\n\\c 2\n\\p\n\\v 9 Pero yo cumpliré.\n${A}\n\\s1 El pez obedece\n\\p\n\\v 10 Y Jehová habló.\n`;
  const kept = edited(apart, 2, 9, (text) => text.replace("Pero yo", "Yo sí"));
  const delivered = patchTrunkByVerse(apart, [kept], { ancestor: apart, scope: { chapter: 2, from: 9, to: 10 } }).usfm;
  assert.equal(delivered, kept);
  assert.equal(count(delivered, A), 1);
});

test("la entrega de un versículo que nadie tiene escrito como uno solo (10a y 10b) no pierde su nota", () => {
  const A = "\\f + \\ft nota\\f*";
  const trunk = ["\\id NEH", "\\c 1", "\\p", "\\v 9 nueve", "\\v 10 Tus criados y tu gente", "\\v 11 once", ""].join("\n");
  const work = ["\\id NEH", "\\c 1", "\\p", "\\v 9 nueve", "\\v 10a Tus siervos", `\\v 10b y tu \\nd pueblo\\nd*${A}`, "\\v 11 once", ""].join("\n");
  const patched = patchTrunkByVerse(trunk, [work], { ancestor: trunk, scope: { chapter: 1, from: 9, to: 11 } });
  assert.equal(patched.usfm, trunk.replace("\\v 10 Tus criados y tu gente", `\\v 10 Tus siervos y tu \\nd pueblo\\nd*${A}`));
});

// ---------------------------------------------------------------- what the editor says of a note

test("lo que el editor dice de una nota: qué dice y tras qué palabra queda, también mientras se escribe", () => {
  const kept = chapterMarkup(jude, 1);
  assert.deepEqual(Object.keys(kept), ["5", "6"], "solo los versículos que tienen algo");
  assert.deepEqual(verseNotes(kept[5]!), [{ kind: "footnote", says: "Algunos manuscritos antiguos dicen el Señor.", after: "Jesús" }]);
  assert.deepEqual(verseNotes(kept[6]!), [{ kind: "footnote", says: "O su posición de autoridad.", after: "dominio" }]);
  // While the verse is being written, where the note will be once it is saved.
  assert.equal(verseNotes(kept[5]!, FIVE.replace("Jesús,", "Jesucristo,"))[0]!.after, "Jesucristo");
  assert.equal(verseNotes(kept[5]!, FIVE.replace("que Jesús, habiendo", "que habiendo"))[0]!.after, "que");
  assert.equal(verseNotes(kept[5]!, "")[0]!.after, "");
  assert.equal(verseNotes(kept[5]!, "   ")[0]!.says, "Algunos manuscritos antiguos dicen el Señor.");
  const cross = "\\id GEN\n\\c 1\n\\p\n\\v 1 En el principio\\x - \\xo 1:1 \\xt Jn 1:1; Heb 11:3\\x* creó Dios.\\f + \\fr 1:1 \\fq creó \\ft O \\fqa hizo\\fqa*.\\f*\n";
  assert.deepEqual(verseNotes(chapterMarkup(cross, 1)[1]!), [
    { kind: "crossref", says: "Jn 1:1; Heb 11:3", after: "principio" },
    { kind: "footnote", says: "creó O hizo.", after: "Dios" },
  ]);
  assert.deepEqual(chapterMarkup(jonah, 1)[1]!.anchors, [], "las palabras marcadas no son notas");
  assert.deepEqual(verseNotes(chapterMarkup(jonah, 1)[1]!), []);
});

test("llevar lo que el versículo tenía a un texto: sin nada que llevar, el texto queda como llega", () => {
  const lines = ["uno dos", "tres"];
  assert.equal(carryMarkup({ text: "uno dos tres", anchors: [], marks: [] }, lines), lines);
  const read = readVerse(["uno \\nd dos\\nd*\\f + \\ft n\\f*", "tres"]);
  assert.deepEqual(read.rows, ["uno dos", "tres"]);
  assert.equal(read.text, "uno dos\ntres");
  assert.deepEqual(carryMarkup(read, ["uno", "dos tres"]), ["uno", "\\nd dos\\nd*\\f + \\ft n\\f* tres"]);
});

// ---------------------------------------------------------------- a whole book, as it is published

const real = fileURLToPath(new URL("../../usfm-ast/packages/usfm-parser/tests/fixtures/usfm/jud.ult-aligned.usfm", import.meta.url));
if (existsSync(real)) {
  const ult = readFileSync(real, "utf8").replace(/\r\n/g, "\n");
  const REAL_NOTE = "\\f + \\ft Many of the best ancient manuscripts have \\fq Jesus,\\fq* but some manuscripts have \\fq the Lord\\fq*.\\f*";

  test("Judas entero, como lo publica unfoldingWord: cambiar una palabra de 1:5 conserva su nota y no toca ningún otro versículo", () => {
    assert.equal(count(ult, REAL_NOTE), 1);
    const rows = extractDraftVerses(ult, { chapter: 1, from: 1, to: 25 }).slots;
    assert.equal(rows[4]!.text, "Now I want to remind you, you knowing all things once for all, that Jesus, having saved a people out of the land of Egypt, afterward destroyed the ones not having believed.");
    assert.equal(applyVerseEditsKeepingAlignment(ult, 1, rows).usfm, ult, "sin tocar nada, no se escribe");
    // The rest of the book is written by another tool, in its own way: none of it is written again.
    const saved = edited(ult, 1, 5, (text) => text.replace("remind", "tell"));
    assert.ok(body(saved, 1, 5).includes(`\\w Jesus|x-occurrence="1" x-occurrences="1"\\w*\\zaln-e\\*,${REAL_NOTE}\n`), "la nota, tras la coma de «Jesus»");
    assert.equal(count(saved, REAL_NOTE), 1);
    const [was, now] = [linkedWords(ult, 1, 5), linkedWords(saved, 1, 5)];
    assert.deepEqual(now, was.filter((word) => word !== "remind"), "solo «remind» pierde su enlace");
    assert.deepEqual(verseNotes(verseMarkup(saved, span(saved, 1, 5))), [{ kind: "footnote", says: "Many of the best ancient manuscripts have Jesus, but some manuscripts have the Lord.", after: "Jesus" }]);
    // The word of the note itself.
    const lord = edited(ult, 1, 5, (text) => text.replace("that Jesus,", "that the Lord,"));
    assert.ok(body(lord, 1, 5).includes(`Lord,${REAL_NOTE}\n`));
    assert.equal(span(lord, 1, 5).text, rows[4]!.text.replace("that Jesus,", "that the Lord,"));
  });
} else {
  console.log("--  Judas entero: no está el archivo de prueba de usfm-ast (jud.ult-aligned.usfm); no se ejecutó.");
}

console.log(`\nverify-usfm-notes: ${passed} checks passed.`);
