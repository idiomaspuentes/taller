/**
 * A project is brought up to a newer version of its process without undoing anything the project did.
 */
import assert from "node:assert/strict";
import { shippedWorkflow } from "../src/domain/processes";
import type { AssignmentsDoc, WorkflowTemplate } from "../src/domain/types";
import { applyWorkflowToBoard, upgradeBoardToWorkflow, workflowUpdateFor } from "../src/domain/workflows";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const fcr = shippedWorkflow("fcr-base")!;
const empty = { projectId: "TIT", book: "TIT", teams: [], phases: [], people: [], assignments: [] } as unknown as AssignmentsDoc;

/** The process as it was before publication existed and before a step was added to a task. */
const older: WorkflowTemplate = {
  ...fcr,
  version: 1,
  phases: fcr.phases.filter((phase) => phase.id !== "fcr-publicacion"),
  tasks: fcr.tasks
    .filter((task) => task.id !== "publicar")
    .map((task) => (task.id === "armonizar-palabras" ? { ...task, everyUnit: undefined, steps: task.steps?.slice(1) } : task)),
};

test("el FCR incluye la fase de Publicación con sus dos pasos automáticos", () => {
  const task = fcr.tasks.find((t) => t.id === "publicar")!;
  assert.equal(task.phaseId, "fcr-publicacion");
  assert.deepEqual(task.steps!.map((s) => [s.id, s.closing]), [["comprobar", "automatic"], ["publicar", "automatic"]]);
  assert.deepEqual(task.waitsFor, [{ taskId: "validar", scope: "chapter" }]);
});

test("se avisa solo cuando el proceso del proyecto tiene una versión más nueva", () => {
  const board = applyWorkflowToBoard(empty, older);
  assert.equal(workflowUpdateFor(board, [fcr])?.version, fcr.version);
  assert.equal(workflowUpdateFor(applyWorkflowToBoard(empty, fcr), [fcr]), undefined);
  assert.equal(workflowUpdateFor({ ...board, workflowId: undefined }, [fcr]), undefined, "un proyecto sin proceso no se toca");
});

test("actualizar agrega lo nuevo en su lugar y no cambia lo que el proyecto ya tiene", () => {
  const created = applyWorkflowToBoard(empty, older);
  // The project made its own changes: people on a task, a renamed step, a different minimum.
  const mine: AssignmentsDoc = {
    ...created,
    teams: created.teams.map((task) =>
      task.id === "tpl"
        ? { ...task, memberIds: ["ana"], orgTeamName: "Traducción", steps: task.steps!.map((s) => (s.id === "pares" ? { ...s, name: "Pares (nuestro nombre)", minAssignees: 5 } : s)) }
        : task,
    ),
  };
  const result = upgradeBoardToWorkflow(mine, fcr);
  assert.deepEqual(result.phases, ["Publicación"]);
  assert.deepEqual(result.tasks, ["Publicar"]);
  assert.equal(result.steps.length, 1, "el paso que faltaba en Armonizar Palabras");
  const board = result.board;
  assert.equal(board.workflowVersion, fcr.version);
  assert.deepEqual(board.teams.map((t) => t.id), fcr.tasks.map((t) => t.id), "las tareas quedan en el orden del proceso");
  const tpl = board.teams.find((t) => t.id === "tpl")!;
  assert.deepEqual(tpl.memberIds, ["ana"]);
  assert.equal(tpl.orgTeamName, "Traducción");
  const pares = tpl.steps!.find((s) => s.id === "pares")!;
  assert.equal(pares.name, "Pares (nuestro nombre)");
  assert.equal(pares.minAssignees, 5);
  const palabras = board.teams.find((t) => t.id === "armonizar-palabras")!;
  assert.equal(palabras.everyUnit, true, "gana el ajuste que no tenía");
  assert.deepEqual(palabras.steps!.map((s) => s.id), fcr.tasks.find((t) => t.id === "armonizar-palabras")!.steps!.map((s) => s.id), "el paso nuevo entra en su lugar");
  assert.equal(upgradeBoardToWorkflow(board, fcr).tasks.length, 0, "actualizar dos veces no repite nada");
});

console.log(`\nverify-workflow-upgrade: ${passed} checks passed.`);
