/**
 * The OAuth tokens of a Door43 sign-in, kept apart from the session.
 *
 * `gt-dcs-session.token` is a fixed seal of the session (the access token of the moment of sign-in) so that nothing
 * keyed on `session.token` reloads when a token is renewed. The real, renewable tokens live here, in `gt-dcs-oauth`.
 * This module must not import `auth.ts` (which imports it). No function here logs or throws a token.
 */

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
