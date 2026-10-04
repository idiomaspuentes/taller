/**
 * Which checks of a step show for the passage in hand: only those its source calls for.
 *
 *   npm run verify:step-checks
 */
import assert from "node:assert/strict";
import { shippedWorkflow } from "../src/domain/processes";
import { applicableChecks, checkApplies, formatWhen, parseWhen } from "../src/domain/stepChecks";

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

console.log(`\nverify-step-checks: ${passed} checks passed.`);
