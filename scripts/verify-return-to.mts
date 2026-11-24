/** Coming back to «Mis tareas» from a tool: to which subtarea, and what the tool left to do there. */
import assert from "node:assert/strict";
import { markThen, rememberReturnTo, takeReturnTo } from "../src/domain/returnTo";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

test("volver sin encargo da la subtarea y nada más", () => {
  rememberReturnTo(12);
  assert.deepEqual(takeReturnTo(), { issue: 12 });
  assert.equal(takeReturnTo(), null, "leerla la olvida");
});

test("el encargo de la herramienta llega con su subtarea", () => {
  markThen(12, "deliver");
  rememberReturnTo(12);
  assert.deepEqual(takeReturnTo(), { issue: 12, then: "deliver" });
});

test("un encargo de otra subtarea no se cuela", () => {
  markThen(12, "finished");
  rememberReturnTo(13);
  assert.deepEqual(takeReturnTo(), { issue: 13 });
});

test("un encargo se usa una sola vez", () => {
  markThen(12, "deliver");
  rememberReturnTo(12);
  assert.deepEqual(takeReturnTo(), { issue: 12, then: "deliver" });
  rememberReturnTo(12);
  assert.deepEqual(takeReturnTo(), { issue: 12 }, "la vuelta siguiente no entrega otra vez");
});

test("un número que no es una subtarea no deja nada", () => {
  markThen(0, "finished");
  rememberReturnTo(0);
  assert.equal(takeReturnTo(), null);
});

console.log(`\nverify-return-to: ${passed} checks passed.`);
