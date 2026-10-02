import { tNow } from "../i18n/messages";
import { isSessionExpiredError, SESSION_EXPIRED_MESSAGE } from "./sessionExpiry";

type ApiError = { name?: unknown; status?: unknown; body?: unknown; message?: unknown };

/**
 * What to tell a person when something failed. A refusal from Door43 arrives as «DCS request failed: GET … -> 403»,
 * which says nothing to whoever is translating; the common ones are put in their words here. Anything else keeps its
 * own message, which the code that raised it already wrote for people.
 */
export function explainError(err: unknown): string {
  if (isSessionExpiredError(err)) return SESSION_EXPIRED_MESSAGE;
  const e = (err && typeof err === "object" ? err : {}) as ApiError;
  if (e.name === "DcsApiError" && typeof e.status === "number") {
    const said = typeof (e.body as { message?: unknown } | undefined)?.message === "string" ? String((e.body as { message: string }).message) : "";
    if (/not activated/i.test(said)) return tNow("err.notActivated");
    if (e.status === 403) return tNow("err.forbidden");
    if (e.status === 429) return tNow("err.busy");
    if (e.status >= 500) return tNow("err.server");
  }
  // The browser's own words when the request never got an answer.
  if (err instanceof TypeError && /fetch|network/i.test(err.message)) return tNow("err.network");
  return err instanceof Error ? err.message : String(err);
}
