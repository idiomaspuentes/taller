/**
 * Verse/portion-aware USFM merge: slot each verse into book order.
 * Used when assembling user-branch drafts onto the book base (and after
 * isomorphic-git reports a textual conflict on the same file).
 *
 * A slot is `(chapter, from, to)`: `\v K` → `(c, K, K)`, a bridge
 * `\v N-M` → `(c, N, M)` occupying every number N…M as one unit.
 */

import { listVerseSpans, normalizeVerseText, type RefRange } from "./usfmEdit";

export type VerseConflictCandidate = {
  source: "tronco" | "entrante";
  /** Index into `sides` for `entrante`; -1 for `tronco`. */
  sideIndex: number;
  from: number;
  to: number;
  text: string;
};

export type VerseConflict = {
  chapter: number;
  from: number;
  to: number;
  kind: "texto" | "estructura";
  kept: "ultimo" | "tronco";
  candidates: VerseConflictCandidate[];
};

export type VerseMergeWarning = {
  chapter: number;
  verse: number;
  kind: "segmento" | "duplicado" | "rango-invalido";
};

export type UsfmVerseMergeResult = {
  usfm: string;
  conflicts: VerseConflict[];
  warnings: VerseMergeWarning[];
};

export type UsfmVerseMergeOptions = {
  /** Common ancestor of trunk and sides; `""` means "known, empty". */
  ancestor?: string | null;
  /** Only side slots intersecting this range count. */
  scope?: RefRange | null;
};

type Slot = { chapter: number; from: number; to: number; text: string };
/** `side` -1 = trunk, 0…n = index into `sides`. */
type SideSlot = Slot & { side: number; live: boolean };

function bookHeader(usfm: string): string {
  const idx = usfm.search(/\\c\s+\d+/);
  const head = (idx >= 0 ? usfm.slice(0, idx) : usfm).trimEnd();
  if (/\\id\b/i.test(head)) return `${head}\n`;
  return "";
}

function intersects(a: { chapter: number; from: number; to: number }, b: typeof a): boolean {
  return a.chapter === b.chapter && a.from <= b.to && b.from <= a.to;
}

function sameSlot(a: Slot, b: Slot): boolean {
  return a.chapter === b.chapter && a.from === b.from && a.to === b.to && a.text === b.text;
}

/** One slot per occupied number: `10a`/`10b` joined, later duplicates win. */
function slotsOf(usfm: string, warnings?: VerseMergeWarning[]): Slot[] {
  const slots: (Slot & { segment?: boolean })[] = [];
  for (const span of listVerseSpans(usfm)) {
    const text = normalizeVerseText(span.rawBody);
    const slot = { chapter: span.chapter, from: span.verse, to: span.verseTo, text };
    if (span.rangeInvalid) {
      warnings?.push({ chapter: span.chapter, verse: span.verse, kind: "rango-invalido" });
    }
    const prev = slots.find((s) => intersects(s, slot));
    if (prev && span.segment && prev.from === slot.from && prev.to === slot.to && prev.segment) {
      prev.text = [prev.text, text].filter(Boolean).join(" ");
      warnings?.push({ chapter: span.chapter, verse: span.verse, kind: "segmento" });
      continue;
    }
    if (prev) {
      warnings?.push({ chapter: span.chapter, verse: span.verse, kind: "duplicado" });
      for (let i = slots.length - 1; i >= 0; i--) {
        if (intersects(slots[i]!, slot)) slots.splice(i, 1);
      }
    }
    slots.push({ ...slot, segment: Boolean(span.segment) });
  }
  return slots.map(({ chapter, from, to, text }) => ({ chapter, from, to, text }));
}

/** Slots as the merge sees them (segments joined, later duplicates win, NFC text). */
export function verseSlotsOf(usfm: string): Slot[] {
  return slotsOf(usfm);
}

function bySlotOrder(a: { chapter: number; from: number }, b: typeof a): number {
  return a.chapter - b.chapter || a.from - b.from;
}

/** Connected components of filled candidates that intersect, per chapter. */
function clusters(candidates: SideSlot[]): SideSlot[][] {
  const sorted = [...candidates].sort(bySlotOrder);
  const groups: SideSlot[][] = [];
  let current: SideSlot[] = [];
  let maxTo = -1;
  let chapter = -1;
  for (const slot of sorted) {
    if (current.length && (slot.chapter !== chapter || slot.from > maxTo)) {
      groups.push(current);
      current = [];
    }
    if (!current.length) {
      chapter = slot.chapter;
      maxTo = slot.to;
    }
    current.push(slot);
    maxTo = Math.max(maxTo, slot.to);
  }
  if (current.length) groups.push(current);
  return groups;
}

function candidateOf(slot: SideSlot): VerseConflictCandidate {
  return {
    source: slot.side < 0 ? "tronco" : "entrante",
    sideIndex: slot.side,
    from: slot.from,
    to: slot.to,
    text: slot.text,
  };
}

function resolveCluster(group: SideSlot[], conflicts: VerseConflict[]): Slot[] {
  const trunkSlots = group.filter((s) => s.side < 0);
  const live = group.filter((s) => s.live);
  if (!live.length) return trunkSlots;
  const liveSides = new Set(live.map((s) => s.side));
  if (liveSides.size === 1) return live;

  const chapter = group[0]!.chapter;
  const structural = live.some((a) =>
    live.some((b) => a.side !== b.side && intersects(a, b) && (a.from !== b.from || a.to !== b.to)),
  );
  if (structural) {
    conflicts.push({
      chapter,
      from: Math.min(...group.map((s) => s.from)),
      to: Math.max(...group.map((s) => s.to)),
      kind: "estructura",
      kept: "tronco",
      candidates: [...trunkSlots, ...live.filter((s) => s.side >= 0)].map(candidateOf),
    });
    return trunkSlots;
  }

  const byRange = new Map<string, SideSlot[]>();
  for (const slot of live) {
    const key = `${slot.from}-${slot.to}`;
    byRange.set(key, [...(byRange.get(key) ?? []), slot]);
  }
  const placed: Slot[] = [];
  for (const rows of byRange.values()) {
    const ordered = [...rows].sort((a, b) => a.side - b.side);
    const winner = ordered[ordered.length - 1]!;
    if (new Set(ordered.map((s) => s.text)).size > 1) {
      conflicts.push({
        chapter,
        from: winner.from,
        to: winner.to,
        kind: "texto",
        kept: "ultimo",
        candidates: ordered.map(candidateOf),
      });
    }
    placed.push(winner);
  }
  return placed;
}

function dedupeWarnings(warnings: VerseMergeWarning[]): VerseMergeWarning[] {
  const seen = new Set<string>();
  return warnings.filter((w) => {
    const key = `${w.chapter}:${w.verse}:${w.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Merge `sides` onto `base` (the trunk). Empty slots lose to filled ones.
 * Same range, different texts: last side wins and a `texto` conflict is
 * recorded. Bridge vs split (or overlapping bridges) with text on both
 * sides: the trunk keeps its form and an `estructura` conflict is recorded.
 * A bridge is never split. Every number appears exactly once per chapter.
 *
 * With `ancestor`, a slot competes only if it differs from the ancestor
 * slot (same range and text). With `scope`, side slots that do not
 * intersect the portion are ignored.
 */
export function mergeUsfmByVerse(
  base: string,
  sides: string[],
  opts?: UsfmVerseMergeOptions,
): UsfmVerseMergeResult {
  const warnings: VerseMergeWarning[] = [];
  const conflicts: VerseConflict[] = [];
  const scope = opts?.scope;
  const trunk = slotsOf(base, warnings);
  const incoming = sides.map((side) =>
    slotsOf(side, warnings).filter(
      (s) => !scope || intersects(s, { chapter: scope.chapter, from: scope.from, to: scope.to }),
    ),
  );
  const ancestor = typeof opts?.ancestor === "string" ? slotsOf(opts.ancestor) : null;
  const isLive = (slot: Slot) => !ancestor || !ancestor.some((a) => sameSlot(a, slot));

  const candidates: SideSlot[] = [
    ...trunk.filter((s) => s.text).map((s) => ({ ...s, side: -1, live: isLive(s) })),
    ...incoming.flatMap((slots, side) =>
      slots.filter((s) => s.text).map((s) => ({ ...s, side, live: isLive(s) })),
    ),
  ];

  const placed: Slot[] = clusters(candidates).flatMap((group) => resolveCluster(group, conflicts));
  for (const slot of trunk) {
    if (!placed.some((p) => intersects(p, slot))) placed.push(slot);
  }
  for (const slot of [...trunk, ...incoming.flat()]) {
    for (let v = slot.from; v <= slot.to; v++) {
      const hole = { chapter: slot.chapter, from: v, to: v, text: "" };
      if (!placed.some((p) => intersects(p, hole))) placed.push(hole);
    }
  }
  placed.sort(bySlotOrder);

  const header =
    bookHeader(base) ||
    sides.map(bookHeader).find((h) => h) ||
    "\\id BOOK\n\\usfm 3.0\n\\ide UTF-8\n";
  const lines: string[] = [header.trimEnd().normalize("NFC")];
  let chapter = 0;
  for (const slot of placed) {
    if (slot.chapter !== chapter) {
      chapter = slot.chapter;
      lines.push(`\\c ${chapter}`, "\\p");
    }
    const num = slot.to > slot.from ? `${slot.from}-${slot.to}` : `${slot.from}`;
    lines.push(slot.text ? `\\v ${num} ${slot.text}` : `\\v ${num}`);
  }
  return {
    usfm: `${lines.join("\n")}\n`,
    conflicts: conflicts.sort(bySlotOrder),
    warnings: dedupeWarnings(warnings),
  };
}
