/** The app side of push notices: subscribing the device, registering it in the Worker, turning it off. */
import assert from "node:assert/strict";
import { disablePush, enablePush, pushState, reminderPrefs, reportReminder, setReminderPrefs, urlBase64ToUint8Array, type PushDeps } from "../src/push";

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

// The device's storage, as a browser has it.
const stored = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v), removeItem: (k: string) => void stored.delete(k) };

await test("el recordatorio diario se entera de lo que espera solo cuando hay algo nuevo, y solo desde un dispositivo que recibe avisos", async () => {
  const who = { ...session, username: "Bea" };
  const day = (d: number, h: number) => Date.UTC(2026, 9, d, h + 5);
  const off = setup({ permission: "granted", subscribed: false });
  await reportReminder(off.deps, who, { mine: 2, free: 0 }, day(18, 9));
  assert.equal(off.calls.length, 0, "sin suscripción no hay recordatorio que preparar");
  const t = setup({ permission: "granted", subscribed: true });
  await reportReminder(t.deps, who, { mine: 2, free: 1 }, day(18, 9));
  const first = t.calls.filter((c) => c.url.endsWith("/remind"));
  assert.equal(first.length, 1);
  const body = JSON.parse(first[0]!.body!) as Record<string, unknown>;
  assert.deepEqual({ mine: body.mine, free: body.free, hour: body.hour, on: body.on }, { mine: 2, free: 1, hour: 19, on: true });
  assert.equal(typeof body.tz, "string");
  await reportReminder(t.deps, who, { mine: 2, free: 1 }, day(18, 15));
  assert.equal(t.calls.filter((c) => c.url.endsWith("/remind")).length, 1, "lo mismo el mismo día no se vuelve a escribir");
  await reportReminder(t.deps, who, { mine: 1, free: 1 }, day(18, 16));
  assert.equal(t.calls.filter((c) => c.url.endsWith("/remind")).length, 2, "otra cuenta sí");
  await reportReminder(t.deps, who, { mine: 1, free: 1 }, day(19, 8));
  assert.equal(t.calls.filter((c) => c.url.endsWith("/remind")).length, 3, "otro día también: es el día en que entró");
  await setReminderPrefs({ on: true, hour: 7 }, who, t.deps);
  const last = JSON.parse(t.calls.filter((c) => c.url.endsWith("/remind")).at(-1)!.body!) as Record<string, unknown>;
  assert.deepEqual({ mine: last.mine, hour: last.hour }, { mine: 1, hour: 7 }, "cambiar la hora la dice al momento, con lo último que se contó");
  assert.deepEqual(reminderPrefs(), { on: true, hour: 7 });
});

console.log(`\nverify-push-client: ${passed} checks passed.`);
