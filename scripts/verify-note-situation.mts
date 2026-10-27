/**
 * The situation of a step of a note for whoever looks at it (27 October): whether they open it, confirm what
 * somebody reviewed, review somebody's proposal (or see their own), or are asked something; and what agreeing writes.
 */
import assert from "node:assert/strict";
import { itemSaying, proposalAnswer, proposalSaying, proposalsOf, type ProposalPayload, type ProposalView } from "../src/domain/checkProposal";
import type { CheckAnswer } from "../src/domain/checklist";
import { agreementRows, noteSituation, type StepRow } from "../src/domain/noteSituation";
import { PROPOSAL_SAYS } from "../src/domain/checkProposal";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const T = (hhmm: string, day = "28") => `2026-10-${day}T${hhmm}:00Z`;
const tpl: StepRow[] = [{ answerItemId: "n1", questionId: "tpl1" }, { answerItemId: "n1", questionId: "tpl2" }];
const tps: StepRow[] = [{ answerItemId: "n1", questionId: "tps1" }];
const rule = { consensus: true, questionsOf: () => ["tpl1", "tpl2", "tps1"] };
const yes = (by: string, questionId: string, time: string): CheckAnswer => ({ itemId: "n1", questionId, value: "yes", by, at: time });
const P = (id: string, after: string, extra: Partial<ProposalPayload> = {}): ProposalPayload => ({ id, resource: "notas", where: "1:1", rowId: "n1", field: "Note", before: "a", after, ...extra });
const proposed = (by: string, time: string, payload: ProposalPayload, questionId = "tpl1") => proposalAnswer({ itemId: "n1", questionId, by, at: time, reason: "", proposal: payload });
const optionsOf = (answers: CheckAnswer[]): ProposalView[] => proposalsOf(answers, 3, () => true, rule).filter((view) => !view.adjusts && view.state !== "replaced" && view.state !== "withdrawn");
const situation = (me: string, answers: CheckAnswer[], stepRows = tpl) => noteSituation({ me, itemId: "n1", stepRows, answers, options: optionsOf(answers) });

test("nadie dijo nada: la abres tú", () => {
  assert.equal(situation("bea", []).kind, "first");
});

test("Ana dijo que sí a todo el TPL: Bea confirma en el TPL y abre el TPS", () => {
  const answers = [yes("ana", "tpl1", T("10:00")), yes("ana", "tpl2", T("10:01"))];
  const inTpl = situation("bea", answers);
  assert.equal(inTpl.kind, "confirm");
  assert.deepEqual(inTpl.kind === "confirm" ? inTpl.by : [], ["ana"]);
  assert.equal(situation("bea", answers, tps).kind, "first");
  assert.equal(situation("ana", answers).kind, "first", "lo suyo no se lo confirma a sí misma");
});

test("Ana dijo que sí a una sola pregunta del TPL: Bea todavía la abre", () => {
  assert.equal(situation("bea", [yes("ana", "tpl1", T("10:00"))]).kind, "first");
});

test("una propuesta de Ana: Bea la revisa en todos los pasos y Ana la ve como suya", () => {
  const answers = [proposed("ana", T("10:00"), P("pr-a", "b"))];
  const inTpl = situation("bea", answers);
  assert.equal(inTpl.kind, "proposal");
  assert.equal(inTpl.kind === "proposal" ? inTpl.author : "", "ana");
  assert.equal(inTpl.kind === "proposal" ? inTpl.since : "", T("10:00"));
  assert.equal(situation("bea", answers, tps).kind, "proposal");
  assert.equal(situation("ana", answers).kind, "ownProposal");
});

test("un mensaje de Ana sin respuesta: a Bea le preguntan", () => {
  const asked = [itemSaying("n1", "ana", T("10:00"), "¿Hace falta decir cuánto tiempo pasó?")];
  const forBea = situation("bea", asked);
  assert.equal(forBea.kind, "asked");
  assert.equal(forBea.kind === "asked" ? forBea.text : "", "¿Hace falta decir cuánto tiempo pasó?");
  assert.equal(situation("bea", [...asked, itemSaying("n1", "bea", T("10:05"), "Creo que no")]).kind, "first", "Bea ya respondió");
  assert.equal(situation("bea", [...asked, yes("bea", "tpl1", T("10:05"))]).kind, "first", "una marca de Bea también es responder");
  assert.equal(situation("ana", asked).kind, "first", "lo que uno escribió no le pregunta a uno mismo");
});

test("con una propuesta y una pregunta, lo primero es responder, y lo que se revisa sigue siendo la propuesta", () => {
  const answers = [proposed("ana", T("10:00"), P("pr-a", "b")), itemSaying("n1", "ana", T("10:05"), "¿Se entiende?")];
  const forBea = situation("bea", answers);
  assert.equal(forBea.kind, "asked");
  assert.equal(forBea.kind === "asked" ? forBea.head?.proposal.id : "", "pr-a");
  assert.equal(forBea.kind === "asked" ? forBea.author : "", "ana");
});

test("dos propuestas de antes son opciones, como hoy", () => {
  const answers = [proposed("ana", T("10:00", "21"), P("pr-a", "b")), proposed("carla", T("10:10", "21"), P("pr-b", "c"))];
  assert.equal(situation("bea", answers).kind, "options");
});

test("estar de acuerdo con Ana escribe sí en cada punto del paso", () => {
  const answers = [yes("ana", "tpl1", T("10:00")), yes("ana", "tpl2", T("10:01"))];
  const rows = agreementRows({ me: "bea", at: T("11:00"), situation: situation("bea", answers), stepRows: tpl, proposalQuestions: [] });
  assert.deepEqual(rows.map((row) => [row.itemId, row.questionId, row.value, row.by]), [["n1", "tpl1", "yes", "bea"], ["n1", "tpl2", "yes", "bea"]]);
});

test("estar de acuerdo con la propuesta marca la versión; la autora no marca la pregunta donde nació", () => {
  const answers = [proposed("ana", T("10:00"), P("pr-a", "b"), "tpl1")];
  const forBea = agreementRows({ me: "bea", at: T("11:00"), situation: situation("bea", answers), stepRows: tpl, proposalQuestions: ["tpl1", "tpl2", "tps1"] });
  assert.deepEqual(forBea.map((row) => [row.itemId, row.questionId, row.value]), [["pr-a", "tpl1", "yes"], ["pr-a", "tpl2", "yes"]]);
  const forAna = agreementRows({ me: "ana", at: T("11:00"), situation: situation("ana", answers), stepRows: tpl, proposalQuestions: ["tpl1", "tpl2", "tps1"] });
  assert.deepEqual(forAna.map((row) => [row.itemId, row.questionId]), [["pr-a", "tpl2"]]);
});

test("con una propuesta de antes, estar de acuerdo dice sí también a lo que la propuesta no responde", () => {
  const answers = [proposed("ana", T("10:00", "21"), P("pr-a", "b"), "tpl1")];
  const rows = agreementRows({ me: "bea", at: T("11:00"), situation: situation("bea", answers), stepRows: tpl, proposalQuestions: ["tpl1", "tpl2", "tps1"] });
  assert.deepEqual(rows.map((row) => [row.itemId, row.questionId, row.value]), [["pr-a", "tpl1", "yes"], ["pr-a", "tpl2", "yes"], ["n1", "tpl2", "yes"]]);
});

test("una propuesta sin preguntas se apoya como antes", () => {
  const answers = [proposed("ana", T("10:00"), P("pr-a", "b"))];
  const rows = agreementRows({ me: "bea", at: T("11:00"), situation: situation("bea", answers), stepRows: tpl, proposalQuestions: [] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.questionId, PROPOSAL_SAYS);
  assert.equal(rows[0]!.itemId, "pr-a");
  assert.equal(rows[0]!.value, "yes");
  assert.equal(proposalSaying("pr-a", "bea", T("11:00"), true).questionId, rows[0]!.questionId);
});

test("un mensaje guarda el paso del que habla", () => {
  assert.equal(itemSaying("n1", "ana", T("10:00"), "hola", undefined, "tpl").step, "tpl");
  assert.equal(itemSaying("n1", "ana", T("10:00"), "hola").step, undefined);
});

console.log(`\nverify-note-situation: ${passed} checks passed.`);
