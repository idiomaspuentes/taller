/**
 * What Taller finds by itself under a proposed note or Words article: mechanical slips it can fix, the team's
 * writing rules (from the process package) and, in Words, a linked word that is not among the article's Strong numbers.
 * Run: npm run verify:help-checks
 */
import assert from "node:assert/strict";
import { applyFixes, mechanicalChecks, ruleChecks, type HelpCheck } from "../src/domain/helpChecks";
import { writingChecks } from "../src/domain/processes";
import { articleStrongs, strongKey, strongMismatch } from "../src/domain/termStrong";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const ids = (checks: HelpCheck[]) => checks.map((c) => c.id);
const notas = (text: string, before?: string) => mechanicalChecks(text, { kind: "notas", before });
const palabras = (text: string, before?: string) => mechanicalChecks(text, { kind: "palabras", before });

test("un enlace a un libro que no existe se arregla por su nombre", () => {
  const text = "[2 Crónicas 3:14](rc://*/tn/help/1cr/3/14)";
  const checks = notas(text);
  assert.deepEqual(ids(checks), ["bad-link"]);
  assert.equal(checks[0]!.fix, "auto");
  assert.equal(applyFixes(text, checks), "[2 Crónicas 3:14](rc://*/tn/help/2ch/03/14)");
});

test("un enlace que no se puede deducir solo avisa", () => {
  const checks = notas("[aquí](rc://*/tn/help/2re/11/1)");
  assert.deepEqual(ids(checks), ["bad-link"]);
  assert.equal(checks[0]!.fix, "none");
  assert.deepEqual(checks[0]!.message, { key: "hc.badLink", params: { code: "2re" } });
});

test("los enlaces buenos no avisan", () => {
  for (const text of [
    "Vea [Salmos 54:1](rc://*/tn/help/psa/054/01).",
    "Vea [Lucas 1:34](rc://*/tn/help/LUK/01/34).",
    "Vea [[rc://*/ta/man/translate/figs-metaphor]].",
    "Vea [ira](../kt/wrath.md) y [Tito 1:5](../../tit/01/05.md).",
  ]) {
    assert.deepEqual(ids(notas(text)), [], text);
  }
});

test("doble espacio dentro del texto, no en la sangría", () => {
  const text = "*   Usualmente, un rey  era";
  const checks = palabras(text);
  assert.deepEqual(ids(checks), ["double-space"]);
  assert.equal(applyFixes(text, checks), "*   Usualmente, un rey era");
});

test("espacio antes de coma o punto", () => {
  const text = "de los creyentes de Cristo .";
  const checks = notas(text);
  assert.deepEqual(ids(checks), ["space-before"]);
  assert.equal(applyFixes(text, checks), "de los creyentes de Cristo.");
});

test("dos espacios antes de una coma son un solo aviso, y Arreglar los quita todos", () => {
  const text = "una palabra  , otra";
  const checks = notas(text);
  assert.deepEqual(ids(checks), ["space-before"]);
  assert.equal(applyFixes(text, checks), "una palabra, otra");
  const item = "* algo  ,";
  assert.equal(applyFixes(item, palabras(item)), "* algo.");
});

test("línea de lista que termina en coma", () => {
  const text = "* La palabra casa…, ya sean edificios o tiendas,\n* Otra línea.";
  const checks = palabras(text);
  assert.deepEqual(ids(checks), ["list-comma"]);
  assert.equal(applyFixes(text, checks), "* La palabra casa…, ya sean edificios o tiendas.\n* Otra línea.");
});

test("encabezado sin ##", () => {
  const before = "# perjudicar\n\n## Definición\n\nLa palabra";
  const text = "# perjudicar\nDefinición\nLa palabra";
  const checks = palabras(text, before);
  assert.deepEqual(ids(checks), ["bare-heading"]);
  assert.equal(applyFixes(text, checks), "# perjudicar\n## Definición\nLa palabra");
  assert.deepEqual(ids(palabras(text)), [], "sin el texto de antes no se sabe qué era un encabezado");
});

test("viñeta sin espacio", () => {
  const text = "*Los “hombres sabios”";
  const checks = palabras(text);
  assert.deepEqual(ids(checks), ["bullet-space"]);
  assert.equal(applyFixes(text, checks), "* Los “hombres sabios”");
  assert.deepEqual(ids(palabras("**[19:16](../19/16.md)** El rey")), []);
  assert.deepEqual(ids(palabras("*la palabra* significa algo")), [], "una cursiva al principio no es una viñeta");
});

test("las comillas no se avisan", () => {
  assert.deepEqual(ids(notas("\"reinar\" y “reinar” y «reinar»")), []);
});

// ---------------------------------------------------------------- the team's rules, from the process package
const RULES = writingChecks();
const reglas = (text: string, kind: "notas" | "palabras" = "notas") => ruleChecks(text, kind, RULES, "es");

test("él cerca de Dios avisa como pregunta", () => {
  const checks = reglas("Esto se dirige hacia Dios porque él es justo.");
  assert.equal(checks.length, 1);
  assert.match((checks[0]!.message as { text: string }).text, /^¿Se refiere a Dios\?/);
  assert.ok(checks[0]!.why, "una regla dice por qué");
  assert.deepEqual(reglas("Asuero dijo que él iría."), []);
});

test("Rey con nombre avisa, Rey de reyes no", () => {
  assert.equal(reglas("Esto pasó con el Rey Asuero.").length, 1);
  assert.deepEqual(reglas("Jesús es Rey de reyes."), []);
});

test("negrita en la definición sí, en los ejemplos no", () => {
  const article = [
    "# provincia",
    "",
    "## Definición",
    "",
    "Una **provincia** es una parte de un reino.",
    "",
    "## Ejemplos de las historias bíblicas",
    "",
    "* **[1:1](../01/01.md)** Los **judíos** vivían en todas las provincias.",
  ].join("\n");
  assert.equal(reglas(article, "palabras").length, 1);
  assert.deepEqual(reglas(article, "notas"), [], "es una regla de los artículos, no de las notas");
});

test("traducción alternativa en negrita", () => {
  assert.equal(reglas("Traducción alternativa: **incluso hoy**").length, 1);
  assert.deepEqual(reglas("Traducción alternativa: “incluso hoy”"), []);
});

test("las reglas no se arreglan solas", () => {
  const all = [...reglas("hacia Dios porque él es justo, con el Rey Asuero. Traducción alternativa: **hoy**")];
  assert.equal(all.length, 3);
  assert.ok(all.every((c) => c.fix === "none" && c.replacement === undefined));
});

// ---------------------------------------------------------------- the Strong number of a linked word
const KING_ES = "# rey\n\n## Definición\n\nUn rey…\n\n## Datos de esta palabra\n\n*   Números de Strong: H4427, H4428, H4430, G0935, G0936.\n";
const KING_EN = "# king\n\n## Word Data:\n\n* Strong’s: H4427, H4428, H4430, G09350, G09360\n";
const NO_STRONG = "# rey\n\n## Definición\n\nUn rey…\n";
const VERSE = [
  { surface: "וַ⁠יְהִ֖י", lemma: "הָיָה", strong: "c:H1961" },
  { surface: "הַ⁠מֶּ֣לֶךְ", lemma: "מֶלֶךְ", strong: "d:H4428" },
  { surface: "יְשׁוּעָ֑ה", lemma: "יְשׁוּעָה", strong: "H3444" },
];

test("strongKey quita prefijos, ceros y la letra final", () => {
  assert.equal(strongKey("b:H4428"), "H4428");
  assert.equal(strongKey("H0148"), "H148");
  assert.equal(strongKey("H1961a"), "H1961");
  assert.equal(strongKey("G07440"), "G744");
  assert.equal(strongKey("G0744"), "G744");
  assert.equal(strongKey("G744"), "G744");
  assert.equal(strongKey(""), null);
  assert.equal(strongKey("x"), null);
});

test("la lista sale de la línea Strong en español o en inglés", () => {
  assert.deepEqual(articleStrongs(KING_ES), ["H4427", "H4428", "H4430", "G935", "G936"]);
  assert.deepEqual(articleStrongs(KING_EN), ["H4427", "H4428", "H4430", "G935", "G936"]);
  assert.deepEqual(articleStrongs(NO_STRONG), []);
});

test("la palabra del rey está en el artículo del rey", () => {
  assert.equal(strongMismatch({ words: VERSE, quote: "הַ⁠מֶּ֣לֶךְ", occurrence: 1, article: KING_ES, sourceArticle: KING_EN }), null);
});

test("una palabra enlazada a un artículo que no la tiene avisa", () => {
  assert.deepEqual(strongMismatch({ words: VERSE, quote: "יְשׁוּעָ֑ה", occurrence: 1, article: KING_ES, sourceArticle: null }), { strongs: ["H3444"] });
});

test("sin Strong en ningún artículo, calla", () => {
  assert.equal(strongMismatch({ words: VERSE, quote: "יְשׁוּעָ֑ה", occurrence: 1, article: NO_STRONG, sourceArticle: null }), null);
  assert.equal(strongMismatch({ words: VERSE, quote: "יְשׁוּעָ֑ה", occurrence: 1, article: null, sourceArticle: null }), null);
});

test("el inglés suple al español", () => {
  assert.deepEqual(strongMismatch({ words: VERSE, quote: "יְשׁוּעָ֑ה", occurrence: 1, article: NO_STRONG, sourceArticle: KING_EN }), { strongs: ["H3444"] });
  assert.equal(strongMismatch({ words: VERSE, quote: "הַ⁠מֶּ֣לֶךְ", occurrence: 1, article: NO_STRONG, sourceArticle: KING_EN }), null);
});

test("una cita que el versículo no dice no se juzga", () => {
  assert.equal(strongMismatch({ words: VERSE, quote: "שָׁלוֹם", occurrence: 1, article: KING_ES, sourceArticle: null }), null);
});

console.log(`verify-help-checks: ${passed} checks passed.`);
