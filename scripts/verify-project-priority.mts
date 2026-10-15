/** The order the projects of a space are worked in, and those set aside, as whoever manages leaves them. */
import assert from "node:assert/strict";
import { moveProject, orderedProjects, withPause } from "../src/domain/projectPriority";
import { normalizePmConfig } from "../src/domain/roles";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const p = (projectId: string) => ({ projectId });

test("los proyectos salen en el orden elegido; los que no tienen lugar, después, como venían; los pausados, aparte", () => {
  const { active, paused } = orderedProjects([p("EPH"), p("RUT"), p("EZR"), p("EST")], ["EST", "EZR"], ["EPH"]);
  assert.deepEqual(active.map((x) => x.projectId), ["EST", "EZR", "RUT"]);
  assert.deepEqual(paused.map((x) => x.projectId), ["EPH"]);
});

test("subir y bajar un proyecto escribe el orden entero, y en los bordes no hace nada", () => {
  assert.deepEqual(moveProject(["EST", "EZR", "RUT"], "RUT", -1), ["EST", "RUT", "EZR"]);
  assert.deepEqual(moveProject(["EST", "EZR", "RUT"], "est", 1), ["EZR", "EST", "RUT"], "sin importar mayúsculas");
  assert.deepEqual(moveProject(["EST", "EZR"], "EST", -1), ["EST", "EZR"], "el primero no sube más");
  assert.deepEqual(moveProject(["EST", "EZR"], "EZR", 1), ["EST", "EZR"], "el último no baja más");
});

test("pausar saca un proyecto del orden; reanudarlo lo pone al final del orden", () => {
  const paused = withPause({ projectOrder: ["EPH", "EST", "EZR"], paused: [] }, "EPH", true);
  assert.deepEqual(paused, { projectOrder: ["EST", "EZR"], paused: ["EPH"] });
  assert.deepEqual(withPause(paused, "eph", false), { projectOrder: ["EST", "EZR", "EPH"], paused: [] });
});

test("la configuración guarda el orden y las pausas en mayúsculas, una vez cada uno, y sin ellos queda vacía", () => {
  const config = normalizePmConfig({ projectOrder: ["est", "EZR", "est", 3, ""], paused: ["eph"] });
  assert.deepEqual(config.projectOrder, ["EST", "EZR"]);
  assert.deepEqual(config.paused, ["EPH"]);
  assert.deepEqual(normalizePmConfig({}).projectOrder, []);
});

console.log(`\nverify-project-priority: ${passed} checks passed.`);
