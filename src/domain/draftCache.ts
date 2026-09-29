export type DraftCacheEntry = {
  /** Keyed by slot: `"10"` or a bridge `"10-11"`. */
  verses: Record<string, string>;
  savedAt: number;
  branch?: string;
  filepath?: string;
};

const SLOT_KEY_RE = /^\d+(-\d+)?$/;

function cacheKey(pmOrg: string, issueNumber: number): string {
  return `tas-draft:${pmOrg.trim().toLowerCase()}:${issueNumber}`;
}

export function loadDraftCache(
  pmOrg: string,
  issueNumber: number,
): DraftCacheEntry | null {
  if (!pmOrg || !issueNumber || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(cacheKey(pmOrg, issueNumber));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DraftCacheEntry>;
    if (!parsed.verses || typeof parsed.verses !== "object") return null;
    const verses: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.verses)) {
      if (SLOT_KEY_RE.test(k)) verses[k] = String(v ?? "");
    }
    return {
      verses,
      savedAt: Number(parsed.savedAt) || 0,
      branch: String(parsed.branch ?? "").trim() || undefined,
      filepath: String(parsed.filepath ?? "").trim() || undefined,
    };
  } catch {
    return null;
  }
}

export function saveDraftCache(
  pmOrg: string,
  issueNumber: number,
  entry: DraftCacheEntry,
): void {
  if (!pmOrg || !issueNumber || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(cacheKey(pmOrg, issueNumber), JSON.stringify(entry));
  } catch {
    /* quota / private mode */
  }
}
