import assert from "node:assert/strict";
import { issueNumberOf, listMentions, markMentionRead, markSeen, mentionRows, mentionText, withoutSeen } from "../src/dcs/mentions";

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
    if (/\/issues\/\d+$/.test(input)) return new Response(JSON.stringify({ labels: [] }), { status: 200 });
    return new Response(JSON.stringify([t(1, "es-419_gl/gateway-tasks", "https://q/api/v1/repos/es-419_gl/gateway-tasks/issues/1")]), { status: 200 });
  }) as unknown as typeof fetch;
  const session = { host: "https://qa.door43.org/", token: "tok", username: "abelperez" } as never;
  const rows = await listMentions(session, "es-419_gl", "gateway-tasks", fake);
  assert.equal(rows.length, 1);
  assert.match(calls[0]!.url, /^https:\/\/qa\.door43\.org\/api\/v1\/notifications\?status-types=unread/);
  assert.equal(calls[0]!.auth, "token tok");
  await markMentionRead(session, 1, fake);
  const patch = calls.find((c) => c.method === "PATCH")!;
  assert.match(patch.url, /\/notifications\/threads\/1\?to-status=read$/);
});

await test("si Door43 no responde bien, no hay menciones y no se rompe nada", async () => {
  const fail = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
  assert.deepEqual(await listMentions({ host: "https://qa.door43.org", token: "t", username: "a" } as never, "o", "r", fail), []);
});

await test("lo que abriste en este dispositivo no vuelve, salvo que haya un comentario más nuevo", () => {
  const row = { id: 5, issue: 1, title: "x", at: "2026-10-01T10:00:00Z" };
  const seen = markSeen({}, row);
  assert.deepEqual(withoutSeen([row], seen), []);
  assert.equal(withoutSeen([{ ...row, at: "2026-10-01T11:00:00Z" }], seen).length, 1, "un comentario nuevo la muestra otra vez");
  assert.equal(withoutSeen([{ ...row, id: 6 }], seen).length, 1, "otra mención distinta sigue pendiente");
});

await test("la lista de lo visto se recorta para no crecer sin fin", () => {
  let seen = {};
  for (let i = 1; i <= 30; i++) seen = markSeen(seen, { id: i, at: `2026-10-01T10:${String(i).padStart(2, "0")}:00Z` }, 10);
  assert.equal(Object.keys(seen).length, 10);
  assert.ok("30" in seen && !("1" in seen), "se olvidan las más viejas");
});

await test("el aviso muestra lo que te dijeron: el último comentario que te nombra", () => {
  const comments = [
    { body: "@ana ¿puedes mirar esto?", user: { login: "bea" }, created_at: "2026-10-01T10:00:00Z" },
    { body: "<!-- gt:marca -->\n@ana @carla Traducción de 3 Juan va en 15 de 21.\nConviene empezar ya el libro siguiente.", user: { login: "bea" }, created_at: "2026-10-02T10:00:00Z" },
    { body: "Listo, gracias.", user: { login: "carla" }, created_at: "2026-10-03T10:00:00Z" },
    { body: "@ana nota para mí", user: { login: "ana" }, created_at: "2026-10-04T10:00:00Z" },
  ];
  assert.deepEqual(mentionText(comments, "ana"), { text: "Traducción de 3 Juan va en 15 de 21. Conviene empezar ya el libro siguiente.", by: "bea" });
  assert.deepEqual(mentionText(comments.slice(0, 3), "dina"), { text: "Listo, gracias.", by: "carla" }, "sin mención: lo último que dijo otra persona");
  assert.deepEqual(mentionText([{ body: "@ana primero", user: { login: "bea" }, created_at: "1" }, { body: "@anabel después", user: { login: "bea" }, created_at: "2" }], "ana")?.text, "primero", "«@anabel» no es «@ana»");
  assert.equal(mentionText([], "ana"), null);
  assert.equal(mentionText([{ body: "x".repeat(400), user: { login: "bea" } }], "ana")!.text.length, 218);
});

console.log(`\nverify-mentions: ${passed} checks passed.`);
