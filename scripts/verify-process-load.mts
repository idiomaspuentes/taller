/**
 * How a process shares its work out, read before anybody works: no step should leave one person alone with too many
 * items, nor too many people waiting for one. A process can be correct and still fail here; this is the check that a
 * cold run found by hand (Haggai, October 2026: one person answering 110 key terms while three waited).
 *
 *   npm run verify:process-load
 */
import assert from "node:assert/strict";
import { DEFAULT_LOAD_LIMITS, orderSize, processLoad, toolsWithWalks, type StepLoad } from "../src/domain/processLoad";
import { shippedWorkflow } from "../src/domain/processes";
import { DEFAULT_SOLVERS_CATALOG } from "../src/domain/solvers";
import { normalizeInventory } from "../src/domain/store";
import type { AssignmentsDoc, InventoryDoc, TaskStep } from "../src/domain/types";
import { publishableWorkOrders } from "../src/domain/workOrder";
import { applyWorkflowToBoard } from "../src/domain/workflows";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

/** A book with the sizes of Haggai: its four passages, with the notes and questions each one has in the source. */
const PASSAGES = [
  { chapter: 1, from: 1, to: 11, notes: 44, questions: 6 },
  { chapter: 1, from: 12, to: 15, notes: 9, questions: 3 },
  { chapter: 2, from: 1, to: 9, notes: 32, questions: 4 },
  { chapter: 2, from: 10, to: 23, notes: 65, questions: 9 },
];
const inventory: InventoryDoc = normalizeInventory({
  book: "HAG",
  articles: [],
  portions: PASSAGES.map((p) => {
    const id = `HAG-${p.chapter}-${p.from}`;
    const ref = `HAG ${p.chapter}:${p.from}-${p.to}`;
    const items = (resource: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${resource}-${id}-${i}`, ref, chapter: p.chapter, portionId: id, resource }));
    return {
      id,
      ref,
      chapter: p.chapter,
      verses: Array.from({ length: p.to - p.from + 1 }, (_, i) => p.from + i),
      tpl: 1,
      tps: 1,
      notas: p.notes,
      preguntas: p.questions,
      tplItems: items("tpl", 1),
      tpsItems: items("tps", 1),
      notasItems: items("notas", p.notes),
      preguntasItems: items("preguntas", p.questions),
      academia: [],
      palabras: [],
    };
  }),
} as never);

const empty = { projectId: "HAG", book: "HAG", books: ["HAG"], teams: [], phases: [], people: [], assignments: [] } as unknown as AssignmentsDoc;
const fcr = shippedWorkflow("fcr-base")!;
const board = applyWorkflowToBoard(empty, fcr);
const tools = toolsWithWalks([], DEFAULT_SOLVERS_CATALOG.solvers);
const loadOf = (b: AssignmentsDoc, limits = DEFAULT_LOAD_LIMITS) => processLoad(b, inventory, publishableWorkOrders(b, inventory), tools, limits);
const row = (rows: StepLoad[], taskId: string, stepId: string) => rows.find((r) => r.taskId === taskId && r.stepId === stepId)!;
const flagged = (rows: StepLoad[]) => rows.filter((r) => r.flags.length).map((r) => `${r.taskId}/${r.stepId}: ${r.flags.join("+")} (${r.largest} en ${r.largestLabel})`);
const withSteps = (taskId: string, steps: TaskStep[]): AssignmentsDoc => ({ ...board, teams: board.teams.map((task) => (task.id === taskId ? { ...task, steps } : task)) });

test("un paso mide lo que su herramienta recorre: versículos, notas, o los ítems de la subtarea", () => {
  const rows = loadOf(board);
  const draft = row(rows, "tpl", "borrador");
  assert.deepEqual([draft.largest, draft.unit, draft.solo], [14, "verses", true], "el borrador de un texto, por versículos: el pasaje más largo tiene 14");
  const notes = row(rows, "notas-ayuda", "borrador");
  assert.deepEqual([notes.largest, notes.unit, notes.largestLabel.includes("2:10")], [65, "notes", true], "las notas, por nota: 65 en 2:10–23");
  assert.deepEqual([row(rows, "preguntas-ayuda", "borrador").largest, row(rows, "preguntas-ayuda", "borrador").unit], [9, "questions"]);
  const challenges = row(rows, "desafios-tpl", "revisar");
  assert.deepEqual([challenges.largest, challenges.unit, challenges.approx], [65, "notes", true], "los desafíos, por las notas del pasaje (un techo)");
  const terms = row(rows, "palabras-tpl", "revisar");
  assert.deepEqual([terms.largest, terms.approx, terms.walk?.label], [115, true, "términos"], "los términos, estimados por versículo: 23 versículos del capítulo 2");
});

test("lo que se hace una vez por capítulo, lo que marca una lista y lo que hace la máquina no cuentan como carga", () => {
  const rows = loadOf(board);
  assert.equal(row(rows, "tpl", "familiarizar"), undefined);
  assert.equal(rows.some((r) => r.taskId === "publicar"), false);
  assert.equal(rows.some((r) => r.taskId === "armonizar-palabras" && r.stepId !== "acuerdo"), false);
});

test("una ronda abierta no carga a nadie: los 115 términos son de entre dos y seis personas", () => {
  const terms = row(loadOf(board), "palabras-tpl", "revisar");
  assert.deepEqual([terms.solo, terms.people, terms.flags], [false, { min: 2, max: 6 }, []]);
});

test("el proceso de antes se marca: una persona sola con todos los términos del capítulo", () => {
  // Key terms as they were before version 14: one person reviews, then others confirm.
  const round = board.teams.find((t) => t.id === "palabras-tpl")!.steps![0]!;
  const before = withSteps("palabras-tpl", [
    { ...round, id: "revisar", closing: "automatic", claimMode: "exclusive", minAssignees: undefined, maxAssignees: undefined },
    { ...round, id: "confirmar", excludePriorStepIds: ["revisar"] },
  ]);
  const review = row(loadOf(before), "palabras-tpl", "revisar");
  assert.deepEqual([review.solo, review.largest, review.flags, review.waiting], [true, 115, ["solo"], 2]);
  assert.deepEqual(row(loadOf(before), "palabras-tpl", "confirmar").flags, [], "quienes confirman son varios");
});

test("demasiada gente esperando a una sola persona también se marca", () => {
  const round = board.teams.find((t) => t.id === "alinear-tpl")!.steps![0]!;
  const before = withSteps("alinear-tpl", [
    { ...round, id: "alinear", closing: "self", claimMode: "exclusive", minAssignees: undefined, maxAssignees: undefined },
    { ...round, id: "revisar-alineacion", minAssignees: 3, excludePriorStepIds: ["alinear"] },
  ]);
  const align = row(loadOf(before), "alinear-tpl", "alinear");
  assert.deepEqual([align.largest, align.waiting, align.flags], [14, 3, ["waiting"]], "14 versículos no son demasiados, pero tres personas esperan");
  assert.deepEqual(row(loadOf(before, { soloItems: 10, waiting: 3 }), "alinear-tpl", "alinear").flags, ["solo"], "los límites son de la organización");
});

test("una herramienta guardada por la organización toma lo que recorre de la de fábrica", () => {
  const saved = DEFAULT_SOLVERS_CATALOG.solvers.map(({ walks: _walks, ...tool }) => tool);
  const merged = toolsWithWalks(saved, DEFAULT_SOLVERS_CATALOG.solvers);
  const shipped = DEFAULT_SOLVERS_CATALOG.solvers.filter((tool) => tool.walks);
  assert.ok(shipped.length > 0);
  for (const tool of shipped) assert.deepEqual(merged.find((x) => x.id === tool.id)!.walks, tool.walks);
  const order = publishableWorkOrders(board, inventory).find((o) => o.teamId === "tpl")!;
  assert.equal(orderSize(order, board.teams.find((t) => t.id === "tpl")!, inventory).unit, "verses");
});

test("con el proyecto en marcha solo pesa lo asignado sin entregar, sumado por persona", () => {
  const orders = publishableWorkOrders(board, inventory);
  type Hold = { done?: boolean; who?: string };
  const load = (hold: (label: string, stepId: string) => Hold) => processLoad(board, inventory, orders, tools, DEFAULT_LOAD_LIMITS, (order, stepId) => ({ done: false, ...hold(order.label, stepId) }));
  const notes = (label: string) => label.includes("Notas");
  // Nobody took anything: 65 notes in a passage are not yet anybody's load.
  assert.deepEqual(flagged(load(() => ({}))), []);
  assert.equal(row(load(() => ({})), "notas-ayuda", "borrador"), undefined);
  // Ana took the long passage and has not handed it in.
  const one = load((label, stepId) => (notes(label) && label.includes("2:10") && stepId === "borrador" ? { who: "Ana" } : {}));
  assert.deepEqual(flagged(one), ["notas-ayuda/borrador: solo (65 en 2:10–23 · Notas)"]);
  assert.equal(row(one, "notas-ayuda", "borrador").holder, "ana");
  // Two short passages in the same hands add up: 9 and 32 are fine apart, 41 together is not.
  const two = load((label, stepId) => (notes(label) && (label.includes("1:12") || label.includes("2:1–9")) && stepId === "borrador" ? { who: "bea" } : {}));
  assert.deepEqual([row(two, "notas-ayuda", "borrador").largest, row(two, "notas-ayuda", "borrador").holder, row(two, "notas-ayuda", "borrador").flags], [41, "bea", ["solo"]]);
  // Handed in: it is nobody's load any more.
  assert.deepEqual(flagged(load((label) => (notes(label) ? { who: "ana", done: true } : {}))), []);
  // The draft is done and the review is in somebody's hands: only the review counts.
  const half = load((label, stepId) => (notes(label) && label.includes("2:10") ? { who: stepId === "borrador" ? "ana" : "bea", done: stepId === "borrador" } : {}));
  assert.deepEqual(flagged(half), ["notas-ayuda/pares: solo (65 en 2:10–23 · Notas)"]);
});

// What the shipped process still asks of one person with a book of this size. It is a list on purpose: a change to
// the process that adds a line here is a decision somebody takes, not something that slips in.
test("FCR con un libro como Hageo: lo único que carga a una sola persona son las notas de los pasajes largos", () => {
  assert.deepEqual(flagged(loadOf(board)), [
    "notas-ayuda/borrador: solo (65 en 2:10–23 · Notas)",
    "notas-ayuda/pares: solo (65 en 2:10–23 · Notas)",
  ]);
});

console.log(`\nverify-process-load: ${passed} checks passed.`);
