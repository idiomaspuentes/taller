import type { DcsClientConfig } from "./config.js";
import { resolvedUserAgent } from "./config.js";
import { DcsApiError } from "./errors.js";
import { request } from "./http.js";

export interface AuthorizeUrlParams {
  clientId: string;
  redirectUri: string;
  /** A random CSRF token the caller generates and later checks against the callback (API_DCS.md §3.1 step 2-3). */
  state: string;
}

/**
 * Step 2 of the OAuth2 flow (API_DCS.md §3.1) — this is a Gitea *web*
 * endpoint, not part of `/api/v1`, so it's built against the bare host.
 * The caller navigates the browser here; this function only builds the URL.
 */
export function buildAuthorizeUrl(config: DcsClientConfig, params: AuthorizeUrlParams): string {
  const url = new URL(`${config.host}/login/oauth/authorize`);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", params.state);
  return url.toString();
}

export interface ExchangeCodeParams {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Step 3 of the OAuth2 flow (API_DCS.md §3.1). **Do not call this from
 * a browser bundle** — it needs `clientSecret`, and API_DCS.md §3.1
 * flags that exposing the secret client-side is unresolved
 * (`Desconocido` pending validation of a public-client + PKCE flow, or
 * a small serverless exchange endpoint). This function exists so a
 * server-side caller (or, later, a PKCE-based rewrite) has a typed
 * implementation to call — it is intentionally not wired into any
 * browser-facing app in this codebase yet.
 */
export async function exchangeCodeForToken(
  config: DcsClientConfig,
  params: ExchangeCodeParams,
): Promise<OAuthTokenResponse> {
  const response = await fetch(`${config.host}/login/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": resolvedUserAgent(config),
    },
    body: JSON.stringify({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      grant_type: "authorization_code",
      code: params.code,
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    throw new DcsApiError(`OAuth2 code exchange failed -> ${response.status}`, response.status, body);
  }
  return (await response.json()) as OAuthTokenResponse;
}

export interface DcsUser {
  id: number;
  login: string;
  email?: string;
  /** A Gravatar/uploaded avatar URL DCS generates for every user, even one who never set a custom image — swagger's `User.avatar_url`. */
  avatar_url?: string;
}

/** API_DCS.md §3.3 — confirms a token is still valid and identifies the user holding it. */
export function getAuthenticatedUser(config: DcsClientConfig, token: string): Promise<DcsUser> {
  return request<DcsUser>(config, { path: "/user", token });
}

export interface CreateUserTokenParams {
  username: string;
  password: string;
  name: string;
  scopes: string[];
}

export interface DcsToken {
  id: number;
  name: string;
  /**
   * The actual secret token value. Named `sha1` on the wire (confirmed
   * against the live QA server and its bundled `swagger.v1.json`
   * `AccessToken` schema, 2026-09-03) — API_DCS.md §3.2 had documented
   * this as `token`, which doesn't exist in the response at all; that
   * mismatch made every password sign-in fail with a misleading
   * "DCS no devolvió el token recién creado" after actually succeeding
   * against DCS. Only ever present on the response to the creating call.
   */
  sha1?: string;
  scopes: string[];
}

/** Shared plumbing for the three Basic-Auth-only user-token calls (create/list/delete) — none of them can use a bearer token, since the whole point is minting/managing tokens before or without one. */
async function basicAuthRequest<T>(
  config: DcsClientConfig,
  username: string,
  password: string,
  path: string,
  init: { method?: "GET" | "POST" | "DELETE"; body?: unknown } = {},
): Promise<T> {
  const basic = encodeBasicAuth(username, password);
  const response = await fetch(`${config.host}/api/v1${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Basic ${basic}`,
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      "User-Agent": resolvedUserAgent(config),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    throw new DcsApiError(`DCS request failed: ${init.method ?? "GET"} ${path} -> ${response.status}`, response.status, body);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * The Basic-Auth token-creation flow (API_DCS.md §3.2). Used both for
 * internal team scripts (e.g. `publish-course-to-dcs.mjs`) and, via
 * `signInWithPassword` below, as the primary end-user login path
 * (ARQUITECTURA.md §4, updated 2026-09-03 — password login mints a
 * token through this same call rather than requiring the user to paste
 * one they created by hand).
 */
export function createUserToken(config: DcsClientConfig, params: CreateUserTokenParams): Promise<DcsToken> {
  return basicAuthRequest<DcsToken>(config, params.username, params.password, `/users/${encodeURIComponent(params.username)}/tokens`, {
    method: "POST",
    body: { name: params.name, scopes: params.scopes },
  });
}

/** API_DCS.md §3.2 — Basic-Auth counterpart to `GET /users/{username}/tokens`; each entry's `sha1` is never populated here (only on the response to the call that created it). Used by `signInWithPassword` to find this app's own previous token(s) before minting a new one. */
function listUserTokensBasicAuth(config: DcsClientConfig, username: string, password: string): Promise<DcsToken[]> {
  return basicAuthRequest<DcsToken[]>(config, username, password, `/users/${encodeURIComponent(username)}/tokens`);
}

/** Basic-Auth counterpart to `deleteUserToken` below — usable before a bearer token exists yet (i.e. from inside `signInWithPassword`, which only ever has the password). */
function deleteUserTokenBasicAuth(config: DcsClientConfig, username: string, password: string, tokenId: number): Promise<void> {
  return basicAuthRequest<void>(config, username, password, `/users/${encodeURIComponent(username)}/tokens/${tokenId}`, { method: "DELETE" });
}

export function deleteUserToken(config: DcsClientConfig, username: string, tokenId: number, token: string): Promise<void> {
  return request<void>(config, { method: "DELETE", path: `/users/${encodeURIComponent(username)}/tokens/${tokenId}`, token });
}

export interface PasswordSignInParams {
  username: string;
  password: string;
  /** Prefix for the minted token's name — a random suffix is appended so repeated sign-ins (a second device, a cleared browser) never collide with a token from a previous one. */
  tokenNamePrefix: string;
  scopes: string[];
}

export interface PasswordSignInResult {
  user: DcsUser;
  token: string;
}

/**
 * The primary login path (ARQUITECTURA.md §4): exchange a username +
 * password for a freshly minted, narrowly scoped personal access token
 * via `createUserToken`'s Basic-Auth call, then confirm it against
 * `GET /user` the same way the pasted-token path already does. The
 * password is used for this one request and never itself stored or
 * returned — every call downstream of sign-in talks to DCS with the
 * minted token, identical in shape to a token the user pasted in by
 * hand (still offered as a secondary option in both apps' sign-in UI).
 *
 * Before minting, deletes any of *this app's own* previous tokens for
 * the same user (name starting with `tokenNamePrefix + "-"`) — every
 * sign-in on any device otherwise leaves its old token behind forever,
 * since nothing else in this codebase ever revokes one. This keeps it
 * to one live token per user for this app, not one per login, without
 * touching tokens any other app or script created for this user.
 */
export async function signInWithPassword(config: DcsClientConfig, params: PasswordSignInParams): Promise<PasswordSignInResult> {
  let created: DcsToken;
  try {
    const existing = await listUserTokensBasicAuth(config, params.username, params.password);
    const stalePrefix = `${params.tokenNamePrefix}-`;
    for (const staleToken of existing.filter((t) => t.name.startsWith(stalePrefix))) {
      await deleteUserTokenBasicAuth(config, params.username, params.password, staleToken.id);
    }

    const suffix = Math.random().toString(36).slice(2, 8);
    created = await createUserToken(config, {
      username: params.username,
      password: params.password,
      name: `${stalePrefix}${suffix}`,
      scopes: params.scopes,
    });
  } catch (err) {
    if (err instanceof DcsApiError && err.status === 401) {
      throw new DcsApiError("Usuario o contraseña incorrectos.", 401);
    }
    throw err;
  }
  if (!created.sha1) {
    throw new DcsApiError("DCS no devolvió el token recién creado.", 500);
  }
  const user = await getAuthenticatedUser(config, created.sha1);
  return { user, token: created.sha1 };
}

function encodeBasicAuth(username: string, password: string): string {
  const raw = `${username}:${password}`;
  return typeof Buffer !== "undefined" ? Buffer.from(raw, "utf-8").toString("base64") : btoa(raw);
}
