/**
 * After the first day of Nehemiah (6 November 2026): whoever reviews a draft could not change a comment once it
 * was written, nor come back to the review once it was approved. What may be changed, by whom, and until when.
 */
import assert from "node:assert/strict";
import type { DcsIssue } from "@ip-lms/dcs-client";
import { refComment } from "../src/domain/commentPlace";
import { canEditComment, commentWords, editedCommentBody, reviewCommentsFrom, resolutionComment, type ReviewComment } from "../src/domain/reviewComments";
import { approveStep, canChangeReview, changeReview, claimStep } from "../src/domain/stepClaim";
import { buildBoard } from "../src/domain/myTasksBoard";
import { emptyCursor } from "../src/domain/readCursor";
import { encodeTaskProgressMarker, isStepDone, getStepRuntime, type TaskProgressMarker } from "../src/domain/taskProgress";
import type { AssignmentsDoc, TaskStep } from "../src/domain/types";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

// Abel (abelper8) translated a stretch of the TPL; Elisha reviewed it.
const AUTHOR = "abelper8";
const REVIEWER = "Elisha";

const said = (id: number, login: string, body: string, edited = false) => ({
  id,
  body,
  user: { login },
  created_at: `2026-11-06T10:0${id}:00Z`,
  updated_at: edited ? `2026-11-06T11:0${id}:00Z` : `2026-11-06T10:0${id}:00Z`,
});

test("quien escribió un comentario puede cambiarlo mientras la revisión sigue abierta", () => {
  const rows = reviewCommentsFrom([said(1, REVIEWER, refComment("NEH", "1:3", "Falta «el» antes de «muro».")), said(2, AUTHOR, refComment("NEH", "1:5", "Aquí dudé."))], AUTHOR);
  assert.equal(canEditComment(rows[0]!, rows, REVIEWER, { reviewOpen: true }), true, "la revisora cambia el suyo");
  assert.equal(canEditComment(rows[0]!, rows, "elisha", { reviewOpen: true }), true, "sin importar mayúsculas");
  assert.equal(canEditComment(rows[0]!, rows, AUTHOR, { reviewOpen: true }), false, "nadie cambia lo que dijo otra persona");
  assert.equal(canEditComment(rows[1]!, rows, AUTHOR, { reviewOpen: true }), true, "el autor también cambia lo suyo");
  assert.equal(canEditComment(rows[0]!, rows, REVIEWER, { reviewOpen: false }), false, "cerrada la revisión, lo dicho queda como está");
  assert.equal(canEditComment(rows[0]!, rows, "", { reviewOpen: true }), false);
});

test("un comentario que ya tuvo respuesta en el mismo lugar, o que se dio por resuelto, ya no se cambia", () => {
  const first = said(1, REVIEWER, refComment("NEH", "1:3", "Falta «el» antes de «muro»."));
  const answer = said(2, AUTHOR, refComment("NEH", "1:3", "Lo agregué."));
  const elsewhere = said(3, AUTHOR, refComment("NEH", "1:4", "Otra cosa."));
  const mine = said(4, REVIEWER, refComment("NEH", "1:3", "Y la coma también."));

  const answered = reviewCommentsFrom([first, answer], AUTHOR);
  assert.equal(canEditComment(answered[0]!, answered, REVIEWER, { reviewOpen: true }), false, "la respuesta hablaría de algo que ya no dice");
  const notAnswered = reviewCommentsFrom([first, elsewhere, mine], AUTHOR);
  assert.equal(canEditComment(notAnswered[0]!, notAnswered, REVIEWER, { reviewOpen: true }), true, "lo dicho de otro versículo, o por la misma persona, no es una respuesta");

  const parsed = reviewCommentsFrom([first], AUTHOR);
  const resolved = reviewCommentsFrom([first, said(5, REVIEWER, resolutionComment(parsed[0]!, 12))], AUTHOR);
  assert.equal(resolved[0]!.resolved?.by, REVIEWER);
  assert.equal(canEditComment(resolved[0]!, resolved, REVIEWER, { reviewOpen: true }), false, "resuelto: ya se atendió tal como estaba");
  assert.equal(canEditComment(parsed[0]!, parsed, REVIEWER, { reviewOpen: true, kept: true }), false, "lo que ya es regla del equipo o del glosario no cambia por debajo");

  // A comment about the whole draft is answered by what somebody else says about the whole draft after it.
  const general = reviewCommentsFrom([said(1, REVIEWER, "Revisa la puntuación."), said(2, AUTHOR, "Hecho.")], AUTHOR);
  assert.equal(canEditComment(general[0]!, general, REVIEWER, { reviewOpen: true }), false);
});

test("el mensaje que la app escribe sola al pedir cambios no se cambia", () => {
  const rows = reviewCommentsFrom([said(1, REVIEWER, `@${AUTHOR} Pido cambios: Te dejé 2 comentarios en el borrador.`)], AUTHOR);
  assert.equal(canEditComment(rows[0]!, rows, REVIEWER, { reviewOpen: true }), false);
});

test("al cambiar un comentario se conserva dónde está y que pide cambios; solo cambian sus palabras", () => {
  const row: ReviewComment = { id: 1, by: REVIEWER, ref: "1:3", text: `@${AUTHOR} Pido cambios: Falta «el».`, at: "", raw: refComment("NEH", "1:3", `@${AUTHOR} Pido cambios: Falta «el».`) };
  assert.deepEqual(commentWords(row), { lead: `@${AUTHOR} Pido cambios: `, words: "Falta «el»." });
  assert.equal(editedCommentBody(row, "  Falta «el» antes de «muro».  "), `**NEH 1:3** — @${AUTHOR} Pido cambios: Falta «el» antes de «muro».`);
  const plain: ReviewComment = { id: 2, by: REVIEWER, ref: "", text: "Revisa la puntuación.", at: "", raw: "Revisa la puntuación." };
  assert.deepEqual(commentWords(plain), { lead: "", words: "Revisa la puntuación." });
  assert.equal(editedCommentBody(plain, "Revisa la puntuación del 1:5."), "Revisa la puntuación del 1:5.");
  const help: ReviewComment = { id: 3, by: REVIEWER, ref: "1:3 §x7k2", text: "Peço mudanças: falta.", at: "", raw: refComment("NEH", "1:3 §x7k2", "Peço mudanças: falta.") };
  assert.equal(editedCommentBody(help, "falta a vírgula."), "**NEH 1:3 §x7k2** — Peço mudanças: falta a vírgula.");
});

test("un comentario cambiado dice que lo fue, para quien ya lo había leído", () => {
  const rows = reviewCommentsFrom([said(1, REVIEWER, "Uno.", true), said(2, REVIEWER, "Dos.")], AUTHOR);
  assert.deepEqual(rows.map((row) => Boolean(row.edited)), [true, false]);
  assert.equal(rows[0]!.raw, "Uno.");
});

// The FCR translation tasks: the draft, then the pair review, which the author also agrees to.
const steps = [
  { id: "borrador", name: "Borrador", solverAppId: "fcr-scripture", closing: "self" },
  { id: "pares", name: "Revisión en pares", solverAppId: "fcr-pair-review", closing: "approval", claimMode: "exclusive", includeAuthorInApproval: true, excludeIssueAssignee: true, excludePriorStepIds: ["borrador"] },
] as unknown as TaskStep[];
const pares = steps[1]!;
const start: TaskProgressMarker = { schema: "gateway-task-progress-2", doneStepIds: ["borrador"], steps: {} } as TaskProgressMarker;
const seated = claimStep(start, pares, REVIEWER);
const reviewed = approveStep(seated, pares, REVIEWER, AUTHOR);
const agreed = approveStep(reviewed, pares, AUTHOR, AUTHOR);

test("quien revisó y aprobó puede volver a su revisión mientras no se entregue", () => {
  assert.equal(isStepDone(reviewed, "pares"), false, "falta el acuerdo del autor");
  assert.equal(isStepDone(agreed, "pares"), true);
  assert.equal(canChangeReview(REVIEWER, steps, seated, pares, AUTHOR, false), false, "sin aprobar todavía no hay nada que reabrir: sigue en ella");
  assert.equal(canChangeReview(REVIEWER, steps, reviewed, pares, AUTHOR, false), true, "aprobada, esperando al autor");
  assert.equal(canChangeReview(REVIEWER, steps, agreed, pares, AUTHOR, false), true, "completa, antes de entregar");
  assert.equal(canChangeReview(REVIEWER, steps, agreed, pares, AUTHOR, true), false, "entregada: ya no");
  assert.equal(canChangeReview(AUTHOR, steps, agreed, pares, AUTHOR, false), false, "el autor no revisa su propio borrador");
  assert.equal(canChangeReview("bea", steps, agreed, pares, AUTHOR, false), false, "ni quien no la revisó");
});

test("al volver, la revisión se abre otra vez: su aprobación y el acuerdo del autor dejan de contar", () => {
  const back = changeReview(agreed, steps, pares, REVIEWER, AUTHOR);
  assert.equal(isStepDone(back, "pares"), false);
  assert.ok(isStepDone(back, "borrador"), "el borrador sigue entregado: no se le devuelve a nadie");
  assert.deepEqual(getStepRuntime(back, "pares").approvals, [], "lo que se aprobó puede cambiar");
  assert.deepEqual(getStepRuntime(back, "pares").assignees, [REVIEWER], "sigue sentada en su revisión");
  // From there on it is a review like any other: she approves again, the author agrees again, and it is done.
  const again = approveStep(approveStep(back, pares, REVIEWER, AUTHOR), pares, AUTHOR, AUTHOR);
  assert.equal(isStepDone(again, "pares"), true);
  assert.equal(changeReview(agreed, steps, pares, "bea", AUTHOR), agreed, "quien no puede, no cambia nada");
});

test("no se vuelve a una revisión cuando lo que viene después ya empezó", () => {
  const more = [...steps, { id: "lectura", name: "Lectura", solverAppId: "fcr-group-reading", closing: "consensus", claimMode: "pool" }] as unknown as TaskStep[];
  assert.equal(canChangeReview(REVIEWER, more, agreed, pares, AUTHOR, false), true);
  const begun = claimStep(agreed, more[2]!, "bea");
  assert.equal(canChangeReview(REVIEWER, more, begun, pares, AUTHOR, false), false);
});

test("en «Mis tareas», la revisión completa que falta entregar se puede abrir desde la tarjeta de quien revisó", () => {
  const plan = {
    schema: "gateway-assignments-1",
    projectId: "NEH",
    book: "NEH",
    title: "Nehemías",
    lang: "es-419",
    settings: { allowSelfAssign: true },
    people: [],
    phases: [{ id: "p1", name: "Traducción", order: 0 }],
    teams: [{ id: "tpl", name: "Traducir TPL", phaseId: "p1", memberIds: [AUTHOR, REVIEWER], orgTeamName: "Equipo", rules: [], steps }],
  } as unknown as AssignmentsDoc;
  const issue = (progress: TaskProgressMarker, state = "open") =>
    ({
      id: 7,
      number: 7,
      title: "NEH 1:1–4 · Traducir TPL",
      state,
      body: encodeTaskProgressMarker(progress),
      labels: [{ id: 1, name: "pm/tarea:tpl" }, { id: 2, name: "pm/estado:en-curso" }],
      assignee: { login: AUTHOR },
      assignees: [{ login: AUTHOR }],
      updated_at: "2026-11-06T10:00:00Z",
    }) as unknown as DcsIssue;
  const cardOf = (progress: TaskProgressMarker) => {
    const issues = [issue(progress)];
    const board = buildBoard({
      session: { username: REVIEWER, canManage: false, teams: [{ id: 1, name: "Equipo", organization: { name: "es-419_gl" } }] } as never,
      pmOrg: "es-419_gl",
      projects: [{ projectId: "NEH", title: "Nehemías", browseProject: true, board: plan, issues, openIssues: issues }],
      decisionIssues: [],
      closedIssues: [],
      cursor: emptyCursor(),
      myLevel: "habilitada",
    });
    return Object.values(board).flat().find((card) => card.issue.number === 7);
  };
  assert.equal(cardOf(reviewed)?.action.kind, "continue", "aprobada y esperando al autor: se abre como siempre");
  const done = cardOf(agreed)?.action;
  assert.equal(done?.kind, "none");
  assert.equal(done?.kind === "none" && done.why, "assigneeDelivers", "lo que falta lo hace el autor");
  assert.equal(done?.kind === "none" && "step" in done ? done.step?.id : undefined, "pares", "y aun así su revisión se puede abrir");
});

console.log(`\n${passed} pruebas pasaron`);
