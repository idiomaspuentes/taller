/**
 * The FCR base template is well formed: nothing is lost when it is saved and
 * read back, every wait points at something that exists and never loops, and
 * a chapter moves through the flow in the order the process asks.
 */
import assert from "node:assert/strict";
import type { DcsIssue } from "@ip-lms/dcs-client";
import { fcrWorkflowTemplate, AFINACION_SOLVERS } from "../src/domain/fcrTemplate";
import { normalizeWorkflowTemplate } from "../src/domain/store";
import { applyWorkflowToBoard } from "../src/domain/workflows";
import { newlyEnabled, waitBlocks, waitWouldLoop } from "../src/domain/waits";
import type { AssignmentsDoc, ProjectTask } from "../src/domain/types";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const template = fcrWorkflowTemplate();
const board = applyWorkflowToBoard(
  { schema: "gateway-assignments-2", projectId: "TIT", book: "TIT", lang: "es-419", people: [], phases: [], teams: [] } as unknown as AssignmentsDoc,
  template,
);
const team = (id: string) => board.teams.find((t) => t.id === id) as ProjectTask;

test("al guardar y volver a leer no se pierde ninguna tarea, fase ni paso", () => {
  const reread = normalizeWorkflowTemplate(JSON.parse(JSON.stringify(template)))!;
  assert.equal(reread.tasks.length, template.tasks.length);
  assert.equal(reread.phases.length, template.phases.length);
  for (const task of template.tasks) {
    const back = reread.tasks.find((t) => t.id === task.id)!;
    assert.equal(back.steps?.length ?? 0, task.steps?.length ?? 0, `${task.id}: pasos`);
    assert.deepEqual(back.waitsFor, task.waitsFor, `${task.id}: esperas`);
    assert.equal(back.minLevel, task.minLevel, `${task.id}: nivel`);
  }
  assert.equal(reread.releaseProfiles?.[0]?.requiredPhaseIds[0], "fcr-validacion");
});

test("toda espera apunta a una tarea o fase que existe, y ninguna da vueltas", () => {
  const taskIds = new Set(board.teams.map((t) => t.id));
  const phaseIds = new Set(board.phases.map((p) => p.id));
  for (const t of board.teams) {
    for (const w of t.waitsFor ?? []) {
      assert.ok(w.taskId ? taskIds.has(w.taskId) : phaseIds.has(w.phaseId!), `${t.id} espera a algo que no existe`);
      assert.equal(waitWouldLoop({ teams: board.teams.map((x) => (x.id === t.id ? { ...x, waitsFor: undefined } : x)) }, t.id, w), false, `${t.id}: espera en círculo`);
    }
  }
});

test("los pasos: ids únicos, exclusiones que existen y cupos coherentes", () => {
  for (const t of board.teams) {
    const ids = (t.steps ?? []).map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `${t.id}: pasos repetidos`);
    for (const s of t.steps ?? []) {
      for (const prior of s.excludePriorStepIds ?? []) assert.ok(ids.includes(prior), `${t.id}/${s.id} excluye un paso que no existe`);
      if (s.claimMode === "pool") {
        assert.ok((s.maxAssignees ?? 0) >= (s.minAssignees ?? 0), `${t.id}/${s.id}: máximo menor que el mínimo`);
        if (s.minIndependent) assert.ok(s.minIndependent <= (s.minAssignees ?? 0), `${t.id}/${s.id}: más independientes que personas`);
      }
    }
  }
});

test("la Afinación tiene tres pasos de revisión, cada uno con su solver, y la alineación la hace una sola persona", () => {
  for (const id of ["afinar-tpl", "afinar-tps"]) {
    const steps = team(id).steps!;
    assert.deepEqual(steps.map((s) => s.id), ["notas", "palabras", "alinear", "revisar-alineacion"]);
    assert.equal(steps[0]!.solverAppId, AFINACION_SOLVERS.notas);
    assert.equal(steps[1]!.solverAppId, AFINACION_SOLVERS.palabras);
    assert.equal(steps[2]!.claimMode, "exclusive");
    assert.deepEqual(steps[3]!.excludePriorStepIds, ["alinear"], "quien alineó no revisa su propia alineación");
    assert.equal(steps[0]!.minAssignees, 3);
    assert.equal(steps[0]!.minIndependent, 2);
  }
});

let n = 0;
function issue(taskId: string, chapter: number): DcsIssue {
  n++;
  return {
    id: n, number: n, title: `TIT ${chapter}:1–3 · ${taskId}`, state: "open", body: "",
    labels: [{ name: `pm/tarea:${taskId}` }, { name: `pm/cap:${chapter}` }],
    assignee: null, assignees: [],
  } as unknown as DcsIssue;
}

test("un capítulo recorre el flujo en orden: Traducción, Afinación por recurso, Armonización, Validación", () => {
  const tpl1 = issue("tpl", 1), tps1 = issue("tps", 1), tpl2 = issue("tpl", 2);
  const ayuda = issue("notas-ayuda", 1);
  const afTpl1 = issue("afinar-tpl", 1), afTps1 = issue("afinar-tps", 1), afTpl2 = issue("afinar-tpl", 2);
  const arm = issue("armonizar-notas", 1);
  const val = issue("validar", 1);
  const all = [tpl1, tps1, tpl2, ayuda, afTpl1, afTps1, afTpl2, arm, val];
  const waiting = (i: DcsIssue, open = all) => waitBlocks(i, board, open).length > 0;

  assert.ok(waiting(afTpl1) && waiting(afTps1), "la Afinación espera a su Traducción");
  const afterTpl1 = all.filter((i) => i !== tpl1);
  assert.equal(waiting(afTpl1, afterTpl1), false, "cerrado el TPL del capítulo 1 se habilita Afinar TPL");
  assert.equal(waiting(afTps1, afterTpl1), true, "Afinar TPS sigue esperando al TPS, no al TPL");
  assert.equal(waiting(afTpl2, afterTpl1), true, "el capítulo 2 espera a su propio TPL");
  assert.deepEqual(newlyEnabled(tpl1, board, all).map((i) => i.number), [afTpl1.number]);

  assert.ok(waiting(arm, afterTpl1), "Armonizar Notas espera las Ayudas y toda la Afinación");
  const afinadoYAyudado = all.filter((i) => ![tpl1, tps1, ayuda, afTpl1, afTps1].includes(i));
  assert.equal(waiting(arm, afinadoYAyudado), false, "sin Ayudas ni Afinación pendientes en el capítulo 1, se habilita");
  assert.equal(waiting(val, afinadoYAyudado), true, "Validación espera a toda la Armonización del capítulo");
  assert.equal(waiting(val, afinadoYAyudado.filter((i) => i !== arm)), false);
});

test("quién puede tomar cada cosa: aprendices afinan, solo habilitadas armonizan y validan", () => {
  assert.equal(team("afinar-tpl").minLevel, "aprendiz");
  assert.equal(team("tpl").minLevel, "practicante");
  for (const id of ["armonizar-notas", "armonizar-preguntas", "armonizar-academia", "armonizar-palabras", "validar"]) {
    assert.equal(team(id).minLevel, "habilitada", id);
  }
});

console.log(`\nverify-fcr-template: ${passed} checks passed.`);
