/** «Equipo hoy»: which subtareas are stuck, running, free, waiting or done. */
import assert from "node:assert/strict";
import type { DcsIssue } from "@ip-lms/dcs-client";
import type { AssignmentsDoc, ProjectTask } from "../src/domain/types";
import { assignCandidates, classifyToday, daysText } from "../src/domain/teamToday";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const now = new Date("2026-10-01T12:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const rule = { resource: "tpl" as const, articleFilter: "pending" as const };
const task = (id: string, name: string, extra: Partial<ProjectTask> = {}): ProjectTask => ({
  id, name, description: "", phaseId: "p1", memberIds: [], scope: ["tpl"], rules: [rule], ...extra,
});
const board: Pick<AssignmentsDoc, "teams" | "phases"> = {
  phases: [{ id: "p1", name: "Traducción", slug: "t", order: 0 }],
  teams: [task("tpl", "Traducir TPL"), task("afinar", "Afinar TPL", { waitsFor: [{ taskId: "tpl", scope: "portion" }] })],
};

let n = 0;
function issue(taskId: string, o: { assignee?: string; created?: number; updated?: number; closed?: number; portion?: string } = {}): DcsIssue {
  n++;
  const marker = JSON.stringify({ schema: "gateway-work-order-1", key: `${taskId}|${o.portion ?? "p1"}`, book: "NEH", teamId: taskId, resource: "tpl", portionIds: [o.portion ?? "p1"], itemIds: [] });
  return {
    id: n, number: n, title: `NEH 1:1–3 · ${taskId}`,
    state: o.closed !== undefined ? "closed" : "open",
    body: `<!-- gateway-work-order ${marker} -->`,
    labels: [{ name: `pm/tarea:${taskId}` }],
    assignee: o.assignee ? { login: o.assignee } : null,
    assignees: o.assignee ? [{ login: o.assignee }] : [],
    created_at: ago(o.created ?? 0),
    updated_at: ago(o.updated ?? o.created ?? 0),
    closed_at: o.closed !== undefined ? ago(o.closed) : undefined,
  } as unknown as DcsIssue;
}

test("libre reciente, libre olvidada, en marcha y quieta", () => {
  const fresh = issue("tpl", { created: 1 });
  const forgotten = issue("tpl", { created: 6, portion: "p2" });
  const running = issue("tpl", { assignee: "ana", created: 9, updated: 1, portion: "p3" });
  const quiet = issue("tpl", { assignee: "luis", created: 9, updated: 8, portion: "p4" });
  const g = classifyToday({ issues: [fresh, forgotten, running, quiet], board, now });
  assert.deepEqual(g.free.map((r) => r.issue.number), [fresh.number]);
  assert.deepEqual(g.stuck.map((r) => r.issue.number), [quiet.number, forgotten.number], "la más antigua primero");
  assert.deepEqual(g.running.map((r) => r.issue.number), [running.number]);
  assert.equal(g.stuck[0]!.reason, "Sin movimiento hace 8 días");
  assert.equal(g.stuck[1]!.reason, "Nadie la ha tomado en 6 días");
});

test("una subtarea que espera va a «esperando» con su motivo, aunque lleve días sin tocarse", () => {
  const blocker = issue("tpl", { assignee: "ana", created: 2, updated: 0 });
  const waiting = issue("afinar", { assignee: "eva", created: 30, updated: 30 });
  const g = classifyToday({ issues: [blocker, waiting], board, now });
  assert.equal(g.waiting.length, 1);
  assert.equal(g.waiting[0]!.reason, "Espera a «Traducir TPL» de @ana");
  assert.equal(g.stuck.length, 0, "no está atascada: le toca esperar");
  assert.equal(g.running.length, 1);
});

test("terminadas: solo las cerradas dentro de la última semana", () => {
  const recent = issue("tpl", { assignee: "ana", created: 20, closed: 2 });
  const old = issue("tpl", { assignee: "ana", created: 30, closed: 20, portion: "p2" });
  const g = classifyToday({ issues: [recent, old], board, now });
  assert.deepEqual(g.done.map((r) => r.issue.number), [recent.number]);
  assert.equal(g.done[0]!.reason, "Cerrada hace 2 días");
});

test("cerrar la tarea de la que otra esperaba la deja libre o en marcha, no esperando", () => {
  const closed = issue("tpl", { assignee: "ana", created: 5, closed: 0 });
  const next = issue("afinar", { created: 1 });
  const g = classifyToday({ issues: [closed, next], board, now });
  assert.equal(g.waiting.length, 0);
  assert.equal(g.free.length, 1);
  assert.equal(g.done.length, 1);
});

test("los umbrales se pueden cambiar y el texto de días es claro", () => {
  const forgotten = issue("tpl", { created: 2 });
  assert.equal(classifyToday({ issues: [forgotten], board, now }).stuck.length, 0);
  assert.equal(classifyToday({ issues: [forgotten], board, now, thresholds: { freeDays: 2 } }).stuck.length, 1);
  assert.equal(daysText(0), "hoy");
  assert.equal(daysText(1), "hace 1 día");
  assert.equal(daysText(4), "hace 4 días");
});

test("a quién se le puede pasar: el equipo de la tarea, con el nivel pedido y sin quien ya la tiene", () => {
  const t = task("x", "X", { memberIds: ["luis", "Ana", "bea", "caro"], minLevel: "practicante" });
  const levels = { ana: "habilitada", bea: "aprendiz", luis: "practicante", caro: "oyente" } as const;
  assert.deepEqual(assignCandidates(t, levels, "luis"), ["Ana"], "bea no llega al nivel y caro solo escucha");
  assert.deepEqual(assignCandidates(t, undefined, "ana"), ["bea", "caro", "luis"], "sin niveles registrados no se filtra");
  assert.deepEqual(assignCandidates(undefined, levels), []);
});

test("cada fila trae sus candidatos", () => {
  const boardWithTeam: Pick<AssignmentsDoc, "teams" | "phases"> = { ...board, teams: [task("tpl", "Traducir TPL", { memberIds: ["ana", "luis"] }), ...board.teams.slice(1)] };
  const g = classifyToday({ issues: [issue("tpl", { assignee: "ana", created: 9, updated: 8 })], board: boardWithTeam, now });
  assert.deepEqual(g.stuck[0]!.candidates, ["luis"]);
});

console.log(`\nverify-team-today: ${passed} checks passed.`);
