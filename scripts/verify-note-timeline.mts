/**
 * The conversation of a note (27 October): the messages of everybody and, as short lines, what each person did,
 * in the order it happened, each with the step it is about; and where what is new for the person looking begins.
 */
import assert from "node:assert/strict";
import { itemSaying, proposalAnswer, proposalsOf, type ProposalPayload } from "../src/domain/checkProposal";
import type { CheckAnswer } from "../src/domain/checklist";
import { noteTimeline, type NoteStep } from "../src/domain/noteTimeline";
import { proposalMark } from "../src/domain/singleProposal";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const T = (hhmm: string) => `2026-10-28T${hhmm}:00Z`;
const steps: NoteStep[] = [
  { about: "tpl", rows: [{ answerItemId: "n1", questionId: "tpl1" }, { answerItemId: "n1", questionId: "tpl2" }] },
  { about: "tps", rows: [{ answerItemId: "n1", questionId: "tps1" }] },
];
const rule = { consensus: true, questionsOf: () => ["tpl1", "tpl2", "tps1"] };
const yes = (by: string, questionId: string, time: string): CheckAnswer => ({ itemId: "n1", questionId, value: "yes", by, at: time });
const P = (id: string, after: string, extra: Partial<ProposalPayload> = {}): ProposalPayload => ({ id, resource: "notas", where: "1:1", rowId: "n1", field: "Note", before: "a", after, ...extra });
const proposed = (by: string, time: string, payload: ProposalPayload) => proposalAnswer({ itemId: "n1", questionId: "tpl1", by, at: time, reason: "", proposal: payload });
const timeline = (me: string, answers: CheckAnswer[]) => noteTimeline({ me, itemId: "n1", answers, proposals: proposalsOf(answers, 3, () => true, rule), steps });

test("los mensajes y lo que cada quien hizo, en el orden en que pasó", () => {
  const answers = [
    proposed("ana", T("10:00"), P("pr-a", "b")),
    itemSaying("n1", "bea", T("10:05"), "¿Y si decimos «se calmó» al principio?", undefined, "tpl"),
    proposed("bea", T("10:10"), P("aj-1", "c", { suggests: "pr-a" })),
    proposed("ana", T("10:20"), P("pr-a2", "c", { replaces: "pr-a", accepts: "aj-1", adjustedBy: "bea" })),
    proposalMark("pr-a2", "tpl1", "carla", T("10:30"), "yes"),
    proposalMark("pr-a2", "tpl2", "carla", T("10:31"), "yes"),
  ];
  assert.deepEqual(timeline("carla", answers).entries.map((entry) => entry.kind), ["proposed", "message", "suggested", "accepted", "agreed"]);
  const agreed = timeline("carla", answers).entries.at(-1)!;
  assert.equal(agreed.kind === "agreed" ? agreed.step : "", "tpl");
});

test("cada mensaje lleva su paso, y uno antiguo ninguno", () => {
  const entries = timeline("ana", [itemSaying("n1", "bea", T("10:00"), "uno", undefined, "tps"), itemSaying("n1", "bea", T("10:01"), "dos")]).entries;
  assert.equal(entries[0]!.kind === "message" ? entries[0]!.step : "", "tps");
  assert.equal(entries[1]!.kind === "message" ? entries[1]!.step : "x", undefined);
});

test("la primera revisión de un paso dice revisó; las siguientes, está de acuerdo", () => {
  const entries = timeline("carla", [yes("ana", "tpl1", T("10:00")), yes("ana", "tpl2", T("10:01")), yes("bea", "tpl1", T("10:10")), yes("bea", "tpl2", T("10:11"))]).entries;
  assert.deepEqual(entries.map((entry) => (entry.kind === "reviewed" ? [entry.by, entry.step, entry.first, entry.at] : [])), [["ana", "tpl", true, T("10:01")], ["bea", "tpl", false, T("10:11")]]);
});

test("un no a la propuesta se dice en la conversación", () => {
  const entries = timeline("ana", [proposed("ana", T("10:00"), P("pr-a", "b")), proposalMark("pr-a", "tps1", "bea", T("10:10"), "no", "no dice lo mismo que el TPS")]).entries;
  assert.deepEqual(entries.map((entry) => entry.kind), ["proposed", "saidNo"]);
  const no = entries[1]!;
  assert.equal(no.kind === "saidNo" ? no.step : "", "tps");
});

test("lo nuevo para ti empieza después de lo último que hiciste", () => {
  const answers = [itemSaying("n1", "bea", T("10:00"), "¿Hace falta?"), itemSaying("n1", "ana", T("10:05"), "Creo que sí"), itemSaying("n1", "ana", T("10:06"), "Por el TPS")];
  assert.equal(timeline("bea", answers).newFrom, 1);
  assert.equal(timeline("ana", answers).newFrom, -1, "lo último es suyo: nada nuevo");
});

test("quien no ha hecho nada no tiene marca de nuevo", () => {
  assert.equal(timeline("carla", [itemSaying("n1", "bea", T("10:00"), "¿Hace falta?")]).newFrom, -1);
});

console.log(`\nverify-note-timeline: ${passed} checks passed.`);
