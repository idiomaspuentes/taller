/**
 * The shape a verse has on the page: which lines it is in, and what kind of line each is (a paragraph, a line of
 * a poem and how deep, a line left empty before it). A translation was shown as it is typed, line under line
 * with nothing to tell a line of a poem from a long line that wraps, while the text it is translated from was
 * shown with its lines; and that one made no difference between `\q1` and `\q2`.
 *
 * What is given here is what will be written (`leadsFor`, the same as `applyVerseEdits`), so the verse is seen
 * as it will be saved before it is.
 */
import { LINE_MARK, leadsFor, listVerseSpans, textLines, verseParts } from "./usfmEdit";

/** How a verse stands in its book. */
export type VerseShape = {
  /** The mark of the paragraph or line the verse begins in, without its backslash (`p`, `q1`). */
  marker: string;
  /** Whether the verse is what that paragraph or line opens with; when not, it goes on in it. */
  opens: boolean;
  /** A line is left empty before it (`\b`). */
  gap: boolean;
  /** The marks the lines of the verse begin with in the book, the first one empty (`verseParts`). */
  leads: string[];
  /** The last verse it holds: its own number, or the end of a bridge (`\v 4-5`). */
  to: number;
};

/**
 * Where in a text as it was typed a place of its shown lines is: the line that was touched, and how many of its
 * characters come before the touch. A verse of prose is shown as one line whatever lines it was typed in.
 */
export function typedOffset(text: string, shownCount: number, line: number, offset: number): number {
  const pieces: { start: number; length: number }[] = [];
  let at = 0;
  for (const raw of text.split("\n")) {
    const said = raw.trim();
    if (said) pieces.push({ start: at + (raw.length - raw.trimStart().length), length: said.length });
    at += raw.length + 1;
  }
  if (!pieces.length) return 0;
  if (shownCount > 1 || pieces.length === 1) {
    const piece = pieces[Math.max(0, Math.min(line, pieces.length - 1))]!;
    return piece.start + Math.max(0, Math.min(offset, piece.length));
  }
  let left = Math.max(0, offset);
  for (const piece of pieces) {
    if (left <= piece.length) return piece.start + left;
    left -= piece.length + 1;
  }
  const last = pieces[pieces.length - 1]!;
  return last.start + last.length;
}

/** A line of a verse as it is shown. */
export type ShownLine = {
  marker: string;
  text: string;
  /** It begins its paragraph or its line of the poem; when not, it goes on where the verse before left. */
  opens: boolean;
  /** A line is left empty before it. */
  gap: boolean;
};

/** The marks of a lead (`\b`, then `\q1`), without their backslashes. */
function marksOf(lead: string): string[] {
  return lead.split(/\r?\n/).map((mark) => mark.trim().replace(/^\\/, "")).filter(Boolean);
}

/** The marks that stand alone on their lines in a stretch of the book: what opens the verse that follows. */
function marksIn(between: string): string[] {
  const marks: string[] = [];
  for (const line of between.split(/\r?\n/)) {
    const mark = LINE_MARK.exec(line);
    if (mark && !line.slice(mark[0].length).trim()) marks.push(mark[1]!.slice(1));
  }
  return marks;
}

/** The shape of each verse of a chapter, by the number it begins with. */
export function chapterShape(usfm: string, chapter: number): Record<number, VerseShape> {
  const out: Record<number, VerseShape> = {};
  const spans = listVerseSpans(usfm);
  // The paragraph a verse goes on in is the last one that was opened before it, in its chapter.
  let marker = "p";
  let seen = 0;
  spans.forEach((span, index) => {
    if (span.chapter !== chapter) return;
    const before = spans[index - 1];
    let from = before ? verseParts(usfm, before).textEnd : 0;
    if (span.chapter !== seen) {
      seen = span.chapter;
      marker = "p";
      const opened = usfm.slice(0, span.start).search(new RegExp(`\\\\c\\s+${chapter}(?!\\d)`));
      if (opened >= 0) from = Math.max(from, opened);
    }
    const marks = marksIn(usfm.slice(from, span.start));
    const opening = marks.filter((mark) => mark !== "b").pop();
    if (opening) marker = opening;
    const leads = verseParts(usfm, span).lines.map((line) => line.lead);
    // `\v 10b` goes on with `\v 10a`: the verse is as its first part begins.
    out[span.verse] ??= { marker, opens: Boolean(opening), gap: marks.includes("b"), leads, to: span.verseTo };
    for (const lead of leads) marker = marksOf(lead).filter((mark) => mark !== "b").pop() ?? marker;
  });
  return out;
}

/**
 * The lines of a verse as they will be written, each with the mark that gives it its shape. `pattern` is what
 * the text it is translated from has in that verse (`verseLeads`): a line the verse does not have in the book yet
 * takes its mark from there.
 */
export function shownLines(text: string, shape: VerseShape | undefined, pattern: string[] = []): ShownLine[] {
  const said = textLines(text);
  if (!said.length) return [];
  const shapes = lineShapes(said.length, shape, pattern);
  if (!shapes) return [{ marker: shape?.marker ?? "p", opens: shape?.opens ?? false, gap: shape?.gap ?? false, text: said.join(" ") }];
  return said.map((line, index) => ({ ...shapes[index]!, text: line }));
}

/** The shape of a line, whatever it says. */
export type LineShape = Omit<ShownLine, "text">;

/**
 * The shape each of `count` lines of a verse would have: what a field to write a line in is drawn with, before
 * anything is written in it. `null` for a verse of prose, which is one line however many are typed.
 */
export function lineShapes(count: number, shape: VerseShape | undefined, pattern: string[] = []): LineShape[] | null {
  const first = { marker: shape?.marker ?? "p", opens: shape?.opens ?? false, gap: shape?.gap ?? false };
  const leads = leadsFor(count, shape?.leads ?? [], pattern);
  if (!leads) return null;
  let marker = first.marker;
  return leads.map((lead, index) => {
    const marks = marksOf(lead);
    const own = marks.filter((mark) => mark !== "b").pop();
    if (own) marker = own;
    if (index === 0 && !own) return first;
    return { marker, opens: Boolean(own), gap: marks.includes("b") || (index === 0 && first.gap) };
  });
}

/** How many lines a verse is expected to have: those its source has, or those it has in the book. One for prose. */
export function expectedLines(shape: VerseShape | undefined, pattern: string[] = []): number {
  const own = shape?.leads.some(Boolean) ? shape.leads.length : 0;
  return Math.max(pattern.some(Boolean) ? pattern.length : 0, own, 1);
}
