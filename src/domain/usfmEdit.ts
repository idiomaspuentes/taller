/**
 * Extract and patch plain verse text inside a USFM document for a chapter range.
 * Alignment markers are stripped for editing; saves write simple `\v N text` lines.
 */

export type VerseSpan = {
  chapter: number;
  verse: number;
  /** Last verse number of a bridge `\v N-M`; equals `verse` otherwise. */
  verseTo: number;
  /** Letter suffix of `\v 10a` / `\v 10b`. */
  segment?: string;
  /** `\v 11-10` or `\v 10-10`: read as `\v 10`. */
  rangeInvalid?: boolean;
  /** Inclusive start index of `\v …` in the full USFM. */
  start: number;
  /** Exclusive end index (start of next verse/chapter marker or EOF). */
  end: number;
  /** Body after the `\v N` number token (may include alignment markup). */
  rawBody: string;
  /** Display / edit text. */
  text: string;
};

export type RefRange = {
  chapter: number;
  from: number;
  to: number;
};

function cleanRef(ref: string): string {
  return ref
    .trim()
    .replace(/^[A-Z0-9]{3}\s+/i, "")
    .split("·")[0]
    ?.trim() ?? "";
}

/**
 * Parse `1:10–11`, `1:10-11`, or `13:30`. Old lot titles chain portions
 * (`1:1–8–9–12`): a non-decreasing chain covers first → last. A chain that
 * goes back (`1:9–11–1–4`) or names a second chapter (`1:9–2:4`) is null.
 */
export function parseRefRange(ref: string): RefRange | null {
  const m = cleanRef(ref).match(/^(\d{1,3})\s*:\s*(\d{1,3}(?:\s*[–\-—]\s*\d{1,3})*)(\s*:)?/);
  if (!m || m[3]) return null;
  const chapter = Number(m[1]);
  const nums = m[2]!.split(/\s*[–\-—]\s*/).map(Number);
  const from = nums[0]!;
  if (!chapter || !from) return null;
  if (nums.length > 2 && nums.some((n, i) => i > 0 && n < nums[i - 1]!)) return null;
  const to = nums[nums.length - 1]!;
  return { chapter, from, to: to >= from ? to : from };
}

/**
 * What the editor shows: the issue ref, else its leading `c:v[–v]`, else
 * verse 1 of the chapter. Display only — Cerrar uses `parseRefRange`.
 */
export function portionRange(ref: string, chapter: number): RefRange | null {
  const exact = parseRefRange(ref);
  if (exact) return exact;
  const lead = cleanRef(ref).match(/^(\d{1,3})\s*:\s*(\d{1,3})(?:\s*[–\-—]\s*(\d{1,3}))?/);
  if (lead && Number(lead[1]) && Number(lead[2])) {
    const from = Number(lead[2]);
    const to = lead[3] ? Number(lead[3]) : from;
    return { chapter: Number(lead[1]), from, to: to >= from ? to : from };
  }
  return chapter > 0 ? { chapter, from: 1, to: 1 } : null;
}

/** Plain verse text as compared and written by the merge (NFC). */
export function normalizeVerseText(text: string): string {
  return stripAlignment(text).normalize("NFC");
}

function stripAlignment(text: string): string {
  let out = text;
  out = out.replace(/\\fe\s[\s\S]*?\\fe\*/g, " ");
  out = out.replace(/\\f\s[\s\S]*?\\f\*/g, " ");
  out = out.replace(/\\x\s[\s\S]*?\\x\*/g, " ");
  out = out.replace(/\\(?:s\d?|ms\d?|mr|r|d|sp|cl|cd|rem)(?=\s|$)[^\n]*/g, " ");
  out = out.replace(/\\zaln-s\s+\|[^\\]*\*/g, "");
  out = out.replace(/\\zaln-e\*/g, "");
  out = out.replace(/\\w\s+([^\\|]+)\|[^\\]*\\w\*/g, "$1");
  out = out.replace(/\\w\s+([^\\*]+)\\w\*/g, "$1");
  out = out.replace(/\\[a-zA-Z0-9-]+\*?/g, " ");
  out = out.replace(/\s+/g, " ");
  return out.trim();
}

/**
 * Find every `\v` in the document with chapter context from preceding `\c`.
 */
export function listVerseSpans(usfm: string): VerseSpan[] {
  const spans: VerseSpan[] = [];
  let chapter = 0;
  const re = /\\(c|v)\b/g;
  let match: RegExpExecArray | null;
  const hits: { kind: "c" | "v"; index: number }[] = [];
  while ((match = re.exec(usfm)) !== null) {
    hits.push({ kind: match[1] as "c" | "v", index: match.index });
  }
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    const next = hits[i + 1];
    const end = next ? next.index : usfm.length;
    const chunk = usfm.slice(hit.index, end);
    if (hit.kind === "c") {
      const num = chunk.match(/^\\c\s+(\d+)/);
      if (num) chapter = Number(num[1]);
      continue;
    }
    const vm = chunk.match(/^\\v\s+(\d+)(?:\s*[-–]\s*(\d+))?([a-z])?\s*/i);
    if (!vm || !chapter) continue;
    const verse = Number(vm[1]);
    const to = vm[2] ? Number(vm[2]) : verse;
    const rawBody = chunk.slice(vm[0].length).replace(/\s+$/, "");
    spans.push({
      chapter,
      verse,
      verseTo: to > verse ? to : verse,
      ...(vm[3] ? { segment: vm[3].toLowerCase() } : {}),
      ...(vm[2] && to <= verse ? { rangeInvalid: true } : {}),
      start: hit.index,
      end,
      rawBody,
      text: stripAlignment(rawBody),
    });
  }
  return spans;
}

export function extractVerseEdits(
  usfm: string,
  range: RefRange,
): { spans: VerseSpan[]; missing: number[] } {
  const all = listVerseSpans(usfm);
  const byVerse = new Map(
    all
      .filter((s) => s.chapter === range.chapter && s.verse >= range.from && s.verse <= range.to)
      .map((s) => [s.verse, s]),
  );
  const spans: VerseSpan[] = [];
  const missing: number[] = [];
  for (let v = range.from; v <= range.to; v++) {
    const hit = byVerse.get(v);
    if (hit) spans.push(hit);
    else missing.push(v);
  }
  return { spans, missing };
}

export type VerseSlotEdit = { from: number; to: number; text: string };

function asSlotEdit(edit: VerseSlotEdit | { verse: number; text: string }): VerseSlotEdit {
  return "verse" in edit ? { from: edit.verse, to: edit.verse, text: edit.text } : edit;
}

/**
 * Write each edit as one line (`\v N text` or `\v N-M text`), replacing every
 * span of the chapter that intersects `[from, to]` at the first one's place.
 * Missing slots are inserted in verse order (creating `\c N` if needed).
 */
export function applyVerseEdits(
  usfm: string,
  chapter: number,
  edits: (VerseSlotEdit | { verse: number; text: string })[],
): string {
  if (!edits.length) return usfm;
  let result = usfm;
  const sorted = edits.map(asSlotEdit).sort((a, b) => b.from - a.from);
  for (const edit of sorted) {
    const spans = listVerseSpans(result);
    const chapterSpans = spans.filter((s) => s.chapter === chapter);
    const hits = chapterSpans.filter((s) => s.verse <= edit.to && s.verseTo >= edit.from);
    const body = edit.text.trim();
    const num = edit.to > edit.from ? `${edit.from}-${edit.to}` : `${edit.from}`;
    const line = body ? `\\v ${num} ${body}\n` : `\\v ${num}\n`;
    if (hits.length) {
      const first = hits[0]!;
      const last = hits[hits.length - 1]!;
      result = result.slice(0, first.start) + line + result.slice(last.end);
      continue;
    }
    const before = chapterSpans.filter((s) => s.verseTo < edit.from).pop();
    if (before) {
      const lead = result[before.end - 1] === "\n" ? "" : "\n";
      result = result.slice(0, before.end) + lead + line + result.slice(before.end);
      continue;
    }
    const after = chapterSpans.find((s) => s.verse > edit.to);
    if (after) {
      result = result.slice(0, after.start) + line + result.slice(after.start);
      continue;
    }
    const cRe = new RegExp(`\\\\c\\s+${chapter}\\b`);
    const cMatch = cRe.exec(result);
    if (cMatch) {
      const insertAt = cMatch.index + cMatch[0].length;
      const nl = result[insertAt] === "\n" ? insertAt + 1 : insertAt;
      result = result.slice(0, nl) + line + result.slice(nl);
      continue;
    }
    if (!/\\id\b/i.test(result)) {
      result = `\\id BOOK\n\\c ${chapter}\n${line}` + result;
    } else {
      result = result.replace(/\s*$/, `\n\\c ${chapter}\n${line}`);
    }
  }
  return result;
}

function bookIdLine(book: string): string {
  return `\\id ${book.trim().toUpperCase() || "XXX"}`;
}

/** Valid enough for usfm-ast: identification, one paragraph, verse slots. */
export function skeletonUsfm(book: string, chapter: number, from: number, to: number): string {
  const code = book.trim().toUpperCase() || "XXX";
  const lines = [bookIdLine(code), "\\usfm 3.0", "\\ide UTF-8", `\\h ${code}`, `\\c ${chapter}`, "\\p"];
  for (let v = from; v <= to; v++) lines.push(`\\v ${v}`);
  return `${lines.join("\n")}\n`;
}

/**
 * Empty GLT/GST skeleton from a source book (typically ULT): same chapters
 * and verse numbers, no borrowed English text.
 */
export function skeletonUsfmFromSource(book: string, sourceUsfm: string): string {
  const spans = listVerseSpans(sourceUsfm);
  if (!spans.length) return "";
  const code = book.trim().toUpperCase() || "XXX";
  const lines = [bookIdLine(code), "\\usfm 3.0", "\\ide UTF-8", `\\h ${code}`];
  let chapter = 0;
  for (const span of spans) {
    if (span.chapter !== chapter) {
      chapter = span.chapter;
      lines.push(`\\c ${chapter}`, "\\p");
    }
    lines.push(span.verseTo > span.verse ? `\\v ${span.verse}-${span.verseTo}` : `\\v ${span.verse}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Draft rows for a portion: every span of the chapter that intersects
 * `range` (a bridge keeps its full `from–to`, even past the portion), plus
 * one empty row per uncovered number. Book order.
 */
export function draftSlots(usfm: string, range: RefRange): VerseSlotEdit[] {
  const rows: VerseSlotEdit[] = [];
  for (const span of listVerseSpans(usfm)) {
    if (span.chapter !== range.chapter) continue;
    if (span.verse > range.to || span.verseTo < range.from) continue;
    const row = { from: span.verse, to: span.verseTo, text: span.text };
    const segmentOf = span.segment
      ? rows.find((r) => r.from === row.from && r.to === row.to)
      : undefined;
    if (segmentOf) {
      segmentOf.text = [segmentOf.text, row.text].filter(Boolean).join(" ");
      continue;
    }
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i]!.from <= row.to && row.from <= rows[i]!.to) rows.splice(i, 1);
    }
    rows.push(row);
  }
  for (let v = range.from; v <= range.to; v++) {
    if (!rows.some((r) => r.from <= v && v <= r.to)) rows.push({ from: v, to: v, text: "" });
  }
  return rows.sort((a, b) => a.from - b.from);
}

export function buildBookUsfmSkeleton(params: {
  book: string;
  sourceUsfm?: string;
  fallbackRange?: RefRange;
}): string {
  const fromSource = params.sourceUsfm ? skeletonUsfmFromSource(params.book, params.sourceUsfm) : "";
  if (fromSource.trim()) return fromSource;
  const range = params.fallbackRange;
  if (range) return skeletonUsfm(params.book, range.chapter, range.from, range.to);
  return skeletonUsfm(params.book, 1, 1, 1);
}

/** Identification + at least one chapter/verse slot. Used to detect stubs. */
export function isValidBookUsfm(usfm: string): boolean {
  if (!usfm.trim()) return false;
  if (!/\\id\b/i.test(usfm)) return false;
  if (!/\\c\s+\d+/i.test(usfm)) return false;
  return listVerseSpans(usfm).length > 0;
}

/** True when any verse body has visible text (not an empty ULT-shaped skeleton). */
export function usfmHasFilledVerses(usfm: string): boolean {
  return listVerseSpans(usfm).some((span) => span.text.trim().length > 0);
}
