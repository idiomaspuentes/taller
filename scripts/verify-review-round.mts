/**
 * Consensus of an asynchronous review round: who counts, when an item is
 * agreed, what goes to the meeting. Afinación of one chapter is the example.
 */
import assert from "node:assert/strict";
import type { CheckingDecisionsFile } from "@usfm-tools/types";
import {
  decisionsFilePath,
  mergeDecisionFiles,
  reviewersToNotifyAfterEdit,
  summarizeRound,
  tallyItem,
  textFingerprint,
  type ReviewDecision,
} from "../src/domain/reviewRound";
import type { PersonLevel } from "../src/domain/levels";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const levels: Record<string, PersonLevel> = {
  ana: "habilitada",
  bea: "habilitada",
  carla: "habilitada",
  dora: "practicante",
  eva: "aprendiz",
};
const thresholds = { minAgree: 3, minIndependent: 2 };
const authors = ["ana"]; // Ana wrote the draft

let t = 0;
function answer(reviewer: string, itemId: string, status: string, o: { hash?: string; note?: string } = {}): ReviewDecision {
  t += 1;
  return {
    itemId,
    reviewer,
    status,
    note: o.note,
    textHash: o.hash,
    ref: { start: { chapter: 1, verse: 2 } },
    sessionId: "s1",
    stageId: "afinacion",
    timestamp: new Date(Date.UTC(2026, 9, 1, 12, t)).toISOString(),
  } as ReviewDecision;
}
const tally = (decisions: ReviewDecision[], extra: { currentHash?: string } = {}) =>
  tallyItem({ itemId: "n1", decisions, levels, authors, thresholds, ...extra });

test("con el mínimo de habilitadas, dos de ellas independientes, el elemento queda acordado", () => {
  const r = tally([answer("ana", "n1", "approved"), answer("bea", "n1", "approved"), answer("carla", "n1", "approved")]);
  assert.equal(r.state, "agreed");
  assert.deepEqual([r.agree, r.agreeIndependent], [3, 2]);
});

test("quien redactó opina pero no cuenta como independiente", () => {
  const r = tally([answer("ana", "n1", "approved"), answer("bea", "n1", "approved")]);
  assert.equal(r.state, "pending", "faltan personas");
  const only = tally([answer("ana", "n1", "approved"), answer("bea", "n1", "approved"), answer("ana2", "n1", "approved")]);
  assert.equal(only.agree, 2, "quien no tiene nivel registrado no cuenta para el mínimo");
});

test("practicantes y aprendices pueden opinar, pero no suman al mínimo", () => {
  const r = tally([
    answer("ana", "n1", "approved"),
    answer("bea", "n1", "approved"),
    answer("dora", "n1", "approved"),
    answer("eva", "n1", "approved"),
  ]);
  assert.equal(r.agree, 2);
  assert.equal(r.state, "pending");
});

test("una objeción o un cambio propuesto abiertos impiden el acuerdo y pasan a la reunión", () => {
  const r = tally([
    answer("ana", "n1", "approved"),
    answer("bea", "n1", "approved"),
    answer("carla", "n1", "approved"),
    answer("dora", "n1", "rejected", { note: "«esperanza» no encaja aquí" }),
  ]);
  assert.equal(r.state, "disputed");
  assert.deepEqual(r.open, ["dora"], "también objeta quien aún no cuenta para el mínimo");
});

test("cuenta la última respuesta de cada persona: quien cambia de parecer resuelve su objeción", () => {
  const r = tally([
    answer("ana", "n1", "approved"),
    answer("bea", "n1", "rejected"),
    answer("bea", "n1", "approved", { note: "ya lo vi con Carla" }),
    answer("carla", "n1", "approved"),
    answer("dora", "n1", "approved"),
    answer("eva", "n1", "approved"),
  ]);
  assert.equal(r.state, "agreed");
  assert.equal(r.answers.filter((a) => a.reviewer === "bea").length, 1);
});

test("si el texto cambió, las respuestas anteriores quedan como historial y hay que volver a revisar", () => {
  const hash = textFingerprint("con la esperanza de la vida eterna");
  const before = [
    answer("ana", "n1", "approved", { hash }),
    answer("bea", "n1", "approved", { hash }),
    answer("carla", "n1", "approved", { hash }),
  ];
  assert.equal(tally(before, { currentHash: hash }).state, "agreed");
  const after = tally(before, { currentHash: textFingerprint("con la confianza de la vida eterna") });
  assert.equal(after.state, "pending");
  assert.equal(after.stale.length, 3);
  assert.equal(after.answers.length, 0);
});

test("la huella no cambia por espacios ni por la forma de escribir los acentos", () => {
  assert.equal(textFingerprint("a  b\n c"), textFingerprint("a b c"));
  assert.equal(textFingerprint("esperanza "), textFingerprint(" esperanza"));
  assert.equal(textFingerprint("é"), textFingerprint("é"));
  assert.notEqual(textFingerprint("esperanza"), textFingerprint("confianza"));
});

test("el resumen: cierra cuando todo está acordado y arma la lista para la reunión", () => {
  const decisions = [
    answer("ana", "n1", "approved"), answer("bea", "n1", "approved"), answer("carla", "n1", "approved"),
    answer("bea", "n2", "rejected", { note: "otra palabra" }), answer("carla", "n2", "approved"),
    answer("ana", "n3", "approved"),
  ];
  const s = summarizeRound({ itemIds: ["n1", "n2", "n3"], decisions, levels, authors, thresholds, reviewers: ["ana", "bea", "carla", "dora"] });
  assert.deepEqual([s.agreed, s.disputed, s.pending], [1, 1, 1]);
  assert.equal(s.complete, false);
  assert.deepEqual(s.meeting.map((i) => i.itemId), ["n2"]);
  assert.deepEqual(s.waitingOn, ["dora"], "Dora aún no respondió nada");
  const done = summarizeRound({ itemIds: ["n1"], decisions: decisions.slice(0, 3), levels, authors, thresholds });
  assert.equal(done.complete, true);
  assert.equal(summarizeRound({ itemIds: [], decisions: [], levels, authors, thresholds }).complete, false, "sin elementos no hay cierre");
});

test("cada persona escribe su propio archivo y se leen juntos en orden de tiempo", () => {
  assert.equal(decisionsFilePath("tit", " Ana "), "checkings/decisions/TIT.ana.decisions.json");
  const a = answer("ana", "n1", "approved");
  const b = answer("bea", "n1", "revise");
  const files: CheckingDecisionsFile[] = [
    { book: "TIT", decisions: [b] },
    { book: "TIT", decisions: [a, { ...a, itemId: "" } as ReviewDecision] },
  ];
  assert.deepEqual(mergeDecisionFiles(files).map((d) => d.reviewer), ["ana", "bea"], "sin elemento no es una respuesta de revisión");
});

test("quien alineó un versículo no cuenta como independiente en ese versículo, pero sí en los demás", () => {
  const th = { minAgree: 2, minIndependent: 1 };
  const ds = [answer("ana", "v1", "approved"), answer("bea", "v1", "approved"), answer("ana", "v2", "approved"), answer("bea", "v2", "approved")];
  const base = { itemIds: ["v1", "v2"], decisions: ds, levels, authors: [] as string[], thresholds: th };
  assert.equal(summarizeRound(base).agreed, 2, "sin autores los dos versículos se acuerdan");
  const r = summarizeRound({ ...base, authorsByItem: { v1: ["ana", "bea"], v2: ["ana"] } });
  assert.deepEqual(r.items.map((i) => i.state), ["pending", "agreed"], "en v1 las dos son autoras; en v2 Bea es independiente");
});

console.log(`\nverify-review-round: ${passed} checks passed.`);
