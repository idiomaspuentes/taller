/**
 * End to end against the mock Door43 (`MOCK_PM_ORG=es-419_gl npm run mock:door43`): three workspaces share one
 * organization, each creates a subtarea of the SAME project, and each must see only its own.
 * Run: npm run verify:scope-mock
 */
import assert from "node:assert/strict";
import { createDecisionIssue, listMyIssues, listProjectOpenIssues } from "../src/dcs/issues";
import { assignmentsPath } from "../src/domain/store";
import { setActiveScope } from "../src/domain/scope";
import { listMentions } from "../src/dcs/mentions";

const HOST = "http://localhost:8787";
const session = { host: HOST, username: "ana", token: "token-ana", scopes: [], scopesVersion: 3 } as never;
const ORG = "es-419_gl";

const reachable = await fetch(`${HOST}/api/v1/user`, { headers: { authorization: "token token-ana" } }).then((r) => r.ok, () => false);
if (!reachable) {
  console.log("verify-scope-mock: el mock de Door43 no está en marcha (npm run mock:door43); no se ejecutó.");
  process.exit(0);
}

let passed = 0;
async function step(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

async function makeIssue(scope: string, title: string) {
  setActiveScope(scope);
  return createDecisionIssue(session, ORG, {
    projectId: "NEH",
    taskId: `tarea-${scope || "base"}`,
    taskName: `Tarea ${scope || "base"}`,
    resource: "tpl",
    book: "NEH",
    chapter: 1,
    verse: 1,
    decisionId: `d-${scope || "base"}-${Date.now()}`,
    title,
    text: `Decisión de ${scope || "base"}`,
  });
}

const base = await makeIssue("", "Del espacio sin scope");
const pt = await makeIssue("pt", "Del espacio pt");
const es = await makeIssue("es", "Del espacio es");

await step("cada espacio crea subtareas del MISMO proyecto con su propia etiqueta y su propio hito", async () => {
  const labels = (i: typeof base) => (i.labels ?? []).map((l) => l.name);
  assert.ok(!labels(base).some((n) => n.includes("espacio")), "el espacio sin scope no lleva etiqueta de espacio");
  assert.ok(labels(pt).includes("pm/espacio:pt"));
  assert.ok(labels(es).includes("pm/espacio:es"));
  assert.equal(base.milestone?.title, "NEH");
  assert.equal(pt.milestone?.title, "pt/NEH");
  assert.equal(es.milestone?.title, "es/NEH");
});

await step("los listados de un proyecto: cada espacio ve solo sus subtareas de NEH", async () => {
  for (const [scope, mine] of [["", base], ["pt", pt], ["es", es]] as const) {
    setActiveScope(scope);
    const seen = (await listProjectOpenIssues(session, ORG, "NEH")).map((i) => i.number);
    assert.ok(seen.includes(mine.number), `${scope || "base"} ve la suya`);
    for (const other of [base, pt, es].filter((o) => o !== mine)) assert.ok(!seen.includes(other.number), `${scope || "base"} no ve la de otro espacio (#${other.number})`);
  }
});

await step("las menciones de otro espacio no se muestran: se filtra por la etiqueta de la subtarea", async () => {
  setActiveScope("pt");
  const seen = new Set((await listMentions(session, ORG, "taller")).map((m) => m.issue));
  assert.ok(!seen.has(base.number) && !seen.has(es.number), "pt no ve avisos de los otros espacios");
});

await step("«mis tareas» tampoco mezcla (las subtareas sin persona asignada no entran, pero nada de otro espacio)", async () => {
  for (const scope of ["", "pt", "es"]) {
    setActiveScope(scope);
    const mine = (await listMyIssues(session, ORG)).map((i) => i.number);
    const foreign = [base, pt, es].filter((i) => i.number !== ({ "": base, pt, es }[scope as "" | "pt" | "es"]).number).map((i) => i.number);
    for (const n of foreign) assert.ok(!mine.includes(n), `${scope || "base"} no tiene #${n}`);
  }
});

await step("los archivos del plan de un mismo idioma no chocan entre espacios", async () => {
  setActiveScope("pt");
  const a = assignmentsPath("es-419", "NEH");
  setActiveScope("es");
  const b = assignmentsPath("es-419", "NEH");
  setActiveScope("");
  const c = assignmentsPath("es-419", "NEH");
  assert.equal(new Set([a, b, c]).size, 3);
});

setActiveScope("");
console.log(`\nverify-scope-mock: ${passed} checks passed.`);
