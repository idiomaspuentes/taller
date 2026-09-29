/**
 * Session expiry: a 401 from DCS on a request signed with the current session
 * token means the token is no longer valid. Every `@ip-lms/dcs-client` call
 * goes through global `fetch`, so a fetch guard sees them all without touching
 * the client package. Tokens never leave this module (not logged, not in
 * messages, not in technical details).
 */

export const SESSION_EXPIRED_MESSAGE = "Tu sesión caducó. Vuelve a iniciar sesión.";

export class SessionExpiredError extends Error {
  constructor(
    /** Method + path without query string, e.g. `GET /repos/issues/search`. */
    public readonly technicalDetail = "",
  ) {
    super(SESSION_EXPIRED_MESSAGE);
    this.name = "SessionExpiredError";
  }
}

const DCS_401_MESSAGE = /DCS request failed:.*->\s*401\b/;

/** True for our own error, a `DcsApiError` with status 401, or a wrapped cause of either. */
export function isSessionExpiredError(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== "object" || depth > 4) return false;
  if (err instanceof SessionExpiredError) return true;
  const e = err as { name?: unknown; status?: unknown; message?: unknown; cause?: unknown };
  if (e.name === "SessionExpiredError") return true;
  if (e.name === "DcsApiError" && e.status === 401) return true;
  if (typeof e.message === "string" && DCS_401_MESSAGE.test(e.message)) return true;
  return isSessionExpiredError(e.cause, depth + 1);
}

/** Spanish sentence for session expiry; otherwise the error's own message. */
export function userErrorMessage(err: unknown): string {
  if (isSessionExpiredError(err)) return SESSION_EXPIRED_MESSAGE;
  return err instanceof Error ? err.message : String(err);
}

type HeaderSource = Headers | Record<string, string> | [string, string][] | undefined;

function readAuthorization(headers: HeaderSource): string | undefined {
  if (!headers) return undefined;
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get("Authorization") ?? undefined;
  }
  if (Array.isArray(headers)) {
    const hit = headers.find(([k]) => k.toLowerCase() === "authorization");
    return hit?.[1];
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "authorization") return v;
  }
  return undefined;
}

/** The DCS `token …` credential on a request, or undefined (Basic auth and anonymous don't count). */
export function requestSessionToken(
  input: RequestInfo | URL,
  init?: RequestInit,
): string | undefined {
  const fromInit = readAuthorization(init?.headers as HeaderSource);
  const fromRequest =
    typeof Request !== "undefined" && input instanceof Request
      ? input.headers.get("Authorization") ?? undefined
      : undefined;
  const auth = (fromInit ?? fromRequest ?? "").trim();
  const match = /^token\s+(\S+)$/i.exec(auth);
  return match ? match[1] : undefined;
}

export type ExpiryDecision = "pass" | "expire" | "already-expired";

/**
 * Pure decision for one response. `expire` only when the request carried the
 * token of the signed-in session; a 401 while pasting a new token at sign-in
 * is a sign-in error, not an expiry.
 */
export function decideExpiry(params: {
  status: number;
  requestToken: string | undefined;
  sessionToken: string | undefined;
  expiredTokens: ReadonlySet<string>;
}): ExpiryDecision {
  const { status, requestToken, sessionToken, expiredTokens } = params;
  if (!requestToken) return "pass";
  if (expiredTokens.has(requestToken)) return "already-expired";
  if (status !== 401) return "pass";
  return sessionToken && requestToken === sessionToken ? "expire" : "pass";
}

/** `GET /repos/issues/search` — path only, query string dropped. */
export function technicalDetailFor(input: RequestInfo | URL, init?: RequestInit): string {
  const method = (
    init?.method ??
    (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")
  ).toUpperCase();
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : (input as Request).url;
  let path = raw;
  try {
    path = new URL(raw).pathname.replace(/^\/api\/v1/, "");
  } catch {
    path = raw.split("?")[0];
  }
  return `${method} ${path} -> 401`;
}

let uninstall: (() => void) | null = null;

/**
 * Wraps global `fetch`. On a 401 for the current session token, calls
 * `onExpired` once and rejects with `SessionExpiredError`. Later requests with
 * that token are rejected without hitting the network.
 */
export function installSessionExpiryGuard(opts: {
  getSessionToken: () => string | undefined;
  onExpired: () => void;
}): () => void {
  uninstall?.();
  const original = globalThis.fetch;
  const expiredTokens = new Set<string>();

  const guarded: typeof fetch = async (input, init) => {
    const requestToken = requestSessionToken(input, init);
    if (requestToken && expiredTokens.has(requestToken)) {
      throw new SessionExpiredError(technicalDetailFor(input, init));
    }
    const response = await original(input, init);
    const decision = decideExpiry({
      status: response.status,
      requestToken,
      sessionToken: opts.getSessionToken(),
      expiredTokens,
    });
    if (decision === "pass") return response;
    if (decision === "expire" && requestToken) {
      expiredTokens.add(requestToken);
      opts.onExpired();
    }
    throw new SessionExpiredError(technicalDetailFor(input, init));
  };

  globalThis.fetch = guarded;
  const restore = () => {
    if (globalThis.fetch === guarded) globalThis.fetch = original;
    if (uninstall === restore) uninstall = null;
  };
  uninstall = restore;
  return restore;
}
