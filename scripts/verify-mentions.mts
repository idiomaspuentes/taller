import assert from "node:assert/strict";
import { issueNumberOf, listMentions, markMentionRead, markSeen, mentionComment, mentionRows, mentionText, namesPerson, withoutSeen } from "../src/dcs/mentions";
import { asksWhileOpen, whileOpen } from "../src/domain/commentPlace";

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
  assert.deepEqual(mentionText(comments, "ana"), { text: "Traducción de 3 Juan va en 15 de 21. Conviene empezar ya el libro siguiente.", by: "bea", saidAt: "2026-10-03T10:00:00Z" });
  assert.deepEqual(mentionText(comments.slice(0, 3), "dina"), { text: "Listo, gracias.", by: "carla", saidAt: "2026-10-03T10:00:00Z" }, "sin mención: lo último que dijo otra persona");
  assert.deepEqual(mentionText([{ body: "@ana primero", user: { login: "bea" }, created_at: "1" }, { body: "@anabel después", user: { login: "bea" }, created_at: "2" }], "ana")?.text, "primero", "«@anabel» no es «@ana»");
  assert.equal(mentionText([{ body: "**JUD 1:1** — @ana @carla Propongo «guardados para Jesucristo».", user: { login: "bea" } }], "ana")?.text, "**JUD 1:1** — Propongo «guardados para Jesucristo».", "los nombres del principio se quitan también tras el lugar");
  assert.equal(mentionText([], "ana"), null);
  assert.equal(mentionText([{ body: "x".repeat(400), user: { login: "bea" } }], "ana")!.text.length, 218);
});

await test("de una subtarea ya terminada solo queda el aviso si alguien te nombró", async () => {
  assert.equal(namesPerson([{ body: "@ana mira esto", user: { login: "bea" } }], "ana"), true);
  assert.equal(namesPerson([{ body: "@anabel mira esto", user: { login: "bea" } }, { body: "@ana nota mía", user: { login: "ana" } }], "ana"), false);
  const url = (n: number) => `https://q/api/v1/repos/org/plan/issues/${n}`;
  const comments: Record<number, object[]> = {
    61: [{ body: "Listo.", user: { login: "bea" }, created_at: "1" }],
    62: [{ body: "@ana ¿lo registras tú?", user: { login: "bea" }, created_at: "1" }],
    63: [],
  };
  const state: Record<number, string> = { 61: "closed", 62: "closed", 63: "open" };
  const fake = (async (input: string) => {
    const issue = Number(/\/issues\/(\d+)/.exec(input)?.[1] ?? 0);
    if (/\/comments$/.test(input)) return new Response(JSON.stringify(comments[issue] ?? []), { status: 200 });
    if (issue) return new Response(JSON.stringify({ labels: [], state: state[issue] }), { status: 200 });
    return new Response(JSON.stringify([t(1, "org/plan", url(61)), t(2, "org/plan", url(62)), t(3, "org/plan", url(63))]), { status: 200 });
  }) as unknown as typeof fetch;
  const rows = await listMentions({ host: "https://terminadas.example", token: "t", username: "ana" } as never, "org", "plan", fake);
  assert.deepEqual(rows.map((row) => row.issue).sort(), [62, 63], "la terminada sin mención no se lista; la que te nombra y la abierta sí");
});

await test("lo que ya respondiste deja de estar pendiente; lo que te digan después, vuelve", () => {
  const asked = { body: "@ana ¿está bien «libertinaje»?", user: { login: "bea" }, created_at: "2026-10-01T10:00:00Z" };
  const answer = { body: "@bea sí, déjalo así.", user: { login: "ana" }, created_at: "2026-10-01T10:05:00Z" };
  assert.equal(mentionComment([asked], "ana")?.about, asked);
  assert.equal(mentionComment([asked, answer], "ana"), null, "respondiste a quien te lo dijo: no queda nada");
  assert.equal(mentionText([asked, answer], "ana"), null);
  const thanks = { body: "Gracias, lo dejo.", user: { login: "bea" }, created_at: "2026-10-01T10:09:00Z" };
  assert.deepEqual(mentionText([asked, answer, thanks], "ana"), { text: "Gracias, lo dejo.", by: "bea", saidAt: "2026-10-01T10:09:00Z" }, "lo dicho después de tu respuesta");
  // Something the app wrote in your name about another matter is not an answer to the question.
  const other = { body: "**JUD 1:4** — @carla Corregí el versículo.", user: { login: "ana" }, created_at: "2026-10-01T10:05:00Z" };
  assert.equal(mentionComment([asked, other], "ana")?.about, asked, "escribir a otra persona no responde la pregunta");
  assert.equal(mentionComment([{ ...answer, created_at: "2026-10-01T09:00:00Z" }, asked], "ana")?.about, asked, "lo que le escribiste antes de la pregunta no la responde");
});

await test("que la subtarea se cierre no trae de vuelta lo que ya abriste", () => {
  const opened = { id: 7, issue: 1, title: "x", at: "2026-10-01T10:00:02Z", saidAt: "2026-10-01T10:00:00Z" };
  const seen = markSeen({}, opened);
  // Door43 touched the notification when the subtarea was closed: nothing new was said.
  assert.deepEqual(withoutSeen([{ ...opened, at: "2026-10-01T12:00:00Z" }], seen), []);
  assert.equal(withoutSeen([{ ...opened, at: "2026-10-01T12:00:00Z", saidAt: "2026-10-01T11:59:00Z" }], seen).length, 1, "algo nuevo dicho sí la muestra");
});

await test("de una subtarea terminada no queda lo que pedía hacer algo en ella, ni se vuelve a leer cada minuto", async () => {
  const nudge = whileOpen("@ana Todo quedó de acuerdo: ya se puede cerrar la revisión.");
  assert.ok(asksWhileOpen(nudge) && !asksWhileOpen("@ana ¿lo registras tú?"));
  assert.equal(mentionText([{ body: nudge, user: { login: "bea" }, created_at: "1" }], "ana")?.text, "Todo quedó de acuerdo: ya se puede cerrar la revisión.", "la marca no se lee");
  const url = (n: number) => `https://q/api/v1/repos/org/plan/issues/${n}`;
  const comments: Record<number, object[]> = {
    71: [{ body: nudge, user: { login: "bea" }, created_at: "1" }],
    72: [{ body: nudge, user: { login: "bea" }, created_at: "1" }],
    73: [{ body: "@ana ¿lo registras tú?", user: { login: "bea" }, created_at: "1" }, { body: "@bea sí, ya está.", user: { login: "ana" }, created_at: "2" }],
    74: [{ body: "@ana Traducción de Judas va en 50 de 71.", user: { login: "bea" }, created_at: "1" }],
  };
  const state: Record<number, string> = { 71: "closed", 72: "open", 73: "open", 74: "closed" };
  let reads = 0;
  const fake = (async (input: string) => {
    const issue = Number(/\/issues\/(\d+)/.exec(input)?.[1] ?? 0);
    if (issue) reads++;
    if (/\/comments$/.test(input)) return new Response(JSON.stringify(comments[issue] ?? []), { status: 200 });
    if (issue) return new Response(JSON.stringify({ labels: [], state: state[issue] }), { status: 200 });
    return new Response(JSON.stringify([71, 72, 73, 74].map((n, i) => t(i + 1, "org/plan", url(n)))), { status: 200 });
  }) as unknown as typeof fetch;
  const session = { host: "https://pedidos.example", token: "t", username: "ana" } as never;
  const rows = await listMentions(session, "org", "plan", fake);
  assert.deepEqual(rows.map((row) => row.issue).sort(), [72, 74], "queda el pedido de la que sigue abierta y el aviso que no pide nada de la subtarea; no el pedido de la terminada ni lo respondido");
  assert.equal(reads, 8);
  await listMentions(session, "org", "plan", fake);
  assert.equal(reads, 8, "mientras Door43 no toque el aviso, no se vuelve a leer su subtarea ni sus comentarios");
});

console.log(`\nverify-mentions: ${passed} checks passed.`);
