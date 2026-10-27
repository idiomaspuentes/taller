/** A checklist step: every item answered yes, or its «no» settled (fixed, created, or answered by the owner). */
import assert from "node:assert/strict";
import { itemSaying, proposalAnswer, proposalKeeping, proposalSaying, proposalsOf } from "../src/domain/checkProposal";
import { articleItemId, asksOf, itemAgreed, consultReply, groupInView, groupsOf, helpAtWord, questionsFor, summarizeChecklist, verseCoverage, verseItemId, withVerseStops, type CheckAnswer, type CheckItem } from "../src/domain/checklist";
import { questionText, shippedWorkflow } from "../src/domain/processes";
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

test("una respuesta dada por error se quita, y la pregunta vuelve a estar por responder", () => {
  const ticked = [say("n3", "sentido", "yes"), say("n3", "util", "yes"), say(verseItemId("2:13"), "cobertura", "yes")];
  assert.equal(stateOf(ticked, "n3"), "ok");
  const taken = [...ticked, say("n3", "util", "yes", { cleared: true })];
  assert.equal(stateOf(taken, "n3"), "pending");
  assert.equal(sum(taken).items.find((row) => row.itemId === "n3")!.answers.util, undefined, "como si no se hubiera respondido");
  assert.equal(stateOf([...taken, say("n3", "util", "yes")], "n3"), "ok", "y se puede volver a marcar");
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
  const most: CheckItem = { id: "m", verseKey: "1:14", text: "Es una metáfora. Traducción alternativa, como en el TPS: [x]", linked: true };
  const plain: CheckItem = { id: "p", verseKey: "1:14", text: "Solo explica. Traducción alternativa: [x]", linked: true };
  const sizes = (item: CheckItem) => groupsOf(questionsFor(item, [most, plain], list)).map((group) => group.rows.length);
  // A figure that the note explains is looked for in the TPL, and what the TPS adds between { } in the notes (26 October).
  assert.deepEqual(sizes(most), [5, 4, 2], "nunca más de cinco a la vez");
  assert.deepEqual(sizes(plain), [3, 1, 2], "la de casi siempre");
  assert.deepEqual(sizes({ ...plain, id: "s", text: "Solo explica.", linked: false }), [2, 1], "sin artículo no se pregunta por él");
  const words = lists("armonizar-palabras");
  assert.equal(words.length, 1, "eran dos sobre los mismos términos");
  assert.deepEqual(words[0]!.checklist!.map((q) => [q.id, q.about]), [["definicion", "tpl"], ["cobertura", "tpl"], ["sugerencia", "tps"]]);
  assert.ok(words[0]!.checklist!.find((q) => q.id === "sugerencia")!.articleFocus?.length, "las sugerencias se leen en su sección del artículo");
});

test("lo que se pregunta una vez por versículo tiene su parada propia, después de su última nota, y cuenta para el avance", () => {
  const walk = withVerseStops(items, questions);
  assert.deepEqual(walk.map((row) => row.id), [...items.filter((row) => row.verseKey === "2:11").map((row) => row.id), "verse:2:11", ...items.filter((row) => row.verseKey === "2:13").map((row) => row.id), "verse:2:13"]);
  assert.deepEqual(questionsFor(walk[0]!, walk, questions).map((q) => q.question.id), ["sentido", "util"], "la primera nota ya no pregunta por el versículo");
  const stop = walk.find((row) => row.stop)!;
  assert.deepEqual(questionsFor(stop, walk, questions).map((q) => [q.question.id, q.answerItemId]), [["cobertura", "verse:2:11"]]);
  const notesOnly = items.flatMap((n) => [say(n.id, "sentido", "yes"), say(n.id, "util", "yes")]);
  const pending = summarizeChecklist({ items: walk, questions, answers: notesOnly });
  assert.equal(pending.complete, false, "falta la parada de cada versículo");
  assert.equal(pending.items.find((row) => row.itemId === "verse:2:11")?.state, "pending");
  const all = summarizeChecklist({ items: walk, questions, answers: [...notesOnly, say(verseItemId("2:11"), "cobertura", "yes"), say(verseItemId("2:13"), "cobertura", "yes")] });
  assert.equal(all.complete, true);
  assert.equal(all.done, walk.length);
  assert.equal(withVerseStops(items, questions.filter((q) => q.per !== "verse")), items, "una lista sin esas preguntas no tiene paradas");
});

test("una pregunta de cada artículo se responde una vez y vale para todas las notas que lo enlazan", () => {
  const qs = [
    { id: "pertinente", text: "¿El artículo enseña la dificultad de la nota?", about: "academia", linked: true as const },
    { id: "publicado", text: "¿El artículo está publicado?", about: "academia", linked: true as const, per: "article" as const },
  ];
  const items: CheckItem[] = [
    { id: "a1", verseKey: "1:1", linked: true, article: "translate/figs-explicit" },
    { id: "a2", verseKey: "1:3", linked: true, article: "translate/figs-explicit" },
    { id: "a3", verseKey: "1:4", linked: false },
  ];
  // The second note answers «publicado» where the first did.
  assert.deepEqual(questionsFor(items[1]!, items, qs).map((row) => row.answerItemId), ["a2", articleItemId("translate/figs-explicit")]);
  assert.deepEqual(questionsFor(items[2]!, items, qs), [], "una nota sin artículo no tiene esas preguntas");
  const answers = [say("a1", "pertinente", "yes"), say(articleItemId("translate/figs-explicit"), "publicado", "yes"), say("a2", "pertinente", "yes")];
  const summary = summarizeChecklist({ items, questions: qs, answers });
  assert.equal(summary.items.find((row) => row.itemId === "a2")!.state, "ok", "la segunda nota no vuelve a preguntar si está publicado");
  assert.equal(summary.complete, true);
  // Said on a note before it was asked once per article: it counts for that note and for the others.
  const before = summarizeChecklist({ items, questions: qs, answers: [say("a1", "pertinente", "yes"), say("a1", "publicado", "yes"), say("a2", "pertinente", "yes")] });
  assert.equal(before.complete, true, "lo respondido nota por nota antes sigue contando");
  // Without the note's own question answered, it is still pending.
  assert.equal(summarizeChecklist({ items, questions: qs, answers: answers.slice(0, 2) }).items.find((row) => row.itemId === "a2")!.state, "pending");
});

test("decidida entre tres: una nota queda resuelta cuando tres personas dicen que está bien, no una", () => {
  const qs = [{ id: "sentido", text: "¿Tiene sentido?" }];
  const items: CheckItem[] = [{ id: "n1", verseKey: "1:1" }];
  const yes = (by: string, at: string): CheckAnswer => ({ itemId: "n1", questionId: "sentido", value: "yes", by, at });
  const run = (answers: CheckAnswer[], me: string) => summarizeChecklist({ items, questions: qs, answers, agreement: { people: 3, proposals: proposalsOf(answers, 3), me } }).items[0]!;
  assert.equal(run([], "ana").turn, "new", "nadie la revisó: está por revisar");
  const one = [yes("ana", "2026-10-21T10:00:00Z")];
  assert.equal(run(one, "ana").state, "pending", "la palabra de una persona no la cierra");
  assert.equal(run(one, "ana").turn, "waiting", "quien ya opinó espera a los demás");
  assert.equal(run(one, "bea").turn, "mine", "a quien no opinó le toca");
  const two = [...one, yes("bea", "2026-10-21T10:05:00Z")];
  assert.equal(run(two, "carla").turn, "mine");
  assert.deepEqual(run(two, "carla").slots!.sentido!.yesBy, ["ana", "bea"]);
  const three = [...two, yes("carla", "2026-10-21T10:10:00Z")];
  assert.equal(run(three, "dina").state, "ok");
  assert.equal(run(three, "dina").turn, "done");
  // The same person twice is one.
  assert.equal(run([...two, yes("ana", "2026-10-21T10:20:00Z")], "carla").state, "pending");
});

test("decidida entre tres: una propuesta abierta la deja en conversación hasta que se decide", () => {
  const qs = [{ id: "sentido", text: "¿Tiene sentido?" }];
  const items: CheckItem[] = [{ id: "n1", verseKey: "1:1" }];
  const p = { id: "pr-1", resource: "notas", where: "1:1", rowId: "n1", field: "Note", before: "a", after: "b" };
  const proposal = proposalAnswer({ itemId: "n1", questionId: "sentido", by: "ana", at: "2026-10-21T10:00:00Z", reason: "", proposal: p });
  const run = (answers: CheckAnswer[], me: string) => summarizeChecklist({ items, questions: qs, answers, agreement: { people: 3, proposals: proposalsOf(answers, 3), me } }).items[0]!;
  // Two more said it is right as it is: the proposal is still to be decided.
  const others = [proposal, { itemId: "n1", questionId: "sentido", value: "yes" as const, by: "bea", at: "2026-10-21T10:05:00Z" }, { itemId: "n1", questionId: "sentido", value: "yes" as const, by: "carla", at: "2026-10-21T10:06:00Z" }];
  assert.equal(run(others, "dina").state, "pending");
  assert.equal(run([proposal], "bea").turn, "mine", "a quien no opinó sobre la propuesta le toca");
  // Two more for it: agreed, and settled.
  const agreed = [proposal, proposalSaying("pr-1", "bea", "2026-10-21T10:05:00Z", true), proposalSaying("pr-1", "carla", "2026-10-21T10:06:00Z", true)];
  assert.equal(run(agreed, "dina").state, "ok");
  // Or two would rather leave it as it is: left aside, and settled too.
  const kept = [proposal, proposalKeeping("pr-1", "bea", "2026-10-21T10:05:00Z", true), proposalKeeping("pr-1", "carla", "2026-10-21T10:06:00Z", true)];
  assert.equal(run(kept, "dina").state, "ok");
  assert.equal(run([proposal, proposalKeeping("pr-1", "bea", "2026-10-21T10:05:00Z", true)], "bea").turn, "waiting");
});

test("en un desacuerdo, cada lado responde al otro: le toca a quien no tuvo la última palabra", () => {
  const qs = [{ id: "sentido", text: "¿Tiene sentido?" }];
  const items: CheckItem[] = [{ id: "n1", verseKey: "1:1" }];
  const p = { id: "pr-2", resource: "notas", where: "1:1", rowId: "n1", field: "Note", before: "a", after: "b" };
  const rows: CheckAnswer[] = [
    proposalAnswer({ itemId: "n1", questionId: "sentido", by: "ana", at: "2026-10-21T10:00:00Z", reason: "", proposal: p }),
    proposalSaying("pr-2", "bea", "2026-10-21T10:05:00Z", true),
    proposalKeeping("pr-2", "carla", "2026-10-21T10:06:00Z", true),
  ];
  const run = (answers: CheckAnswer[], me: string) =>
    summarizeChecklist({ items, questions: qs, answers, agreement: { people: 3, proposals: proposalsOf(answers, 3, () => true, { consensus: true }), me } }).items[0]!;
  assert.equal(run(rows, "dina").state, "pending", "dos de tres no la resuelven");
  assert.equal(run(rows, "dina").slots!.sentido!.disputed.length, 1);
  assert.equal(run(rows, "carla").turn, "waiting", "carla dijo lo último");
  assert.equal(run(rows, "ana").turn, "mine");
  assert.equal(run(rows, "bea").turn, "mine");
  // Ana answers Carla: now it is Carla's turn, not Bea's (who is on Ana's side).
  const answered = [...rows, itemSaying("n1", "ana", "2026-10-21T10:20:00Z", "Porque el hebreo dice «mano».")];
  assert.equal(run(answered, "carla").turn, "mine");
  assert.equal(run(answered, "bea").turn, "waiting");
  // Carla comes round: settled.
  assert.equal(run([...answered, proposalSaying("pr-2", "carla", "2026-10-21T10:30:00Z", true)], "dina").state, "ok");
});

test("acordada en equipo fuera de Taller: la nota queda resuelta sin tres personas ni las preguntas nuevas", () => {
  // Ester (26 October): the team went over chapter 1 together in a spreadsheet; brought in as one person's answers,
  // the step then decided by three, with questions added since, showed the chapter at 0%.
  const qs = [{ id: "sentido", text: "¿Tiene sentido?" }, { id: "figura", text: "¿Explica la figura?" }, { id: "cobertura", text: "¿Cada dificultad tiene su nota?", per: "verse" as const }];
  const items = withVerseStops([{ id: "n1", verseKey: "1:1" }, { id: "n2", verseKey: "1:1" }], qs);
  const migrated: CheckAnswer = { itemId: "n1", questionId: "sentido", value: "yes", by: "abelper8", at: "2026-10-17T10:00:00Z" };
  const agreed = [migrated, itemAgreed("n1", "abelper8", "2026-10-26T10:00:00Z", "Revisada en equipo en la hoja"), itemAgreed(verseItemId("1:1"), "abelper8", "2026-10-26T10:00:00Z", "Revisada en equipo en la hoja")];
  const run = (answers: CheckAnswer[], me = "dina") => summarizeChecklist({ items, questions: qs, answers, agreement: { people: 3, proposals: proposalsOf(answers, 3, () => true, { consensus: true }), me } });
  const tally = (answers: CheckAnswer[], id: string) => run(answers).items.find((row) => row.itemId === id)!;
  assert.equal(tally([migrated], "n1").state, "pending", "sin la marca, la palabra de una persona no la cierra");
  assert.equal(tally(agreed, "n1").state, "ok");
  assert.equal(tally(agreed, "n1").turn, "done", "a nadie le toca");
  assert.equal(tally(agreed, "n1").agreedApart?.note, "Revisada en equipo en la hoja", "la pantalla dice dónde se acordó, no «1/3»");
  assert.equal(tally([migrated], "n1").agreedApart, undefined);
  assert.equal(tally(agreed, verseItemId("1:1")).state, "ok", "la parada del versículo, marcada, también");
  assert.equal(tally(agreed, "n2").state, "pending", "solo la nota marcada");
  assert.equal(run(agreed).done, 2);
  // Somebody proposes something about it afterwards: it is to be decided again.
  const p = { id: "pr-9", resource: "notas", where: "1:1", rowId: "n1", field: "Note", before: "a", after: "b" };
  const reopened = [...agreed, proposalAnswer({ itemId: "n1", questionId: "figura", by: "bea", at: "2026-10-27T10:00:00Z", reason: "", proposal: p })];
  assert.equal(tally(reopened, "n1").state, "pending", "una propuesta abierta la vuelve a abrir");
  // The mark taken back: as before.
  const back = [...agreed, { ...itemAgreed("n1", "abelper8", "2026-10-27T10:00:00Z", ""), cleared: true as const }];
  assert.equal(tally(back, "n1").state, "pending");
  // Decided by one person, it counts too.
  assert.equal(summarizeChecklist({ items, questions: qs, answers: agreed }).items.find((row) => row.itemId === "n1")!.state, "ok");
});

test("una pregunta dice el idioma del proyecto por su nombre, en el idioma de la interfaz", () => {
  const list = shippedWorkflow("fcr-base")!.tasks.find((t) => t.id === "armonizar-notas")!.steps!.find((s) => s.id === "notas-textos")!.checklist!;
  const published = list.find((q) => q.id === "publicado")!;
  assert.equal(questionText(published, "es", "es-419"), "¿El artículo ya está publicado en español?");
  assert.equal(questionText(published, "pt", "es-419"), "O artigo já está publicado em espanhol?");
  assert.equal(questionText(list.find((q) => q.id === "util")!, "es", "es-419"), "¿La nota le sugiere al traductor qué hacer?");
  // Every question of the process is said of what is checked, and none of them is left with a mark unsaid.
  for (const q of list) assert.ok(!/{[a-z]+}/.test(questionText(q, "es", "es-419")), q.id);
});

test("la pregunta del versículo enlazado se hace solo a una nota que remite a otro versículo", () => {
  const list = shippedWorkflow("fcr-base")!.tasks.find((t) => t.id === "armonizar-notas")!.steps!.find((s) => s.id === "notas-textos")!.checklist!;
  const linked = list.find((q) => q.id === "remite")!;
  assert.equal(asksOf(linked, { text: "Vea cómo tradujo esta expresión en [1:10](../01/10.md)." }), true, "otro capítulo");
  assert.equal(asksOf(linked, { text: "Es la misma palabra que en [el versículo 3](./03.md)." }), true, "el mismo capítulo");
  assert.equal(asksOf(linked, { text: "Vea [Metonimia](rc://*/ta/man/translate/figs-metonymy)." }), false, "un artículo no es un versículo");
  assert.equal(asksOf(linked, { text: "Traducción alternativa: “su trono real”." }), false);
});

console.log(`\nverify-checklist: ${passed} checks passed.`);
