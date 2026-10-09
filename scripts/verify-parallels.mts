/** Parallel passages: how the list of the Bible Societies is read, renumbered and asked for a verse. */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatParallelRef, hebrewToOurs, normalizeParallelFile, parallelFiles, parallelLabel, parallelsAt, parseParallelRef, passagesOfXml, refInOurs, versesWithParallels } from "../src/domain/parallels";
import { BOOKS, bookName } from "../src/domain/books";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const MAPPED = { "JON 1:17": "JON 2:1", "JON 2:1-10": "JON 2:2-11", "MAL 4:1-6": "MAL 3:19-24", "PSA 51:0": "PSA 51:2", "PSA 51:1-19": "PSA 51:3-21", "ESG 1:1": "ESG 1:1a" };
const toOurs = hebrewToOurs(MAPPED);
const XML = `<ParallelPassages>
  <Passage><Verse HEB="0000">JON 2:1</Verse><Verse GRK="0022">MAT 12:40</Verse></Passage>
  <Passage><Verse HEB="22">MAL 3:23</Verse><Verse GRK="22">MAT 11:14</Verse><Verse GRK="22">LUK 1:17</Verse></Passage>
  <Passage><Verse HEB="22">MAL 3:23</Verse><Verse GRK="22">MAT 11:14</Verse></Passage>
  <Passage><Verse GRK="2">2JN 1:12</Verse><Verse GRK="2">3JN 1:13-14</Verse></Passage>
  <Passage><Verse GRK="2">LUK 6:27-28,35</Verse><Verse GRK="2">MAT 5:44</Verse></Passage>
  <Passage><Verse GRK="2">MAT 1:1</Verse></Passage>
</ParallelPassages>`;

test("una referencia se lee y se vuelve a escribir igual: un versículo, un tramo, tramos sueltos", () => {
  for (const text of ["MAT 12:40", "3JN 1:13-14", "2CH 8:13,16", "LUK 6:27-28,35"]) assert.equal(formatParallelRef(parseParallelRef(text)!), text);
  assert.equal(parseParallelRef("MAT 12"), null);
  assert.equal(parseParallelRef("MAT 12:9-3"), null, "un tramo al revés no es un tramo");
  assert.equal(parallelLabel(parseParallelRef("LUK 6:27-28,35")!, bookName), "Lucas 6:27-28, 35");
});

test("el archivo de las Sociedades Bíblicas se lee pasaje por pasaje, y dice cuáles son del hebreo", () => {
  const passages = passagesOfXml(XML);
  assert.equal(passages.length, 6);
  assert.deepEqual(passages[0], [{ hebrew: true, ref: "JON 2:1" }, { hebrew: false, ref: "MAT 12:40" }]);
});

test("la numeración de la Biblia hebrea pasa a la de nuestros textos: Jonás 2:1 es 1:17", () => {
  assert.deepEqual(toOurs("JON", { chapter: 2, verse: 1 }), { chapter: 1, verse: 17 });
  assert.deepEqual(toOurs("JON", { chapter: 2, verse: 11 }), { chapter: 2, verse: 10 });
  assert.deepEqual(toOurs("MAL", { chapter: 3, verse: 23 }), { chapter: 4, verse: 5 });
  assert.deepEqual(toOurs("RUT", { chapter: 2, verse: 3 }), { chapter: 2, verse: 3 }, "lo que la tabla no nombra se numera igual");
  assert.deepEqual(toOurs("PSA", { chapter: 51, verse: 2 }), { chapter: 51, verse: 1 }, "el título de un salmo se muestra con su primer versículo");
});

test("un tramo que aquí cruza el fin de un capítulo se parte en dos; una referencia del griego no se toca", () => {
  assert.deepEqual(refInOurs({ hebrew: true, ref: "JON 2:1-3" }, toOurs).map(formatParallelRef), ["JON 1:17", "JON 2:1-2"]);
  assert.deepEqual(refInOurs({ hebrew: false, ref: "MAT 2:1-3" }, toOurs).map(formatParallelRef), ["MAT 2:1-3"]);
  assert.deepEqual(refInOurs({ hebrew: true, ref: "sin forma" }, toOurs), []);
});

test("cada libro recibe los pasajes en que está; uno que otro más largo ya dice entero no se repite", () => {
  const files = parallelFiles(passagesOfXml(XML), toOurs);
  assert.deepEqual(files.get("JON"), [["JON 1:17", "MAT 12:40"]]);
  assert.deepEqual(files.get("MAL"), [["MAL 4:5", "MAT 11:14", "LUK 1:17"]]);
  assert.equal(files.get("MAT")!.length, 3, "Mateo: Jonás, Malaquías (una vez) y Lucas 6");
  assert.equal(files.has("MAT") && !files.get("MAT")!.some((row) => row.length < 2), true, "un pasaje de una sola referencia no es paralelo de nada");
});

test("de un versículo se dan sus paralelos, cada uno una vez, y no él mismo", () => {
  const file = normalizeParallelFile({ passages: [["COL 1:2", "TIT 1:4", "2TI 1:2"], ["ROM 1:7", "TIT 1:4", "COL 1:2"], ["TIT 2:1"], ["TIT 3:5-7", "EPH 2:8"]] })!;
  assert.equal(file.passages.length, 3);
  assert.deepEqual(parallelsAt(file, "TIT", 1, 4).map(formatParallelRef), ["COL 1:2", "2TI 1:2", "ROM 1:7"]);
  assert.deepEqual(parallelsAt(file, "TIT", 3, 6).map(formatParallelRef), ["EPH 2:8"], "un versículo dentro de un tramo");
  assert.deepEqual(parallelsAt(file, "TIT", 1, 5), []);
  assert.deepEqual(parallelsAt(null, "TIT", 1, 4), []);
  assert.deepEqual([...versesWithParallels(file, "TIT", 3)], [5, 6, 7]);
  assert.equal(normalizeParallelFile({ passages: [] }), null);
  assert.equal(normalizeParallelFile("<!doctype html>"), null, "la página de la app en vez del archivo no es un archivo");
});

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "parallels");

test("los archivos que la app sirve: un índice, y cada libro del índice con pasajes de libros que la app conoce", () => {
  assert.equal(existsSync(path.join(OUT, "index.json")), true, "falta public/parallels: npm run parallels:build");
  const index = JSON.parse(readFileSync(path.join(OUT, "index.json"), "utf8")) as { books: string[]; license: string };
  assert.match(index.license, /CC BY-SA/);
  assert.equal(index.books.length > 50, true);
  const known = new Set(BOOKS.map((book) => book.code));
  for (const book of index.books) {
    assert.equal(known.has(book), true, book);
    const raw = JSON.parse(readFileSync(path.join(OUT, `${book}.json`), "utf8")) as { passages: string[][] };
    const file = normalizeParallelFile(raw)!;
    assert.equal(file.passages.length, raw.passages.length, `${book}: toda referencia escrita se puede leer`);
    for (const passage of file.passages) {
      assert.equal(passage.some((ref) => ref.book === book), true, `${book}: un pasaje que no lo nombra`);
      for (const ref of passage) assert.equal(known.has(ref.book), true, formatParallelRef(ref));
    }
  }
});

test("en los archivos servidos, Jonás 1:17 lleva a Mateo 12:40, y Judas a 2 Pedro", () => {
  const read = (book: string) => normalizeParallelFile(JSON.parse(readFileSync(path.join(OUT, `${book}.json`), "utf8")));
  assert.deepEqual(parallelsAt(read("JON"), "JON", 1, 17).map(formatParallelRef), ["MAT 12:40"]);
  assert.deepEqual(parallelsAt(read("JON"), "JON", 2, 1), [], "con la numeración hebrea habría caído aquí");
  assert.deepEqual(parallelsAt(read("JUD"), "JUD", 1, 6).map(formatParallelRef), ["2PE 2:4"]);
  assert.equal(parallelsAt(read("PSA"), "PSA", 51, 4).some((ref) => formatParallelRef(ref) === "ROM 3:4"), true, "Salmo 51:6 del hebreo");
  assert.equal(parallelsAt(read("JOL"), "JOL", 2, 32).some((ref) => formatParallelRef(ref) === "ROM 10:13"), true, "Joel 3:5 del hebreo");
});

console.log(`\nverify-parallels: ${passed} checks passed.`);
