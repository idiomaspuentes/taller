/**
 * Who is told about a subtarea:
 * - created with a person: only that person;
 * - created for a team: everybody on the team, and any of them may take it;
 * - waiting for other work, or asking for a level someone lacks: shown, never announced.
 */
import assert from "node:assert/strict";
import type { DcsIssue } from "@ip-lms/dcs-client";
import type { AssignmentsDoc, ProjectTask } from "../src/domain/types";
import { audienceOf } from "../src/domain/audience";
import { countsForMinimum, levelOf, meetsLevel, normalizeLevels } from "../src/domain/levels";
import { normalizePmConfig } from "../src/domain/roles";
import { normalizeTeams } from "../src/domain/store";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const PM = "es-419_gl";
const rule = { resource: "tpl" as const, articleFilter: "pending" as const };
function task(id: string, extra: Partial<ProjectTask> = {}): ProjectTask {
  return { id, name: id, description: "", phaseId: "p1", memberIds: [], scope: ["tpl"], rules: [rule], ...extra };
}
const board: Pick<AssignmentsDoc, "teams" | "phases"> = {
  phases: [{ id: "p1", name: "Fase 1", slug: "f1", order: 0 }],
  teams: [
    task("tpl", { orgTeamName: "pm-tpl" }),
    task("afinar", { orgTeamName: "pm-afinacion", minLevel: "habilitada", waitsFor: [{ taskId: "tpl", scope: "portion" }] }),
  ],
};

let n = 0;
function issue(taskId: string, assignee?: string, portion = "p-1-1"): DcsIssue {
  n++;
  const marker = JSON.stringify({ schema: "gateway-work-order-1", key: `${taskId}|${portion}`, book: "NEH", teamId: taskId, resource: "tpl", portionIds: [portion], itemIds: [] });
  return {
    id: n,
    number: n,
    title: `NEH 1:1–3 · ${taskId}`,
    state: "open",
    body: `<!-- gateway-work-order ${marker} -->`,
    labels: [{ name: `pm/tarea:${taskId}` }],
    assignee: assignee ? { login: assignee } : null,
    assignees: assignee ? [{ login: assignee }] : [],
  } as unknown as DcsIssue;
}
const team = (name: string) => ({ name, organization: { name: PM } });
const ana = { username: "ana", teams: [team("pm-tpl")] } as never;
const bob = { username: "bob", teams: [team("pm-tpl")] } as never;
const eva = { username: "eva", teams: [team("pm-afinacion")] } as never;

test("tarea creada con una persona: solo esa persona la recibe", () => {
  const t = issue("tpl", "ana");
  const project = { board, openIssues: [t] };
  assert.equal(audienceOf({ issue: t, project, session: ana, pmOrg: PM }).notify, true);
  assert.equal(audienceOf({ issue: t, project, session: ana, pmOrg: PM }).relation, "mine");
  const forBob = audienceOf({ issue: t, project, session: bob, pmOrg: PM });
  assert.equal(forBob.relation, "other");
  assert.equal(forBob.notify, false, "el resto del equipo no recibe aviso");
});

test("tarea creada para un equipo: todo el equipo la recibe y cualquiera puede tomarla", () => {
  const t = issue("tpl");
  const project = { board, openIssues: [t] };
  for (const person of [ana, bob]) {
    const a = audienceOf({ issue: t, project, session: person, pmOrg: PM });
    assert.deepEqual([a.relation, a.notify], ["free", true]);
  }
  assert.equal(audienceOf({ issue: t, project, session: eva, pmOrg: PM }).notify, false, "otro equipo no");
});

test("cuando alguien la toma, deja de ser libre para los demás", () => {
  const taken = issue("tpl", "ana");
  const forBob = audienceOf({ issue: taken, project: { board, openIssues: [taken] }, session: bob, pmOrg: PM });
  assert.equal(forBob.relation, "other");
});

test("una tarea que espera se muestra pero no se avisa; al habilitarse sí", () => {
  const blocker = issue("tpl", "ana");
  const waiting = issue("afinar", "eva");
  const open = [blocker, waiting];
  const held = audienceOf({ issue: waiting, project: { board, openIssues: open }, session: eva, pmOrg: PM });
  assert.equal(held.relation, "mine");
  assert.equal(held.notify, false);
  assert.equal(held.hold?.kind, "espera");
  assert.match(held.hold!.text, /Espera a «tpl» de @ana/);
  const ready = audienceOf({ issue: waiting, project: { board, openIssues: [waiting] }, session: eva, pmOrg: PM });
  assert.equal(ready.notify, true, "cerrada la de la que esperaba, se avisa");
});

test("una tarea libre que espera tampoco avisa al equipo", () => {
  const blocker = issue("tpl", "ana");
  const waiting = issue("afinar");
  const a = audienceOf({ issue: waiting, project: { board, openIssues: [blocker, waiting] }, session: eva, pmOrg: PM });
  assert.deepEqual([a.relation, a.notify], ["free", false]);
});

test("el nivel mínimo: quien no lo alcanza la ve como «todavía no» y no recibe aviso", () => {
  const t = issue("afinar");
  const project = { board, openIssues: [t] };
  const aprendiz = audienceOf({ issue: t, project, session: eva, pmOrg: PM, myLevel: "aprendiz" });
  assert.equal(aprendiz.notify, false);
  assert.equal(aprendiz.hold?.kind, "nivel");
  assert.equal(aprendiz.hold?.text, "Pide nivel persona habilitada");
  const habilitada = audienceOf({ issue: t, project, session: eva, pmOrg: PM, myLevel: "habilitada" });
  assert.equal(habilitada.notify, true);
});

test("sin nivel registrado no se filtra; un oyente nunca recibe trabajo", () => {
  const t = issue("tpl");
  const project = { board, openIssues: [t] };
  assert.equal(audienceOf({ issue: t, project, session: ana, pmOrg: PM }).notify, true);
  const oyente = audienceOf({ issue: t, project, session: ana, pmOrg: PM, myLevel: "oyente" });
  assert.equal(oyente.notify, false);
  assert.equal(oyente.hold?.text, "Solo observas");
});

test("niveles: orden, mínimos y qué cuenta para el mínimo de personas", () => {
  assert.equal(meetsLevel("practicante", "aprendiz"), true);
  assert.equal(meetsLevel("aprendiz", "practicante"), false);
  assert.equal(meetsLevel("habilitada", undefined), true);
  assert.equal(meetsLevel(undefined, "habilitada"), true, "sin nivel registrado no se filtra");
  assert.equal(countsForMinimum("habilitada"), true);
  assert.equal(countsForMinimum("practicante"), false);
  assert.equal(countsForMinimum(undefined), false);
});

test("los niveles se guardan en la configuración de la organización", () => {
  const config = normalizePmConfig({ levels: { Ana: "habilitada", " bob ": "practicante", eva: "experta", "": "oyente" } });
  assert.deepEqual(config.levels, { ana: "habilitada", bob: "practicante" });
  assert.equal(levelOf(config.levels, "ANA"), "habilitada");
  assert.deepEqual(normalizePmConfig(undefined).levels, {});
  assert.deepEqual(normalizeLevels([1, 2]), {});
});

test("el nivel mínimo de una tarea sobrevive a guardar y volver a leer el plan", () => {
  const reread = normalizeTeams(JSON.parse(JSON.stringify(board.teams)), []);
  assert.equal(reread.find((t) => t.id === "afinar")!.minLevel, "habilitada");
  const bad = normalizeTeams([{ ...board.teams[0], minLevel: "experta" }], []);
  assert.equal(bad[0]!.minLevel, undefined);
});

test("una decisión del equipo llega a la gente de la tarea aunque no esté en el equipo de la organización, y sin filtro de nivel", () => {
  const withPeople: Pick<AssignmentsDoc, "teams" | "phases"> = {
    ...board,
    teams: [task("tpl", { memberIds: ["ana", "bob", "lia"] }), task("afinar", { memberIds: ["ana"], minLevel: "habilitada" })],
  };
  const d = issue("tpl", undefined, "decision:bea-1");
  const project = { board: withPeople, openIssues: [d] };
  const lia = { username: "lia", teams: [] } as never;
  const a = audienceOf({ issue: d, project, session: lia, pmOrg: PM });
  assert.deepEqual([a.relation, a.notify], ["free", true], "lia está entre las personas de la tarea");
  assert.equal(audienceOf({ issue: d, project, session: eva, pmOrg: PM }).relation, "other", "quien no es de la tarea no la recibe");
  // a level below the task's minimum does not stop someone from voting
  const low = issue("afinar", undefined, "decision:bea-2");
  const lowProject = { board: withPeople, openIssues: [low] };
  const aprendiz = audienceOf({ issue: low, project: lowProject, session: { username: "ana", teams: [] } as never, pmOrg: PM, myLevel: "aprendiz" });
  assert.deepEqual([aprendiz.relation, aprendiz.notify], ["free", true]);
  // ...but the same subtarea as ordinary work would be held for the level
  const work = issue("afinar", undefined, "p-9-9");
  const held = audienceOf({ issue: work, project: { board: withPeople, openIssues: [work] }, session: { username: "ana", teams: [team("pm-afinacion")] } as never, pmOrg: PM, myLevel: "aprendiz" });
  assert.equal(held.notify, false);
});

console.log(`\nverify-audience: ${passed} checks passed.`);
