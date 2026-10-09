/** Workspaces that share an organization must never see each other's issues, projects or files. */
import { teamRulesPath } from "../src/domain/teamRules";
import { diagramsPath } from "../src/domain/diagrams";
import assert from "node:assert/strict";
import { listMyIssues, listPmTouchedSince, listProjectOpenIssues, pmIssueLabelNames } from "../src/dcs/issues";
import { assignmentsPath, projectsIndexPath, teamsPath, workflowsPath, inventoryPath } from "../src/domain/store";
import { issueInScope, projectFromMilestone, scopeKey, scopeLabelName, scopedMilestone, setActiveScope } from "../src/domain/scope";
import { issueProjectId } from "../src/domain/myTasks";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  setActiveScope("");
  await fn();
  setActiveScope("");
  passed++;
  console.log(`ok  ${name}`);
}

const issue = (number: number, labels: string[], milestone?: string) => ({
  number,
  title: `Subtarea ${number}`,
  state: "open",
  labels: labels.map((name, i) => ({ id: i + 1, name })),
  milestone: milestone ? { title: milestone } : undefined,
  repository: { name: "taller", full_name: "es-419_gl/taller" },
});
const legacy = issue(1, ["pm", "pm/tarea:t1"], "NEH");
const portuguese = issue(2, ["pm", "pm/tarea:t1", scopeLabelName("pt")], "pt/NEH");
const spanish = issue(3, ["pm", "pm/tarea:t2", scopeLabelName("es")], "es/NEH");

await test("cada espacio solo reconoce sus subtareas; el que no tiene scope no ve las de los demás", () => {
  assert.equal(issueInScope(legacy, ""), true);
  assert.equal(issueInScope(portuguese, ""), false, "sin scope no se ven las que llevan scope");
  assert.equal(issueInScope(spanish, ""), false);
  assert.equal(issueInScope(portuguese, "pt"), true);
  assert.equal(issueInScope(spanish, "pt"), false, "otro scope");
  assert.equal(issueInScope(legacy, "pt"), false, "las de siempre tampoco entran en un espacio con scope");
});

await test("los hitos y los proyectos: el prefijo se pone al escribir y se quita al leer", () => {
  assert.equal(scopedMilestone("NEH", "pt"), "pt/NEH");
  assert.equal(scopedMilestone("NEH", ""), "NEH");
  assert.equal(projectFromMilestone("pt/NEH"), "NEH");
  assert.equal(projectFromMilestone("NEH"), "NEH");
  assert.equal(issueProjectId(portuguese as never), "NEH", "el proyecto de una subtarea no lleva el prefijo");
});

await test("las subtareas nuevas llevan la etiqueta del espacio solo si el espacio tiene scope", () => {
  const order = { resource: "tpl", teamId: "t1", teamName: "Equipo", chapter: 1, book: "NEH" } as never;
  assert.ok(!pmIssueLabelNames(order).some((l) => l.includes("espacio")));
  setActiveScope("pt");
  assert.ok(pmIssueLabelNames(order).includes("pm/espacio:pt"));
});

await test("los archivos del plan y las copias del navegador se separan por scope", () => {
  assert.equal(assignmentsPath("es-419", "NEH"), "es-419/NEH/assignments.json", "sin scope, como siempre");
  assert.equal(projectsIndexPath("es-419"), "es-419/projects.json");
  setActiveScope("pt");
  assert.equal(assignmentsPath("es-419", "NEH"), "pt/es-419/NEH/assignments.json", "el mismo idioma en otro espacio no choca");
  assert.equal(teamsPath("es-419"), "pt/es-419/teams.json");
  assert.equal(inventoryPath("es-419", "NEH"), "pt/es-419/NEH/inventory.json");
  assert.equal(projectsIndexPath("es-419"), "pt/es-419/projects.json");
  assert.equal(teamRulesPath("pm-traductores-tpl"), "pt/reglas/pm-traductores-tpl.json", "las reglas de un equipo son de su espacio");
  assert.equal(diagramsPath("jon", 2), "pt/diagramas/JON/2.json", "los diagramas que un equipo corrige son de su espacio");
  assert.equal(workflowsPath(), "pt/workflows.json");
  assert.equal(scopeKey(), "pt:");
});

// A Door43 whose search returns issues of every workspace, as it does: it cannot tell them apart.
function fakeDoor43(all: unknown[]) {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/issues/search") || /\/repos\/[^/]+\/taller\/issues\?/.test(url)) return new Response(JSON.stringify(all), { status: 200, headers: { "content-type": "application/json" } });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return urls;
}
const session = { host: "https://qa.door43.org", username: "ana", token: "t" } as never;

await test("«mis tareas» de cada espacio: aunque Door43 devuelva las de todos, solo quedan las suyas", async () => {
  fakeDoor43([legacy, portuguese, spanish]);
  assert.deepEqual((await listMyIssues(session, "es-419_gl")).map((i) => i.number), [1], "sin scope: solo las de siempre");
  setActiveScope("pt");
  assert.deepEqual((await listMyIssues(session, "es-419_gl")).map((i) => i.number), [2]);
  setActiveScope("es");
  assert.deepEqual((await listMyIssues(session, "es-419_gl")).map((i) => i.number), [3]);
});

await test("al pedir un proyecto se pide el hito con el prefijo del espacio", async () => {
  const urls = fakeDoor43([portuguese]);
  setActiveScope("pt");
  const rows = await listProjectOpenIssues(session, "es-419_gl", "neh");
  assert.equal(rows.length, 1);
  assert.ok(urls.some((u) => decodeURIComponent(u).includes("milestones=pt/NEH")), urls.join("\n"));
});

await test("lo que se movió en el plan se mira solo en el espacio propio: lo de otro espacio no refresca esta lista", async () => {
  const touched = (row: object, at: string) => ({ ...row, updated_at: at });
  const urls = fakeDoor43([touched(legacy, "2026-10-06T10:00:00Z"), touched(portuguese, "2026-10-06T10:01:00Z"), touched(spanish, "2026-10-06T10:02:00Z")]);
  assert.deepEqual(await listPmTouchedSince(session, "es-419_gl", "2026-10-06T09:58:00Z"), ["1:2026-10-06T10:00:00Z"]);
  assert.ok(urls.some((u) => decodeURIComponent(u).includes("since=2026-10-06T09:58:00Z")), urls.join("\n"));
  setActiveScope("pt");
  assert.deepEqual(await listPmTouchedSince(session, "es-419_gl", "2026-10-06T09:58:00Z"), ["2:2026-10-06T10:01:00Z"]);
});

console.log(`\nverify-scope: ${passed} checks passed.`);
