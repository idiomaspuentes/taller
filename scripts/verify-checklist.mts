/** A checklist step: every item answered yes, or its «no» settled (fixed, created, or answered by the owner). */
import assert from "node:assert/strict";
import { consultReply, helpAtWord, questionsFor, summarizeChecklist, verseCoverage, verseItemId, type CheckAnswer, type CheckItem } from "../src/domain/checklist";
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

test("una pregunta que es solo para lo que el ítem trae no se le hace al que no lo trae, ni le falta para estar comprobado", () => {
  const asked = [...questions, { id: "alternativa", text: "¿La traducción alternativa encaja?", when: ["Traducción alternativa", "Alternate translation"] }];
  const notes: CheckItem[] = [
    { id: "n1", verseKey: "2:11", text: "Aquí Pablo habla de sí mismo. Traducción alternativa: [Yo, Pablo]" },
    { id: "n2", verseKey: "2:11", text: "Esta es una metáfora." },
    { id: "n3", verseKey: "2:13", text: "See the note. alternate translation: [x]" },
    { id: "n4", verseKey: "2:13" },
  ];
  const ids = (item: CheckItem) => questionsFor(item, notes, asked).map((q) => q.question.id);
  assert.deepEqual(ids(notes[0]!), ["sentido", "util", "cobertura", "alternativa"]);
  assert.deepEqual(ids(notes[1]!), ["sentido", "util"], "la nota sin traducción alternativa no la lleva");
  assert.ok(ids(notes[2]!).includes("alternativa"), "sin importar mayúsculas, y en el idioma de la fuente");
  assert.ok(ids(notes[3]!).includes("alternativa"), "de un ítem cuyo texto no se conoce se pregunta todo");
  const yes = (item: string, q: string) => say(item, q, "yes");
  const answers = [...notes.flatMap((n) => [yes(n.id, "sentido"), yes(n.id, "util")]), yes(verseItemId("2:11"), "cobertura"), yes(verseItemId("2:13"), "cobertura")];
  const summary = summarizeChecklist({ items: notes, questions: asked, answers });
  assert.deepEqual(summary.items.map((i) => i.state), ["pending", "ok", "pending", "pending"], "a la que no se le pregunta no le falta nada");
  assert.equal(summarizeChecklist({ items: notes, questions: asked, answers: [...answers, yes("n1", "alternativa"), yes("n3", "alternativa"), yes("n4", "alternativa")] }).complete, true);
});

test("la respuesta a una consulta es lo primero que le dicen a quien consultó, después de consultar", () => {
  const asked = { by: "Elisha", at: "2026-10-07T06:54:20Z" };
  const thread = [
    { by: "abelperez", at: "2026-10-07T06:40:00Z", body: "@Elisha esto es de antes" },
    { by: "Elisha", at: "2026-10-07T06:54:23Z", body: "@abelperez Consulta sobre TPL JUD 1:1: ¿conviene decirlo de otra manera?" },
    { by: "valeska", at: "2026-10-07T06:54:50Z", body: "Yo también lo dudo." },
    { by: "abelperez", at: "2026-10-07T06:55:13Z", body: "@Elisha en español no hace falta: los dos se llaman Judas.\n<!-- marca -->" },
    { by: "abelperez", at: "2026-10-07T07:01:00Z", body: "@Elisha otra cosa más" },
  ];
  assert.deepEqual(consultReply(asked, thread), { by: "abelperez", text: "en español no hace falta: los dos se llaman Judas." });
  assert.equal(consultReply(asked, thread.slice(0, 3)), null, "lo dicho antes, o sin nombrar a quien consultó, no es la respuesta");
  assert.equal(consultReply({ by: "Elisha", at: "2026-10-07T08:00:00Z" }, thread), null, "una consulta posterior espera la suya");
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

test("sobre el versículo se marca lo que tiene ayuda, y tocar una palabra lleva a la suya", () => {
  // Titus 1:1: three notes, two of them about words they share.
  const covered = verseCoverage([
    { id: "fe", words: [7, 8, 9, 10] },
    { id: "elegidos", words: [11, 12, 13] },
    { id: "fe-y-elegidos", words: [10, 11, 11] },
    { id: "sin-frase", words: [] },
  ]);
  assert.deepEqual([...covered.keys()].sort((a, b) => a - b), [7, 8, 9, 10, 11, 12, 13]);
  assert.deepEqual(covered.get(7), ["fe"]);
  assert.deepEqual(covered.get(10), ["fe", "fe-y-elegidos"], "en el orden en que se recorren");
  assert.deepEqual(covered.get(11), ["elegidos", "fe-y-elegidos"], "una palabra repetida en una frase cuenta una vez");
  assert.equal(covered.get(2), undefined, "lo que no tiene ayuda queda sin marcar");
  // A touch goes to the help of that word; on a word two helps share, from one to the other and back.
  assert.equal(helpAtWord(covered.get(7), "elegidos"), "fe");
  assert.equal(helpAtWord(covered.get(10), "fe"), "fe-y-elegidos");
  assert.equal(helpAtWord(covered.get(10), "fe-y-elegidos"), "fe");
  assert.equal(helpAtWord(covered.get(10)), "fe");
  assert.equal(helpAtWord(covered.get(7), "fe"), undefined, "ya se está en la única que hay");
  assert.equal(helpAtWord(covered.get(2), "fe"), undefined);
  assert.equal(helpAtWord(undefined), undefined);
});

console.log(`\nverify-checklist: ${passed} checks passed.`);
