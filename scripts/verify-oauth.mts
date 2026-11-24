/**
 * Signing in with Door43 (OAuth): the pieces that need no browser and no network.
 * Run: npm run verify:oauth
 * Fake fetch only; nothing here reaches Door43, and no token is ever printed.
 */
import assert from "node:assert/strict";
import { createGate, door43Writes, fetchBeforeGate, gatedFetch, installDoor43Gate, isDoor43Url } from "../src/dcs/door43Gate";
import { Door43UnreachableError, SessionExpiredError, installSessionExpiryGuard, isSessionExpiredError, notifySessionExpired, onSessionExpired } from "../src/dcs/sessionExpiry";
import { tNow } from "../src/i18n/messages";
import {
  clearSessionIfSeal,
  enrichSessionRoles,
  lastUser,
  loadSession,
  markEntered,
  refreshUser,
  signInWithPassword,
  signInWithToken,
  signOut,
  signedOutHere,
  storeOAuthSession,
  type GtSession,
} from "../src/dcs/auth";
import {
  classifyRenewal,
  clearOAuthRecord,
  ensureFresh,
  grantOf,
  loadOAuthRecord,
  recordFor,
  renewAccessToken,
  saveOAuthRecord,
  storedSessionSeal,
  tokenForJoin,
  type LockLike,
  type OAuthRecord,
  type RenewDeps,
  type TokenStore,
} from "../src/dcs/door43Tokens";

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

/** A fake JWT: `h.<base64url of {gnt, tt:0, n}>.s`. `n` makes two tokens of the same grant differ. */
function jwt(gnt: number, n = 0): string {
  return `h.${Buffer.from(JSON.stringify({ gnt, tt: 0, n })).toString("base64url")}.s`;
}
/** A fake OAuth record; every token in it is made up. */
function rec(over: Partial<OAuthRecord> = {}): OAuthRecord {
  return { host: "https://qa.door43.org", username: "ana", seal: jwt(7), grantId: 7, clientId: "client-x", accessToken: jwt(7, 1), refreshToken: "refresh-x", expiresAt: 1_000, ...over };
}
function sess(over: Partial<GtSession> = {}): GtSession {
  return { host: "https://qa.door43.org", username: "ana", token: jwt(7), method: "oauth", scopes: ["read:user"], scopesVersion: 3, ...over };
}
/** Runs `fn` with `fake` as fetch; puts the real one back after. */
async function withFetch(fake: (url: string) => Response | Promise<Response>, fn: () => Promise<void>) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => fake(String(input))) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
}
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
function reset() {
  localStorage.clear();
}

await test("lee el permiso de un JWT y no se rompe con otra cosa", () => {
  assert.equal(grantOf(jwt(7)), 7);
  for (const bad of ["abc123", "a.b.c", "", "h.e30.s"]) assert.equal(grantOf(bad), null);
});

await test("recordFor acepta una seña anterior del mismo permiso y rechaza otra", () => {
  reset();
  saveOAuthRecord(rec({ grantId: 7, seal: jwt(7, 2) }));
  const url = "https://qa.door43.org/api/v1/user";
  assert.ok(recordFor(jwt(7, 1), url));
  assert.equal(recordFor(jwt(8), url), null);
  assert.equal(recordFor("token-de-contraseña", url), null);
});

await test("recordFor no entrega el registro de un servidor a una petición a otro", () => {
  const mem = (): TokenStore & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
  };
  // The same grant number on two servers: grant ids are counters per server.
  const qa = mem();
  const prod = mem();
  saveOAuthRecord(rec({ host: "https://qa.door43.org", accessToken: jwt(7, 11) }), qa);
  saveOAuthRecord(rec({ host: "https://git.door43.org", accessToken: jwt(7, 22) }), prod);
  const qaUrl = "https://qa.door43.org/api/v1/user";
  const prodUrl = "https://git.door43.org/api/v1/user";
  assert.equal(recordFor(jwt(7), qaUrl, qa)?.host, "https://qa.door43.org");
  assert.equal(recordFor(jwt(7), prodUrl, qa), null);
  assert.equal(recordFor(jwt(7), prodUrl, prod)?.host, "https://git.door43.org");
  assert.equal(recordFor(jwt(7), qaUrl, prod), null);
  assert.equal(recordFor(jwt(7), "no es una dirección", qa), null);
  saveOAuthRecord(rec({ host: "no es una dirección" }), qa);
  assert.equal(recordFor(jwt(7), qaUrl, qa), null);
});

await test("storedSessionSeal lee la seña de la sesión guardada y nada más", () => {
  reset();
  assert.equal(storedSessionSeal(), null);
  localStorage.setItem("gt-dcs-session", JSON.stringify(sess({ token: "seña-x" })));
  assert.equal(storedSessionSeal(), "seña-x");
  localStorage.setItem("gt-dcs-session", "{roto");
  assert.equal(storedSessionSeal(), null);
  localStorage.setItem("gt-dcs-session", JSON.stringify({ host: "h" }));
  assert.equal(storedSessionSeal(), null);
});

await test("el registro se guarda, se lee y se borra; uno dañado se ignora", () => {
  reset();
  assert.equal(loadOAuthRecord(), null);
  saveOAuthRecord(rec());
  assert.equal(loadOAuthRecord()?.refreshToken, "refresh-x");
  clearOAuthRecord();
  assert.equal(loadOAuthRecord(), null);
  localStorage.setItem("gt-dcs-oauth", "{no es json");
  assert.equal(loadOAuthRecord(), null);
  localStorage.setItem("gt-dcs-oauth", JSON.stringify({ host: "h" }));
  assert.equal(loadOAuthRecord(), null);
});

await test("loadSession conserva method", () => {
  reset();
  localStorage.setItem("gt-dcs-session", JSON.stringify(sess()));
  assert.equal(loadSession()?.method, "oauth");
  localStorage.setItem("gt-dcs-session", JSON.stringify(sess({ method: undefined })));
  assert.equal(loadSession()?.method, undefined);
});

await test("storeOAuthSession guarda el registro y la sesión", () => {
  reset();
  storeOAuthSession(sess(), rec());
  assert.equal(loadSession()?.method, "oauth");
  assert.equal(loadOAuthRecord()?.username, "ana");
});

/** Runs `fn` with a localStorage whose `n`-th setItem throws (1 = the first write); puts the real one back after. */
async function withFailingWrite(n: number, fn: () => void | Promise<void>) {
  const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage")!;
  const base = real.value as Storage;
  let calls = 0;
  const flaky = {
    getItem: (k: string) => base.getItem(k),
    removeItem: (k: string) => base.removeItem(k),
    setItem: (k: string, v: string) => {
      if (++calls === n) throw new Error("QuotaExceededError");
      base.setItem(k, v);
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: flaky, configurable: true });
  try {
    await fn();
  } finally {
    Object.defineProperty(globalThis, "localStorage", real);
  }
}

for (const [n, which] of [[1, "el registro"], [2, "la sesión"]] as const) {
  await test(`si falla guardar ${which}, storeOAuthSession no deja nada a medias y avisa`, async () => {
    reset();
    markEntered("ana");
    await withFailingWrite(n, () => {
      assert.throws(() => storeOAuthSession(sess(), rec()), (err: Error) => !err.message.includes(jwt(7)) && !err.message.includes("refresh-x"));
    });
    assert.equal(loadSession(), undefined);
    assert.equal(loadOAuthRecord(), null);
    assert.equal(lastUser(), "ana", "nada se marca como entrado");
  });
}

await test("con el almacenamiento bloqueado nada lanza", async () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage")!;
  Object.defineProperty(globalThis, "localStorage", {
    get() {
      throw new DOMException("blocked", "SecurityError");
    },
    configurable: true,
  });
  try {
    assert.equal(loadOAuthRecord(), null);
    assert.equal(saveOAuthRecord(rec()), false);
    clearOAuthRecord();
    assert.equal(recordFor(jwt(7), "https://qa.door43.org/x"), null);
    assert.equal(storedSessionSeal(), null);
    signOut();
    assert.equal(clearSessionIfSeal("x"), true);
    markEntered("ana");
    assert.equal(lastUser(), null);
    assert.equal(signedOutHere(), false);
    await withFetch(() => json({ id: 2, login: "bea", avatar_url: "" }), async () => void (await signInWithToken("https://qa.door43.org", "pegado")));
    assert.throws(() => storeOAuthSession(sess(), rec()), /No se pudo/);
  } finally {
    Object.defineProperty(globalThis, "localStorage", real);
  }
});

await test("cerrar sesión borra el registro y deja la última cuenta", () => {
  reset();
  markEntered("ana");
  saveOAuthRecord(rec());
  signOut();
  assert.equal(loadOAuthRecord(), null);
  assert.equal(lastUser(), "ana");
  assert.equal(signedOutHere(), true);
  markEntered("bea");
  assert.equal(signedOutHere(), false);
  assert.equal(lastUser(), "bea");
});

await test("caducar no cuenta como cerrar sesión", () => {
  reset();
  markEntered("ana");
  storeOAuthSession(sess(), rec());
  assert.equal(clearSessionIfSeal(jwt(7)), true);
  assert.equal(loadSession(), undefined);
  assert.equal(loadOAuthRecord(), null);
  assert.equal(signedOutHere(), false);
  assert.equal(lastUser(), "ana");
});

await test("una seña ajena no borra ni el registro", () => {
  reset();
  storeOAuthSession(sess({ token: "B" }), rec({ seal: "B" }));
  assert.equal(clearSessionIfSeal("A"), false);
  assert.ok(loadSession());
  assert.ok(loadOAuthRecord());
});

await test("enrichSessionRoles no resucita una sesión cerrada mientras leía", async () => {
  reset();
  const s = sess();
  storeOAuthSession(s, rec());
  await withFetch(
    (url) => {
      if (url.endsWith("/user/teams")) signOut();
      return json([]);
    },
    async () => {
      const next = await enrichSessionRoles(s, "org");
      assert.equal(next.token, s.token, "aun así devuelve lo leído");
    },
  );
  assert.equal(loadSession(), undefined);
  assert.equal(loadOAuthRecord(), null);
});

await test("enrichSessionRoles sin organización tampoco pisa una sesión ajena", async () => {
  reset();
  localStorage.setItem("gt-dcs-session", JSON.stringify(sess({ token: "B" })));
  await enrichSessionRoles(sess({ token: "A" }), "");
  assert.equal(loadSession()?.token, "B");
  assert.equal(loadSession()?.teams, undefined);
});

await test("enrichSessionRoles escribe cuando la sesión sigue siendo la misma", async () => {
  reset();
  const s = sess();
  localStorage.setItem("gt-dcs-session", JSON.stringify(s));
  await withFetch(() => json([]), async () => void (await enrichSessionRoles(s, "org")));
  assert.deepEqual(loadSession()?.teams, []);
});

await test("refreshUser tampoco resucita una sesión cerrada", async () => {
  reset();
  const s = sess();
  storeOAuthSession(s, rec());
  await withFetch(
    (url) => {
      if (url.endsWith("/user")) signOut();
      return json({ id: 1, login: "ana", avatar_url: "a" });
    },
    async () => void (await refreshUser(s)),
  );
  assert.equal(loadSession(), undefined);
});

await test("refreshUser escribe cuando la sesión sigue siendo la misma", async () => {
  reset();
  const s = sess();
  localStorage.setItem("gt-dcs-session", JSON.stringify(s));
  await withFetch(() => json({ id: 1, login: "ana", avatar_url: "nueva" }), async () => void (await refreshUser(s)));
  assert.equal(loadSession()?.avatarUrl, "nueva");
});

await test("entrar con un token pegado borra el registro OAuth y recuerda la cuenta", async () => {
  reset();
  saveOAuthRecord(rec());
  localStorage.setItem("gt-dcs-signed-out", "1");
  await withFetch(() => json({ id: 2, login: "bea", avatar_url: "" }), async () => void (await signInWithToken("https://qa.door43.org", "pegado")));
  assert.equal(loadOAuthRecord(), null);
  assert.equal(lastUser(), "bea");
  assert.equal(signedOutHere(), false);
  assert.equal(loadSession()?.method, undefined);
});

await test("entrar con contraseña borra el registro OAuth y recuerda la cuenta", async () => {
  reset();
  saveOAuthRecord(rec());
  localStorage.setItem("gt-dcs-signed-out", "1");
  const realFetch = globalThis.fetch;
  // Fake Door43: no tokens yet, one is minted, then /user. Fake credentials only.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/user/tokens") || url.includes("/tokens")) {
      return init?.method === "POST" ? json({ id: 1, name: "taller-x-abc", sha1: "minted-fake", scopes: [] }) : json([]);
    }
    return json({ id: 3, login: "carla", avatar_url: "" });
  }) as typeof fetch;
  try {
    const session = await signInWithPassword("https://qa.door43.org", "carla", "clave-falsa");
    assert.equal(session.token, "minted-fake");
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(loadOAuthRecord(), null);
  assert.equal(lastUser(), "carla");
  assert.equal(signedOutHere(), false);
  assert.equal(loadSession()?.method, undefined);
});

// ---- Renewing the access token: once across tabs, telling a lost session from a passing failure ----

const NOW = 5_000_000;
const RENEW_URL = "https://qa.door43.org/login/oauth/access_token";
const oauthError = (error: string, error_description = "") => new Response(JSON.stringify({ error, error_description }), { status: 400, headers: { "Content-Type": "application/json" } });

/** Web Locks with a real queue: one holder at a time, and a request still waiting can be aborted. */
function fakeLocks(): LockLike {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    request<T>(_name: string, options: { signal: AbortSignal }, fn: () => Promise<T>): Promise<T> {
      const prev = tail;
      let release!: () => void;
      tail = new Promise<void>((r) => (release = r));
      return new Promise<T>((resolve, reject) => {
        let state: "waiting" | "granted" | "aborted" = "waiting";
        options.signal.addEventListener("abort", () => {
          if (state !== "waiting") return;
          state = "aborted";
          reject(new DOMException("aborted", "AbortError"));
        });
        void prev.then(async () => {
          if (state === "aborted") return release();
          state = "granted";
          try {
            resolve(await fn());
          } catch (err) {
            reject(err);
          } finally {
            release();
          }
        });
      });
    },
  };
}

/** A clock that never moves on its own: `fire(ms)` completes the sleeps of that length; 2 s ones complete at once. */
function fakeClock() {
  const sleeps: number[] = [];
  const pending: { ms: number; done: () => void }[] = [];
  return {
    sleeps,
    /** Runs when a 2 s sleep starts: what happens in other tabs while this one waits. */
    during2s: null as null | (() => void),
    sleep(ms: number) {
      return new Promise<void>((resolve) => {
        sleeps.push(ms);
        if (ms === 2000) {
          this.during2s?.();
          resolve();
        } else pending.push({ ms, done: resolve });
      });
    },
    fire(ms: number) {
      for (const p of pending.filter((x) => x.ms === ms)) p.done();
    },
  };
}

/**
 * A Door43 that renews: it knows the one refresh token that is good, hands out a new pair for it, and answers "used"
 * to any other. `script` answers in order before that; `during` runs while a request is in flight.
 */
function fakeDoor43(firstRefresh = "refresh-0") {
  const state = {
    renewals: 0,
    requests: [] as { url: string; contentType: string | null; params: URLSearchParams }[],
    good: firstRefresh,
    script: [] as (Response | "hang" | "network")[],
    during: null as null | (() => void | Promise<void>),
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const params = new URLSearchParams(String(init?.body ?? ""));
      state.requests.push({ url: String(input), contentType: new Headers(init?.headers).get("Content-Type"), params });
      await new Promise((r) => setTimeout(r, 0)); // the answer takes a moment: other callers get in
      await state.during?.();
      const next = state.script.shift();
      if (next === "network") throw new TypeError("network down");
      if (next === "hang") {
        await new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
      }
      if (next instanceof Response) return next;
      if (params.get("refresh_token") !== state.good) return oauthError("unauthorized_client", "token was already used");
      state.renewals++;
      const n = state.renewals;
      state.good = `refresh-${n}`;
      return json({ access_token: jwt(7, 100 + n), refresh_token: state.good, expires_in: 3600, token_type: "bearer" });
    }) as typeof fetch,
  };
  return state;
}

/** Deps for one "tab": its own in-flight map, everything else shared. */
function tabDeps(door43: ReturnType<typeof fakeDoor43>, clock: ReturnType<typeof fakeClock>, locks: LockLike | null, over: Partial<RenewDeps> = {}): Partial<RenewDeps> {
  return { fetch: door43.fetch, store: localStorage, locks, now: () => NOW, sleep: (ms) => clock.sleep(ms), inFlight: new Map(), ...over };
}

/** Signed in with Door43, the access token about to expire. */
function seedOAuth(over: Partial<OAuthRecord> = {}): OAuthRecord {
  reset();
  const record = rec({ seal: jwt(7), accessToken: jwt(7, 1), refreshToken: "refresh-0", expiresAt: NOW + 60_000, ...over });
  storeOAuthSession(sess({ token: record.seal }), record);
  return record;
}

await test("clasifica cada respuesta de la tabla", () => {
  const e = (error: string, error_description = "") => ({ error, error_description });
  assert.equal(classifyRenewal(200, { access_token: "a", refresh_token: "r", expires_in: 3600 }), "ok");
  assert.equal(classifyRenewal(200, {}), "transient");
  assert.equal(classifyRenewal(400, e("unauthorized_client", "token was already used")), "used");
  assert.equal(classifyRenewal(400, e("invalid_grant", "cannot increase the grant counter")), "used");
  assert.equal(classifyRenewal(400, e("unauthorized_client", "unable to parse refresh token")), "definitive");
  assert.equal(classifyRenewal(400, e("invalid_grant", "grant does not exist")), "definitive");
  assert.equal(classifyRenewal(400, e("invalid_client")), "definitive");
  for (const [s, b] of [[429, {}], [403, {}], [500, {}], [503, "<html>"], [400, e("invalid_request", "server error")], [400, "<html>"]] as const) assert.equal(classifyRenewal(s, b), "transient");
});

await test("renovar pide a Door43 en forma de formulario, sin pasar por la compuerta de escrituras", async () => {
  const record = seedOAuth();
  const door43 = fakeDoor43();
  const result = await renewAccessToken(record.accessToken, tabDeps(door43, fakeClock(), fakeLocks()));
  assert.equal(result.kind, "ok");
  const [req] = door43.requests;
  assert.equal(req.url, RENEW_URL);
  assert.equal(req.contentType, "application/x-www-form-urlencoded");
  assert.deepEqual([...req.params.entries()].sort(), [["client_id", "client-x"], ["grant_type", "refresh_token"], ["refresh_token", "refresh-0"]]);
});

await test("muchos 401 a la vez producen una sola renovación", async () => {
  const record = seedOAuth();
  const door43 = fakeDoor43();
  const deps = tabDeps(door43, fakeClock(), fakeLocks());
  const results = await Promise.all(Array.from({ length: 20 }, () => renewAccessToken(record.accessToken, deps)));
  assert.equal(door43.renewals, 1);
  assert.equal(door43.requests.length, 1, "los otros 19 ni llamaron a Door43");
  assert.ok(results.every((r) => r.kind === "ok" && r.record.accessToken === jwt(7, 101)));
});

await test("dos pestañas: la segunda usa lo que guardó la primera", async () => {
  const record = seedOAuth();
  const door43 = fakeDoor43();
  const clock = fakeClock();
  const locks = fakeLocks();
  const [a, b] = await Promise.all([renewAccessToken(record.accessToken, tabDeps(door43, clock, locks)), renewAccessToken(record.accessToken, tabDeps(door43, clock, locks))]);
  assert.equal(door43.renewals, 1);
  assert.equal(door43.requests.length, 1, "la segunda pestaña ni llamó a Door43");
  assert.ok(a.kind === "ok" && b.kind === "ok" && a.record.accessToken === b.record.accessToken);
  assert.equal(loadOAuthRecord()?.accessToken, jwt(7, 101));
});

await test("renovar conserva la seña y cuenta la caducidad desde el reloj de aquí", async () => {
  const record = seedOAuth();
  const door43 = fakeDoor43();
  const result = await renewAccessToken(record.accessToken, tabDeps(door43, fakeClock(), fakeLocks()));
  assert.ok(result.kind === "ok");
  assert.equal(result.record.seal, record.seal);
  assert.notEqual(result.record.accessToken, record.accessToken);
  assert.equal(result.record.expiresAt, NOW + 3600 * 1000);
  assert.deepEqual(loadOAuthRecord(), result.record);
  assert.equal(loadOAuthRecord()?.refreshToken, "refresh-1");
  assert.equal(loadSession()?.token, record.seal, "la sesión guarda la misma seña");
});

await test("sin Web Locks también renueva una sola vez en la pestaña", async () => {
  const record = seedOAuth();
  const door43 = fakeDoor43();
  const deps = tabDeps(door43, fakeClock(), null);
  const results = await Promise.all(Array.from({ length: 5 }, () => renewAccessToken(record.accessToken, deps)));
  assert.equal(door43.renewals, 1);
  assert.equal(door43.requests.length, 1, "las otras 4 ni llamaron a Door43");
  assert.ok(results.every((r) => r.kind === "ok"));
});

await test("una renovación terminada no se queda en la memoria de la pestaña", async () => {
  const record = seedOAuth();
  const door43 = fakeDoor43();
  const deps = tabDeps(door43, fakeClock(), fakeLocks());
  await renewAccessToken(record.accessToken, deps);
  assert.equal(deps.inFlight!.size, 0);
});

await test("cerrar sesión durante una renovación no escribe nada", async () => {
  const record = seedOAuth();
  const door43 = fakeDoor43();
  door43.during = () => signOut();
  const result = await renewAccessToken(record.accessToken, tabDeps(door43, fakeClock(), fakeLocks()));
  assert.equal(result.kind, "gone");
  assert.equal(loadOAuthRecord(), null);
  assert.equal(loadSession(), undefined);
});

await test("sin registro no hay nada que renovar", async () => {
  reset();
  const door43 = fakeDoor43();
  assert.deepEqual(await renewAccessToken(jwt(7, 1), tabDeps(door43, fakeClock(), fakeLocks())), { kind: "gone" });
  assert.equal(door43.requests.length, 0);
});

await test("otra persona entró durante la renovación: no se pisa", async () => {
  const record = seedOAuth();
  const door43 = fakeDoor43();
  const other = rec({ username: "bea", seal: "B", grantId: 9, accessToken: jwt(9, 1), refreshToken: "refresh-b" });
  door43.during = () => storeOAuthSession(sess({ token: "B", username: "bea" }), other);
  const result = await renewAccessToken(record.accessToken, tabDeps(door43, fakeClock(), fakeLocks()));
  assert.equal(result.kind, "gone");
  assert.deepEqual(loadOAuthRecord(), other);
  assert.equal(loadSession()?.token, "B");
});

await test("el registro cambió de seña pero la sesión no: tampoco se escribe", async () => {
  const record = seedOAuth();
  const door43 = fakeDoor43();
  // Someone else's record while the session of this tab is still the old one.
  const other = rec({ seal: "B", accessToken: jwt(7, 77) });
  door43.during = () => void saveOAuthRecord(other);
  const result = await renewAccessToken(record.accessToken, tabDeps(door43, fakeClock(), fakeLocks()));
  assert.equal(result.kind, "gone");
  assert.deepEqual(loadOAuthRecord(), other);
});

await test("token usado: si otra pestaña ya guardó uno más nuevo, lo toma sin esperar", async () => {
  const record = seedOAuth();
  const door43 = fakeDoor43();
  const clock = fakeClock();
  door43.script.push(oauthError("unauthorized_client", "token was already used"));
  door43.during = () => {
    door43.during = null;
    saveOAuthRecord({ ...record, accessToken: jwt(7, 55), refreshToken: "refresh-55" });
  };
  const result = await renewAccessToken(record.accessToken, tabDeps(door43, clock, fakeLocks()));
  assert.ok(result.kind === "ok" && result.record.accessToken === jwt(7, 55));
  assert.deepEqual(clock.sleeps.filter((ms) => ms === 2000), []);
});

await test("token usado: sin nada nuevo, reintenta una vez a los 2 s y, si se repite, es definitivo", async () => {
  const record = seedOAuth();
  const door43 = fakeDoor43();
  const clock = fakeClock();
  door43.script.push(oauthError("invalid_grant", "cannot increase the grant counter"), oauthError("unauthorized_client", "token was already used"));
  const result = await renewAccessToken(record.accessToken, tabDeps(door43, clock, fakeLocks()));
  assert.deepEqual(result, { kind: "definitive", seal: record.seal });
  assert.equal(clock.sleeps.filter((ms) => ms === 2000).length, 1);
  assert.equal(door43.requests.length, 2);
  assert.deepEqual(loadOAuthRecord(), record, "no toca el registro: cerrar la sesión le toca a quien llama");
});

await test("token usado una vez y bien a la segunda: renueva", async () => {
  const record = seedOAuth();
  const door43 = fakeDoor43();
  const clock = fakeClock();
  door43.script.push(oauthError("unauthorized_client", "token was already used"));
  const result = await renewAccessToken(record.accessToken, tabDeps(door43, clock, fakeLocks()));
  assert.ok(result.kind === "ok");
  assert.equal(clock.sleeps.filter((ms) => ms === 2000).length, 1);
  assert.equal(loadOAuthRecord()?.refreshToken, "refresh-1");
});

await test("un rechazo definitivo devuelve la seña y no escribe", async () => {
  const record = seedOAuth();
  for (const answer of [oauthError("invalid_grant", "grant does not exist"), oauthError("invalid_client"), oauthError("unauthorized_client", "unable to parse refresh token")]) {
    const door43 = fakeDoor43();
    door43.script.push(answer);
    assert.deepEqual(await renewAccessToken(record.accessToken, tabDeps(door43, fakeClock(), fakeLocks())), { kind: "definitive", seal: record.seal });
    assert.deepEqual(loadOAuthRecord(), record);
  }
});

await test("sin red, un 5xx, un 429 o una página rara: la sesión sigue", async () => {
  const record = seedOAuth();
  for (const answer of ["network", new Response("{}", { status: 500 }), new Response("{}", { status: 429 }), new Response("<html>", { status: 200 }), oauthError("invalid_request", "server error")] as const) {
    const door43 = fakeDoor43();
    door43.script.push(answer);
    assert.deepEqual(await renewAccessToken(record.accessToken, tabDeps(door43, fakeClock(), fakeLocks())), { kind: "transient" });
    assert.deepEqual(loadOAuthRecord(), record);
  }
});

await test("a los 8 s sin respuesta, la renovación se corta y la sesión sigue", async () => {
  const record = seedOAuth();
  const door43 = fakeDoor43();
  const clock = fakeClock();
  door43.script.push("hang");
  const pending = renewAccessToken(record.accessToken, tabDeps(door43, clock, fakeLocks()));
  await new Promise((r) => setTimeout(r, 20));
  clock.fire(8000);
  assert.deepEqual(await pending, { kind: "transient" });
  assert.deepEqual(loadOAuthRecord(), record);
});

await test("con el candado ocupado 10 s, la petición sigue con el token que hay", async () => {
  const record = seedOAuth();
  const door43 = fakeDoor43();
  const clock = fakeClock();
  const locks = fakeLocks();
  // A frozen tab holds the lock and never lets go.
  let letGo!: () => void;
  const frozen = locks.request("taller-oauth-renew", { signal: new AbortController().signal }, () => new Promise<void>((r) => (letGo = r)));
  const pending = renewAccessToken(record.accessToken, tabDeps(door43, clock, locks));
  await new Promise((r) => setTimeout(r, 20));
  clock.fire(10_000);
  assert.deepEqual(await pending, { kind: "transient" });
  assert.equal(door43.requests.length, 0);
  assert.deepEqual(loadOAuthRecord(), record);
  letGo();
  await frozen;
  // And the queue is not left stuck by the one that gave up.
  assert.equal((await renewAccessToken(record.accessToken, tabDeps(door43, clock, locks))).kind, "ok");
});

/** Bea's sign-in, as another tab would leave it. */
const bea = () => rec({ username: "bea", seal: jwt(9), grantId: 9, accessToken: jwt(9, 1), refreshToken: "refresh-b" });
const signInBea = () => storeOAuthSession(sess({ token: jwt(9), username: "bea" }), bea());

await test("otra persona ya había entrado antes de la llamada: no se le da su token a esta pestaña", async () => {
  const record = seedOAuth();
  const door43 = fakeDoor43();
  signInBea();
  assert.deepEqual(await renewAccessToken(record.accessToken, tabDeps(door43, fakeClock(), fakeLocks())), { kind: "gone" });
  assert.equal(door43.requests.length, 0);
  assert.deepEqual(loadOAuthRecord(), bea());
});

await test("un token que no es un JWT de OAuth tampoco recibe el registro de otro", async () => {
  seedOAuth();
  const door43 = fakeDoor43();
  assert.deepEqual(await renewAccessToken("token-de-contraseña", tabDeps(door43, fakeClock(), fakeLocks())), { kind: "gone" });
  assert.equal(door43.requests.length, 0);
});

await test("otra persona entró mientras esperaba los 2 s del reintento: gone y su registro queda igual", async () => {
  const record = seedOAuth();
  const door43 = fakeDoor43();
  const clock = fakeClock();
  clock.during2s = signInBea;
  door43.script.push(oauthError("unauthorized_client", "token was already used"));
  assert.deepEqual(await renewAccessToken(record.accessToken, tabDeps(door43, clock, fakeLocks())), { kind: "gone" });
  assert.equal(door43.requests.length, 1, "no volvió a llamar con el token de otra persona");
  assert.deepEqual(loadOAuthRecord(), bea());
});

await test("un token más nuevo del mismo permiso durante el reintento sí se usa", async () => {
  const record = seedOAuth();
  const door43 = fakeDoor43();
  const clock = fakeClock();
  clock.during2s = () => void saveOAuthRecord({ ...record, accessToken: jwt(7, 66), refreshToken: "refresh-66" });
  door43.script.push(oauthError("unauthorized_client", "token was already used"));
  const result = await renewAccessToken(record.accessToken, tabDeps(door43, clock, fakeLocks()));
  assert.ok(result.kind === "ok" && result.record.accessToken === jwt(7, 66));
  assert.equal(door43.requests.length, 1);
});

await test("un segundo «usado» relee antes de rendirse: si ya hay uno más nuevo, lo toma", async () => {
  const record = seedOAuth();
  const door43 = fakeDoor43();
  const clock = fakeClock();
  door43.script.push(oauthError("unauthorized_client", "token was already used"), oauthError("unauthorized_client", "token was already used"));
  let calls = 0;
  door43.during = () => {
    // On the second request another tab saves a newer token of the same grant, just before Door43 answers "used".
    if (++calls === 2) void saveOAuthRecord({ ...record, accessToken: jwt(7, 88), refreshToken: "refresh-88" });
  };
  const result = await renewAccessToken(record.accessToken, tabDeps(door43, clock, fakeLocks()));
  assert.ok(result.kind === "ok" && result.record.accessToken === jwt(7, 88));
});

await test("cambió solo la sesión durante la renovación: gone y no se escribe nada", async () => {
  const record = seedOAuth();
  const door43 = fakeDoor43();
  // The record keeps its seal; the stored session is another one.
  door43.during = () => localStorage.setItem("gt-dcs-session", JSON.stringify(sess({ token: "B", username: "bea" })));
  assert.deepEqual(await renewAccessToken(record.accessToken, tabDeps(door43, fakeClock(), fakeLocks())), { kind: "gone" });
  assert.deepEqual(loadOAuthRecord(), record);
  assert.equal(loadSession()?.token, "B");
});

await test("si el almacenamiento no deja guardar lo renovado, el token nuevo sirve igual", async () => {
  const record = seedOAuth();
  const door43 = fakeDoor43();
  await withFailingWrite(1, async () => {
    const result = await renewAccessToken(record.accessToken, tabDeps(door43, fakeClock(), fakeLocks()));
    assert.ok(result.kind === "ok" && result.record.accessToken === jwt(7, 101), "no se toma por un fallo pasajero");
  });
  assert.deepEqual(loadOAuthRecord(), record, "lo guardado no cambió");
  assert.equal(door43.renewals, 1, "no gastó más tokens de renovación");
});

await test("ensureFresh solo renueva cuando quedan menos de 2 minutos", async () => {
  const door43 = fakeDoor43();
  const deps = tabDeps(door43, fakeClock(), fakeLocks());
  const fresh = seedOAuth({ expiresAt: NOW + 120_000 });
  assert.deepEqual(await ensureFresh(fresh, deps), { kind: "ok", record: fresh });
  assert.equal(door43.renewals, 0);
  const stale = seedOAuth({ expiresAt: NOW + 119_999 });
  const result = await ensureFresh(stale, deps);
  assert.ok(result.kind === "ok" && result.record.accessToken !== stale.accessToken);
  assert.equal(door43.renewals, 1);
});

await test("tokenForJoin con una sesión de contraseña da el mismo token", async () => {
  reset();
  const door43 = fakeDoor43();
  const deps = tabDeps(door43, fakeClock(), fakeLocks());
  assert.deepEqual(await tokenForJoin("token-de-contraseña", deps), { kind: "ok", token: "token-de-contraseña" });
  assert.equal(door43.renewals, 0);
});

await test("tokenForJoin con OAuth da el token vigente, renovándolo si hace falta", async () => {
  const door43 = fakeDoor43();
  const deps = tabDeps(door43, fakeClock(), fakeLocks());
  const fresh = seedOAuth({ expiresAt: NOW + 3_600_000 });
  assert.deepEqual(await tokenForJoin(fresh.seal, deps), { kind: "ok", token: fresh.accessToken });
  assert.equal(door43.renewals, 0);
  const stale = seedOAuth({ expiresAt: NOW + 1_000 });
  assert.deepEqual(await tokenForJoin(stale.seal, deps), { kind: "ok", token: jwt(7, 101) });
});

await test("tokenForJoin: sin registro, o de otro permiso, la sesión se perdió", async () => {
  reset();
  const deps = tabDeps(fakeDoor43(), fakeClock(), fakeLocks());
  assert.deepEqual(await tokenForJoin(jwt(7), deps), { kind: "gone" });
  seedOAuth({ grantId: 9 });
  assert.deepEqual(await tokenForJoin(jwt(7), deps), { kind: "gone" });
});

await test("tokenForJoin pasa lo pasajero y lo definitivo tal cual", async () => {
  const door43 = fakeDoor43();
  const stale = seedOAuth({ expiresAt: NOW });
  door43.script.push("network");
  assert.deepEqual(await tokenForJoin(stale.seal, tabDeps(door43, fakeClock(), fakeLocks())), { kind: "transient" });
  door43.script.push(oauthError("invalid_grant", "grant does not exist"));
  assert.deepEqual(await tokenForJoin(stale.seal, tabDeps(door43, fakeClock(), fakeLocks())), { kind: "definitive", seal: stale.seal });
});

await test("ningún token aparece en lo que dice la consola durante una renovación", async () => {
  const record = seedOAuth();
  const door43 = fakeDoor43();
  const said: string[] = [];
  const real = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
  for (const k of Object.keys(real) as (keyof typeof real)[]) console[k] = (...a: unknown[]) => void said.push(a.map(String).join(" "));
  try {
    door43.script.push("network");
    await renewAccessToken(record.accessToken, tabDeps(door43, fakeClock(), fakeLocks()));
    await renewAccessToken(record.accessToken, tabDeps(door43, fakeClock(), fakeLocks()));
  } finally {
    Object.assign(console, real);
  }
  assert.deepEqual(said, []);
});

// ---- The session guard: send the current OAuth token, and retry once after a 401 ----

const API_URL = "https://qa.door43.org/api/v1/user";

/** A Door43 API: 200 for the tokens in `valid`, 401 for any other. Keeps what it saw. */
function fakeApi(valid: Iterable<string>) {
  const state = {
    valid: new Set(valid),
    seen: [] as { url: string; auth: string; accept: string | null; method: string; body: string | null }[],
    /** Runs while a request is in flight: what happens in other tabs meanwhile. */
    onRequest: null as null | (() => void),
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : null;
      const headers = new Headers(init?.headers ?? req?.headers);
      const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
      let body: string | null = null;
      if (init?.body !== undefined && init.body !== null) body = typeof init.body === "string" ? init.body : "[stream]";
      else if (req?.body) body = await req.text();
      const auth = headers.get("authorization") ?? "";
      state.seen.push({ url: req ? req.url : String(input), auth, accept: headers.get("accept"), method, body });
      state.onRequest?.();
      return state.valid.has(auth.replace(/^token /i, "")) ? json({ ok: true }) : new Response("{}", { status: 401 });
    }) as typeof fetch,
  };
  return state;
}

/** Runs `fn` with the guard (and its OAuth deps) over `api`; puts everything back after. `expired` lists the seals it announced. */
async function withOAuthGuard(
  api: { fetch: typeof fetch },
  deps: Partial<RenewDeps>,
  fn: (state: { expired: string[] }) => Promise<void>,
  wrap: (inner: typeof fetch) => typeof fetch = (inner) => inner,
) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = wrap(api.fetch);
  const state = { expired: [] as string[] };
  const uninstall = installSessionExpiryGuard({ getSessionToken: () => loadSession()?.token, onExpired: (seal) => void state.expired.push(seal), oauth: deps });
  try {
    await fn(state);
  } finally {
    uninstall();
    globalThis.fetch = realFetch;
  }
}

await test("cambia la seña por el token vigente, conservando la cabecera", async () => {
  const record = seedOAuth({ expiresAt: NOW + 3_600_000 });
  const auth = `token ${record.seal}`;
  const variants: [string, () => [RequestInfo | URL, RequestInit?]][] = [
    ["objeto con la cabecera en minúsculas", () => [API_URL, { headers: { authorization: auth, accept: "application/json" } }]],
    ["Headers", () => [API_URL, { headers: new Headers({ Authorization: auth, Accept: "application/json" }) }]],
    ["arreglo", () => [API_URL, { headers: [["Authorization", auth], ["Accept", "application/json"]] }]],
    ["Request", () => [new Request(API_URL, { headers: { authorization: auth, accept: "application/json" } })]],
    ["URL", () => [new URL(API_URL), { headers: { Authorization: auth, Accept: "application/json" } }]],
  ];
  for (const [name, make] of variants) {
    const api = fakeApi([record.accessToken]);
    const door43 = fakeDoor43();
    await withOAuthGuard(api, tabDeps(door43, fakeClock(), fakeLocks()), async (state) => {
      const [input, init] = make();
      const res = await fetch(input, init);
      assert.equal(res.status, 200, name);
      assert.equal(api.seen.length, 1, name);
      assert.equal(api.seen[0].auth, `token ${record.accessToken}`, `${name}: el servidor ve el vigente`);
      assert.equal(api.seen[0].accept, "application/json", `${name}: lo demás se conserva`);
      assert.equal(api.seen[0].url, API_URL, `${name}: mismo destino`);
      assert.equal(door43.requests.length, 0, name);
      assert.deepEqual(state.expired, []);
    });
  }
});

await test("una sesión con contraseña no se toca", async () => {
  reset();
  localStorage.setItem("gt-dcs-session", JSON.stringify(sess({ token: "token-de-contraseña", method: undefined })));
  const api = fakeApi(["token-de-contraseña"]);
  const door43 = fakeDoor43();
  await withOAuthGuard(api, tabDeps(door43, fakeClock(), fakeLocks()), async () => {
    const res = await fetch(API_URL, { headers: { Authorization: "token token-de-contraseña" } });
    assert.equal(res.status, 200);
    assert.equal(api.seen[0].auth, "token token-de-contraseña");
    assert.equal(door43.renewals + door43.requests.length, 0);
  });
});

await test("una petición sin «token …» no se toca", async () => {
  const record = seedOAuth();
  const api = fakeApi([]);
  const door43 = fakeDoor43();
  await withOAuthGuard(api, tabDeps(door43, fakeClock(), fakeLocks()), async (state) => {
    for (const init of [undefined, { headers: { Authorization: "Basic dXNlcjpwYXNz" } }]) {
      assert.equal((await fetch(API_URL, init)).status, 401);
    }
    assert.deepEqual(api.seen.map((s) => s.auth), ["", "Basic dXNlcjpwYXNz"]);
    assert.equal(door43.requests.length, 0);
    assert.deepEqual(state.expired, []);
    assert.deepEqual(loadOAuthRecord(), record);
  });
});

await test("renueva antes si quedan menos de 2 minutos", async () => {
  const record = seedOAuth({ expiresAt: NOW + 60_000 });
  const api = fakeApi([jwt(7, 101)]);
  const door43 = fakeDoor43();
  await withOAuthGuard(api, tabDeps(door43, fakeClock(), fakeLocks()), async () => {
    const res = await fetch(API_URL, { headers: { Authorization: `token ${record.seal}` } });
    assert.equal(res.status, 200);
    assert.equal(door43.renewals, 1);
    assert.equal(api.seen.length, 1, "la petición salió una sola vez, ya con el nuevo");
    assert.equal(api.seen[0].auth, `token ${jwt(7, 101)}`);
  });
});

await test("un 401 renueva y reintenta una sola vez, con el mismo cuerpo", async () => {
  const record = seedOAuth({ expiresAt: NOW + 3_600_000 });
  const auth = `token ${record.seal}`;
  const makers: [string, () => [RequestInfo | URL, RequestInit?]][] = [
    ["cuerpo en init", () => [API_URL, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: '{"a":1}' }]],
    ["Request con cuerpo", () => [new Request(API_URL, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: '{"a":1}' })]],
  ];
  for (const [name, make] of makers) {
    seedOAuth({ expiresAt: NOW + 3_600_000 }); // each one starts from the same record
    const api = fakeApi([jwt(7, 101)]); // the token of the record is already refused
    const door43 = fakeDoor43();
    await withOAuthGuard(api, tabDeps(door43, fakeClock(), fakeLocks()), async (state) => {
      const [input, init] = make();
      const res = await fetch(input, init);
      assert.equal(res.status, 200, name);
      assert.equal(door43.renewals, 1, name);
      assert.equal(api.seen.length, 2, `${name}: dos envíos`);
      assert.equal(api.seen[0].auth, `token ${record.accessToken}`, name);
      assert.equal(api.seen[1].auth, `token ${jwt(7, 101)}`, name);
      assert.equal(api.seen[0].body, '{"a":1}', name);
      assert.equal(api.seen[1].body, '{"a":1}', `${name}: el mismo cuerpo`);
      assert.deepEqual(state.expired, []);
    });
  }
});

await test("un cuerpo en stream no se reintenta: se devuelve el 401", async () => {
  seedOAuth({ expiresAt: NOW + 3_600_000 });
  const api = fakeApi([]);
  const door43 = fakeDoor43();
  await withOAuthGuard(api, tabDeps(door43, fakeClock(), fakeLocks()), async (state) => {
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("x"));
        c.close();
      },
    });
    const res = await fetch(API_URL, { method: "POST", headers: { Authorization: `token ${jwt(7)}` }, body, duplex: "half" } as RequestInit);
    assert.equal(res.status, 401);
    assert.equal(api.seen.length, 1);
    assert.equal(door43.requests.length, 0);
    assert.deepEqual(state.expired, []);
  });
});

await test("un segundo 401 cierra la sesión una vez, aunque lleguen varios", async () => {
  const record = seedOAuth({ expiresAt: NOW + 3_600_000 });
  const api = fakeApi([]); // Door43 refuses every token
  const door43 = fakeDoor43();
  await withOAuthGuard(api, tabDeps(door43, fakeClock(), fakeLocks()), async (state) => {
    const call = () => fetch(API_URL, { headers: { Authorization: `token ${record.seal}` } });
    await assert.rejects(call(), SessionExpiredError);
    assert.equal(state.expired.length, 1);
    assert.deepEqual(state.expired, [record.seal]);
    assert.equal(door43.renewals, 1);
    const outcomes = await Promise.allSettled([call(), call(), call()]);
    assert.ok(outcomes.every((o) => o.status === "rejected" && o.reason instanceof SessionExpiredError));
    assert.equal(state.expired.length, 1, "se avisa una sola vez");
    const before = api.seen.length;
    await assert.rejects(fetch(API_URL, { headers: { Authorization: `token ${jwt(7, 101)}` } }), SessionExpiredError);
    assert.equal(api.seen.length, before, "ya caducada: ni sale a la red");
  });
  // And several at once, from the start.
  seedOAuth({ expiresAt: NOW + 3_600_000 });
  const api2 = fakeApi([]);
  await withOAuthGuard(api2, tabDeps(fakeDoor43(), fakeClock(), fakeLocks()), async (state) => {
    const call = () => fetch(API_URL, { headers: { Authorization: `token ${record.seal}` } });
    const outcomes = await Promise.allSettled([call(), call(), call()]);
    assert.ok(outcomes.every((o) => o.status === "rejected" && o.reason instanceof SessionExpiredError));
    assert.equal(state.expired.length, 1);
  });
});

await test("el reloj adelantado no cierra la sesión", async () => {
  const record = seedOAuth({ expiresAt: NOW + 3_600_000 }); // the phone thinks the token has an hour left
  const api = fakeApi([jwt(7, 101)]); // Door43 says it does not
  const door43 = fakeDoor43();
  await withOAuthGuard(api, tabDeps(door43, fakeClock(), fakeLocks()), async (state) => {
    const res = await fetch(API_URL, { headers: { Authorization: `token ${record.seal}` } });
    assert.equal(res.status, 200);
    assert.equal(door43.renewals, 1);
    assert.deepEqual(state.expired, []);
    assert.equal(loadOAuthRecord()?.accessToken, jwt(7, 101));
  });
});

await test("un 401 sin red para renovar no cierra la sesión", async () => {
  const record = seedOAuth({ expiresAt: NOW + 3_600_000 });
  const api = fakeApi([]);
  const door43 = fakeDoor43();
  door43.script.push("network");
  await withOAuthGuard(api, tabDeps(door43, fakeClock(), fakeLocks()), async (state) => {
    const call = () => fetch(API_URL, { headers: { Authorization: `token ${record.seal}` } });
    await assert.rejects(call(), Door43UnreachableError);
    assert.equal(state.expired.length, 0);
    assert.deepEqual(loadOAuthRecord(), record);
    try {
      door43.script.push("network");
      await call();
      assert.fail("debía fallar");
    } catch (err) {
      assert.equal((err as Error).message, tNow("signIn.offlineRetry"));
      assert.equal(isSessionExpiredError(err), false, "no se toma por sesión caducada");
    }
  });
});

await test("un 429 o una página HTML al renovar no cierra la sesión", async () => {
  for (const answer of [new Response("{}", { status: 429 }), new Response("<html>", { status: 200 }), new Response("<html>", { status: 503 })]) {
    const record = seedOAuth({ expiresAt: NOW + 3_600_000 });
    const api = fakeApi([]);
    const door43 = fakeDoor43();
    door43.script.push(answer);
    await withOAuthGuard(api, tabDeps(door43, fakeClock(), fakeLocks()), async (state) => {
      await assert.rejects(fetch(API_URL, { headers: { Authorization: `token ${record.seal}` } }), Door43UnreachableError);
      assert.equal(state.expired.length, 0);
      assert.ok(loadOAuthRecord());
      assert.deepEqual(loadOAuthRecord(), record);
    });
  }
});

await test("otra pestaña cerró sesión durante el 401: caduca sin escribir", async () => {
  for (const [name, during] of [
    ["cerró la sesión", () => signOut()],
    ["entró otra persona", signInBea],
  ] as const) {
    const record = seedOAuth({ expiresAt: NOW + 3_600_000 });
    const api = fakeApi([]);
    const door43 = fakeDoor43();
    api.onRequest = () => {
      api.onRequest = null;
      during();
    };
    const afterOther = name === "cerró la sesión" ? null : bea();
    await withOAuthGuard(api, tabDeps(door43, fakeClock(), fakeLocks()), async (state) => {
      await assert.rejects(fetch(API_URL, { headers: { Authorization: `token ${record.seal}` } }), SessionExpiredError, name);
      assert.deepEqual(state.expired, [record.seal], `${name}: se avisa con la seña de esta pestaña`);
      assert.equal(door43.requests.length, 0, `${name}: no llamó a Door43 con lo de otro`);
      assert.deepEqual(loadOAuthRecord(), afterOther, `${name}: no escribió ningún registro nuevo`);
    });
  }
});

await test("el 401 de un Worker no renueva", async () => {
  const record = seedOAuth({ expiresAt: NOW + 3_600_000 });
  const api = fakeApi([]);
  const door43 = fakeDoor43();
  await withOAuthGuard(api, tabDeps(door43, fakeClock(), fakeLocks()), async (state) => {
    const res = await fetch("https://push.example/notify", { headers: { Authorization: `token ${record.seal}` } });
    assert.equal(res.status, 401);
    assert.equal(door43.renewals + door43.requests.length, 0);
    assert.equal(state.expired.length, 0);
    assert.deepEqual(loadOAuthRecord(), record);
  });
});

await test("el registro de un servidor no sirve a una petición al otro", async () => {
  const record = seedOAuth({ expiresAt: NOW + 3_600_000 }); // a QA record
  const api = fakeApi([record.seal]);
  const door43 = fakeDoor43();
  await withOAuthGuard(api, tabDeps(door43, fakeClock(), fakeLocks()), async () => {
    assert.equal((await fetch("https://git.door43.org/api/v1/user", { headers: { Authorization: `token ${record.seal}` } })).status, 200);
    assert.equal(api.seen[0]?.auth, `token ${record.seal}`, "la seña sale tal cual: no se cambia por un token de otro servidor");
    assert.equal(door43.renewals + door43.requests.length, 0);
  });
});

await test("la renovación no cuenta como escritura", async () => {
  const record = seedOAuth({ expiresAt: NOW + 3_600_000 });
  const gated = (inner: typeof fetch) => gatedFetch(inner, createGate(6));
  const api = fakeApi([jwt(7, 101)]);
  const door43 = fakeDoor43();
  const before = door43Writes();
  await withOAuthGuard(
    api,
    tabDeps(door43, fakeClock(), fakeLocks()),
    async () => {
      assert.equal((await fetch(API_URL, { headers: { Authorization: `token ${record.seal}` } })).status, 200);
      assert.equal(door43.renewals, 1);
      assert.equal(door43Writes(), before, "una lectura con renovación no cuenta nada");
    },
    gated,
  );
  // A write counts its two sends (the real attempts at Door43) and not the renewal between them.
  seedOAuth({ expiresAt: NOW + 3_600_000 });
  const api2 = fakeApi([jwt(7, 101)]);
  const mark = door43Writes();
  await withOAuthGuard(
    api2,
    tabDeps(fakeDoor43(), fakeClock(), fakeLocks()),
    async () => {
      await fetch(API_URL, { method: "POST", headers: { Authorization: `token ${record.seal}` }, body: "{}" });
      assert.equal(door43Writes() - mark, 2);
    },
    gated,
  );
});

await test("ningún error muestra un token", async () => {
  const record = seedOAuth({ expiresAt: NOW + 3_600_000 });
  const secrets = [record.seal, record.accessToken, record.refreshToken, jwt(7, 101), "refresh-1"];
  const url = `${API_URL}?access_token=${record.accessToken}`;
  const errors: unknown[] = [];
  const door43a = fakeDoor43();
  door43a.script.push("network");
  await withOAuthGuard(fakeApi([]), tabDeps(door43a, fakeClock(), fakeLocks()), async () => {
    errors.push(await fetch(url, { headers: { Authorization: `token ${record.seal}` } }).catch((e) => e));
  });
  seedOAuth({ expiresAt: NOW + 3_600_000 });
  await withOAuthGuard(fakeApi([]), tabDeps(fakeDoor43(), fakeClock(), fakeLocks()), async () => {
    errors.push(await fetch(url, { headers: { Authorization: `token ${record.seal}` } }).catch((e) => e));
    errors.push(await fetch(url, { headers: { Authorization: `token ${record.seal}` } }).catch((e) => e)); // already expired
  });
  assert.ok(errors[0] instanceof Door43UnreachableError && errors[1] instanceof SessionExpiredError && errors[2] instanceof SessionExpiredError);
  for (const err of errors as (Error & { technicalDetail: string })[]) {
    const said = [err.message, err.technicalDetail, String(err), err.stack ?? "", JSON.stringify(err), JSON.stringify(Object.getOwnPropertyDescriptors(err))].join("\n");
    for (const secret of secrets) assert.ok(!said.includes(secret), "un token aparece en un error");
    assert.ok(!said.includes("access_token"), "ni siquiera la consulta");
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
