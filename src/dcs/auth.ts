import {
  getAuthenticatedUser,
  getUserTeams,
  signInWithPassword as mintToken,
  type DcsTeam,
  type DcsUser,
} from "@ip-lms/dcs-client";
import { dcsConfig } from "./config";
import { canManageOrg, isOrgOwner } from "../domain/roles";

const STORAGE_KEY = "gt-dcs-session";
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

export function signOut(): void {
  storeSession(undefined);
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
    tokenNamePrefix: "tas",
    scopes,
  });
  const session = buildSession(host, user, token, scopes);
  storeSession(session);
  return session;
}

export async function signInWithToken(host: string, token: string): Promise<GtSession> {
  const config = dcsConfig(host);
  const user: DcsUser = await getAuthenticatedUser(config, token.trim());
  // Pasted tokens: we cannot verify scopes via API, so we stamp the current
  // version and require the user to ensure the token has the right scopes.
  const session = buildSession(host, user, token.trim(), [...TOKEN_SCOPES]);
  storeSession(session);
  return session;
}

export async function refreshUser(session: GtSession): Promise<GtSession> {
  const user = await getAuthenticatedUser(dcsConfig(session.host), session.token);
  const next = {
    ...session,
    username: user.login,
    avatarUrl: user.avatar_url,
  };
  storeSession(next);
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
    storeSession(next);
    return next;
  }
  const teams = await getUserTeams(dcsConfig(session.host), session.token);
  const next: GtSession = {
    ...session,
    teams,
    isOwner: isOrgOwner(teams, pmOrg),
    canManage: canManageOrg(teams, pmOrg, managerTeam),
  };
  storeSession(next);
  return next;
}
