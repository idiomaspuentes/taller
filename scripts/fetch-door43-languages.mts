/**
 * Snapshot Door43 langnames for the offline picker fallback.
 *
 * Source (documented, not invented):
 *   GET {host}/api/v1/languages/langnames.json
 *   docs/lms-platform/dcs-api/by-tag/languages.json
 *
 * Run: npx tsx scripts/fetch-door43-languages.mts
 */
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = process.env.DCS_HOST?.replace(/\/$/, "") || "https://git.door43.org";
const URL = `${HOST}/api/v1/languages/langnames.json`;
const outPath = resolve(dirname(fileURLToPath(import.meta.url)), "../public/data/door43-languages.json");

type LangnamesRow = {
  lc?: unknown;
  ln?: unknown;
  ang?: unknown;
  alt?: unknown;
  gw?: unknown;
};

export type Door43LanguageSnapshot = {
  source: string;
  fetchedAt: string;
  languages: Array<{
    lc: string;
    ln: string;
    ang?: string;
    alt?: string[];
    gw?: boolean;
  }>;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const res = await fetch(URL);
if (!res.ok) {
  throw new Error(`Door43 langnames failed: ${res.status} ${URL}`);
}
const raw = (await res.json()) as unknown;
if (!Array.isArray(raw)) {
  throw new Error("langnames.json: expected an array");
}

const languages: Door43LanguageSnapshot["languages"] = [];
const seen = new Set<string>();
for (const row of raw as LangnamesRow[]) {
  const lc = asString(row.lc).toLowerCase();
  if (!lc || seen.has(lc)) continue;
  seen.add(lc);
  const ln = asString(row.ln) || asString(row.ang) || lc;
  const ang = asString(row.ang);
  const alt = Array.isArray(row.alt)
    ? row.alt.map(asString).filter(Boolean).slice(0, 8)
    : [];
  languages.push({
    lc,
    ln,
    ...(ang && ang !== ln ? { ang } : {}),
    ...(alt.length ? { alt } : {}),
    ...(row.gw === true ? { gw: true } : {}),
  });
}

languages.sort((a, b) => a.lc.localeCompare(b.lc, "en"));

const snapshot: Door43LanguageSnapshot = {
  source: URL,
  fetchedAt: new Date().toISOString(),
  languages,
};

await writeFile(outPath, `${JSON.stringify(snapshot)}\n`, "utf8");
const gw = languages.filter((l) => l.gw).length;
console.log(`Wrote ${languages.length} languages (${gw} gateway) → ${outPath}`);
console.log(`Source ${URL}`);
