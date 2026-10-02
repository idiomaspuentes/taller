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
