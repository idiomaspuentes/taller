/** A checklist step: every item answered yes, or its «no» settled (fixed, created, or answered by the owner). */
import assert from "node:assert/strict";
import { questionsFor, summarizeChecklist, verseItemId, type CheckAnswer, type CheckItem } from "../src/domain/checklist";
import { canApproveStep, closesInItsTool } from "../src/domain/stepClaim";
import type { ChecklistQuestion, TaskStep } from "../src/domain/types";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const questions: ChecklistQuestion[] = [
  { id: "sentido", text: "¿Tiene sentido con el texto?" },
  { id: "util", text: "¿Es útil?" },
  { id: "cobertura", text: "¿Cada dificultad tiene su nota?", per: "verse" },
];
const items: CheckItem[] = [
  { id: "n1", verseKey: "2:11" },
  { id: "n2", verseKey: "2:11" },
  { id: "n3", verseKey: "2:13" },
];
let clock = 0;
const say = (itemId: string, questionId: string, value: "yes" | "no", extra: Partial<CheckAnswer> = {}): CheckAnswer => ({
  itemId, questionId, value, by: "marcos", at: new Date(Date.UTC(2026, 9, 1, 9, clock++)).toISOString(), ...extra,
});
const allYes = (): CheckAnswer[] => [
  ...items.flatMap((i) => [say(i.id, "sentido", "yes"), say(i.id, "util", "yes")]),
  say(verseItemId("2:11"), "cobertura", "yes"),
  say(verseItemId("2:13"), "cobertura", "yes"),
];
const sum = (answers: CheckAnswer[]) => summarizeChecklist({ items, questions, answers });
const stateOf = (answers: CheckAnswer[], id: string) => sum(answers).items.find((i) => i.itemId === id)!.state;

test("la pregunta por versículo se hace una vez, en el primer ítem de ese versículo", () => {
  assert.deepEqual(questionsFor(items[0]!, items, questions).map((q) => [q.question.id, q.answerItemId]), [["sentido", "n1"], ["util", "n1"], ["cobertura", "verse:2:11"]]);
  assert.deepEqual(questionsFor(items[1]!, items, questions).map((q) => q.question.id), ["sentido", "util"]);
});

test("con todo en «sí» la lista está completa", () => {
  const s = sum(allYes());
  assert.equal(s.complete, true);
  assert.equal(s.done, 3);
  assert.deepEqual(s.changed, []);
});

test("sin responder está pendiente, y un «no» sin nada hecho queda abierto", () => {
  assert.equal(sum([]).complete, false);
  assert.equal(stateOf([], "n1"), "pending");
  const answers = [...allYes(), say("n2", "sentido", "no")];
  assert.equal(stateOf(answers, "n2"), "open");
  assert.equal(sum(answers).complete, false);
  assert.deepEqual(sum(answers).open.map((i) => i.itemId), ["n2"]);
});

test("un «no» que se corrigió o para el que se creó lo que faltaba cuenta como resuelto, y va al resumen", () => {
  const answers = [...allYes(), say("n2", "sentido", "no", { outcome: "fixed", note: "Ajusté la nota a la nueva redacción" }), say(verseItemId("2:13"), "cobertura", "no", { outcome: "created", note: "Nota nueva para «gran Dios»" })];
  const s = sum(answers);
  assert.equal(s.complete, true);
  assert.deepEqual(s.changed.map((i) => i.itemId).sort(), ["n2", "n3"]);
});

test("una consulta al dueño deja el ítem esperando hasta que se responde", () => {
  const asked = [...allYes(), say("n1", "sentido", "no", { outcome: "consult", note: "La cita generada sale partida" })];
  assert.equal(stateOf(asked, "n1"), "consult");
  assert.equal(sum(asked).complete, false);
  assert.deepEqual(sum(asked).consulting.map((i) => i.itemId), ["n1"]);
  const answered = [...asked, say("n1", "sentido", "no", { outcome: "consult", note: "La cita generada sale partida", resolved: true })];
  assert.equal(stateOf(answered, "n1"), "ok");
  assert.equal(sum(answered).complete, true);
});

test("vale la última respuesta de cada pregunta, la haya dado quien la haya dado", () => {
  const answers = [...allYes(), say("n3", "util", "no"), say("n3", "util", "yes", { by: "dina" })];
  assert.equal(stateOf(answers, "n3"), "ok");
});

test("si el texto del versículo cambia después, lo comprobado de ese versículo vuelve a quedar pendiente", () => {
  const answers = allYes().map((a) => ({ ...a, textHash: "antes" }));
  const same = summarizeChecklist({ items, questions, answers, currentHashes: { "2:11": "antes", "2:13": "antes" } });
  assert.equal(same.complete, true);
  const changed = summarizeChecklist({ items, questions, answers, currentHashes: { "2:11": "antes", "2:13": "despues" } });
  assert.equal(changed.complete, false);
  assert.deepEqual(changed.items.map((i) => i.state), ["ok", "ok", "pending"], "solo el versículo que cambió");
});

test("un paso que se cierra con lista de comprobación y herramienta no se completa desde la lista de tareas", () => {
  const step: TaskStep = { id: "notas-tpl", name: "Notas frente al TPL", solverAppId: "checklist", closing: "checklist", checklist: questions };
  assert.equal(closesInItsTool(step), true);
  assert.equal(canApproveStep("marcos", { schema: "gateway-task-progress-2", doneStepIds: [], steps: {} } as never, step), false);
  assert.equal(closesInItsTool({ ...step, solverAppId: undefined }), false, "sin herramienta, lo marca quien lo hace");
});

console.log(`\nverify-checklist: ${passed} checks passed.`);
