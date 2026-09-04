import {
  getAuthenticatedUser,
  signInWithPassword as mintToken,
  type DcsUser,
} from "@ip-lms/dcs-client";
import { dcsConfig } from "./config";

const STORAGE_KEY = "gt-dcs-session";
const TOKEN_SCOPES = ["read:user", "read:organization", "write:repository"];

export type GtSession = {
  host: string;
  username: string;
  token: string;
  avatarUrl?: string;
};

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

export async function signInWithPassword(
  host: string,
  username: string,
  password: string,
): Promise<GtSession> {
  const config = dcsConfig(host);
  const { token, user } = await mintToken(config, {
    username,
    password,
    tokenNamePrefix: "gateway-tasks",
    scopes: TOKEN_SCOPES,
  });
  const session: GtSession = {
    host,
    username: user.login,
    token,
    avatarUrl: user.avatar_url,
  };
  storeSession(session);
  return session;
}

export async function signInWithToken(host: string, token: string): Promise<GtSession> {
  const config = dcsConfig(host);
  const user: DcsUser = await getAuthenticatedUser(config, token.trim());
  const session: GtSession = {
    host,
    username: user.login,
    token: token.trim(),
    avatarUrl: user.avatar_url,
  };
  storeSession(session);
  return session;
}

export async function refreshUser(session: GtSession): Promise<GtSession> {
  const user = await getAuthenticatedUser(dcsConfig(session.host), session.token);
  const next = { ...session, username: user.login, avatarUrl: user.avatar_url };
  storeSession(next);
  return next;
}
