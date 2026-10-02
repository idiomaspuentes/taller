/**
 * A review closes by consensus: every item agreed, by the answers or by the team's final decision. A step that closes
 * that way is not completed by pressing «Aprobar».
 */
import assert from "node:assert/strict";
import { confirmersOf, type LevelBook, type PersonLevel } from "../src/domain/levels";
import { summarizeRound, tallyItem, type ReviewDecision } from "../src/domain/reviewRound";
import { approveStep, canApproveStep, claimStep, closesInItsTool, isStepComplete } from "../src/domain/stepClaim";
import { emptyTaskProgress, markStepDone } from "../src/domain/taskProgress";
import type { TaskStep } from "../src/domain/types";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const levels: Record<string, PersonLevel> = { elena: "habilitada", tomas: "habilitada", priscila: "habilitada", mateo: "practicante" };
const thresholds = { minAgree: 2, minIndependent: 2 };
let clock = 0;
const answer = (reviewer: string, status: ReviewDecision["status"], extra: Partial<ReviewDecision> = {}): ReviewDecision =>
  ({
    itemId: "n1",
    ref: { start: { chapter: 2, verse: 13 } },
    sessionId: "1",
    stageId: "x",
    status,
    reviewer,
    timestamp: new Date(Date.UTC(2026, 9, 1, 10, clock++)).toISOString(),
    textHash: "h1",
    ...extra,
  }) as ReviewDecision;
const tally = (decisions: ReviewDecision[], confirmers = ["ruben", "elena"], currentHash = "h1") =>
  tallyItem({ itemId: "n1", decisions, currentHash, levels, authors: [], thresholds, confirmers });

test("si todas las personas están de acuerdo, el ítem queda de acuerdo sin reunión", () => {
  const t = tally([answer("elena", "approved"), answer("tomas", "approved")]);
  assert.equal(t.state, "agreed");
  assert.equal(t.decided, undefined);
});

test("con una objeción abierta el ítem queda en disputa, aunque haya acuerdos de sobra", () => {
  const t = tally([answer("elena", "approved"), answer("tomas", "approved"), answer("priscila", "rejected", { note: "No es la construcción griega" })]);
  assert.equal(t.state, "disputed");
  assert.deepEqual(t.open, ["priscila"]);
});

test("la decisión final del coordinador resuelve lo que estaba en disputa, y queda quién y qué se acordó", () => {
  const t = tally([
    answer("elena", "approved"),
    answer("priscila", "rejected"),
    answer("ruben", "approved", { final: true, note: "En reunión: se usa «nuestro gran Dios y Salvador»" }),
  ]);
  assert.equal(t.state, "agreed");
  assert.equal(t.decided?.by, "ruben");
  assert.match(t.decided?.note ?? "", /En reunión/);
  assert.deepEqual(t.open, []);
});

test("también una persona habilitada del equipo puede registrar la decisión final", () => {
  const t = tally([answer("priscila", "rejected"), answer("elena", "approved", { final: true, note: "Acordado" })]);
  assert.equal(t.state, "agreed");
  assert.equal(t.decided?.by, "elena");
});

test("la «decisión final» de quien no puede confirmar es una respuesta más", () => {
  const t = tally([answer("priscila", "rejected"), answer("mateo", "approved", { final: true, note: "Yo decido" })]);
  assert.equal(t.state, "disputed");
  assert.equal(t.decided, undefined);
});

test("una objeción posterior a la decisión final vuelve a abrir el ítem", () => {
  const t = tally([answer("priscila", "rejected"), answer("ruben", "approved", { final: true, note: "Acordado" }), answer("tomas", "rejected", { note: "Sigo sin estar de acuerdo" })]);
  assert.equal(t.state, "disputed");
  assert.deepEqual(t.open, ["priscila", "tomas"].filter((who) => t.open.includes(who)));
  assert.ok(t.open.includes("tomas"));
});

test("si el texto cambia después, la decisión final deja de valer: se decidió sobre otro texto", () => {
  const t = tally([answer("priscila", "rejected"), answer("ruben", "approved", { final: true, note: "Acordado" })], ["ruben"], "h2");
  assert.notEqual(t.state, "agreed");
  assert.equal(t.decided, undefined);
});

test("la ronda está completa cuando todos los ítems están de acuerdo, por respuestas o por decisión", () => {
  const decisions = [
    answer("elena", "approved", { itemId: "a" }),
    answer("tomas", "approved", { itemId: "a" }),
    answer("elena", "approved", { itemId: "b" }),
    answer("priscila", "revise", { itemId: "b", note: "Otro orden" }),
  ];
  const round = (list: ReviewDecision[]) => summarizeRound({ itemIds: ["a", "b"], decisions: list, currentHashes: { a: "h1", b: "h1" }, levels, authors: [], thresholds, confirmers: ["ruben"] });
  const open = round(decisions);
  assert.equal(open.complete, false);
  assert.deepEqual(open.meeting.map((i) => i.itemId), ["b"], "la lista para la reunión es lo que quedó sin acuerdo");
  const closed = round([...decisions, answer("ruben", "approved", { itemId: "b", final: true, note: "Se deja el orden actual" })]);
  assert.equal(closed.complete, true);
});

test("quién puede confirmar: los coordinadores del equipo y sus personas habilitadas", () => {
  const book: LevelBook = { levels: {}, teamLevels: { afinadores: { elena: "habilitada", mateo: "practicante" } }, coordinators: { afinadores: ["ruben"] } };
  assert.deepEqual(confirmersOf(book, "Afinadores").sort(), ["elena", "ruben"]);
  assert.deepEqual(confirmersOf(book, "otro"), []);
});

// ---------------------------------------------------------------- the step
const round: TaskStep = { id: "notas", name: "Desafíos", solverAppId: "tool", closing: "consensus", claimMode: "pool", minAssignees: 2, maxAssignees: 3 };
const agreement: TaskStep = { id: "acuerdo", name: "Acuerdo del equipo", closing: "consensus", claimMode: "pool", minAssignees: 2, maxAssignees: 4 };
const legacy: TaskStep = { id: "grupal", name: "Revisión grupal", claimMode: "pool", minAssignees: 2, maxAssignees: 3 };
const seat = (step: TaskStep, logins: string[]) => logins.reduce((p, login) => claimStep(p, step, login), emptyTaskProgress());

test("un paso de consenso con herramienta no se completa con «Aprobar»: lo completa la herramienta", () => {
  assert.equal(closesInItsTool(round), true);
  let progress = seat(round, ["elena", "tomas"]);
  assert.equal(canApproveStep("elena", progress, round), false);
  progress = approveStep(approveStep(progress, round, "elena"), round, "tomas");
  assert.equal(isStepComplete(progress, round), false);
  assert.equal(isStepComplete(markStepDone(progress, round.id), round), true, "la herramienta lo marca hecho cuando todo está de acuerdo");
});

test("un acuerdo del equipo (consenso sin herramienta) pide el sí de todas las personas sentadas, no solo del mínimo", () => {
  assert.equal(closesInItsTool(agreement), false);
  let progress = seat(agreement, ["marcos", "dina", "josue"]);
  progress = approveStep(approveStep(progress, agreement, "marcos"), agreement, "dina");
  assert.equal(isStepComplete(progress, agreement), false, "falta una persona sentada");
  progress = approveStep(progress, agreement, "josue");
  assert.equal(isStepComplete(progress, agreement), true);
});

test("un paso de un plan antiguo, sin regla de cierre, se completa como antes: con el mínimo de aprobaciones", () => {
  let progress = seat(legacy, ["a", "b", "c"]);
  progress = approveStep(approveStep(progress, legacy, "a"), legacy, "b");
  assert.equal(isStepComplete(progress, legacy), true);
});

console.log(`\nverify-consensus: ${passed} checks passed.`);
