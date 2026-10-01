import { PRODUCTION_HOST, QA_HOST } from "@ip-lms/dcs-client";

/**
 * Which Door43 server the app talks to is not a choice for regular people: it is the production one. People who
 * test open the app with `?server=qa` (or `?server=production` to go back); the address is cleaned afterwards and
 * the device remembers it, so the server choice shows only on devices that asked for it.
 */
const KEY = "taller-server";

export function parseServerParam(search: string): "qa" | "production" | null {
  const value = new URLSearchParams(search).get("server")?.toLowerCase();
  return value === "qa" ? "qa" : value === "production" || value === "prod" ? "production" : null;
}

type Store = Pick<Storage, "getItem" | "setItem">;

function safe(store?: Store): Store | undefined {
  try {
    return store ?? localStorage;
  } catch {
    return undefined;
  }
}

/** The server asked for on THIS load of the page, if any. Read once, before the address is cleaned. */
let forced: string | null = null;

export function readServerFromUrl(search: string, store?: Store): string | null {
  const choice = parseServerParam(search);
  if (!choice) return null;
  forced = choice === "qa" ? QA_HOST : PRODUCTION_HOST;
  try {
    safe(store)?.setItem(KEY, choice);
  } catch {
    /* blocked storage: it applies to this visit only */
  }
  return forced;
}

/** Called once when the app starts: reads `?server=` and removes it from the address bar. */
export function applyServerFromUrl(): void {
  if (typeof location === "undefined") return;
  if (!readServerFromUrl(location.search)) return;
  const params = new URLSearchParams(location.search);
  params.delete("server");
  const rest = params.toString();
  history.replaceState(null, "", `${location.pathname}${rest ? `?${rest}` : ""}${location.hash}`);
}

/** The host forced by `?server=` on this load, or undefined. */
export function forcedHost(): string | undefined {
  return forced ?? undefined;
}

/** Show the server choice only to people who opted in (this device asked for it) or to developers. */
export function serverChoiceVisible(isProduction: boolean, dev: boolean, store?: Store): boolean {
  if (dev || !isProduction) return true;
  try {
    const asked = safe(store)?.getItem(KEY);
    return asked !== null && asked !== undefined;
  } catch {
    return false;
  }
}
