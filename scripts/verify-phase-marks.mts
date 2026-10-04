/**
 * The mark a phase leaves on a book (`fase/<book>/<phase>`): asked for when the last subtarea of the phase closes
 * for that book, and not before.
 *
 *   npm run verify:phase-marks
 */
import assert from "node:assert/strict";
import type { DcsIssue } from "@ip-lms/dcs-client";
import { setWorkspaceBranchNames } from "../src/domain/branchNames";
import { isPhaseTagName, phaseClosedBy, phaseTagName } from "../src/domain/phaseMarks";
import { isArchiveRefName } from "../src/domain/portionPr";
import { shippedWorkflows } from "../src/domain/processes";
import type { AssignmentsDoc } from "../src/domain/types";
import { applyWorkflowToBoard } from "../src/domain/workflows";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const empty = { projectId: "JUD", book: "JUD", books: ["JUD"], teams: [], phases: [], people: [], assignments: [] } as unknown as AssignmentsDoc;
const board = applyWorkflowToBoard(empty, shippedWorkflows()[0]!);
const phases = [...board.phases].sort((a, b) => a.order - b.order);
const [first, second] = phases;
const tasksOf = (phaseId: string) => board.teams.filter((task) => task.phaseId === phaseId);

let n = 0;
const issue = (taskId: string, state: "open" | "closed", book = "JUD", portion = 1): DcsIssue => {
  const task = board.teams.find((row) => row.id === taskId)!;
  const marker = { schema: "gateway-work-order-1", key: `${book}|${taskId}|${portion}`, book, teamId: taskId, resource: task.rules[0]!.resource, portionIds: [`${book}-01-0${portion}`], itemIds: [] };
  return { number: ++n, title: `${task.name} · ${book} 1:${portion}`, state, body: `<!-- gateway-work-order ${JSON.stringify(marker)} -->` } as DcsIssue;
};

/** A book with two passages: every task of the first two phases has a subtarea for each. */
function book(state: "open" | "closed", code = "JUD"): DcsIssue[] {
  return [...tasksOf(first!.id), ...tasksOf(second!.id)].flatMap((task) => [issue(task.id, state, code, 1), issue(task.id, state, code, 2)]);
}
const inPhase = (issues: DcsIssue[], phaseId: string) => issues.filter((row) => tasksOf(phaseId).some((task) => row.body!.includes(`"teamId":"${task.id}"`)));

test("la marca se llama como la fase y el libro, bajo su propia palabra", () => {
  assert.equal(phaseTagName("JUD", first!.slug), `fase/jud/${first!.slug}`);
  assert.ok(isPhaseTagName(phaseTagName("JUD", first!.slug)));
  assert.ok(!isPhaseTagName("archivo/jud/159") && !isPhaseTagName("borrador/jud/tpl") && !isPhaseTagName("fase/jud") && !isPhaseTagName("fase/jud/a/b"));
  assert.ok(!isArchiveRefName(phaseTagName("JUD", first!.slug)), "una marca de fase no pasa por archivo");
  setWorkspaceBranchNames({ phase: "etapa" });
  try {
    assert.equal(phaseTagName("JUD", first!.slug), `etapa/jud/${first!.slug}`, "con la palabra que el espacio configure");
    assert.ok(!isPhaseTagName(`fase/jud/${first!.slug}`));
  } finally {
    setWorkspaceBranchNames(undefined);
  }
});

test("cerrar una subtarea que no es la última de su fase no pide la marca", () => {
  const issues = book("open");
  const mine = inPhase(issues, first!.id);
  assert.equal(phaseClosedBy(board, issues, mine[0]!), null, "quedan todas las demás");
  for (const row of mine.slice(0, -2)) row.state = "closed";
  assert.equal(phaseClosedBy(board, issues, mine[mine.length - 1]!), null, "queda una abierta además de esta");
});

test("cerrar la última subtarea de una fase pide la marca en el borrador de cada recurso de esa fase", () => {
  const issues = book("open");
  const mine = inPhase(issues, first!.id);
  for (const row of mine.slice(0, -1)) row.state = "closed";
  const last = mine[mine.length - 1]!;
  const closed = phaseClosedBy(board, issues, last);
  assert.ok(closed, "la que se está cerrando cuenta como cerrada aunque la lista aún la diga abierta");
  assert.equal(closed.tag, `fase/jud/${first!.slug}`);
  assert.equal(closed.book, "JUD");
  const resources = [...new Set(tasksOf(first!.id).flatMap((task) => task.rules.map((rule) => rule.resource)))];
  assert.deepEqual(closed.drafts.map((draft) => draft.resource).sort(), [...resources].sort(), "un borrador por recurso, sin repetir");
  for (const draft of closed.drafts) {
    assert.equal(board.teams.find((task) => task.rules.some((rule) => rule.resource === draft.resource))!.id, draft.taskId, `«${draft.resource}» se marca en el borrador de su tarea de traducción`);
  }
});

test("las fases se solapan: la siguiente abierta no impide marcar la que cerró, y su marca va a los mismos borradores", () => {
  const issues = book("closed");
  const later = inPhase(issues, second!.id);
  later[0]!.state = "open";
  later[1]!.state = "open";
  const firstPhaseIssue = inPhase(issues, first!.id)[0]!;
  assert.ok(phaseClosedBy(board, issues, firstPhaseIssue), "la primera fase está cerrada aunque la segunda siga");
  assert.equal(phaseClosedBy(board, issues, later[0]!), null, "la segunda todavía tiene otra abierta");
  later[1]!.state = "closed";
  const closed = phaseClosedBy(board, issues, later[0]!)!;
  assert.equal(closed.tag, `fase/jud/${second!.slug}`);
  for (const draft of closed.drafts) {
    assert.ok(tasksOf(first!.id).some((task) => task.id === draft.taskId), `la fase que afina «${draft.resource}» marca el borrador de quien lo tradujo`);
  }
});

test("cada libro tiene su marca: otro libro abierto en el mismo proyecto no la detiene", () => {
  const jud = book("closed");
  const other = book("open", "2JN");
  const closed = phaseClosedBy(board, [...jud, ...other], inPhase(jud, first!.id)[0]!);
  assert.equal(closed?.tag, `fase/jud/${first!.slug}`);
  assert.equal(phaseClosedBy(board, [...jud, ...other], inPhase(other, first!.id)[0]!), null);
});

test("lo que no es una subtarea del plan no pide nada", () => {
  const issues = book("closed");
  const thread = { number: 9999, title: "Decisión", state: "open", body: "" } as DcsIssue;
  assert.equal(phaseClosedBy(board, [...issues, thread], thread), null);
  assert.ok(phaseClosedBy(board, [...issues, thread], inPhase(issues, first!.id)[0]!), "ni cuenta como subtarea abierta de la fase");
});

console.log(`\nverify-phase-marks: ${passed} checks passed.`);
