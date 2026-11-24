import {
  getAuthenticatedUser,
  getUserTeams,
  signInWithPassword as mintToken,
  type DcsTeam,
  type DcsUser,
} from "@ip-lms/dcs-client";
import { dcsConfig } from "./config";
import { clearOAuthRecord, saveOAuthRecord, type OAuthRecord } from "./door43Tokens";
import { canManageOrg, isOrgOwner } from "../domain/roles";

const STORAGE_KEY = "gt-dcs-session";
/** The account that last signed in here, kept after signing out so the sign-in screen can offer it. */
const LAST_USER_KEY = "gt-dcs-last-user";
/** Set by an explicit sign-out only (not by an expired session): the person chose to leave. */
const SIGNED_OUT_KEY = "gt-dcs-signed-out";
/** Required scopes for the PM platform. Old tokens without these force re-login. */
export const TOKEN_SCOPES = [
  "read:user",
  "read:organization",
  "write:repository",
  "write:issue",
  "write:organization",
  "read:notification",
  // Lets the app mark a mention as read in Door43 once it is opened.
  "write:notification",
] as const;

export const SCOPES_VERSION = 3;

export type GtSession = {
  host: string;
  username: string;
  token: string;
  avatarUrl?: string;
  /** Scopes requested when the token was minted (password sign-in). Token paste may omit this. */
  scopes?: string[];
  /** Bumps when TOKEN_SCOPES changes — stale sessions must re-auth. */
  scopesVersion?: number;
  teams?: DcsTeam[];
  isOwner?: boolean;
  canManage?: boolean;
  /** "oauth" when the session came from Door43's sign-in; its `token` is then a fixed seal, see door43Tokens.ts. */
  method?: "oauth";
};

export function sessionNeedsReauth(session: GtSession | undefined | null): boolean {
  if (!session) return false;
  if (session.scopesVersion !== SCOPES_VERSION) return true;
  if (!session.scopes?.length) return true;
  return TOKEN_SCOPES.some((scope) => !session.scopes!.includes(scope));
}

export function loadSession(): GtSession | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<GtSession>;
    if (!parsed.host || !parsed.username || !parsed.token) return undefined;
    return {
      host: parsed.host,
      username: parsed.username,
      token: parsed.token,
      avatarUrl: parsed.avatarUrl,
      scopes: Array.isArray(parsed.scopes) ? parsed.scopes.map(String) : undefined,
      scopesVersion: typeof parsed.scopesVersion === "number" ? parsed.scopesVersion : undefined,
      teams: Array.isArray(parsed.teams) ? (parsed.teams as DcsTeam[]) : undefined,
      isOwner: Boolean(parsed.isOwner),
      canManage: Boolean(parsed.canManage),
      method: parsed.method === "oauth" ? "oauth" : undefined,
    };
  } catch {
    return undefined;
  }
}

function storeSession(session: GtSession | undefined): void {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Writes `next` only if the stored session still has `next.token`. A read that finishes after the person signed out
 * (or another account signed in) must not bring the old session back or overwrite the new one.
 */
function storeSessionIfSame(next: GtSession): void {
  if (loadSession()?.token === next.token) storeSession(next);
}

/** Drops the session and its OAuth record. Not an explicit sign-out: see `signOut`. */
function clearStoredSession(): void {
  storeSession(undefined);
  clearOAuthRecord();
}

export function signOut(): void {
  clearStoredSession();
  try {
    localStorage.setItem(SIGNED_OUT_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** The login of the last account that signed in on this browser, even after signing out. */
export function lastUser(): string | null {
  try {
    return localStorage.getItem(LAST_USER_KEY);
  } catch {
    return null;
  }
}

/** True when the person signed out on purpose (until they sign in again). An expired session is not that. */
export function signedOutHere(): boolean {
  try {
    return localStorage.getItem(SIGNED_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

/** Remembers who signed in and forgets any earlier explicit sign-out. */
export function markEntered(login: string): void {
  try {
    localStorage.setItem(LAST_USER_KEY, login);
    localStorage.removeItem(SIGNED_OUT_KEY);
  } catch {
    /* ignore */
  }
}

/** Stores a Door43 sign-in: the record first, so a session never exists without the tokens that renew it. */
export function storeOAuthSession(session: GtSession, record: OAuthRecord): void {
  saveOAuthRecord(record);
  storeSession(session);
}

/**
 * Signs out only if the stored session is the one whose token failed (`seal`). A tab left open with an old token
 * must not wipe the session of someone who signed in afterwards. True when no session remains.
 */
export function clearSessionIfSeal(seal: string): boolean {
  const current = loadSession();
  if (current && current.token !== seal) return false;
  clearStoredSession();
  return true;
}

function buildSession(
  host: string,
  user: DcsUser,
  token: string,
  scopes: string[] | undefined,
): GtSession {
  return {
    host,
    username: user.login,
    token,
    avatarUrl: user.avatar_url,
    scopes,
    scopesVersion: SCOPES_VERSION,
  };
}

const DEVICE_KEY = "gt-dcs-device";

function newDeviceId(): string {
  const bytes = new Uint8Array(6);
  // getRandomValues, not randomUUID: the LAN dev server is plain http, where randomUUID does not exist.
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else bytes.forEach((_, i) => (bytes[i] = Math.floor(Math.random() * 256)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * This browser's name for itself in its Door43 token names, made once and kept. Letters and digits only: with a
 * hyphen, one device's prefix could match another's (`taller-ab-` and `taller-ab-cd-…`). Signing out keeps it, so
 * the next sign-in here still replaces this device's earlier token.
 */
export function deviceId(): string {
  try {
    const kept = localStorage.getItem(DEVICE_KEY);
    if (kept && /^[0-9a-z]{8,}$/.test(kept)) return kept;
    const made = newDeviceId();
    localStorage.setItem(DEVICE_KEY, made);
    return made;
  } catch {
    // No storage: this sign-in replaces no earlier token, and certainly no other device's.
    return newDeviceId();
  }
}

/**
 * The prefix of the tokens this device mints: before minting, the client deletes the user's tokens that start with
 * it. It used to be `tas` on every device, so signing in on a phone signed the same person out on their computer.
 * Not `tas-…` now: a device still on an older version deletes every `tas-` token when it signs in. A person's old
 * `tas-xxxxxx` token (at most one, as the old code kept one) is left alone, since it may still be a device's live one.
 */
export function tokenNamePrefix(): string {
  return `taller-${deviceId()}`;
}

/**
 * How many sessions of Taller one account may have open at once (Abel, 21 October): a person works on a computer and
 * a phone, and maybe a second computer. A fourth closes the one unused for longest. Signing in again in the same
 * browser replaces that browser's session and takes no other place; the `tas-…` session of the versions before counts.
 */
export const MAX_SESSIONS = 3;

export async function signInWithPassword(
  host: string,
  username: string,
  password: string,
): Promise<GtSession> {
  const config = dcsConfig(host);
  const scopes = [...TOKEN_SCOPES];
  const { token, user } = await mintToken(config, {
    username,
    password,
    tokenNamePrefix: tokenNamePrefix(),
    scopes,
    sessions: { prefixes: ["taller", "tas"], max: MAX_SESSIONS },
  });
  const session = buildSession(host, user, token, scopes);
  clearOAuthRecord();
  storeSession(session);
  markEntered(user.login);
  return session;
}

export async function signInWithToken(host: string, token: string): Promise<GtSession> {
  const config = dcsConfig(host);
  const user: DcsUser = await getAuthenticatedUser(config, token.trim());
  // Pasted tokens: we cannot verify scopes via API, so we stamp the current
  // version and require the user to ensure the token has the right scopes.
  const session = buildSession(host, user, token.trim(), [...TOKEN_SCOPES]);
  clearOAuthRecord();
  storeSession(session);
  markEntered(user.login);
  return session;
}

export async function refreshUser(session: GtSession): Promise<GtSession> {
  const user = await getAuthenticatedUser(dcsConfig(session.host), session.token);
  const next = {
    ...session,
    username: user.login,
    avatarUrl: user.avatar_url,
  };
  storeSessionIfSame(next);
  return next;
}

/** Load the caller's DCS teams and compute management flags for `pmOrg`. */
export async function enrichSessionRoles(
  session: GtSession,
  pmOrg: string,
  managerTeam = "managers",
): Promise<GtSession> {
  if (!pmOrg) {
    const next = { ...session, teams: [], isOwner: false, canManage: false };
    storeSessionIfSame(next);
    return next;
  }
  const teams = await getUserTeams(dcsConfig(session.host), session.token);
  const next: GtSession = {
    ...session,
    teams,
    isOwner: isOrgOwner(teams, pmOrg),
    canManage: canManageOrg(teams, pmOrg, managerTeam),
  };
  storeSessionIfSame(next);
  return next;
}
