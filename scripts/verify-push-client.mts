/** The app side of push notices: subscribing the device, registering it in the Worker, turning it off. */
import assert from "node:assert/strict";
import { disablePush, enablePush, pushState, urlBase64ToUint8Array, type PushDeps } from "../src/push";

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
function setup(opts: { permission?: NotificationPermission | "unsupported"; ask?: NotificationPermission; subscribed?: boolean; subscribeStatus?: number; url?: string } = {}) {
  const calls: Call[] = [];
  let subscription: { endpoint: string; toJSON(): unknown; unsubscribe(): Promise<boolean> } | null = opts.subscribed
    ? { endpoint: "https://push.example/dev", toJSON: () => ({}), unsubscribe: async () => ((subscription = null), true) }
    : null;
  let asked = 0;
  let permission = opts.permission ?? "default";
  const deps: PushDeps = {
    url: opts.url ?? "https://tas-push.example",
    fetch: async (input, init) => {
      calls.push({ url: input, method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body as string | undefined });
      if (input.endsWith("/vapid")) return new Response(JSON.stringify({ publicKey: "BPublicKeyAB-_" }), { status: 200 });
      return new Response(null, { status: opts.subscribeStatus ?? 204 });
    },
    permission: () => permission,
    requestPermission: async () => {
      asked++;
      permission = opts.ask ?? "granted";
      return permission as NotificationPermission;
    },
    registration: async () => ({
      pushManager: {
        getSubscription: async () => subscription,
        subscribe: async () => {
          subscription = { endpoint: "https://push.example/dev", toJSON: () => ({ endpoint: "https://push.example/dev", keys: { auth: "a", p256dh: "p" } }), unsubscribe: async () => ((subscription = null), true) };
          return subscription;
        },
      },
    }),
  };
  return { deps, calls, asked: () => asked, subscribed: () => subscription !== null };
}
const session = { token: "tok-bea", host: "https://qa.door43.org/" };

await test("la clave pública del Worker viene en base64url y el navegador la quiere en bytes", async () => {
  const bytes = urlBase64ToUint8Array("AQID_w");
  assert.deepEqual([...bytes], [1, 2, 3, 255]);
});

await test("activar pide permiso solo si hace falta, se suscribe y registra el dispositivo con el token y el servidor de Door43", async () => {
  const t = setup();
  assert.equal(await pushState(t.deps), "off");
  assert.equal(await enablePush(t.deps, session), "on");
  assert.equal(t.asked(), 1);
  const post = t.calls.find((c) => c.url.endsWith("/subscribe"))!;
  assert.equal(post.method, "POST");
  assert.equal(post.headers.authorization, "token tok-bea");
  assert.equal(post.headers["x-door43-host"], "https://qa.door43.org", "sin la barra final");
  assert.deepEqual(JSON.parse(post.body!), { lang: "es", subscription: { endpoint: "https://push.example/dev", keys: { auth: "a", p256dh: "p" } } }, "con el idioma en que la persona usa la app, para que los avisos le lleguen en él");
  assert.equal(await pushState(t.deps), "on");
  const again = setup({ permission: "granted" });
  await enablePush(again.deps, session);
  assert.equal(again.asked(), 0, "si ya hay permiso no se vuelve a pedir");
});

await test("si no dan permiso no se suscribe nada, y bloqueado se dice", async () => {
  const no = setup({ ask: "denied" });
  assert.equal(await enablePush(no.deps, session), "denied");
  assert.equal(no.subscribed(), false);
  assert.equal(no.calls.length, 0, "ni siquiera se llama al Worker");
  assert.equal(await pushState(setup({ permission: "denied" }).deps), "denied");
});

await test("si el Worker no reconoce la sesión, el dispositivo se da de baja y se explica", async () => {
  const t = setup({ subscribeStatus: 401 });
  await assert.rejects(() => enablePush(t.deps, session), /comprobar tu sesión/);
  assert.equal(t.subscribed(), false, "no queda suscrito a medias");
});

await test("desactivar da de baja el dispositivo en el Worker y en el navegador", async () => {
  const t = setup({ permission: "granted", subscribed: true });
  assert.equal(await pushState(t.deps), "on");
  assert.equal(await disablePush(t.deps, session), "off");
  const del = t.calls.find((c) => c.method === "DELETE")!;
  assert.deepEqual(JSON.parse(del.body!), { endpoint: "https://push.example/dev" });
  assert.equal(t.subscribed(), false);
});

await test("sin dirección del Worker, o sin soporte, la función está apagada y no hace nada", async () => {
  const off = setup({ url: "" });
  assert.equal(await pushState(off.deps), "unsupported");
  assert.equal(await enablePush(off.deps, session), "unsupported");
  assert.equal(off.calls.length, 0);
  assert.equal(await pushState(setup({ permission: "unsupported" }).deps), "unsupported");
});

console.log(`\nverify-push-client: ${passed} checks passed.`);
