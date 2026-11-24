/**
 * The OAuth tokens of a Door43 sign-in, kept apart from the session.
 *
 * `gt-dcs-session.token` is a fixed seal of the session (the access token of the moment of sign-in) so that nothing
 * keyed on `session.token` reloads when a token is renewed. The real, renewable tokens live here, in `gt-dcs-oauth`.
 * This module must not import `auth.ts` (which imports it). No function here logs or throws a token.
 */

import { fetchBeforeGate } from "./door43Gate";

const KEY = "gt-dcs-oauth";
/** The session's key, owned by auth.ts; read here only to compare seals. */
const SESSION_KEY = "gt-dcs-session";

export type OAuthRecord = {
  host: string;
  username: string;
  /** The session's `token` at sign-in: ties this record to one session. */
  seal: string;
  /** The `gnt` claim of the tokens: every renewal of one grant carries the same. */
  grantId: number;
  clientId: string;
  accessToken: string;
  refreshToken: string;
  /** When `accessToken` expires, in ms since the epoch. */
  expiresAt: number;
};

export type TokenStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * The browser's storage. Read it inside a try: with storage blocked, merely touching `localStorage` throws, and a
 * default parameter would run outside the callers' try/catch.
 */
function defaultStore(): TokenStore {
  return localStorage;
}

/** The `gnt` (grant) claim of a Door43 OAuth JWT, or null for anything else (a password token, a bad value). */
export function grantOf(jwt: string): number | null {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))) as { gnt?: unknown } | null;
    const gnt = claims?.gnt;
    return typeof gnt === "number" && Number.isInteger(gnt) && gnt > 0 ? gnt : null;
  } catch {
    return null;
  }
}

export function loadOAuthRecord(store?: TokenStore): OAuthRecord | null {
  try {
    const raw = (store ?? defaultStore()).getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<OAuthRecord> | null;
    if (
      !p ||
      typeof p.host !== "string" ||
      typeof p.username !== "string" ||
      typeof p.seal !== "string" ||
      typeof p.grantId !== "number" ||
      typeof p.clientId !== "string" ||
      typeof p.accessToken !== "string" ||
      typeof p.refreshToken !== "string" ||
      typeof p.expiresAt !== "number"
    ) {
      return null;
    }
    return {
      host: p.host,
      username: p.username,
      seal: p.seal,
      grantId: p.grantId,
      clientId: p.clientId,
      accessToken: p.accessToken,
      refreshToken: p.refreshToken,
      expiresAt: p.expiresAt,
    };
  } catch {
    return null;
  }
}

/** True if the record was written; false when storage is blocked or full (the caller decides what that means). */
export function saveOAuthRecord(record: OAuthRecord, store?: TokenStore): boolean {
  try {
    (store ?? defaultStore()).setItem(KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function clearOAuthRecord(store?: TokenStore): void {
  try {
    (store ?? defaultStore()).removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** The `token` of the stored session (its seal), or null if there is none or it cannot be read. */
export function storedSessionSeal(store?: TokenStore): string | null {
  try {
    const raw = (store ?? defaultStore()).getItem(SESSION_KEY);
    if (!raw) return null;
    const token = (JSON.parse(raw) as { token?: unknown } | null)?.token;
    return typeof token === "string" && token ? token : null;
  } catch {
    return null;
  }
}

/**
 * The record that serves a request to `requestUrl` made with `requestToken`: only when that token is an OAuth JWT of
 * the same grant AND the record's server is the request's server. Grant ids are counters per server, and QA and
 * production can share one browser origin, so the grant alone could hand one server's tokens to the other.
 * A tab holding an earlier seal of the same grant still matches; a password session's token never does.
 */
export function recordFor(requestToken: string, requestUrl: string, store?: TokenStore): OAuthRecord | null {
  const gnt = grantOf(requestToken);
  if (gnt === null) return null;
  const record = loadOAuthRecord(store);
  if (!record || record.grantId !== gnt) return null;
  try {
    return new URL(requestUrl).origin === new URL(record.host).origin ? record : null;
  } catch {
    return null;
  }
}

// ---- Renewing the access token ----

/** The part of Web Locks used here; `navigator.locks` fits it. */
export type LockLike = { request<T>(name: string, options: { signal: AbortSignal }, fn: () => Promise<T>): Promise<T> };

export type RenewDeps = {
  fetch: typeof fetch;
  store: TokenStore;
  locks: LockLike | null;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** The renewals under way in this tab, by the access token they replace. One per tab; tests give each "tab" its own. */
  inFlight: Map<string, Promise<RenewResult>>;
  /**
   * The server the caller's request goes to. Grant ids are counters per server and QA and production can share one
   * browser origin, so a stored record of the same grant on another server is not this caller's: it is `gone`.
   * Unset = no check (callers that hold no server).
   */
  expectHost?: string;
};

/** Whether `host` and `expected` are the same server (origin). Unparseable counts as different. */
function sameServer(host: string, expected: string | undefined): boolean {
  if (expected === undefined) return true;
  try {
    return new URL(host).origin === new URL(expected).origin;
  } catch {
    return false;
  }
}

export type RenewResult = { kind: "ok"; record: OAuthRecord } | { kind: "transient" } | { kind: "definitive"; seal: string } | { kind: "gone" };

const LOCK_NAME = "taller-oauth-renew";
const LOCK_WAIT_MS = 10_000;
const RENEW_LIMIT_MS = 8_000;
const USED_RETRY_MS = 2_000;
/** Renew when the access token has less than this left. */
const RENEW_BEFORE_MS = 2 * 60_000;

const tabInFlight = new Map<string, Promise<RenewResult>>();

function withDefaults(deps?: Partial<RenewDeps>): RenewDeps {
  return {
    // Lazy, so nothing touches `fetchBeforeGate` or `localStorage` until a renewal runs (and storage may be blocked).
    fetch: deps?.fetch ?? ((input, init) => fetchBeforeGate()(input, init)),
    store: deps?.store ?? { getItem: (k) => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v), removeItem: (k) => localStorage.removeItem(k) },
    locks: deps && "locks" in deps ? (deps.locks ?? null) : defaultLocks(),
    now: deps?.now ?? Date.now,
    sleep: deps?.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    inFlight: deps?.inFlight ?? tabInFlight,
    expectHost: deps?.expectHost,
  };
}

function defaultLocks(): LockLike | null {
  try {
    return (typeof navigator !== "undefined" && (navigator as { locks?: LockLike }).locks) || null;
  } catch {
    return null;
  }
}

/**
 * What Door43's answer to a renewal means (see the table in the design spec, "Renovar en un solo lugar"):
 * `ok` stores the new tokens; `used` means the refresh token was already spent (another tab or device renewed, or an
 * answer was lost); `definitive` means the session is lost; anything else is a passing failure and the session stays.
 */
export function classifyRenewal(status: number, body: unknown): "ok" | "used" | "definitive" | "transient" {
  const o = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (status === 200) {
    return o && typeof o.access_token === "string" && o.access_token && typeof o.refresh_token === "string" && o.refresh_token && typeof o.expires_in === "number" && Number.isFinite(o.expires_in) && o.expires_in > 0
      ? "ok"
      : "transient";
  }
  if (status !== 400 || !o || typeof o.error !== "string") return "transient";
  const description = typeof o.error_description === "string" ? o.error_description.toLowerCase() : "";
  if (o.error === "unauthorized_client") {
    if (description.includes("already used")) return "used";
    return description.includes("unable to parse") ? "definitive" : "transient";
  }
  if (o.error === "invalid_grant") return description.includes("grant counter") ? "used" : "definitive";
  if (o.error === "invalid_client") return "definitive";
  return "transient";
}

/** One POST to the token endpoint, cut at 8 s. Null when it did not answer. */
async function postRenewal(record: OAuthRecord, d: RenewDeps): Promise<{ status: number; body: unknown } | null> {
  const ctrl = new AbortController();
  let finished = false;
  void d.sleep(RENEW_LIMIT_MS).then(
    () => {
      if (!finished) ctrl.abort();
    },
    () => {},
  );
  try {
    const res = await d.fetch(`${record.host.replace(/\/+$/, "")}/login/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: record.clientId, refresh_token: record.refreshToken }).toString(),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* not JSON: classifyRenewal treats it as a passing failure */
    }
    return { status: res.status, body };
  } catch {
    return null;
  } finally {
    finished = true;
  }
}

/** The renewal itself, run inside the lock. Every attempt re-reads the record and uses its refresh token. */
async function renewLocked(usedAccess: string, d: RenewDeps): Promise<RenewResult> {
  const grant = grantOf(usedAccess);
  /**
   * A stored token other than the one this call set out to replace: another tab renewed it (same grant: use it), or
   * another person signed in while this one waited for the lock or for the retry (another grant, or a token that is
   * no OAuth JWT: it is not this tab's to use, and handing it out would send this tab's request as someone else).
   */
  const movedOn = (stored: OAuthRecord): RenewResult => (grant !== null && stored.grantId === grant && sameServer(stored.host, d.expectHost) ? { kind: "ok", record: stored } : { kind: "gone" });
  for (let attempt = 0; ; attempt++) {
    const r = loadOAuthRecord(d.store);
    if (!r || !sameServer(r.host, d.expectHost)) return { kind: "gone" };
    if (r.accessToken !== usedAccess) return movedOn(r);

    const answer = await postRenewal(r, d);
    if (!answer) return { kind: "transient" };
    const verdict = classifyRenewal(answer.status, answer.body);

    if (verdict === "ok") {
      const t = answer.body as { access_token: string; refresh_token: string; expires_in: number };
      // The session may have been closed, or someone else signed in, while Door43 answered: then these tokens are no
      // one's to keep.
      const current = loadOAuthRecord(d.store);
      if (!current || current.seal !== r.seal || storedSessionSeal(d.store) !== r.seal) return { kind: "gone" };
      // The phone's clock may be wrong: the expiry is counted from now, never read from the token.
      const next: OAuthRecord = { ...current, accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: d.now() + t.expires_in * 1000 };
      // If storage refuses the write (full), the new token is still valid and this call can use it. Calling it a passing
      // failure would retry with a refresh token Door43 has just spent, and show an offline error that is not true.
      saveOAuthRecord(next, d.store);
      return { kind: "ok", record: next };
    }
    if (verdict === "definitive") return { kind: "definitive", seal: r.seal };
    if (verdict === "transient") return { kind: "transient" };
    // used: the record may now hold a newer token. If not, wait and try once more; a second "used" is final.
    const newer = loadOAuthRecord(d.store);
    if (!newer) return { kind: "gone" };
    if (newer.accessToken !== usedAccess) return movedOn(newer);
    if (attempt === 1) return { kind: "definitive", seal: r.seal };
    await d.sleep(USED_RETRY_MS);
  }
}

/**
 * Renews the access token `usedAccess`, once for the whole browser: one promise per tab, and the Web Lock across tabs.
 * Inside the lock a tab that finds a newer token than `usedAccess` uses it without calling Door43.
 */
export function renewAccessToken(usedAccess: string, deps?: Partial<RenewDeps>): Promise<RenewResult> {
  const d = withDefaults(deps);
  const running = d.inFlight.get(usedAccess);
  if (running) return running;
  const promise = runRenewal(usedAccess, d).finally(() => {
    if (d.inFlight.get(usedAccess) === promise) d.inFlight.delete(usedAccess);
  });
  d.inFlight.set(usedAccess, promise);
  return promise;
}

async function runRenewal(usedAccess: string, d: RenewDeps): Promise<RenewResult> {
  try {
    if (!d.locks) return await renewLocked(usedAccess, d);
    // A frozen tab could hold the lock for long: wait 10 s at most, then let the request go on with what it has.
    const ctrl = new AbortController();
    let granted = false;
    void d.sleep(LOCK_WAIT_MS).then(
      () => {
        if (!granted) ctrl.abort();
      },
      () => {},
    );
    return await d.locks.request(LOCK_NAME, { signal: ctrl.signal }, () => {
      granted = true;
      return renewLocked(usedAccess, d);
    });
  } catch {
    // Lock aborted or any unexpected failure: passing. Nothing here carries a token, and none is reported.
    return { kind: "transient" };
  }
}

/** The record with a token that has at least 2 minutes left, renewing it if it has less. */
export async function ensureFresh(record: OAuthRecord, deps?: Partial<RenewDeps>): Promise<RenewResult> {
  const d = withDefaults(deps);
  if (record.expiresAt - d.now() >= RENEW_BEFORE_MS) return { kind: "ok", record };
  return renewAccessToken(record.accessToken, d);
}

export type JoinToken = { kind: "ok"; token: string } | { kind: "transient" } | { kind: "definitive"; seal: string } | { kind: "gone" };

/**
 * The token to send when joining presence, from the session's `token`. A password session's token is the real one and
 * goes as it is; an OAuth session's `token` is only a seal, so the current access token (renewed if about to expire)
 * goes in its place.
 */
export async function tokenForJoin(sessionToken: string, deps?: Partial<RenewDeps>): Promise<JoinToken> {
  const gnt = grantOf(sessionToken);
  if (gnt === null) return { kind: "ok", token: sessionToken };
  const d = withDefaults(deps);
  const record = loadOAuthRecord(d.store);
  // Task 6 passes the session's host as `expectHost`, so another server's record of the same grant is never used.
  if (!record || record.grantId !== gnt || !sameServer(record.host, d.expectHost)) return { kind: "gone" };
  const fresh = await ensureFresh(record, d);
  return fresh.kind === "ok" ? { kind: "ok", token: fresh.record.accessToken } : fresh;
}
