/**
 * What each card of «Mis tareas» is about and whose move it is: one test per row of the table in
 * docs/superpowers/specs/2026-11-24-tarjetas-claras-design.md («La línea y el botón de cada estado»).
 */
import assert from "node:assert/strict";
import type { DcsIssue } from "@ip-lms/dcs-client";
import { boardSections, buildBoard, nextCard, type Board, type BoardCard } from "../src/domain/myTasksBoard";
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
const members = ["carla", "bea", "ana"];
const pairSteps = (withTool = true) => [
  { id: "familiarizar", name: "Estudio", actionLabel: "Estudiar", closing: "automatic", solverAppId: "study" },
  { id: "borrador", name: "Borrador", actionLabel: "Traducir", closing: "self", solverAppId: "editor" },
  {
    id: "pares", name: "Revisión en pares", actionLabel: "Revisar", closing: "approval", claimMode: "exclusive",
    includeAuthorInApproval: true, excludeIssueAssignee: true, excludePriorStepIds: ["borrador"], ...(withTool ? { solverAppId: "pair-review" } : {}),
  },
];
const planOf = (code: string, withTool = true) =>
  ({
    schema: "gateway-assignments-1",
    projectId: code,
    book: code,
    title: code,
    lang: "es-419",
    settings: { allowSelfAssign: true },
    people: [],
    phases: [{ id: "p1", name: "Traducción", order: 0 }, { id: "p2", name: "Afinación", order: 1 }],
    teams: [
      { id: "par", name: "Traducir TPL", phaseId: "p1", memberIds: members, orgTeamName: "Equipo", rules: [], steps: pairSteps(withTool) },
      {
        id: "grupo", name: "Revisión grupal TPL", phaseId: "p1", memberIds: members, orgTeamName: "Equipo", rules: [],
        waitsFor: [{ taskId: "par", scope: "chapter", partial: true }],
        steps: [{ id: "lectura", name: "Lectura grupal", actionLabel: "Revisar", closing: "consensus", claimMode: "pool", minAssignees: 2, maxAssignees: 6, solverAppId: "group-reading" }],
      },
      {
        id: "afinar", name: "Frases con nota TPL", phaseId: "p2", memberIds: members, orgTeamName: "Equipo", rules: [],
        waitsFor: [{ taskId: "grupo", scope: "chapter" }],
        steps: [{ id: "revisar", name: "Revisar frases con nota", actionLabel: "Revisar", closing: "consensus", claimMode: "pool", minAssignees: 2, maxAssignees: 6, solverAppId: "tuning" }],
      },
      {
        id: "lista", name: "Armonizar Notas", phaseId: "p2", memberIds: members, orgTeamName: "Equipo", rules: [],
        steps: [{ id: "comprobar", name: "Notas frente a los textos", actionLabel: "Comprobar", closing: "checklist", claimMode: "pool", minAssignees: 2, maxAssignees: 6, solverAppId: "checklist" }],
      },
    ],
  }) as unknown as AssignmentsDoc;

type Progress = {
  done?: string[];
  seats?: Record<string, string[]>;
  answered?: Record<string, string[]>;
  returned?: Record<string, string>;
  work?: Record<string, { done: number; total: number }>;
};
let n = 0;
function issue(opts: { task: string; title: string; assignee?: string; started?: boolean; progress?: Progress; state?: "open" | "closed"; closedAt?: string }): DcsIssue {
  n++;
  const labels = [{ id: 1, name: `pm/tarea:${opts.task}` }];
  if (opts.started) labels.push({ id: 2, name: "pm/estado:en-curso" });
  const steps: Record<string, object> = {};
  const p = opts.progress;
  const ids = new Set([...Object.keys(p?.seats ?? {}), ...Object.keys(p?.returned ?? {}), ...Object.keys(p?.work ?? {})]);
  for (const id of ids) {
    steps[id] = {
      assignees: p?.seats?.[id] ?? [],
      approvals: p?.answered?.[id] ?? [],
      ...(p?.returned?.[id] ? { returnedBy: p.returned[id] } : {}),
      ...(p?.work?.[id] ? { work: p.work[id] } : {}),
    };
  }
  const body = p ? encodeTaskProgressMarker({ schema: "gateway-task-progress-2", doneStepIds: p.done ?? [], steps } as never) : "";
  return {
    // The book is the milestone, as on Door43: a closed subtarea finds its project by it.
    id: n, number: n, title: opts.title, state: opts.state ?? "open", body, labels, milestone: { title: opts.title.split(" ")[0] },
    assignee: opts.assignee ? { login: opts.assignee } : null,
    assignees: opts.assignee ? [{ login: opts.assignee }] : [],
    updated_at: "2026-11-01T10:00:00Z", closed_at: opts.closedAt,
  } as unknown as DcsIssue;
}

const session = (login: string) => ({ username: login, canManage: false, teams: [{ id: 1, name: "Equipo", organization: { name: PM } }] }) as never;
const bucket = (code: string, issues: DcsIssue[], withTool = true): MyTasksProjectBucket => ({
  projectId: code, title: code, browseProject: true, board: planOf(code, withTool), issues, openIssues: issues.filter((i) => i.state !== "closed"),
});
function boardFor(issues: DcsIssue[], opts: { login?: string; closed?: DcsIssue[]; decisions?: DcsIssue[]; projects?: MyTasksProjectBucket[]; paused?: string[]; withTool?: boolean } = {}): Board {
  return buildBoard({
    session: session(opts.login ?? "carla"),
    pmOrg: PM,
    projects: opts.projects ?? [bucket("NEH", issues, opts.withTool)],
    decisionIssues: opts.decisions ?? [],
    closedIssues: opts.closed ?? [],
    cursor: emptyCursor(),
    myLevel: "habilitada",
    ...(opts.paused ? { priority: { projectOrder: [], paused: opts.paused } } : {}),
  });
}
const where = (board: Board, issue: DcsIssue): BoardCard => {
  const found = Object.values(board).flat().find((c) => c.issue.number === issue.number);
  assert.ok(found, `the card of «${issue.title}» is on the board`);
  return found;
};
const is = (card: BoardCard, state: string, section: string, extra: { returned?: boolean; who?: string[]; part?: string } = {}) => {
  assert.equal(card.situation.state, state);
  assert.equal(card.situation.section, section);
  if (extra.returned !== undefined) assert.equal(card.situation.returned, extra.returned, "returned");
  if (extra.who) assert.deepEqual(card.situation.who, extra.who);
  if (extra.part) assert.equal(card.situation.morePart, extra.part);
};

const studied = ["familiarizar"];
const drafted = ["familiarizar", "borrador"];
const all = ["familiarizar", "borrador", "pares"];

await test("1: un pasaje libre de mi equipo es para tomar", () => {
  const free = issue({ task: "par", title: "NEH 2:1–4 · TPL" });
  is(where(boardFor([free]), free), "free", "take");
});

await test("2: lo libre del libro siguiente va a «Más · Del libro siguiente»", () => {
  const first = issue({ task: "par", title: "EZR 1:1–4 · TPL" });
  const second = issue({ task: "par", title: "NEH 1:1–4 · TPL" });
  const ezr = bucket("EZR", [first]);
  ezr.board.workflowAppliedAt = "2026-10-01T00:00:00Z";
  const neh = bucket("NEH", [second]);
  neh.board.workflowAppliedAt = "2026-11-01T00:00:00Z";
  const board = boardFor([], { projects: [ezr, neh] });
  is(where(board, first), "free", "take");
  is(where(board, second), "nextBook", "more", { part: "later" });
});

await test("3: lo que espera a otra tarea va a «Más · Todavía no se pueden empezar»", () => {
  const reading = issue({ task: "grupo", title: "NEH 1 · Revisión grupal TPL" });
  const tuning = issue({ task: "afinar", title: "NEH 1 · Frases con nota" });
  const card = where(boardFor([reading, tuning]), tuning);
  is(card, "held", "more", { part: "held" });
  assert.notEqual(card.waitsFirstPassage, true);
});

await test("4: mi pasaje asignado y sin empezar me toca, para empezar", () => {
  const mine = issue({ task: "par", title: "NEH 2:1–4 · TPL", assignee: "carla" });
  is(where(boardFor([mine]), mine), "toStart", "mine", { returned: false });
});

await test("5 y 6: mi estudio o mi borrador empezados me tocan, para seguir", () => {
  const study = issue({ task: "par", title: "NEH 2:1–4 · TPL", assignee: "carla", started: true });
  const draft = issue({ task: "par", title: "NEH 2:5–8 · TPL", assignee: "carla", started: true, progress: { done: studied } });
  const board = boardFor([study, draft]);
  is(where(board, study), "ownStep", "mine");
  is(where(board, draft), "ownStep", "mine");
});

await test("7: mi borrador terminado sin nadie que lo revise espera a otras personas, y no dice que alguien lo revisa", () => {
  const mine = issue({ task: "par", title: "NEH 2:1–4 · TPL", assignee: "carla", started: true, progress: { done: drafted } });
  const card = where(boardFor([mine]), mine);
  is(card, "noReviewer", "waiting");
  assert.ok(!card.situation.who?.length);
});

await test("8: con alguien revisando mi borrador, espero, y la tarjeta dice quién", () => {
  const mine = issue({ task: "par", title: "NEH 2:1–4 · TPL", assignee: "carla", started: true, progress: { done: drafted, seats: { pares: ["bea"] } } });
  is(where(boardFor([mine]), mine), "beingReviewed", "waiting", { who: ["bea"] });
});

await test("8 (plan sin herramienta de revisión): la autora tampoco ve «está revisando el borrador de usted misma»", () => {
  const mine = issue({ task: "par", title: "NEH 2:1–4 · TPL", assignee: "carla", started: true, progress: { done: drafted, seats: { pares: ["bea"] } } });
  const card = where(boardFor([mine], { withTool: false }), mine);
  assert.equal(card.action.kind, "approveStep");
  is(card, "beingReviewed", "waiting", { who: ["bea"] });
});

await test("9: me pidieron cambios: me toca, y volvió a mí", () => {
  const mine = issue({ task: "par", title: "NEH 2:1–4 · TPL", assignee: "carla", started: true, progress: { done: studied, seats: { borrador: ["carla"], pares: ["bea"] }, returned: { pares: "bea" } } });
  is(where(boardFor([mine]), mine), "changesAsked", "mine", { returned: true });
});

await test("10: retomé mi borrador por mi cuenta: me toca, pero nadie me lo devolvió", () => {
  const mine = issue({ task: "par", title: "NEH 2:1–4 · TPL", assignee: "carla", started: true, progress: { done: studied, seats: { borrador: ["carla"], pares: ["bea"] }, returned: { pares: "carla" } } });
  is(where(boardFor([mine]), mine), "correcting", "mine", { returned: false });
});

await test("11: quien revisa aprobó y falta mi acuerdo: me toca, y volvió a mí", () => {
  const mine = issue({ task: "par", title: "NEH 2:1–4 · TPL", assignee: "carla", started: true, progress: { done: drafted, seats: { pares: ["bea"] }, answered: { pares: ["bea"] } } });
  is(where(boardFor([mine]), mine), "yourAgreement", "mine", { returned: true, who: ["bea"] });
});

await test("12: todo hecho: falta entregar, y volvió a mí", () => {
  const mine = issue({ task: "par", title: "NEH 2:1–4 · TPL", assignee: "carla", started: true, progress: { done: all } });
  is(where(boardFor([mine]), mine), "toDeliver", "mine", { returned: true });
});

await test("13: lo entregado va a «Más · Terminadas», y lo retirado del plan se distingue", () => {
  const delivered = issue({ task: "par", title: "NEH 2:1–4 · TPL", assignee: "carla", state: "closed", closedAt: "2026-11-23T10:00:00Z", progress: { done: all } });
  const withdrawn = issue({ task: "par", title: "NEH 2:5–8 · TPL", assignee: "carla", state: "closed", closedAt: "2026-11-23T10:00:00Z", progress: { done: studied } });
  const board = boardFor([], { closed: [delivered, withdrawn] });
  is(where(board, delivered), "done", "more", { part: "done" });
  is(where(board, withdrawn), "withdrawn", "more", { part: "done" });
});

await test("14: el borrador de otra persona que nadie revisa es para tomar, y dice de quién es", () => {
  const theirs = issue({ task: "par", title: "NEH 2:1–4 · TPL", assignee: "bea", started: true, progress: { done: drafted } });
  is(where(boardFor([theirs]), theirs), "reviewOffered", "take", { who: ["bea"] });
});

await test("15: reviso el borrador de otra persona: me toca", () => {
  const theirs = issue({ task: "par", title: "NEH 2:1–4 · TPL", assignee: "bea", started: true, progress: { done: drafted, seats: { pares: ["carla"] } } });
  is(where(boardFor([theirs]), theirs), "reviewing", "mine", { who: ["bea"] });
});

await test("16: pedí cambios: espero a que la autora corrija; y si lo retomó ella, también", () => {
  const asked = issue({ task: "par", title: "NEH 2:1–4 · TPL", assignee: "bea", started: true, progress: { done: studied, seats: { borrador: ["bea"], pares: ["carla"] }, returned: { pares: "carla" } } });
  const own = issue({ task: "par", title: "NEH 2:5–8 · TPL", assignee: "bea", started: true, progress: { done: studied, seats: { borrador: ["bea"], pares: ["carla"] }, returned: { pares: "bea" } } });
  const board = boardFor([asked, own]);
  is(where(board, asked), "askedChanges", "waiting", { who: ["bea"] });
  is(where(board, own), "authorCorrecting", "waiting", { who: ["bea"] });
});

await test("17: la autora ya corrigió: me toca mirarlo otra vez", () => {
  const theirs = issue({ task: "par", title: "NEH 2:1–4 · TPL", assignee: "bea", started: true, progress: { done: drafted, seats: { pares: ["carla"] }, returned: { pares: "carla" } } });
  is(where(boardFor([theirs]), theirs), "correctedLook", "mine", { who: ["bea"] });
});

await test("18: aprobé y falta que la autora lo entregue: espero", () => {
  const theirs = issue({ task: "par", title: "NEH 2:1–4 · TPL", assignee: "bea", started: true, progress: { done: all, seats: { pares: ["carla"] }, answered: { pares: ["carla", "bea"] } } });
  is(where(boardFor([theirs]), theirs), "authorDelivers", "waiting", { who: ["bea"] });
});

await test("19: la lectura de un capítulo sin pasajes todavía va a «Más» y espera el primero", () => {
  const draft = issue({ task: "par", title: "NEH 1:1–4 · TPL", assignee: "ana", started: true });
  const reading = issue({ task: "grupo", title: "NEH 1 · Revisión grupal TPL" });
  const card = where(boardFor([draft, reading]), reading);
  assert.equal(card.waitsFirstPassage, true);
  is(card, "groupNotYet", "more", { part: "held" });
});

await test("20: la lectura de un capítulo que ya puede empezar es para tomar", () => {
  const reading = issue({ task: "grupo", title: "NEH 2 · Revisión grupal TPL" });
  is(where(boardFor([reading]), reading), "groupOffered", "take");
});

await test("21: estoy en la lectura: me toca", () => {
  const reading = issue({ task: "grupo", title: "NEH 2 · Revisión grupal TPL", progress: { seats: { lectura: ["carla", "bea"] }, work: { lectura: { done: 10, total: 90 } } } });
  is(where(boardFor([reading]), reading), "group", "mine");
});

await test("21: la tarjeta de la lectura sabe qué pasajes llegaron", () => {
  // As published: the reading lists the chapter's portions; each draft, its own.
  const order = (teamId: string, portionIds: string[], itemIds: string[]) =>
    `<!-- gateway-work-order ${JSON.stringify({ schema: "gateway-work-order-1", key: `k-${teamId}-${portionIds.join("+")}`, teamId, book: "NEH", resource: "ult", portionIds, itemIds })} -->`;
  const reading = issue({ task: "grupo", title: "NEH 2 · Revisión grupal TPL", progress: { seats: { lectura: ["carla", "bea"] } } });
  reading.body = `${order("grupo", ["NEH-2-1", "NEH-2-5"], ["porcion:NEH 2:1-4", "porcion:NEH 2:5-8"])}\n${reading.body}`;
  const draft = issue({ task: "par", title: "NEH 2:5–8 · TPL", assignee: "ana", started: true });
  draft.body = order("par", ["NEH-2-5"], ["porcion:NEH 2:5-8"]);
  const card = where(boardFor([reading, draft]), reading);
  is(card, "group", "mine");
  assert.deepEqual([card.arrivals?.arrived.length, card.arrivals?.missing[0]?.who], [1, "ana"]);
  const other = where(boardFor([issue({ task: "par", title: "NEH 2:9–12 · TPL", assignee: "carla", started: true })]), { number: n } as DcsIssue);
  assert.equal(other.arrivals, undefined, "solo las tarjetas de un paso de grupo que lee por pasajes");
});

await test("22: ya respondí toda la lectura: espero las respuestas de los demás", () => {
  const reading = issue({ task: "grupo", title: "NEH 2 · Revisión grupal TPL", progress: { seats: { lectura: ["carla", "bea"] }, answered: { lectura: ["carla"] }, work: { lectura: { done: 30, total: 90 } } } });
  is(where(boardFor([reading]), reading), "answered", "waiting");
});

await test("23: la lectura terminó y participé: me toca entregarla", () => {
  const reading = issue({ task: "grupo", title: "NEH 2 · Revisión grupal TPL", progress: { done: ["lectura"], seats: { lectura: ["carla", "bea"] } } });
  is(where(boardFor([reading]), reading), "groupToDeliver", "mine", { returned: true });
});

await test("D: una decisión me toca", () => {
  const conflict = issue({ task: "par", title: "NEH 2:1–4 · TPL", assignee: "carla", state: "closed" });
  is(where(boardFor([], { decisions: [conflict] }), conflict), "decide", "mine");
});

await test("una lista que el equipo comprueba, sin autora, es un paso de grupo: no «busca quien revise su borrador»", () => {
  const list = issue({ task: "lista", title: "NEH 2 · Armonizar Notas" });
  const card = where(boardFor([list]), list);
  is(card, "groupOffered", "take");
  assert.ok(!card.situation.who?.length);
});

await test("un paso de Afinación también es de grupo, no la revisión del borrador de nadie", () => {
  const tuning = issue({ task: "afinar", title: "NEH 3 · Frases con nota", progress: { seats: { revisar: ["carla", "bea"] }, work: { revisar: { done: 1, total: 9 } } } });
  is(where(boardFor([tuning]), tuning), "group", "mine");
});

await test("lo que volvió a mí en un proyecto pausado va a «Más · En pausa»", () => {
  const mine = issue({ task: "par", title: "NEH 2:1–4 · TPL", assignee: "carla", started: true, progress: { done: studied, seats: { borrador: ["carla"], pares: ["bea"] }, returned: { pares: "bea" } } });
  is(where(boardFor([mine], { paused: ["NEH"] }), mine), "paused", "more", { part: "paused", returned: false });
});

// The sections, in order, and the one filled button (the B1 of the Phase 1 plan is done here).
const numbers = (cards: BoardCard[]) => cards.map((c) => c.issue.number);

await test("lo que volvió a mí va primero en «Le toca a usted», y el botón lleno es suyo", () => {
  const article = issue({ task: "par", title: "NEH 3:1–4 · TPL", assignee: "carla", started: true, progress: { done: studied } });
  const changes = issue({ task: "par", title: "NEH 2:1–4 · TPL", assignee: "carla", started: true, progress: { done: studied, seats: { borrador: ["carla"], pares: ["bea"] }, returned: { pares: "bea" } } });
  const board = boardFor([article, changes]);
  const sections = boardSections(board);
  assert.deepEqual(numbers(sections.mine), [changes.number, article.number]);
  assert.equal(nextCard(board)?.issue.number, changes.number);
});

await test("falta entregar y falta mi acuerdo también vuelven a mí; lo que la autora retomó por su cuenta no", () => {
  const plain = issue({ task: "par", title: "NEH 1:1–4 · TPL", assignee: "carla", started: true, progress: { done: studied } });
  const own = issue({ task: "par", title: "NEH 1:5–8 · TPL", assignee: "carla", started: true, progress: { done: studied, seats: { borrador: ["carla"], pares: ["bea"] }, returned: { pares: "carla" } } });
  const deliver = issue({ task: "par", title: "NEH 4:1–4 · TPL", assignee: "carla", started: true, progress: { done: all } });
  const agree = issue({ task: "par", title: "NEH 5:1–4 · TPL", assignee: "carla", started: true, progress: { done: drafted, seats: { pares: ["bea"] }, answered: { pares: ["bea"] } } });
  const mine = boardSections(boardFor([plain, own, deliver, agree])).mine;
  assert.deepEqual(new Set(numbers(mine.slice(0, 2))), new Set([deliver.number, agree.number]));
  assert.deepEqual(new Set(numbers(mine.slice(2))), new Set([plain.number, own.number]));
});

await test("dos motivos a la vez: falta mi acuerdo en un pasaje y me pidieron cambios en otro; el botón lleno va a uno de ellos, nunca a lo libre", () => {
  const agree = issue({ task: "par", title: "NEH 5:1–4 · TPL", assignee: "carla", started: true, progress: { done: drafted, seats: { pares: ["bea"] }, answered: { pares: ["bea"] } } });
  const changes = issue({ task: "par", title: "NEH 2:1–4 · TPL", assignee: "carla", started: true, progress: { done: studied, seats: { borrador: ["carla"], pares: ["bea"] }, returned: { pares: "bea" } } });
  const free = issue({ task: "par", title: "NEH 1:1–4 · TPL" });
  const lead = nextCard(boardFor([free, agree, changes]))?.issue.number;
  assert.ok(lead === agree.number || lead === changes.number, `lead ${lead}`);
});

await test("en «Para tomar», la revisión en pares va antes que la lectura en grupo, y las dos antes que el trabajo libre", () => {
  const free = issue({ task: "par", title: "NEH 1:1–4 · TPL" });
  const reading = issue({ task: "grupo", title: "NEH 2 · Revisión grupal TPL" });
  const review = issue({ task: "par", title: "NEH 3:1–4 · TPL", assignee: "bea", started: true, progress: { done: drafted } });
  assert.deepEqual(numbers(boardSections(boardFor([free, reading, review])).take), [review.number, reading.number, free.number]);
});

await test("sin nada mío con botón, el botón lleno está en lo primero de «Para tomar»", () => {
  const waiting = issue({ task: "par", title: "NEH 1:1–4 · TPL", assignee: "carla", started: true, progress: { done: drafted } });
  const free = issue({ task: "par", title: "NEH 3:1–4 · TPL" });
  const board = boardFor([waiting, free]);
  assert.equal(boardSections(board).mine.length, 0);
  assert.equal(nextCard(board)?.issue.number, free.number);
});

await test("lo mío que espera a otras personas no está en «Le toca a usted» aunque esté empezado", () => {
  const nobody = issue({ task: "par", title: "NEH 1:1–4 · TPL", assignee: "carla", started: true, progress: { done: drafted } });
  const someone = issue({ task: "par", title: "NEH 1:5–8 · TPL", assignee: "carla", started: true, progress: { done: drafted, seats: { pares: ["bea"] } } });
  const approved = issue({ task: "par", title: "NEH 2:1–4 · TPL", assignee: "bea", started: true, progress: { done: all, seats: { pares: ["carla"] }, answered: { pares: ["carla", "bea"] } } });
  const sections = boardSections(boardFor([nobody, someone, approved]));
  assert.equal(sections.mine.length, 0);
  assert.deepEqual(new Set(numbers(sections.waiting)), new Set([nobody.number, someone.number, approved.number]));
});

await test("en «Esperan», lo que ya respondí va primero", () => {
  const nobody = issue({ task: "par", title: "NEH 1:1–4 · TPL", assignee: "carla", started: true, progress: { done: drafted } });
  const answered = issue({ task: "grupo", title: "NEH 2 · Revisión grupal TPL", progress: { seats: { lectura: ["carla", "bea"] }, answered: { lectura: ["carla"] }, work: { lectura: { done: 30, total: 90 } } } });
  assert.equal(boardSections(boardFor([nobody, answered])).waiting[0]?.issue.number, answered.number);
});

await test("lo que volvió a mí en un proyecto pausado no lleva el botón lleno", () => {
  const changes = issue({ task: "par", title: "NEH 2:1–4 · TPL", assignee: "carla", started: true, progress: { done: studied, seats: { borrador: ["carla"], pares: ["bea"] }, returned: { pares: "bea" } } });
  const board = boardFor([changes], { paused: ["NEH"] });
  assert.equal(nextCard(board), undefined);
  assert.deepEqual(numbers(boardSections(board).more.paused), [changes.number]);
});

await test("las decisiones van primero en «Le toca a usted», antes que lo que volvió", () => {
  const changes = issue({ task: "par", title: "NEH 2:1–4 · TPL", assignee: "carla", started: true, progress: { done: studied, seats: { borrador: ["carla"], pares: ["bea"] }, returned: { pares: "bea" } } });
  const conflict = issue({ task: "par", title: "NEH 1:1–4 · TPL", assignee: "carla", state: "closed" });
  const board = boardFor([changes], { decisions: [conflict] });
  assert.deepEqual(numbers(boardSections(board).mine), [conflict.number, changes.number]);
});

await test("«Más» lleva sus partes: no se puede empezar, libro siguiente, pausado y terminado", () => {
  const draft = issue({ task: "par", title: "NEH 1:1–4 · TPL", assignee: "ana", started: true });
  const reading = issue({ task: "grupo", title: "NEH 1 · Revisión grupal TPL" });
  const delivered = issue({ task: "par", title: "NEH 2:1–4 · TPL", assignee: "carla", state: "closed", closedAt: "2026-11-23T10:00:00Z", progress: { done: all } });
  const more = boardSections(boardFor([draft, reading], { closed: [delivered] })).more;
  assert.deepEqual(numbers(more.held), [reading.number]);
  assert.deepEqual(numbers(more.done), [delivered.number]);
  assert.deepEqual([more.later.length, more.paused.length], [0, 0]);
});

console.log(`\nverify-card-situation: ${passed} checks passed.`);
