/** What a word of the original means: which entry its Strong's number points to, and which sense is the verse's. */
import assert from "node:assert/strict";
import { glossesInclude, glossOfWord, lexiconReport, normalizeLexiconField, normalizeLexiconFile, otherWordsOfField, refsInclude, sensesOfWord, strongCode, strongParts } from "../src/domain/lexicon";
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

const labels = { word: "Palabra", lemma: "Lema", entry: "Entrada", verse: "Versículo", shown: "Sentido mostrado", missing: "(el léxico no tiene entrada)", from: "Enviado desde Taller por" };

test("un reporte lleva al léxico la palabra, su entrada, el versículo y lo que la persona vio", () => {
  const issue = lexiconReport({
    text: "  «para» debería ser «porque» aquí.  ",
    surface: "γὰρ",
    lemma: "γάρ",
    part: { kind: "greek", number: 1063, letter: "" },
    at: { book: "3JN", chapter: 1, verse: 7 },
    shown: "para, porque — marcador de causa",
    username: "ana",
    labels,
  });
  assert.equal(issue.title, "G1063 γάρ · 3JN 1:7: «para» debería ser «porque» aquí.");
  assert.ok(issue.body.startsWith("«para» debería ser «porque» aquí."));
  assert.ok(issue.body.includes("- Palabra: γὰρ (Lema γάρ)"));
  assert.ok(issue.body.includes("- Entrada: G1063 · `content/1063.json`"));
  assert.ok(issue.body.includes("- Versículo: 3JN 1:7"));
  assert.ok(issue.body.includes("- Sentido mostrado: para, porque — marcador de causa"));
  assert.ok(issue.body.endsWith("- Enviado desde Taller por @ana"));
});

test("un reporte de una palabra que el léxico no tiene lo dice, y un texto largo no hace un título largo", () => {
  const issue = lexiconReport({ text: "x".repeat(200), surface: "בָּרָא", lemma: "בָּרָא", part: { kind: "hebrew", number: 1254, letter: "a" }, at: { book: "GEN", chapter: 1, verse: 1 }, shown: "", username: "bea", labels });
  assert.ok(issue.title.startsWith("H1254a בָּרָא · GEN 1:1: "));
  assert.ok(issue.title.length < 110);
  assert.ok(issue.body.includes("- Sentido mostrado: (el léxico no tiene entrada)"));
  assert.equal(strongCode({ kind: "hebrew", number: 776, letter: "" }), "H0776");
});

test("una palabra del borrador se reconoce entre las glosas aunque esté conjugada o lleve signos", () => {
  const salir = normalizeLexiconFile({ brief: "salir de", long: "", entries: [{ strong: "G1831", lemma: "ἐξέρχομαι", senses: [{ glosses: ["salir de", "partir de"] }] }] })!;
  assert.equal(glossesInclude(salir, "salieron"), true);
  assert.equal(glossesInclude(salir, "Salieron,"), true);
  assert.equal(glossesInclude(salir, "recibir"), false);
  const nombre = normalizeLexiconFile({ brief: "nombre", long: "", entries: [{ strong: "G3686", lemma: "ὄνομα", senses: [{ glosses: ["persona"] }, { glosses: ["nombre"] }] }] })!;
  assert.equal(glossesInclude(nombre, "Nombre,"), true);
});

test("las palabras que solo unen («de», «por») no hacen coincidir una glosa de varias palabras, pero sí una de una sola", () => {
  const salir = normalizeLexiconFile({ brief: "salir de", long: "", entries: [{ strong: "G1831", lemma: "ἐξέρχομαι", senses: [{ glosses: ["salir de"] }] }] })!;
  const apo = normalizeLexiconFile({ brief: "de", long: "", entries: [{ strong: "G575", lemma: "ἀπό", senses: [{ glosses: ["de", "desde"] }] }] })!;
  assert.equal(glossesInclude(salir, "de"), false);
  assert.equal(glossesInclude(apo, "de"), true);
  assert.equal(glossesInclude(apo, "del"), false);
});

test("un léxico sencillo, sin sentidos, se compara por su glosa breve", () => {
  const file = normalizeLexiconFile({ brief: "templo, santuario", long: "templo." })!;
  assert.equal(glossesInclude(file, "templos"), true);
  assert.equal(glossesInclude(file, ""), false);
});

test("un sentido dice en qué campo de significado está, y el campo lista las otras palabras", () => {
  const file = normalizeLexiconFile({ brief: "YHVH", long: "", entries: [{ strong: "H3068", lemma: "יהוה", senses: [{ glosses: ["YHVH"], domain: "Nombres de deidades", domainCode: "003001004" }, { glosses: ["otro"], domainCode: "../../x" }] }] })!;
  assert.equal(file.entries[0]!.senses[0]!.domainCode, "003001004");
  assert.equal(file.entries[0]!.senses[1]!.domainCode, undefined, "un código que no es un nombre de archivo no se usa para leer uno");
  const field = normalizeLexiconField({ name: "Nombres de deidades", words: [{ strong: "H0430", lemma: "אֱלֹהִים", gloss: "Dios" }, { strong: "H3068", lemma: "יהוה", gloss: "YHVH" }, { strong: "H1168a", lemma: "בַּעַל", gloss: "Baal" }, { lemma: "sin número" }] })!;
  assert.equal(field.words.length, 3, "una palabra sin número no se puede abrir, y no se lista");
  assert.deepEqual(otherWordsOfField(field, "H3068").map((word) => word.strong), ["H0430", "H1168a"], "la palabra en mano no es «otra»");
  assert.deepEqual(otherWordsOfField(field, "c:H3068").map((word) => word.strong), ["H0430", "H1168a"], "tampoco con una partícula unida");
  const greek = normalizeLexiconField({ name: "Comunicación", words: [{ strong: "G3004", lemma: "λέγω", gloss: "decir" }, { strong: "G2980", lemma: "λαλέω", gloss: "hablar" }] })!;
  assert.deepEqual(otherWordsOfField(greek, "G30040").map((word) => word.lemma), ["λαλέω"], "el griego lleva un dígito de más en el texto");
  assert.equal(normalizeLexiconField({ name: "Vacío", words: [] }), null);
  assert.equal(normalizeLexiconField(null), null);
});

console.log(`\nverify-lexicon: ${passed} checks passed.`);
