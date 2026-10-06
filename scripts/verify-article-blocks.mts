/**
 * An article translated piece by piece: the rows made from the source and the team's file, what counts as still to
 * be translated, and the file the rows are joined back into. The notes and the questions of a passage are worked the
 * same way: which of their texts go by pieces, and how what is left of them is counted.
 *
 *   npm run verify:article-blocks
 */
import assert from "node:assert/strict";
import { articleFilesOf, articleProgress, articleRows, pieceRef, rowPending, rowsMarkdown, startingText, translatedWords, untranslated, vocabularyOf, writtenAlike } from "../src/domain/articleBlocks";
import { bookNamesIn } from "../src/domain/books";
import { answerTextId, helpTexts, helpsLeft, knownWords, type HelpText } from "../src/domain/helpTexts";
import type { HelpsDraftItem } from "../src/domain/helpsDraft";
import { normalizeMarkdown, parseMarkdown } from "../src/domain/helpMarkup";
import { isPassageList, localPassages } from "../src/domain/passageLinks";
import { boldTerms, dotsOf, frameSentences, frameWords, marksText, nearestSentences, nudgeMarks, pickedText, proposedSentences, readMarks, readSentences, sentencesText, storiesIn, storyExample, storyFrames, storyPath, storyRefOf, termsOf, touchMarks, type Marks } from "../src/domain/storyFrames";
import { parseRefComment, refComment } from "../src/domain/reviewItems";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

/** Shaped like an article of the Academy: sections, an example quoted with its alternative under it, a list. */
const SOURCE = `### Description

A greeting is what people say when they meet. It shows that the speaker is glad to see the listener.

> Boaz said to the reapers, “The Lord be with you.” (Ruth 2:4)

#### Reason This Is a Translation Issue

Languages greet in different ways, and a greeting translated word for word may sound cold. See [[rc://*/ta/man/translate/figs-idiom]].

### Translation Strategies

(1) Use the greeting people use in your language.

> Peace be with you.
>> May you be well.

*   Ask how people greet an elder.
*   Ask how people greet a child.
*   Write both down.`;

/** The same article, translated, keeping the pieces of the source. */
const TRANSLATED = `### Descripción

Un saludo es lo que la gente dice cuando se encuentra. Muestra que quien habla se alegra de ver a quien escucha.

> Booz dijo a los segadores: «El Señor sea con ustedes». (Rut 2:4)

#### Razón por la que es un asunto de traducción

Los idiomas saludan de maneras distintas, y un saludo traducido palabra por palabra puede sonar frío. Ver [[rc://*/ta/man/translate/figs-idiom]].

### Estrategias de traducción

(1) Usa el saludo que la gente usa en tu idioma.

> La paz sea contigo.
>> Que estés bien.

*   Pregunta cómo se saluda a un anciano.
*   Pregunta cómo se saluda a un niño.
*   Anota los dos.`;

const vocabulary = vocabularyOf(SOURCE);
const rowsOf = (draft: string) => articleRows(SOURCE, draft)!;

test("el artículo se parte en un cuadro por título, párrafo, cita y viñeta de la fuente", () => {
  const rows = rowsOf("");
  assert.deepEqual(
    rows.map((row) => row.source.split("\n")[0]!.slice(0, 22)),
    ["### Description", "A greeting is what peo", "> Boaz said to the rea", "#### Reason This Is a ", "Languages greet in dif", "### Translation Strate", "(1) Use the greeting p", "> Peace be with you.", ">> May you be well.", "*   Ask how people gre", "*   Ask how people gre", "*   Write both down."],
    "doce piezas: la lista son tres, y la alternativa va aparte de su ejemplo",
  );
  assert.ok(rows.every((row) => row.draft === ""), "sin archivo todavía, ningún cuadro tiene nada");
  assert.deepEqual(rows.map((row) => row.shape.t), ["h", "p", "quote", "h", "p", "h", "p", "quote", "quote", "ul", "ul", "ul"], "cada cuadro vacío tiene la forma de su pieza");
});

test("los cuadros unidos vuelven a ser el mismo archivo, sin tocar ni un espacio", () => {
  for (const draft of [SOURCE, TRANSLATED, "", "### Solo un título", `${TRANSLATED}\n\nUn párrafo añadido al final.`]) {
    assert.equal(rowsMarkdown(rowsOf(draft)), normalizeMarkdown(draft), draft.slice(0, 30) || "(vacío)");
  }
});

test("un artículo traducido queda cada pieza junto a la suya", () => {
  const rows = rowsOf(TRANSLATED);
  assert.equal(rows[0]!.draft, "### Descripción");
  assert.equal(rows[2]!.draft, "> Booz dijo a los segadores: «El Señor sea con ustedes». (Rut 2:4)");
  assert.equal(rows[8]!.draft, ">> Que estés bien.");
  assert.equal(rows[11]!.draft, "*   Anota los dos.");
  assert.deepEqual([rows[8]!.tight, rows[10]!.tight, rows[11]!.tight, rows[9]!.tight], [true, true, true, false], "la alternativa bajo su ejemplo y las viñetas siguientes van pegadas a la anterior");
});

test("lo que sigue en el idioma de la fuente está por traducir; lo traducido, no", () => {
  assert.equal(untranslated("A greeting is what people say when they meet.", vocabulary), true);
  assert.equal(untranslated("Un saludo es lo que la gente dice cuando se encuentra.", vocabulary), false);
  assert.equal(untranslated("### Description", vocabulary), true);
  assert.equal(untranslated("### Descripción", vocabulary), false);
  assert.equal(untranslated("[[rc://*/ta/man/translate/figs-idiom]]", vocabulary), false, "un enlace solo no tiene nada que traducir");
  // Somebody replaced the first sentence of two: the paragraph has work in it and must be shown, not taken for untouched.
  assert.equal(untranslated("Un saludo es lo que la gente dice cuando se encuentra. It shows that the speaker is glad to see the listener.", vocabulary), false);
  // A copy with a name changed is still the source language.
  assert.equal(untranslated("> Boaz said to the reapers, “Jehová be with you.” (Ruth 2:4)", vocabulary), true);
});

test("el avance cuenta las piezas con palabras, y las que ya están traducidas", () => {
  assert.deepEqual(articleProgress(rowsOf(""), vocabulary), { done: 0, total: 12 });
  assert.deepEqual(articleProgress(rowsOf(SOURCE), vocabulary), { done: 0, total: 12 }, "copiado de la fuente no es traducido");
  assert.deepEqual(articleProgress(rowsOf(TRANSLATED), vocabulary), { done: 12, total: 12 });
  const half = rowsOf(SOURCE).map((row, index) => (index < 3 ? { ...row, draft: rowsOf(TRANSLATED)[index]!.draft } : row));
  assert.deepEqual(articleProgress(half, vocabulary), { done: 3, total: 12 });
  assert.equal(rowPending(half[0]!, vocabulary), false);
  assert.equal(rowPending(half[3]!, vocabulary), true);
});

test("una referencia bíblica dejada como está no cuenta como párrafo sin traducir; el rótulo de los números de Strong, sí", () => {
  // Shaped like an article of the words: what it means, where the Bible uses it, and its numbers.
  const word = [
    "# age, era, time",
    "## Definition:",
    "Used in this sense the term “age” refers to a long period of time. See [Matthew 28:20](rc://en/tn/help/mat/28/20).",
    "## Bible References:",
    "* [Matthew 28:20](rc://en/tn/help/mat/28/20)\n* [1 John 1:7](rc://en/tn/help/1jn/01/07)",
    "## Word Data:",
    "* Strong’s: H2165, H6256, G21190",
  ].join("\n\n");
  const words = vocabularyOf(word);
  const translated = (strong: string) =>
    ["# edad, era, tiempo", "## Definición:", "Usado en este sentido, el término «edad» se refiere a un largo período de tiempo. Mira [Matthew 28:20](rc://en/tn/help/mat/28/20).", "## Referencias bíblicas:", "* [Matthew 28:20](rc://en/tn/help/mat/28/20)\n* [1 John 1:7](rc://en/tn/help/1jn/01/07)", "## Datos de la palabra:", strong].join("\n\n");

  // The two references are pieces of the article, and there is nothing in them to translate.
  const fresh = articleRows(word, "")!;
  assert.deepEqual(fresh.filter((row) => !row.words).map((row) => row.source), ["* [Matthew 28:20](rc://en/tn/help/mat/28/20)", "* [1 John 1:7](rc://en/tn/help/1jn/01/07)"]);
  assert.deepEqual(articleProgress(fresh, words), { done: 0, total: 6 });
  assert.equal(untranslated("* [Matthew 28:20](rc://en/tn/help/mat/28/20)", words), false, "dejada como en la fuente, no es algo pendiente");
  assert.equal(untranslated("* [Mateo 28:20](rc://*/tn/help/mat/28/20)", words), false, "y traducida tampoco estorba");

  // Everything translated but the line of the numbers: that one the team does translate («Números de Strong»).
  assert.deepEqual(articleProgress(articleRows(word, translated("* Strong’s: H2165, H6256, G21190"))!, words), { done: 5, total: 6 });
  assert.deepEqual(articleProgress(articleRows(word, translated("* Números de Strong: H2165, H6256, G21190"))!, words), { done: 6, total: 6 });

  // A paragraph is not let off for having a reference in it: its own words still say what language it is in.
  assert.equal(untranslated("Used in this sense the term “age” refers to a long period of time. See [Matthew 28:20](rc://en/tn/help/mat/28/20).", words), true);
  // A link to something else is read as before: its words are words of the article.
  assert.equal(untranslated("(See also: [eternity](../kt/eternity.md))", vocabularyOf("(See also: [eternity](../kt/eternity.md))")), true);
});

test("la app escribe las referencias bíblicas en el idioma del equipo: el libro sale de la dirección del enlace", () => {
  const es = bookNamesIn("es-419")!;
  const pt = bookNamesIn("pt-br")!;
  assert.equal(localPassages("* [1 John 1:7-8](rc://en/tn/help/1jn/01/07)", es), "* [1 Juan 1:7-8](rc://*/tn/help/1jn/01/07)");
  assert.equal(localPassages("* [1 John 1:7-8](rc://en/tn/help/1jn/01/07)", pt), "* [1 João 1:7-8](rc://*/tn/help/1jn/01/07)");
  // However the source names the book, and whatever it shows of the place.
  assert.equal(localPassages("* [Psalms 23](rc://en/tn/help/psa/023/001)", es), "* [Salmos 23](rc://*/tn/help/psa/023/001)");
  assert.equal(localPassages("* [Jude](rc://en/tn/help/jud/01/03)", es), "* [Judas 1:3](rc://*/tn/help/jud/01/03)", "sin lugar a la vista, el de la dirección");
  assert.equal(localPassages("* [Deuteronomy 29:14–16](rc://en/tn/help/deu/29/14)", es), "* [Deuteronomio 29:14–16](rc://*/tn/help/deu/29/14)");
  // Written again from what the team already had, it says the same: it can be done any number of times.
  assert.equal(localPassages("* [1 Juan 1:7-8](rc://*/tn/help/1jn/01/07)", es), "* [1 Juan 1:7-8](rc://*/tn/help/1jn/01/07)");

  // Only a piece that is nothing but references. A paragraph with one in it is somebody's to translate.
  assert.equal(isPassageList("* [1 John 1:7](rc://en/tn/help/1jn/01/07)"), true);
  assert.equal(localPassages("See [Matthew 28:20](rc://en/tn/help/mat/28/20) for more.", es), null);
  assert.equal(localPassages("* __[1:1](rc://en/tn/help/obs/01/01)__ __God__ created the universe.", es), null, "un ejemplo de las historias tiene texto propio");
  assert.equal(localPassages("* [eternity](../kt/eternity.md)", es), null);
  // A language the app has no names of the books in: nothing is written, and the piece stays with the translator.
  assert.equal(bookNamesIn("fr"), undefined);
});

test("en el artículo, las referencias quedan escritas por la app y lo demás sigue siendo de quien traduce", () => {
  const word = ["# God", "## Bible References:", "* [1 John 1:7](rc://en/tn/help/1jn/01/07)\n* [Ezra 3:1-2](rc://en/tn/help/ezr/03/01)", "## Word Data:", "* Strong’s: H0136, G23160"].join("\n\n");
  const make = (piece: string) => localPassages(piece, bookNamesIn("es-419")!);
  const words = vocabularyOf(word);

  // Nothing translated yet: the article starts from the source, and the two references are already ours.
  const fresh = articleRows(word, startingText(word, "") ?? word, make)!;
  assert.deepEqual(fresh.filter((row) => row.made).map((row) => row.draft), ["* [1 Juan 1:7](rc://*/tn/help/1jn/01/07)", "* [Esdras 3:1-2](rc://*/tn/help/ezr/03/01)"]);
  assert.deepEqual(articleProgress(fresh, words), { done: 0, total: 4 }, "y no cuentan: quedan los dos títulos, el nombre y la línea de Strong");
  assert.ok(rowsMarkdown(fresh).includes("* [1 Juan 1:7](rc://*/tn/help/1jn/01/07)\n* [Esdras 3:1-2](rc://*/tn/help/ezr/03/01)"), "se guardan con el artículo, como lista");

  // A file somebody translated by hand, references and all, in another order of words: they are written again.
  const byHand = ["# Dios", "## Referencias bíblicas", "* [1 de Juan 1:7](rc://*/tn/help/1jn/01/07)\n* [Esdras 3:1-2](rc://*/tn/help/ezr/03/01)", "## Datos de la palabra", "* Números de Strong: H0136, G23160"].join("\n\n");
  const again = articleRows(word, byHand, make)!;
  assert.equal(again[2]!.draft, "* [1 Juan 1:7](rc://*/tn/help/1jn/01/07)");
  assert.deepEqual(articleProgress(again, words), { done: 4, total: 4 });
  assert.equal(again[0]!.made, undefined, "lo que se traduce no lo toca");
  assert.equal(again[0]!.draft, "# Dios");

  // Where a person wrote something of their own in that place, it is theirs: the app does not write over it.
  const withNote = byHand.replace("* [Esdras 3:1-2](rc://*/tn/help/ezr/03/01)", "* [Esdras 3:1-2](rc://*/tn/help/ezr/03/01) (ver también el versículo 5)");
  const kept = articleRows(word, withNote, make)!;
  assert.equal(kept[3]!.made, undefined);
  assert.ok(kept[3]!.draft.includes("ver también el versículo 5"));

  // Without the app's hand (the review, a language with no names), the rows are what the file has.
  assert.equal(articleRows(word, byHand)![2]!.draft, "* [1 de Juan 1:7](rc://*/tn/help/1jn/01/07)");
});

test("un ejemplo de las historias bíblicas se traduce marcando, a la palabra, partes del cuadro que el equipo ya tradujo", () => {
  // Shaped like the end of an article of the words, and like the file of a story.
  const word = ["# God", "## Examples from the Bible stories:", "* __[1:1](rc://en/tn/help/obs/01/01)__ __God__ created the universe and everything in it in six days.\n* __[5:3](rc://en/tn/help/obs/05/03)__ “I am __God__ Almighty.”"].join("\n\n");
  const story = [
    "# 1. La Creación",
    "![OBS Image](https://cdn.door43.org/obs/jpg/360px/obs-en-01-01.jpg)",
    "Así es como Dios hizo todas las cosas en el principio. Él creó el universo y todas las cosas que hay ahí en seis días.",
    "![OBS Image](https://cdn.door43.org/obs/jpg/360px/obs-en-01-02.jpg)",
    "Entonces Dios dijo: “¡Qué haya luz!” Y hubo luz.",
    "_Una historia bíblica de: Génesis 1-2_",
  ].join("\n\n");

  const rows = articleRows(word, startingText(word, "") ?? word, (piece) => localPassages(piece, bookNamesIn("es-419")!))!;
  const example = rows[2]!;
  assert.equal(example.made, undefined, "es de quien traduce: la app no lo escribe");
  assert.equal(example.words, true, "y cuenta como párrafo por traducir");

  // Which frame it quotes, and where the team's story is kept.
  assert.deepEqual(storyRefOf(example.source), { story: 1, frame: 1 });
  assert.deepEqual(storyRefOf(rows[3]!.source), { story: 5, frame: 3 });
  assert.equal(storyRefOf("* [1 John 1:7](rc://en/tn/help/1jn/01/07)"), null);
  assert.deepEqual(storiesIn(word), [1, 5]);
  assert.equal(storyPath(5), "content/05.md");

  // The frames of the story: the text under each picture; the title and the line of where it is from are not frames.
  const frames = storyFrames(story);
  assert.deepEqual(frames, ["Así es como Dios hizo todas las cosas en el principio. Él creó el universo y todas las cosas que hay ahí en seis días.", "Entonces Dios dijo: “¡Qué haya luz!” Y hubo luz."]);
  assert.deepEqual(storyFrames("sin cuadros"), []);

  // The frame is shown a word at a time. The example is a piece of it cut by hand, often inside a sentence, so what
  // says the same is marked to the word. Two touches make a part: its first word, and its last.
  const words = frameWords(frames[0]!);
  assert.equal(words.length, 25);
  assert.deepEqual([words[3], words[10], words[11], words[12], words[24]], ["Dios", "principio.", "Él", "creó", "días."]);
  let marks = touchMarks(null, 12);
  assert.deepEqual(marks, { parts: [[12, 12]], open: 0, current: 0, dots: false }, "el primer toque abre una parte en esa palabra");
  marks = touchMarks(marks, 24);
  assert.deepEqual(marks, { parts: [[12, 24]], open: null, current: 0, dots: false }, "el segundo la cierra en la otra");
  assert.equal(marksText(words, marks!), "creó el universo y todas las cosas que hay ahí en seis días.");
  // In either order: the last word first and the first after is the same part.
  assert.deepEqual(touchMarks(touchMarks(null, 24), 12)!.parts, [[12, 24]]);
  // A part cut inside a sentence does not keep the comma the frame went on with.
  assert.equal(pickedText(frameWords("Después de que Dios creó la tierra, estaba oscura y vacía, porque no había nada."), [0, 6]), "Después de que Dios creó la tierra");

  // Nothing is switched on for another part: the next two touches make it. The same word twice is a part of one word.
  marks = touchMarks(touchMarks(null, 3), 3);
  assert.deepEqual(marks, { parts: [[3, 3]], open: null, current: 0, dots: false });
  marks = touchMarks(touchMarks(marks, 12), 24);
  assert.deepEqual(marks, { parts: [[3, 3], [12, 24]], open: null, current: 1, dots: false });
  // The source of this example leaves nothing out, so the parts are read on: no word is typed to say who created.
  assert.deepEqual(dotsOf(example.source), { sign: "…", on: false });
  assert.equal(marksText(words, marks!), "Dios creó el universo y todas las cosas que hay ahí en seis días.");
  // One that leaves something out is marked the same way, and what is left out is shown as its source shows it.
  assert.deepEqual(dotsOf("* __[1:1](rc://en/tn/help/obs/01/01)__ __God__ ... the universe ... in six days."), { sign: "...", on: true });
  const cut: Marks = { parts: [[3, 3], [13, 14], [22, 24]], open: null, current: 2, dots: true };
  assert.equal(marksText(words, cut), "Dios … el universo … en seis días.");
  assert.equal(marksText(words, cut, "..."), "Dios ... el universo ... en seis días.");

  // A touch on a part already made takes it away; the others stay. The last one taken leaves nothing marked.
  assert.deepEqual(touchMarks(cut, 13)!.parts, [[3, 3], [22, 24]]);
  assert.equal(touchMarks({ parts: [[3, 3]], open: null, current: 0, dots: false }, 3), null);
  // A part closed against another one, or opened right beside it, is one with it: nothing is left out between them.
  assert.deepEqual(touchMarks(touchMarks({ parts: [[3, 3], [13, 14]], open: null, current: 1, dots: false }, 8), 13)!.parts, [[3, 3], [8, 14]]);
  assert.deepEqual(touchMarks({ parts: [[12, 14]], open: null, current: 0, dots: false }, 11), { parts: [[11, 14]], open: 0, current: 0, dots: false });

  // A finger does not always land on a short word: the ends of the last part also move a word at a time.
  const part: Marks = { parts: [[3, 3], [12, 24]], open: null, current: 1, dots: false };
  assert.deepEqual(nudgeMarks(part, "first", -1, words.length).parts, [[3, 3], [11, 24]]);
  assert.deepEqual(nudgeMarks(part, "first", 1, words.length).parts, [[3, 3], [13, 24]]);
  assert.deepEqual(nudgeMarks(part, "last", -1, words.length).parts, [[3, 3], [12, 23]]);
  assert.deepEqual(nudgeMarks(part, "last", 1, words.length).parts, [[3, 3], [12, 24]], "no hay más palabras después de la última");
  assert.deepEqual(nudgeMarks({ ...part, parts: [[3, 3], [5, 5]] }, "last", -1, words.length).parts, [[3, 3], [5, 5]], "una parte no se da la vuelta");
  assert.deepEqual(nudgeMarks({ ...part, parts: [[3, 3], [5, 9]] }, "first", -1, words.length), { parts: [[3, 9]], open: null, current: 0, dots: false }, "al llegar a la de al lado, son una");

  // What is marked is written in the row behind the number of the frame, a link for any language.
  const one = storyExample(example.source, marksText(words, { parts: [[12, 24]], dots: false }));
  assert.equal(one, "* **[1:1](rc://*/tn/help/obs/01/01)** creó el universo y todas las cosas que hay ahí en seis días.");
  // The row says what it holds, so the marks are shown again when the example is opened another day.
  assert.deepEqual(readMarks(one, words), { parts: [[12, 24]], dots: false });
  assert.deepEqual(readMarks(storyExample(example.source, frames[0]!), words), { parts: [[0, 24]], dots: false }, "el cuadro entero también es una parte");
  assert.deepEqual(readMarks(storyExample(example.source, "Dios creó el universo y todas las cosas que hay ahí en seis días."), words), { parts: [[3, 3], [12, 24]], dots: false }, "dos partes leídas de corrido");
  assert.deepEqual(readMarks(storyExample(example.source, marksText(words, cut)), words), { parts: [[3, 3], [13, 14], [22, 24]], dots: true });
  assert.deepEqual(readMarks(storyExample(example.source, marksText(words, cut, "...")), words), { parts: [[3, 3], [13, 14], [22, 24]], dots: true }, "con tres puntos también");
  // A word the frame says twice («el») is taken for the place that makes the longest part.
  assert.deepEqual(readMarks(storyExample(example.source, "el universo"), words), { parts: [[13, 14]], dots: false });
  assert.equal(readMarks("", words), null);
  // Retouched by hand, or written by a person from the start, it is not parts of the frame any more: it is theirs.
  assert.equal(readMarks(one.replace("creó el universo", "**Dios** creó el universo"), words), null);
  assert.equal(readMarks("* **1:1** **Dios** creó el universo y todo lo que contiene en seis días.", words), null);
  assert.equal(readMarks(storyExample(example.source, "Dios … creó el universo y todas hay ahí"), words), null, "puntos en un sitio y en otro no: lo puso una persona");

  // Put in its row, the article still reads as the same list, and the row is no longer in the source language.
  const filled = rows.map((row, index) => (index === 2 ? { ...row, draft: one } : row));
  assert.equal(rowPending(filled[2]!, vocabularyOf(word)), false);
  assert.equal(articleRows(word, rowsMarkdown(filled))![2]!.draft, one);
});

test("en una lista de ejemplos, si falta uno en el archivo los demás no se corren: cada uno va con su cuadro", () => {
  const word = ["# God", "## Examples from the Bible stories:", ["* __[1:1](rc://en/tn/help/obs/01/01)__ __God__ created the universe.", "* __[1:15](rc://en/tn/help/obs/01/15)__ __God__ made man and woman.", "* __[5:3](rc://en/tn/help/obs/05/03)__ “I am __God__ Almighty.”"].join("\n")].join("\n\n");
  // The team's file, translated by hand as the published ones are (the number without its link), with the first example gone.
  const file = ["# Dios", "## Ejemplos de las historias bíblicas", ["* **1:15** **Dios** hizo al hombre y a la mujer.", "* **5:3** “Soy **Dios** Todopoderoso”."].join("\n")].join("\n\n");
  const rows = articleRows(word, file)!;
  assert.deepEqual(rows.slice(2).map((row) => row.draft), ["", "* **1:15** **Dios** hizo al hombre y a la mujer.", "* **5:3** “Soy **Dios** Todopoderoso”."]);
  // The same when what is there was written by marking a part of the frame: the number is then a link.
  const marked = file.replace("* **5:3** “Soy **Dios** Todopoderoso”.", "* **[5:3](rc://*/tn/help/obs/05/03)** “Yo soy el Dios Todopoderoso.").replace("* **1:15** **Dios** hizo al hombre y a la mujer.\n", "");
  assert.deepEqual(articleRows(word, marked)!.slice(2).map((row) => row.draft), ["", "", "* **[5:3](rc://*/tn/help/obs/05/03)** “Yo soy el Dios Todopoderoso."]);
});

test("traducir un cuadro cambia solo su pieza del archivo; vaciarlo la quita", () => {
  const rows = rowsOf(SOURCE);
  const one = rows.map((row, index) => (index === 1 ? { ...row, draft: "Un saludo es lo que la gente dice al encontrarse." } : row));
  const text = rowsMarkdown(one);
  assert.equal(text, SOURCE.replace("A greeting is what people say when they meet. It shows that the speaker is glad to see the listener.", "Un saludo es lo que la gente dice al encontrarse."));
  // Opened again, every row is where it was: nothing was moved by the one that changed.
  assert.deepEqual(rowsOf(text).map((row) => row.draft), one.map((row) => row.draft));
  const cleared = rows.map((row, index) => (index === 10 ? { ...row, draft: "" } : row));
  assert.ok(!rowsMarkdown(cleared).includes("greet a child") && rowsMarkdown(cleared).includes("*   Ask how people greet an elder.\n*   Write both down."), "la viñeta de en medio se fue y las otras siguen juntas");
});

test("escribir en un cuadro vacío le da la forma de su pieza y lo pone en su sitio", () => {
  const rows = rowsOf("");
  // What the editor gives back for an empty heading box, a quote box and a bullet box once somebody types in them.
  const typed = rows.map((row, index) => (index === 0 ? { ...row, draft: "### Descripción" } : index === 8 ? { ...row, draft: ">> Que estés bien." } : index === 9 ? { ...row, draft: "*   Pregunta a un anciano." } : row));
  assert.equal(rowsMarkdown(typed), "### Descripción\n\n>> Que estés bien.\n\n*   Pregunta a un anciano.", "un cuadro pegado al anterior no se pega a un párrafo: no hay nada antes a lo que pegarse");
  const withExample = typed.map((row, index) => (index === 7 ? { ...row, draft: "> La paz sea contigo." } : row));
  assert.ok(rowsMarkdown(withExample).includes("> La paz sea contigo.\n>> Que estés bien."), "con su ejemplo delante, la alternativa va justo debajo");
});

test("si la traducción necesitó dos párrafos para uno, el segundo se queda en el cuadro del primero", () => {
  const split = TRANSLATED.replace("Un saludo es lo que la gente dice cuando se encuentra. Muestra", "Un saludo es lo que la gente dice cuando se encuentra.\n\nMuestra");
  const rows = rowsOf(split);
  assert.equal(rows.length, 12, "los cuadros siguen siendo los de la fuente");
  assert.equal(rows[1]!.draft, "Un saludo es lo que la gente dice cuando se encuentra.\n\nMuestra que quien habla se alegra de ver a quien escucha.");
  assert.equal(rows[2]!.draft, "> Booz dijo a los segadores: «El Señor sea con ustedes». (Rut 2:4)", "y lo que sigue no se corre");
  assert.equal(rowsMarkdown(rows), normalizeMarkdown(split));
});

test("si a la traducción le falta una pieza, su cuadro queda vacío y las demás no se corren", () => {
  const without = TRANSLATED.replace("\n\n> Booz dijo a los segadores: «El Señor sea con ustedes». (Rut 2:4)", "");
  const rows = rowsOf(without);
  assert.equal(rows[2]!.draft, "", "la cita que falta");
  assert.equal(rows[3]!.draft, "#### Razón por la que es un asunto de traducción", "el título siguiente sigue junto al suyo");
  assert.equal(rows[11]!.draft, "*   Anota los dos.");
  assert.equal(rowsMarkdown(rows), normalizeMarkdown(without));
});

test("un artículo a medio traducir en este editor vuelve a abrirse con cada pieza en su sitio, aunque se haya traducido salteado", () => {
  const base = rowsOf(SOURCE);
  const done = rowsOf(TRANSLATED);
  // Rows 5, 7 and 11 translated first; the rest still the source.
  const mixed = base.map((row, index) => ([5, 7, 11].includes(index) ? { ...row, draft: done[index]!.draft } : row));
  const again = rowsOf(rowsMarkdown(mixed));
  assert.deepEqual(again.map((row) => row.draft), mixed.map((row) => row.draft));
  assert.deepEqual(articleProgress(again, vocabulary), { done: 3, total: 12 });
});

test("un artículo sin nada traducido empieza de la fuente de hoy, no de una copia vieja", () => {
  assert.equal(startingText(SOURCE, ""), normalizeMarkdown(SOURCE), "sin archivo: la fuente");
  // The team's repository had a copy of an older version: another list, a name already changed.
  const oldCopy = SOURCE.replace("(1) Use the greeting people use in your language.", "1. Use the greeting people use in your language.").replace("The Lord be with you", "Jehová be with you");
  assert.equal(startingText(SOURCE, oldCopy), normalizeMarkdown(SOURCE), "todo sigue en el idioma de la fuente: se parte de la de hoy");
  assert.equal(startingText(SOURCE, SOURCE), null, "ya es la fuente de hoy: nada que cambiar");
  assert.equal(startingText(SOURCE, TRANSLATED), null, "traducido: se deja como está");
  const started = SOURCE.replace("### Description", "### Descripción");
  assert.equal(startingText(SOURCE, started), null, "con una sola pieza traducida ya hay trabajo: no se toca");
  assert.equal(startingText("", TRANSLATED), null, "sin fuente no hay de dónde partir");
});

test("lo que este editor no sabe escribir igual no se parte en cuadros", () => {
  const table = "| a | b |\n|---|---|\n| 1 | 2 |\n\nTexto.";
  assert.ok(parseMarkdown(table).length > 0);
  assert.equal(articleRows(SOURCE, "### Título\npegado sin línea en blanco"), null, "un archivo que no volvería igual se edita entero, como su código");
  assert.equal(articleRows("", TRANSLATED), null, "sin fuente no hay cuadros");
  assert.ok(articleRows(SOURCE, table) === null || rowsMarkdown(articleRows(SOURCE, table)!) === normalizeMarkdown(table), "y si se parte, vuelve igual");
});

test("el título de un artículo es un cuadro de una sola pieza", () => {
  const rows = articleRows("Predictive Past", "Predictive Past")!;
  assert.equal(rows.length, 1);
  assert.equal(rowPending(rows[0]!, vocabularyOf("Predictive Past")), true);
  assert.equal(rowPending({ ...rows[0]!, draft: "Pasado predictivo" }, vocabularyOf("Predictive Past")), false);
});

test("un artículo de la Academia se lee con su título y la línea de debajo, aunque solo se haya tocado el cuerpo", () => {
  const whole = [{ filename: "translate/figs-metaphor/title.md", part: "title" }, { filename: "translate/figs-metaphor/sub-title.md", part: "sub-title" }, { filename: "translate/figs-metaphor/01.md" }];
  assert.deepEqual(articleFilesOf(["translate/figs-metaphor/01.md"], true), whole);
  assert.deepEqual(articleFilesOf(["translate/figs-metaphor/01.md", "translate/figs-metaphor/title.md", "translate/figs-metaphor/sub-title.md"], true), whole, "tocados los tres archivos sigue siendo un artículo, leído una vez y en su orden");
  assert.deepEqual(articleFilesOf(["bible/kt/grace.md", "manifest.yaml"], false), [{ filename: "bible/kt/grace.md" }], "un artículo de palabras es un solo archivo, y lo que no es un artículo no se lee");
});

test("un párrafo se nombra por su artículo y su lugar en la fuente, y el comentario sobre él se vuelve a encontrar", () => {
  assert.equal(pieceRef("translate/figs-metaphor/01.md", 0), "figs-metaphor ¶1");
  assert.equal(pieceRef("translate/figs-metaphor/01.md", 4), "figs-metaphor ¶5");
  assert.equal(pieceRef("translate/figs-metaphor/title.md", 0), "figs-metaphor (título)");
  assert.equal(pieceRef("translate/figs-metaphor/sub-title.md", 0), "figs-metaphor (subtítulo)");
  assert.equal(pieceRef("bible/kt/grace.md", 2), "grace ¶3");
  for (const ref of [pieceRef("translate/figs-metaphor/01.md", 4), pieceRef("translate/figs-metaphor/title.md", 0), pieceRef("bible/kt/grace.md", 2)]) {
    assert.deepEqual(parseRefComment(refComment("jud", ref, "Falta un acento.")), { ref, text: "Falta un acento." }, ref);
  }
});

// ---------------------------------------------------------------- what the app proposes for an example of a story

/** Frame 5:8 as the source has it and as a team has it (Door43, October 2026), and the example an article takes from it. */
const ALTAR_EN = "When they reached the place of sacrifice, Abraham tied up his son Isaac and laid him on an altar. He was about to kill his son when God said, “Stop! Do not hurt the boy! Now I know that you fear me because you did not keep your only son from me.”";
const ALTAR_ES = "Cuando llegaron al lugar del sacrificio, Abraham ató a su hijo Isaac y lo puso en el altar. Estaba por matar a su hijo cuando Dios dijo: “¡Detente! ¡No lastimes al chico! Ahora sé que me temes porque no me negaste a tu único hijo”.";
const ALTAR_PIECE = "*   **[5:8](rc://en/tn/help/obs/05/08)** When they reached the place of sacrifice, Abraham tied up his son Isaac and laid him on an **altar**.";
const ALL = (run: [number, number]) => Array.from({ length: run[1] - run[0] + 1 }, (_, n) => run[0] + n);

test("un cuadro se parte en sus frases, cada una como el cuadro la escribe, con sus comillas", () => {
  const es = frameSentences(ALTAR_ES);
  assert.deepEqual(es, [
    "Cuando llegaron al lugar del sacrificio, Abraham ató a su hijo Isaac y lo puso en el altar.",
    "Estaba por matar a su hijo cuando Dios dijo: “¡Detente!",
    "¡No lastimes al chico!",
    "Ahora sé que me temes porque no me negaste a tu único hijo”.",
  ]);
  assert.equal(frameSentences(ALTAR_EN).length, es.length, "las mismas frases en los dos idiomas");
  assert.deepEqual(frameSentences("Una sola frase sin punto"), ["Una sola frase sin punto"]);
  assert.deepEqual(frameSentences("  "), []);
});

test("la app propone las frases del cuadro del equipo que están donde las del ejemplo, con la palabra del artículo en negrita", () => {
  const run = proposedSentences(ALTAR_PIECE, ALTAR_EN, ALTAR_ES)!;
  assert.deepEqual(run, [0, 0]);
  assert.equal(
    storyExample(ALTAR_PIECE, sentencesText(ALTAR_ES, ALL(run), ["altar"])),
    "*   **[5:8](rc://*/tn/help/obs/05/08)** Cuando llegaron al lugar del sacrificio, Abraham ató a su hijo Isaac y lo puso en el **altar**.",
  );
  // The second sentence of a frame, a name in the plural: «ángel» in the title, «ángeles» in the story.
  const piece = "* **[25:8](rc://en/tn/help/obs/25/08)** Then **angels** came and took care of Jesus.";
  const en = "Jesus did not give in to Satan’s temptations, so Satan left him. Then angels came and took care of Jesus.";
  const es = "Jesús no cedió a las tentaciones de Satanás, por lo que este lo dejó. Entonces vinieron los ángeles y cuidaron de Jesús.";
  assert.deepEqual(proposedSentences(piece, en, es), [1, 1]);
  assert.equal(sentencesText(es, [1], termsOf("# ángel, arcángel\n\n## Definición")), "Entonces vinieron los **ángeles** y cuidaron de Jesús.");
  // An example of two sentences is two sentences.
  assert.deepEqual(nearestSentences("Jesus did not give in to Satan’s temptations, so Satan left him. Then angels came and took care of Jesus.", en), [0, 1]);
});

test("un ejemplo que se aleja de su cuadro no se propone, ni uno de un cuadro que el equipo no tiene", () => {
  // The example was written for an older wording of the story: half its sentence is other words.
  const piece = "* **[4:2](rc://en/tn/help/obs/04/02)** They were very **proud**, and they did not care about what God said.";
  const en = "They were very proud, and they did not want to obey God’s commands about how they should live. They even began building a tall tower that would reach heaven.";
  const es = "Eran muy orgullosos y no quisieron obedecer los mandamientos de Dios acerca de cómo debían vivir. Incluso comenzaron a construir una torre alta que alcanzaría el cielo.";
  assert.equal(proposedSentences(piece, en, es), null);
  assert.equal(proposedSentences(ALTAR_PIECE, ALTAR_EN, ""), null);
  assert.equal(proposedSentences(ALTAR_PIECE, "", ALTAR_ES), null);
});

test("si los dos cuadros no se parten en las mismas frases, el lugar no dice nada: solo se propone el cuadro entero", () => {
  const en = "The king went out. The people followed him.";
  const es = "El rey salió y el pueblo lo siguió.";
  assert.equal(proposedSentences("* **[9:1](rc://en/tn/help/obs/09/01)** The people followed him.", en, es), null);
  assert.deepEqual(proposedSentences("* **[9:1](rc://en/tn/help/obs/09/01)** The king went out. The people followed him.", en, es), [0, 0]);
});

test("la palabra del artículo va en negrita donde el texto la dice, en sus formas, sin tocar lo que solo empieza igual", () => {
  assert.deepEqual(termsOf("# promesa, prometer, prometió\n\n## Definición\n\ntexto"), ["promesa", "prometer", "prometió"]);
  assert.deepEqual(termsOf("sin título"), []);
  // A term of several words is looked for as it is, and is one stretch of bold.
  assert.equal(boldTerms("Jesús habló del reino de Dios a todos.", ["reino de Dios", "reino de los cielos"]), "Jesús habló del **reino de Dios** a todos.");
  // The marks around a word stay outside the bold.
  assert.equal(boldTerms("“Dios, sálvanos”.", ["Dios"]), "“**Dios**, sálvanos”.");
  // A short term is only itself.
  assert.equal(boldTerms("La fe hace feliz.", ["fe"]), "La **fe** hace feliz.");
  assert.equal(boldTerms("Bendeciré a los que te bendigan.", ["bendecir", "bendición"]), "**Bendeciré** a los que te **bendigan**.");
  assert.equal(boldTerms("Jesús dijo la verdad.", ["decir"]), "Jesús dijo la verdad.", "un verbo que cambia de raíz se le escapa: se pone a mano");
  assert.equal(boldTerms("Nada que marcar aquí.", ["altar"]), "Nada que marcar aquí.");
  assert.equal(boldTerms("Sin términos.", []), "Sin términos.");
});

test("lo que una fila tiene se vuelve a leer como frases enteras del cuadro; lo demás es de quien lo escribió", () => {
  const two = storyExample(ALTAR_PIECE, sentencesText(ALTAR_ES, [3, 0], ["altar"]));
  assert.equal(two.endsWith("en el **altar**. Ahora sé que me temes porque no me negaste a tu único hijo”."), true, "en el orden del cuadro");
  assert.deepEqual(readSentences(two, ALTAR_ES), [0, 3]);
  assert.deepEqual(readSentences(storyExample(ALTAR_PIECE, sentencesText(ALTAR_ES, [1, 2])), ALTAR_ES), [1, 2]);
  assert.equal(readSentences("* **[5:8](rc://*/tn/help/obs/05/08)** Abraham ató a su hijo Isaac", ALTAR_ES), null, "un trozo de una frase");
  assert.equal(readSentences("* **[5:8](rc://*/tn/help/obs/05/08)** Cuando llegaron, Abraham ató a Isaac sobre un **altar**.", ALTAR_ES), null, "lo que alguien escribió");
  assert.equal(readSentences("", ALTAR_ES), null);
});

// ---------------------------------------------------------------- the notes and the questions of a passage

const note = (id: string, text: string, more: Partial<HelpsDraftItem> = {}): HelpsDraftItem => ({ id, label: id, meta: id, text, filepath: "tn_JUD.tsv", kind: "tsv", chapter: 1, verse: 3, ...more });
const question = (id: string, text: string, secondary: string): HelpsDraftItem => ({ ...note(id, text), filepath: "tq_JUD.tsv", secondary, secondaryLabel: "Respuesta" });
const NOTE_EN = "**Beloved ones** refers here to those to whom Jude is writing. Alternate translation: [Beloved fellow believers]";
const NOTE_ES = "**Amados** se refiere aquí a quienes Judas escribe. Traducción alternativa: [Amados hermanos creyentes]";
/** What a screen would be told by each text: how many of its pieces there are to translate, and how many are. */
const countsOf = (texts: HelpText[]) => Object.fromEntries(texts.map((text) => [text.id, articleProgress(articleRows(text.source, text.value)!, vocabularyOf(text.source))]));

test("una nota es un texto por trozos, y una pregunta dos: la pregunta y su respuesta, en ese orden", () => {
  const notes = helpTexts([note("a1", NOTE_EN), note("b2", NOTE_ES)], { a1: { text: NOTE_EN }, b2: { text: NOTE_EN } });
  assert.deepEqual(notes.map((text) => [text.id, text.field]), [["a1", "text"], ["b2", "text"]]);
  const asked = helpTexts([question("q1", "Who wrote?", "Jude wrote."), question("q2", "To whom?", "To the called.")], { q1: { text: "Who wrote?", secondary: "Jude wrote." }, q2: { text: "To whom?", secondary: "To the called." } });
  assert.deepEqual(asked.map((text) => [text.id, text.field, text.source]), [
    ["q1", "text", "Who wrote?"],
    [answerTextId("q1"), "secondary", "Jude wrote."],
    ["q2", "text", "To whom?"],
    [answerTextId("q2"), "secondary", "To the called."],
  ]);
});

test("la nota que el equipo tiene igual que la fuente falta por traducir y su cuadro abre vacío; traducida, está hecha", () => {
  const [copied, done] = helpTexts([note("a1", NOTE_EN), note("b2", NOTE_ES)], { a1: { text: NOTE_EN }, b2: { text: NOTE_EN } });
  const row = articleRows(copied!.source, copied!.value)![0]!;
  assert.equal(rowPending(row, vocabularyOf(copied!.source)), true, "la copia de la fuente cuenta como pendiente");
  assert.equal(row.draft.trim() !== "", true, "y la tabla la conserva hasta que se escriba otra cosa");
  assert.equal(rowPending(articleRows(done!.source, done!.value)![0]!, vocabularyOf(done!.source)), false);
});

test("la tabla guarda los saltos de línea escritos: la nota se parte con saltos de verdad", () => {
  const [text] = helpTexts([note("i1", "# Intro\\n\\nFirst paragraph.<br><br>Second one.", { intro: "book", verse: undefined })], { i1: { text: "# Intro\\n\\nFirst paragraph.\\n\\nSecond one." } });
  assert.equal(text!.value, "# Intro\n\nFirst paragraph.\n\nSecond one.");
  assert.equal(articleRows(text!.source, text!.value)!.length, 3);
});

test("lo que no tiene fuente se edita entero en un cuadro, y una respuesta va por trozos solo con su pregunta", () => {
  assert.deepEqual(helpTexts([note("a1", NOTE_ES)], {}), []);
  assert.deepEqual(helpTexts([note("a1", NOTE_ES)], { a1: { text: "  " } }), []);
  // The question is new in the team's table (the source has none): its answer does not go by pieces alone.
  assert.deepEqual(helpTexts([question("q1", "¿Quién escribió?", "Judas.")], { q1: { text: "", secondary: "Jude." } }), []);
  // The source has the question but no answer: the question goes by pieces and the answer stays a box.
  assert.deepEqual(helpTexts([question("q1", "Who wrote?", "Judas.")], { q1: { text: "Who wrote?" } }).map((text) => text.id), ["q1"]);
});

test("un artículo que se pidió ver entero no se parte; las notas no tienen esa vista", () => {
  const article: HelpsDraftItem = { id: "grace", label: "grace", meta: "grace", text: "", filepath: "bible/kt/grace.md", kind: "markdown" };
  assert.equal(helpTexts([article], { grace: { text: SOURCE } }).length, 1);
  assert.equal(helpTexts([article], { grace: { text: SOURCE } }, { articlesWhole: true }).length, 0);
  assert.equal(helpTexts([note("a1", NOTE_EN)], { a1: { text: NOTE_EN } }, { articlesWhole: true }).length, 1);
});

test("lo que falta se cuenta en notas y en preguntas: una pregunta a la que solo le falta la respuesta es una", () => {
  const asked = helpTexts(
    [question("q1", "¿Quién escribió?", "Jude wrote the letter."), question("q2", "¿A quiénes?", "A los llamados."), question("q3", "What did he want?", "Mercy and peace.")],
    { q1: { text: "Who wrote?", secondary: "Jude wrote the letter." }, q2: { text: "To whom?", secondary: "To the called." }, q3: { text: "What did he want?", secondary: "Mercy and peace." } },
  );
  const counts = countsOf(asked);
  assert.deepEqual(helpsLeft(asked, counts, "help"), { left: 2, total: 3 });
  // The same texts counted by pieces, as the paragraphs of an article are.
  assert.deepEqual(helpsLeft(asked, counts, "piece"), { left: 3, total: 6 });
});

test("una introducción de muchos párrafos es una nota más, y lo que aún no se contó no suma", () => {
  const intro = note("i1", "# Intro\\n\\nPrimer párrafo traducido.\\n\\nSecond paragraph still here.", { intro: "book", verse: undefined });
  const texts = helpTexts([intro, note("a1", NOTE_ES)], { i1: { text: "# Intro\\n\\nFirst paragraph here.\\n\\nSecond paragraph still here." }, a1: { text: NOTE_EN } });
  assert.deepEqual(helpsLeft(texts, countsOf(texts), "help"), { left: 1, total: 2 });
  assert.deepEqual(helpsLeft(texts, {}, "help"), { left: 0, total: 0 });
});

// ---------------------------------------------------------------- a word both languages write alike

test("un título que se escribe igual en los dos idiomas cuenta como traducido cuando el equipo usa esa palabra en sus frases", () => {
  const source = "# altar\n\n## Definition:\n\nAn altar was a raised structure on which the Israelites burned animals and grains as offerings to God.\n\n## Word Data:";
  const vocabulary = vocabularyOf(source);
  // Nothing translated yet: the title is as much to do as the rest.
  const untouched = articleRows(source, source)!;
  assert.deepEqual(articleProgress(untouched, vocabulary), { done: 0, total: 4 });
  // The definition is translated and says «altar»: the title, which reads as the source, is the translation.
  const draft = "# altar\n\n## Definition:\n\nUn altar era una estructura elevada sobre la cual los israelitas quemaban animales y granos como ofrendas a Dios.\n\n## Word Data:";
  const rows = articleRows(source, draft)!;
  const known = translatedWords(rows, vocabulary);
  assert.equal(rowPending(rows[0]!, vocabulary), true, "por sus palabras solas se lee como la fuente");
  assert.equal(rowPending(rows[0]!, vocabulary, known), false);
  // What was left in the source language is still to do: none of the team's sentences says «definition» or «word data».
  assert.equal(rowPending(rows[1]!, vocabulary, known), true);
  assert.equal(rowPending(rows[3]!, vocabulary, known), true);
  assert.deepEqual(articleProgress(rows, vocabulary), { done: 2, total: 4 });
});

test("solo un texto corto se da por escrito igual, y solo si todas sus palabras son del equipo", () => {
  const known = new Set(["abraham", "abram", "era", "el", "padre", "de", "isaac"]);
  assert.equal(writtenAlike("# Abraham, Abram", known), true);
  assert.equal(writtenAlike("# Abraham, Abimelech", known), false, "una palabra que el equipo no usa");
  assert.equal(writtenAlike("Abraham era el padre de Isaac", known), false, "una frase entera en el idioma de la fuente no es un nombre");
  assert.equal(writtenAlike("[[rc://*/tw/dict/bible/names/abraham]]", known), false, "sin palabras no hay nada que juzgar");
  assert.equal(writtenAlike("# Abraham", new Set()), false);
});

test("lo que muestra que una palabra es del equipo puede estar en el texto de al lado: una respuesta de una palabra", () => {
  const texts = helpTexts(
    [question("q1", "¿A quién siguieron en su error?", "Balaam."), question("q2", "¿Quién era Balaam?", "Un profeta que amó el pago de la maldad.")],
    { q1: { text: "Whose error did they follow?", secondary: "Balaam." }, q2: { text: "Who was Balaam?", secondary: "A prophet who loved the wages of wickedness." } },
  );
  const known = knownWords(texts);
  const answer = texts.find((text) => text.id === answerTextId("q1"))!;
  const row = articleRows(answer.source, answer.value)![0]!;
  assert.equal(rowPending(row, vocabularyOf(answer.source)), true);
  assert.equal(rowPending(row, vocabularyOf(answer.source), known), false, "la pregunta de al lado dice «Balaam» en una frase del equipo");
  // With nothing beside it that says the word, it stays to be looked at.
  const alone = helpTexts([question("q1", "Whose error did they follow?", "Balaam.")], { q1: { text: "Whose error did they follow?", secondary: "Balaam." } });
  assert.equal(knownWords(alone).has("balaam"), false);
});

console.log(`\nverify-article-blocks: ${passed} checks passed.`);
