/**
 * A step of a project opened to try, from the lab: which tools can be opened that way, and the launch they get.
 * What is done in a trial never reaches Door43.
 */
import assert from "node:assert/strict";
import { buildLabSolverLaunchContext, isLabLaunch, labWriteDecision, opensForTrial, trialLaunchContext } from "../src/domain/solverLab";
import type { SolverApp } from "../src/domain/solvers";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const tool = (launchUrl: string, extra: Partial<SolverApp> = {}): SolverApp => ({ id: "t", name: "T", launchUrl, kind: launchUrl.startsWith("http") ? "url" : "app", openMode: "tab", ...extra });

test("se pueden probar las pantallas que no guardan por su cuenta; las demás no se ofrecen", () => {
  assert.equal(opensForTrial(tool("/#/solver/checklist?ctx={context}")), true);
  assert.equal(opensForTrial(tool("/#/solver/helps?ctx={context}")), true);
  assert.equal(opensForTrial(tool("/#/solver/scripture?ctx={context}")), true);
  assert.equal(opensForTrial(tool("https://example.org/study?book={book}")), true, "una herramienta de fuera, de solo lectura");
  assert.equal(opensForTrial(tool("/#/solver/afinar?step=notas&ctx={context}")), false, "todavía escribe lo que se responde");
  assert.equal(opensForTrial(tool("/#/solver/aval?ctx={context}")), false);
  assert.equal(opensForTrial(tool("/#/solver/review?mode=pair&ctx={context}", { needsIssue: true })), false, "trabaja sobre el borrador de una subtarea real");
  // «Needs a subtarea» keeps a tool out of the lab's own launcher, which gives it no step; a trial gives it one.
  assert.equal(opensForTrial(tool("/#/solver/checklist?ctx={context}", { needsIssue: true })), true);
});

test("un paso abierto de prueba lleva la tarea y el paso del proyecto, el capítulo entero y ninguna subtarea", () => {
  const base = buildLabSolverLaunchContext({ username: "ana", lang: "es-419", book: "jud", chapter: 1, verseFrom: 1, verseTo: 1, resource: "tpl", contentOrg: "es-419_gl", pmOrg: "es-419_gl" });
  const ctx = trialLaunchContext({ base, task: { id: "tarea-a", name: "Tarea A", rules: [{ resource: "notas" }] }, step: { id: "paso-1", name: "Paso 1" }, chapter: 3 });
  assert.equal(ctx.taskId, "tarea-a");
  assert.equal(ctx.stepId, "paso-1");
  assert.equal(ctx.book, "JUD");
  assert.equal(ctx.ref, "3", "el capítulo entero, como una unidad");
  assert.equal(ctx.chapter, 3);
  assert.equal(ctx.resource, "notas", "el recurso de la tarea");
  assert.equal(ctx.issueNumber, 0);
  assert.equal(isLabLaunch(ctx), true);
});

test("una prueba nunca pide escribir, aunque el lanzamiento del que parte lo pidiera", () => {
  const base = buildLabSolverLaunchContext({ username: "ana", lang: "es-419", book: "JUD", chapter: 1, verseFrom: 1, verseTo: 1, resource: "tpl", contentOrg: "prueba_lab", pmOrg: "prueba_lab", allowWrite: true, unsafeWrite: true });
  assert.equal(labWriteDecision(base).mode, "dcs", "el lanzamiento de partida sí escribía");
  const ctx = trialLaunchContext({ base, task: { id: "tarea-a", name: "Tarea A" }, step: { id: "paso-1", name: "Paso 1" }, chapter: 0 });
  assert.equal(ctx.labAllowWrite, undefined);
  assert.equal(ctx.labUnsafeWrite, undefined);
  assert.equal(labWriteDecision(ctx).mode, "local");
  assert.equal(ctx.chapter, 1, "un capítulo que no es número es el primero");
  assert.equal(ctx.resource, "tpl", "sin recurso propio, el del lanzamiento");
});

console.log(`\nverify-trial-launch: ${passed} checks passed.`);
