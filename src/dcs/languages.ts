import { PRODUCTION_HOST } from "./config";
import {
  DOOR43_LANGUAGES_ASSET,
  languagesFromDoor43Payload,
  type LanguageOption,
} from "../domain/languages";

/**
 * Documented DCS languages list (by-tag/languages.json):
 * GET {host}/api/v1/languages/langnames.json
 * Public in practice (200 without a token). No User-Agent header so the
 * browser GET stays simple (CORS).
 */
export const LANGNAMES_PATH = "/api/v1/languages/langnames.json";

const SESSION_KEY = "gt-door43-languages-v1";

let memory: LanguageOption[] | null = null;
let inflight: Promise<LanguageOption[]> | null = null;

export function langnamesUrl(host: string): string {
  return `${host.replace(/\/$/, "")}${LANGNAMES_PATH}`;
}

function readSessionCache(): LanguageOption[] | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const list = languagesFromDoor43Payload(JSON.parse(raw));
    return list.length ? list : null;
  } catch {
    return null;
  }
}

function writeSessionCache(list: LanguageOption[]): void {
  try {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        languages: list.map((row) => ({
          lc: row.code,
          ln: row.name,
          alt: row.aliases,
          gw: row.gateway || undefined,
        })),
      }),
    );
  } catch {
    /* quota */
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function fetchLive(host: string): Promise<LanguageOption[]> {
  const list = languagesFromDoor43Payload(await fetchJson(langnamesUrl(host)));
  if (!list.length) throw new Error("langnames vacío");
  return list;
}

async function fetchBundled(): Promise<LanguageOption[]> {
  const list = languagesFromDoor43Payload(await fetchJson(DOOR43_LANGUAGES_ASSET));
  if (!list.length) throw new Error("snapshot vacío");
  return list;
}

/**
 * Door43 first; bundled snapshot only if the live list fails (offline, CORS, 5xx).
 * Cached in memory + sessionStorage — one fetch per tab, not per keystroke.
 */
export function loadDoor43Languages(host: string = PRODUCTION_HOST): Promise<LanguageOption[]> {
  if (memory) return Promise.resolve(memory);
  const cached = readSessionCache();
  if (cached) {
    memory = cached;
    return Promise.resolve(cached);
  }
  if (inflight) return inflight;
  inflight = fetchLive(host)
    .catch(() => fetchBundled())
    .then((list) => {
      memory = list;
      writeSessionCache(list);
      console.info(`[gt] lenguas Door43: ${list.length}`);
      return list;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
