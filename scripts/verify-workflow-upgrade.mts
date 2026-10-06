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

test("un paso que el proyecto ya tiene con otro identificador no se agrega otra vez", () => {
  // The project turned its two steps into one open round by hand, in its editor: the step kept its old id.
  const created = applyWorkflowToBoard(empty, fcr);
  const round = fcr.tasks.find((t) => t.id === "palabras-tpl")!.steps![0]!;
  const mine: AssignmentsDoc = {
    ...created,
    workflowVersion: fcr.version - 1,
    teams: created.teams.map((task) => (task.id === "palabras-tpl" ? { ...task, steps: [{ ...round, id: "confirmar", name: "Revisar palabras clave" }] } : task)),
  };
  const result = upgradeBoardToWorkflow(mine, fcr);
  assert.deepEqual(result.steps, [], "no hay nada nuevo que traer");
  assert.deepEqual(result.board.teams.find((t) => t.id === "palabras-tpl")!.steps!.map((s) => s.id), ["confirmar"], "el paso sigue siendo uno, el del proyecto");
});

test("un paso con el nombre que el proceso le daba antes toma el de ahora; el que el proyecto escribió se queda", () => {
  // «Familiarizarse» was the process's own name for the step whose button says «Estudiar»: it is «Estudio» now.
  const study = fcr.tasks.find((t) => t.id === "tpl")!.steps![0]!;
  assert.deepEqual([study.name, study.formerNames], ["Estudio", ["Familiarizarse"]]);
  const created = applyWorkflowToBoard(empty, fcr);
  const before = (name: string): AssignmentsDoc => ({
    ...created,
    workflowVersion: fcr.version - 1,
    teams: created.teams.map((task) => ({ ...task, steps: task.steps?.map((s) => (s.id === study.id ? { ...s, name, names: { pt: "Familiarizar-se" } } : s)) })),
  });
  const result = upgradeBoardToWorkflow(before("Familiarizarse"), fcr);
  const now = result.board.teams.find((t) => t.id === "tpl")!.steps![0]!;
  assert.deepEqual([now.name, now.names?.pt], ["Estudio", "Estudo"]);
  assert.deepEqual([...new Set(result.renamed)], ["Familiarizarse → Estudio"]);
  // Whatever else the step had is as it was.
  assert.equal(now.solverAppId, study.solverAppId);
  const kept = upgradeBoardToWorkflow(before("Leer el capítulo"), fcr);
  assert.equal(kept.board.teams.find((t) => t.id === "tpl")!.steps![0]!.name, "Leer el capítulo");
  assert.deepEqual(kept.renamed, []);
});

test("la lista de un paso que el proceso reescribió sigue al proceso en lo que era suyo, y conserva lo que el proyecto hizo", () => {
  const told = fcr.tasks.find((t) => t.id === "tpl")!.steps!.find((s) => s.id === "borrador")!;
  assert.ok(told.formerChecks?.includes("ser-estar") && !told.checks!.some((c) => c.id === "ser-estar"), "el proceso dejó de preguntar por «ser» o «estar» aparte");
  // A project of before: the list the process used to give, less one check it took out, plus one of its own.
  const before = ["completo", "you", "genero", "referente", "pasado", "ser-estar", "sentidos", "falsos-amigos", "nombres", "ortografia"].map((id) => ({ id, text: `(antes) ${id}` }));
  const ours = { id: "nuestra", text: "«Jacobo», no «Santiago»." };
  const created = applyWorkflowToBoard(empty, fcr);
  const mine: AssignmentsDoc = {
    ...created,
    workflowVersion: fcr.version - 1,
    teams: created.teams.map((task) => (task.id === "tpl" ? { ...task, steps: task.steps!.map((s) => (s.id === "borrador" ? { ...s, checks: [...before, ours] } : s)) } : task)),
  };
  const step = upgradeBoardToWorkflow(mine, fcr).board.teams.find((t) => t.id === "tpl")!.steps!.find((s) => s.id === "borrador")!;
  const ids = step.checks!.map((c) => c.id);
  assert.deepEqual(ids, ["completo", "genero", "una-o-dos", "ortografia", "you", "referente", "nombres", "falsos-amigos", "nuestra"]);
  assert.equal(ids.includes("numeros"), false, "la que el proyecto había quitado no vuelve");
  assert.equal(step.checks!.find((c) => c.id === "completo")!.text, told.checks!.find((c) => c.id === "completo")!.text, "con las palabras de ahora");
  assert.deepEqual(step.checks!.find((c) => c.id === "nuestra"), ours);
  assert.equal("formerChecks" in step, false, "lo que el proceso recuerda de sí mismo no se guarda en el proyecto");
  // Brought up again, nothing moves; and a list that is all the project's own is not touched.
  const again = upgradeBoardToWorkflow({ ...mine, teams: mine.teams.map((task) => (task.id === "tpl" ? { ...task, steps: task.steps!.map((s) => (s.id === "borrador" ? step : s)) } : task)) }, fcr);
  assert.deepEqual(again.board.teams.find((t) => t.id === "tpl")!.steps!.find((s) => s.id === "borrador")!.checks, step.checks);
  const own: AssignmentsDoc = { ...mine, teams: mine.teams.map((task) => (task.id === "tpl" ? { ...task, steps: task.steps!.map((s) => (s.id === "borrador" ? { ...s, checks: [ours] } : s)) } : task)) };
  assert.deepEqual(upgradeBoardToWorkflow(own, fcr).board.teams.find((t) => t.id === "tpl")!.steps!.find((s) => s.id === "borrador")!.checks, [ours]);
});

console.log(`\nverify-workflow-upgrade: ${passed} checks passed.`);
