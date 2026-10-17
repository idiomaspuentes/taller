/**
 * The open subtareas of a book brought up to date with only what changed: the same list as reading it whole.
 */
import assert from "node:assert/strict";
import { SYNC_MAX_AGE_MS, SYNC_SLACK_MS, canSyncFrom, changesSince, mergeChanged } from "../src/domain/issueSync";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const sub = (number: number, state = "open", title = `Subtarea ${number}`) => ({ number, state, title });

test("una que se cerró sale de la lista", () => {
  const merged = mergeChanged([sub(3), sub(2), sub(1)], [sub(2, "closed")]);
  assert.deepEqual(merged.map((i) => i.number), [3, 1]);
});

test("una que cambió (alguien la tomó, avanzó un paso) queda en su lugar con lo nuevo", () => {
  const merged = mergeChanged([sub(3), sub(2), sub(1)], [sub(2, "open", "tomada")]);
  assert.deepEqual(merged.map((i) => i.number), [3, 2, 1]);
  assert.equal(merged[1]!.title, "tomada");
});

test("una nueva entra primero, como las lista Door43", () => {
  const merged = mergeChanged([sub(3), sub(2)], [sub(5), sub(4)]);
  assert.deepEqual(merged.map((i) => i.number), [5, 4, 3, 2]);
});

test("una que se abrió y se cerró entre dos lecturas no aparece", () => {
  assert.deepEqual(mergeChanged([sub(1)], [sub(9, "closed")]).map((i) => i.number), [1]);
});

test("una que se volvió a abrir vuelve a la lista", () => {
  assert.deepEqual(mergeChanged([sub(1)], [sub(7, "open")]).map((i) => i.number), [7, 1]);
});

test("sin cambios, la lista es la misma", () => {
  const known = [sub(2), sub(1)];
  assert.deepEqual(mergeChanged(known, []), known);
});

test("los cambios se piden desde un poco antes de la última lectura (relojes y lo que cambió mientras se leía)", () => {
  const at = "2026-10-17T12:00:00.000Z";
  assert.equal(Date.parse(at) - Date.parse(changesSince(at)), SYNC_SLACK_MS);
});

test("una lista de hace más de seis horas, o sin fecha, se lee entera", () => {
  const now = new Date("2026-10-17T18:00:00Z");
  assert.equal(canSyncFrom("2026-10-17T13:00:00Z", now), true);
  assert.equal(canSyncFrom(new Date(now.getTime() - SYNC_MAX_AGE_MS - 1000).toISOString(), now), false);
  assert.equal(canSyncFrom(undefined, now), false);
  assert.equal(canSyncFrom("no es fecha", now), false);
  assert.equal(canSyncFrom("2026-10-18T18:00:00Z", now), false, "una fecha del futuro (otro reloj) tampoco");
});

console.log(`\nverify-issue-sync: ${passed} checks passed.`);
