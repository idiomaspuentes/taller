/** What a corrected text asks to be done again: which tasks get a subtarea for the verses that changed, and which do not. */
import assert from "node:assert/strict";
import type { DcsIssue } from "@ip-lms/dcs-client";
import { extraWorkOrders, normalizeExtraWork } from "../src/domain/extraWork";
import { tasksToRedoAfter } from "../src/domain/processes";
import { correctedRef, portionOfVerse, redoRows, redoTitle, workStateOf, type TextCorrected } from "../src/domain/redoAfterCorrection";
import type { AssignmentsDoc, ProjectTask } from "../src/domain/types";
import { waitBlocks } from "../src/domain/waits";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

// A small process of its own: a text is refined, then a help is checked against it, then a committee endorses.
const task = (id: string, phaseId: string, resource: string, waitsFor?: ProjectTask["waitsFor"]): ProjectTask =>
  ({ id, name: id, description: "", phaseId, memberIds: [], scope: [resource], rules: [{ resource, articleFilter: "all" }], ...(waitsFor ? { waitsFor } : {}) }) as unknown as ProjectTask;
const board = {
  teams: [
    task("traducir", "uno", "texto"),
    task("afinar", "dos", "texto", [{ taskId: "traducir", scope: "chapter" }]),
    task("alinear", "dos", "texto", [{ taskId: "afinar", scope: "chapter" }]),
    task("armonizar", "tres", "ayuda", [{ phaseId: "dos", scope: "chapter" }]),
    task("avalar", "cuatro", "texto", [{ phaseId: "tres", scope: "chapter" }]),
  ],
  phases: [],
  settings: {},
  books: ["JON"],
  book: "JON",
} as unknown as AssignmentsDoc;
const portions = [
  { id: "JON-02-01", book: "JON", chapter: 2, verses: [1, 2], ref: "JON 2:1-2" },
  { id: "JON-02-03", book: "JON", chapter: 2, verses: [3, 4], ref: "JON 2:3-4" },
  { id: "JON-03-01", book: "JON", chapter: 3, verses: [1, 2, 3], ref: "JON 3:1-3" },
];
let number = 100;
const issue = (taskId: string, state: "open" | "closed", portionIds: string[], chapter: number, itemIds: string[] = portionIds.map((id) => `porcion:${id}`)): DcsIssue =>
  ({
    number: ++number,
    state,
    title: `JON ${chapter} · ${taskId}`,
    labels: [{ name: "pm" }, { name: `pm/cap:${chapter}` }, { name: "pm/libro:JON" }, { name: `pm/tarea:${taskId}` }],
    body: `## ${taskId}\n\n<!-- gateway-work-order ${JSON.stringify({ schema: "gateway-work-order-1", key: `JON|${taskId}|${itemIds.join("+")}`, book: "JON", teamId: taskId, resource: "texto", portionIds, itemIds })} -->`,
  }) as unknown as DcsIssue;

const corrected: TextCorrected = { resource: "texto", chapter: 2, from: 3, to: 3, decision: 55, by: "ana" };

test("lo corregido se nombra por su versículo, o por los que el borrador escribe como uno", () => {
  assert.equal(correctedRef(corrected), "2:3");
  assert.equal(correctedRef({ chapter: 1, from: 4, to: 5 }), "1:4-5");
  assert.equal(redoTitle(corrected), "Revisar de nuevo 2:3: se corrigió el texto");
  assert.equal(portionOfVerse(portions, corrected), "JON-02-03", "el pasaje de un versículo es el que lo tiene");
  assert.equal(portionOfVerse(portions, { chapter: 9, from: 1 }), undefined);
});

test("el trabajo de una tarea sobre esos versículos está entregado, en curso, o no existe", () => {
  const issues = [
    issue("afinar", "closed", ["JON-02-01"], 2),
    issue("afinar", "closed", ["JON-02-03"], 2),
    issue("alinear", "open", ["JON-02-03"], 2),
    issue("armonizar", "closed", ["JON-02-01", "JON-02-03"], 2),
    issue("avalar", "closed", ["JON-03-01"], 3),
  ];
  const state = (taskId: string) => workStateOf(taskId, issues, board.settings, corrected, "JON-02-03");
  assert.equal(state("afinar"), "closed");
  assert.equal(state("alinear"), "open", "una subtarea abierta de ese pasaje: lo hará sobre el texto como está");
  assert.equal(state("armonizar"), "closed", "la de un capítulo entero cubre sus pasajes");
  assert.equal(state("avalar"), "none", "la de otro capítulo no cuenta");
  assert.equal(workStateOf("afinar", issues, board.settings, { ...corrected, from: 1, to: 1 }, "JON-02-01"), "closed");
});

test("cada tarea que había entregado recibe una subtarea de esos versículos; la que sigue en curso, ninguna", () => {
  const states: Record<string, "closed" | "open" | "none"> = { afinar: "closed", alinear: "open", armonizar: "closed", avalar: "none" };
  const plan = redoRows(board, ["afinar", "alinear", "armonizar", "avalar"], corrected, "JON-02-03", (id) => states[id]!);
  assert.deepEqual(plan.added.map((row) => [row.taskId, row.title, row.portionId, row.ref, row.redoOf, row.askedBy]), [
    ["afinar", "Revisar de nuevo 2:3: se corrigió el texto", "JON-02-03", "2:3", 55, "ana"],
    ["armonizar", "Revisar de nuevo 2:3: se corrigió el texto", "JON-02-03", "2:3", 55, "ana"],
  ]);
  assert.deepEqual(plan.open, ["alinear"], "de la que sigue en curso se sabe decir, para avisar");
  assert.equal(plan.settings.extraWork?.length, 2);
  assert.deepEqual(redoRows(board, ["traducir"], corrected, "JON-02-03", () => "closed").added.map((row) => row.taskId), ["traducir"], "solo se mira lo que el proceso nombra");
  assert.deepEqual(redoRows(board, [], corrected, "JON-02-03", () => "closed").added, []);
  // Lo que se guarda en el plan se vuelve a leer igual.
  assert.deepEqual(normalizeExtraWork(JSON.parse(JSON.stringify(plan.settings.extraWork))), plan.settings.extraWork);
});

test("una segunda corrección del mismo versículo no pide lo mismo dos veces; la de otro versículo del pasaje, sí", () => {
  const plan = redoRows(board, ["afinar"], corrected, "JON-02-03", () => "closed");
  const withPlan = { ...board, settings: plan.settings } as AssignmentsDoc;
  const again = issue("afinar", "open", ["JON-02-03"], 2, [`extra:${plan.added[0]!.id}`]);
  const issues = [issue("afinar", "closed", ["JON-02-03"], 2), again];
  assert.equal(workStateOf("afinar", issues, withPlan.settings, corrected, "JON-02-03"), "open", "ya hay una abierta para 2:3");
  assert.equal(workStateOf("afinar", issues, withPlan.settings, { ...corrected, from: 4, to: 4 }, "JON-02-03"), "closed", "la de 2:3 no cubre el 2:4: ese se pide");
  // Cerrada la que se pidió, otra corrección del mismo versículo la vuelve a pedir.
  assert.equal(workStateOf("afinar", [issues[0]!, { ...again, state: "closed" } as DcsIssue], withPlan.settings, corrected, "JON-02-03"), "closed");
});

test("lo que se pide de nuevo espera su turno como cualquier subtarea de su tarea: afinar, luego armonizar, luego avalar", () => {
  const plan = redoRows(board, ["afinar", "armonizar", "avalar"], corrected, "JON-02-03", () => "closed");
  const withPlan = { ...board, settings: plan.settings } as AssignmentsDoc;
  const orders = extraWorkOrders(withPlan, { portions } as never);
  assert.deepEqual(orders.map((order) => [order.teamId, order.chapter, order.portionIds, order.label]), [
    ["afinar", 2, ["JON-02-03"], "2:3 · Revisar de nuevo 2:3: se corrigió el texto"],
    ["armonizar", 2, ["JON-02-03"], "2:3 · Revisar de nuevo 2:3: se corrigió el texto"],
    ["avalar", 2, ["JON-02-03"], "2:3 · Revisar de nuevo 2:3: se corrigió el texto"],
  ]);
  const made = orders.map((order) => issue(order.teamId, "open", order.portionIds, order.chapter, order.itemIds));
  const [afinar, armonizar, avalar] = made;
  assert.equal(waitBlocks(afinar!, withPlan, made).length, 0, "la primera puede empezar");
  assert.equal(waitBlocks(armonizar!, withPlan, made).length, 1, "armonizar espera a la fase anterior");
  assert.equal(waitBlocks(avalar!, withPlan, made).length, 1);
  const afterFirst = made.filter((other) => other !== afinar);
  assert.equal(waitBlocks(armonizar!, withPlan, afterFirst).length, 0, "entregada la de afinar, armonizar queda libre");
  assert.equal(waitBlocks(avalar!, withPlan, afterFirst).length, 1, "y el aval sigue esperando a armonizar");
});

test("el paquete del proceso dice qué tareas vuelven a mirar, y tras la corrección de qué texto", () => {
  const shipped = { tpl: tasksToRedoAfter("tpl"), tps: tasksToRedoAfter("tps") };
  assert.equal(shipped.tpl.length > 0 && shipped.tps.length > 0, true, "el proceso que trae la app nombra tareas para sus dos textos");
  assert.equal(shipped.tpl.some((id) => !shipped.tps.includes(id)), true, "revisar un texto no se repite por la corrección del otro");
  assert.equal(shipped.tpl.some((id) => shipped.tps.includes(id)), true, "lo que se lee contra los dos textos se repite por cualquiera");
  assert.deepEqual(tasksToRedoAfter("un recurso que nadie revisa"), []);
  const own = [{ id: "x", name: "x", workflows: [{ id: "w", name: "W", phases: [{ id: "p", name: "P", order: 1 }], tasks: [{ id: "a", name: "A", phaseId: "p", rules: [{ resource: "tpl" }], redoAfter: ["tpl", "tpl", " "] }, { id: "b", name: "B", phaseId: "p", rules: [{ resource: "tpl" }] }] }] }];
  assert.deepEqual(tasksToRedoAfter("tpl", own as never), ["a"], "de un paquete propio se lee lo que dice, cada tarea una vez");
  assert.deepEqual(tasksToRedoAfter("tps", own as never), []);
});

console.log(`\nverify-redo-after-correction: ${passed} checks passed.`);
