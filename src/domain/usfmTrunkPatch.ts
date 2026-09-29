/**
 * Cerrar writes the trunk as a patch, not a rebuilt book: the verse merge
 * decides the slots, and only slot groups whose content changed inside the
 * portion are spliced into the trunk text. Everything else (header, poetry
 * and section markers, untouched verses, CRLF/LF) keeps the trunk bytes.
 */

import { listVerseSpans, normalizeVerseText, type RefRange, type VerseSpan } from "./usfmEdit";
import {
  mergeUsfmByVerse,
  verseSlotsOf,
  type UsfmVerseMergeOptions,
  type UsfmVerseMergeResult,
} from "./usfmVerseMerge";

type Range = { chapter: number; from: number; to: number };
type Slot = Range & { text: string };

export type UsfmTrunkPatchResult = UsfmVerseMergeResult & {
  /** Slot groups spliced into the trunk (empty when nothing changed). */
  patched: Range[];
};

type Edit = { start: number; end: number; text: string; seq: number };

const PARAGRAPH_MARKER = /^\s*\\(?:p|m|pi\d?|q\d?|qm\d?|nb|li\d?|pc|mi|b)\b/;

function eolOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function atLineStart(text: string, index: number): boolean {
  return index === 0 || text[index - 1] === "\n";
}

function overlaps(a: Range, b: Range): boolean {
  return a.chapter === b.chapter && a.from <= b.to && b.from <= a.to;
}

function spanRange(span: VerseSpan): Range {
  return { chapter: span.chapter, from: span.verse, to: span.verseTo };
}

function slotKey(slot: Slot): string {
  return `${slot.chapter}:${slot.from}-${slot.to}:${slot.text}`;
}

function sameSlots(a: Slot[], b: Slot[]): boolean {
  if (a.length !== b.length) return false;
  const keys = new Set(a.map(slotKey));
  return b.every((slot) => keys.has(slotKey(slot)));
}

/** End of the lines that carry verse text; trailing marker-only lines (`\p`, `\q1`, `\s1 …`) stay. */
function textEnd(usfm: string, span: VerseSpan): number {
  const lines = usfm.slice(span.start, span.end).split(/(?<=\n)/);
  let keep = lines.length;
  while (keep > 1 && !normalizeVerseText(lines[keep - 1]!)) keep--;
  return span.start + lines.slice(0, keep).join("").length;
}

function verseNumber(slot: Range): string {
  return slot.to > slot.from ? `${slot.from}-${slot.to}` : `${slot.from}`;
}

function synthesizedLine(slot: Slot): string {
  return slot.text ? `\\v ${verseNumber(slot)} ${slot.text}` : `\\v ${verseNumber(slot)}`;
}

/** The winning side's own line when it wrote this slot as exactly one line. */
function sideLine(sides: string[], slot: Slot): string | null {
  for (let i = sides.length - 1; i >= 0; i--) {
    const side = sides[i]!;
    const hits = listVerseSpans(side).filter((s) => overlaps(spanRange(s), slot));
    if (hits.length !== 1) continue;
    const span = hits[0]!;
    if (span.segment || span.verse !== slot.from || span.verseTo !== slot.to) continue;
    if (normalizeVerseText(span.rawBody) !== slot.text) continue;
    const body = side.slice(span.start, textEnd(side, span)).replace(/\r?\n$/, "");
    if (body.includes("\n")) return null;
    return body.replace(/[ \t\r]+$/, "");
  }
  return null;
}

/** Connected groups of intersecting ranges, per chapter. */
function groupRanges<T extends Range>(items: T[]): T[][] {
  const sorted = [...items].sort((a, b) => a.chapter - b.chapter || a.from - b.from);
  const groups: T[][] = [];
  let current: T[] = [];
  let chapter = -1;
  let maxTo = -1;
  for (const item of sorted) {
    if (current.length && (item.chapter !== chapter || item.from > maxTo)) {
      groups.push(current);
      current = [];
    }
    if (!current.length) {
      chapter = item.chapter;
      maxTo = item.to;
    }
    current.push(item);
    maxTo = Math.max(maxTo, item.to);
  }
  if (current.length) groups.push(current);
  return groups;
}

function chapterMarker(usfm: string, chapter: number): RegExpExecArray | null {
  return new RegExp(`\\\\c\\s+${chapter}(?!\\d)`).exec(usfm);
}

/** Insert lines into a chapter that has no verse spans (or does not exist yet). */
function chapterInsert(usfm: string, chapter: number, lines: string[], eol: string): { at: number; text: string } {
  const body = lines.join(eol) + eol;
  const marker = chapterMarker(usfm, chapter);
  if (marker) {
    const nl = usfm.indexOf("\n", marker.index);
    if (nl < 0) return { at: usfm.length, text: `${eol}\\p${eol}${body}` };
    let at = nl + 1;
    let paragraph = false;
    while (at < usfm.length) {
      const next = usfm.indexOf("\n", at);
      const line = usfm.slice(at, next < 0 ? usfm.length : next + 1);
      if (/\\c\s+\d/.test(line) || normalizeVerseText(line)) break;
      if (PARAGRAPH_MARKER.test(line)) paragraph = true;
      if (next < 0) {
        return { at: usfm.length, text: `${eol}${paragraph ? "" : `\\p${eol}`}${body}` };
      }
      at = next + 1;
    }
    return { at, text: `${paragraph ? "" : `\\p${eol}`}${body}` };
  }
  const block = `\\c ${chapter}${eol}\\p${eol}${body}`;
  const re = /\\c\s+(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(usfm)) !== null) {
    if (Number(m[1]) > chapter) {
      return { at: m.index, text: atLineStart(usfm, m.index) ? block : `${eol}${block}` };
    }
  }
  const lead = !usfm || usfm.endsWith("\n") ? "" : eol;
  return { at: usfm.length, text: `${lead}${block}` };
}

/**
 * Three-way verse merge (same rules as `mergeUsfmByVerse`), returned as the
 * trunk text with only changed slot groups replaced. When nothing in the
 * portion changed, `usfm === trunk` so the caller skips the write.
 */
export function patchTrunkByVerse(
  trunk: string,
  sides: string[],
  opts?: UsfmVerseMergeOptions,
): UsfmTrunkPatchResult {
  const merged = mergeUsfmByVerse(trunk, sides, opts);
  const scope: RefRange | null | undefined = opts?.scope;
  const eol = eolOf(trunk);
  const spans = listVerseSpans(trunk);
  const trunkSlots = verseSlotsOf(trunk);
  const mergedSlots = verseSlotsOf(merged.usfm);

  type Node = Range & { span?: VerseSpan; trunkSlot?: Slot; mergedSlot?: Slot };
  const nodes: Node[] = [
    ...spans.map((span) => ({ ...spanRange(span), span })),
    ...trunkSlots.map((slot) => ({ ...slot, trunkSlot: slot })),
    ...mergedSlots.map((slot) => ({ ...slot, mergedSlot: slot })),
  ];

  const edits: Edit[] = [];
  const pendingChapters = new Map<number, { lines: string[]; seq: number }>();
  const patched: Range[] = [];
  let seq = 0;

  for (const group of groupRanges(nodes)) {
    const chapter = group[0]!.chapter;
    const groupSpans = group.flatMap((n) => (n.span ? [n.span] : [])).sort((a, b) => a.start - b.start);
    const tSlots = group.flatMap((n) => (n.trunkSlot ? [n.trunkSlot] : []));
    const mSlots = group
      .flatMap((n) => (n.mergedSlot ? [n.mergedSlot] : []))
      .sort((a, b) => a.from - b.from);
    if (sameSlots(tSlots, mSlots)) continue;
    if (scope && !group.some((n) => overlaps(n, scope))) continue;
    const writeSlots = groupSpans.length ? mSlots : mSlots.filter((s) => s.text);
    if (!writeSlots.length) continue;

    const lines = writeSlots.map((slot) => sideLine(sides, slot) ?? synthesizedLine(slot));
    const from = Math.min(...group.map((n) => n.from));
    const to = Math.max(...group.map((n) => n.to));
    patched.push({ chapter, from, to });

    if (groupSpans.length) {
      const start = groupSpans[0]!.start;
      const end = textEnd(trunk, groupSpans[groupSpans.length - 1]!);
      const region = trunk.slice(start, end);
      const tail = /\n$/.test(region)
        ? eol
        : end >= trunk.length
          ? ""
          : (region.match(/[ \t]+$/)?.[0] ?? " ");
      edits.push({ start, end, text: lines.join(eol) + tail, seq: seq++ });
      continue;
    }

    const chapterSpans = spans.filter((s) => s.chapter === chapter);
    const before = chapterSpans.filter((s) => s.verseTo < from).pop();
    if (before) {
      const at = textEnd(trunk, before);
      const lead = atLineStart(trunk, at) ? "" : eol;
      edits.push({ start: at, end: at, text: lead + lines.join(eol) + eol, seq: seq++ });
      continue;
    }
    const after = chapterSpans.find((s) => s.verse > to);
    if (after) {
      edits.push({ start: after.start, end: after.start, text: lines.join(eol) + eol, seq: seq++ });
      continue;
    }
    const pending = pendingChapters.get(chapter);
    if (pending) pending.lines.push(...lines);
    else pendingChapters.set(chapter, { lines: [...lines], seq: seq++ });
  }

  for (const [chapter, { lines, seq: order }] of pendingChapters) {
    const { at, text } = chapterInsert(trunk, chapter, lines, eol);
    edits.push({ start: at, end: at, text, seq: order });
  }

  if (!edits.length) return { ...merged, usfm: trunk, patched };
  edits.sort((a, b) => a.start - b.start || a.seq - b.seq);
  let out = "";
  let cursor = 0;
  for (const edit of edits) {
    out += trunk.slice(cursor, edit.start) + edit.text;
    cursor = Math.max(cursor, edit.end);
  }
  out += trunk.slice(cursor);
  return { ...merged, usfm: out, patched };
}
