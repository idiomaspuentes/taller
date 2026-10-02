/** A person's level belongs to a team, and each team has its coordinators. */
import assert from "node:assert/strict";
import type { DcsIssue } from "@ip-lms/dcs-client";
import { audienceOf } from "../src/domain/audience";
import {
  canConfirmForTeam,
  coordinatedTeams,
  isCoordinatorOf,
  levelsForTeam,
  resolveLevel,
  withCoordinator,
  withTeamLevel,
  type LevelBook,
} from "../src/domain/levels";
import { normalizePmConfig } from "../src/domain/roles";
import { assignCandidates } from "../src/domain/teamToday";
import type { AssignmentsDoc } from "../src/domain/types";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const book: LevelBook = {
  levels: { juan: "practicante", ana: "habilitada" },
  teamLevels: { traductores: { juan: "habilitada" }, afinadores: { juan: "aprendiz", ana: "habilitada" } },
  coordinators: { traductores: ["marta"], afinadores: ["ana"] },
};

test("la misma persona tiene un nivel distinto en cada equipo", () => {
  assert.equal(resolveLevel(book, "Traductores", "Juan"), "habilitada");
  assert.equal(resolveLevel(book, "afinadores", "juan"), "aprendiz");
});

test("en un equipo con niveles propios, quien no tiene nivel ahí empieza sin nivel, aunque tenga uno general", () => {
  assert.equal(resolveLevel(book, "traductores", "ana"), undefined);
});

test("un equipo que todavía no registró niveles sigue con los generales: nada cambia hasta que los use", () => {
  assert.equal(resolveLevel(book, "validadores", "juan"), "practicante");
  assert.deepEqual(levelsForTeam(book, undefined), book.levels);
  assert.equal(resolveLevel({ levels: {} }, "x", "juan"), undefined);
});

test("un nivel ya resuelto se respeta tal cual", () => {
  assert.equal(resolveLevel("oyente", "cualquiera", "juan"), "oyente");
  assert.equal(resolveLevel(undefined, "cualquiera", "juan"), undefined);
});

test("el primer nivel propio de un equipo parte de los generales: nadie pierde su nivel por esa edición", () => {
  const next = withTeamLevel(book, "Validadores", "pedro", "aprendiz");
  assert.deepEqual(next.teamLevels.validadores, { juan: "practicante", ana: "habilitada", pedro: "aprendiz" });
  assert.deepEqual(book.teamLevels?.validadores, undefined, "no cambia el original");
  const cleared = withTeamLevel(next, "validadores", "pedro", "");
  assert.equal(cleared.teamLevels.validadores?.pedro, undefined);
  assert.equal(resolveLevel(cleared, "validadores", "juan"), "practicante");
});

test("coordinadores por equipo", () => {
  assert.equal(isCoordinatorOf(book, "Traductores", "Marta"), true);
  assert.equal(isCoordinatorOf(book, "afinadores", "marta"), false);
  assert.deepEqual(coordinatedTeams(book, "ana"), ["afinadores"]);
  const added = withCoordinator(book, "Traductores", "Luis", true);
  assert.deepEqual(added.coordinators.traductores, ["marta", "luis"]);
  const removed = withCoordinator(withCoordinator(added, "traductores", "luis", false), "traductores", "marta", false);
  assert.equal(removed.coordinators.traductores, undefined, "un equipo sin coordinadores no deja una lista vacía");
});

test("confirma la decisión final el coordinador del equipo o una persona habilitada de ese equipo", () => {
  assert.equal(canConfirmForTeam(book, "traductores", "marta"), true, "coordina");
  assert.equal(canConfirmForTeam(book, "traductores", "juan"), true, "habilitada en ese equipo");
  assert.equal(canConfirmForTeam(book, "afinadores", "juan"), false, "aprendiz en ese otro equipo");
  assert.equal(canConfirmForTeam(book, "afinadores", "marta"), false, "coordina otro equipo");
});

test("la configuración guardada se lee con equipos y nombres en minúsculas, y lo mal formado se descarta", () => {
  const config = normalizePmConfig({
    levels: { Ana: "habilitada" },
    teamLevels: { " Traductores ": { Juan: "practicante", eva: "experta" }, vacio: {} },
    coordinators: { Traductores: ["Marta", "marta", ""], otro: "no es lista" },
  });
  assert.deepEqual(config.teamLevels, { traductores: { juan: "practicante" } });
  assert.deepEqual(config.coordinators, { traductores: ["marta"] });
  const old = normalizePmConfig({ levels: { ana: "habilitada" } });
  assert.deepEqual(old.teamLevels, {});
  assert.deepEqual(old.coordinators, {});
});

// ---------------------------------------------------------------- who sees what
const PM = "org";
const plan = {
  teams: [
    { id: "t1", name: "Traducir", phaseId: "p", memberIds: ["juan", "ana"], orgTeamName: "Traductores", minLevel: "practicante", rules: [] },
    { id: "t2", name: "Afinar", phaseId: "p", memberIds: ["juan", "ana"], orgTeamName: "Afinadores", minLevel: "practicante", rules: [] },
  ],
  phases: [{ id: "p", name: "P", slug: "p", order: 0 }],
} as unknown as AssignmentsDoc;
const juan = { username: "juan", teams: [{ id: 1, name: "Traductores", organization: { name: PM } }, { id: 2, name: "Afinadores", organization: { name: PM } }] } as never;
let n = 0;
const free = (taskId: string): DcsIssue =>
  ({ id: ++n, number: n, title: "TIT 1 · x", state: "open", body: "", labels: [{ name: `pm/tarea:${taskId}` }], assignee: null, assignees: [] }) as unknown as DcsIssue;

test("lo libre de un equipo se ofrece según el nivel de la persona en ESE equipo", () => {
  const translate = free("t1");
  const tune = free("t2");
  const project = { board: plan, openIssues: [translate, tune] };
  const inTranslate = audienceOf({ issue: translate, project, session: juan, pmOrg: PM, myLevel: book });
  const inTune = audienceOf({ issue: tune, project, session: juan, pmOrg: PM, myLevel: book });
  assert.equal(inTranslate.hold, undefined, "habilitado en Traductores: puede tomarla");
  assert.equal(inTune.hold?.kind, "nivel", "aprendiz en Afinadores: la tarea pide practicante");
});

test("sin nivel en un equipo que lleva los suyos, solo se puede tomar lo que no pide nivel", () => {
  const withMin = free("t1");
  const ana = { username: "ana", teams: [{ id: 1, name: "Traductores", organization: { name: PM } }] } as never;
  assert.equal(audienceOf({ issue: withMin, project: { board: plan, openIssues: [withMin] }, session: ana, pmOrg: PM, myLevel: book }).hold?.kind, "nivel");
  const noMin = { ...plan, teams: [{ ...plan.teams[0]!, minLevel: undefined }] } as unknown as AssignmentsDoc;
  assert.equal(audienceOf({ issue: withMin, project: { board: noMin, openIssues: [withMin] }, session: ana, pmOrg: PM, myLevel: book }).hold, undefined);
});

test("a quién puede asignar el coordinador: el nivel que cuenta es el del equipo de la tarea", () => {
  assert.deepEqual(assignCandidates(plan.teams[0], book), ["juan"], "ana no tiene nivel en Traductores: ahí empieza de cero");
  assert.deepEqual(assignCandidates(plan.teams[1], book), ["ana"], "en Afinadores juan es aprendiz");
});

console.log(`\nverify-levels: ${passed} checks passed.`);
