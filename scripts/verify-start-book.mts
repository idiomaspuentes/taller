/**
 * Starting a book in one action: the teams come from the last book done with the same process, and the person is
 * told how the phases stand and what the book lacks.
 */
import assert from "node:assert/strict";
import { shippedWorkflow } from "../src/domain/processes";
import { bookSize, inheritTeams, phasesAtStart, startNotices, tasksWithoutTeam } from "../src/domain/startBook";
import type { AssignmentsDoc, InventoryDoc, Portion } from "../src/domain/types";
import { applyWorkflowToBoard } from "../src/domain/workflows";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const fcr = shippedWorkflow("fcr-base")!;
const empty = (book: string) => ({ projectId: book, book, teams: [], phases: [], people: [], assignments: [] }) as unknown as AssignmentsDoc;
const fresh = (book: string) => applyWorkflowToBoard(empty(book), fcr);

/** Tito, already under way: every task has its team, and one has people by name. */
const titus: AssignmentsDoc = {
  ...fresh("TIT"),
  people: [{ id: "ana", name: "Ana" }],
  teams: fresh("TIT").teams.map((task, i) => ({ ...task, orgTeamId: 11, orgTeamName: i < 6 ? "Traducción" : "Revisión", memberIds: task.id === "validar" ? ["ana"] : [] })),
} as AssignmentsDoc;

test("el libro nuevo hereda los equipos del libro anterior hecho con el mismo proceso", () => {
  const ruth = inheritTeams(fresh("RUT"), titus);
  assert.equal(tasksWithoutTeam(ruth).length, 0);
  assert.equal(ruth.teams.find((t) => t.id === "tpl")!.orgTeamName, "Traducción");
  assert.deepEqual(ruth.teams.find((t) => t.id === "validar")!.memberIds, ["ana"]);
  assert.deepEqual(ruth.people.map((p) => p.id), ["ana"], "y las personas que nombra");
  assert.equal(tasksWithoutTeam(fresh("RUT")).length, fresh("RUT").teams.length, "sin libro anterior, falta decir quién hace cada tarea");
});

test("no se hereda de otro proceso, ni se pisa lo que la plantilla ya dice", () => {
  assert.equal(tasksWithoutTeam(inheritTeams(fresh("RUT"), { ...titus, workflowId: "otro" })).length, fresh("RUT").teams.length);
  const alone = fresh("RUT");
  assert.equal(inheritTeams(alone, null), alone, "sin libro anterior queda igual");
  const named = { ...fresh("RUT"), teams: fresh("RUT").teams.map((t) => (t.id === "tpl" ? { ...t, orgTeamName: "Equipo propio" } : t)) } as AssignmentsDoc;
  assert.equal(inheritTeams(named, titus).teams.find((t) => t.id === "tpl")!.orgTeamName, "Equipo propio");
});

test("el resumen dice qué fase puede empezar y a cuál espera cada una", () => {
  const phases = phasesAtStart(fresh("TIT"));
  assert.deepEqual(phases.map((p) => [p.name, p.ready]), [["Traducción", true], ["Afinación", false], ["Armonización", false], ["Validación", false], ["Publicación", false]]);
  assert.deepEqual(phases.find((p) => p.name === "Afinación")!.waitsFor, ["Traducción"]);
  assert.deepEqual(phases.find((p) => p.name === "Publicación")!.waitsFor, ["Validación"]);
});

const portion = (chapter: number, extra: Partial<Portion> = {}): Portion => ({ id: `p${chapter}`, ref: `${chapter}:1-5`, chapter, verses: [1, 2, 3, 4, 5], tpl: 1, tps: 1, notas: 3, preguntas: 1, ...extra }) as unknown as Portion;

test("se dice el tamaño del libro y lo que le falta en el origen, sin detener nada", () => {
  const whole = { portions: [portion(1), portion(1), portion(2)] } as unknown as InventoryDoc;
  assert.deepEqual(bookSize(whole), { chapters: 2, portions: 3 });
  assert.deepEqual(startNotices(whole), []);
  const bare = { portions: [portion(1, { notas: 0, preguntas: 0, tps: 0 })] } as unknown as InventoryDoc;
  assert.deepEqual(startNotices(bare), ["no-notes", "no-questions", "no-second-text"]);
});

console.log(`\nverify-start-book: ${passed} checks passed.`);
