/** How a sentence is put together: how MACULA's trees are reduced, written, read back and matched to our text. */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOOKS } from "../src/domain/books";
import { hebrewToOurs } from "../src/domain/parallels";
import { encodeTree, isLeaf, leavesOf, normalizeTreeFile, parseLowfat, reduceSentence, sentenceFits, sentencesAt, type TreeNode } from "../src/domain/syntaxTree";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

/** A tree as one line, to compare: «*[v(1:1.1) s(1:1.2 1:1.3)]». */
const line = (node: TreeNode): string => `${node.role}${node.clause ? "*" : ""}[${node.kids.map((kid) => (isLeaf(kid) ? `${kid.chapter}:${kid.verse}.${kid.word}${kid.piece ? `«${kid.piece}»` : ""}` : line(kid))).join(" ")}]`;

// Jonah 1:1 as MACULA has it, cut short: «and» joined to the verb, a subject of two nouns, «to say» as a
// preposition joined to a clause of one verb.
const HEBREW = `<chapter><sentence id="JON 1:1"><p>…</p>
<wg>
  <w class="cj" ref="JON 1:1!1">וַֽ</w>
  <wg class="cl" rule="V-S-PP">
    <w role="v" class="verb" ref="JON 1:1!1">יְהִי֙</w>
    <wg role="s" class="np" rule="NPofNP"><w class="noun" ref="JON 1:1!2">דְּבַר</w><w class="noun" ref="JON 1:1!3">יְהוָ֔ה</w></wg>
    <wg role="pp" class="pp"><w class="prep" ref="JON 1:1!8">לֵ</w><wg class="cl"><w role="v" class="verb" ref="JON 1:1!8">אמֹֽר</w></wg></wg>
  </wg>
</wg></sentence>
<sentence id="JON 2:6"><wg class="cl">
  <w role="v" class="verb" ref="JON 2:6!1">אֲפָפ֤וּ</w>
  <w role="o" class="pron" ref="JON 2:6!1">נִי</w>
  <wg role="s" class="np"><w class="noun" ref="JON 2:6!2">מַ֨יִם֙</w></wg>
  <wg role="err__note of the tool" class="pp"><w class="prep" ref="JON 2:6!3">עַד</w></wg>
</wg></sentence></chapter>`;

const GREEK = `<book><sentence><wg class="cl">
  <wg role="s" class="np"><w class="noun" ref="TIT 1:1!1">Παῦλος</w>
    <wg type="group"><w class="conj" ref="TIT 1:1!3">δὲ</w><w class="noun" ref="TIT 1:1!2">ἀπόστολος</w></wg></wg>
  <wg role="adv" class="pp"><w class="prep" ref="TIT 1:2!1">ἐπ’</w><w class="noun" ref="TIT 1:2!2">ἐλπίδι</w></wg>
</wg></sentence></book>`;

test("de un árbol de MACULA queda lo que tiene función, y los grupos de en medio dan sus palabras", () => {
  const [first] = parseLowfat(HEBREW);
  assert.equal(line(reduceSentence(first!)!), "*[v[1:1.1] s[1:1.2 1:1.3] pp[v*[1:1.8]]]", "el «y» va con su verbo; «para decir» es una parte con preposición, y dentro la oración de un solo verbo");
});

test("las palabras de una parte van en el orden del texto, aunque el árbol las haya movido", () => {
  const tree = reduceSentence(parseLowfat(GREEK)[0]!)!;
  assert.equal(line(tree), "*[s[1:1.1 1:1.2 1:1.3] adv[1:2.1 1:2.2]]");
  assert.deepEqual(leavesOf(tree).map((leaf) => leaf.word), [1, 2, 3, 1, 2]);
});

test("dos partes de una misma palabra dicen cada una su pedazo; el hebreo pasa a nuestra numeración", () => {
  const toOurs = hebrewToOurs({ "JON 1:17": "JON 2:1", "JON 2:1-10": "JON 2:2-11" });
  const tree = reduceSentence(parseLowfat(HEBREW)[1]!, toOurs)!;
  assert.equal(line(tree), "*[v[2:5.1«אֲפָפוּ»] o[2:5.1«נִי»] s[2:5.2] 2:5.3]", "«me rodearon»: el verbo y su objeto; lo que no es una función (una nota de la herramienta) no se toma por una");
});

test("lo que se escribe se vuelve a leer igual, y un versículo da su oración", () => {
  const trees = parseLowfat(HEBREW).map((raw) => reduceSentence(raw)!);
  const file = normalizeTreeFile(JSON.parse(JSON.stringify({ sentences: trees.map(encodeTree) })))!;
  assert.deepEqual(file.sentences.map((sentence) => line(sentence.root)), trees.map(line));
  assert.deepEqual(sentencesAt(file, { chapter: 2, verse: 6 }).map((sentence) => sentence.verses), [[{ chapter: 2, verse: 6 }]]);
  assert.deepEqual(sentencesAt(file, { chapter: 3, verse: 1 }), []);
  assert.equal(normalizeTreeFile({ sentences: [] }), null);
  assert.equal(normalizeTreeFile("<!doctype html>"), null);
});

test("una oración se muestra solo si cada versículo suyo tiene aquí las mismas palabras que allá", () => {
  const file = normalizeTreeFile({ sentences: parseLowfat(GREEK).map((raw) => encodeTree(reduceSentence(raw)!)) })!;
  const [sentence] = file.sentences;
  assert.deepEqual(sentence!.verses, [{ chapter: 1, verse: 1 }, { chapter: 1, verse: 2 }], "una oración puede cruzar versículos");
  assert.equal(sentenceFits(file, sentence!, (verse) => (verse.verse === 1 ? 3 : 2)), true);
  assert.equal(sentenceFits(file, sentence!, (verse) => (verse.verse === 1 ? 3 : 3)), false, "con una palabra de más, el tercer lugar ya no es la tercera palabra");
  assert.equal(sentenceFits(file, sentence!, () => undefined), false);
});

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "trees");

test("los archivos que la app sirve: los 66 libros, y Jonás 1:1 y Tito 1:5 como se esperan", () => {
  assert.equal(existsSync(path.join(OUT, "index.json")), true, "falta public/trees: npm run trees:build");
  const index = JSON.parse(readFileSync(path.join(OUT, "index.json"), "utf8")) as { books: string[]; license: string };
  assert.match(index.license, /CC BY/);
  assert.deepEqual([...index.books].sort(), BOOKS.map((book) => book.code).sort());
  const read = (book: string) => normalizeTreeFile(JSON.parse(readFileSync(path.join(OUT, `${book}.json`), "utf8")))!;
  const jonah = read("JON");
  assert.equal(line(sentencesAt(jonah, { chapter: 1, verse: 1 })[0]!.root), "*[v[1:1.1] s[1:1.2 1:1.3] pp[1:1.4 1:1.5 1:1.6 1:1.7] pp[v*[1:1.8]]]");
  assert.equal(sentencesAt(jonah, { chapter: 1, verse: 17 }).length > 0, true, "Jonás 2:1 del hebreo es nuestro 1:17");
  assert.equal(sentencesAt(jonah, { chapter: 2, verse: 11 }).length, 0);
  assert.equal(sentencesAt(read("TIT"), { chapter: 1, verse: 5 }).length, 1);
  for (const book of ["JON", "TIT", "PSA"]) for (const sentence of read(book).sentences) for (const leaf of leavesOf(sentence.root)) assert.equal(leaf.verse > 0 && leaf.word > 0, true, `${book} ${leaf.chapter}:${leaf.verse}`);
});

console.log(`\nverify-trees: ${passed} checks passed.`);
