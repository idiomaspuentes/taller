/**
 * A list of proposals to the text: a correction whose changes are each a decision of the team, read together in
 * the list and not as cards and notices of their own.
 *
 *   npm run verify:proposal-list
 */
import assert from "node:assert/strict";
import type { DcsIssue } from "@ip-lms/dcs-client";
import { audienceOf } from "../src/domain/audience";
import { correctionRows } from "../src/domain/corrections";
import { extraItemId, normalizeExtraWork } from "../src/domain/extraWork";
import { buildBoard, type Board, type BoardCard } from "../src/domain/myTasksBoard";
import type { MyTasksProjectBucket } from "../src/domain/myTasks";
import { changesNote, decisionParent, firstToRead, inProposalList, isProposalList, proposalCount, proposalsOfList, withChanges } from "../src/domain/proposalList";
import { emptyCursor } from "../src/domain/readCursor";
import type { AssignmentsDoc, ProjectSettings } from "../src/domain/types";
import { encodeWorkOrderMarker, parseWorkOrderMarker, type WorkOrder } from "../src/domain/workOrder";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const PM = "es-419_gl";
const settings: ProjectSettings = { allowSelfAssign: true, extraWork: [{ id: "x-lista", taskId: "desafios", title: "Corrección 3:1: Correcciones al TPL del capítulo 3", ref: "3:1", proposals: true }, { id: "x-una", taskId: "desafios", title: "Corrección 3:5: una sola cosa", ref: "3:5" }, { id: "x-uno", taskId: "desafios", title: "Corrección 1:1: Correcciones al TPL del capítulo 1", ref: "1:1", proposals: true }] };
const plan = {
  schema: "gateway-assignments-1",
  projectId: "EZR",
  book: "EZR",
  title: "Esdras",
  lang: "es-419",
  settings,
  people: [],
  phases: [{ id: "p1", name: "Afinación", order: 0 }],
  teams: [{ id: "desafios", name: "Desafíos TPL", phaseId: "p1", memberIds: ["kene", "aner"], orgTeamName: "pm-afinadores-tpl", rules: [], steps: [{ id: "revisar", name: "Revisar desafíos", solverAppId: "afinar-notas", claimMode: "pool" }] }],
} as unknown as AssignmentsDoc;

const order = (over: Partial<WorkOrder>): WorkOrder => ({ key: "k", teamId: "desafios", teamName: "Desafíos TPL", book: "EZR", resource: "tpl", chapter: 3, portionIds: [], itemIds: [], itemTypes: [], label: "", ...over });
let n = 100;
const issue = (title: string, marker: Partial<WorkOrder>, state: "open" | "closed" = "open"): DcsIssue => {
  n++;
  return { id: n, number: n, title, state, body: `texto\n\n${encodeWorkOrderMarker(order(marker))}`, labels: [], assignee: null, assignees: [], updated_at: "2026-10-14T10:00:00Z" } as unknown as DcsIssue;
};
const list = issue("EZR 3:1 · Corrección 3:1: Correcciones al TPL del capítulo 3", { key: "EZR|desafios|extra:x-lista", itemIds: [extraItemId("x-lista")] });
const single = issue("EZR 3:5 · Corrección 3:5: una sola cosa", { key: "EZR|desafios|extra:x-una", itemIds: [extraItemId("x-una")] });
const decision = (verse: number, state: "open" | "closed" = "open", listed = true) =>
  issue(`EZR 3:${verse} · Decidir: propuesta de @abel`, { key: `desafios|decision:d${verse}`, portionIds: [`decision:d${verse}`], parentIssue: list.number, ...(listed ? { listed: true } : {}) }, state);
const v10 = decision(10);
const v3 = decision(3, "closed");
const v4 = decision(4);
// Asked after the list of chapter 3, and read before it.
const first = issue("EZR 1:1 · Corrección 1:1: Correcciones al TPL del capítulo 1", { key: "EZR|desafios|extra:x-uno", itemIds: [extraItemId("x-uno")] });
const own = issue("EZR 3:6 · Decidir: propuesta de @kene", { key: "desafios|decision:own", portionIds: ["decision:own"], parentIssue: single.number });

test("el marcador de una decisión guarda de qué subtarea salió y si se lee en su lista; uno sin ellos no cambia", () => {
  assert.equal(parseWorkOrderMarker(v4.body)?.parentIssue, list.number);
  assert.equal(parseWorkOrderMarker(v4.body)?.listed, true);
  assert.equal(parseWorkOrderMarker(own.body)?.listed, undefined, "una decisión abierta desde una herramienta no es de una lista");
  assert.equal(encodeWorkOrderMarker(order({ key: "a" })).includes("parentIssue"), false, "las subtareas de siempre se escriben como antes");
  assert.equal(encodeWorkOrderMarker(order({ key: "a", listed: true })).includes("listed"), false, "sin subtarea de la que salir, no es de ninguna lista");
});

test("la corrección que pide una lista de propuestas lo guarda en el plan, y lo conserva al leerlo de nuevo", () => {
  const from = { ...plan.teams[0]!, id: "comite", phaseId: "p2" };
  const keeps = { ...plan.teams[0]!, rules: [{ resource: "tpl" }] };
  const board = { ...plan, phases: [...plan.phases, { id: "p2", name: "Validación", order: 1 }], teams: [keeps, from], settings: {} } as unknown as AssignmentsDoc;
  const { added } = correctionRows(board, from as never, [{ about: "tpl", where: "3:1", text: "Correcciones al TPL del capítulo 3", proposals: true }, { about: "tpl", where: "3:5", text: "una sola cosa" }]);
  assert.equal(added.length, 2);
  assert.equal(added[0]!.proposals, true);
  assert.equal(added[1]!.proposals, undefined);
  assert.deepEqual(normalizeExtraWork(added)?.map((row) => row.proposals), [true, undefined]);
});

test("una subtarea es una lista de propuestas solo si su corrección lo dice", () => {
  assert.equal(isProposalList(settings, list), true);
  assert.equal(isProposalList(settings, single), false);
  assert.equal(isProposalList(settings, v4), false);
});

test("las propuestas de una lista se leen en el orden del texto, y se cuentan las que faltan", () => {
  const all = [single, own, v10, list, v3, v4];
  assert.deepEqual(proposalsOfList(all, list.number).map((row) => row.number), [v3.number, v4.number, v10.number]);
  assert.deepEqual(proposalCount(all, list.number), { open: 2, total: 3 });
  assert.equal(decisionParent(own), single.number);
  assert.equal(inProposalList(v4), true);
  assert.equal(inProposalList(own), false, "la decisión de una corrección de siempre sigue siendo una tarjeta");
  assert.equal(inProposalList(list), false);
});

test("la lista se abre en la primera por decidir que la persona no votó", () => {
  const rows = proposalsOfList([v10, v3, v4], list.number);
  assert.equal(firstToRead(rows, () => false), 1, "la 3:3 ya está decidida");
  assert.equal(firstToRead(rows, (number) => number === v4.number), 2);
  assert.equal(firstToRead(rows.map((row) => ({ ...row, state: "closed" })), () => false), 0, "todas decididas: la primera");
});

const kene = { username: "kene", canManage: false, teams: [{ id: 1, name: "pm-afinadores-tpl", organization: { name: PM } }] } as never;
const boardFor = (issues: DcsIssue[]): Board => {
  const bucket: MyTasksProjectBucket = { projectId: "EZR", title: "Esdras", browseProject: true, board: plan, issues, openIssues: issues.filter((row) => row.state !== "closed") };
  return buildBoard({ session: kene, pmOrg: PM, projects: [bucket], decisionIssues: [], closedIssues: [], cursor: emptyCursor(), myLevel: "habilitada" });
};
const where = (board: Board, number: number): BoardCard | undefined => Object.values(board).flat().find((card) => card.issue.number === number);

test("en «Mis tareas» la lista es una tarjeta que se abre en sus propuestas y dice cuántas faltan; sus decisiones no salen sueltas", () => {
  const board = boardFor([list, v10, v3, v4, single, own]);
  const card = where(board, list.number)!;
  assert.equal(card.group, "todo");
  assert.equal(card.action.kind, "proposals");
  assert.deepEqual(card.proposalList, { open: 2, total: 3 });
  assert.equal(where(board, v4.number), undefined);
  assert.equal(where(board, v10.number), undefined);
  assert.equal(where(board, own.number)?.group, "decide", "la decisión de otra corrección se vota como siempre");
  assert.notEqual(where(board, single.number)?.action.kind, "proposals");
});

test("las listas de un libro salen capítulo por capítulo, aunque la de un capítulo anterior se pidiera después", () => {
  const board = boardFor([list, v10, v3, v4, first]);
  assert.deepEqual(board.todo.filter((card) => card.action.kind === "proposals").map((card) => card.place), ["1:1", "3:1"]);
});

test("quien gestiona sin ser del equipo también ve la lista como lista, y no como un paso que tomar", () => {
  const manager = { username: "abel", canManage: true, teams: [] } as never;
  const bucket: MyTasksProjectBucket = { projectId: "EZR", title: "Esdras", browseProject: true, board: plan, issues: [list, v4], openIssues: [list, v4] };
  const board = buildBoard({ session: manager, pmOrg: PM, projects: [bucket], decisionIssues: [], closedIssues: [], cursor: emptyCursor(), myLevel: "habilitada" });
  const card = where(board, list.number);
  assert.equal(card?.action.kind, "proposals", `llegó como ${card?.group}/${card?.action.kind}`);
  assert.equal(where(board, v4.number), undefined);
});

test("una propuesta de una lista no es trabajo libre ni aviso de nadie: lo es la lista", () => {
  const project = { board: plan, issues: [list, v4], openIssues: [list, v4] };
  assert.equal(audienceOf({ issue: v4, project, session: kene, pmOrg: PM, myLevel: "habilitada" }).relation, "other");
  assert.equal(audienceOf({ issue: own, project, session: kene, pmOrg: PM, myLevel: "habilitada" }).relation, "free");
  assert.equal(audienceOf({ issue: list, project, session: kene, pmOrg: PM, myLevel: "habilitada" }).relation, "free");
});

test("los cambios de un versículo van juntos: se hacen todos sobre el texto de hoy, y el que ya no está se dice", () => {
  const verse = "Y cuando llegó el mes séptimo,  y los hijos de Israel estaban en las ciudades";
  const done = withChanges(verse, [
    { before: "llegó el mes séptimo", after: "se acercó el mes séptimo" },
    { before: "los hijos de Israel", after: "los hijos de Israel" },
    { before: "en Jerusalén", after: "en la ciudad" },
  ]);
  assert.equal(done.text, "Y cuando se acercó el mes séptimo, y los hijos de Israel estaban en las ciudades");
  assert.deepEqual(done.missing.map((row) => row.before), ["en Jerusalén"]);
});

test("lo que dice la propuesta de un versículo: cada cambio, su causa, por qué y las notas", () => {
  const one = changesNote([{ before: "tenían miedo", after: "había terror sobre ellos", cause: "Explicar la figura", why: "El hebreo dice «con terror sobre ellos».", notes: "n3m4" }]);
  assert.equal(one, "«tenían miedo» → «había terror sobre ellos»\nCausa: Explicar la figura.\nPor qué: El hebreo dice «con terror sobre ellos».\nNotas: n3m4");
  const two = changesNote([{ before: "a", after: "b" }, { before: "c", after: "d", cause: "Completar lo abreviado" }]);
  assert.equal(two, "1. «a» → «b»\n\n2. «c» → «d»\nCausa: Completar lo abreviado.");
});

console.log(`\n${passed} pruebas de las listas de propuestas pasaron.`);
