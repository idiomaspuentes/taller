/**
 * Self-test for DCS session expiry (401 → Spanish message + sign-in).
 * Run: npx tsx scripts/verify-session-expiry.mts
 * Mocked fetch only; no network, no Door43 writes.
 */
import { DcsApiError, request } from "@ip-lms/dcs-client";
import {
  SESSION_EXPIRED_MESSAGE,
  SessionExpiredError,
  decideExpiry,
  installSessionExpiryGuard,
  isSessionExpiredError,
  requestSessionToken,
  technicalDetailFor,
  userErrorMessage,
} from "../src/dcs/sessionExpiry.ts";
import { BootstrapError, explainRepoFileError } from "../src/dcs/repoFile.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const TOKEN = "abc123secret";
const FORBIDDEN = [/DCS request failed/, /\/repos\//, /401/, new RegExp(TOKEN)];
function assertWorkerSafe(text: string, label: string) {
  for (const re of FORBIDDEN) assert(!re.test(text), `${label}: «${text}» matches ${re}`);
}

// --- pure mapping ---
const raw401 = new DcsApiError("DCS request failed: GET /repos/issues/search -> 401", 401);
assert(isSessionExpiredError(raw401), "DcsApiError 401 is expiry");
assert(!isSessionExpiredError(new DcsApiError("DCS request failed: GET /x -> 403", 403)), "403 is not expiry");
assert(!isSessionExpiredError(new DcsApiError("DCS request failed: GET /x -> 404", 404)), "404 is not expiry");
assert(isSessionExpiredError(new Error("DCS request failed: GET pulls/3.diff -> 401")), "plain 401 string");
assert(isSessionExpiredError(new SessionExpiredError("GET /user -> 401")), "own error");
assert(
  isSessionExpiredError(new BootstrapError("Sin permiso", "repo", 401, raw401)),
  "wrapped cause",
);
assert(!isSessionExpiredError(null) && !isSessionExpiredError("401"), "non-errors");
assert(userErrorMessage(raw401) === SESSION_EXPIRED_MESSAGE, "userErrorMessage 401");
assert(userErrorMessage(new Error("otro")) === "otro", "userErrorMessage passthrough");
assertWorkerSafe(userErrorMessage(raw401), "userErrorMessage");

const explained = explainRepoFileError(
  new BootstrapError("Sin permiso para acceder a o/r.", "repo", 401, raw401),
  { owner: "o", repo: "r", filepath: "57-TIT.usfm" },
);
assert(explained === SESSION_EXPIRED_MESSAGE, `explainRepoFileError: ${explained}`);
assert(
  explainRepoFileError(raw401, { owner: "o", repo: "r", filepath: "f" }) === SESSION_EXPIRED_MESSAGE,
  "explainRepoFileError raw",
);

// --- token extraction ---
assert(requestSessionToken("u", { headers: { Authorization: `token ${TOKEN}` } }) === TOKEN, "token header");
assert(requestSessionToken("u", { headers: new Headers({ authorization: `token ${TOKEN}` }) }) === TOKEN, "Headers");
assert(requestSessionToken("u", { headers: { Authorization: "Basic dXNlcjpwYXNz" } }) === undefined, "Basic ignored");
assert(requestSessionToken("u") === undefined, "anonymous");

// --- decision ---
const none = new Set<string>();
assert(decideExpiry({ status: 401, requestToken: TOKEN, sessionToken: TOKEN, expiredTokens: none }) === "expire", "expire");
assert(decideExpiry({ status: 401, requestToken: "other", sessionToken: TOKEN, expiredTokens: none }) === "pass", "sign-in paste 401");
assert(decideExpiry({ status: 401, requestToken: TOKEN, sessionToken: undefined, expiredTokens: none }) === "pass", "no session");
assert(decideExpiry({ status: 401, requestToken: undefined, sessionToken: TOKEN, expiredTokens: none }) === "pass", "basic");
assert(decideExpiry({ status: 403, requestToken: TOKEN, sessionToken: TOKEN, expiredTokens: none }) === "pass", "403");
assert(
  decideExpiry({ status: 401, requestToken: TOKEN, sessionToken: undefined, expiredTokens: new Set([TOKEN]) }) === "already-expired",
  "stale in-flight",
);

const detail = technicalDetailFor(
  `https://qa.door43.org/api/v1/repos/issues/search?access_token=${TOKEN}&q=x`,
  { method: "GET" },
);
assert(detail === "GET /repos/issues/search -> 401", `detail: ${detail}`);
assert(!detail.includes(TOKEN), "detail has no token");

// --- guard end-to-end through @ip-lms/dcs-client.request ---
let calls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  calls++;
  const auth = new Headers(init?.headers).get("Authorization") ?? "";
  const status = auth === `token ${TOKEN}` ? 401 : 200;
  return new Response(status === 200 ? "{}" : JSON.stringify({ message: "token is required" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;

let sessionToken: string | undefined = TOKEN;
let expiredCalls = 0;
const uninstall = installSessionExpiryGuard({
  getSessionToken: () => sessionToken,
  onExpired: () => {
    expiredCalls++;
    sessionToken = undefined;
  },
});
const config = { host: "https://qa.door43.org", userAgent: "verify" };

let caught: unknown;
try {
  await request(config, { path: "/repos/issues/search", token: TOKEN });
} catch (err) {
  caught = err;
}
assert(caught instanceof SessionExpiredError, `guard throws SessionExpiredError, got ${String(caught)}`);
assert((caught as Error).message === SESSION_EXPIRED_MESSAGE, "Spanish message");
assertWorkerSafe((caught as Error).message, "guard message");
assert(!(caught as SessionExpiredError).technicalDetail.includes(TOKEN), "technicalDetail has no token");
assert(expiredCalls === 1, "onExpired once");

const before = calls;
caught = undefined;
try {
  await request(config, { path: "/user", token: TOKEN });
} catch (err) {
  caught = err;
}
assert(caught instanceof SessionExpiredError, "stale token rejected");
assert(calls === before, "stale token short-circuits the network");
assert(expiredCalls === 1, "onExpired not repeated");

await request(config, { path: "/user", token: "fresh" });
await request(config, { path: "/version" });

// Sign-in with a bad pasted token (no active session) keeps the raw DcsApiError for SignIn to show.
uninstall();
sessionToken = undefined;
installSessionExpiryGuard({ getSessionToken: () => sessionToken, onExpired: () => expiredCalls++ });
caught = undefined;
try {
  await request(config, { path: "/user", token: TOKEN });
} catch (err) {
  caught = err;
}
assert(caught instanceof DcsApiError && caught.status === 401, "no-session 401 passes through");
assert(expiredCalls === 1, "no expiry without session");

globalThis.fetch = realFetch;
console.log("verify-session-expiry: OK");
