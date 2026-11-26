/**
 * What Taller finds by itself under a proposed note or Words article: mechanical slips it can fix, the team's
 * writing rules (from the process package) and, in Words, a linked word that is not among the article's Strong numbers.
 * Run: npm run verify:help-checks
 */
import assert from "node:assert/strict";
import { applyFixes, caretAfterFixes, checksOf, mechanicalChecks, ruleChecks, verseChecks, type HelpCheck } from "../src/domain/helpChecks";
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
  assert.deepEqual(strongMismatch({ words: VERSE, quote: "יְשׁוּעָ֑ה", occurrence: 1, article: KING_ES, sourceArticle: null }), { strongs: ["H3444"], words: ["יְשׁוּעָ֑ה"] });
});

test("sin Strong en ningún artículo, calla", () => {
  assert.equal(strongMismatch({ words: VERSE, quote: "יְשׁוּעָ֑ה", occurrence: 1, article: NO_STRONG, sourceArticle: null }), null);
  assert.equal(strongMismatch({ words: VERSE, quote: "יְשׁוּעָ֑ה", occurrence: 1, article: null, sourceArticle: null }), null);
});

test("el inglés suple al español", () => {
  assert.deepEqual(strongMismatch({ words: VERSE, quote: "יְשׁוּעָ֑ה", occurrence: 1, article: NO_STRONG, sourceArticle: KING_EN }), { strongs: ["H3444"], words: ["יְשׁוּעָ֑ה"] });
  assert.equal(strongMismatch({ words: VERSE, quote: "הַ⁠מֶּ֣לֶךְ", occurrence: 1, article: NO_STRONG, sourceArticle: KING_EN }), null);
});

test("una cita que el versículo no dice no se juzga", () => {
  assert.equal(strongMismatch({ words: VERSE, quote: "שָׁלוֹם", occurrence: 1, article: KING_ES, sourceArticle: null }), null);
});


// A verse corrected in Tuning: only what reaches the file as a slip. A doubled space does not (the writer joins it),
// nor quotes (a quote opened in one verse closes in another).
const verse = (text: string) => verseChecks(text);

test("en el versículo, el espacio antes de un signo se arregla", () => {
  const text = "Y sucedió en los días , de Asuero .";
  const checks = verse(text);
  assert.deepEqual(ids(checks), ["space-before", "space-before"]);
  assert.equal(applyFixes(text, checks), "Y sucedió en los días, de Asuero.");
});

test("en el versículo, el espacio después de un signo que abre se arregla", () => {
  const text = "y dijo: « Ve. ¿ Quién eres ?»";
  assert.equal(applyFixes(text, verse(text)), "y dijo: «Ve. ¿Quién eres?»");
});

test("en el versículo, un signo pegado a la palabra siguiente se separa", () => {
  const text = "de Asuero.Y el rey dijo:«Ve»y fue";
  const checks = verse(text);
  assert.ok(checks.every((c) => c.id === "space-after" && c.fix === "auto"));
  assert.equal(applyFixes(text, checks), "de Asuero. Y el rey dijo: «Ve» y fue");
});

test("en el versículo, los números con dos puntos y los puntos suspensivos no son un error", () => {
  assert.deepEqual(verse("como en 3:14 y 1.5 … y así..."), []);
  assert.deepEqual(verse("«¡Viva el rey!»."), []);
});

test("en el versículo, una palabra repetida avisa pero no se quita sola", () => {
  const text = "la casa de de su padre, abajo, abajo";
  const checks = verse(text);
  assert.deepEqual(ids(checks), ["repeated"]);
  assert.equal(checks[0]!.fix, "none");
  assert.equal(applyFixes(text, checks), text, "el TPL repite a propósito lo que el hebreo repite");
});

test("en el versículo, el doble espacio y las comillas sin cerrar no se reportan", () => {
  assert.deepEqual(verse("Y sucedió  en los días de «Asuero"), []);
});

test("en el versículo, abreviaturas y ordinales no se tocan: Arreglar los dañaría", () => {
  for (const clean of ["el año 480 a.C. y el 1.º y 2.ª del mes", "en EE.UU. y p.ej. aquí", "como dice el Sr. Pérez"]) {
    assert.deepEqual(verse(clean), [], clean);
  }
});

test("en el versículo, un punto pegado a la frase siguiente sí se separa, también tras una palabra corta", () => {
  const text = "lo dijo él.Y fue";
  assert.equal(applyFixes(text, verse(text)), "lo dijo él. Y fue");
});

test("en el versículo, un punto pegado tras un signo que cierra o un número también se separa", () => {
  for (const [text, fixed] of [["dijo «Ve».Y fue", "dijo «Ve». Y fue"], ["(y fue).Y volvió", "(y fue). Y volvió"], ["en el año 3.Y dio", "en el año 3. Y dio"], ["dijo Dios.Y.", "dijo Dios. Y."]]) {
    assert.equal(applyFixes(text, verse(text)), fixed);
  }
});

test("en el versículo, los puntos suspensivos con espacios no se reportan", () => {
  assert.deepEqual(verse("uno . . . dos"), []);
});

test("en el versículo, un espacio antes de un punto final sigue siendo un error", () => {
  const text = "fue al palacio . Y volvió";
  assert.equal(applyFixes(text, verse(text)), "fue al palacio. Y volvió");
});

// ---------------------------------------------------------------- the editors: checksOf and the caret
const withSpace = (text: string) => verseChecks(text, { doubleSpace: true });
const ofNote = (text: string, kind: "notas" | "palabras" | "preguntas" | "academia" = "notas", past?: string) =>
  checksOf(text, kind, { address: "usted", language: "es", past });

test("un versículo con espacio doble solo lo avisa con la opción", () => {
  assert.deepEqual(ids(verseChecks("Y el rey  dijo")), []);
  const checks = withSpace("Y el rey  dijo");
  assert.deepEqual(ids(checks), ["double-space"]);
  assert.equal(applyFixes("Y el rey  dijo", checks), "Y el rey dijo");
});

test("espacio doble y espacio antes de coma en un versículo se arreglan juntos", () => {
  const text = "Y el rey  dijo a Amán , vete";
  assert.equal(applyFixes(text, withSpace(text)), "Y el rey dijo a Amán, vete");
});

test("un poema conserva sus líneas", () => {
  const text = "Alaben a Jehová\nporque  él es bueno ,";
  assert.equal(applyFixes(text, withSpace(text)), "Alaben a Jehová\nporque él es bueno,");
});

test("el espacio doble no se avisa dos veces", () => {
  assert.deepEqual(ids(withSpace("dijo: «  Ve  »")).sort(), ["space-before", "space-open"]);
});

test("el «tú» es un aviso que se arregla", () => {
  const text = "Puedes traducirlo así.";
  const checks = ofNote(text);
  assert.ok(ids(checks).includes("informal"));
  assert.ok(applyFixes(text, checks).startsWith("Puede traducirlo"));
});

test("el «tú» y un espacio doble se arreglan en una pasada", () => {
  const text = "Puedes  traducirlo así.";
  assert.equal(applyFixes(text, ofNote(text)), "Puede traducirlo así.");
});

test("sin regla de tratamiento no hay aviso del «tú»", () => {
  assert.ok(!ids(checksOf("Puedes traducirlo así.", "notas", { address: undefined, language: "es" })).includes("informal"));
});

test("la regla de la definición no se aplica después de los ejemplos", () => {
  const text = "El **rey** dijo";
  assert.ok(ids(ofNote(text, "palabras", "# rey\n\nDefinición")).includes("negrita-en-definicion"));
  assert.ok(!ids(ofNote(text, "palabras", "# rey\n\n## Ejemplos de las historias bíblicas")).includes("negrita-en-definicion"));
  assert.ok(!ids(ofNote(text, "palabras", "# king\n\n## Examples from the Bible stories")).includes("negrita-en-definicion"));
});

test("el cursor se corre con los arreglos de antes", () => {
  const text = "Y el rey  dijo a Amán , vete";
  const checks = withSpace(text);
  assert.equal(caretAfterFixes(text.length, checks), 26);
  assert.equal(caretAfterFixes(3, checks), 3);
  assert.equal(caretAfterFixes(9, checks), 9);
});

test("preguntas y academia reciben las comprobaciones de formato, no las reglas de notas", () => {
  const text = "Traducción alternativa: **x**  y";
  for (const kind of ["preguntas", "academia"] as const) {
    const found = ids(checksOf(text, kind, { language: "es" }));
    assert.ok(found.includes("double-space"), kind);
    assert.ok(!found.includes("traduccion-alternativa-entre-comillas"), kind);
  }
  const notes = ids(checksOf(text, "notas", { language: "es" }));
  assert.ok(notes.includes("double-space") && notes.includes("traduccion-alternativa-entre-comillas"));
});

console.log(`verify-help-checks: ${passed} checks passed.`);
