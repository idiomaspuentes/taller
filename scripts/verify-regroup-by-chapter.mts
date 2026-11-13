/**
 * One subtask per chapter for a task cut by passage, as Ezra's «Frases con nota TPS» was (13 November 2026): the
 * finished chapters stay finished, a chapter with open passages gets one subtask with who sat in them, and the open
 * passages are closed into it.
 *
 *   npm run verify:regroup-by-chapter
 */
import assert from "node:assert/strict";
import type { DcsIssue } from "@ip-lms/dcs-client";
import { shippedWorkflow } from "../src/domain/processes";
import { closedIntoNote, cutByChapter, gatheredNote, isBegun, isTouched, planRegroup } from "../src/domain/regroupByChapter";
import { normalizeInventory } from "../src/domain/store";
import { parseTaskProgressMarker } from "../src/domain/taskProgress";
import type { AssignmentsDoc, InventoryDoc } from "../src/domain/types";
import { encodeWorkOrderMarker, publishableWorkOrders, workOrderIssueBody } from "../src/domain/workOrder";
import { applyWorkflowToBoard } from "../src/domain/workflows";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

// Three chapters of Ezra, two passages each, with a few notes per passage.
const PASSAGES = [
  { chapter: 3, from: 1, to: 6 },
  { chapter: 3, from: 7, to: 13 },
  { chapter: 4, from: 1, to: 10 },
  { chapter: 4, from: 11, to: 24 },
  { chapter: 5, from: 1, to: 10 },
  { chapter: 5, from: 11, to: 17 },
];
const inventory: InventoryDoc = normalizeInventory({
  book: "EZR",
  articles: [],
  portions: PASSAGES.map((p) => {
    const id = `EZR-${p.chapter}-${p.from}`;
    const ref = `EZR ${p.chapter}:${p.from}-${p.to}`;
    const items = (resource: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${resource}-${id}-${i}`, ref, chapter: p.chapter, portionId: id, resource }));
    return {
      id, ref, chapter: p.chapter,
      verses: Array.from({ length: p.to - p.from + 1 }, (_, i) => p.from + i),
      tpl: 1, tps: 1, notas: 3, preguntas: 1,
      tplItems: items("tpl", 1), tpsItems: items("tps", 1), notasItems: items("notas", 3), preguntasItems: items("preguntas", 1),
      academia: [], palabras: [],
    };
  }),
} as never);

const empty = { projectId: "EZR", book: "EZR", books: ["EZR"], teams: [], phases: [], people: [], assignments: [] } as unknown as AssignmentsDoc;
const made = applyWorkflowToBoard(empty, shippedWorkflow("fcr-base")!);
// Ezra was made when «Frases con nota» was cut by passage.
const byPassage: AssignmentsDoc = {
  ...made,
  teams: made.teams.map((task) => {
    if (task.id !== "desafios-tps") return task;
    const { bundle: _b, distributeUnit: _u, distributePolicy: _p, ...rest } = task;
    return rest;
  }),
};

let n = 600;
const progress = (seats: string[], extra: Record<string, unknown> = {}) =>
  `\n<!-- gateway-task-progress ${JSON.stringify({ schema: "gateway-task-progress-2", doneStepIds: [], steps: { revisar: { assignees: seats, approvals: seats.slice(0, 1), work: { done: 5, total: 9 } } }, ...extra })} -->`;
const passages = publishableWorkOrders(byPassage, inventory).filter((o) => o.teamId === "desafios-tps");
const subtask = (chapter: number, from: number, state: "open" | "closed", seats: string[] = [], begun = false): DcsIssue => {
  const order = passages.find((o) => o.chapter === chapter && o.portionIds.includes(`EZR-${chapter}-${from}`))!;
  return {
    number: ++n, id: n, title: `EZR ${order.label}`, state,
    body: `${begun ? "<!-- gt:en-curso -->\n" : ""}${workOrderIssueBody(order)}${seats.length ? progress(seats) : ""}`,
    labels: [{ name: "pm/tarea:desafios-tps" }, ...(begun ? [{ name: "pm/estado:en-curso" }] : [])],
  } as unknown as DcsIssue;
};
const issues = [
  subtask(3, 1, "closed"),
  subtask(3, 7, "closed"),
  subtask(4, 1, "closed"),
  subtask(4, 11, "open", ["miguelcordero", "AnerG", "Keneramk"], true),
  subtask(5, 1, "closed"),
  subtask(5, 11, "open", ["miguelcordero", "AnerG"]),
  // A decision opened from 4:11–13 is not a passage of the task.
  { number: 1474, id: 1474, title: "EZR 4:13 · Decidir", state: "closed", body: `<!-- gateway-work-order ${encodeWorkOrderMarker({ ...passages[0]!, parentIssue: 604 } as never)} -->`, labels: [] } as unknown as DcsIssue,
];

test("las frases con nota pasan a cortarse por capítulo en el plan", () => {
  const cut = cutByChapter(byPassage.teams.find((t) => t.id === "desafios-tps")!);
  assert.deepEqual([cut.bundle?.enabled, cut.bundle?.grain, cut.distributeUnit], [true, "chapter", "chapter"]);
  const plan = planRegroup({ board: byPassage, inventory, taskId: "desafios-tps", issues, at: "2026-11-13T12:00:00Z" });
  assert.equal(plan.board.teams.find((t) => t.id === "desafios-tps")!.bundle?.grain, "chapter");
  assert.equal(plan.board.teams.find((t) => t.id === "desafios-tpl")!.bundle?.grain, "chapter", "las demás tareas, como estaban");
});

test("un capítulo terminado sigue terminado; uno con porciones abiertas tiene una sola tarea con quienes estaban", () => {
  const plan = planRegroup({ board: byPassage, inventory, taskId: "desafios-tps", issues, at: "2026-11-13T12:00:00Z" });
  assert.deepEqual(plan.chapters.map((c) => [c.order.chapter, c.state, c.from.length]), [[3, "closed", 2], [4, "open", 2], [5, "open", 2]]);
  const [three, four, five] = plan.chapters;
  const finished = parseTaskProgressMarker(three!.body);
  assert.deepEqual([finished.doneStepIds, finished.brought?.from], [["revisar"], "porciones"], "terminado, y no cuenta de nuevo para el ritmo");
  const seated = parseTaskProgressMarker(four!.body).steps?.revisar;
  assert.deepEqual(seated?.assignees, ["miguelcordero", "AnerG", "Keneramk"], "quienes estaban sentados en la porción");
  assert.deepEqual([seated?.approvals, seated?.work], [[], undefined], "ni las aprobaciones ni la cuenta de la porción, que eran solo de ella");
  assert.equal(isBegun({ body: four!.body } as DcsIssue), true, "empezada, como su porción");
  assert.equal(isBegun({ body: five!.body } as DcsIssue), false);
  assert.deepEqual(plan.close.map((c) => [c.issue.number, c.into.order.chapter]), [[604, 4], [606, 5]], "solo las porciones abiertas se cierran");
  assert.deepEqual(plan.close.map((c) => c.touched), [true, true], "alguien estaba en ellas: su conversación dice adónde fueron");
  assert.equal(isTouched(subtask(3, 1, "open")), false, "una porción que nadie tocó se cierra sin escribir en ella (Nehemías)");
});

test("correr de nuevo encuentra lo que ya hizo y sigue donde se quedó", () => {
  const first = planRegroup({ board: byPassage, inventory, taskId: "desafios-tps", issues, at: "2026-11-13T12:00:00Z" });
  const four = first.chapters.find((c) => c.order.chapter === 4)!;
  const already = { number: 2001, id: 2001, title: "EZR 4", state: "open", body: four.body, labels: [] } as unknown as DcsIssue;
  const again = planRegroup({ board: first.board, inventory, taskId: "desafios-tps", issues: [...issues, already], at: "2026-11-13T13:00:00Z" });
  const chapter4 = again.chapters.find((c) => c.order.chapter === 4)!;
  assert.equal(chapter4.existing?.number, 2001);
  assert.deepEqual(again.close.filter((c) => c.into === chapter4).map((c) => c.issue.number), [604], "la porción que quedó abierta se cierra en la del capítulo");
});

test("lo que dicen las conversaciones", () => {
  assert.equal(gatheredNote(4, [issues[3]!, issues[2]!]), "Esta tarea junta las porciones del capítulo 4: #603 (cerrada), #604. Lo que se respondió en ellas se ve aquí; la conversación de cada porción sigue en su número.");
  assert.equal(closedIntoNote(4, 2001), "Esta porción se juntó en la tarea del capítulo 4: #2001. Lo que se respondió aquí sigue allí.");
});

test("correr de nuevo cierra el capítulo terminado que quedó abierto porque falló su cierre", () => {
  const first = planRegroup({ board: byPassage, inventory, taskId: "desafios-tps", issues, at: "2026-11-13T12:00:00Z" });
  const three = first.chapters.find((c) => c.order.chapter === 3)!;
  // Created, and the step that closes it failed: it is there, open, with the mark of a finished chapter.
  const left = { number: 2002, id: 2002, title: "EZR 3", state: "open", body: three.body, labels: [] } as unknown as DcsIssue;
  const again = planRegroup({ board: first.board, inventory, taskId: "desafios-tps", issues: [...issues, left], at: "2026-11-13T13:00:00Z" });
  const chapter3 = again.chapters.find((c) => c.order.chapter === 3)!;
  assert.deepEqual([chapter3.existing?.number, chapter3.state, chapter3.closeExisting], [2002, "closed", true]);
  const chapter4 = again.chapters.find((c) => c.order.chapter === 4)!;
  assert.equal(chapter4.closeExisting, undefined, "un capítulo con trabajo abierto no se cierra");
});

console.log(`\nverify-regroup-by-chapter: ${passed} checks passed.`);
