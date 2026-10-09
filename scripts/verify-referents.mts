/** Who a word refers to: how MACULA's tables are read, renumbered and asked about a word of a verse. */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOOKS } from "../src/domain/books";
import { hebrewToOurs } from "../src/domain/parallels";
import { maculaRows, normalizeReferentFile, referentFiles, referentKey, referentsOf } from "../src/domain/referents";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const GREEK = [
  "xml:id\tref\ttext\tstrong\tsubjref\treferent\tframe",
  "n56001001001\tTIT 1:1!1\tΠαῦλος\t3972\t\t\t",
  "n56001003001\tTIT 1:3!1\tἐφανέρωσεν\t5319\tn56001001001\t\t",
  "n56001003002\tTIT 1:3!2\tαὐτοῦ\t846\t\tn56001001001\t",
  "n56001003003\tTIT 1:3!3\tΤίτῳ\t5103\t\t\t",
  "n56001003004\tTIT 1:3!4\tαὐτοῦ\t846\t\tn56001003003 n99999999999\t",
  "n56001004001\tTIT 1:4!1\tἡμῶν\t1473\t\tn56001001001 n56001003003\t",
  "n56001005001\tTIT 1:5!1\tἀπέλιπόν\t620\tn56001001001\t\tA0:n56001001001 A1:n56001005002",
  "n56001005002\tTIT 1:5!2\tσε\t4771\t\tn56001003003\t",
  "n56001005003\tTIT 1:5!3\tδῷ\t1325\tn56001003003\t\tA1:n56001005004 A2:n56001001001",
  "n56001005004\tTIT 1:5!4\tλόγον\t3056\t\t\t",
].join("\n");

const HEBREW = [
  "xml:id\tref\ttext\tstrongnumberx\tsubjref\tparticipantref\tframe",
  "o320010010011\tJON 1:15!1\tיוֹנָ֔ה\t3124\t\t\t",
  "o320020010011\tJON 2:1!1\tוַ\t9001\t\t\t",
  "o320020010012\tJON 2:1!1\tיְמַ֤ן\t4487\t320020010021\t\t",
  "o320020010021\tJON 2:1!2\tיְהוָה֙\t3068\t\t\t",
  "o320020020011\tJON 2:2!1\tאֱלֹהָ֑י\t0430\t\t\t",
  "o320020020012\tJON 2:2!1\tו\t\t\t320010010011;\t",
  "o320020030011\tJON 2:3!1\tהֵטִ֤יל\t2904\t\t\tAA:320020010021; A0:320020030021;",
  "o320020030021\tJON 2:3!2\tר֥וּחַ\t7307\t\t\t",
].join("\n");

test("una palabra se busca por sus letras: ni acentos, ni mayúsculas, ni la sigma final la hacen otra", () => {
  assert.equal(referentKey("Αὐτοῦ,"), "αυτου");
  assert.equal(referentKey("λόγος"), referentKey("ΛΟΓΟΣ"));
  assert.equal(referentKey("וַ⁠יְמַ֤ן"), "וימן", "ni las vocales ni la marca que une las piezas");
});

test("la tabla del griego se lee palabra por palabra, con su Strong y a quién apunta", () => {
  const rows = maculaRows(GREEK, false);
  assert.equal(rows.length, 10);
  assert.deepEqual({ ...rows[1] }, { id: "56001003001", book: "TIT", chapter: 1, verse: 3, word: 1, text: "ἐφανέρωσεν", strong: "G5319", refers: [], subject: ["56001001001"], frame: [] });
  assert.deepEqual(rows[6]!.frame, [["A0", ["56001001001"]], ["A1", ["56001005002"]]]);
  assert.equal(rows[0]!.strong, "G3972");
});

test("del griego sale, por versículo, cada palabra con lo que señala; dos iguales se distinguen por cuál es", () => {
  const file = normalizeReferentFile(referentFiles(maculaRows(GREEK, false)).get("TIT"))!;
  assert.deepEqual(referentsOf(file, { chapter: 1, verse: 3 }, "ἐφανέρωσεν"), [{ kind: "subject", chapter: 1, verse: 1, text: "Παῦλος", strong: "G3972" }]);
  assert.deepEqual(referentsOf(file, { chapter: 1, verse: 3 }, "αὐτοῦ", 0).map((target) => target.text), ["Παῦλος"]);
  assert.deepEqual(referentsOf(file, { chapter: 1, verse: 3 }, "αὐτοῦ", 1).map((target) => target.text), ["Τίτῳ"], "lo que apunta a algo que no es una palabra se deja fuera");
  assert.deepEqual(referentsOf(file, { chapter: 1, verse: 3 }, "αὐτοῦ"), [], "sin saber cuál de las dos se tocó, no se adivina");
  assert.deepEqual(referentsOf(file, { chapter: 1, verse: 4 }, "ἡμῶν").map((target) => target.text), ["Παῦλος", "Τίτῳ"], "«nosotros» son dos");
  assert.deepEqual(referentsOf(file, { chapter: 1, verse: 1 }, "Παῦλος"), []);
  assert.deepEqual(referentsOf(null, { chapter: 1, verse: 3 }, "αὐτοῦ"), []);
});

test("del hebreo: las piezas de una palabra son una palabra, y el versículo pasa a nuestra numeración", () => {
  const toOurs = hebrewToOurs({ "JON 1:17": "JON 2:1", "JON 2:1-10": "JON 2:2-11" });
  const built = referentFiles(maculaRows(HEBREW, true), toOurs).get("JON")!;
  assert.equal(built.words.filter((word) => word[0] === "יְהוָה").length, 1, "una palabra señalada dos veces se escribe una");
  const file = normalizeReferentFile(built)!;
  assert.deepEqual(referentsOf(file, { chapter: 2, verse: 2 }, "הֵטִיל").map((target) => `${target.kind} ${target.text} ${target.chapter}:${target.verse}`), ["causer יְהוָה 1:17", "agent רוּחַ 2:2"], "en un causativo, quien lo causa y quien lo hace");
  assert.deepEqual(referentsOf(file, { chapter: 1, verse: 17 }, "וַ⁠יְמַ֤ן"), [{ kind: "subject", chapter: 1, verse: 17, text: "יְהוָה", strong: "H3068" }], "Jonás 2:1 del hebreo es nuestro 1:17; el verbo se dice de la palabra entera");
  assert.deepEqual(referentsOf(file, { chapter: 2, verse: 1 }, "אֱלֹהָ֑יו"), [{ kind: "refers", piece: "ו", chapter: 1, verse: 15, text: "יוֹנָה", strong: "H3124" }], "el sufijo dice de quién es, y el nombre se muestra sin las marcas del canto");
});

test("de un verbo se dice quién lo hace y a quién; un pronombre en ese lugar se da como aquello que nombra", () => {
  const file = normalizeReferentFile(referentFiles(maculaRows(GREEK, false)).get("TIT"))!;
  assert.deepEqual(
    referentsOf(file, { chapter: 1, verse: 5 }, "ἀπέλιπόν").map((target) => `${target.kind} ${target.text} ${target.chapter}:${target.verse}`),
    ["agent Παῦλος 1:1", "patient Τίτῳ 1:3"],
    "«te dejé»: Pablo a Tito, no a «te»; y el sujeto callado no se repite, porque ya está dicho",
  );
  assert.deepEqual(
    referentsOf(file, { chapter: 1, verse: 5 }, "δῷ").map((target) => `${target.kind} ${target.text}`),
    ["subject Τίτῳ", "patient λόγον", "other Παῦλος"],
    "sin quien lo haga en el marco, el sujeto callado se conserva",
  );
});

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "referents");

test("los archivos que la app sirve: uno por libro, y en ellos Jonás y Tito dicen lo que se espera", () => {
  assert.equal(existsSync(path.join(OUT, "index.json")), true, "falta public/referents: npm run referents:build");
  const index = JSON.parse(readFileSync(path.join(OUT, "index.json"), "utf8")) as { books: string[]; license: string };
  assert.match(index.license, /CC BY/);
  assert.deepEqual([...index.books].sort(), BOOKS.map((book) => book.code).sort(), "los 66 libros");
  const read = (book: string) => normalizeReferentFile(JSON.parse(readFileSync(path.join(OUT, `${book}.json`), "utf8")))!;
  const jonah = read("JON");
  assert.equal(referentsOf(jonah, { chapter: 1, verse: 2 }, "קוּם")[0]?.text, "יוֹנָה", "«levántate» se le dice a Jonás");
  assert.deepEqual(referentsOf(jonah, { chapter: 2, verse: 5 }, "אֲפָפוּנִי").map((target) => `${target.kind} ${target.strong}`), ["agent H4325", "patient H3124"], "«me rodearon las aguas»: a Jonás, dicho una vez y no otra por el sufijo");
  assert.deepEqual(referentsOf(jonah, { chapter: 1, verse: 4 }, "הֵטִיל").map((target) => `${target.kind} ${target.strong}`), ["causer H3068", "agent H7307"], "Yahvé hizo que un viento cayera sobre el mar");
  assert.equal(referentsOf(jonah, { chapter: 1, verse: 2 }, "עָלֶיהָ")[0]?.strong, "H5210", "«contra ella» es Nínive");
  assert.equal(jonah.verses["2:11"], undefined, "Jonás 2 tiene diez versículos en nuestros textos");
  assert.equal(Boolean(jonah.verses["1:17"]?.length), true);
  assert.deepEqual(referentsOf(read("TIT"), { chapter: 1, verse: 3 }, "ἐγὼ").map((target) => target.strong), ["G3972"], "«yo» es Pablo");
  assert.deepEqual(referentsOf(read("TIT"), { chapter: 1, verse: 5 }, "ἀπέλιπόν").map((target) => `${target.kind} ${target.strong}`), ["agent G3972", "patient G5103"], "«te dejé en Creta»: Pablo a Tito");
});

console.log(`\nverify-referents: ${passed} checks passed.`);
