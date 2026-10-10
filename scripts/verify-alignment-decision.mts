/** A proposal or an objection as a decision of the team: who counts, when it is decided. */
import { buildCloseEvent, buildDecisionEvent, toldOf, type DecisionEventData } from "../src/domain/chatEvents/alineacionDecision";
import assert from "node:assert/strict";
import type { AlignmentGroup } from "@usfm-tools/types";
import type { PersonLevel } from "../src/domain/levels";
import { alignmentHash, groupsToLines } from "../src/domain/alignmentHash";
import {
  deadlineFrom,
  decisionLevels,
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

test("pasado el plazo, una propuesta se acepta con dos personas de fuera, o con las que el equipo pida si son menos", () => {
  const late = new Date("2026-10-05T00:00:00Z");
  const many = { ...base, thresholds: { minAgree: 5, minIndependent: 3 }, levels: { ...levels, dora: "habilitada" as const, eva: "habilitada" as const } };
  // Cinco acuerdos y tres de fuera es mucho para un equipo que no contesta: con el plazo cumplido bastan dos de fuera.
  assert.equal(tallyDecision({ ...many, votes: [vote("carla", "aceptar"), vote("dora", "aceptar")] }).state, "abierta", "antes del plazo, dos no alcanzan");
  const two = tallyDecision({ ...many, votes: [vote("carla", "aceptar"), vote("dora", "aceptar")], now: late });
  assert.equal(two.winner, "aceptar");
  assert.equal(two.state, "decidida");
  assert.equal(tallyDecision({ ...many, votes: [vote("carla", "aceptar")], now: late }).state, "plazo", "una sola de fuera no basta donde el equipo pide más");
  // Quien alineó el versículo no es de fuera, y quien propone tampoco.
  assert.equal(tallyDecision({ ...many, votes: [vote("ana", "aceptar"), vote("carla", "aceptar")], now: late }).state, "plazo");
  // Con alguien en contra no se aplica sola: espera a quien coordina.
  assert.equal(tallyDecision({ ...many, votes: [vote("carla", "aceptar"), vote("dora", "aceptar"), vote("eva", "rechazar")], now: late }).state, "plazo");
  // Donde el equipo pide una sola persona de fuera, pasado el plazo sigue bastando una.
  const few = { ...base, thresholds: { minAgree: 4, minIndependent: 1 } };
  assert.equal(tallyDecision({ ...few, votes: [vote("carla", "aceptar")], now: late }).winner, "aceptar");
  // Una objeción no cambia el texto: pasado el plazo sigue esperando a quien coordina.
  assert.equal(tallyDecision({ ...many, kind: "objection", votes: [vote("carla", "cambiar"), vote("dora", "cambiar")], now: late }).state, "plazo");
});

test("abrir una propuesta y aplicarla avisa a todo el equipo, a cada persona una vez y no a quien lo hace", () => {
  const data = { id: "x1", kind: "proposal", book: "JON", chapter: 2, verse: 5, by: "bea", aligners: ["ana"], tell: ["Ana", "bea", "carla", "dora"], deadline, oldText: "a", newText: "b" } as unknown as DecisionEventData;
  assert.deepEqual(toldOf(data, "bea"), ["ana", "carla", "dora"]);
  assert.deepEqual(buildDecisionEvent(data, 7).mentions, ["ana", "carla", "dora"], "al abrirla: quien alineó y el equipo, no quien la propone");
  assert.deepEqual(buildCloseEvent({ issue: 7, data, outcome: "aceptada", how: "consenso", by: "carla" }).mentions, ["bea", "ana", "dora"], "al aplicarla: quien la propuso, quien alineó y el equipo, no quien la confirma");
  assert.deepEqual(buildCloseEvent({ issue: 7, data, outcome: "aceptada", how: "consenso", by: "bea" }).mentions, ["ana", "carla", "dora"], "quien la propuso también puede aplicarla");
  // Una decisión abierta antes de esto no dice a quién avisar: se avisa a quien ya se avisaba.
  assert.deepEqual(toldOf({ by: "bea", aligners: ["ana"], tell: undefined as unknown as string[] }, "carla"), ["bea", "ana"]);
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

test("cuentan los niveles del equipo que tiene la tarea, no los generales de la organización", () => {
  // The organization has nobody enabled as a whole; the team that aligns has its own ladder.
  const book = { levels: { rut: "aprendiz" as PersonLevel }, teamLevels: { "afinadores tpl": { tomas: "habilitada", priscila: "habilitada", ruben: "habilitada", elena: "practicante" } as Record<string, PersonLevel> } };
  const votes: DecisionVote[] = [
    { by: "priscila", option: "aceptar", at: "2026-10-07T01:15:00Z" },
    { by: "ruben", option: "aceptar", at: "2026-10-07T01:16:00Z" },
  ];
  const tally = (levels: Record<string, PersonLevel>) =>
    tallyDecision({ kind: "proposal", votes, proposer: "tomas", authors: ["elena"], levels, thresholds: { minAgree: 2, minIndependent: 2 }, deadline: "2026-10-10T00:00:00Z", now: new Date("2026-10-07T02:00:00Z") });
  assert.equal(tally(decisionLevels(book, "Afinadores TPL")).winner, "aceptar", "tres habilitadas del equipo, dos de ellas independientes");
  assert.equal(tally(book.levels).winner, undefined, "con los niveles generales nadie del equipo contaba");
  assert.deepEqual(decisionLevels(book, "Otro equipo"), book.levels, "un equipo sin niveles propios usa los generales");
  assert.deepEqual(decisionLevels(null, "Afinadores TPL"), {});
});

console.log(`\nverify-alignment-decision: ${passed} checks passed.`);
