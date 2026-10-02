/** The committee's endorsement: independent reports, seen by the others only once handed in, and the rule to decide. */
import assert from "node:assert/strict";
import { tallyEndorsement, visibleReports, type Concern, type EndorsementReport } from "../src/domain/endorsement";
import type { ChecklistQuestion } from "../src/domain/types";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const questions: ChecklistQuestion[] = [
  { id: "fiel", text: "¿Comunica fielmente el mensaje?" },
  { id: "claro", text: "¿Se entiende?" },
  { id: "util", text: "¿Ayuda a resolver dificultades reales?" },
];
const yes = { fiel: true, claro: true, util: true };
const report = (by: string, extra: Partial<EndorsementReport> = {}): EndorsementReport => ({ by, answers: yes, concerns: [], delivered: true, at: "2026-10-01T10:00:00Z", ...extra });
const objection = (text: string, extra: Partial<Concern> = {}): Concern => ({ id: text, kind: "objection", about: "tpl", where: "2:9", text, ...extra });
const tally = (reports: EndorsementReport[], rule: "majority" | "unanimous" = "majority") => tallyEndorsement({ reports, questions, minMembers: 2, rule });

test("cada pastor revisa a ciegas: no ve los reportes de los demás hasta entregar el suyo", () => {
  const reports = [report("eliseo"), report("hulda", { delivered: false }), report("natan")];
  assert.deepEqual(visibleReports(reports, "hulda").map((r) => r.by), ["hulda"], "todavía no entregó: solo ve el suyo");
  assert.deepEqual(visibleReports(reports, "eliseo").map((r) => r.by), ["eliseo", "natan"], "ya entregó: ve los entregados, no los borradores");
  assert.deepEqual(visibleReports(reports, "otro"), [], "quien no tiene reporte no ve ninguno");
});

test("hace falta el mínimo de reportes entregados", () => {
  assert.equal(tally([report("eliseo")]).blocker, "few-reports");
  assert.equal(tally([report("eliseo"), report("hulda", { delivered: false })]).canEndorse, false);
});

test("con dos pastores, los dos deben apoyar", () => {
  assert.equal(tally([report("eliseo"), report("hulda")]).canEndorse, true);
  assert.equal(tally([report("eliseo"), report("hulda", { answers: { ...yes, claro: false } })]).blocker, "no-majority");
});

test("con tres o más, decide más de la mitad", () => {
  const no = { answers: { ...yes, fiel: false } };
  assert.equal(tally([report("a"), report("b"), report("c", no)]).canEndorse, true);
  assert.equal(tally([report("a"), report("b", no), report("c", no)]).blocker, "no-majority");
  assert.equal(tally([report("a"), report("b"), report("c", no), report("d", no)]).blocker, "no-majority", "la mitad justa no alcanza");
});

test("una objeción queda a la vista de todos; sin consenso se decide por mayoría, y con regla unánime bloquea", () => {
  const reports = [report("eliseo"), report("natan"), report("hulda", { concerns: [objection("«esclavos» puede leerse mal")] })];
  const byMajority = tally(reports);
  assert.equal(byMajority.consensus, false);
  assert.deepEqual(byMajority.objections.map((c) => c.by), ["hulda"]);
  assert.equal(byMajority.canEndorse, true, "dos de tres apoyan");
  assert.equal(tally(reports, "unanimous").blocker, "objections");
  const withdrawn = [report("eliseo"), report("natan"), report("hulda", { concerns: [objection("«esclavos» puede leerse mal", { withdrawn: true })] })];
  assert.equal(tally(withdrawn, "unanimous").canEndorse, true, "retirada la objeción, hay consenso");
});

test("una observación no quita el apoyo", () => {
  const t = tally([report("eliseo"), report("natan", { concerns: [{ id: "o", kind: "observation", about: "notas", text: "Una nota podría ser más corta" }] })]);
  assert.equal(t.canEndorse, true);
  assert.equal(t.observations.length, 1);
});

console.log(`\nverify-endorsement: ${passed} checks passed.`);
