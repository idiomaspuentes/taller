/**
 * The markdown of the helps, read into a tree to be edited as it looks and written back as it was.
 *
 *   npm run verify:help-markup
 */
import assert from "node:assert/strict";
import { academyLink, describeRc, noteFromTsv, noteToTsv, parseMarkdown, referenceLink, roundTrips, serializeMarkdown, wordLink } from "../src/domain/helpMarkup";

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

console.log(`\nverify-help-markup: ${passed} checks passed.`);
