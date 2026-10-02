/**
 * Starting a book in one action: the teams come from the last book done with the same process, and the person is
 * told how the phases stand and what the book lacks.
 */
import assert from "node:assert/strict";
import { shippedWorkflow } from "../src/domain/processes";
import { bookSize, firstPhaseTeams, inheritTeams, nextBookHint, reachesNextBook, phasesAtStart, phasesWithoutTeam, startNotices, tasksWithoutTeam } from "../src/domain/startBook";
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
  const byPhase = phasesWithoutTeam(fresh("RUT"));
  assert.deepEqual(byPhase.map((phase) => phase.id), [...fresh("RUT").phases].sort((x, y) => x.order - y.order).map((phase) => phase.id), "se elige un equipo por fase, en el orden del proceso");
  assert.equal(byPhase.reduce((sum, phase) => sum + phase.tasks.length, 0), fresh("RUT").teams.length);
  assert.deepEqual(phasesWithoutTeam(ruth), [], "y cuando todas tienen equipo no se pregunta nada");
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

test("se avisa de empezar el libro siguiente cuando la primera fase va por el 70 %", () => {
  const board = fresh("TIT");
  const work = (closed: number, open: number, other = 0) => [
    ...Array.from({ length: closed }, () => ({ taskId: "tpl", closed: true })),
    ...Array.from({ length: open }, () => ({ taskId: "tps", closed: false })),
    ...Array.from({ length: other }, () => ({ taskId: "afinar-tpl", closed: false })),
  ];
  assert.equal(nextBookHint(board, work(6, 4, 9)), null, "al 60 % todavía no");
  assert.deepEqual(nextBookHint(board, work(7, 3, 9)), { projectId: "TIT", phase: "Traducción", done: 7, total: 10 }, "las otras fases no cuentan");
  assert.equal(nextBookHint(board, []), null, "sin subtareas no se sabe");
  assert.equal(nextBookHint({ ...board, settings: { nextBookAt: 0.5 } }, work(5, 5))?.done, 5, "el proceso puede pedirlo antes");
  assert.equal(nextBookHint({ ...board, settings: { nextBookAt: 0.9 } }, work(8, 2)), null, "o más tarde");
  assert.equal(applyWorkflowToBoard(empty("RUT"), { ...fcr, nextBookAt: 0.6 }).settings?.nextBookAt, 0.6, "y el proyecto lo recibe de su plantilla");
});

test("a quien coordina se le avisa una sola vez: con la entrega que cruza la marca", () => {
  const board = fresh("TIT");
  const work = Array.from({ length: 10 }, (_, i) => ({ number: i + 1, taskId: "tpl", closed: i < 6 }));
  assert.equal(reachesNextBook(board, work, 7)?.done, 7, "la séptima de diez cruza el 70 %");
  assert.equal(reachesNextBook(board, work.map((row) => (row.number === 7 ? { ...row, closed: true } : row)), 8), null, "la octava ya no avisa");
  assert.equal(reachesNextBook(board, work.map((row) => ({ ...row, closed: row.number < 5 })), 5), null, "la quinta todavía no");
  assert.deepEqual(firstPhaseTeams({ ...board, teams: board.teams.map((t) => ({ ...t, orgTeamName: t.phaseId === board.phases[0]!.id ? "Traducción" : "Otro" })) }), ["Traducción"]);
});

console.log(`\nverify-start-book: ${passed} checks passed.`);
