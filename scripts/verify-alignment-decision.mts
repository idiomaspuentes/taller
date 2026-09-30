/** A proposal or an objection as a decision of the team: who counts, when it is decided. */
import assert from "node:assert/strict";
import type { AlignmentGroup } from "@usfm-tools/types";
import type { PersonLevel } from "../src/domain/levels";
import { alignmentHash, groupsToLines } from "../src/domain/alignmentHash";
import {
  deadlineFrom,
  latestVotes,
  mayBeNearDeadline,
  newDecisionId,
  optionsFor,
  outcomeOf,
  parseProposalFilename,
  proposalPath,
  reminderDue,
  resultPath,
  settledProposalIds,
  tallyDecision,
  waitingOn,
  type DecisionVote,
  type ResultFile,
} from "../src/domain/alignmentDecision";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const levels: Record<string, PersonLevel> = { ana: "habilitada", bea: "habilitada", carla: "habilitada", dora: "practicante", eva: "aprendiz" };
const now = new Date("2026-10-02T12:00:00Z");
const deadline = deadlineFrom(new Date("2026-10-01T12:00:00Z"));
const vote = (by: string, option: DecisionVote["option"], at = "2026-10-01T13:00:00Z"): DecisionVote => ({ by, option, at });
const base = { kind: "proposal" as const, proposer: "bea", authors: ["ana"], levels, thresholds: { minAgree: 2, minIndependent: 1 }, deadline, now };

test("los archivos de una propuesta tienen rutas legibles y se reconocen por su nombre", () => {
  assert.equal(proposalPath("neh", 1, 1, "bea-lx3k"), "checkings/proposals/NEH.1-1.bea-lx3k.proposal.json");
  assert.equal(resultPath("NEH", 1, 1, "bea-lx3k"), "checkings/proposals/NEH.1-1.bea-lx3k.result.json");
  assert.deepEqual(parseProposalFilename("NEH.1-1.bea-lx3k.result.json"), { book: "NEH", chapter: 1, verse: 1, id: "bea-lx3k", part: "result" });
  assert.equal(parseProposalFilename("NEH.ana.decisions.json"), null);
  assert.match(newDecisionId("Bea_Pérez", new Date(0)), /^beaprez-0$/);
});

test("quien propone apoya su propuesta sin votar, pero no cuenta como independiente", () => {
  const t = tallyDecision({ ...base, votes: [] });
  assert.deepEqual([t.counts.aceptar.agree, t.counts.aceptar.independent], [1, 0]);
  assert.equal(t.state, "abierta");
});

test("se acepta cuando hay el mínimo de habilitadas, con una independiente, y nadie a favor de lo contrario", () => {
  const t = tallyDecision({ ...base, votes: [vote("carla", "aceptar")] });
  assert.equal(t.winner, "aceptar");
  assert.equal(t.state, "decidida");
});

test("quien alineó cuenta para el mínimo pero no como independiente", () => {
  const t = tallyDecision({ ...base, votes: [vote("ana", "aceptar")] });
  assert.equal(t.counts.aceptar.agree, 2);
  assert.equal(t.counts.aceptar.independent, 0);
  assert.equal(t.winner, undefined, "falta una persona independiente");
});

test("un voto en contra impide que se decida a favor", () => {
  const t = tallyDecision({ ...base, votes: [vote("carla", "aceptar"), vote("ana", "rechazar")] });
  assert.equal(t.winner, undefined);
  assert.equal(t.state, "abierta");
});

test("se rechaza cuando el mínimo de habilitadas, con una independiente, lo pide y nadie más apoya la propuesta", () => {
  const t = tallyDecision({ ...base, votes: [vote("carla", "rechazar"), vote("ana", "rechazar")] });
  assert.equal(t.winner, "rechazar");
});

test("solo cuenta el último voto de cada persona", () => {
  const votes = [vote("carla", "rechazar", "2026-10-01T13:00:00Z"), vote("carla", "aceptar", "2026-10-01T14:00:00Z")];
  assert.deepEqual(latestVotes(votes).map((v) => v.option), ["aceptar"]);
  assert.equal(tallyDecision({ ...base, votes }).winner, "aceptar");
});

test("los votos de quien no es habilitada se ven pero no cuentan para el mínimo", () => {
  const t = tallyDecision({ ...base, votes: [vote("dora", "aceptar"), vote("eva", "aceptar")] });
  assert.equal(t.counts.aceptar.agree, 1);
  assert.deepEqual(t.counts.aceptar.people, ["bea", "dora", "eva"]);
  assert.equal(t.winner, undefined);
});

test("quien propone no puede votar contra su propia propuesta", () => {
  const t = tallyDecision({ ...base, votes: [vote("bea", "rechazar"), vote("carla", "aceptar")] });
  assert.equal(t.winner, "aceptar");
  assert.equal(t.counts.rechazar.people.length, 0);
});

test("pasado el plazo sin consenso queda esperando a quien coordina", () => {
  const t = tallyDecision({ ...base, votes: [vote("ana", "rechazar")], now: new Date("2026-10-05T00:00:00Z") });
  assert.equal(t.state, "plazo");
});

test("una objeción usa sus propias opciones y nunca aplica una alineación", () => {
  assert.deepEqual(optionsFor("objection"), { yes: "cambiar", no: "mantener" });
  const t = tallyDecision({ ...base, kind: "objection", votes: [vote("carla", "cambiar")] });
  assert.equal(t.winner, "cambiar");
  assert.equal(outcomeOf("objection", "cambiar"), "realinear");
  assert.equal(outcomeOf("objection", "mantener"), "mantenida");
  assert.equal(outcomeOf("proposal", "aceptar"), "aceptada");
});

test("a quién falta preguntar: habilitadas del equipo que no votaron y no propusieron", () => {
  assert.deepEqual(waitingOn({ team: ["ana", "bea", "carla", "dora"], levels, votes: [vote("ana", "aceptar")], proposer: "bea" }), ["carla"]);
});

test("rechazar, mantener o caducar sueltan la respuesta abierta de quien propuso; aceptar o realinear no", () => {
  const r = (id: string, outcome: ResultFile["outcome"]): ResultFile => ({ schema: "gateway-alignment-result-1", id, kind: "proposal", book: "NEH", chapter: 1, verse: 1, outcome, by: "x", how: "consenso", at: "t", proposer: "bea", baseHash: "h" });
  assert.deepEqual([...settledProposalIds([r("a", "rechazada"), r("b", "aceptada"), r("c", "mantenida"), r("d", "realinear"), r("e", "caducada")])].sort(), ["a", "c", "e"]);
});

test("la huella no cambia por la puntuación de las palabras pero sí por cualquier unión", () => {
  const g = (word: string): AlignmentGroup[] => [{ sources: [{ strong: "H1", lemma: "x", content: "דבר", occurrence: 1, occurrences: 1 }], targets: [{ word, occurrence: 1, occurrences: 1 }] }];
  assert.equal(alignmentHash(["Las", "palabras,"], g("palabras,")), alignmentHash(["Las", "palabras"], g("palabras")));
  assert.notEqual(alignmentHash(["Las", "palabras"], g("palabras")), alignmentHash(["Las", "palabras"], g("Las")));
  assert.deepEqual(groupsToLines(g("Las")), ["דבר → Las"]);
});

test("el recordatorio automático: solo si falta alguien, el plazo está a menos de un día o pasó, y no hubo otro en el último día", () => {
  const deadline = "2026-10-04T12:00:00Z";
  const due = (nowIso: string, waiting: string[], last?: string) => reminderDue({ deadline, now: new Date(nowIso), waiting, lastReminderAt: last });
  assert.equal(due("2026-10-02T11:00:00Z", ["ana"]), null, "a más de un día: todavía no");
  assert.equal(due("2026-10-03T13:00:00Z", ["ana"]), "cerca", "a menos de un día");
  assert.equal(due("2026-10-03T13:00:00Z", []), null, "ya votaron todas");
  assert.equal(due("2026-10-03T13:00:00Z", ["ana"], "2026-10-03T02:00:00Z"), null, "hubo uno hace 11 horas");
  assert.equal(due("2026-10-03T13:00:00Z", ["ana"], "2026-10-02T12:00:00Z"), "cerca", "el anterior fue hace más de un día");
  assert.equal(due("2026-10-04T13:00:00Z", ["ana"]), "vencido", "pasó el plazo");
  assert.equal(due("2026-10-04T13:00:00Z", ["ana"], "2026-10-04T12:30:00Z"), null, "aun vencido, no más de uno al día");
});

test("solo se lee el hilo de una decisión que puede estar cerca del plazo", () => {
  assert.equal(mayBeNearDeadline("2026-10-01T12:00:00Z", new Date("2026-10-01T20:00:00Z")), false);
  assert.equal(mayBeNearDeadline("2026-10-01T12:00:00Z", new Date("2026-10-03T12:00:00Z")), true, "a los 2 días queda 1");
  assert.equal(mayBeNearDeadline(undefined, new Date()), false);
});

console.log(`\nverify-alignment-decision: ${passed} checks passed.`);
