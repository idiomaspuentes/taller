/**
 * The push Worker, without a network: subscribing with a Door43 token, the signed webhook, who is told
 * and what is said, the push itself (really encrypted and signed) and forgetting dead devices.
 */
import assert from "node:assert/strict";
import { createHandler } from "../push-worker/src/index";
import { MAX_DEVICES } from "../push-worker/src/store";
import { payloadOf } from "../push-worker/src/send";
import { askedNotices, mentionsIn, noticesFor, readableLine, subtarea } from "../push-worker/src/webhook";
import { formatChatEvent } from "../src/domain/chatEvent";
import type { Env } from "../push-worker/src/env";

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

// ---- a tiny KV ----
class FakeKV {
  data = new Map<string, string>();
  lists = 0;
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.data.set(key, value);
  }
  async delete(key: string) {
    this.data.delete(key);
  }
  async list(opts: { prefix?: string } = {}) {
    this.lists++;
    return { keys: [...this.data.keys()].filter((k) => k.startsWith(opts.prefix ?? "")).sort().map((name) => ({ name })), list_complete: true };
  }
}

/** How many devices the KV holds for one person (all in one key). */
const devicesOf = (login: string): string[] => {
  const raw = kv.data.get(`u:https://qa.door43.org:${login}`);
  return raw ? (JSON.parse(raw) as { devices: { sub: { endpoint: string } }[] }).devices.map((d) => d.sub.endpoint) : [];
};

const b64url = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");

// ---- real keys: the Worker's VAPID pair and a device's subscription keys ----
async function vapidPair() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: b64url(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")])), privateKey: jwk.d! };
}
async function deviceSubscription(endpoint: string) {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
  return { endpoint, expirationTime: null, keys: { p256dh: b64url(raw), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) } };
}

const vapid = await vapidPair();
const kv = new FakeKV();
const env: Env = {
  SUBSCRIPTIONS: kv as unknown as KVNamespace,
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: "mailto:equipo@example.org",
  WEBHOOK_SECRET: "secreto-de-prueba",
  ALLOWED_HOSTS: "https://qa.door43.org",
  ALLOWED_ORIGINS: "https://app.example.org",
  APP_URL: "https://app.example.org",
};

const ISSUE_67 = {
  number: 67,
  title: "3JN 1:5–8 · TPL",
  body: ["## 1:5–8 · TPL", "", "- Tarea: **Alinear TPL**", "- Fase: **Afinación**", "- Proyecto: **3JN**"].join("\n"),
  milestone: { title: "3JN" },
  labels: [{ name: "pm" }, { name: "pm/libro:3JN" }],
};

// ---- a fake Door43 and a fake push service ----
const TOKENS: Record<string, string> = { "tok-ana": "ana", "tok-bea": "Bea" };
type Sent = { endpoint: string; headers: Record<string, string>; bytes: number };
let pushes: Sent[] = [];
let pushStatus: Record<string, number> = {};
const fakeFetch = async (input: string, init?: RequestInit): Promise<Response> => {
  if (input.startsWith("https://qa.door43.org/api/v1/user")) {
    const token = /^token (.+)$/.exec(String((init?.headers as Record<string, string>)?.Authorization ?? ""))?.[1] ?? "";
    return TOKENS[token] ? new Response(JSON.stringify({ login: TOKENS[token] }), { status: 200 }) : new Response("{}", { status: 401 });
  }
  // A subtarea, as Door43 gives it to whoever may read it.
  if (input === "https://qa.door43.org/api/v1/repos/BSOJ/gateway-tasks/issues/67") {
    const token = /^token (.+)$/.exec(String((init?.headers as Record<string, string>)?.Authorization ?? ""))?.[1] ?? "";
    return TOKENS[token] ? new Response(JSON.stringify(ISSUE_67), { status: 200 }) : new Response("{}", { status: 404 });
  }
  if (input.startsWith("https://push.example/")) {
    pushes.push({ endpoint: input, headers: init?.headers as Record<string, string>, bytes: (init?.body as Uint8Array).byteLength });
    return new Response(null, { status: pushStatus[input] ?? 201 });
  }
  return new Response("no", { status: 500 });
};
const handle = createHandler({ fetch: fakeFetch });

const subscribe = async (token: string, subscription: unknown, extra: Record<string, string> = {}, method = "POST") =>
  handle(
    new Request("https://tas-push.example/subscribe", {
      method,
      headers: { authorization: `token ${token}`, "x-door43-host": "https://qa.door43.org", "content-type": "application/json", origin: "https://app.example.org", ...extra },
      body: JSON.stringify(method === "POST" ? { subscription } : subscription),
    }),
    env,
  );

async function sign(body: string, secret = env.WEBHOOK_SECRET) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))).toString("hex");
}
const webhook = async (event: string, payload: unknown, signature?: string) => {
  const body = JSON.stringify(payload);
  return handle(
    new Request("https://tas-push.example/webhook", {
      method: "POST",
      headers: { "x-gitea-event": event, "x-gitea-signature": signature ?? (await sign(body)), "content-type": "application/json" },
      body,
    }),
    env,
  );
};
const repo = { html_url: "https://qa.door43.org/BSOJ/gateway-tasks", full_name: "BSOJ/gateway-tasks" };
const comment = (body: string, by = "ana", assignees: string[] = []) => ({
  action: "created",
  issue: { number: 7, title: "NEH 1:1 · Decidir: objeción de @bea", assignees: assignees.map((login) => ({ login })) },
  comment: { body, user: { login: by } },
  sender: { login: by },
  repository: repo,
});

await test("la clave pública se sirve sin pedir nada, y solo a los orígenes permitidos se les deja llamar desde el navegador", async () => {
  const res = await handle(new Request("https://tas-push.example/vapid", { headers: { origin: "https://app.example.org" } }), env);
  assert.equal(((await res.json()) as { publicKey: string }).publicKey, vapid.publicKey);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://app.example.org");
  const other = await handle(new Request("https://tas-push.example/vapid", { headers: { origin: "https://malo.example" } }), env);
  assert.equal(other.headers.get("access-control-allow-origin"), "null");
});

await test("suscribirse pide el token de Door43, que solo se usa para saber quién eres; si no, no se guarda nada", async () => {
  const sub = await deviceSubscription("https://push.example/bea-1");
  assert.equal((await subscribe("tok-bea", sub)).status, 204);
  assert.deepEqual([...kv.data.keys()], ["u:https://qa.door43.org:bea"], "una sola clave por persona, con el usuario en minúsculas");
  assert.ok(![...kv.data.values()].some((v) => v.includes("tok-bea")), "el token no se guarda");
  assert.equal((await subscribe("tok-malo", sub)).status, 401, "token que Door43 no conoce");
  assert.equal((await subscribe("tok-bea", sub, { "x-door43-host": "https://git.door43.org" })).status, 401, "un servidor que este Worker no atiende");
  assert.equal((await subscribe("tok-bea", { endpoint: "http://inseguro", keys: {} })).status, 400, "una suscripción mal hecha");
});

await test("cada persona guarda como mucho unos pocos dispositivos y se olvidan los más viejos; también puede darse de baja", async () => {
  for (let i = 2; i <= MAX_DEVICES + 3; i++) await subscribe("tok-ana", await deviceSubscription(`https://push.example/ana-${i}`));
  assert.equal(devicesOf("ana").length, MAX_DEVICES);
  const keep = await deviceSubscription("https://push.example/ana-last");
  await subscribe("tok-ana", keep);
  assert.equal((await subscribe("tok-ana", { endpoint: keep.endpoint }, {}, "DELETE")).status, 204);
  assert.ok(![...kv.data.values()].some((v) => v.includes("ana-last")));
});

await test("el aviso de Door43 solo vale si trae la firma del secreto compartido", async () => {
  assert.equal((await webhook("issue_comment", comment("hola @bea"), "0".repeat(64))).status, 401);
  assert.equal((await webhook("issue_comment", comment("hola @bea"), await sign("otro cuerpo"))).status, 401);
  const noHeader = await handle(new Request("https://tas-push.example/webhook", { method: "POST", body: "{}" }), env);
  assert.equal(noHeader.status, 401);
});

await test("un comentario que menciona a Bea llega a su dispositivo, cifrado y firmado, y no a quien lo escribió", async () => {
  pushes = [];
  const res = await webhook("issue_comment", comment("@ana @bea falta su voto en NEH 1:1.\n\n<!-- tas:chat-event abc -->", "ana"));
  assert.deepEqual(await res.json(), { notices: 1, sent: 1 }, "ana escribió, solo se avisa a bea (que tiene un dispositivo)");
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0]!.endpoint, "https://push.example/bea-1");
  assert.match(pushes[0]!.headers.authorization!, /^vapid t=.+, k=/, "firmado con VAPID");
  assert.equal(pushes[0]!.headers["content-encoding"], "aes128gcm", "cifrado para el dispositivo");
  assert.ok(pushes[0]!.bytes > 100);
});

await test("quien tiene la subtarea asignada recibe los comentarios aunque no lo mencionen, en todos sus dispositivos; una asignación nueva también avisa", async () => {
  await subscribe("tok-ana", await deviceSubscription("https://push.example/ana-fresh"));
  const anaDevices = devicesOf("ana").length;
  pushes = [];
  await webhook("issue_comment", comment("Ya lo miré, está bien.", "bea", ["ana"]));
  assert.equal(pushes.length, anaDevices, "ana tiene la subtarea; bea la escribió");
  assert.ok(pushes.every((p) => p.endpoint.includes("/ana-")), "ni uno a bea");
  assert.ok(pushes.some((p) => p.endpoint === "https://push.example/ana-fresh"));
  pushes = [];
  const assigned = await webhook("issues", { action: "assigned", issue: { number: 9, title: "NEH 2 · Traducir TPL" }, assignee: { login: "Ana" }, sender: { login: "bea" }, repository: repo });
  assert.deepEqual(await assigned.json(), { notices: 1, sent: anaDevices });
  pushes = [];
  assert.equal((await webhook("issues", { action: "assigned", issue: { number: 9 }, assignee: { login: "ana" }, sender: { login: "ana" }, repository: repo })).status, 200);
  assert.equal(pushes.length, 0, "asignarse a uno mismo no avisa");
});

await test("un dispositivo que ya no existe (410) se olvida; un servidor que este Worker no atiende se ignora", async () => {
  const before = devicesOf("bea").length;
  pushStatus["https://push.example/bea-1"] = 410;
  await webhook("issue_comment", comment("@bea otra vez", "ana"));
  assert.equal(devicesOf("bea").length, before - 1);
  assert.equal(kv.lists, 0, "avisar nunca usa list: el plan gratuito solo da 1 000 al día");
  pushes = [];
  const foreign = await webhook("issue_comment", { ...comment("@bea hola", "ana"), repository: { html_url: "https://git.door43.org/x/y" } });
  assert.deepEqual(await foreign.json(), { ignored: "servidor no permitido" });
  assert.equal(pushes.length, 0);
});

await test("qué se lee en el aviso: se menciona sin confundir correos, se quita la marca de la app y se acorta", async () => {
  assert.deepEqual(mentionsIn("Hola @Bea, escribe a ana@example.org y a (@carla). No @@x ni https://a.org/@y"), ["bea", "carla"]);
  assert.equal(readableLine("> cita\n@ana mañana vence el plazo.\n\n<!-- tas:chat-event QUJD -->"), "@ana mañana vence el plazo.");
  assert.equal(readableLine("x".repeat(300)).length, 140);
  const n = noticesFor("issue_comment", comment("@bea mira esto", "ana"), "https://app.example.org/");
  assert.deepEqual(n.map((x) => [x.login, x.url]), [["bea", "https://app.example.org/#/mis-tareas/7"]]);
  assert.equal(n[0]!.title, "Te mencionaron en Nehemías 1:1 · Decidir: objeción de @bea");
  assert.deepEqual(noticesFor("issue_comment", { ...comment("x"), action: "edited" }, "https://a"), [], "solo comentarios nuevos");
  assert.deepEqual(noticesFor("push", comment("@bea"), "https://a"), [], "otros eventos no avisan");
});

await test("el aviso nombra la subtarea con el libro en palabras y la tarea, no con su código y su número", async () => {
  const body = ["## 1:5–8 · TPL", "", "- Tarea: **Alinear TPL**", "- Proyecto: **3JN**", "- Capítulo: **1**"].join("\n");
  const issue = { number: 67, title: "3JN 1:5–8 · TPL", body, milestone: { title: "3JN" }, labels: [{ name: "pm" }, { name: "pm/libro:3JN" }] };
  assert.equal(subtarea(issue), "3 Juan 1:5–8 · Alinear TPL");
  const assigned = noticesFor("issues", { action: "assigned", issue, assignee: { login: "bea" }, sender: { login: "ana" }, repository: repo }, "https://app.example.org");
  assert.deepEqual(assigned.map((n) => [n.title, n.body]), [["Te asignaron una subtarea", "3 Juan 1:5–8 · Alinear TPL"]]);
});

await test("el libro sale del hito, de la etiqueta o del título, y la fase se dice cuando la subtarea la trae", async () => {
  assert.equal(subtarea({ number: 1, title: "2JN 1:1–3 · Academia", body: "- Tarea: **Traducir Academia**" }), "2 Juan 1:1–3 · Traducir Academia");
  assert.equal(subtarea({ number: 2, title: "1:9–11 · Preguntas", body: "- Tarea: **Traducir Preguntas**", labels: [{ name: "pm/libro:2JN" }] }), "2 Juan 1:9–11 · Traducir Preguntas");
  assert.equal(subtarea({ number: 3, title: "3JN 1:1–4 · TPL", body: "- Tarea: **Alinear TPL**\n- Fase: **Afinación**", milestone: { title: "3JN" } }), "3 Juan 1:1–4 · Alinear TPL · Afinación");
});

await test("una subtarea que se llama como su tarea no se dice dos veces, y sin datos queda su título o su número", async () => {
  assert.equal(subtarea({ number: 4, title: "Leer la carta completa en voz alta", body: "- Tarea: **Leer la carta completa en voz alta**", milestone: { title: "2JN" } }), "2 Juan · Leer la carta completa en voz alta");
  assert.equal(subtarea({ number: 5, title: "Algo sin libro" }), "Algo sin libro");
  assert.equal(subtarea({ number: 6 }), "Subtarea #6");
  assert.ok(subtarea({ number: 7, title: "x".repeat(200) }).length <= 90);
});

const words = (n: { words: (lang: "es" | "pt") => { title: string; body: string; grouped?: string } }, lang: "es" | "pt") => n.words(lang);

await test("cada dispositivo recibe el aviso en su idioma: el libro, la tarea, la fase y la frase", async () => {
  const [n] = noticesFor("issues", { action: "assigned", issue: ISSUE_67, assignee: { login: "bea" }, sender: { login: "ana" }, repository: repo }, "https://app.example.org");
  assert.deepEqual(words(n!, "es"), { title: "Te asignaron una subtarea", body: "3 Juan 1:5–8 · Alinear TPL · Afinación", grouped: "Te asignaron {n} subtareas" });
  assert.deepEqual(words(n!, "pt"), { title: "Atribuíram uma subtarefa a você", body: "3 João 1:5–8 · Alinhar TPL · Afinação", grouped: "Atribuíram {n} subtarefas a você" });
  // The language is the device's: said when it subscribes, kept with it, and used when it is told.
  const sub = await deviceSubscription("https://push.example/bea-pt");
  const res = await handle(
    new Request("https://tas-push.example/subscribe", {
      method: "POST",
      headers: { authorization: "token tok-bea", "x-door43-host": "https://qa.door43.org", "content-type": "application/json", origin: "https://app.example.org" },
      body: JSON.stringify({ subscription: sub, lang: "pt" }),
    }),
    env,
  );
  assert.equal(res.status, 204);
  const stored = JSON.parse(kv.data.get("u:https://qa.door43.org:bea")!) as { devices: { sub: { endpoint: string }; lang?: string }[] };
  assert.equal(stored.devices.find((d) => d.sub.endpoint === sub.endpoint)?.lang, "pt");
  const data = (lang?: string) => payloadOf(n!, lang).data as Record<string, string>;
  assert.deepEqual([data("pt").title, data("pt").summaryTitle, data("pt").summaryBody], ["Atribuíram uma subtarefa a você", "{n} novos avisos", "Toque para ver as suas tarefas."]);
  assert.equal(data(undefined).title, "Te asignaron una subtarea", "un dispositivo que no dijo su idioma lo recibe en español");
});

await test("lo que escribió la app se cuenta como una novedad de la subtarea, no como algo que dijo una persona", async () => {
  const delivered = formatChatEvent({ type: "step-done", emitter: "tas", issue: 7, summary: "Se completó «Borrador»" });
  const [toAssignee] = noticesFor("issue_comment", comment(delivered, "ana", ["bea"]), "https://app.example.org");
  assert.equal(words(toAssignee!, "es").title, "Novedad en Nehemías 1:1 · Decidir: objeción de @bea");
  assert.equal(words(toAssignee!, "es").body, "Se completó «Borrador»", "sin «ana:» delante y sin la marca de la app");
  assert.equal(words(toAssignee!, "pt").title.startsWith("Novidade em Neemias 1:1"), true);
  // What a person wrote is still theirs.
  const [said] = noticesFor("issue_comment", comment("¿puedes mirar el versículo 3?", "ana", ["bea"]), "https://app.example.org");
  assert.deepEqual([words(said!, "es").title.startsWith("Comentario nuevo en"), words(said!, "es").body], [true, "ana: ¿puedes mirar el versículo 3?"]);
});

await test("una tarjeta que pide una decisión avisa que hace falta decidir, con la subtarea y de qué se trata", async () => {
  const card = formatChatEvent({ type: "verse-conflict", emitter: "tas", issue: 7, summary: "Conflicto en el versículo 3", decision: { id: "d1", options: [{ id: "a", label: "A" }], state: "pendiente" } });
  const [n] = noticesFor("issue_comment", comment(card, "ana", ["bea"]), "https://app.example.org");
  assert.equal(words(n!, "es").title, "Hace falta tu decisión");
  assert.equal(words(n!, "pt").title, "Falta a sua decisão");
  assert.ok(words(n!, "es").body.startsWith("Nehemías 1:1"));
  const closed = formatChatEvent({ type: "verse-conflict", emitter: "tas", issue: 7, summary: "Conflicto en el versículo 3", decision: { id: "d1", options: [], state: "resuelta" } });
  assert.equal(words(noticesFor("issue_comment", comment(closed, "ana", ["bea"]), "https://a")[0]!, "es").title.startsWith("Novedad en"), true, "una decisión ya tomada es solo una novedad");
});

await test("lo que Door43 no anuncia lo pide la app: una subtarea libre para el equipo, tu turno, un paso libre", async () => {
  const ask = (kind: Parameters<typeof askedNotices>[0]["kind"], extra: Partial<Parameters<typeof askedNotices>[0]> = {}) =>
    askedNotices({ kind, issue: ISSUE_67, count: 1, to: ["Bea", "ana", "bea"], from: "ana", appUrl: "https://app.example.org/", ...extra });
  const free = ask("free");
  assert.deepEqual(free.map((n) => [n.login, n.url, n.tag]), [["bea", "https://app.example.org/#/avisos", "libres"]], "nunca a quien lo causó, y una vez a cada quien");
  assert.deepEqual(words(free[0]!, "es"), { title: "Subtarea libre para tu equipo", body: "3 Juan 1:5–8 · Alinear TPL · Afinación", grouped: "{n} subtareas libres para tu equipo" });
  assert.equal(words(ask("free", { count: 12 })[0]!, "es").title, "12 subtareas libres para tu equipo");
  const turn = ask("your-turn")[0]!;
  assert.deepEqual([turn.url, words(turn, "es").title, words(turn, "pt").title], ["https://app.example.org/#/mis-tareas/67", "Ya puedes empezar", "Você já pode começar"]);
  assert.equal(words(ask("step-turn", { step: "Revisión en pares" })[0]!, "es").title, "Es tu turno: Revisión en pares");
  assert.equal(words(ask("step-free", { step: "Revisión en pares" })[0]!, "pt").title, "Passo livre para a sua equipe: Revisão em pares");
  const rule = ask("team-rule")[0]!;
  assert.deepEqual([rule.url, rule.tag, words(rule, "es").title, words(rule, "es").body], ["https://app.example.org/#/avisos", "reglas", "Regla nueva en tu equipo", "Alguien la agregó mientras trabajaba en 3 Juan 1:5–8 · Alinear TPL · Afinación."], "a quien coordina: lo lleva a su lista, sin decir la regla");
});

await test("pedir un aviso exige una sesión de Door43 que pueda leer la subtarea, y no deja escribir el texto", async () => {
  const notify = (token: string, body: unknown) =>
    handle(
      new Request("https://tas-push.example/notify", {
        method: "POST",
        headers: { authorization: `token ${token}`, "x-door43-host": "https://qa.door43.org", "content-type": "application/json", origin: "https://app.example.org" },
        body: JSON.stringify(body),
      }),
      env,
    );
  const ok = { kind: "free", org: "BSOJ", repo: "gateway-tasks", issue: 67, to: ["bea", "ana"] };
  pushes = [];
  const res = await notify("tok-ana", ok);
  assert.equal(res.status, 200);
  const answer = (await res.json()) as { notices: number; sent: number };
  assert.equal(answer.notices, 1, "a bea, no a ana que lo pidió");
  assert.ok(answer.sent >= 1 && pushes.every((p) => p.endpoint.includes("bea")));
  assert.equal((await notify("tok-malo", ok)).status, 401);
  assert.equal((await notify("tok-ana", { ...ok, issue: 999 })).status, 404, "una subtarea que no existe o no puede leer");
  assert.equal((await notify("tok-ana", { ...ok, kind: "lo-que-sea" })).status, 400);
  assert.equal((await notify("tok-ana", { ...ok, org: "../otro" })).status, 400);
  assert.deepEqual(await (await notify("tok-ana", { ...ok, to: [] })).json(), { notices: 0, sent: 0 });
});

console.log(`\nverify-push-worker: ${passed} checks passed.`);
