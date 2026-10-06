import { parseUsfmToUsj, parseUsfmToUsjWithAlignments } from "@usfm-tools/usfm-readonly-react";
import type { AlignmentMap } from "@usfm-tools/types";
import {
  collectVerseTextsFromContent,
  splitUsjByChapter,
  type UsjDocument,
} from "@usfm-tools/usj-core";
import {
  draftSlots,
  extractVerseEdits,
  listVerseSpans,
  type RefRange,
  type VerseSlotEdit,
} from "./usfmEdit";

export type VerseTextMap = Record<number, string>;

/** `TIT 1:2`, `1:2`, or a bare verse number. */
export function verseFromSid(sid: string, chapter: number): number | null {
  const trimmed = sid.trim();
  const withChapter = trimmed.match(/(?:^|[A-Z0-9]{2,3}\s+)(\d+):(\d+)/i);
  if (withChapter) {
    if (Number(withChapter[1]) !== chapter) return null;
    const verse = Number(withChapter[2]);
    return verse > 0 ? verse : null;
  }
  const onlyVerse = trimmed.match(/:(\d+)\s*$/);
  if (onlyVerse) {
    const verse = Number(onlyVerse[1]);
    return verse > 0 ? verse : null;
  }
  return null;
}

function asUsjDocument(value: unknown): UsjDocument | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { type?: unknown; content?: unknown; version?: unknown };
  if (!Array.isArray(row.content)) return null;
  return {
    type: typeof row.type === "string" ? row.type : "USJ",
    version: typeof row.version === "string" ? row.version : "3.1",
    content: row.content,
  };
}

/** Parse USFM → USJ with alignment stripped. `null` if the library cannot parse. */
export function tryParseUsj(usfm: string): UsjDocument | null {
  if (!usfm.trim()) return null;
  try {
    return asUsjDocument(parseUsfmToUsj(usfm, { stripAlignment: true }));
  } catch {
    return null;
  }
}

/** Same parse, plus the `zaln-s` map used to bind TN/TWL quotes to ULT/UST tokens. */
export function tryParseUsjWithAlignments(
  usfm: string,
): { usj: UsjDocument; alignments: AlignmentMap } | null {
  if (!usfm.trim()) return null;
  try {
    const parsed = parseUsfmToUsjWithAlignments(usfm, { stripAlignment: true });
    if (!parsed) return null;
    const usj = asUsjDocument(parsed.usj);
    return usj ? { usj, alignments: parsed.alignments } : null;
  } catch {
    return null;
  }
}

const parsedSources = new Map<string, { usj: UsjDocument; alignments: AlignmentMap } | null>();

/**
 * A chapter of a source text with its alignment, parsed once however many parts of a screen read it (its verses,
 * the quotes of its notes, the glossary's decisions). What it gives is shared: it is to be read, never changed.
 */
export function parseSourceUsfm(usfm: string): { usj: UsjDocument; alignments: AlignmentMap } | null {
  const kept = parsedSources.get(usfm);
  if (kept !== undefined) return kept;
  const parsed = tryParseUsjWithAlignments(usfm);
  parsedSources.set(usfm, parsed);
  if (parsedSources.size > 8) parsedSources.delete(parsedSources.keys().next().value as string);
  return parsed;
}

export function verseTextsFromUsj(usj: UsjDocument, range: RefRange): VerseTextMap | null {
  try {
    const texts = collectVerseTextsFromContent(usj.content);
    const out: VerseTextMap = {};
    let hits = 0;
    for (const [sid, text] of Object.entries(texts)) {
      const verse = verseFromSid(sid, range.chapter);
      if (verse == null || verse < range.from || verse > range.to) continue;
      out[verse] = text;
      hits += 1;
    }
    return hits > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Prefer usfm-ast verse text; fall back to the regex slicer in `usfmEdit`.
 * Returns which path produced the map so the UI can fall back gracefully.
 */
export function extractDraftVerses(
  usfm: string,
  range: RefRange,
): {
  verses: VerseTextMap;
  /** Row structure from `draftSlots`; text from the AST map by `from` when present. */
  slots: VerseSlotEdit[];
  via: "ast" | "plain";
  usj: UsjDocument | null;
} {
  const plainSlots = draftSlots(usfm, range);
  const usj = tryParseUsj(usfm);
  if (usj) {
    const fromAst = verseTextsFromUsj(usj, range) ?? {};
    const segmented = new Set(
      listVerseSpans(usfm)
        .filter((s) => s.chapter === range.chapter && s.segment)
        .map((s) => s.verse),
    );
    // `\v 10a`/`\v 10b` share one AST key; keep the joined plain text.
    const slots = plainSlots.map((row) => ({
      ...row,
      text: segmented.has(row.from) ? row.text : (fromAst[row.from] ?? row.text),
    }));
    return { verses: fromAst, slots, via: "ast", usj };
  }
  const { spans } = extractVerseEdits(usfm, range);
  const verses: VerseTextMap = {};
  for (const span of spans) verses[span.verse] = span.text;
  return { verses, slots: plainSlots, via: "plain", usj: null };
}

function inRange(verse: number, range: RefRange): boolean {
  return verse >= range.from && verse <= range.to;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function verseNumberFromNode(row: Record<string, unknown>, chapter: number): number | null {
  if (typeof row.number === "number" && row.number > 0) return row.number;
  if (typeof row.number === "string") {
    const n = Number(row.number.split(/[-–—]/)[0]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (typeof row.sid === "string") return verseFromSid(row.sid, chapter);
  return null;
}

function nodeHasVerseContent(node: unknown): boolean {
  if (typeof node === "string") return Boolean(node.trim());
  if (!isRecord(node)) return false;
  if (node.type === "verse") return true;
  return Array.isArray(node.content) && node.content.some(nodeHasVerseContent);
}

function bookNodesFromSlices(slices: ReturnType<typeof splitUsjByChapter>): unknown[] {
  const intro = slices.find((s) => s.chapter === 0);
  if (!intro) return [];
  return intro.nodes.filter((node) => isRecord(node) && node.type === "book");
}

function filterUsjNodes(nodes: unknown[], range: RefRange): unknown[] {
  let verse = 0;
  const walk = (arr: unknown[]): unknown[] => {
    const kept: unknown[] = [];
    for (const node of arr) {
      if (typeof node === "string") {
        if (verse > 0 && inRange(verse, range)) kept.push(node);
        continue;
      }
      if (!isRecord(node)) continue;
      if (node.type === "chapter" || node.type === "book") {
        kept.push(node);
        continue;
      }
      if (node.type === "verse") {
        const num = verseNumberFromNode(node, range.chapter);
        if (num != null) verse = num;
        if (inRange(verse, range)) kept.push(node);
        continue;
      }
      if (Array.isArray(node.content)) {
        const inner = walk(node.content);
        if (inner.length) kept.push({ ...node, content: inner });
        continue;
      }
      if (verse > 0 && inRange(verse, range)) kept.push(node);
    }
    return kept;
  };
  return walk(nodes);
}

/** Chapter slice limited to the portion verse range, for the read-only pane. */
export function sliceUsjToRange(usj: UsjDocument, range: RefRange): UsjDocument | null {
  try {
    const slices = splitUsjByChapter(usj);
    const slice = slices.find((s) => s.chapter === range.chapter);
    if (!slice) return null;
    const nodes = filterUsjNodes(slice.nodes, range);
    if (!nodes.some(nodeHasVerseContent)) return null;
    return {
      type: usj.type || "USJ",
      version: usj.version || "3.1",
      content: [...bookNodesFromSlices(slices), ...nodes],
    };
  } catch {
    return null;
  }
}
