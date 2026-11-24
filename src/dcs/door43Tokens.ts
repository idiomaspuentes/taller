/**
 * The OAuth tokens of a Door43 sign-in, kept apart from the session.
 *
 * `gt-dcs-session.token` is a fixed seal of the session (the access token of the moment of sign-in) so that nothing
 * keyed on `session.token` reloads when a token is renewed. The real, renewable tokens live here, in `gt-dcs-oauth`.
 * This module must not import `auth.ts` (which imports it). No function here logs or throws a token.
 */

const KEY = "gt-dcs-oauth";

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

export function loadOAuthRecord(store: TokenStore = defaultStore()): OAuthRecord | null {
  try {
    const raw = store.getItem(KEY);
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

export function saveOAuthRecord(record: OAuthRecord, store: TokenStore = defaultStore()): void {
  try {
    store.setItem(KEY, JSON.stringify(record));
  } catch {
    /* no storage: the session simply cannot be renewed */
  }
}

export function clearOAuthRecord(store: TokenStore = defaultStore()): void {
  try {
    store.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * The record that serves a request made with `requestToken`: only when that token is an OAuth JWT of the same grant.
 * A tab holding an earlier seal of the same grant still matches; a password session's token never does.
 */
export function recordFor(requestToken: string, store: TokenStore = defaultStore()): OAuthRecord | null {
  const gnt = grantOf(requestToken);
  if (gnt === null) return null;
  const record = loadOAuthRecord(store);
  return record && record.grantId === gnt ? record : null;
}
