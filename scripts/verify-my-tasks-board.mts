/** «Mis tareas» as cards: which group each subtarea falls in, and the one button it shows. */
import assert from "node:assert/strict";
import type { DcsIssue } from "@ip-lms/dcs-client";
import { closedWithin } from "../src/dcs/issues";
import { buildBoard, nextCard, nextStepOfMine, placeOf, type Board, type BoardCard } from "../src/domain/myTasksBoard";
import type { MyTasksProjectBucket } from "../src/domain/myTasks";
import { emptyCursor } from "../src/domain/readCursor";
import { encodeTaskProgressMarker } from "../src/domain/taskProgress";
import type { AssignmentsDoc, TaskStep } from "../src/domain/types";

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
  progress?: { done?: string[]; seats?: Record<string, string[]>; answered?: Record<string, string[]>; work?: Record<string, { done: number; total: number }> };
  state?: "open" | "closed";
  closedAt?: string;
}): DcsIssue {
  n++;
  const labels = [{ id: 1, name: `pm/tarea:${opts.task}` }];
  if (opts.started) labels.push({ id: 2, name: "pm/estado:en-curso" });
  const steps: Record<string, { assignees: string[]; approvals: string[]; work?: { done: number; total: number } }> = {};
  for (const [id, who] of Object.entries(opts.progress?.seats ?? {})) steps[id] = { assignees: who, approvals: opts.progress?.answered?.[id] ?? [], ...(opts.progress?.work?.[id] ? { work: opts.progress.work[id] } : {}) };
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
  assert.equal(card.canDeliver, false, "con un paso pendiente no se entrega, tampoco desde el menú: la revisión no se salta");
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

await test("en mi tarea, terminado el borrador, la revisión en pares espera a que alguien la tome: no me pide aprobar todavía", () => {
  const pairPlan = {
    ...plan,
    teams: [
      ...plan.teams,
      {
        id: "pares", name: "Traducir TPL", phaseId: "p1", memberIds: ["carla", "bea"], orgTeamName: "Equipo", rules: [],
        steps: [
          { id: "borrador", name: "Borrador" },
          { id: "pares", name: "Revisión en pares", claimMode: "exclusive", excludeIssueAssignee: true, includeAuthorInApproval: true, excludePriorStepIds: ["borrador"] },
        ],
      },
    ],
  } as unknown as AssignmentsDoc;
  const bucketOf = (issues: DcsIssue[]): MyTasksProjectBucket => ({ projectId: "NEH", title: "Nehemías", browseProject: true, board: pairPlan, issues, openIssues: issues });
  const build = (issues: DcsIssue[]) => buildBoard({ session: carla, pmOrg: PM, projects: [bucketOf(issues)], decisionIssues: [], closedIssues: [], cursor: emptyCursor(), myLevel: "habilitada" });

  const fresh = issue({ task: "pares", title: "NEH 2 · Traducir TPL", assignee: "carla" });
  assert.equal(where(build([fresh]), fresh.number)!.group, "todo", "sin empezar, no está en curso");

  const drafted = issue({ task: "pares", title: "NEH 2 · Traducir TPL", assignee: "carla", started: true, progress: { done: ["borrador"] } });
  const waiting = where(build([drafted]), drafted.number)!;
  assert.equal(waiting.action.kind, "none");
  assert.equal(waiting.action.kind === "none" && waiting.action.why, "othersReview");

  const taken = issue({ task: "pares", title: "NEH 2 · Traducir TPL", assignee: "carla", started: true, progress: { done: ["borrador"], seats: { pares: ["bea"] } } });
  assert.equal(where(build([taken]), taken.number)!.action.kind, "approveStep", "con alguien revisando, a la autora le toca confirmar");
});

await test("lo que puedo sumarme sale en el orden del libro, no en el que se tocó por última vez", () => {
  const late = issue({ task: "afinar", title: "NEH 9 · Afinar TPL" });
  const first = issue({ task: "afinar", title: "NEH 2 · Afinar TPL" });
  const middle = issue({ task: "afinar", title: "NEH 5 · Afinar TPL" });
  const board = boardFor([late, first, middle]);
  assert.deepEqual(board.reviews.map((card) => card.issue.number), [first.number, middle.number, late.number]);
});

await test("una tarea libre cuyo paso siguiente es de todo el equipo: me sumo al paso, nadie se queda con la subtarea entera", () => {
  const shared = issue({ task: "afinar", title: "NEH 5 · Afinar TPL" });
  const card = where(boardFor([shared]), shared.number)!;
  assert.equal(card.group, "reviews");
  assert.equal(card.action.kind, "claimStep");
  assert.equal(card.action.kind === "claimStep" && card.action.step.id, "notas");

  const second = issue({ task: "afinar", title: "NEH 5 · Afinar TPL", progress: { done: ["notas"] } });
  const next = where(boardFor([second]), second.number)!;
  assert.equal(next.action.kind === "claimStep" && next.action.step.id, "alinear", "se ofrece el paso que sigue, no uno ya terminado");

  const seated = issue({ task: "afinar", title: "NEH 5 · Afinar TPL", progress: { seats: { notas: ["carla"] } } });
  const mine = where(boardFor([seated]), seated.number)!;
  assert.equal(mine.group, "doing");
  assert.equal(mine.action.kind, "continue");
});

await test("una tarea del equipo con todos sus pasos hechos la entrega quien participó", () => {
  const finished = issue({ task: "afinar", title: "NEH 5 · Afinar TPL", progress: { done: ["notas", "alinear"], seats: { notas: ["carla", "bea"] } } });
  const card = where(boardFor([finished]), finished.number)!;
  assert.equal(card.group, "doing");
  assert.equal(card.action.kind, "deliver");
  assert.equal(card.canDeliver, true);
  const stranger = issue({ task: "afinar", title: "NEH 6 · Afinar TPL", progress: { done: ["notas", "alinear"], seats: { notas: ["bea", "ana"] } } });
  assert.equal(where(boardFor([stranger]), stranger.number), undefined, "quien no participó no la ve para entregar");
});

await test("lo que se hace una vez por capítulo (familiarizarse) cuenta como hecho en las demás porciones de ese capítulo", () => {
  const oncePlan = {
    ...plan,
    teams: [
      ...plan.teams,
      { id: "leer", name: "Traducir Notas", phaseId: "p1", memberIds: ["carla"], orgTeamName: "Equipo", rules: [], steps: [{ id: "familiarizar", name: "Familiarizarse", scope: "chapter-once" }, { id: "borrador", name: "Borrador" }] },
    ],
  } as unknown as AssignmentsDoc;
  const chapterIssue = (title: string, chapter: number, extra: Parameters<typeof issue>[0] | object = {}) => {
    const made = issue({ task: "leer", title, assignee: "carla", ...(extra as object) });
    (made.labels as { id: number; name: string }[]).push({ id: 9, name: `pm/cap:${chapter}` });
    return made;
  };
  const first = chapterIssue("NEH 2:1-8 · Traducir Notas", 2, { started: true, progress: { done: ["familiarizar"], seats: { familiarizar: ["carla"] } } });
  const second = chapterIssue("NEH 2:9-20 · Traducir Notas", 2);
  const other = chapterIssue("NEH 3:1-5 · Traducir Notas", 3);
  const issues = [first, second, other];
  const bucket: MyTasksProjectBucket = { projectId: "NEH", title: "Nehemías", browseProject: true, board: oncePlan, issues, openIssues: issues };
  const board = buildBoard({ session: carla, pmOrg: PM, projects: [bucket], decisionIssues: [], closedIssues: [], cursor: emptyCursor(), myLevel: "habilitada" });
  const same = where(board, second.number)!;
  assert.equal(same.stepsDone, 1, "la otra porción del capítulo 2 ya trae la lectura hecha");
  assert.equal(same.nextStep?.id, "borrador");
  assert.equal(same.onceApplied, true);
  const next = where(board, other.number)!;
  assert.equal(next.stepsDone, 0, "el capítulo 3 es otro capítulo: hay que leerlo");
  assert.equal(next.onceApplied, false);
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

await test("un libro a la vez por equipo: lo libre del libro siguiente espera aparte hasta terminar el actual", () => {
  // Translation already has the next book; the first one still has open work of that task.
  const titus = [issue({ task: "simple", title: "TIT 3 · Traducir Notas" }), issue({ task: "simple", title: "TIT 2 · Traducir Notas", assignee: "bea" })];
  const ruth = [issue({ task: "simple", title: "RUT 1 · Traducir Notas" })];
  const bucket = (projectId: string, at: string, issues: DcsIssue[]): MyTasksProjectBucket => ({ projectId, title: projectId, browseProject: true, board: { ...plan, projectId, workflowAppliedAt: at }, issues, openIssues: issues });
  const build = (projects: MyTasksProjectBucket[]) => buildBoard({ session: carla, pmOrg: PM, projects, decisionIssues: [], closedIssues: [], cursor: emptyCursor(), myLevel: "habilitada" });

  const both = build([bucket("RUT", "2026-11-01T00:00:00Z", ruth), bucket("TIT", "2026-10-01T00:00:00Z", titus)]);
  assert.equal(where(both, titus[0]!.number)!.group, "free", "el libro en curso se ofrece");
  assert.equal(where(both, ruth[0]!.number)!.group, "later", "el siguiente espera aparte");

  // Titus has no open work of that task left: Ruth moves up by itself.
  const done = build([bucket("RUT", "2026-11-01T00:00:00Z", ruth), bucket("TIT", "2026-10-01T00:00:00Z", [])]);
  assert.equal(where(done, ruth[0]!.number)!.group, "free");
  const stillOpen = build([bucket("RUT", "2026-11-01T00:00:00Z", ruth), bucket("TIT", "2026-10-01T00:00:00Z", [titus[1]!])]);
  assert.equal(where(stillOpen, ruth[0]!.number)!.group, "later", "mientras alguien del equipo siga en el libro actual");

  // Projects with no start date cannot be ordered: nothing is held back.
  const undated = build([bucket("RUT", "", ruth), bucket("TIT", "", titus)]);
  assert.equal(where(undated, ruth[0]!.number)!.group, "free");
});

await test("una tarea sin equipo que todavía espera a otra no se ofrece: aparece como en espera, con lo que espera", () => {
  // The task of the second phase has people in the plan but no team yet, and its first step is one people join.
  const noTeam = { ...plan, teams: plan.teams.map((task) => (task.id === "afinar" ? { ...task, orgTeamName: undefined } : task)) } as AssignmentsDoc;
  const draft = issue({ task: "tpl", title: "NEH 3:1–4 · TPL", assignee: "bea" });
  const waits = issue({ task: "afinar", title: "NEH 3 · Afinar TPL" });
  // Whoever runs the projects sees the steps of every task, with a team or not: it is to them it was offered.
  const manager = { username: "carla", canManage: true, teams: [] } as never;
  const build = (issues: DcsIssue[]) => buildBoard({ session: manager, pmOrg: PM, projects: [{ projectId: "NEH", title: "Nehemías", browseProject: true, board: noTeam, issues, openIssues: issues }], decisionIssues: [], closedIssues: [], cursor: emptyCursor(), myLevel: "habilitada" });
  const held = build([draft, waits]);
  assert.equal(held.reviews.some((c) => c.issue.number === waits.number), false, "no se puede sumar a un paso de algo que aún espera");
  assert.deepEqual(held.waiting.filter((c) => c.issue.number === waits.number).map((c) => c.holdText), ["Espera a «Traducir TPL» de @bea"]);
  // Once what it waited for is closed, the step is offered.
  const free = build([waits]);
  assert.equal(free.reviews.some((c) => c.issue.number === waits.number), true);
});

await test("lo libre se ofrece desde el principio del libro: por pasaje, y en un pasaje por el orden de las tareas del plan", () => {
  // Made in the order a plan makes them, which is not the order they are read in.
  const later = issue({ task: "tpl", title: "NEH 2:1–8 · Traducir TPL" });
  const notes = issue({ task: "simple", title: "NEH 1:1–8 · Traducir Notas" });
  const second = issue({ task: "tpl", title: "NEH 1:9–11 · Traducir TPL" });
  const first = issue({ task: "tpl", title: "NEH 1:1–8 · Traducir TPL" });
  const tenth = issue({ task: "tpl", title: "NEH 10 · Traducir TPL" });
  const article = issue({ task: "simple", title: "NEH · Traducir Notas · gracia" });
  const free = boardFor([later, notes, second, first, tenth, article]).free.map((card) => card.issue.number);
  // Chapter 2 before chapter 10; the article, which is of no passage, after the passages.
  assert.deepEqual(free, [first, notes, second, later, tenth, article].map((row) => row.number));
  assert.equal(nextCard(boardFor([later, notes, second, first, tenth, article]))?.issue.number, first.number, "lo primero que se ofrece es el principio del libro");
});

await test("al terminar un paso se sigue con el siguiente si es de la misma persona; la revisión de otros no se abre", () => {
  // Studied, then drafted by whoever has the subtarea, then reviewed by somebody else and confirmed by the author.
  const steps = [
    { id: "estudio", name: "Estudio", solverAppId: "study" },
    { id: "borrador", name: "Borrador", solverAppId: "helps-review" },
    { id: "pares", name: "Revisión", solverAppId: "pair-review", closing: "approval", claimMode: "exclusive", includeAuthorInApproval: true, excludeIssueAssignee: true, excludePriorStepIds: ["borrador"] },
  ] as unknown as TaskStep[];
  const at = (done: string[], seats?: Record<string, string[]>) => issue({ task: "simple", title: "NEH 1:1–2 · Traducir Notas", assignee: "carla", started: true, progress: { done, seats } });

  assert.equal(nextStepOfMine("carla", steps, at([]))?.id, "estudio");
  assert.equal(nextStepOfMine("carla", steps, at(["estudio"]))?.id, "borrador", "tras estudiar, el borrador");
  assert.equal(nextStepOfMine("bea", steps, at(["estudio"])), undefined, "la subtarea de otra persona no se sigue");
  assert.equal(nextStepOfMine("carla", steps, at(["estudio", "borrador"])), undefined, "la revisión que nadie ha tomado es de otros");
  // Somebody reviews it: the author's part there is to confirm after them. The card offers it; nobody is taken to it.
  assert.equal(nextStepOfMine("carla", steps, at(["estudio", "borrador"], { pares: ["bea"] })), undefined);
  assert.equal(nextStepOfMine("carla", steps, at(["estudio", "borrador", "pares"])), undefined, "con todo hecho solo queda entregar");
  assert.equal(nextStepOfMine("carla", [], at([])), undefined);
});

await test("en una ronda que responden todos, quien ya respondió todo la ve en espera hasta que respondan los demás", () => {
  const round = {
    ...plan,
    teams: [
      ...plan.teams,
      { id: "ronda", name: "Desafíos", phaseId: "p2", memberIds: ["carla", "bea", "ana"], orgTeamName: "Equipo", rules: [], steps: [{ id: "revisar", name: "Revisar desafíos", actionLabel: "Revisar", solverAppId: "afinar-notas", closing: "consensus", claimMode: "pool", minAssignees: 2, maxAssignees: 6 }] },
    ],
  } as unknown as AssignmentsDoc;
  const session = (login: string) => ({ username: login, canManage: false, teams: [{ id: 1, name: "Equipo", organization: { name: PM } }] }) as never;
  const boardOf = (login: string, progress: Parameters<typeof issue>[0]["progress"]) => {
    const issues = [issue({ task: "ronda", title: "NEH 1:1–4 · Desafíos", progress })];
    return buildBoard({ session: session(login), pmOrg: PM, projects: [{ projectId: "NEH", title: "Nehemías", browseProject: true, board: round, issues, openIssues: issues }], decisionIssues: [], closedIssues: [], cursor: emptyCursor(), myLevel: "habilitada" });
  };
  const seats = { revisar: ["carla", "bea"] };
  const during = boardOf("carla", { seats, work: { revisar: { done: 10, total: 90 } } });
  assert.equal(during.doing[0]?.action.kind, "continue", "mientras le quedan puntos, es suya");
  const after = boardOf("carla", { seats, answered: { revisar: ["carla"] }, work: { revisar: { done: 30, total: 90 } } });
  assert.equal(after.doing.length, 0);
  assert.deepEqual(after.waiting.map((c) => c.action), [{ kind: "none", why: "othersAnswer", step: round.teams[3]!.steps![0] }], "respondió todo: espera a los demás, y aún puede abrirla");
  assert.equal(boardOf("bea", { seats, answered: { revisar: ["carla"] }, work: { revisar: { done: 30, total: 90 } } }).doing[0]?.action.kind, "continue", "a quien le falta responder le sigue tocando");
  const all = boardOf("carla", { seats, answered: { revisar: ["carla", "bea"] }, work: { revisar: { done: 90, total: 90 } } });
  assert.equal(all.doing[0]?.action.kind, "continue", "con todas las respuestas, vuelve a ser de hacer: ya se puede cerrar");
  // Among what waits it comes first: it is the one the person has worked on.
  const issues = [issue({ task: "afinar", title: "NEH 1 · Afinar TPL" }), issue({ task: "ronda", title: "NEH 3:1–4 · Desafíos", progress: { seats, answered: { revisar: ["carla"] }, work: { revisar: { done: 30, total: 90 } } } })];
  const mixed = buildBoard({ session: session("carla"), pmOrg: PM, projects: [{ projectId: "NEH", title: "Nehemías", browseProject: true, board: round, issues, openIssues: issues }], decisionIssues: [], closedIssues: [], cursor: emptyCursor(), myLevel: "habilitada" });
  if (mixed.waiting.length > 1) assert.equal(mixed.waiting[0]!.action.kind === "none" && mixed.waiting[0]!.action.why, "othersAnswer", "antes que lo que aún no empieza");
});

console.log(`\nverify-my-tasks-board: ${passed} checks passed.`);
