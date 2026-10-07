/**
 * The committee's endorsement: independent reports, seen by the others only once handed in, and the rule to decide.
 * And how the unit is read for it: verse by verse, with what goes with each verse and what was said about it.
 */
import assert from "node:assert/strict";
import { tallyEndorsement, visibleReports, type Concern, type EndorsementReport } from "../src/domain/endorsement";
import type { ChecklistQuestion } from "../src/domain/types";
import { concernPlace, concernsAt, concernsOfHelp, helpsOfVerse, unitVerses } from "../src/domain/unitReading";

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

test("la unidad se lee por sus versículos: un tramo de un capítulo, solo los suyos", () => {
  const tpl = { 1: "Pablo, siervo de Dios", 2: "sobre la esperanza", 3: "pero reveló", 4: "a Tito", 5: "Por esta causa" };
  const tps = { 1: "Yo, Pablo", 2: "ellos pueden", 6: "un versículo que solo tiene este texto" };
  // The texts are read by chapter: a stretch of it has to be cut out, or a committee reads sixteen verses for four.
  assert.deepEqual(unitVerses("1:1–4", 1, [tpl, tps]), [1, 2, 3, 4]);
  assert.deepEqual(unitVerses("1", 1, [tpl, tps]), [1, 2, 3, 4, 5, 6], "un capítulo entero, todos, en orden");
  assert.deepEqual(unitVerses(undefined, 1, [tpl, undefined]), [1, 2, 3, 4, 5]);
  assert.deepEqual(unitVerses("1:3", 1, [tpl]), [3]);
  assert.deepEqual(unitVerses("1:1–4", 1, []), []);
});

test("bajo cada versículo va lo suyo, y una inquietud se guarda donde se anotó", () => {
  const notes = [{ id: "a", verse: 1 }, { id: "b", verse: 2 }, { id: "c", verse: 1 }];
  assert.deepEqual(helpsOfVerse(notes, 1).map((n) => n.id), ["a", "c"]);
  assert.deepEqual(helpsOfVerse(undefined, 1), []);
  // The place is what the person would have typed: the verse, and what of it when it is a note, a question, a term.
  assert.equal(concernPlace(1, 1), "1:1");
  assert.equal(concernPlace(1, 1, "conforme a la fe"), "1:1 «conforme a la fe»");
  assert.equal(concernPlace(1, 12, "  ¿Cuál era\n el propósito de Pablo?  "), "1:12 «¿Cuál era el propósito de Pablo?»");
  assert.equal(concernPlace(1, 1, "x".repeat(80)).length, "1:1 «".length + 60 + "»".length, "lo largo se acorta");
  // What was said is shown at its verse: one filed at 1:1 is not of 1:12, nor one about the whole unit of any.
  const said = [objection("a", { where: "1:1" }), objection("b", { where: "1:1 «conforme a la fe»" }), objection("c", { where: "1:12" }), objection("d", { where: undefined }), objection("e", { where: "2:1" })];
  assert.deepEqual(concernsAt(said, 1, 1).map((c) => c.id), ["a", "b"]);
  assert.deepEqual(concernsAt(said, 1, 12).map((c) => c.id), ["c"]);
  assert.deepEqual(concernsAt(said, 1, 2), []);
});

test("una inquietud es de la nota en que se anotó, aunque otra nota del versículo hable de las mismas palabras", () => {
  const helps = [{ id: "n1", place: "1:1 «Judas»" }, { id: "n2", place: "1:1 «Judas»" }, { id: "n3", place: "1:1 «siervo»" }];
  const said = [
    { id: "a", kind: "observation" as const, about: "notas", where: "1:1 «Judas»", item: "n2", text: "de la segunda" },
    { id: "b", kind: "observation" as const, about: "notas", where: "1:1 «Judas»", text: "anotada antes de que se guardara la nota" },
    { id: "c", kind: "objection" as const, about: "palabras", where: "1:1 «Judas»", text: "de una palabra clave" },
    { id: "d", kind: "observation" as const, about: "notas", where: "1:1 «siervo»", item: "n3", text: "retirada", withdrawn: true },
  ];
  const of = (id: string, place: string) => concernsOfHelp(said, "notas", id, place, helps).map((c) => c.id);
  assert.deepEqual(of("n2", "1:1 «Judas»"), ["a"], "la que dice de qué nota es sale solo bajo esa");
  assert.deepEqual(of("n1", "1:1 «Judas»"), ["b"], "la que no lo dice, bajo la primera de ese lugar, no bajo las dos");
  assert.deepEqual(of("n3", "1:1 «siervo»"), [], "ni la retirada ni la de otro recurso");
});

console.log(`\nverify-endorsement: ${passed} checks passed.`);
