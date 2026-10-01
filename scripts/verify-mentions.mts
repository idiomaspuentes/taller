import assert from "node:assert/strict";
import { issueNumberOf, listMentions, markMentionRead, mentionRows } from "../src/dcs/mentions";

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}
const t = (id: number, repo: string, url: string, over: object = {}) => ({ id, unread: true, updated_at: `2026-10-0${id}T10:00:00Z`, subject: { title: `Tarea ${id}`, url, type: "Issue" }, repository: { full_name: repo }, ...over });

await test("se saca el número de la subtarea de la dirección de la API", () => {
  assert.equal(issueNumberOf("https://qa.door43.org/api/v1/repos/es-419_gl/gateway-tasks/issues/12"), 12);
  assert.equal(issueNumberOf("https://x/pulls/3"), null);
  assert.equal(issueNumberOf(undefined), null);
});

await test("solo cuentan las no leídas del repositorio del proyecto, la más reciente primero", () => {
  const rows = mentionRows(
    [
      t(1, "es-419_gl/gateway-tasks", "https://q/api/v1/repos/es-419_gl/gateway-tasks/issues/1"),
      t(2, "es-419_gl/otro", "https://q/api/v1/repos/es-419_gl/otro/issues/2"),
      t(3, "ES-419_gl/Gateway-Tasks", "https://q/api/v1/repos/es-419_gl/gateway-tasks/issues/3"),
      t(4, "es-419_gl/gateway-tasks", "https://q/api/v1/repos/es-419_gl/gateway-tasks/issues/4", { unread: false }),
      t(5, "es-419_gl/gateway-tasks", "https://q/api/v1/repos/es-419_gl/gateway-tasks/pulls/5", { subject: { type: "Pull", url: "https://q/pulls/5" } }),
    ],
    "es-419_gl",
    "gateway-tasks",
  );
  assert.deepEqual(rows.map((r) => r.issue), [3, 1]);
});

await test("pide las no leídas con el token y marca una como leída", async () => {
  const calls: { url: string; method: string; auth: string }[] = [];
  const fake = (async (input: string, init?: RequestInit) => {
    calls.push({ url: input, method: init?.method ?? "GET", auth: String((init?.headers as Record<string, string>).authorization) });
    return new Response(JSON.stringify([t(1, "es-419_gl/gateway-tasks", "https://q/api/v1/repos/es-419_gl/gateway-tasks/issues/1")]), { status: 200 });
  }) as unknown as typeof fetch;
  const session = { host: "https://qa.door43.org/", token: "tok", username: "abelperez" } as never;
  const rows = await listMentions(session, "es-419_gl", "gateway-tasks", fake);
  assert.equal(rows.length, 1);
  assert.match(calls[0]!.url, /^https:\/\/qa\.door43\.org\/api\/v1\/notifications\?status-types=unread/);
  assert.equal(calls[0]!.auth, "token tok");
  await markMentionRead(session, 1, fake);
  assert.equal(calls[1]!.method, "PATCH");
  assert.match(calls[1]!.url, /\/notifications\/threads\/1\?to-status=read$/);
});

await test("si Door43 no responde bien, no hay menciones y no se rompe nada", async () => {
  const fail = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
  assert.deepEqual(await listMentions({ host: "https://qa.door43.org", token: "t", username: "a" } as never, "o", "r", fail), []);
});

console.log(`\nverify-mentions: ${passed} checks passed.`);
