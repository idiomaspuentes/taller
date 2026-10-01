/** «Mis tareas» as cards: which group each subtarea falls in, and the one button it shows. */
import assert from "node:assert/strict";
import type { DcsIssue } from "@ip-lms/dcs-client";
import { closedWithin } from "../src/dcs/issues";
import { buildBoard, nextCard, placeOf, type Board, type BoardCard } from "../src/domain/myTasksBoard";
import type { MyTasksProjectBucket } from "../src/domain/myTasks";
import { emptyCursor } from "../src/domain/readCursor";
import { encodeTaskProgressMarker } from "../src/domain/taskProgress";
import type { AssignmentsDoc } from "../src/domain/types";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

const PM = "es-419_gl";
const plan = {
  schema: "gateway-assignments-1",
  projectId: "NEH",
  book: "NEH",
  title: "Nehemías",
  lang: "es-419",
  settings: { allowSelfAssign: true },
  people: [],
  phases: [{ id: "p1", name: "Traducción", order: 0 }, { id: "p2", name: "Afinación", order: 1 }],
  teams: [
    { id: "tpl", name: "Traducir TPL", phaseId: "p1", memberIds: ["carla", "bea"], orgTeamName: "Equipo", rules: [] },
    {
      id: "afinar",
      name: "Afinar TPL",
      phaseId: "p2",
      memberIds: ["carla", "bea", "ana"],
      orgTeamName: "Equipo",
      waitsFor: [{ taskId: "tpl", scope: "chapter" }],
      rules: [],
      steps: [
        { id: "notas", name: "Revisar notas", solverAppId: "afinar-notas", claimMode: "pool", minAssignees: 2, maxAssignees: 3 },
        { id: "alinear", name: "Alinear", solverAppId: "afinar-alineacion", claimMode: "exclusive" },
      ],
    },
    {
      id: "simple",
      name: "Traducir Notas",
      phaseId: "p1",
      memberIds: ["carla"],
      orgTeamName: "Equipo",
      rules: [],
      steps: [
        { id: "borrador", name: "Borrador", solverAppId: "helps-review" },
        { id: "repaso", name: "Repaso" },
      ],
    },
  ],
} as unknown as AssignmentsDoc;

let n = 0;
function issue(opts: {
  task: string;
  title: string;
  assignee?: string;
  started?: boolean;
  progress?: { done?: string[]; seats?: Record<string, string[]> };
  state?: "open" | "closed";
  closedAt?: string;
}): DcsIssue {
  n++;
  const labels = [{ id: 1, name: `pm/tarea:${opts.task}` }];
  if (opts.started) labels.push({ id: 2, name: "pm/estado:en-curso" });
  const steps: Record<string, { assignees: string[]; approvals: string[] }> = {};
  for (const [id, who] of Object.entries(opts.progress?.seats ?? {})) steps[id] = { assignees: who, approvals: [] };
  const body = opts.progress ? encodeTaskProgressMarker({ schema: "gateway-task-progress-2", doneStepIds: opts.progress.done ?? [], steps } as never) : "";
  return {
    id: n,
    number: n,
    title: opts.title,
    state: opts.state ?? "open",
    body,
    labels,
    assignee: opts.assignee ? { login: opts.assignee } : null,
    assignees: opts.assignee ? [{ login: opts.assignee }] : [],
    updated_at: "2026-10-01T10:00:00Z",
    closed_at: opts.closedAt,
  } as unknown as DcsIssue;
}

const carla = { username: "carla", canManage: false, teams: [{ id: 1, name: "Equipo", organization: { name: PM } }] } as never;

function boardFor(issues: DcsIssue[], extra: { closed?: DcsIssue[]; decisions?: DcsIssue[]; session?: never; level?: "habilitada" | "oyente" } = {}): Board {
  const bucket: MyTasksProjectBucket = { projectId: "NEH", title: "Nehemías", browseProject: true, board: plan, issues, openIssues: issues.filter((i) => i.state !== "closed") };
  return buildBoard({
    session: extra.session ?? carla,
    pmOrg: PM,
    projects: [bucket],
    decisionIssues: extra.decisions ?? [],
    closedIssues: extra.closed ?? [],
    cursor: emptyCursor(),
    myLevel: extra.level ?? "habilitada",
  });
}

const where = (board: Board, number: number): BoardCard | undefined =>
  Object.values(board).flat().find((c) => c.issue.number === number);

await test("una tarea mía sin empezar está en «Para empezar» y su botón la empieza abriendo la herramienta", () => {
  const mine = issue({ task: "tpl", title: "NEH 2 · Traducir TPL", assignee: "carla" });
  const card = where(boardFor([mine]), mine.number)!;
  assert.equal(card.group, "todo");
  assert.equal(card.action.kind, "begin");
  assert.equal(card.started, false);
});

await test("una tarea mía empezada está «En curso» y su botón es seguir", () => {
  const mine = issue({ task: "tpl", title: "NEH 2 · Traducir TPL", assignee: "carla", started: true });
  const card = where(boardFor([mine]), mine.number)!;
  assert.equal(card.group, "doing");
  assert.equal(card.action.kind, "continue");
  assert.equal(card.started, true);
});

await test("con pasos: «Seguir» abre el siguiente paso pendiente, y el avance se cuenta", () => {
  const mine = issue({ task: "simple", title: "NEH 3 · Traducir Notas", assignee: "carla", started: true, progress: { done: ["borrador"] } });
  const card = where(boardFor([mine]), mine.number)!;
  assert.equal(card.action.kind, "continue");
  assert.equal(card.action.kind === "continue" && card.action.step?.id, "repaso");
  assert.equal(card.stepsDone, 1);
  assert.equal(card.stepsTotal, 2);
  assert.equal(card.nextStep?.name, "Repaso");
});

await test("con todos los pasos hechos, la tarea se entrega (no hay que buscar «Cerrar»)", () => {
  const mine = issue({ task: "simple", title: "NEH 3 · Traducir Notas", assignee: "carla", started: true, progress: { done: ["borrador", "repaso"] } });
  const card = where(boardFor([mine]), mine.number)!;
  assert.equal(card.action.kind, "deliver");
  assert.equal(card.canDeliver, true);
});

await test("una libre de mi equipo está en «Libres» y su botón la toma y la empieza", () => {
  const free = issue({ task: "tpl", title: "NEH 4 · Traducir TPL" });
  const card = where(boardFor([free]), free.number)!;
  assert.equal(card.group, "free");
  assert.equal(card.action.kind, "begin");
});

await test("lo que espera a otra tarea está «En espera», sin botón y con la razón", () => {
  const before = issue({ task: "tpl", title: "NEH 1 · Traducir TPL", assignee: "ana" });
  const after = issue({ task: "afinar", title: "NEH 1 · Afinar TPL" });
  const card = where(boardFor([before, after]), after.number)!;
  assert.equal(card.group, "waiting");
  assert.equal(card.action.kind, "none");
  assert.match(card.holdText ?? "", /Espera a «Traducir TPL»/);
});

await test("una revisión en grupo que otra persona tiene: puedo tomarla desde «Revisiones»", () => {
  const theirs = issue({ task: "afinar", title: "NEH 5 · Afinar TPL", assignee: "bea", started: true, progress: { seats: { notas: ["bea"] } } });
  const card = where(boardFor([theirs]), theirs.number)!;
  assert.equal(card.group, "reviews");
  assert.equal(card.action.kind, "claimStep");
  assert.equal(card.action.kind === "claimStep" && card.action.step.id, "notas");
});

await test("si ya estoy sentada en la revisión, la tarea es mía en curso y el botón abre el paso", () => {
  const seated = issue({ task: "afinar", title: "NEH 5 · Afinar TPL", assignee: "bea", started: true, progress: { seats: { notas: ["bea", "carla"] } } });
  const card = where(boardFor([seated]), seated.number)!;
  assert.equal(card.group, "doing");
  assert.equal(card.action.kind, "continue");
  assert.equal(card.canDeliver, false, "la entrega es de quien la tiene asignada");
});

await test("en mi tarea, si el paso siguiente es una revisión de otras personas, no hay botón y se dice por qué", () => {
  // The «alinear» step is exclusive and I am not seated; nobody can claim it but... the assignee; force «othersReview».
  const mine = issue({ task: "afinar", title: "NEH 6 · Afinar TPL", assignee: "carla", started: true, progress: { done: ["notas"], seats: { alinear: ["bea"] } } });
  const card = where(boardFor([mine]), mine.number)!;
  assert.equal(card.group, "doing");
  assert.equal(card.action.kind, "none");
  assert.equal(card.action.kind === "none" && card.action.why, "othersReview");
});

await test("las decisiones van primero, con «Votar»", () => {
  const conflict = issue({ task: "tpl", title: "NEH 2 · Traducir TPL", assignee: "carla", state: "closed" });
  const mine = issue({ task: "tpl", title: "NEH 7 · Traducir TPL", assignee: "carla", started: true });
  const board = boardFor([mine], { decisions: [conflict] });
  assert.equal(board.decide[0]?.issue.number, conflict.number);
  assert.equal(board.decide[0]?.action.kind, "vote");
  assert.equal(nextCard(board)?.issue.number, conflict.number, "lo primero que toca es decidir");
});

await test("«lo que toca ahora»: en curso antes que por empezar, y por empezar antes que libres", () => {
  const todo = issue({ task: "tpl", title: "NEH 8 · Traducir TPL", assignee: "carla" });
  const doing = issue({ task: "tpl", title: "NEH 9 · Traducir TPL", assignee: "carla", started: true });
  const free = issue({ task: "tpl", title: "NEH 10 · Traducir TPL" });
  assert.equal(nextCard(boardFor([todo, doing, free]))?.issue.number, doing.number);
  assert.equal(nextCard(boardFor([todo, free]))?.issue.number, todo.number);
  assert.equal(nextCard(boardFor([free]))?.issue.number, free.number);
});

await test("lo de otras personas que no me toca no aparece", () => {
  const theirs = issue({ task: "tpl", title: "NEH 11 · Traducir TPL", assignee: "bea", started: true });
  assert.equal(where(boardFor([theirs]), theirs.number), undefined);
});

await test("una persona oyente ve lo libre en espera, nunca para tomar", () => {
  const free = issue({ task: "tpl", title: "NEH 12 · Traducir TPL" });
  const card = where(boardFor([free], { level: "oyente" }), free.number)!;
  assert.equal(card.group, "waiting");
  assert.equal(card.action.kind, "none");
});

await test("las terminadas van al final, la más reciente primero, y solo las de los últimos días", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  const a = issue({ task: "tpl", title: "NEH 13 · Traducir TPL", assignee: "carla", state: "closed", closedAt: "2026-10-01T09:00:00Z" });
  const b = issue({ task: "tpl", title: "NEH 14 · Traducir TPL", assignee: "carla", state: "closed", closedAt: "2026-09-30T09:00:00Z" });
  const old = issue({ task: "tpl", title: "NEH 15 · Traducir TPL", assignee: "carla", state: "closed", closedAt: "2026-09-01T09:00:00Z" });
  const recent = closedWithin([b, old, a], 7, now);
  assert.deepEqual(recent.map((i) => i.number), [a.number, b.number]);
  const board = boardFor([], { closed: recent });
  assert.deepEqual(board.done.map((c) => c.issue.number), [a.number, b.number]);
  assert.equal(board.done[0]?.action.kind, "none");
});

await test("el lugar se lee del título: libro y capítulo, o libro y versículos", () => {
  assert.deepEqual(placeOf({ title: "NEH 2 · Traducir TPL 1" } as DcsIssue), { book: "NEH", place: "2" });
  assert.deepEqual(placeOf({ title: "NEH 1:1–8 · TPL" } as DcsIssue), { book: "NEH", place: "1:1–8" });
  assert.deepEqual(placeOf({ title: "1SA 3 · TPL" } as DcsIssue), { book: "1SA", place: "3" });
});

console.log(`\nverify-my-tasks-board: ${passed} checks passed.`);
