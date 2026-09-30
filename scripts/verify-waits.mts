/**
 * «Esperas» between tasks, with the FCR as the worked example:
 * Afinación of a resource waits only for that resource, Armonización for the
 * Ayudas and the Afinación of its portion, Validación for the whole chapter.
 */
import assert from "node:assert/strict";
import type { DcsIssue } from "@ip-lms/dcs-client";
import type { AssignmentsDoc, ProjectTask, WaitRule } from "../src/domain/types";
import { normalizeTeams, normalizeWorkflowTemplate } from "../src/domain/store";
import { applyWorkflowToBoard, boardToWorkflowTemplate } from "../src/domain/workflows";
import {
  newlyEnabled,
  pruneWaitRules,
  waitBlocks,
  waitReason,
  waitWouldLoop,
} from "../src/domain/waits";
import { normalizeWaitRules } from "../src/domain/waitRules";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const rule = { resource: "tpl" as const, articleFilter: "pending" as const };
function task(id: string, name: string, phaseId: string, waitsFor?: WaitRule[]): ProjectTask {
  return {
    id,
    name,
    description: "",
    phaseId,
    memberIds: [],
    scope: ["tpl"],
    rules: [rule],
    waitsFor,
  };
}

const board: Pick<AssignmentsDoc, "teams" | "phases"> = {
  phases: [
    { id: "p1", name: "Traducción", slug: "traduccion", order: 0 },
    { id: "p2", name: "Afinación", slug: "afinacion", order: 1 },
    { id: "p3", name: "Armonización", slug: "armonizacion", order: 2 },
    { id: "p4", name: "Validación", slug: "validacion", order: 3 },
  ],
  teams: [
    task("tpl", "Traducir TPL", "p1"),
    task("tps", "Traducir TPS", "p1"),
    task("notas-ayuda", "Notas (Ayudas)", "p1"),
    task("afinar-tpl", "Afinar TPL", "p2", [{ taskId: "tpl", scope: "portion" }]),
    task("afinar-tps", "Afinar TPS", "p2", [{ taskId: "tps", scope: "portion" }]),
    task("armonizar-notas", "Armonizar Notas", "p3", [
      { taskId: "notas-ayuda", scope: "portion" },
      { phaseId: "p2", scope: "portion" },
    ]),
    task("validar", "Validar", "p4", [{ phaseId: "p3", scope: "chapter" }]),
  ],
};

let n = 0;
function issue(taskId: string, title: string, portionIds: string[], assignee?: string, state = "open"): DcsIssue {
  n++;
  const marker = JSON.stringify({
    schema: "gateway-work-order-1",
    key: `${taskId}|${portionIds.join("+")}`,
    book: "NEH",
    teamId: taskId,
    resource: "tpl",
    portionIds,
    itemIds: [],
  });
  return {
    id: n,
    number: n,
    title,
    state,
    body: `<!-- gateway-work-order ${marker} -->`,
    labels: [{ name: `pm/tarea:${taskId}` }],
    assignee: assignee ? { login: assignee } : null,
    assignees: assignee ? [{ login: assignee }] : [],
  } as unknown as DcsIssue;
}

const tpl11 = issue("tpl", "NEH 1:1–3 · TPL", ["p-1-1"], "ana");
const tpl14 = issue("tpl", "NEH 1:4–5 · TPL", ["p-1-4"], "luis");
const tps11 = issue("tps", "NEH 1:1–3 · TPS", ["p-1-1"], "bea");
const afTpl11 = issue("afinar-tpl", "NEH 1:1–3 · Afinar TPL", ["p-1-1"]);
const afTpl14 = issue("afinar-tpl", "NEH 1:4–5 · Afinar TPL", ["p-1-4"]);
const afTps11 = issue("afinar-tps", "NEH 1:1–3 · Afinar TPS", ["p-1-1"]);
const notas11 = issue("notas-ayuda", "NEH 1:1–3 · Notas", ["p-1-1"], "carla");
const arm11 = issue("armonizar-notas", "NEH 1:1–3 · Armonizar Notas", ["p-1-1"]);
const val1 = issue("validar", "NEH 1 · Validar", ["p-1-1", "p-1-4"]);
const all = [tpl11, tpl14, tps11, afTpl11, afTpl14, afTps11, notas11, arm11, val1];

test("Afinación del TPL espera solo a su propio TPL, por porción", () => {
  assert.equal(waitBlocks(afTpl11, board, all).length, 1);
  assert.deepEqual(waitBlocks(afTpl11, board, all)[0]!.issues.map((i) => i.number), [tpl11.number]);
  assert.deepEqual(waitBlocks(afTpl14, board, all)[0]!.issues.map((i) => i.number), [tpl14.number]);
});

test("cerrar el TPL habilita la Afinación del TPL sin esperar al TPS", () => {
  const openAfter = all.filter((i) => i.number !== tpl11.number);
  assert.equal(waitBlocks(afTpl11, board, openAfter).length, 0);
  assert.equal(waitBlocks(afTps11, board, openAfter).length, 1, "la del TPS sigue esperando su recurso");
  assert.deepEqual(newlyEnabled(tpl11, board, all).map((i) => i.number), [afTpl11.number]);
});

test("Armonización espera a las Ayudas y a la Afinación de su porción", () => {
  const blocks = waitBlocks(arm11, board, all);
  assert.equal(blocks.length, 2);
  const withoutNotas = all.filter((i) => i.number !== notas11.number);
  assert.equal(waitBlocks(arm11, board, withoutNotas).length, 1, "aún espera la Afinación");
  const bothClosed = withoutNotas.filter((i) => i.number !== afTpl11.number && i.number !== afTps11.number);
  assert.equal(waitBlocks(arm11, board, bothClosed).length, 0);
});

test("el alcance capítulo: Validación espera a toda la Armonización del capítulo", () => {
  const arm14 = issue("armonizar-notas", "NEH 1:4–5 · Armonizar Notas", ["p-1-4"]);
  const open = [...all, arm14];
  assert.equal(waitBlocks(val1, board, open).length, 1);
  assert.equal(waitBlocks(val1, board, open)[0]!.issues.length, 2);
  const one = open.filter((i) => i.number !== arm11.number);
  assert.equal(waitBlocks(val1, board, one).length, 1, "queda una porción del capítulo sin armonizar");
  const none = one.filter((i) => i.number !== arm14.number);
  assert.equal(waitBlocks(val1, board, none).length, 0);
});

test("otro capítulo no bloquea", () => {
  const arm2 = issue("armonizar-notas", "NEH 2:1–3 · Armonizar Notas", ["p-2-1"]);
  assert.equal(waitBlocks(val1, board, [val1, arm2]).length, 0);
});

test("una subtarea cerrada no bloquea", () => {
  const closed = issue("tpl", "NEH 1:1–3 · TPL", ["p-1-1"], "ana", "closed");
  assert.equal(waitBlocks(afTpl11, board, [afTpl11, closed]).length, 0);
});

test("alcance «todo» espera a cualquier subtarea abierta de la tarea", () => {
  const b = { ...board, teams: [...board.teams.filter((t) => t.id !== "afinar-tpl"), task("afinar-tpl", "Afinar TPL", "p2", [{ taskId: "tpl", scope: "all" }])] };
  assert.equal(waitBlocks(afTpl11, b, [afTpl11, tpl14]).length, 1);
});

test("la razón se lee en español y nombra a quien tiene el trabajo", () => {
  assert.equal(waitReason(waitBlocks(afTpl11, board, all), board), "Espera a «Traducir TPL» de @ana");
  assert.equal(waitReason(waitBlocks(arm11, board, all), board), "Espera a «Notas (Ayudas)» de @carla y 1 más");
  assert.equal(waitReason([], board), "");
});

test("normalizar descarta reglas malas y duplicadas", () => {
  assert.equal(normalizeWaitRules(undefined), undefined);
  assert.deepEqual(
    normalizeWaitRules([
      { taskId: "a", scope: "chapter" },
      { taskId: "a", scope: "chapter" },
      { taskId: "a", phaseId: "p", scope: "all" },
      { scope: "all" },
      { phaseId: "p1" },
      "x",
    ]),
    [
      { taskId: "a", scope: "chapter" },
      { phaseId: "p1", scope: "portion" },
    ],
  );
});

test("podar quita esperas a tareas o fases que ya no existen", () => {
  const t = task("x", "X", "p1", [
    { taskId: "tpl", scope: "portion" },
    { taskId: "borrada", scope: "portion" },
    { phaseId: "p9", scope: "all" },
    { taskId: "x", scope: "all" },
  ]);
  assert.deepEqual(pruneWaitRules(t, board), [{ taskId: "tpl", scope: "portion" }]);
});

test("no permite esperas en círculo", () => {
  assert.equal(waitWouldLoop(board, "tpl", { taskId: "afinar-tpl", scope: "portion" }), true, "TPL esperaría a algo que espera al TPL");
  assert.equal(waitWouldLoop(board, "tpl", { phaseId: "p4", scope: "all" }), true, "por fase también");
  assert.equal(waitWouldLoop(board, "validar", { taskId: "tpl", scope: "all" }), false);
  assert.equal(waitWouldLoop(board, "tps", { taskId: "tps", scope: "all" }), true, "esperarse a sí misma");
});

test("las esperas se guardan en el plan y sobreviven a una plantilla", () => {
  const fullBoard = {
    schema: "gateway-assignments-1",
    projectId: "NEH",
    book: "NEH",
    lang: "es-419",
    people: [],
    phases: board.phases,
    teams: board.teams,
  } as unknown as AssignmentsDoc;
  const template = boardToWorkflowTemplate(fullBoard, { name: "FCR" });
  const reread = normalizeWorkflowTemplate(JSON.parse(JSON.stringify(template)))!;
  assert.deepEqual(reread.tasks.find((t) => t.id === "validar")!.waitsFor, [{ phaseId: "p3", scope: "chapter" }]);
  const applied = applyWorkflowToBoard(fullBoard, reread);
  assert.deepEqual(applied.teams.find((t) => t.id === "afinar-tpl")!.waitsFor, [{ taskId: "tpl", scope: "portion" }]);
  const reloaded = normalizeTeams(JSON.parse(JSON.stringify(applied.teams)), []);
  assert.deepEqual(reloaded.find((t) => t.id === "armonizar-notas")!.waitsFor, board.teams.find((t) => t.id === "armonizar-notas")!.waitsFor);
});

console.log(`\nverify-waits: ${passed} checks passed.`);
