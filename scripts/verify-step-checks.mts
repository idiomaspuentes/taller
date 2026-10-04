/**
 * Which checks of a step show for the passage in hand: only those its source calls for.
 *
 *   npm run verify:step-checks
 */
import assert from "node:assert/strict";
import { shippedWorkflow } from "../src/domain/processes";
import { applicableChecks, checkApplies, formatWhen, itemChecks, paragraphsFor, parseWhen, stepWideChecks } from "../src/domain/stepChecks";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

test("una comprobación con palabras solo aparece si la fuente del pasaje tiene alguna", () => {
  const you = { when: ["you", "your"] };
  assert.equal(checkApplies(you, "And he said to them, Where are you going?"), true);
  assert.equal(checkApplies(you, "YOUR house is left desolate."), true, "sin importar mayúsculas");
  assert.equal(checkApplies(you, "The young man went to the youth."), false, "palabras enteras: «young» no es «you»");
  assert.equal(checkApplies(you, "In the beginning God created the heavens and the earth."), false);
});

test("sin palabras aparece siempre; y si no se sabe la fuente, aparecen todas", () => {
  assert.equal(checkApplies({}, "cualquier texto"), true);
  assert.equal(checkApplies({ when: [] }, "cualquier texto"), true);
  assert.equal(checkApplies({ when: ["you"] }, null), true, "no se pudo leer la fuente: mejor una línea de más");
  assert.equal(checkApplies({ when: ["you"] }, undefined), true, "la lista se ve lejos del pasaje (en la tarjeta)");
});

test("un asterisco deja que la palabra siga, y # es cualquier número", () => {
  assert.equal(checkApplies({ when: ["*ed"] }, "He walked to the city."), true);
  assert.equal(checkApplies({ when: ["*ed"] }, "He goes to bed."), false, "«bed» es una palabra entera, no un verbo en pasado");
  assert.equal(checkApplies({ when: ["walk*"] }, "They are walking."), true);
  assert.equal(checkApplies({ when: ["#"] }, "in the 2nd year of Darius"), true);
  assert.equal(checkApplies({ when: ["#"] }, "in the second year"), false);
});

test("lo que la persona escribe en el editor se guarda como lista, y vuelve igual", () => {
  assert.deepEqual(parseWhen(" You, your ;yours\nYOU "), ["you", "your", "yours"]);
  assert.equal(parseWhen("  ,  "), undefined, "vacío: la comprobación aparece siempre");
  assert.equal(formatWhen(["you", "your"]), "you, your");
});

test("FCR, borrador del TPL: en un pasaje sin «you» ni números no se pregunta por ellos, y lo que siempre importa sigue", () => {
  const checks = shippedWorkflow("fcr-base")!.tasks.find((t) => t.id === "tpl")!.steps!.find((s) => s.id === "borrador")!.checks!;
  const ids = (source: string | null) => applicableChecks(checks, source).map((c) => c.id);
  const genesis = "In the beginning God created the heavens and the earth.";
  assert.deepEqual(ids(genesis), ["completo", "genero", "pasado", "nombres", "ortografia"]);
  const haggai = "In the 2nd year of Darius the king, the word of Yahweh came: Is it time for you to dwell in your houses?";
  assert.ok(["you", "referente", "numeros", "ser-estar"].every((id) => ids(haggai).includes(id)));
  assert.equal(ids(null).length, checks.length, "sin fuente, la lista entera");
});

test("los nombres propios se reconocen por la mayúscula que no abre la oración", () => {
  const names = { when: ["Aa"] };
  assert.equal(checkApplies(names, "Then he went up to Jerusalem."), true);
  assert.equal(checkApplies(names, "Jude, a servant of the Lord"), true, "abre la oración, pero va seguido de coma");
  assert.equal(checkApplies(names, "Then he went up to the city. And they saw it."), false, "«And» abre una oración: no es un nombre");
  assert.equal(checkApplies(names, "And I saw it."), false, "«I» no es un nombre");
});

test("cada ítem muestra solo lo que su propia fuente pide; lo de siempre se pregunta una vez para todo el paso", () => {
  const checks = shippedWorkflow("fcr-base")!.tasks.find((t) => t.id === "tpl")!.steps!.find((s) => s.id === "pares")!.checks!;
  assert.deepEqual(stepWideChecks(checks).map((c) => c.id), ["completo", "genero", "pasado", "ortografia"], "las que no tienen palabras: una vez para el paso, no en cada versículo");
  const verse = (text: string | undefined) => itemChecks(checks, text).map((c) => c.id);
  assert.deepEqual(verse("Is it time for you to dwell in your houses?"), ["you", "referente", "ser-estar", "sentidos"]);
  assert.deepEqual(verse("Grace and peace."), [], "un versículo que no pide nada no muestra nada");
  assert.equal(verse(undefined).length, checks.length - 4, "sin la fuente de ese ítem, todas las que tienen palabras");
});

test("en un artículo, la comprobación dice en qué párrafos del inglés aparece", () => {
  const article = ["# Elder", "An elder was a leader.", "You should translate it as you would say it.", "See also: leader.", "The elders asked you."].join(String.fromCharCode(10, 10));
  assert.deepEqual(paragraphsFor({ when: ["you"] }, article), [3, 5]);
  assert.deepEqual(paragraphsFor({ when: ["#"] }, article), []);
  assert.deepEqual(paragraphsFor({}, article), [], "la que no tiene palabras no es de ningún párrafo");
});

test("las direcciones de los enlaces de una nota no cuentan como texto: sus números no piden nada", () => {
  const note = "This is a metaphor. (See: [[rc://en/ta/man/translate/figs-metaphor]]) See [chapter 2](../02/intro.md).";
  assert.equal(checkApplies({ when: ["#"] }, note), true, "«chapter 2» sí es texto");
  assert.equal(checkApplies({ when: ["#"] }, "A metaphor. (See: [[rc://en/ta/man/translate/figs-123person]])"), false);
  assert.equal(checkApplies({ when: ["man"] }, note), false, "«man» está en la dirección, no en la nota");
});

console.log(`\nverify-step-checks: ${passed} checks passed.`);
