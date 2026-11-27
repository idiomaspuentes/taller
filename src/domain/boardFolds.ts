import type { BoardSection } from "./cardSituation";
import { scopeKey } from "./scope";

/**
 * Which groups of «Mis tareas» the person opened or closed by hand, kept in this device. Held only in the screen, a
 * closed group opened again each time the person came back to it (team report, 26 November 2026, issue #81).
 *
 * Kept with no end date: it is a choice the person made, not a copy of data that goes stale. A group closed by hand
 * stays closed when a card arrives in it: its title already says how many cards it holds. «Mostrar el resto» is not
 * kept: it answers one look at a long list.
 *
 * `localStorage`, not the device store of the kept lists: a few bytes, read at once so the first frame is already
 * folded as the person left it.
 */
export type Folds = Map<BoardSection, boolean>;

const PREFIX = "taller-mis-tareas-grupos:";
const SECTIONS: readonly BoardSection[] = ["mine", "waiting", "take", "more"];

type Where = { host: string; username: string; pmOrg: string };

/** One choice per person, server, organization and space. */
export const boardFoldsKey = (where: Where): string =>
  `${PREFIX}${scopeKey()}${[where.host, where.username.toLowerCase(), where.pmOrg].join("|")}`;

/** What was kept, keeping only groups the board still has and true/false values: anything else counts as untouched. */
export function foldsFrom(raw: string | null): Folds {
  const folds: Folds = new Map();
  if (!raw) return folds;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return folds;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return folds;
  for (const section of SECTIONS) {
    const open = (parsed as Record<string, unknown>)[section];
    if (typeof open === "boolean") folds.set(section, open);
  }
  return folds;
}

export const foldsText = (folds: Folds): string => JSON.stringify(Object.fromEntries(folds));

type Store = Pick<Storage, "getItem" | "setItem">;

const deviceStorage = (): Store | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Some browsers throw on reading `localStorage` itself when the site's storage is blocked.
    return null;
  }
};

/** The groups as the person left them; nothing (every group as the board decides) without a key or storage. */
export function keptFolds(key: string | undefined, storage: Store | null = deviceStorage()): Folds {
  if (!key || !storage) return new Map();
  try {
    return foldsFrom(storage.getItem(key));
  } catch {
    return new Map();
  }
}

export function keepFolds(key: string | undefined, folds: Folds, storage: Store | null = deviceStorage()): void {
  if (!key || !storage) return;
  try {
    storage.setItem(key, foldsText(folds));
  } catch {
    // A full or blocked storage: the groups fold as today, for this visit only.
  }
}
