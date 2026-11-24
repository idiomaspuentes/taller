/**
 * Signing in with a password mints a Door43 token named for this device, and replaces only this device's earlier
 * token. With one name for every device, signing in on a phone signed the same person out on their computer.
 *
 *   npm run verify:sign-in
 *
 * Door43 is a few lines in memory behind a stubbed fetch: no network, nothing written anywhere.
 */
import assert from "node:assert/strict";
import { deviceId, refreshUser, signInWithPassword, tokenNamePrefix } from "../src/dcs/auth.ts";

const HOST = "https://qa.door43.org";
const PASSWORD = "clave-de-prueba";

type Token = { id: number; name: string; sha1: string; scopes: string[]; last_used_at?: string };

/**
 * Door43's token endpoints for one person, ana (Basic auth), and `GET /user` with one of her tokens. With `reportsUse`
 * each token says when it was last used, as Door43 does: a minute passes between one use and the next.
 */
function door43(earlier: string[] = [], { reportsUse = false, minutesBetweenUses = 1 } = {}) {
  let nextId = 1;
  let clock = Date.parse("2026-11-01T00:00:00Z");
  const use = (token: Token) => {
    if (reportsUse) token.last_used_at = new Date((clock += minutesBetweenUses * 60_000)).toISOString();
  };
  const tokens: Token[] = earlier.map((name) => ({ id: nextId, name, sha1: `sha-${nextId++}`, scopes: [] }));
  const basic = `Basic ${Buffer.from(`ana:${PASSWORD}`).toString("base64")}`;
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const path = new URL(String(input)).pathname.replace(/^\/api\/v1/, "");
    const method = init.method ?? "GET";
    const auth = new Headers(init.headers).get("authorization") ?? "";
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (path === "/user") {
      const sha1 = /^token (.+)$/.exec(auth)?.[1];
      const token = tokens.find((t) => t.sha1 === sha1);
      if (!token) return reply({ message: "token is required" }, 401);
      use(token);
      return reply({ id: 1, login: "ana", avatar_url: "" });
    }
    if (!path.startsWith("/users/ana/tokens")) return reply({ message: "not here" }, 404);
    if (auth !== basic) return reply({ message: "unauthorized" }, 401);
    if (method === "GET") return reply(tokens.map(({ sha1: _, ...listed }) => listed));
    if (method === "POST") {
      const { name, scopes } = JSON.parse(String(init.body));
      const made: Token = { id: nextId, name, sha1: `sha-${nextId++}`, scopes };
      use(made);
      tokens.push(made);
      return reply(made, 201);
    }
    const id = Number(/\/tokens\/(\d+)$/.exec(path)?.[1]);
    const at = tokens.findIndex((t) => t.id === id);
    if (method === "DELETE" && at >= 0) {
      tokens.splice(at, 1);
      return new Response(null, { status: 204 });
    }
    return reply({ message: "not here" }, 404);
  }) as typeof fetch;
  return { names: () => tokens.map((t) => t.name), live: (token: string) => tokens.some((t) => t.sha1 === token) };
}

/** The storage of one browser: each device keeps its own. */
function device() {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
  };
}
const on = (storage: unknown) => ((globalThis as { localStorage?: unknown }).localStorage = storage);
const signIn = () => signInWithPassword(HOST, "ana", PASSWORD);

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

await test("un aparato se da un nombre una vez y lo conserva; otro aparato tiene otro", () => {
  const phone = device();
  on(phone);
  const name = deviceId();
  assert.match(name, /^[0-9a-f]{12}$/, "solo letras y cifras: con un guion, un aparato podría tomar las llaves de otro");
  assert.equal(deviceId(), name);
  assert.equal(phone.store.get("gt-dcs-device"), name);
  assert.equal(tokenNamePrefix(), `taller-${name}`);
  on(device());
  assert.notEqual(deviceId(), name);
});

await test("entrar en la computadora no cierra la sesión del teléfono, y volver a entrar en el teléfono reemplaza solo su llave anterior", async () => {
  const server = door43();
  const phone = device();
  const computer = device();

  on(phone);
  const first = await signIn();
  on(computer);
  const other = await signIn();
  assert.ok(server.live(first.token), "la llave del teléfono sigue viva después de entrar en la computadora");
  assert.ok(server.live(other.token));
  on(phone);
  assert.equal((await refreshUser(first)).username, "ana", "y el teléfono sigue trabajando con ella");

  const again = await signIn();
  assert.ok(!server.live(first.token), "la llave anterior del teléfono se borra");
  assert.ok(server.live(again.token));
  assert.ok(server.live(other.token), "la de la computadora no");
  const phoneName = deviceId();
  on(computer);
  const computerName = deviceId();
  assert.deepEqual(
    server.names().map((n) => n.replace(/-[0-9a-z]+$/, "")).sort(),
    [`taller-${phoneName}`, `taller-${computerName}`].sort(),
    "una llave por aparato",
  );
});

await test("la llave antigua (tas-…, sin aparato), la de otro aparato y las de otras aplicaciones no se tocan", async () => {
  const earlier = ["tas-k3j9x1", "taller-0123456789ab-a1b2c3", "servos-tel1-x9y8z7", "otra-app"];
  const server = door43(earlier);
  on(device());
  const session = await signIn();
  assert.deepEqual(server.names().slice(0, earlier.length), earlier);
  assert.match(server.names().at(-1)!, new RegExp(`^taller-${deviceId()}-[0-9a-z]+$`));
  assert.ok(server.live(session.token));
});

await test("sin almacenamiento se entra igual, y no se borra la llave de ningún otro aparato", async () => {
  const server = door43(["taller-0123456789ab-a1b2c3"]);
  on({
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {},
  });
  const session = await signIn();
  assert.equal(session.username, "ana");
  assert.equal(server.names()[0], "taller-0123456789ab-a1b2c3");
  assert.equal(server.names().length, 2);
});

await test("la cuarta sesión cierra la que lleva más tiempo sin usarse, aunque sea la más nueva: los aparatos de cada día siguen dentro", async () => {
  const server = door43([], { reportsUse: true });
  const phone = device();
  const computer = device();
  on(phone);
  const daily = await signIn();
  on(computer);
  const work = await signIn();
  // A private window: signed in once, closed, never used again.
  on(device());
  const forgotten = await signIn();
  on(phone);
  await refreshUser(daily);
  on(computer);
  await refreshUser(work);

  on(device());
  const fourth = await signIn();
  assert.ok(!server.live(forgotten.token), "se cierra la ventana olvidada");
  assert.ok(server.live(daily.token), "no el teléfono, aunque su llave sea la más antigua");
  assert.ok(server.live(work.token) && server.live(fourth.token));

  on(phone);
  const dailyAgain = await signIn();
  assert.ok(!server.live(daily.token) && server.live(dailyAgain.token), "volver a entrar en el teléfono reemplaza su propia llave");
  assert.ok(server.live(work.token) && server.live(fourth.token), "y no cierra ninguna otra");
});

await test("si varias sesiones se usaron en el mismo segundo, se cierra la creada primero", async () => {
  const server = door43([], { reportsUse: true, minutesBetweenUses: 0 });
  on(device());
  const first = await signIn();
  on(device());
  const second = await signIn();
  on(device());
  const third = await signIn();
  on(device());
  const fourth = await signIn();
  assert.ok(!server.live(first.token));
  assert.ok(server.live(second.token) && server.live(third.token) && server.live(fourth.token));
});

await test("hasta tres sesiones a la vez; si Door43 no dijera cuándo se usó cada una, la cuarta cierra la creada primero, y volver a entrar en el mismo navegador no ocupa otra", async () => {
  // A session of the versions before, and other apps' tokens, which are not Taller's sessions.
  const server = door43(["tas-k3j9x1", "servos-tel1-x9y8z7", "otra-app"]);
  const computer = device();
  const phone = device();
  const laptop = device();
  on(computer);
  const one = await signIn();
  on(phone);
  const two = await signIn();
  assert.ok(server.names().includes("tas-k3j9x1"), "con la de antes son tres: caben");
  assert.ok(server.live(one.token) && server.live(two.token));
  // In the same browser again: it replaces its own session, and closes nobody else's.
  on(computer);
  const oneAgain = await signIn();
  assert.ok(!server.live(one.token) && server.live(oneAgain.token) && server.live(two.token));
  on(laptop);
  const three = await signIn();
  assert.ok(!server.names().includes("tas-k3j9x1"), "la cuarta cierra la más antigua: la de antes");
  assert.ok(server.live(oneAgain.token) && server.live(two.token) && server.live(three.token));
  on(device());
  const four = await signIn();
  assert.ok(!server.live(two.token), "y otra más cierra la siguiente: la del teléfono, creada antes que las otras");
  assert.ok(server.live(oneAgain.token) && server.live(three.token) && server.live(four.token));
  assert.equal(server.names().filter((name) => name.startsWith("taller-")).length, 3);
  assert.deepEqual(server.names().filter((name) => !name.startsWith("taller-")), ["servos-tel1-x9y8z7", "otra-app"], "las de otras aplicaciones no se tocan");
});

console.log(`\nverify-sign-in: ${passed} checks passed.`);
