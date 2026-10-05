/**
 * An article translated piece by piece: the rows made from the source and the team's file, what counts as still to
 * be translated, and the file the rows are joined back into.
 *
 *   npm run verify:article-blocks
 */
import assert from "node:assert/strict";
import { articleFilesOf, articleProgress, articleRows, pieceRef, rowPending, rowsMarkdown, startingText, untranslated, vocabularyOf } from "../src/domain/articleBlocks";
import { bookNamesIn } from "../src/domain/books";
import { normalizeMarkdown, parseMarkdown } from "../src/domain/helpMarkup";
import { isPassageList, localPassages } from "../src/domain/passageLinks";
import { frameSentences, storiesIn, storyExample, storyFrames, storyPath, storyRefOf, takenSentences, toggleSentence } from "../src/domain/storyFrames";
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

test("un ejemplo de las historias bíblicas se traduce tocando frases del cuadro que el equipo ya tradujo, sin escribir", () => {
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

  // The frame is shown a sentence to a row: what is said inside quotes ends with them.
  const sentences = frameSentences(frames[0]!);
  assert.deepEqual(sentences, ["Así es como Dios hizo todas las cosas en el principio.", "Él creó el universo y todas las cosas que hay ahí en seis días."]);
  assert.deepEqual(frameSentences(frames[1]!), ["Entonces Dios dijo: “¡Qué haya luz!”", "Y hubo luz."]);

  // Touching a sentence takes it: the example keeps its number, as a link for any language, and the sentence follows.
  const one = toggleSentence(example.source, "", sentences, 1);
  assert.equal(one, "* **[1:1](rc://*/tn/help/obs/01/01)** Él creó el universo y todas las cosas que hay ahí en seis días.");
  assert.deepEqual(takenSentences(one, sentences), [false, true]);
  // Another one, touched afterwards, goes where the frame has it, not where it was touched.
  const both = toggleSentence(example.source, one, sentences, 0);
  assert.equal(both, storyExample(example.source, frames[0]!));
  // Touched again, it is given back; the last one given back leaves the row empty, as nobody had been there.
  assert.equal(toggleSentence(example.source, both, sentences, 0), one);
  assert.equal(toggleSentence(example.source, one, sentences, 1), "");

  // Once a person has written in the row, that is theirs: a sentence taken goes after it, and giving it back only takes it out.
  const byHand = "* **1:1** **Dios** creó el universo.";
  const added = toggleSentence(example.source, byHand, sentences, 0);
  assert.equal(added, "* **1:1** **Dios** creó el universo. Así es como Dios hizo todas las cosas en el principio.");
  assert.equal(toggleSentence(example.source, added, sentences, 0), byHand);
  const retouched = one.replace("Él creó", "**Dios** creó");
  assert.deepEqual(takenSentences(retouched, sentences), [false, false], "una frase retocada ya no es la del cuadro");
  assert.ok(toggleSentence(example.source, retouched, sentences, 0).startsWith(retouched), "y lo retocado no se pierde");

  // Put in its row, the article still reads as the same list, and the row is no longer in the source language.
  const filled = rows.map((row, index) => (index === 2 ? { ...row, draft: one } : row));
  assert.equal(rowPending(filled[2]!, vocabularyOf(word)), false);
  assert.equal(articleRows(word, rowsMarkdown(filled))![2]!.draft, one);
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

console.log(`\nverify-article-blocks: ${passed} checks passed.`);
