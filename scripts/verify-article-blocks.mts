/**
 * An article translated piece by piece: the rows made from the source and the team's file, what counts as still to
 * be translated, and the file the rows are joined back into.
 *
 *   npm run verify:article-blocks
 */
import assert from "node:assert/strict";
import { articleFilesOf, articleProgress, articleRows, pieceRef, rowPending, rowsMarkdown, startingText, untranslated, vocabularyOf } from "../src/domain/articleBlocks";
import { normalizeMarkdown, parseMarkdown } from "../src/domain/helpMarkup";
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
