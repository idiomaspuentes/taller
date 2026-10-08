/**
 * The markdown of the helps, read into a tree to be edited as it looks and written back as it was.
 *
 *   npm run verify:help-markup
 */
import assert from "node:assert/strict";
import { academyLink, articleAsWritten, describeRc, normalizeMarkdown, noteFromTsv, noteToTsv, parseMarkdown, referenceLink, roundTrips, serializeMarkdown, wordLink } from "../src/domain/helpMarkup";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const note = "Aquí, **anciano** puede ser un *cargo*. Mira [[rc://*/ta/man/translate/figs-metaphor]] y [1:5](../01/05.md).";
const article = `# Metáfora

## Descripción

Una metáfora es una figura. Por ejemplo:

> La chica que amo es una rosa roja.

* primero
* segundo con **negrita**

1. uno
2. dos

Ver [[rc://*/tw/dict/bible/kt/love]].`;

test("una nota y un artículo vuelven iguales después de leerse", () => {
  assert.equal(serializeMarkdown(parseMarkdown(note)), note);
  assert.equal(serializeMarkdown(parseMarkdown(article)), article);
  assert.ok(roundTrips(note) && roundTrips(article));
});

test("se entiende lo que las ayudas usan: títulos, listas, citas, negrita, cursiva y enlaces", () => {
  const blocks = parseMarkdown(article);
  assert.deepEqual(blocks.map((b) => b.t), ["h", "h", "p", "quote", "ul", "ol", "p"]);
  const inline = parseMarkdown(note)[0]!;
  assert.deepEqual(inline.t === "p" ? inline.c.map((n) => n.t) : [], ["text", "b", "text", "i", "text", "rc", "text", "link", "text"]);
});

test("lo que el editor no maneja se reconoce, para no reescribirlo", () => {
  assert.equal(roundTrips("* uno\n  * anidado"), false, "listas anidadas");
  assert.equal(roundTrips("| a | b |\n|---|---|\n| 1 | 2 |"), true, "una tabla queda como texto, sin tocar");
  assert.equal(roundTrips("texto con __subrayas__ y `código`"), true, "lo que no se entiende se deja como texto");
});

test("los saltos de línea de una nota se escriben como en su archivo", () => {
  assert.equal(noteFromTsv("Uno.\\n\\nDos.<br>Tres."), "Uno.\n\nDos.\nTres.");
  assert.equal(noteToTsv("Uno.\n\nDos."), "Uno.\\n\\nDos.");
});

test("los enlaces a otros recursos y a versículos se escriben como los escriben las ayudas", () => {
  assert.equal(academyLink("Figs-Metaphor"), "[[rc://*/ta/man/translate/figs-metaphor]]");
  assert.equal(wordLink("kt", "grace"), "[[rc://*/tw/dict/bible/kt/grace]]");
  assert.equal(referenceLink({ chapter: 2, verse: 3 }), "[2:3](../02/03.md)");
  assert.equal(referenceLink({ chapter: 1, verse: 5, book: "TIT", label: "Tito 1:5" }), "[Tito 1:5](../../tit/01/05.md)");
  assert.equal(referenceLink({ chapter: 23, verse: 1, inBook: "PSA" }), "[23:1](../023/001.md)");
  assert.deepEqual(describeRc("rc://*/ta/man/translate/figs-metaphor"), { kind: "academia", slug: "figs-metaphor" });
  assert.deepEqual(describeRc("rc://*/tw/dict/bible/kt/grace"), { kind: "palabra", slug: "grace" });
});

test("los artículos reales vuelven iguales: marcas con dos espacios, listas numeradas entre líneas en blanco, citas con línea vacía", () => {
  const article = ["### Razones", "", "*  Uno con dos espacios.", "*  Otro.", "", "1. Primera estrategia.", "", "2. Segunda, tras una línea en blanco.", "", "3. Tercera.", "", "> Una cita", ">", "> que sigue."].join("\n");
  assert.ok(roundTrips(article));
  const blocks = parseMarkdown(article);
  assert.deepEqual(blocks.filter((b) => b.t === "ol").map((b) => (b.t === "ol" ? (b.start ?? 1) : 0)), [1, 2, 3]);
  assert.equal(serializeMarkdown(blocks), article);
  const under = ["Un párrafo y, pegada a él, su lista:", "1. Uno.", "2. Dos.", "", "Otro párrafo.", "> y su cita debajo"].join("\n");
  assert.ok(roundTrips(under), "una lista o una cita pegada al párrafo de arriba");
  assert.ok(roundTrips(["> Un ejemplo. (Rut 2:16 TPL).", ">> Su alternativa, citada dentro.", "", ">Sin espacio", ">", ">sigue."].join("\n")), "una cita dentro de otra, y una cita sin espacio");
  assert.ok(roundTrips("1. uno\n2. dos\n3. tres") && roundTrips("5. cinco\n6. seis"));
});

// ---------------------------------------------------------------- an article on the lines its file has
// As the articles the team has published are written: spaces at the ends of lines, a line with nothing but spaces,
// two empty lines where one would do, a line broken with two spaces, and a line end at the end.
const onFile = ["# Gracia  ", "", "## Definición: ", "", "", "La gracia es un **don**.  ", "Se da sin merecerlo.", "    ", "* primero ", "* segundo", "", "> Una cita.  ", ">  ", "> Sigue.", ""].join("\n");
const asEdited = (md: string) => serializeMarkdown(parseMarkdown(md));

test("un artículo que nadie cambió se guarda igual, byte por byte", () => {
  assert.ok(roundTrips(onFile));
  assert.notEqual(asEdited(onFile), onFile, "el árbol lo devuelve sin sus espacios ni su final");
  assert.equal(articleAsWritten(onFile, asEdited(onFile)), onFile);
  const windows = onFile.replace(/\n/g, "\r\n");
  assert.equal(articleAsWritten(windows, asEdited(windows)), windows);
  const noEnd = onFile.replace(/\n$/, "");
  assert.equal(articleAsWritten(noEnd, asEdited(noEnd)), noEnd, "ni gana un fin de línea que no tenía");
  const padded = `\n\n${onFile}\n\n`;
  assert.equal(articleAsWritten(padded, asEdited(padded)), padded);
});

test("corregir una palabra cambia su línea y ninguna otra", () => {
  const saved = articleAsWritten(onFile, asEdited(onFile).replace("sin merecerlo", "sin que se merezca"));
  const was = onFile.split("\n");
  assert.deepEqual(saved.split("\n").filter((line, index) => line !== was[index]), ["Se da sin que se merezca."]);
  assert.equal(saved.split("\n").length, was.length);
  const windows = onFile.replace(/\n/g, "\r\n");
  const savedWindows = articleAsWritten(windows, asEdited(windows).replace("sin merecerlo", "sin que se merezca"));
  assert.equal(savedWindows, saved.replace(/\n/g, "\r\n"), "con el fin de línea que el archivo tiene");
});

test("un párrafo nuevo entra donde se escribió, y uno que se quita sale, sin mover lo demás", () => {
  const added = articleAsWritten(onFile, asEdited(onFile).replace("* primero", "Un párrafo nuevo.\n\n* primero"));
  assert.deepEqual(added.split("\n"), ["# Gracia  ", "", "## Definición: ", "", "", "La gracia es un **don**.  ", "Se da sin merecerlo.", "    ", "Un párrafo nuevo.", "", "* primero ", "* segundo", "", "> Una cita.  ", ">  ", "> Sigue.", ""]);
  const removed = articleAsWritten(onFile, asEdited(onFile).replace("\n\n* primero\n* segundo", ""));
  assert.deepEqual(removed.split("\n"), ["# Gracia  ", "", "## Definición: ", "", "", "La gracia es un **don**.  ", "Se da sin merecerlo.", "    ", "> Una cita.  ", ">  ", "> Sigue.", ""]);
  const atEnd = articleAsWritten(onFile, `${asEdited(onFile)}\n\nUn párrafo al final.`);
  assert.ok(atEnd.endsWith("> Sigue.\n\nUn párrafo al final.\n"), "el archivo termina como terminaba");
  assert.ok(atEnd.startsWith(onFile.replace(/\n$/, "")));
});

test("lo que alguien teclea en la fuente del artículo se guarda como lo tecleó", () => {
  // Two spaces at the end of a line (a line break in Markdown), and three empty lines where the file had two.
  const typed = onFile.replace("Se da sin merecerlo.", "Se da sin merecerlo.  ").replace("## Definición: \n\n\n", "## Definición: \n\n\n\n");
  const saved = articleAsWritten(onFile, typed);
  assert.ok(saved.includes("Se da sin merecerlo.  \n"));
  assert.ok(saved.includes("## Definición: \n\n\n\nLa gracia"));
  assert.ok(saved.startsWith("# Gracia  \n"), "y el resto, como el archivo lo tiene");
});

test("un artículo que el equipo no tiene todavía termina con un fin de línea, y uno vacío no se inventa", () => {
  assert.equal(articleAsWritten("", "# Gracia\n\nUn don."), "# Gracia\n\nUn don.\n");
  assert.equal(articleAsWritten("", "\n# Gracia\n\nUn don.\n\n\n"), "# Gracia\n\nUn don.\n");
  assert.equal(articleAsWritten("", ""), "");
  assert.equal(articleAsWritten("Gracia\n", "Gracia"), "Gracia\n", "un título, que es un archivo de una línea");
  assert.equal(articleAsWritten("Gracia", "La gracia"), "La gracia");
});

// ---------------------------------------------------------------- a line broken with two spaces
// As the articles of the Academy in English write a poem in a quote, and a list in a paragraph.
const poem = ["> My well beloved had a **vineyard** on a very fertile hill.  ", "> He spaded it, removed the stones.  ", "> He built a tower in the middle of it.  ", ">  ", "> (Isaiah 5:1b-2a ULT)", "", "(1) Use the third person.  ", "(2) Simply use the first person.", "", "Two spaces at the end of a block are nothing.  "].join("\n");
const breaksOf = (md: string) => parseMarkdown(md).flatMap((block) => (block.t === "p" || block.t === "quote" ? block.c : [])).filter((node) => node.t === "br").map((node) => (node.t === "br" && node.hard ? "hard" : "soft"));

test("dos espacios al final de un renglón lo cortan: el árbol lo lee y lo escribe así", () => {
  assert.deepEqual(breaksOf(poem), ["hard", "hard", "soft", "soft", "hard"], "tres del poema, la línea vacía de la cita y el párrafo");
  assert.equal(
    serializeMarkdown(parseMarkdown(poem)),
    ["> My well beloved had a **vineyard** on a very fertile hill.  ", "> He spaded it, removed the stones.  ", "> He built a tower in the middle of it.", ">", "> (Isaiah 5:1b-2a ULT)", "", "(1) Use the third person.  ", "(2) Simply use the first person.", "", "Two spaces at the end of a block are nothing."].join("\n"),
    "se escriben donde cortan un renglón: no junto a una línea vacía ni al final de un bloque",
  );
  assert.ok(roundTrips(poem));
  const once = normalizeMarkdown(poem);
  assert.equal(normalizeMarkdown(once), once, "lo que el árbol escribe, leído otra vez, se escribe igual");
  assert.equal(normalizeMarkdown(poem.replace(/ {2}$/gm, "    ")), once, "más de dos espacios son dos");
});

test("un renglón que el archivo tiene sin sus dos espacios se queda sin ellos", () => {
  const soft = "> Un renglón\n> y otro\n\nUna línea\ny la siguiente";
  assert.deepEqual(breaksOf(soft), ["soft", "soft"]);
  assert.equal(serializeMarkdown(parseMarkdown(soft)), soft);
});

test("un renglón que alguien corta al escribir se guarda con sus dos espacios, y una línea vacía en una cita es otro párrafo de la cita", () => {
  // As the editor reads them from the page: a break somebody made is `hard`.
  const typed = serializeMarkdown([{ t: "quote", c: [{ t: "text", v: "Primer renglón" }, { t: "br", hard: true }, { t: "text", v: "Segundo renglón" }, { t: "br", hard: true }, { t: "br", hard: true }, { t: "text", v: "Otro párrafo" }] }]);
  assert.equal(typed, "> Primer renglón  \n> Segundo renglón\n>\n> Otro párrafo");
  assert.equal(serializeMarkdown([{ t: "p", c: [{ t: "text", v: "Uno " }, { t: "br", hard: true }, { t: "text", v: "Dos  " }] }]), "Uno  \nDos", "ni tres espacios, ni dos al final del bloque");
});

test("corregir una palabra de un renglón de un poema le deja sus dos espacios, y los demás renglones quedan como el archivo los tiene", () => {
  const file = `${poem.replace("removed the stones.  ", "removed the stones.   ")}\n`;
  assert.equal(articleAsWritten(file, normalizeMarkdown(file)), file, "sin cambios, igual: también el renglón con tres espacios");
  const saved = articleAsWritten(file, normalizeMarkdown(file).replace("fertile hill", "fertile slope"));
  const was = file.split("\n");
  assert.deepEqual(saved.split("\n").filter((line, index) => line !== was[index]), ["> My well beloved had a **vineyard** on a very fertile slope.  "]);
});

test("una nota guarda en su celda el renglón cortado, y se lee igual", () => {
  const note = "Primera línea  \nSegunda línea\n\nOtro párrafo";
  assert.equal(noteToTsv(note), "Primera línea  \\nSegunda línea\\n\\nOtro párrafo");
  assert.equal(normalizeMarkdown(noteFromTsv(noteToTsv(note))), note);
});

console.log(`\nverify-help-markup: ${passed} checks passed.`);
