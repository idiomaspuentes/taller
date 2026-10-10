import {
  findKeptDraft,
  keepDraft,
  parseKeptEntry,
  type DraftLaunch,
  type DraftLookup,
  type KeptEntry,
  type KeptKind,
} from "./draftCache";

export type HelpsDraftCacheEntry = KeptEntry & {
  texts: Record<string, string>;
  secondary?: Record<string, string>;
};

function textsOf(raw: unknown): Record<string, string> {
  const texts: Record<string, string> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) texts[k] = String(v ?? "");
  }
  return texts;
}

const HELPS_DRAFTS: KeptKind<HelpsDraftCacheEntry> = {
  name: "tas-helps-draft",
  parse(raw) {
    const from = (raw ?? {}) as { texts?: unknown; secondary?: unknown };
    if (!from.texts || typeof from.texts !== "object") return null;
    const secondary = textsOf(from.secondary);
    return {
      ...parseKeptEntry(raw),
      texts: textsOf(from.texts),
      secondary: Object.keys(secondary).length ? secondary : undefined,
    };
  },
  // Each text is kept under the name of its row or its article, and is only put back in the one with that name.
  fits: () => true,
  hasText: (entry) => [...Object.values(entry.texts), ...Object.values(entry.secondary ?? {})].some((text) => text.trim()),
};

/** The draft kept for a launch of the helps editor (see `DraftPlace`). */
export function loadHelpsDraftCache(launch: DraftLaunch): DraftLookup<HelpsDraftCacheEntry> {
  return findKeptDraft(HELPS_DRAFTS, launch);
}

export function saveHelpsDraftCache(launch: DraftLaunch, entry: Omit<HelpsDraftCacheEntry, "place">): boolean {
  return keepDraft(HELPS_DRAFTS, launch, entry);
}
