/**
 * Who is told what Door43 does not announce by itself: that a step is somebody's turn, that a subtarea can start,
 * that one is free for a team. Decided by the app at the moment somebody causes it.
 *
 *   npm run verify:ask-notices
 */
import assert from "node:assert/strict";
import type { DcsIssue } from "@ip-lms/dcs-client";
import { afterClose, afterDecision, afterPublish, afterRelease, afterStep } from "../src/domain/askNotices";
import type { TaskProgressMarker } from "../src/domain/taskProgress";
import type { AssignmentsDoc, ProjectTask } from "../src/domain/types";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const TEAM = ["ana", "bea", "carla", "dina"];
const task = (id: string, extra: Partial<ProjectTask> = {}): ProjectTask => ({ id, name: id, memberIds: TEAM, rules: [], ...extra }) as unknown as ProjectTask;
const board = {
  teams: [
    task("traducir", {
      steps: [
        { id: "borrador", name: "Borrador" },
        { id: "pares", name: "Revisión en pares", claimMode: "exclusive", excludePriorStepIds: ["borrador"] },
        { id: "grupo", name: "Revisión grupal", claimMode: "pool", minAssignees: 2 },
      ],
    } as Partial<ProjectTask>),
    task("afinar", { waitsFor: [{ taskId: "traducir", scope: "chapter" }] } as Partial<ProjectTask>),
  ],
} as unknown as Pick<AssignmentsDoc, "teams">;

let n = 0;
const issue = (taskId: string, assignee?: string, chapter = 1): DcsIssue =>
  ({ id: ++n, number: n, title: `TIT ${chapter}:1–3 · ${taskId}`, state: "open", body: "", labels: [{ name: `pm/tarea:${taskId}` }, { name: `pm/cap:${chapter}` }], assignee: assignee ? { login: assignee } : null, assignees: assignee ? [{ login: assignee }] : [] }) as unknown as DcsIssue;
const progress = (done: string[], seats: Record<string, string[]> = {}): TaskProgressMarker =>
  ({ schema: "gateway-task-progress-2", doneStepIds: done, steps: Object.fromEntries(Object.entries(seats).map(([id, assignees]) => [id, { assignees, approvals: [] }])) }) as TaskProgressMarker;

test("al terminar el borrador, el paso de revisión que nadie tomó queda libre para el equipo, menos para quien lo escribió", () => {
  const mine = issue("traducir", "ana");
  assert.deepEqual(afterStep(mine, board, progress([]), progress(["borrador"])), [{ kind: "step-free", issue: mine.number, to: ["bea", "carla", "dina"], step: "Revisión en pares" }]);
});

test("si alguien ya se había sentado en el paso que sigue, es su turno y solo se le dice a esa persona", () => {
  const mine = issue("traducir", "ana");
  const seats = { pares: ["bea"] };
  assert.deepEqual(afterStep(mine, board, progress([], seats), progress(["borrador"], seats)), [{ kind: "step-turn", issue: mine.number, to: ["bea"], step: "Revisión en pares" }]);
});

test("un paso que no cambió no avisa, y terminar el último tampoco", () => {
  const mine = issue("traducir", "ana");
  assert.deepEqual(afterStep(mine, board, progress(["borrador"]), progress(["borrador"])), []);
  assert.deepEqual(afterStep(mine, board, progress(["borrador", "pares"]), progress(["borrador", "pares", "grupo"])), []);
  assert.deepEqual(afterStep(issue("otra-tarea", "ana"), board, progress([]), progress(["borrador"])), [], "una tarea que el plan no conoce");
});

test("al cerrar una subtarea, lo que esperaba por ella puede empezar: su persona, o su equipo si nadie la tiene", () => {
  const last = issue("traducir", "ana", 1);
  const waitingTaken = issue("afinar", "bea", 1);
  const otherChapter = issue("afinar", undefined, 2);
  const stillHeld = issue("traducir", "carla", 2);
  const open = [last, waitingTaken, otherChapter, stillHeld];
  assert.deepEqual(afterClose(last, board, open), [{ kind: "your-turn", issue: waitingTaken.number, to: ["bea"] }], "el capítulo 2 sigue esperando a su traducción");
  const free = issue("afinar", undefined, 1);
  assert.deepEqual(afterClose(last, board, [last, free]), [{ kind: "free", issue: free.number, to: TEAM }]);
  const another = issue("traducir", "dina", 1);
  assert.deepEqual(afterClose(last, board, [last, another, free]), [], "mientras quede otra abierta del mismo capítulo, nada se libera");
});

test("devolver una subtarea al equipo y abrir una decisión se le dice al equipo de la tarea", () => {
  const back = issue("afinar");
  assert.deepEqual(afterRelease(back, board), [{ kind: "free", issue: back.number, to: TEAM }]);
  assert.deepEqual(afterDecision(back, board), [{ kind: "decision", issue: back.number, to: TEAM }]);
  assert.deepEqual(afterRelease(issue("sin-plan"), board), []);
});

test("al crear las subtareas de un libro, cada persona oye una vez cuántas hay libres ya, no una por subtarea", () => {
  const created = [issue("traducir", undefined, 1), issue("traducir", undefined, 2), issue("traducir", "ana", 3), issue("afinar", undefined, 1)];
  const asks = afterPublish(created, board, created);
  assert.deepEqual(asks, [{ kind: "free", issue: created[0]!.number, to: TEAM, count: 2 }], "ni la que ya tiene persona ni la que espera a la traducción");
  assert.deepEqual(afterPublish([], board, []), []);
});

console.log(`\nverify-ask-notices: ${passed} checks passed.`);
