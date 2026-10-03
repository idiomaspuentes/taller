/** What a word of the original means: which entry its Strong's number points to, and which sense is the verse's. */
import assert from "node:assert/strict";
import { glossOfWord, normalizeLexiconFile, refsInclude, sensesOfWord, strongParts } from "../src/domain/lexicon";
import { lexiconRepos } from "../src/dcs/lexicon";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

test("el Strong del UGNT lleva un dígito de más: G52280 es la entrada 5228", () => {
  assert.deepEqual(strongParts("G52280"), [{ kind: "greek", number: 5228, letter: "" }]);
});

test("el Strong del UHB deja fuera las partículas unidas a la palabra y guarda la letra del homónimo", () => {
  assert.deepEqual(strongParts("c:d:H0776"), [{ kind: "hebrew", number: 776, letter: "" }]);
  assert.deepEqual(strongParts("H1254a"), [{ kind: "hebrew", number: 1254, letter: "a" }]);
  assert.deepEqual(strongParts("b"), []);
  assert.deepEqual(strongParts(undefined), []);
});

test("una lista de versículos empaquetada dice si tiene un versículo, sin confundir 1:7 con 1:17 ni con 11:7", () => {
  assert.equal(refsInclude("1:7,9;2:3", 1, 7), true);
  assert.equal(refsInclude("1:7,9;2:3", 2, 3), true);
  assert.equal(refsInclude("1:17;11:7", 1, 7), false);
  assert.equal(refsInclude(undefined, 1, 7), false);
});

const hyper = normalizeLexiconFile({
  brief: "para, concerniente a",
  long: "1) … 2) …",
  entries: [
    {
      strong: "G5228",
      lemma: "ὑπέρ",
      pos: ["prep. (con gen. o ac.)"],
      senses: [
        { definition: "marcador de un participante beneficiado", glosses: ["para", "a nombre de"], refs: { "3JN": "1:7", ROM: "5:6,8" } },
        { definition: "marcador de contenido", glosses: ["concerniente a"], refs: { JHN: "1:30" } },
        { definition: "", glosses: [] },
      ],
    },
  ],
})!;

test("un archivo del léxico se lee con sus sentidos, sin los que vienen vacíos", () => {
  assert.equal(hyper.entries.length, 1);
  assert.equal(hyper.entries[0]!.senses.length, 2);
});

test("el sentido del versículo en mano va primero, y los demás aparte", () => {
  const senses = sensesOfWord(hyper, { book: "3JN", chapter: 1, verse: 7 });
  assert.equal(senses.byVerse, true);
  assert.deepEqual(senses.here.map((s) => s.glosses?.[0]), ["para"]);
  assert.deepEqual(senses.other.map((s) => s.glosses?.[0]), ["concerniente a"]);
  assert.equal(glossOfWord(hyper, { book: "3JN", chapter: 1, verse: 7 }), "para");
});

test("sin sentido para el versículo se muestran todos, en el orden del léxico", () => {
  const senses = sensesOfWord(hyper, { book: "MAT", chapter: 1, verse: 1 });
  assert.equal(senses.byVerse, false);
  assert.equal(senses.here.length, 2);
  assert.equal(senses.other.length, 0);
});

test("entre homónimos se toma el que señala la letra del texto; sin letra, todos", () => {
  const file = normalizeLexiconFile({
    brief: "crear",
    long: "",
    entries: [
      { strong: "H1254a", lemma: "בָּרָא", senses: [{ glosses: ["crear"] }] },
      { strong: "H1254b", lemma: "בָּרָא", senses: [{ glosses: ["engordar"] }] },
    ],
  })!;
  assert.deepEqual(sensesOfWord(file, { book: "GEN", chapter: 1, verse: 1 }, "a").here.map((s) => s.glosses?.[0]), ["crear"]);
  assert.equal(sensesOfWord(file, { book: "GEN", chapter: 1, verse: 1 }).here.length, 2);
  assert.equal(sensesOfWord(file, { book: "GEN", chapter: 1, verse: 1 }, "z").here.length, 2);
});

test("un léxico sencillo de Door43, solo con brief y long, también se lee", () => {
  const file = normalizeLexiconFile({ brief: "I am, exist", long: "I am, exist." })!;
  assert.equal(file.entries.length, 0);
  assert.equal(glossOfWord(file, { book: "3JN", chapter: 1, verse: 7 }), "I am");
  assert.equal(normalizeLexiconFile({}), null);
  assert.equal(normalizeLexiconFile("x"), null);
});

test("sin configuración, el léxico se busca en la organización del equipo con el nombre de su idioma", () => {
  assert.deepEqual(lexiconRepos({ lang: "es-419", contentOrg: "es-419_gl" }, "greek"), [{ owner: "es-419_gl", repo: "es-419_ugl" }]);
  assert.deepEqual(lexiconRepos({ lang: "es-419", contentOrg: "es-419_gl" }, "hebrew"), [{ owner: "es-419_gl", repo: "es-419_uhl" }]);
});

test("lo que dice la configuración manda, por lengua original", () => {
  const workspace = { lang: "pt-br", contentOrg: "pt-br_gl", lexicons: { hebrew: [{ owner: "es-419_gl", repo: "pt-br_uhl" }] } };
  assert.deepEqual(lexiconRepos(workspace, "hebrew"), [{ owner: "es-419_gl", repo: "pt-br_uhl" }]);
  assert.deepEqual(lexiconRepos(workspace, "greek"), [{ owner: "pt-br_gl", repo: "pt-br_ugl" }]);
  assert.deepEqual(lexiconRepos(undefined, "greek"), []);
});

console.log(`\nverify-lexicon: ${passed} checks passed.`);
