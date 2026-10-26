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

test("un proyecto de antes conserva lo suyo al actualizar: su lista pasa a ser del equipo, y nada se quita", () => {
  // The process as it was before the agreement went into each item (21 October): a list of one person, then a
  // step where the team agreed.
  const agreement = { id: "acuerdo", name: "Acuerdo del equipo", closing: "consensus" as const, claimMode: "pool" as const, minAssignees: 3, maxAssignees: 6, solverAppId: "fcr-acuerdo" };
  const before: WorkflowTemplate = {
    ...fcr,
    version: fcr.version - 1,
    tasks: fcr.tasks.map((task) =>
      task.id.startsWith("armonizar-") ? { ...task, steps: [...(task.steps ?? []).map(({ claimMode: _c, minAssignees: _min, maxAssignees: _max, ...step }) => step), agreement] } : task,
    ),
  };
  const agreements = (doc: AssignmentsDoc) => doc.teams.flatMap((task) => task.steps ?? []).filter((step) => step.id === "acuerdo");
  const board = applyWorkflowToBoard(empty, before);
  assert.equal(agreements(board).length, 3);
  assert.equal(workflowUpdateFor(board, [fcr])?.version, fcr.version, "se le ofrece traer lo nuevo");
  const result = upgradeBoardToWorkflow(board, fcr);
  assert.equal(agreements(result.board).length, 3, "un paso que el proyecto tiene no se quita");
  const list = result.board.teams.find((task) => task.id === "armonizar-notas")!.steps!.find((step) => step.closing === "checklist")!;
  assert.deepEqual([list.claimMode, list.minAssignees], ["pool", 3], "la lista gana lo que no tenía: es del equipo, entre tres");
  assert.deepEqual([result.phases, result.tasks, result.steps], [[], [], []]);
  assert.equal(result.board.teams.length, board.teams.length);
});

test("un proyecto con una lista por texto sigue con las suyas: no recibe además la lista única", () => {
  // The process as it was while each text had a list of its own over the same notes.
  const list = (id: string, name: string) => ({ id, name, solverAppId: "fcr-checklist", closing: "checklist" as const, checklist: [{ id: "q", text: "¿Está bien?" }] });
  const before: WorkflowTemplate = {
    ...fcr,
    version: fcr.version - 1,
    tasks: fcr.tasks.map((task) =>
      task.id === "armonizar-notas"
        ? { ...task, steps: [list("notas-tpl", "Notas frente al TPL"), list("notas-tps", "Notas frente al TPS"), list("academia", "Academia"), { id: "acuerdo", name: "Acuerdo del equipo", closing: "consensus" as const, claimMode: "pool" as const, minAssignees: 3, solverAppId: "fcr-acuerdo" }] }
        : task,
    ),
  };
  const result = upgradeBoardToWorkflow(applyWorkflowToBoard(empty, before), fcr);
  assert.deepEqual(result.board.teams.find((task) => task.id === "armonizar-notas")!.steps!.map((step) => step.id), ["notas-tpl", "notas-tps", "academia", "acuerdo"]);
  assert.deepEqual(result.steps, [], "ningún paso de más: sería el mismo trabajo dos veces");
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

test("una pregunta del proceso gana lo que el proceso dice ahora de ella; la que el proyecto cambió conserva lo suyo", () => {
  // The process before «publicado» was asked once per article, and a project that wrote its own wording of it.
  const strip = (task: WorkflowTemplate["tasks"][number]) =>
    task.id === "armonizar-notas" ? { ...task, steps: task.steps?.map((step) => (step.checklist ? { ...step, checklist: step.checklist.map(({ per, ...question }) => (question.id === "publicado" ? question : { ...question, ...(per ? { per } : {}) })) } : step)) } : task;
  const before: WorkflowTemplate = { ...fcr, version: fcr.version - 1, tasks: fcr.tasks.map(strip) };
  const board = applyWorkflowToBoard(empty, before);
  const listOf = (doc: AssignmentsDoc) => doc.teams.find((t) => t.id === "armonizar-notas")!.steps!.find((s) => s.id === "notas-textos")!.checklist!;
  assert.equal(listOf(board).find((q) => q.id === "publicado")!.per, undefined);
  const mine: AssignmentsDoc = { ...board, workflowVersion: fcr.version - 1, teams: board.teams.map((t) => (t.id === "armonizar-notas" ? { ...t, steps: t.steps!.map((s) => (s.id === "notas-textos" ? { ...s, checklist: s.checklist!.map((q) => (q.id === "sentido" ? { ...q, text: "¿Tiene sentido?" } : q)) } : s)) } : t)) };
  const after = upgradeBoardToWorkflow(mine, fcr).board;
  assert.equal(listOf(after).find((q) => q.id === "publicado")!.per, "article");
  assert.equal(listOf(after).find((q) => q.id === "sentido")!.text, "¿Tiene sentido?", "lo que el proyecto escribió se queda");
  // How the step is done, said as the process said it before: it says it as the process does now.
  const stepOf = (doc: AssignmentsDoc) => doc.teams.find((t) => t.id === "armonizar-notas")!.steps!.find((s) => s.id === "notas-textos")!;
  const old = "Lee la nota junto al TPL y al TPS de su versículo.\nMarca «Todo bien» o anota qué hay que cambiar.\nSigue hasta revisarlas todas.";
  const said = { ...mine, teams: mine.teams.map((t) => (t.id === "armonizar-notas" ? { ...t, steps: t.steps!.map((s) => (s.id === "notas-textos" ? { ...s, description: old } : s)) } : t)) };
  assert.match(stepOf(upgradeBoardToWorkflow(said, fcr).board).description!, /un texto a la vez/);
  assert.equal("formerDescriptions" in stepOf(upgradeBoardToWorkflow(said, fcr).board), false, "lo que el proceso recuerda de sí mismo no se guarda en el proyecto");
  // One the project wrote itself stays.
  const own = { ...mine, teams: mine.teams.map((t) => (t.id === "armonizar-notas" ? { ...t, steps: t.steps!.map((s) => (s.id === "notas-textos" ? { ...s, description: "Nuestra forma." } : s)) } : t)) };
  assert.equal(stepOf(upgradeBoardToWorkflow(own, fcr).board).description, "Nuestra forma.");
});

test("una pregunta que el proceso reformuló llega reformulada; la que el equipo reescribió se queda, y lo viejo no se guarda", () => {
  // The project as it was made before the questions of the TPS were said of the note (26 October).
  const listOf = (doc: AssignmentsDoc) => doc.teams.find((t) => t.id === "armonizar-notas")!.steps!.find((s) => s.id === "notas-textos")!.checklist!;
  const board = applyWorkflowToBoard(empty, fcr);
  assert.equal(listOf(board).some((q) => "formerTexts" in q), false, "un proyecto nuevo no guarda lo que el proceso preguntaba antes");
  const was = (text: string, id: string) => (q: ReturnType<typeof listOf>[number]) => (q.id === id ? { ...q, text, texts: { pt: "antes" } } : q);
  const old: AssignmentsDoc = {
    ...board,
    workflowVersion: fcr.version - 1,
    teams: board.teams.map((t) => (t.id === "armonizar-notas" ? { ...t, steps: t.steps!.map((s) => (s.id === "notas-textos" ? { ...s, checklist: s.checklist!.map(was("¿Explica bien el texto del TPS?", "explica")).map(was("¿Nuestra pregunta?", "camino")) } : s)) } : t)),
  };
  const after = listOf(upgradeBoardToWorkflow(old, fcr).board);
  assert.equal(after.find((q) => q.id === "explica")!.text, "En el TPS, ¿se ve el cambio que sugiere la nota, o uno parecido?");
  assert.equal(after.find((q) => q.id === "explica")!.texts?.pt, "No TPS, dá para ver a mudança que a nota sugere, ou uma parecida?", "y en portugués");
  assert.equal(after.some((q) => q.id === "camino"), false, "la que el proceso dejó de hacer se quita, aunque el equipo la hubiera reescrito");
  // One the team added itself stays.
  const added = { ...old, teams: old.teams.map((t) => (t.id === "armonizar-notas" ? { ...t, steps: t.steps!.map((s) => (s.id === "notas-textos" ? { ...s, checklist: [...s.checklist!, { id: "nuestra", text: "¿Nuestra pregunta?" }] } : s)) } : t)) };
  assert.equal(listOf(upgradeBoardToWorkflow(added, fcr).board).find((q) => q.id === "nuestra")?.text, "¿Nuestra pregunta?");
  assert.equal(after.some((q) => "formerTexts" in q), false);
});

test("una pregunta nueva del proceso llega a los proyectos hechos antes de ella, en su lugar, y solo a esos", () => {
  const listOf = (doc: AssignmentsDoc) => doc.teams.find((t) => t.id === "armonizar-notas")!.steps!.find((s) => s.id === "notas-textos")!.checklist!;
  const board = applyWorkflowToBoard(empty, fcr);
  // As a project made before «figura» and «llaves» was.
  const older: AssignmentsDoc = { ...board, workflowVersion: 46, teams: board.teams.map((t) => (t.id === "armonizar-notas" ? { ...t, steps: t.steps!.map((s) => (s.id === "notas-textos" ? { ...s, checklist: s.checklist!.filter((q) => q.id !== "figura" && q.id !== "llaves") } : s)) } : t)) };
  const ids = listOf(upgradeBoardToWorkflow(older, fcr).board).map((q) => q.id);
  assert.equal(ids[ids.indexOf("sentido") + 1], "figura", "después de la pregunta que la precede en el proceso");
  assert.equal(ids[ids.indexOf("diferencias") + 1], "llaves");
  assert.equal(listOf(upgradeBoardToWorkflow(older, fcr).board).some((q) => "since" in q), false, "lo que el proceso sabe de sí mismo no se guarda");
  // A project already on that version that dropped one keeps it dropped.
  const dropped: AssignmentsDoc = { ...older, workflowVersion: 47 };
  assert.equal(listOf(upgradeBoardToWorkflow(dropped, fcr).board).some((q) => q.id === "figura"), false);
});

console.log(`\nverify-workflow-upgrade: ${passed} checks passed.`);
