/**
 * A project is read whole, however many subtareas it has. Nehemías was started with 1.221 open subtareas
 * (6 November 2026) and every reading of a project stopped at 20 pages (1.000) or 10 (500): «Mis tareas» did not
 * see the TPL at all, nor the TPS of chapters 1–7, so the group reading of the TPS looked free before anybody had
 * translated a word; and publishing the plan again would have created the unseen subtareas a second time.
 * Run: npx tsx scripts/verify-whole-project.mts
 */
import assert from "node:assert/strict";
import { listProjectIssues, listProjectOpenIssues, listTeamOpenIssues, previewPublishWorkOrders } from "../src/dcs/issues.ts";
import { keptTasks, keptTasksKey } from "../src/domain/myTasksCache.ts";
import { workOrderIssueBody, workOrderIssueTitle, type WorkOrder } from "../src/domain/workOrder.ts";
import type { AssignmentsDoc, InventoryDoc } from "../src/domain/types.ts";
import type { GtSession } from "../src/dcs/auth.ts";

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

const ORG = "es-419_gl";
const PM = "taller";
const TOTAL = 1221;

function order(n: number): WorkOrder {
  const label = `NEH-${String(n).padStart(4, "0")}`;
  return {
    key: `NEH|tps|tps|${label}|porcion:${label}`,
    teamId: "tps",
    teamName: "Traducir TPS",
    book: "NEH",
    resource: "tps",
    chapter: 1,
    portionIds: [label],
    itemIds: [`porcion:${label}`],
    itemTypes: ["porcion"],
    label: `${label} · TPS`,
  };
}

const orders = Array.from({ length: TOTAL }, (_, i) => order(i + 1));
const issues = orders.map((o, i) => ({
  id: i + 1,
  number: i + 1,
  title: workOrderIssueTitle(o),
  body: workOrderIssueBody(o),
  state: "open",
  labels: [{ id: 1, name: "pm" }, { id: 2, name: "pm/tarea:tps" }],
  milestone: { id: 1, title: "NEH" },
  assignees: [],
  assignee: null,
  html_url: `https://git.door43.org/${ORG}/${PM}/issues/${i + 1}`,
  repository: { name: PM, full_name: `${ORG}/${PM}` },
}));

// Like Door43: the newest first, `limit` per page, an empty page after the last.
const asked: number[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : String(input));
  const path = url.pathname.replace(/^\/api\/v1/, "");
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (path === "/repos/issues/search") {
    const page = Number(url.searchParams.get("page") || "1");
    const limit = Number(url.searchParams.get("limit") || "50");
    asked.push(page);
    const newestFirst = [...issues].reverse();
    return json(newestFirst.slice((page - 1) * limit, page * limit));
  }
  if (path === `/repos/${ORG}/${PM}`) return json({ id: 1, name: PM, full_name: `${ORG}/${PM}`, owner: { id: 1, login: ORG } });
  return json({ message: "not found" }, 404);
}) as typeof fetch;

const session: GtSession = { host: "https://git.door43.org", username: "abelper8", token: "tok", scopesVersion: 3 };

await test("«Mis tareas» lee las 1.221 subtareas abiertas de Nehemías, también las primeras que se crearon", async () => {
  const open = await listProjectOpenIssues(session, ORG, "NEH");
  assert.equal(open.length, TOTAL);
  assert.ok(open.some((i) => i.number === 1), "la subtarea más antigua (el TPL de 1:1) está");
});

await test("leer el proyecto entero (abiertas y cerradas) tampoco se corta a las mil", async () => {
  const { issues: all } = await listProjectIssues(session, ORG, "NEH");
  assert.equal(all.length, TOTAL);
});

await test("lo libre de un equipo tampoco se corta a las quinientas", async () => {
  const free = await listTeamOpenIssues(session, ORG, "pm-traductores-tps");
  assert.equal(free.length, TOTAL);
});

await test("publicar otra vez el plan de Nehemías no crea ninguna subtarea repetida", async () => {
  const board = { book: "NEH", projectId: "NEH", people: [], teams: [], assignments: [] } as unknown as AssignmentsDoc;
  const inventory = { portions: [], articles: [] } as unknown as InventoryDoc;
  const preview = await previewPublishWorkOrders({ session, org: ORG, board, inventory, orders });
  assert.equal(preview.created, 0, "ninguna nueva: ya existen todas");
  assert.equal(preview.updated, TOTAL);
  assert.equal(preview.closed, 0, "ninguna se toma por huérfana");
});

await test("se pide hasta la primera página vacía y no más", () => {
  const pages = Math.ceil(TOTAL / 50);
  assert.ok(Math.max(...asked) <= pages + 4, `pidió hasta la página ${Math.max(...asked)}`);
});

await test("una lista de «Mis tareas» guardada antes del arreglo (con el hueco) no se vuelve a usar", async () => {
  const where = { host: session.host, username: "Elisha", pmOrg: ORG, lang: "es-419", contentOrg: ORG, mode: "trabajo" };
  const store = new Map<string, string>();
  const oldKey = `taller-mis-tareas:${[where.host, "elisha", where.pmOrg, where.lang, where.contentOrg, where.mode].join("|")}`;
  store.set(oldKey, JSON.stringify({ at: new Date().toISOString(), projects: [], catalog: {}, conflicted: [], closed: [] }));
  assert.notEqual(keptTasksKey(where), oldKey);
  assert.equal(await keptTasks(keptTasksKey(where), new Date(), { get: async (k: string) => store.get(k) ?? null, set: async () => {} }), null);
});

console.log(`\nverify-whole-project: ${passed} checks passed.`);
