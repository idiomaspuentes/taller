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

type Token = { id: number; name: string; sha1: string; scopes: string[] };

/** Door43's token endpoints for one person, ana (Basic auth), and `GET /user` with one of her tokens. */
function door43(earlier: string[] = []) {
  let nextId = 1;
  const tokens: Token[] = earlier.map((name) => ({ id: nextId, name, sha1: `sha-${nextId++}`, scopes: [] }));
  const basic = `Basic ${Buffer.from(`ana:${PASSWORD}`).toString("base64")}`;
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const path = new URL(String(input)).pathname.replace(/^\/api\/v1/, "");
    const method = init.method ?? "GET";
    const auth = new Headers(init.headers).get("authorization") ?? "";
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (path === "/user") {
      const token = /^token (.+)$/.exec(auth)?.[1];
      return tokens.some((t) => t.sha1 === token) ? reply({ id: 1, login: "ana", avatar_url: "" }) : reply({ message: "token is required" }, 401);
    }
    if (!path.startsWith("/users/ana/tokens")) return reply({ message: "not here" }, 404);
    if (auth !== basic) return reply({ message: "unauthorized" }, 401);
    if (method === "GET") return reply(tokens.map(({ sha1: _, ...listed }) => listed));
    if (method === "POST") {
      const { name, scopes } = JSON.parse(String(init.body));
      const made = { id: nextId, name, sha1: `sha-${nextId++}`, scopes };
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

console.log(`\nverify-sign-in: ${passed} checks passed.`);
