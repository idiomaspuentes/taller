/**
 * Session expiry: a 401 from DCS on a request signed with the current session
 * token means the token is no longer valid. Every `@ip-lms/dcs-client` call
 * goes through global `fetch`, so a fetch guard sees them all without touching
 * the client package. Tokens never leave this module (not logged, not in
 * messages, not in technical details).
 */

import { tNow } from "../i18n/messages";
import { isDoor43Url } from "./door43Gate";
import { ensureFresh, grantOf, recordFor, renewAccessToken, type OAuthRecord, type RenewDeps } from "./door43Tokens";

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

/**
 * Door43 answered 401 and the token could not be renewed because Door43 could not be reached (or answered something
 * that is not an answer). The session is still good: this is not a session expiry, and nobody is signed out.
 */
export class Door43UnreachableError extends Error {
  constructor(
    /** Method + path without query string, e.g. `GET /repos/issues/search`. */
    public readonly technicalDetail = "",
  ) {
    super(tNow("signIn.offlineRetry"));
    this.name = "Door43UnreachableError";
  }
}

const DCS_401_MESSAGE = /DCS request failed:.*->\s*401\b/;

/** True for our own error, a `DcsApiError` with status 401, or a wrapped cause of either. */
export function isSessionExpiredError(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== "object" || depth > 4) return false;
  if (err instanceof Door43UnreachableError) return false;
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

function readHeader(headers: HeaderSource, name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  if (Array.isArray(headers)) {
    const hit = headers.find(([k]) => k.toLowerCase() === name);
    return hit?.[1];
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) return v;
  }
  return undefined;
}

const readAuthorization = (headers: HeaderSource): string | undefined => readHeader(headers, "authorization");

/** A header of the request as `fetch` would send it: `init.headers` replaces the `Request`'s own. */
function headerOf(input: RequestInfo | URL, init: RequestInit | undefined, name: string): string | undefined {
  const fromInit = readHeader(init?.headers as HeaderSource, name);
  if (fromInit !== undefined) return fromInit;
  return typeof Request !== "undefined" && input instanceof Request ? input.headers.get(name) ?? undefined : undefined;
}

/** Whether two hosts are the same server (origin); unparseable counts as different. */
function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
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
 * is a sign-in error, not an expiry. And only Door43 can say a Door43 token is
 * no good: the push Worker answers 401 when it cannot ask Door43, which must
 * not sign anyone out.
 */
export function decideExpiry(params: {
  status: number;
  requestToken: string | undefined;
  sessionToken: string | undefined;
  expiredTokens: ReadonlySet<string>;
  /** Whether the request went to Door43 (see `isDoor43Url`). */
  fromDoor43: boolean;
}): ExpiryDecision {
  const { status, requestToken, sessionToken, expiredTokens, fromDoor43 } = params;
  if (!requestToken) return "pass";
  if (expiredTokens.has(requestToken)) return "already-expired";
  if (status !== 401 || !fromDoor43) return "pass";
  return sessionToken && requestToken === sessionToken ? "expire" : "pass";
}

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;

/** `GET /repos/issues/search` — path only, query string dropped. */
export function technicalDetailFor(input: RequestInfo | URL, init?: RequestInit): string {
  const method = (
    init?.method ??
    (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")
  ).toUpperCase();
  const raw = urlOf(input);
  let path = raw;
  try {
    path = new URL(raw).pathname.replace(/^\/api\/v1/, "");
  } catch {
    path = raw.split("?")[0];
  }
  return `${method} ${path} -> 401`;
}

type ExpiryHandler = (seal: string) => void;
const expiryHandlers = new Set<ExpiryHandler>();
/** Expiries that happened before anyone listened (the guard is up before the first render). */
let unheard: string[] = [];

/** Tells the app a session ended. Kept until someone listens, so the first requests of a page can't lose it. */
export function notifySessionExpired(seal: string): void {
  if (expiryHandlers.size === 0) {
    unheard.push(seal);
    return;
  }
  for (const handler of [...expiryHandlers]) handler(seal);
}

/** Listens for expiries; whatever came before the first listener is delivered now, once. */
export function onSessionExpired(handler: ExpiryHandler): () => void {
  expiryHandlers.add(handler);
  const waiting = unheard;
  unheard = [];
  for (const seal of waiting) handler(seal);
  return () => void expiryHandlers.delete(handler);
}

let uninstall: (() => void) | null = null;

/** The request's destination as an absolute URL, or null if it cannot be told. */
function absoluteUrlOf(input: RequestInfo | URL): string | null {
  try {
    if (typeof Request !== "undefined" && input instanceof Request) return input.url;
    return new URL(String(input), typeof location !== "undefined" ? location.href : undefined).href;
  } catch {
    return null;
  }
}

const isRequest = (input: RequestInfo | URL): input is Request => typeof Request !== "undefined" && input instanceof Request;

/**
 * What it takes to send one request again with another token. A `Request` is cloned up front (its body can be read
 * once), and every send takes a fresh copy; the header changes where the caller put it (`init.headers` wins over the
 * `Request`'s own, as in `fetch`). Null when the request cannot be copied: it then goes the way it always did.
 */
function resendable(input: RequestInfo | URL, init: RequestInit | undefined): ((token: string) => [RequestInfo | URL, RequestInit | undefined]) | null {
  const header = (token: string) => `token ${token}`;
  // A copy that is never sent, kept to make the ones that are. Throws if the body was already read.
  const pristine = isRequest(input) ? input.clone() : null;
  if (readAuthorization(init?.headers as HeaderSource) !== undefined) {
    return (token) => {
      const headers = new Headers(init!.headers as HeadersInit);
      headers.set("Authorization", header(token));
      return [pristine ? pristine.clone() : input, { ...init, headers }];
    };
  }
  // The token is in the Request's own headers. If `init` replaces the headers wholesale, what really goes out is not
  // what we read, so we leave the request alone.
  if (!pristine || init?.headers !== undefined) return null;
  return (token) => {
    const copy = pristine.clone();
    const headers = new Headers(copy.headers);
    headers.set("Authorization", header(token));
    return [new Request(copy, { headers }), init];
  };
}

const isStream = (body: unknown): boolean => typeof ReadableStream !== "undefined" && body instanceof ReadableStream;

/**
 * Wraps global `fetch`. A request signed with the token of an OAuth sign-in goes out with the current access token
 * (renewed first if it is about to expire), and after a 401 it is renewed and sent once more; only a second 401, or a
 * renewal Door43 refuses for good, ends the session. For any other 401 on the current session token, calls `onExpired`
 * once and rejects with `SessionExpiredError`. Later requests with an expired token are rejected without hitting the
 * network.
 */
export function installSessionExpiryGuard(opts: {
  getSessionToken: () => string | undefined;
  /** Receives the token of the request that failed (the "seal"), so a listener can tell whose session ended. */
  onExpired: (seal: string) => void;
  /** How OAuth tokens are renewed; only tests pass it. */
  oauth?: Partial<RenewDeps>;
}): () => void {
  uninstall?.();
  const original = globalThis.fetch;
  const expiredTokens = new Set<string>();
  const announced = new Set<string>();

  /** The session ended: remember its tokens, tell the app once per session, and fail the request. */
  const caducar = (record: OAuthRecord, tokens: string[], input: RequestInfo | URL, init: RequestInit | undefined): never => {
    for (const t of [...tokens, record.seal, record.accessToken]) expiredTokens.add(t);
    if (!announced.has(record.seal)) {
      announced.add(record.seal);
      opts.onExpired(record.seal);
    }
    throw new SessionExpiredError(technicalDetailFor(input, init));
  };

  /** A request signed with an OAuth session token: its current token, renewed on need, and one more try after a 401. */
  const withOAuth = async (
    requestToken: string,
    record: OAuthRecord,
    resend: (token: string) => [RequestInfo | URL, RequestInit | undefined],
    url: string,
    input: RequestInfo | URL,
    init: RequestInit | undefined,
  ): Promise<Response> => {
    // The renewals only ever answer with a record of this request's own server.
    const deps: Partial<RenewDeps> = { ...opts.oauth, expectHost: record.host };
    const ofThisServer = (r: OAuthRecord) => sameOrigin(r.host, record.host);
    let current = record;
    const fresh = await ensureFresh(current, deps);
    if (fresh.kind === "definitive" || fresh.kind === "gone") return caducar(current, [requestToken], input, init);
    if (fresh.kind === "ok") {
      if (!ofThisServer(fresh.record)) return caducar(current, [requestToken], input, init);
      current = fresh.record;
    }
    // transient: it goes with what there is, and Door43 says whether that was enough.

    const res = await original(...resend(current.accessToken));
    if (res.status !== 401 || !isDoor43Url(url) || isStream(init?.body)) return res;

    try {
      await res.body?.cancel();
    } catch {
      /* already read or locked: nothing to free */
    }
    const renewed = await renewAccessToken(current.accessToken, deps);
    if (renewed.kind === "transient") throw new Door43UnreachableError(technicalDetailFor(input, init));
    if (renewed.kind !== "ok" || !ofThisServer(renewed.record)) return caducar(current, [requestToken], input, init);

    const again = await original(...resend(renewed.record.accessToken));
    if (again.status === 401) return caducar(renewed.record, [requestToken, current.accessToken], input, init);
    return again;
  };

  const guarded: typeof fetch = async (input, init) => {
    const requestToken = requestSessionToken(input, init);
    if (requestToken && expiredTokens.has(requestToken)) {
      throw new SessionExpiredError(technicalDetailFor(input, init));
    }
    const url = requestToken ? absoluteUrlOf(input) : null;
    // The server whose record may serve the request: Door43 itself, or, for the push Worker, the Door43 it declares in
    // `x-door43-host` (the Worker asks that Door43 who the token belongs to, so it needs the current token, not the seal).
    // Without the header, or for another server, a request to a Worker goes out as it is.
    const serverUrl = url ? (isDoor43Url(url) ? url : headerOf(input, init, "x-door43-host")?.trim()) : undefined;
    const record = requestToken && serverUrl ? recordFor(requestToken, serverUrl, opts.oauth?.store) : null;
    if (requestToken && url && record) {
      let resend: ReturnType<typeof resendable> = null;
      try {
        resend = resendable(input, init);
      } catch {
        /* a Request whose body was already read cannot be copied */
      }
      if (resend) return withOAuth(requestToken, record, resend, url, input, init);
    }
    const response = await original(input, init);
    // An OAuth token no stored record answers for: its person is no longer this browser's (another tab signed in as
    // someone else, or out). Door43 refusing it ends that session; tokens that are not JWTs (passwords, pasted) keep
    // the rules below.
    if (response.status === 401 && requestToken && !record && url && isDoor43Url(url) && grantOf(requestToken) !== null) {
      expiredTokens.add(requestToken);
      if (!announced.has(requestToken)) {
        announced.add(requestToken);
        opts.onExpired(requestToken);
      }
      throw new SessionExpiredError(technicalDetailFor(input, init));
    }
    const decision = decideExpiry({
      status: response.status,
      requestToken,
      sessionToken: opts.getSessionToken(),
      expiredTokens,
      fromDoor43: isDoor43Url(urlOf(input)),
    });
    if (decision === "pass") return response;
    if (decision === "expire" && requestToken) {
      expiredTokens.add(requestToken);
      opts.onExpired(requestToken);
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
