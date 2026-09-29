/**
 * Workspace language codes as Door43 stores them (`lc`, e.g. `es-419`).
 * Catalog comes from GET /api/v1/languages/langnames.json (or its snapshot).
 */

export type LanguageOption = {
  code: string;
  name: string;
  /** Extra search terms (English name, alts). */
  aliases?: string[];
  gateway?: boolean;
};

export type Door43LangRow = {
  lc?: unknown;
  ln?: unknown;
  ang?: unknown;
  alt?: unknown;
  gw?: unknown;
};

/** Display polish on Door43 names — not a catalog. */
const DISPLAY_NAME: Record<string, string> = {
  "es-419": "Español (América Latina)",
};

const SEARCH_ALIASES: Record<string, string[]> = {
  "es-419": ["español latinoamericano", "latin american spanish"],
};

const SHORT_CHIP: Record<string, string> = {
  "es-419": "Español",
  es: "Español",
  en: "Inglés",
  "pt-br": "Portugués",
  pt: "Portugués",
  fr: "Francés",
};

const BUNDLED_ASSET = "/data/door43-languages.json";

/** Door43 / workspace form: lowercase, trim. `es-419` stays `es-419`. */
export function normalizeLangCode(raw: string): string {
  return raw.trim().toLowerCase();
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function languageFromDoor43(row: Door43LangRow): LanguageOption | null {
  const code = normalizeLangCode(asString(row.lc));
  if (!code) return null;
  const ln = asString(row.ln);
  const ang = asString(row.ang);
  const name = DISPLAY_NAME[code] || ln || ang || code;
  const alt = Array.isArray(row.alt) ? row.alt.map(asString).filter(Boolean) : [];
  const aliases = [...new Set([ln, ang, ...alt, ...(SEARCH_ALIASES[code] ?? [])])]
    .filter((part) => part && part !== name);
  return {
    code,
    name,
    ...(aliases.length ? { aliases } : {}),
    ...(row.gw === true ? { gateway: true } : {}),
  };
}

export function languagesFromDoor43Payload(raw: unknown): LanguageOption[] {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { languages?: unknown }).languages)
      ? (raw as { languages: unknown[] }).languages
      : raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)
        ? (raw as { data: unknown[] }).data
        : [];
  const byCode = new Map<string, LanguageOption>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const option = languageFromDoor43(row as Door43LangRow);
    if (!option || byCode.has(option.code)) continue;
    byCode.set(option.code, option);
  }
  return [...byCode.values()];
}

export function findLanguage(code: string, catalog: LanguageOption[] = []): LanguageOption | undefined {
  const clean = normalizeLangCode(code);
  if (!clean) return undefined;
  return catalog.find((l) => l.code === clean);
}

export function languageDisplayName(code: string, catalog: LanguageOption[] = []): string {
  const clean = normalizeLangCode(code);
  return findLanguage(clean, catalog)?.name || DISPLAY_NAME[clean] || clean || code;
}

/** Compact header chip: short name when known, else display name. */
export function languageChipLabel(code: string, catalog: LanguageOption[] = []): string {
  const clean = normalizeLangCode(code);
  if (!clean) return "";
  return SHORT_CHIP[clean] || languageDisplayName(clean, catalog);
}

export function mergeLanguageOptions(
  catalog: LanguageOption[] = [],
  selected?: string,
): LanguageOption[] {
  const byCode = new Map<string, LanguageOption>();
  for (const row of catalog) {
    const code = normalizeLangCode(row.code);
    if (!code) continue;
    byCode.set(code, { ...row, code });
  }
  const selectedCode = selected ? normalizeLangCode(selected) : "";
  if (selectedCode && !byCode.has(selectedCode)) {
    byCode.set(selectedCode, {
      code: selectedCode,
      name: DISPLAY_NAME[selectedCode] || selectedCode,
    });
  }
  return [...byCode.values()].sort((a, b) => {
    if (a.code === "es-419") return -1;
    if (b.code === "es-419") return 1;
    if (a.gateway !== b.gateway) return a.gateway ? -1 : 1;
    return a.name.localeCompare(b.name, "es");
  });
}

/** Empty query: full catalog. Search: name, code, or aliases. */
export function filterLanguageOptions(
  options: LanguageOption[],
  query: string,
): LanguageOption[] {
  const q = query.trim();
  if (!q) return options;
  return options.filter((row) => languageMatchesQuery(row, q));
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function languageMatchesQuery(lang: LanguageOption, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  const hay = [lang.name, lang.code, ...(lang.aliases ?? [])].map(fold);
  return hay.some((part) => part.includes(q));
}

export { BUNDLED_ASSET as DOOR43_LANGUAGES_ASSET };
