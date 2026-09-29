export type HelpsDraftCacheEntry = {
  texts: Record<string, string>;
  secondary?: Record<string, string>;
  savedAt: number;
  branch?: string;
};

function cacheKey(pmOrg: string, issueNumber: number): string {
  return `tas-helps-draft:${pmOrg.trim().toLowerCase()}:${issueNumber}`;
}

export function loadHelpsDraftCache(
  pmOrg: string,
  issueNumber: number,
): HelpsDraftCacheEntry | null {
  if (!pmOrg || !issueNumber || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(cacheKey(pmOrg, issueNumber));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HelpsDraftCacheEntry>;
    if (!parsed.texts || typeof parsed.texts !== "object") return null;
    const texts: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.texts)) texts[k] = String(v ?? "");
    const secondary: Record<string, string> = {};
    if (parsed.secondary && typeof parsed.secondary === "object") {
      for (const [k, v] of Object.entries(parsed.secondary)) {
        secondary[k] = String(v ?? "");
      }
    }
    return {
      texts,
      secondary: Object.keys(secondary).length ? secondary : undefined,
      savedAt: Number(parsed.savedAt) || 0,
      branch: String(parsed.branch ?? "").trim() || undefined,
    };
  } catch {
    return null;
  }
}

export function saveHelpsDraftCache(
  pmOrg: string,
  issueNumber: number,
  entry: HelpsDraftCacheEntry,
): void {
  if (!pmOrg || !issueNumber || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(cacheKey(pmOrg, issueNumber), JSON.stringify(entry));
  } catch {
    /* quota / private mode */
  }
}
