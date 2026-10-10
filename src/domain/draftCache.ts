import { branchBelonging, isOwnedWorkBranch, type PortionBranchNameParams } from "./portionPr";
import { launchDraftSlot } from "./solverLab";
import type { SolverLaunchContext } from "./solverLaunch";
import { parseRefRange, portionRange, type RefRange } from "./usfmEdit";

/**
 * What a draft kept on this device was typed for: the server, the subtarea, the person, the text and the passage.
 * It is the name the draft is kept under, so the draft of one thing is never read as the draft of another, nor
 * written over by it.
 *
 * Drafts were kept under the organization and the number of the subtarea alone. Numbers repeat (a server replaced
 * by a copy of another, a new mock on the same address): opening Jonah 2:1–10 as subtarea #3 put the verses kept
 * for Jude 1:4–8, also #3, into Jonah, and saved them on the branch remembered for Jude.
 */
export type DraftPlace = {
  host: string;
  pmOrg: string;
  issueNumber: number;
  user: string;
  contentOrg: string;
  lang: string;
  resource: string;
  book: string;
  /** `2:1-10`; what the subtarea calls its work when that is not a passage (an article). */
  passage: string;
};

/** A launch of an editor, as far as the draft kept for it goes. */
export type DraftLaunch = {
  place: DraftPlace;
  /** What its work branch is named with: a draft from before drafts said what they were of is told by its branch. */
  work: PortionBranchNameParams;
  /** The verses of the passage, when it is one. */
  range: RefRange | null;
  /** The other branches this launch writes to (the team's draft, for a task that corrects it). */
  also?: string[];
};

export type KeptEntry = { savedAt: number; branch?: string; place?: DraftPlace };

/** A draft that is on this device and is not the one in the editor, under the name it can be discarded by. */
export type KeptDraft<E> = { key: string; entry: E };

export type DraftLookup<E> = {
  /** The draft of this launch. Its branch is one of the launch's own, or none. */
  own: E | null;
  /**
   * Drafts that may be of this subtarea and are not used: another passage of the same text under the same number
   * (a subtarea whose passage was changed, or the one that had its number before), and one from before that its
   * branch does not prove to be this one's. They are shown, for the person to keep what is theirs, never brought in.
   */
  aside: KeptDraft<E>[];
};

/** What each kind of draft tells the shared part about its entries. */
export type KeptKind<E extends KeptEntry> = {
  /** The word the drafts of this editor are kept under (`tas-draft`). */
  name: string;
  parse: (raw: unknown) => E | null;
  /** Whether a draft from before, of this subtarea by its branch, is of this passage by what it holds. */
  fits: (entry: E, launch: DraftLaunch) => boolean;
  hasText: (entry: E) => boolean;
};

function passageOf(ctx: SolverLaunchContext): string {
  const range = parseRefRange(ctx.ref);
  if (range) return `${range.chapter}:${range.from}-${range.to}`;
  return `${Math.max(0, Math.floor(Number(ctx.chapter)) || 0)}:${ctx.ref.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

/** A passage as it is shown: `2:1–10`, `2:5`, or what the work is called. */
export function passageLabel(passage: string): string {
  const range = /^(\d+):(\d+)-(\d+)$/.exec(passage);
  if (!range) return passage.replace(/^\d+:/, "");
  return range[2] === range[3] ? `${range[1]}:${range[2]}` : `${range[1]}:${range[2]}–${range[3]}`;
}

export function draftLaunch(
  ctx: SolverLaunchContext,
  host: string | undefined,
  work: PortionBranchNameParams,
  also: string[] = [],
): DraftLaunch {
  const slot = launchDraftSlot(ctx);
  return {
    place: {
      host: (host ?? "").trim().toLowerCase().replace(/\/+$/, ""),
      pmOrg: slot.pmOrg.trim().toLowerCase(),
      issueNumber: Math.floor(Number(slot.issueNumber)) || 0,
      user: work.username.trim().toLowerCase(),
      contentOrg: ctx.contentOrg.trim().toLowerCase(),
      lang: ctx.lang.trim().toLowerCase(),
      resource: ctx.resource.trim().toLowerCase(),
      book: (ctx.book || ctx.projectId || "").trim().toUpperCase(),
      passage: passageOf(ctx),
    },
    work,
    range: portionRange(ctx.ref, ctx.chapter),
    also,
  };
}

const PLACE_PARTS = ["host", "pmOrg", "issueNumber", "user", "contentOrg", "lang", "resource", "book", "passage"] as const;

function placeParts(place: DraftPlace): string[] {
  return PLACE_PARTS.map((part) => encodeURIComponent(String(place[part])));
}

function placeKey(name: string, place: DraftPlace): string {
  return `${name}-v2:${placeParts(place).join(":")}`;
}

/** What every passage of the same text under the same number, on the same server and by the same person, begins with. */
function passagesPrefix(name: string, place: DraftPlace): string {
  return `${name}-v2:${placeParts(place).slice(0, -1).join(":")}:`;
}

/** Where a draft was kept before drafts said what they were of. */
function legacyKey(name: string, place: DraftPlace): string {
  return `${name}:${place.pmOrg}:${place.issueNumber}`;
}

function parsePlace(raw: unknown): DraftPlace | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const from = raw as Record<string, unknown>;
  const text = (part: (typeof PLACE_PARTS)[number]) => String(from[part] ?? "");
  return {
    host: text("host"),
    pmOrg: text("pmOrg"),
    issueNumber: Number(from.issueNumber) || 0,
    user: text("user"),
    contentOrg: text("contentOrg"),
    lang: text("lang"),
    resource: text("resource"),
    book: text("book"),
    passage: text("passage"),
  };
}

/** What every kind of entry has: when it was kept, the branch it remembered and what it was typed for. */
export function parseKeptEntry(raw: unknown): KeptEntry {
  const from = (raw ?? {}) as Record<string, unknown>;
  return {
    savedAt: Number(from.savedAt) || 0,
    branch: String(from.branch ?? "").trim() || undefined,
    place: parsePlace(from.place),
  };
}

function storage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function read<E extends KeptEntry>(kind: KeptKind<E>, key: string): E | null {
  try {
    const raw = storage()?.getItem(key);
    return raw ? kind.parse(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/**
 * Whose a draft from before is. Nothing in it says what it was typed for but the branch it remembered, which
 * names the book, the task, the person and the number: with a branch of this subtarea, and holding this passage,
 * it is this subtarea's. With a branch of another book or of another person it is somebody else's, and is left
 * where it is for whoever it belongs to. Anything else could be either.
 */
function legacyVerdict<E extends KeptEntry>(kind: KeptKind<E>, entry: E, launch: DraftLaunch): "own" | "other" | "unsure" {
  const belonging = branchBelonging(entry.branch, launch.work, launch.also);
  if (belonging === "other") return "other";
  return belonging === "own" && kind.fits(entry, launch) ? "own" : "unsure";
}

export function findKeptDraft<E extends KeptEntry>(kind: KeptKind<E>, launch: DraftLaunch): DraftLookup<E> {
  const store = storage();
  const { place } = launch;
  if (!store || !place.pmOrg || !place.issueNumber) return { own: null, aside: [] };
  const ownKey = placeKey(kind.name, place);
  let own = read(kind, ownKey);
  if (own && (!own.place || placeKey(kind.name, own.place) !== ownKey)) own = null;
  const aside: KeptDraft<E>[] = [];
  const before = read(kind, legacyKey(kind.name, place));
  if (before) {
    const verdict = legacyVerdict(kind, before, launch);
    if (verdict === "own" && !own) own = before;
    if (verdict === "unsure" && kind.hasText(before)) aside.push({ key: legacyKey(kind.name, place), entry: before });
  }
  const prefix = passagesPrefix(kind.name, place);
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key || key === ownKey || !key.startsWith(prefix)) continue;
      const entry = read(kind, key);
      if (entry && kind.hasText(entry)) aside.push({ key, entry });
    }
  } catch {
    /* blocked storage */
  }
  aside.sort((a, b) => b.entry.savedAt - a.entry.savedAt);
  // A remembered branch is where the next save goes: only one of this subtarea's own is taken.
  if (own && own.branch && !isOwnedWorkBranch(own.branch, launch.work)) own = { ...own, branch: undefined };
  return { own, aside };
}

/** Returns whether it was kept (storage may be full, or blocked). */
export function keepDraft<E extends KeptEntry>(kind: KeptKind<E>, launch: DraftLaunch, entry: E): boolean {
  const store = storage();
  const { place } = launch;
  if (!store || !place.pmOrg || !place.issueNumber) return false;
  try {
    store.setItem(placeKey(kind.name, place), JSON.stringify({ ...entry, place }));
    // The draft from before that this one goes on from has its place taken.
    const before = read(kind, legacyKey(kind.name, place));
    if (before && legacyVerdict(kind, before, launch) === "own") store.removeItem(legacyKey(kind.name, place));
    return true;
  } catch {
    /* quota / private mode */
    return false;
  }
}

/** Removes a draft that was set aside, when the person says they do not need it. */
export function discardKeptDraft(key: string): void {
  if (!/^tas-(helps-)?draft(-v2)?:/.test(key)) return;
  try {
    storage()?.removeItem(key);
  } catch {
    /* blocked storage */
  }
}

export type DraftCacheEntry = KeptEntry & {
  /** Keyed by slot: `"10"` or a bridge `"10-11"`. */
  verses: Record<string, string>;
};

const SLOT_KEY_RE = /^\d+(-\d+)?$/;

/** The editor keeps a row for every verse of its passage, and no other (a bridge may reach past its ends). */
function holdsPassage(verses: Record<string, string>, range: RefRange | null): boolean {
  if (!range) return false;
  const rows = Object.keys(verses).map((key) => {
    const [from = 0, to = from] = key.split("-").map(Number);
    return { from, to };
  });
  if (rows.some((row) => row.to < range.from || row.from > range.to)) return false;
  for (let verse = range.from; verse <= range.to; verse++) {
    if (!rows.some((row) => row.from <= verse && verse <= row.to)) return false;
  }
  return true;
}

const SCRIPTURE_DRAFTS: KeptKind<DraftCacheEntry> = {
  name: "tas-draft",
  parse(raw) {
    const from = (raw ?? {}) as { verses?: unknown };
    if (!from.verses || typeof from.verses !== "object") return null;
    const verses: Record<string, string> = {};
    for (const [k, v] of Object.entries(from.verses)) {
      if (SLOT_KEY_RE.test(k)) verses[k] = String(v ?? "");
    }
    return { ...parseKeptEntry(raw), verses };
  },
  fits: (entry, launch) => holdsPassage(entry.verses, launch.range),
  hasText: (entry) => Object.values(entry.verses).some((text) => text.trim()),
};

export function loadDraftCache(launch: DraftLaunch): DraftLookup<DraftCacheEntry> {
  return findKeptDraft(SCRIPTURE_DRAFTS, launch);
}

export function saveDraftCache(launch: DraftLaunch, entry: Omit<DraftCacheEntry, "place">): boolean {
  return keepDraft(SCRIPTURE_DRAFTS, launch, entry);
}
