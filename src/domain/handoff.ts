import type { HandoffUnit } from "./types";

/**
 * «Unidad de traspaso»: what moves together from one phase to the next. It is a whole chapter unless whoever prepares
 * the book splits a long one (Psalm 119) into stretches of portions; each stretch then moves on by itself. Inside a
 * phase the work is still shared out by portion. Only split chapters are stored: a chapter with no entry is one unit.
 */

export const chapterUnitId = (chapter: number): string => `chapter:${chapter}`;

export function normalizeHandoffUnits(raw: unknown): HandoffUnit[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: HandoffUnit[] = [];
  const seen = new Set<string>();
  const used = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const item = row as Partial<HandoffUnit>;
    const id = String(item.id ?? "").trim();
    // A portion belongs to one unit only: the first one that names it keeps it.
    const portionIds = Array.isArray(item.portionIds) ? [...new Set(item.portionIds.map(String).filter((p) => p && !used.has(p)))] : [];
    if (!id || seen.has(id) || !portionIds.length) continue;
    seen.add(id);
    portionIds.forEach((p) => used.add(p));
    const label = String(item.label ?? "").trim();
    out.push({ id, portionIds, ...(label ? { label } : {}) });
  }
  return out.length ? out : undefined;
}

/** The unit a portion moves with. */
export function unitIdOfPortion(units: HandoffUnit[] | undefined, portionId: string, chapter: number): string {
  return units?.find((unit) => unit.portionIds.includes(portionId))?.id ?? chapterUnitId(chapter);
}

/** The unit of a piece of work, from its portions (they all belong to one unit by construction). */
export function unitIdOfWork(units: HandoffUnit[] | undefined, portionIds: string[], chapter: number): string {
  return portionIds.length ? unitIdOfPortion(units, portionIds[0]!, chapter) : chapterUnitId(chapter);
}

export type ChapterUnit = { id: string; label: string; portionIds: string[]; part?: number; parts?: number };

/** How one chapter's portions (in book order) are grouped into units. */
export function unitsOfChapter(units: HandoffUnit[] | undefined, chapter: number, portionIds: string[]): ChapterUnit[] {
  const groups = new Map<string, string[]>();
  for (const portionId of portionIds) {
    const id = unitIdOfPortion(units, portionId, chapter);
    groups.set(id, [...(groups.get(id) ?? []), portionId]);
  }
  const list = [...groups];
  return list.map(([id, ids], index) => ({
    id,
    portionIds: ids,
    label: units?.find((unit) => unit.id === id)?.label || (list.length > 1 ? `Capítulo ${chapter} · parte ${index + 1}` : `Capítulo ${chapter}`),
    ...(list.length > 1 ? { part: index + 1, parts: list.length } : {}),
  }));
}

/**
 * Split a chapter after the given portions (indexes into `portionIds`, in book order), or join it back with no cuts.
 * Returns the project's whole list of units, with this chapter's replaced.
 */
export function splitChapter(units: HandoffUnit[] | undefined, chapter: number, portionIds: string[], cutAfter: number[]): HandoffUnit[] {
  const inChapter = new Set(portionIds);
  const others = (units ?? []).filter((unit) => !unit.portionIds.some((p) => inChapter.has(p)));
  const cuts = [...new Set(cutAfter)].filter((i) => i >= 0 && i < portionIds.length - 1).sort((a, b) => a - b);
  if (!cuts.length) return others;
  const parts: string[][] = [];
  let start = 0;
  for (const cut of [...cuts, portionIds.length - 1]) {
    parts.push(portionIds.slice(start, cut + 1));
    start = cut + 1;
  }
  return [...others, ...parts.map((ids, index) => ({ id: `${chapterUnitId(chapter)}:${index + 1}`, label: `Capítulo ${chapter} · parte ${index + 1}`, portionIds: ids }))];
}

/** Where a chapter is cut today (indexes into `portionIds`): the last portion of each unit but the last. */
export function cutsOfChapter(units: HandoffUnit[] | undefined, chapter: number, portionIds: string[]): number[] {
  const cuts: number[] = [];
  for (let i = 0; i < portionIds.length - 1; i++) {
    if (unitIdOfPortion(units, portionIds[i]!, chapter) !== unitIdOfPortion(units, portionIds[i + 1]!, chapter)) cuts.push(i);
  }
  return cuts;
}

/** The most verses a chapter moves on with in one piece, when neither the project nor its process says. */
export const DEFAULT_MAX_CHAPTER_VERSES = 40;

/**
 * Where to cut a chapter so that no stretch has more than `max` verses, as evenly as its portions allow: the fewest
 * stretches that fit, each filled up to an even share before the next starts. Cuts fall between portions (the indexes
 * after which to cut); a portion longer than `max` stays whole, alone in its stretch.
 */
export function suggestedCuts(verseCounts: number[], max: number): number[] {
  const total = verseCounts.reduce((sum, n) => sum + n, 0);
  if (max < 1 || total <= max || verseCounts.length < 2) return [];
  const share = total / Math.ceil(total / max);
  const cuts: number[] = [];
  let run = 0;
  verseCounts.forEach((count, index) => {
    if (index === verseCounts.length - 1) return;
    run += count;
    const next = verseCounts[index + 1]!;
    // Close the stretch when the next portion would take it past the limit, or further from the even share.
    if (run + next > max || Math.abs(run - share) <= Math.abs(run + next - share)) {
      cuts.push(index);
      run = 0;
    }
  });
  return cuts;
}

export type LongChapter = { chapter: number; verses: number; portionIds: string[]; cuts: number[] };

/** The chapters still in one piece that have more verses than `max` and can be split: what to suggest splitting. */
export function longChapters(portions: { id: string; ref: string; chapter: number; verses: number[] }[], units: HandoffUnit[] | undefined, max: number): LongChapter[] {
  const byChapter = new Map<number, typeof portions>();
  for (const portion of portions) byChapter.set(portion.chapter, [...(byChapter.get(portion.chapter) ?? []), portion]);
  const out: LongChapter[] = [];
  for (const [chapter, own] of [...byChapter].sort((a, b) => a[0] - b[0])) {
    const ids = own.map((portion) => portion.id || portion.ref);
    const verses = own.reduce((sum, portion) => sum + portion.verses.length, 0);
    if (verses <= max || own.length < 2 || cutsOfChapter(units, chapter, ids).length) continue;
    const cuts = suggestedCuts(own.map((portion) => portion.verses.length), max);
    if (cuts.length) out.push({ chapter, verses, portionIds: ids, cuts });
  }
  return out;
}
