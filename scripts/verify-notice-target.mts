/**
 * A notice about a task goes away once the person opened the task or acted on its card (#84): which notices on the
 * phone are about which subtarea, and that every action on a card says which one it touched.
 */
import assert from "node:assert/strict";
import { noticeIssue, noticeToClose } from "../src/domain/noticeTarget";
import { touchingCards, type CardHandlers } from "../src/components/MyTasksBoard";
import type { BoardCard } from "../src/domain/myTasksBoard";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const APP = "https://taller.example.org";

test("un aviso de una subtarea dice cuál por la dirección que abre", () => {
  assert.equal(noticeIssue(`${APP}/#/mis-tareas/42`), 42);
  assert.equal(noticeIssue(`${APP}/#/mis-tareas/42?lista=7`), 42);
  assert.equal(noticeIssue(`${APP}/#/mis-tareas/42/propuestas`), 42);
  assert.equal(noticeIssue(`${APP}/#/mis-tareas/420`), 420, "no confunde 42 con 420");
  assert.equal(noticeIssue(`${APP}/#/mis-tareas`), undefined);
  assert.equal(noticeIssue(`${APP}/#/avisos`), undefined);
  assert.equal(noticeIssue(undefined), undefined);
});

test("«es su turno» se cierra al abrir su tarea, aunque su etiqueta no la nombre", () => {
  const turn = { tag: "turno", data: { url: `${APP}/#/mis-tareas/42` } };
  assert.equal(noticeToClose(turn, ["subtarea-42"], [42]), true);
  assert.equal(noticeToClose(turn, ["subtarea-7"], [7]), false, "el turno de otra tarea se queda");
});

test("por etiqueta sigue como antes, y los avisos de una lista no se tocan", () => {
  assert.equal(noticeToClose({ tag: "subtarea-42", data: { url: `${APP}/#/mis-tareas/42` } }, ["subtarea-42"], []), true);
  assert.equal(noticeToClose({ tag: "asignaciones", data: { url: `${APP}/#/mis-tareas` } }, ["asignaciones"], []), true);
  assert.equal(noticeToClose({ tag: "libres", data: { url: `${APP}/#/avisos` } }, ["subtarea-42"], [42]), false);
  assert.equal(noticeToClose({ tag: "turno", data: null }, [], [42]), false);
});

test("cada cosa que se hace con una tarjeta dice qué tarea se tocó, y la acción sigue", () => {
  const touched: number[] = [];
  const ran: string[] = [];
  const card = { issue: { number: 42 } } as unknown as BoardCard;
  const step = { id: "s", name: "S" } as never;
  const handlers: CardHandlers = {
    onPrimary: () => ran.push("primary"),
    onOpenThread: () => () => ran.push("thread"),
    onDeliver: () => ran.push("deliver"),
    onCorrect: () => undefined,
    onRelease: () => ran.push("release"),
    onOpenNewTab: () => ran.push("tab"),
    onClaimStep: () => ran.push("claim"),
    onApproveStep: () => ran.push("approve"),
    onOpenStep: () => ran.push("open"),
    onToggleStep: () => ran.push("toggle"),
    isExternal: () => false,
    finishesInTool: () => false,
  };
  const on = touchingCards(handlers, (n) => touched.push(n));
  on.onPrimary(card);
  on.onDeliver(card);
  on.onRelease(card);
  on.onOpenNewTab(card);
  on.onClaimStep(card, step);
  on.onApproveStep(card, step);
  on.onOpenStep(card, step);
  on.onToggleStep(card, step);
  assert.deepEqual(ran, ["primary", "deliver", "release", "tab", "claim", "approve", "open", "toggle"]);
  assert.equal(touched.length, 8);
  assert.ok(touched.every((n) => n === 42));

  const thread = on.onOpenThread(card);
  assert.equal(touched.length, 8, "ofrecer la conversación no es abrirla");
  thread!();
  assert.equal(touched.length, 9);
  assert.equal(on.onCorrect(card), undefined, "lo que no se ofrece sigue sin ofrecerse");
  assert.equal(on.isExternal(card), false);
});

console.log(`\nverify-notice-target: ${passed} checks passed.`);
