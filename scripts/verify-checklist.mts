/** A checklist step: every item answered yes, or its «no» settled (fixed, created, or answered by the owner). */
import assert from "node:assert/strict";
import { asksOf, consultReply, groupInView, groupsOf, helpAtWord, questionsFor, summarizeChecklist, verseCoverage, verseItemId, type CheckAnswer, type CheckItem } from "../src/domain/checklist";
import { shippedWorkflow } from "../src/domain/processes";
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

// A list that checks a help against several things: two texts and the article the help links.
const asked: ChecklistQuestion[] = [
  { id: "sentido", text: "¿Tiene sentido con el texto literal?", about: "tpl" },
  { id: "alternativa", text: "¿La alternativa encaja?", about: "tpl", when: ["Traducción alternativa"] },
  { id: "cobertura", text: "¿Cada dificultad tiene su nota?", about: "tpl", per: "verse" },
  { id: "explica", text: "¿Explica el texto simplificado?", about: "tps" },
  { id: "coincide", text: "Cuando lo menciona, ¿coincide?", about: "tps", when: ["el TPS"] },
  { id: "pertinente", text: "¿El artículo enseña esa dificultad?", about: "academia", linked: true },
];
const notes: CheckItem[] = [
  { id: "a", verseKey: "1:14", text: "Aquí, Señor podría ser Jesús. Traducción alternativa, como en el TPS: [El Señor Jesús]", linked: true },
  { id: "b", verseKey: "1:14", text: "Una nota que solo explica.", linked: false },
];
const grouped = (item: CheckItem) => groupsOf(questionsFor(item, notes, asked));

test("una lista frente a varias cosas se pregunta por grupos, en el orden en que el proceso las nombra", () => {
  const shape = (item: CheckItem) => grouped(item).map((group) => [group.about, group.rows.map((row) => row.question.id)]);
  assert.deepEqual(shape(notes[0]!), [["tpl", ["sentido", "alternativa", "cobertura"]], ["tps", ["explica", "coincide"]], ["academia", ["pertinente"]]]);
  assert.deepEqual(shape(notes[1]!), [["tpl", ["sentido"]], ["tps", ["explica"]]], "sin alternativa, sin mencionar el otro texto y sin artículo: lo que le toca");
  assert.equal(asksOf(asked[5]!, { text: "no se sabe si enlaza algo" }), true, "si no se sabe, se pregunta");
  assert.equal(groupsOf(questionsFor(items[0]!, items, questions)).length, 1, "una lista que no dice frente a qué es un solo grupo, como siempre");
  // Each group is answered under the help, or under its verse: the summary counts them all.
  const answers = grouped(notes[0]!).flatMap((group) => group.rows.map((row) => say(row.answerItemId, row.question.id, "yes")));
  const summary = summarizeChecklist({ items: notes, questions: asked, answers });
  assert.deepEqual(summary.items.map((row) => row.state), ["ok", "pending"]);
});

test("se muestra el grupo que queda por responder; el que se pidió, si la ayuda lo tiene", () => {
  const done = new Set<string>();
  const view = (want?: string) => groupInView(grouped(notes[0]!), (id) => done.has(id), want)?.about;
  assert.equal(view(), "tpl");
  for (const id of ["sentido", "alternativa", "cobertura"]) done.add(id);
  assert.equal(view(), "tps", "respondido el primero, sigue el segundo");
  assert.equal(view("tpl"), "tpl", "se puede volver a uno respondido");
  assert.equal(view("academia"), "academia", "o adelantarse");
  assert.equal(groupInView(grouped(notes[1]!), (id) => done.has(id), "academia")?.about, "tps", "el pedido en otra ayuda no vale para una que no lo tiene");
  for (const id of ["explica", "coincide", "pertinente"]) done.add(id);
  assert.equal(view(), "tpl", "con todo respondido, el primero");
});

test("FCR: cada nota y cada término se recorre una sola vez, frente a los dos textos y su artículo", () => {
  const fcr = shippedWorkflow("fcr-base")!;
  const lists = (taskId: string) => fcr.tasks.find((task) => task.id === taskId)!.steps!.filter((step) => step.closing === "checklist");
  assert.equal(lists("armonizar-notas").length, 1, "eran tres listas sobre las mismas notas");
  const list = lists("armonizar-notas")[0]!.checklist!;
  assert.deepEqual([...new Set(list.map((q) => q.about))], ["tpl", "tps", "academia"]);
  // The note that asks the most: the first of its verse, with an alternate translation, naming the other text, and an article.
  const most: CheckItem = { id: "m", verseKey: "1:14", text: "Traducción alternativa, como en el TPS: [x]", linked: true };
  const plain: CheckItem = { id: "p", verseKey: "1:14", text: "Solo explica. Traducción alternativa: [x]", linked: true };
  const sizes = (item: CheckItem) => groupsOf(questionsFor(item, [most, plain], list)).map((group) => group.rows.length);
  assert.deepEqual(sizes(most), [4, 4, 2], "nunca más de cuatro a la vez");
  assert.deepEqual(sizes(plain), [3, 2, 2], "la de casi siempre");
  assert.deepEqual(sizes({ ...plain, id: "s", text: "Solo explica.", linked: false }), [2, 2], "sin artículo no se pregunta por él");
  const words = lists("armonizar-palabras");
  assert.equal(words.length, 1, "eran dos sobre los mismos términos");
  assert.deepEqual(words[0]!.checklist!.map((q) => [q.id, q.about]), [["definicion", "tpl"], ["cobertura", "tpl"], ["sugerencia", "tps"]]);
  assert.ok(words[0]!.checklist!.find((q) => q.id === "sugerencia")!.articleFocus?.length, "las sugerencias se leen en su sección del artículo");
});

console.log(`\nverify-checklist: ${passed} checks passed.`);
