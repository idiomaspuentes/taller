/**
 * «Mis tareas» kept in this device: what the screen reads of each subtarea survives, the rest is left out, and an
 * old or unreadable copy is not shown.
 */
import assert from "node:assert/strict";
import type { DcsIssue } from "@ip-lms/dcs-client";
import { keepTasks, keptTasks, keptTasksKey, slimIssue, type KeptTasks } from "../src/domain/myTasksCache";
import type { MyTasksProjectBucket } from "../src/domain/myTasks";
import { DEFAULT_SOLVERS_CATALOG } from "../src/domain/solvers";
import { setActiveScope } from "../src/domain/scope";

let passed = 0;
function test(name: string, fn: () => void) {
  setActiveScope("");
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const person = (login: string) => ({ id: 7, login, full_name: "Ana", avatar_url: "https://example.org/a.png", email: "a@example.org", created: "2020-01-01" });
const issue = (number: number) =>
  ({
    number,
    title: `EZR 1:1–11 · TPS ${number}`,
    body: "<!-- pm-task-progress {\"doneStepIds\":[\"alinear\"]} -->",
    state: "open",
    labels: [{ id: 1, name: "pm/tarea:tps", color: "ff0000", description: "una descripción larga", url: "https://example.org/l" }],
    milestone: { id: 3, title: "EZR", state: "open", description: "texto", open_issues: 210 },
    assignee: person("ana"),
    assignees: [person("ana")],
    user: person("abelper8"),
    repository: { id: 9, name: "taller", full_name: "es-419_gl/taller", owner: { login: "es-419_gl", avatar_url: "x" } },
    updated_at: "2026-10-17T10:00:00Z",
    comments: 2,
  }) as unknown as DcsIssue;

const memory = () => {
  const map = new Map<string, string>();
  return { setItem: (k: string, v: string) => void map.set(k, v), getItem: (k: string) => map.get(k) ?? null, map };
};
const where = { host: "https://git.door43.org", username: "Abelper8", pmOrg: "es-419_gl", lang: "es-419", contentOrg: "es-419_gl", mode: "lista" };
const bucket = (browse: boolean): MyTasksProjectBucket => {
  const issues = [issue(1), issue(2)];
  return { projectId: "EZR", title: "Esdras", browseProject: browse, board: { projectId: "EZR", teams: [] } as never, issues, openIssues: browse ? issues : [issue(3)] };
};
const value = (projects: MyTasksProjectBucket[], at = "2026-10-17T10:00:00Z"): KeptTasks => ({ at, projects, catalog: DEFAULT_SOLVERS_CATALOG, conflicted: [], closed: [issue(4)] });

test("de cada subtarea se guarda lo que la pantalla lee; avatares, correos y descripciones no", () => {
  const slim = slimIssue(issue(1)) as unknown as Record<string, any>;
  assert.equal(slim.body, issue(1).body);
  assert.equal(slim.title, issue(1).title);
  assert.equal(slim.labels[0].name, "pm/tarea:tps");
  assert.equal(slim.milestone.title, "EZR");
  assert.equal(slim.assignee.login, "ana");
  assert.equal(slim.assignees[0].login, "ana");
  assert.equal(slim.repository.full_name, "es-419_gl/taller");
  assert.equal(slim.repository.owner.login, "es-419_gl");
  assert.equal(slim.assignee.avatar_url, undefined);
  assert.equal(slim.labels[0].description, undefined);
  assert.ok(JSON.stringify(slim).length < JSON.stringify(issue(1)).length * 0.7);
});

test("la cola que se recorre se guarda una vez y vuelve siendo también la lista de abiertas", () => {
  const storage = memory();
  const key = keptTasksKey(where);
  keepTasks(key, value([bucket(true)]), storage);
  assert.equal((storage.map.get(key)!.match(/EZR 1:1–11 · TPS 1/g) ?? []).length, 1, "no se repite");
  const back = keptTasks(key, new Date("2026-10-17T12:00:00Z"), storage)!;
  assert.equal(back.projects[0]!.openIssues, back.projects[0]!.issues);
  assert.equal(back.closed[0]!.number, 4);
});

test("las abiertas de un proyecto que no se recorre se guardan aparte", () => {
  const storage = memory();
  const key = keptTasksKey(where);
  keepTasks(key, value([bucket(false)]), storage);
  const back = keptTasks(key, new Date("2026-10-17T12:00:00Z"), storage)!;
  assert.deepEqual(back.projects[0]!.openIssues!.map((i) => i.number), [3]);
});

test("una copia de hace más de tres días no se muestra", () => {
  const storage = memory();
  const key = keptTasksKey(where);
  keepTasks(key, value([bucket(true)]), storage);
  assert.equal(keptTasks(key, new Date("2026-10-21T12:00:00Z"), storage), null);
});

test("cada persona, organización y espacio tiene su copia", () => {
  assert.equal(keptTasksKey(where), keptTasksKey({ ...where, username: "abelper8" }), "el nombre sin mayúsculas");
  assert.notEqual(keptTasksKey(where), keptTasksKey({ ...where, username: "ana" }));
  assert.notEqual(keptTasksKey(where), keptTasksKey({ ...where, pmOrg: "pt-br_gl" }));
  const plain = keptTasksKey(where);
  setActiveScope("pt");
  assert.notEqual(keptTasksKey(where), plain);
});

test("sin lugar para guardar, o con una copia rota, la lista se lee como siempre", () => {
  keepTasks("k", value([bucket(true)]), { setItem: () => { throw new Error("QuotaExceededError"); } });
  assert.equal(keptTasks("k", new Date(), { getItem: () => "{no es json" }), null);
  assert.equal(keptTasks("k", new Date(), undefined), null);
});

console.log(`\nverify-my-tasks-cache: ${passed} checks passed.`);
