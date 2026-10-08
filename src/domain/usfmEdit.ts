/**
 * Extract and patch plain verse text inside a USFM document for a chapter range.
 * Alignment markers are stripped for editing; a save writes `\v N text`, on as many lines as the verse has
 * (a verse of poetry is several: `\q1 …`, `\q2 …`), with the notes and the marked words the verse had
 * (`verseMarkup.ts`), and leaves what follows the verse where it was.
 */

import { HAS_NOTE, NO_MARKUP, carryMarkup, joinMarkup, keptWords, markupAlone, readText, readVerse, type VerseMarkup } from "./verseMarkup";

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

/** What the text says, with nothing of how it is marked: read by the reader that keeps the marks (`readVerse`). */
function stripAlignment(text: string): string {
  return readText(text);
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

/**
 * Marks that begin a line of a verse: a paragraph, a line of poetry, an item of a list. `\b` is a line left empty
 * between two stanzas.
 */
export const LINE_MARK = /^[ \t]*(\\(?:p|m|po|pr|cls|pm|pmo|pmc|pmr|pi\d?|mi|nb|pc|ph\d?|q\d?|qr|qc|qm\d?|li\d?|lim\d?|lh|lf|b)(?=\s|$))[ \t]*/;

/** What is left at the end of the last line of text of a verse: spaces, a chunk mark (`\ts\*`), the line end. */
const LINE_END = /[ \t]*(?:\\(?!zaln-)[a-z]+\d*(?:-[se])?(?:[ \t]*\|[^\\\n]*)?\\\*[ \t]*)*(?:\r?\n)?$/;

/** A line of a verse: the mark it begins with (none for what follows `\v` in its paragraph), and what it says. */
export type VerseLine = { lead: string; text: string };

export type VerseParts = {
  /** The lines that have text. A verse of prose is one. */
  lines: VerseLine[];
  /** Where the text of the verse ends in the document. */
  textEnd: number;
  /**
   * What stands between the text of the verse and the next verse, as it is written: the mark of the paragraph the
   * next verse opens, a line left empty, a chunk mark, a heading. It is not of this verse, and whoever writes
   * the verse again leaves it. Written again as one line, a verse took it with it: the `\q` that opened the next
   * verse was gone, and that verse was read as the end of this one's paragraph.
   */
  tail: string;
};

/** A line of the file that is of a verse: it has text, or a note of it (which may stand on a line of its own). */
export function lineOfVerse(line: string): boolean {
  return Boolean(normalizeVerseText(line)) || HAS_NOTE.test(line);
}

/** A verse as it is read to be written again: its lines, and what it has besides its words, at its place in them. */
function verseContent(usfm: string, span: Pick<VerseSpan, "start" | "end">): VerseParts & { kept: VerseMarkup } {
  const chunk = usfm.slice(span.start, span.end);
  const head = /^\\v\s+\S+[ \t]*/.exec(chunk)?.[0] ?? "";
  const from = span.start + head.length;
  // The file line by line: the text of a verse may be on any number of them (a group to a line, when aligned).
  const physical: { text: string; at: number }[] = [];
  let at = from;
  for (const text of chunk.slice(head.length).split(/(?<=\n)/)) {
    physical.push({ text, at });
    at += text.length;
  }
  let lastText = -1;
  physical.forEach((line, index) => {
    if (lineOfVerse(line.text)) lastText = index;
  });
  // Nothing at all: everything after its `\v` is of what follows.
  if (lastText < 0) return { lines: [], textEnd: from, tail: usfm.slice(from, span.end), kept: NO_MARKUP };

  const last = physical[lastText]!;
  const textEnd = last.at + (LINE_END.exec(last.text)?.index ?? last.text.length);
  const rows: { lead: string; raw: string }[] = [{ lead: "", raw: "" }];
  for (const line of physical.slice(0, lastText + 1)) {
    // What hangs from the end of the last line (a chunk mark) is of what follows.
    const text = line === last ? line.text.slice(0, textEnd - line.at) : line.text;
    const mark = LINE_MARK.exec(text);
    if (mark) rows.push({ lead: mark[1]!, raw: text.slice(mark[0].length) });
    else rows[rows.length - 1]!.raw += text;
  }
  // Read together: a run of marked words may go from one line to the next.
  const read = readVerse(rows.map((row) => row.raw.normalize("NFC")));
  // A mark with no text of its own (`\b`, or the `\q1` a writer leaves alone on its line) goes with the line after it.
  const lines: VerseLine[] = [];
  let pending = "";
  rows.forEach((row, index) => {
    const text = read.rows[index]!;
    const lead = [pending, row.lead].filter(Boolean).join("\n");
    if (text) lines.push({ lead, text });
    pending = text ? "" : lead;
  });
  return { lines, textEnd, tail: usfm.slice(textEnd, span.end), kept: { text: read.text, anchors: read.anchors, marks: read.marks } };
}

/**
 * A verse in its lines. In poetry a verse is written on several, each begun by a mark (`\q1`, `\q2`); read as
 * one run of text and written back as one line, it came out as prose.
 */
export function verseParts(usfm: string, span: Pick<VerseSpan, "start" | "end">): VerseParts {
  const { lines, textEnd, tail } = verseContent(usfm, span);
  return { lines, textEnd, tail };
}

/**
 * What a verse has besides its words (a footnote, words marked in it), at its place in the text of its lines
 * (`verseLinesText`).
 */
export function verseMarkup(usfm: string, span: Pick<VerseSpan, "start" | "end">): VerseMarkup {
  return verseContent(usfm, span).kept;
}

/**
 * What each verse of a chapter has besides its words, for those that have something. Two verses written as one
 * (`\v 2-3`) are under the first.
 */
export function chapterMarkup(usfm: string, chapter: number): Record<number, VerseMarkup> {
  const out: Record<number, VerseMarkup> = {};
  for (const span of listVerseSpans(usfm)) {
    if (span.chapter !== chapter) continue;
    const kept = verseMarkup(usfm, span);
    if (!kept.anchors.length && !kept.marks.length) continue;
    out[span.verse] = out[span.verse] ? joinMarkup([out[span.verse]!, kept]) : kept;
  }
  return out;
}

/** The text of a verse as it is written and edited: a line of text for each of its lines. */
export function verseLinesText(usfm: string, span: Pick<VerseSpan, "start" | "end">): string {
  return verseParts(usfm, span).lines.map((line) => line.text).join("\n");
}

/** A text in its lines, each without the white space around it, and without the empty ones. */
export function textLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => normalizeVerseText(line)).filter(Boolean);
}

/**
 * The marks the lines of each verse of a chapter begin with, in a text that has them: the pattern a translation
 * follows for a line it did not have before (a verse of the source in three lines: none, `\q1`, `\q2`).
 */
export function verseLeads(usfm: string, chapter: number): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  for (const span of listVerseSpans(usfm)) {
    if (span.chapter !== chapter) continue;
    const leads = verseParts(usfm, span).lines.map((line) => line.lead);
    if (leads.some(Boolean)) out[span.verse] = leads;
  }
  return out;
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

export type VerseSlotEdit = {
  from: number;
  to: number;
  /** A line of text for each line of the verse. */
  text: string;
  /** The marks its lines begin with in the text it is translated from, for the lines it does not have yet. */
  leads?: string[];
  /**
   * The text was written where a verse is one run of text (a correction made while aligning, or reading in a
   * group): it is broken where the verse it replaces is (`textInLines`).
   */
  flat?: boolean;
};

/** An edit of one verse may be given by its number alone. */
export type VerseEdit = VerseSlotEdit | (Omit<VerseSlotEdit, "from" | "to"> & { verse: number });

export function asSlotEdit(edit: VerseEdit): VerseSlotEdit {
  if (!("verse" in edit)) return edit;
  const { verse, ...rest } = edit;
  return { ...rest, from: verse, to: verse };
}

/**
 * A text that came as one run, broken where the verse it replaces is broken: after the same words. A correction
 * made where a verse is read as one run of text knows nothing of its lines, and written as it came it made prose
 * of a verse of a poem. Words changed across a break go to each side of it as the old ones were.
 */
export function textInLines(text: string, lines: string[]): string {
  const words = (line: string) => line.split(/\s+/).filter(Boolean);
  const flat = textLines(text).join(" ");
  const after = words(flat);
  if (lines.length < 2 || !after.length) return flat;
  const before = lines.flatMap(words);
  // Where each word of the verse is in the new text.
  const at = keptWords(before, after);
  const cuts: number[] = [];
  let end = 0;
  for (const line of lines.slice(0, -1)) {
    end += words(line).length;
    // The nearest word kept on each side of the break, and what was written between them.
    let left = end - 1;
    while (left >= 0 && at[left]! < 0) left--;
    let right = end;
    while (right < before.length && at[right]! < 0) right++;
    const from = left >= 0 ? at[left]! + 1 : 0;
    const to = right < before.length ? at[right]! : after.length;
    const gone = right - left - 1;
    cuts.push(from + Math.round((to - from) * (gone ? (end - 1 - left) / gone : 0)));
  }
  const out: string[] = [];
  let start = 0;
  for (const cut of [...cuts, after.length]) {
    const upTo = Math.max(cut, start);
    if (upTo > start) out.push(after.slice(start, upTo).join(" "));
    start = upTo;
  }
  return out.join("\n");
}

/**
 * A verse written again with the lines its text has. Each line begins with the mark the verse had there; one
 * more line than it had takes the mark of the source for that line, or of the line before it. A verse that has
 * no such mark, and whose source has none, is prose: it is written on one line whatever was typed.
 *
 * `kept` is what the verse had besides its words: its notes stay after the word they followed, its marked words
 * stay marked (`carryMarkup`). A verse left with no text keeps its notes: they may be all there is to say of it,
 * and whoever clears a verse to write it again would lose them on the way.
 */
function writtenVerse(num: string, text: string, own: VerseLine[], pattern: string[], eol: string, flat = false, kept: VerseMarkup = NO_MARKUP): string {
  const said = textLines(flat ? textInLines(text, own.map((line) => line.text)) : text);
  const leads = leadsFor(said.length, own.map((line) => line.lead), pattern);
  if (!said.length) return [`\\v ${num}`, markupAlone(kept)].filter(Boolean).join(" ");
  const typed = carryMarkup(kept, leads ? said : [said.join(" ")]);
  if (!leads) return `\\v ${num} ${typed[0]}`;
  return typed
    .map((line, index) => {
      const lead = leads[index]!;
      if (index === 0) return lead ? `\\v ${num}${eol}${lead.split("\n").join(eol)} ${line}` : `\\v ${num} ${line}`;
      return `${lead.split("\n").join(eol)} ${line}`;
    })
    .join(eol);
}

/**
 * The mark each of the lines of a verse begins with when it is written: the one the verse had on that line, or
 * the one its source has there, or that of the line before. `null` when neither the verse nor its source has any:
 * that verse is prose, one line. It is what the verse is shown with before it is saved (`verseShape`), so it is
 * said in one place.
 */
export function leadsFor(count: number, own: string[], pattern: string[]): string[] | null {
  const any = [...own, ...pattern].filter(Boolean);
  if (!any.length) return null;
  const leadAt = (index: number) => own[index] ?? pattern[index] ?? [...own.slice(0, index), ...pattern.slice(0, index)].filter(Boolean).pop() ?? any[any.length - 1]!;
  return Array.from({ length: count }, (_, index) => (index === 0 ? (own[0] ?? pattern[0] ?? "") : leadAt(index) || any[any.length - 1]!));
}

/**
 * The edits of a chapter that say something else than the book says there. A portion is saved with all its
 * verses, and a verse written again is not the verse as its writer left it, byte for byte (how its notes are
 * spaced, on which lines its groups are): a verse nobody touched is not written.
 *
 * The same words on the same lines are the verse as it is; so are the same words on one line when the verse has
 * several (a text kept from before verses were edited in their lines comes that way, and written back it would
 * make prose of a verse of a poem). A verse the book does not have yet is always written, even empty: its place
 * is made. So are verses that are joined or parted.
 */
export function changingEdits(usfm: string, chapter: number, edits: VerseEdit[]): VerseSlotEdit[] {
  const spans = listVerseSpans(usfm).filter((s) => s.chapter === chapter);
  return edits.map(asSlotEdit).filter((edit) => {
    const hits = spans.filter((s) => s.verse <= edit.to && s.verseTo >= edit.from);
    if (!hits.length || hits.some((s) => s.verse !== edit.from || s.verseTo !== edit.to)) return true;
    const typed = edit.flat ? [textLines(edit.text).join(" ")] : textLines(edit.text);
    // `\v 10a` and `\v 10b` are edited as one verse.
    const said = hits.map((s) => s.text).filter(Boolean).join(" ");
    if (normalizeVerseText(typed.join(" ")) !== normalizeVerseText(said)) return true;
    if (typed.length <= 1) return false;
    return hits.length !== 1 || typed.join("\n") !== verseLinesText(usfm, hits[0]!);
  });
}

/**
 * Write each edit that changes its verse (`changingEdits`) as `\v N text` (or `\v N-M text`) on the lines the
 * verse has, replacing every span of the chapter that intersects `[from, to]` at the first one's place, and
 * leaving what follows the verse (the mark that opens the next one, a heading) as it was. Missing slots are
 * inserted in verse order (creating `\c N` if needed).
 */
export function applyVerseEdits(
  usfm: string,
  chapter: number,
  edits: VerseEdit[],
): string {
  if (!edits.length) return usfm;
  let result = usfm;
  const sorted = changingEdits(usfm, chapter, edits).sort((a, b) => b.from - a.from);
  /** What a verse written as one with others (`\v 2-3`) had, for the part that keeps its number when they are parted. */
  const parted = new Map<number, VerseMarkup>();
  for (const edit of sorted) {
    const spans = listVerseSpans(result);
    const chapterSpans = spans.filter((s) => s.chapter === chapter);
    const hits = chapterSpans.filter((s) => s.verse <= edit.to && s.verseTo >= edit.from);
    const body = textLines(edit.text).join(" ");
    const num = edit.to > edit.from ? `${edit.from}-${edit.to}` : `${edit.from}`;
    if (hits.length) {
      const first = hits[0]!;
      const last = hits[hits.length - 1]!;
      const eol = result.includes("\r\n") ? "\r\n" : "\n";
      // The lines of the verse as it is, when it is one verse that is written again; verses joined are one line.
      const read = hits.map((hit) => verseContent(result, hit));
      const own = hits.length === 1 ? read[0]!.lines : [];
      const { tail } = read[read.length - 1]!;
      // A verse that begins before this edit is being parted, and its first part is written after this one (the
      // edits go from the last to the first): its notes wait for it there, where its text is.
      const here = read.filter((verse, index) => {
        const hit = hits[index]!;
        if (hit.verse >= edit.from || !sorted.some((other) => other !== edit && other.from === hit.verse)) return true;
        parted.set(hit.verse, verse.kept);
        return false;
      });
      const kept = joinMarkup(here.map((verse) => verse.kept));
      const written = writtenVerse(num, edit.text, own, hits.length === 1 ? (edit.leads ?? []) : [], eol, edit.flat, kept);
      // What followed the verse stays, on the lines it was on.
      const rest = tail.replace(/^[ \t]+/, "").replace(/^\r?\n/, "");
      result = result.slice(0, first.start) + written + eol + rest + result.slice(last.end);
      continue;
    }
    const had = parted.get(edit.from) ?? NO_MARKUP;
    const said = body ? carryMarkup(had, [body])[0]! : markupAlone(had);
    const line = said ? `\\v ${num} ${said}\n` : `\\v ${num}\n`;
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

/**
 * What a book says of itself before its first chapter. With the name of the book in the language of the
 * translation it has what other books of a team have (`\h`, `\toc1`–`\toc3`, `\mt`); a book begun here said
 * `\h JUD`, its code, and nothing else. Without a name, the code is all there is to say.
 */
function headerLines(code: string, name?: string): string[] {
  const lines = [bookIdLine(code), "\\usfm 3.0", "\\ide UTF-8"];
  const said = name?.trim();
  if (!said) return [...lines, `\\h ${code}`];
  const short = code.toLowerCase().replace(/[a-z]/, (letter) => letter.toUpperCase());
  return [...lines, `\\h ${said}`, `\\toc1 ${said}`, `\\toc2 ${said}`, `\\toc3 ${short}`, `\\mt ${said}`];
}

/** Valid enough for usfm-ast: identification, one paragraph, verse slots. */
export function skeletonUsfm(book: string, chapter: number, from: number, to: number, name?: string): string {
  const code = book.trim().toUpperCase() || "XXX";
  const lines = [...headerLines(code, name), `\\c ${chapter}`, "\\p"];
  for (let v = from; v <= to; v++) lines.push(`\\v ${v}`);
  return `${lines.join("\n")}\n`;
}

/** The mark a chunk begins with (a «translator's section»): what the tools that work chunk by chunk go by. */
export const CHUNK_MARK = /\\ts\\\*/;

/** The verses a chunk begins at, as `chapter:verse`: the first verse after each chunk mark of the text. */
export function chunkStarts(usfm: string): string[] {
  const spans = listVerseSpans(usfm);
  const starts: string[] = [];
  for (const mark of usfm.matchAll(new RegExp(CHUNK_MARK.source, "g"))) {
    const next = spans.find((span) => span.start > mark.index!);
    const key = next ? `${next.chapter}:${next.verse}` : "";
    if (key && !starts.includes(key)) starts.push(key);
  }
  return starts;
}

/**
 * A text with the chunk marks of the text it is translated from: one before each verse the source begins a chunk
 * at, where the text has that verse and no mark there yet. The team's texts are worked on by translators in tools
 * that go chunk by chunk, and they had none: not the books begun here, nor those written with translationCore.
 *
 * Nothing else changes, and nothing is taken out: a mark the team has and the source does not stays. A mark is
 * written as unfoldingWord writes it, on a line of its own after an empty one, right after the text of the verse
 * before: ahead of the paragraph the chunk opens, of its heading, and of the `\c` of a chapter. A chunk the
 * source begins inside two verses the team wrote as one (`\v 4-5`) has no place, and is left out.
 */
export function withChunkMarksOf(usfm: string, source: string): string {
  const wanted = new Set(chunkStarts(source));
  if (!wanted.size) return usfm;
  const eol = usfm.includes("\r\n") ? "\r\n" : "\n";
  const spans = listVerseSpans(usfm);
  let out = usfm;
  // From the end, so that what is put in does not move what is still to be looked at.
  for (let i = spans.length - 1; i >= 0; i--) {
    const span = spans[i]!;
    const before = spans[i - 1];
    if (!wanted.has(`${span.chapter}:${span.verse}`)) continue;
    // `\v 10b` goes on with `\v 10a`.
    if (before && before.chapter === span.chapter && before.verse === span.verse) continue;
    if (!before) {
      // The first verse of the book: the mark goes before the line of its chapter.
      const head = usfm.slice(0, span.start);
      if (CHUNK_MARK.test(head)) continue;
      const line = head.search(/^[ \t]*\\c\s+\d+/m);
      const at = line >= 0 ? line : head.lastIndexOf("\n") + 1;
      const blank = at === 0 || /\n[ \t]*\r?\n$/.test(usfm.slice(0, at));
      out = `${out.slice(0, at)}${blank ? "" : eol}\\ts\\*${eol}${out.slice(at)}`;
      continue;
    }
    const from = verseParts(usfm, before).textEnd;
    const between = usfm.slice(from, span.start);
    if (CHUNK_MARK.test(between)) continue;
    // After what is left of that line (a space at its end stays where it was), and before an empty line there.
    const rest = /^[ \t]*/.exec(between)![0].length;
    const emptyAfter = /^(\r?\n)[ \t]*\r?\n/.exec(between.slice(rest));
    const at = from + rest;
    out = `${out.slice(0, at)}${eol}${eol}\\ts\\*${out.slice(at + (emptyAfter ? emptyAfter[1]!.length : 0))}`;
  }
  return out;
}

/**
 * The marks between two verses of the source that a translation begins with: where a paragraph opens, where a
 * line of poetry does, a line left empty. Not its headings, which are words of the source. Its chunk marks are
 * put in apart (`withChunkMarksOf`).
 */
function structureOf(between: string): string[] {
  const marks: string[] = [];
  for (const line of between.split(/\r?\n/)) {
    const mark = LINE_MARK.exec(line);
    if (mark && !line.slice(mark[0].length).trim()) marks.push(mark[1]!);
  }
  return marks;
}

/**
 * Empty GLT/GST skeleton from a source book (typically ULT): same chapters and verse numbers, and each verse in
 * the paragraph or the line of poetry the source has it in, with its chunk marks; no borrowed English text. It
 * was one `\p` to a chapter: a psalm began as prose, and stayed so. The lines inside a verse are not laid here:
 * they are taken from the source when the verse is written (`verseLeads`).
 */
export function skeletonUsfmFromSource(book: string, sourceUsfm: string, name?: string): string {
  const spans = listVerseSpans(sourceUsfm);
  if (!spans.length) return "";
  const code = book.trim().toUpperCase() || "XXX";
  const lines = headerLines(code, name);
  let chapter = 0;
  spans.forEach((span, index) => {
    if (span.chapter !== chapter) {
      chapter = span.chapter;
      const opened = sourceUsfm.slice(0, span.start).search(new RegExp(`\\\\c\\s+${chapter}(?!\\d)`));
      const opening = structureOf(opened < 0 ? "" : sourceUsfm.slice(opened, span.start));
      lines.push(`\\c ${chapter}`, ...(opening.length ? opening : ["\\p"]));
    }
    lines.push(span.verseTo > span.verse ? `\\v ${span.verse}-${span.verseTo}` : `\\v ${span.verse}`);
    // What opens the next verse of the chapter; what follows its last verse is of the next chapter.
    if (spans[index + 1]?.chapter === span.chapter) lines.push(...structureOf(verseParts(sourceUsfm, span).tail));
  });
  return withChunkMarksOf(`${lines.join("\n")}\n`, sourceUsfm);
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
    // A verse of several lines is edited in its lines.
    const lines = verseParts(usfm, span).lines;
    const row = { from: span.verse, to: span.verseTo, text: lines.length > 1 ? lines.map((line) => line.text).join("\n") : span.text };
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
  /** The name of the book in the language of the translation. */
  name?: string;
}): string {
  const fromSource = params.sourceUsfm ? skeletonUsfmFromSource(params.book, params.sourceUsfm, params.name) : "";
  if (fromSource.trim()) return fromSource;
  const range = params.fallbackRange;
  if (range) return skeletonUsfm(params.book, range.chapter, range.from, range.to, params.name);
  return skeletonUsfm(params.book, 1, 1, 1, params.name);
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
