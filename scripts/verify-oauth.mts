/**
 * Signing in with Door43 (OAuth): the pieces that need no browser and no network.
 * Run: npm run verify:oauth
 * Fake fetch only; nothing here reaches Door43, and no token is ever printed.
 */
import assert from "node:assert/strict";
import { door43Writes, fetchBeforeGate, installDoor43Gate, isDoor43Url } from "../src/dcs/door43Gate";
import { installSessionExpiryGuard, notifySessionExpired, onSessionExpired } from "../src/dcs/sessionExpiry";
import { clearSessionIfSeal, loadSession } from "../src/dcs/auth";

/** A localStorage that lives in memory: `auth.ts` only reads it when one of its functions runs. */
function fakeStore(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}
Object.defineProperty(globalThis, "localStorage", { value: fakeStore(), configurable: true });

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`ok  ${name}`);
  } catch (err) {
    failed++;
    // Only the message: an assertion's `actual`/`expected` could carry a token.
    console.log(`FAIL  ${name}\n      ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** A fake session token. Never a real one. */
const T = "tok-verify-oauth";

await test("reconoce Door43 y el API del mock, y nada más", () => {
  for (const u of ["https://qa.door43.org/api/v1/user", "https://git.door43.org/x", "http://localhost:8787/api/v1/user", "http://localhost:8788/api/v1/user"]) assert.equal(isDoor43Url(u), true, u);
  for (const u of ["https://push.example/notify", "https://evildoor43.org/x", "http://localhost:8787/login/oauth/access_token", "https://qa.door43.org@evil.com/", "https://door43.org.evil.com/", "/api/v1/user"]) assert.equal(isDoor43Url(u), false, u);
});

/** Runs `fn` with a fake fetch that always answers 401 and the session guard on top; puts everything back after. */
async function withGuard(fn: (state: { expired: number }) => Promise<void>) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
  const state = { expired: 0 };
  const uninstall = installSessionExpiryGuard({ getSessionToken: () => T, onExpired: () => void state.expired++ });
  try {
    await fn(state);
  } finally {
    uninstall();
    globalThis.fetch = realFetch;
  }
}

await test("un 401 de otro servidor pasa tal cual y no cierra la sesión", async () => {
  await withGuard(async (state) => {
    const res = await fetch("https://push.example/notify", { headers: { authorization: `token ${T}` } });
    assert.equal(res.status, 401);
    assert.equal(state.expired, 0);
  });
});

await test("control: un 401 de Door43 con la llave de la sesión sí la cierra", async () => {
  await withGuard(async (state) => {
    await assert.rejects(fetch("https://qa.door43.org/api/v1/user", { headers: { authorization: `token ${T}` } }), (err: Error) => err.name === "SessionExpiredError");
    assert.equal(state.expired, 1);
  });
});

await test("fetchBeforeGate no pasa por la compuerta ni cuenta como escritura", async () => {
  const realFetch = globalThis.fetch;
  try {
    // A fake that never reaches the network; `/espera` stays open until `release()`.
    let release: () => void = () => {};
    const open = new Promise<void>((resolve) => (release = resolve));
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/espera")) await open;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    installDoor43Gate(1);

    const url = "https://qa.door43.org/login/oauth/access_token";
    const before = door43Writes();
    await globalThis.fetch(url, { method: "POST" });
    assert.equal(door43Writes(), before + 1, "control: por la compuerta sí cuenta");

    // With the only place taken by a request that does not finish:
    const held = globalThis.fetch("https://qa.door43.org/api/v1/espera");
    await fetchBeforeGate()(url, { method: "POST" }); // does not wait for a turn
    assert.equal(door43Writes(), before + 1);
    release();
    await held;
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("una caducidad anterior a App se entrega al conectarse, una sola vez", () => {
  notifySessionExpired("s1");
  const a: string[] = [];
  const off = onSessionExpired((s) => a.push(s));
  assert.deepEqual(a, ["s1"]);
  off();
  const b: string[] = [];
  onSessionExpired((s) => b.push(s))();
  assert.deepEqual(b, []);
});

await test("una caducidad entre desconectar y volver a conectar se entrega una vez (StrictMode)", () => {
  const first: string[] = [];
  const off = onSessionExpired((s) => first.push(s));
  off();
  notifySessionExpired("s2"); // nobody is listening: it waits
  const second: string[] = [];
  const off2 = onSessionExpired((s) => second.push(s));
  assert.deepEqual(first, []);
  assert.deepEqual(second, ["s2"]);
  off2();
  const third: string[] = [];
  onSessionExpired((s) => third.push(s))();
  assert.deepEqual(third, []);
});

await test("una pestaña vieja no borra la sesión de quien entró después", () => {
  localStorage.setItem("gt-dcs-session", JSON.stringify({ host: "h", username: "bea", token: "B" }));
  assert.equal(clearSessionIfSeal("A"), false);
  assert.equal(loadSession()?.token, "B");
  assert.equal(clearSessionIfSeal("B"), true);
  assert.equal(loadSession(), undefined);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
