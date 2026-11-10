/**
 * How much Taller asks of Door43 (6 November 2026). With Nehemías (1.221 subtareas) opening «Mis tareas» sent 77
 * requests at once over one HTTP/2 connection; Door43 answered some after 27 s. And every «Terminé», «Proyectos» and
 * «Equipo hoy» read whole books again. Two things are checked here:
 *  - the gate: no more than a few requests to Door43 at a time, and a write never waits behind a list;
 *  - the subtareas of a project are read once and then brought up to date with what changed (one page).
 * Run: npx tsx --tsconfig tsconfig.scripts.json scripts/verify-door43-load.mts
 */
import assert from "node:assert/strict";
import { createGate, gatedFetch, door43Writes } from "../src/dcs/door43Gate.ts";
import { forgetProjectIssues, keepProjectsIn, listProjectIssues, listProjectOpenIssues, PROJECT_FRESH_MS, pullIssues, syncProjectOpenIssues } from "../src/dcs/issues.ts";
import { memoryStore } from "../src/lib/deviceStore.ts";
import type { GtSession } from "../src/dcs/auth.ts";

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- The gate ----------

await test("nunca van más de seis peticiones a la vez a Door43, y todas terminan", async () => {
  const gate = createGate(6);
  let inFlight = 0;
  let most = 0;
  const done = await Promise.all(Array.from({ length: 30 }, (_, i) => gate.run("GET", async () => {
    inFlight++;
    most = Math.max(most, inFlight);
    await tick(5);
    inFlight--;
    return i;
  })));
  assert.equal(most, 6);
  assert.deepEqual(done, Array.from({ length: 30 }, (_, i) => i));
});

await test("guardar algo pasa delante de las listas que esperan", async () => {
  const gate = createGate(1);
  const order: string[] = [];
  const first = gate.run("GET", async () => { await tick(10); order.push("lista 1"); });
  const lists = [2, 3, 4].map((n) => gate.run("GET", async () => { order.push(`lista ${n}`); }));
  const save = gate.run("PATCH", async () => { order.push("guardar"); });
  await Promise.all([first, ...lists, save]);
  assert.deepEqual(order, ["lista 1", "guardar", "lista 2", "lista 3", "lista 4"]);
});

await test("una petición que falla libera su lugar", async () => {
  const gate = createGate(1);
  await assert.rejects(gate.run("GET", async () => { throw new Error("sin red"); }));
  assert.equal(await gate.run("GET", async () => "sigue"), "sigue");
});

await test("solo pasa por la cola lo que va a Door43; cada escritura se cuenta", async () => {
  const seen: string[] = [];
  const inner = (async (input: RequestInfo | URL) => { seen.push(String(input)); return new Response("{}"); }) as typeof fetch;
  const f = gatedFetch(inner, createGate(2));
  const before = door43Writes();
  await f("https://git.door43.org/api/v1/version");
  await f("https://qa.door43.org/api/v1/repos/x/y/issues/1", { method: "PATCH" });
  await f("http://localhost:5189/src/main.tsx");
  assert.equal(seen.length, 3);
  assert.equal(door43Writes(), before + 1, "el PATCH a Door43 cuenta; leer y lo que no es de Door43, no");
});

// ---------- One reading of a project, kept ----------

const ORG = "es-419_gl";
type Row = { number: number; state: "open" | "closed"; updated_at: string };
let rows: Row[] = [];
const asked: { state: string; since: string | null; page: number }[] = [];
const iso = (ms: number) => new Date(ms).toISOString();
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input));
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (url.pathname.endsWith("/repos/issues/search")) {
    const state = url.searchParams.get("state") || "open";
    const since = url.searchParams.get("since");
    const page = Number(url.searchParams.get("page") || "1");
    asked.push({ state, since, page });
    const list = rows
      .filter((r) => state === "all" || r.state === state)
      .filter((r) => !since || Date.parse(r.updated_at) >= Date.parse(since))
      .sort((a, b) => b.number - a.number)
      .slice((page - 1) * 50, page * 50)
      .map((r) => ({ ...r, id: r.number, title: `NEH ${r.number}`, body: "", labels: [{ id: 1, name: "pm" }], milestone: { id: 1, title: "NEH" }, assignees: [], repository: { name: "taller", full_name: `${ORG}/taller` } }));
    return json(list);
  }
  return json({ message: "not found" }, 404);
}) as typeof fetch;

const session: GtSession = { host: "https://git.door43.org", username: "abelper8", token: "tok", scopesVersion: 3 };
const realNow = Date.now;
let clock = Date.parse("2026-11-06T16:00:00Z");
Date.now = () => clock;
const fresh = (n: number) => Array.from({ length: n }, (_, i): Row => ({ number: i + 1, state: "open", updated_at: iso(clock - 3_600_000) }));

await test("leer dos veces seguidas las subtareas de un proyecto pide a Door43 una sola vez", async () => {
  forgetProjectIssues();
  rows = fresh(1221);
  asked.length = 0;
  const first = await listProjectOpenIssues(session, ORG, "NEH");
  const pages = asked.length;
  const second = await listProjectOpenIssues(session, ORG, "NEH");
  assert.equal(first.length, 1221);
  assert.equal(second.length, 1221);
  assert.equal(asked.length, pages, "la segunda no pidió nada");
});

await test("pasado el rato, se pide solo lo que cambió: una página, y la subtarea cerrada sale de las abiertas", async () => {
  forgetProjectIssues();
  rows = fresh(1221);
  await listProjectOpenIssues(session, ORG, "NEH");
  clock += PROJECT_FRESH_MS + 1000;
  rows[0] = { ...rows[0]!, state: "closed", updated_at: iso(clock) };
  asked.length = 0;
  const open = await listProjectOpenIssues(session, ORG, "NEH");
  assert.equal(asked.length, 1, `pidió ${asked.length} páginas`);
  assert.ok(asked[0]!.since, "con «desde»");
  assert.equal(open.length, 1220);
  assert.ok(!open.some((i) => i.number === 1));
});

await test("después de guardar algo en Door43, la siguiente lectura pregunta qué cambió aunque no haya pasado el rato", async () => {
  forgetProjectIssues();
  rows = fresh(10);
  await listProjectOpenIssues(session, ORG, "NEH");
  const f = gatedFetch((async () => new Response("{}")) as typeof fetch, createGate(2));
  await f("https://git.door43.org/api/v1/repos/es-419_gl/taller/issues/3", { method: "PATCH" });
  rows[2] = { ...rows[2]!, state: "closed", updated_at: iso(clock) };
  asked.length = 0;
  const open = await listProjectOpenIssues(session, ORG, "NEH");
  assert.equal(asked.length, 1);
  assert.equal(open.length, 9);
});

await test("todas las subtareas (abiertas y cerradas) se leen una vez; las abiertas salen de ahí sin pedir más", async () => {
  forgetProjectIssues();
  rows = fresh(120).map((r, i) => (i < 20 ? { ...r, state: "closed" as const } : r));
  asked.length = 0;
  const { issues: all } = await listProjectIssues(session, ORG, "NEH");
  const pages = asked.length;
  const again = await listProjectIssues(session, ORG, "NEH");
  const open = await listProjectOpenIssues(session, ORG, "NEH");
  assert.equal(all.length, 120);
  assert.equal(again.issues.length, 120);
  assert.equal(open.length, 100);
  assert.equal(asked.length, pages);
});

await test("la lista guardada de «Mis tareas» sirve de punto de partida: no se lee el libro entero", async () => {
  forgetProjectIssues();
  rows = fresh(1221);
  const kept = { at: iso(clock - 60_000), issues: (await listProjectOpenIssues(session, ORG, "NEH")).slice() };
  forgetProjectIssues();
  asked.length = 0;
  const open = await syncProjectOpenIssues(session, ORG, "NEH", kept);
  assert.equal(open.length, 1221);
  assert.equal(asked.length, 1, "solo lo cambiado");
  asked.length = 0;
  await listProjectOpenIssues(session, ORG, "NEH");
  assert.equal(asked.length, 0, "y las demás pantallas lo aprovechan");
});

// ---------- Each book kept in the device (9 November 2026) ----------

const device = memoryStore();
keepProjectsIn(device);
/** Opening the app again: what the page had read is gone, what the device keeps is not. */
const reopen = () => forgetProjectIssues();

await test("al volver a abrir la app, el libro guardado en el aparato se pone al día con una página", async () => {
  rows = fresh(1221);
  reopen();
  await listProjectOpenIssues(session, ORG, "NEH");
  clock += 12 * 3_600_000;
  rows[4] = { ...rows[4]!, state: "closed", updated_at: iso(clock) };
  reopen();
  asked.length = 0;
  const open = await listProjectOpenIssues(session, ORG, "NEH");
  assert.equal(asked.length, 1, `pidió ${asked.length} páginas`);
  assert.ok(asked[0]!.since, "con «desde»");
  assert.equal(open.length, 1220);
});

await test("abiertas y cerradas: la primera vez se lee entero, y desde entonces también se pone al día desde el aparato", async () => {
  rows = fresh(300).map((r, i) => (i < 200 ? { ...r, state: "closed" as const } : r));
  reopen();
  asked.length = 0;
  await listProjectIssues(session, ORG, "NEH");
  assert.ok(asked.length >= 6, "la primera vez, entero");
  clock += 3_600_000;
  reopen();
  asked.length = 0;
  const { issues } = await listProjectIssues(session, ORG, "NEH");
  assert.equal(asked.length, 1);
  assert.equal(issues.length, 300);
  assert.equal((await listProjectOpenIssues(session, ORG, "NEH")).length, 100, "las abiertas salen de ahí");
});

await test("abrir un proyecto (sus subtareas en el tablero) usa lo que ya se leyó, sin leer el libro otra vez", async () => {
  rows = fresh(1221);
  reopen();
  await listProjectIssues(session, ORG, "NEH");
  asked.length = 0;
  const board = { people: [], assignments: [] } as unknown as Parameters<typeof pullIssues>[0]["board"];
  const pulled = await pullIssues({ session, org: ORG, book: "NEH", board });
  assert.equal(pulled.issues.length, 1221);
  assert.equal(asked.length, 0);
});

await test("un libro leído entero hace más de una semana se lee entero otra vez, aunque se haya puesto al día", async () => {
  rows = fresh(120);
  reopen();
  await listProjectOpenIssues(session, ORG, "NEH");
  for (let day = 0; day < 8; day++) {
    clock += 24 * 3_600_000;
    reopen();
    asked.length = 0;
    await listProjectOpenIssues(session, ORG, "NEH");
  }
  assert.ok(asked.every((a) => !a.since) && asked.length >= 3, "el octavo día, sin «desde»");
});

await test("lo que se guarda de cada subtarea es lo que las pantallas leen, no la subtarea entera", async () => {
  const saved = device.keys().find((k) => k.includes("NEH"))!;
  const kept = (await device.get<{ open?: Record<string, unknown>[] }>(saved))!;
  assert.ok(kept.open?.length);
  assert.equal(typeof kept.open![0]!.body, "string");
  assert.equal((kept.open![0]!.repository as Record<string, unknown>).full_name, `${ORG}/taller`);
});

Date.now = realNow;
console.log(`\nverify-door43-load: ${passed} checks passed.`);
