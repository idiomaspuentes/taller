/**
 * A second process on the same engine: translating the Bible into a minority language from what the source project
 * already published. The package is data only (`processes/lengua-minoritaria.json`); nothing under `src/` knows it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DcsIssue } from "@ip-lms/dcs-client";
import { shippedWorkflows, type ProcessPackage } from "../src/domain/processes";
import { normalizeSolversCatalog } from "../src/domain/solvers";
import { closesInItsTool } from "../src/domain/stepClaim";
import type { AssignmentsDoc, InventoryDoc, Portion } from "../src/domain/types";
import { normalizeWaitRules } from "../src/domain/waitRules";
import { pruneWaitRules, waitBlocks, waitReason, waitWouldLoop } from "../src/domain/waits";
import { applyWorkflowToBoard } from "../src/domain/workflows";
import { processProblems } from "../src/domain/workflowCheck";
import { publishableWorkOrders, type WorkOrder, encodeWorkOrderMarker } from "../src/domain/workOrder";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const pack = JSON.parse(readFileSync(join(import.meta.dirname, "..", "processes", "lengua-minoritaria.json"), "utf8")) as ProcessPackage;
const workflow = shippedWorkflows([pack])[0]!;
const empty = { projectId: "TIT", book: "TIT", teams: [], phases: [], people: [], assignments: [] } as unknown as AssignmentsDoc;
const board = applyWorkflowToBoard(empty, workflow);

test("el paquete es válido: sus pasos nombran herramientas que trae y todo tiene nombre en portugués", () => {
  const tools = normalizeSolversCatalog({ solvers: pack.tools ?? [] }).solvers;
  assert.deepEqual(processProblems(pack, { tools, languages: ["pt"] }), []);
});

test("usa las mismas reglas de cierre que el FCR, sin código propio", () => {
  const closings = board.teams.flatMap((task) => (task.steps ?? []).map((step) => step.closing));
  assert.deepEqual([...new Set(closings)].sort(), ["approval", "automatic", "checklist", "self"]);
  const publish = board.teams.find((task) => task.id === "publicar")!;
  assert.ok(publish.steps!.every(closesInItsTool), "la publicación se cierra sola");
});

const portion = (chapter: number, id: string, from: number, to: number): Portion =>
  ({ id, ref: `${chapter}:${from}-${to}`, chapter, verses: [], tpl: 1, tps: 0, notas: 0, preguntas: 0, tplItems: [], tpsItems: [], notasItems: [], preguntasItems: [], academia: [], palabras: [] }) as unknown as Portion;
const inventory = { portions: [portion(1, "A", 1, 9), portion(1, "B", 10, 16), portion(2, "C", 1, 15)], articles: [] } as unknown as InventoryDoc;

test("se reparte por porción al traducir y por capítulo al comprobar, revisar y publicar", () => {
  const orders = publishableWorkOrders(board, inventory);
  const count = (taskId: string) => orders.filter((order) => order.teamId === taskId).length;
  assert.deepEqual([count("traducir"), count("comunidad"), count("consultor"), count("publicar")], [3, 2, 2, 2]);
});

const issue = (number: number, teamId: string, chapter: number, state: "open" | "closed" = "open"): DcsIssue =>
  ({
    number,
    state,
    title: `TIT ${chapter}:1–15 · x`,
    labels: [{ name: `pm/tarea:${teamId}` }, { name: `pm/cap:${chapter}` }],
    body: encodeWorkOrderMarker({ key: `k${number}`, teamId, book: "TIT", resource: "tpl", portionIds: [], itemIds: [`porcion:TIT ${chapter}:1-15`] } as unknown as WorkOrder),
  }) as unknown as DcsIssue;

test("la espera al proyecto fuente sobrevive a guardar y leer, y no se confunde con una tarea propia", () => {
  const rule = { taskId: "publicar", scope: "chapter", source: true } as const;
  assert.deepEqual(normalizeWaitRules(JSON.parse(JSON.stringify([rule]))), [rule]);
  const translate = board.teams.find((task) => task.id === "traducir")!;
  assert.deepEqual(translate.waitsFor, [rule]);
  // This project has a task called «publicar» too: the rule is about the source project's, so it is not a loop.
  assert.deepEqual(pruneWaitRules(translate, board), [rule]);
  assert.equal(waitWouldLoop(board, "publicar", rule), false);
});

test("solo se puede traducir el capítulo que el proyecto fuente ya publicó", () => {
  const mine1 = issue(1, "traducir", 1);
  const mine2 = issue(2, "traducir", 2);
  const source = [issue(117, "publicar", 1, "closed"), issue(118, "publicar", 2, "open"), issue(90, "validar", 1, "open")];
  assert.equal(waitBlocks(mine1, board, [mine1, mine2], source).length, 0, "el capítulo 1 está publicado");
  const held = waitBlocks(mine2, board, [mine1, mine2], source);
  assert.equal(held.length, 1);
  assert.deepEqual(held[0]!.issues.map((i) => i.number), [118]);
  assert.match(waitReason(held, board), /proyecto fuente/);
  assert.equal(waitBlocks(issue(3, "traducir", 3), board, [], source).length, 1, "un capítulo que el proyecto fuente no ha empezado también espera");
  assert.equal(waitBlocks(mine1, board, [mine1], undefined).length, 1, "si no se puede leer el proyecto fuente, espera");
});

test("dentro del proyecto, cada capítulo avanza cuando termina la fase anterior", () => {
  const community = issue(10, "comunidad", 1);
  assert.equal(waitBlocks(community, board, [issue(1, "traducir", 1), community]).length, 1);
  assert.equal(waitBlocks(community, board, [issue(2, "traducir", 2), community]).length, 0, "el capítulo 2 no lo detiene");
});

console.log(`\nverify-second-process: ${passed} checks passed.`);
