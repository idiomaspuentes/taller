/**
 * What a reviewer reads: the passage of the subtarea, piece by piece (a verse of the text, a row of a help), as it
 * is in the draft and as it was before it. Pure: the review tool loads the two versions of the file and shows this.
 */
import { noteFromTsv } from "./helpMarkup";
import { listVerseSpans, type RefRange } from "./usfmEdit";

export type ReviewItem = {
  key: string;
  /** `1:2`, or `1:2–3` for a verse bridge. */
  ref: string;
  chapter: number;
  verse: number;
  now: string;
  before: string;
  /** `new`: nothing was there before. `removed`: it is no longer in the draft. `empty`: not written yet. */
  state: "new" | "changed" | "same" | "removed" | "empty";
  /** A row of a help: what it says, apart from the columns that only place it in the text. */
  help?: HelpSaid;
};

/**
 * What a row of a help says to whoever reads it: its note, or its question and the answer. The other columns of the
 * row (the article it points to, the phrase of the original it is about, which time that phrase comes) place the row;
 * read as text they are an address, a line of Greek and a number.
 */
export type HelpSaid = {
  text: string;
  /** The answer of a question. */
  secondary?: string;
  /** What the row said before the draft. */
  before: string;
  beforeSecondary?: string;
  /** A note: what it quotes of the original, to find the phrase in the source texts. */
  quote?: string;
  occurrence?: number;
};

export type DiffPart = { text: string; kind: "same" | "added" | "removed" };

/** Beyond this many word pairs the comparison is not worth its cost: the two texts are shown whole. */
const DIFF_BUDGET = 400_000;

/** What changed between two texts, word by word. */
export function diffWords(before: string, now: string): DiffPart[] {
  // A word goes with the space after it, so that a run of new words is one mark and not one per word.
  const words = (text: string) => text.match(/\S+\s*|\s+/g) ?? [];
  const a = words(before);
  const b = words(now);
  const same = (i: number, j: number) => a[i]!.trimEnd() === b[j]!.trimEnd();
  if (!a.length || !b.length || a.length * b.length > DIFF_BUDGET) {
    return [...(before ? [{ text: before, kind: "removed" as const }] : []), ...(now ? [{ text: now, kind: "added" as const }] : [])];
  }
  // Longest common subsequence, from the end, so the walk forward keeps the earliest matches.
  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] = same(i, j) ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const parts: DiffPart[] = [];
  const push = (text: string, kind: DiffPart["kind"]) => {
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += text;
    else parts.push({ text, kind });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (same(i, j)) {
      push(b[j]!, "same");
      i++;
      j++;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) push(a[i++]!, "removed");
    else push(b[j++]!, "added");
  }
  while (i < a.length) push(a[i++]!, "removed");
  while (j < b.length) push(b[j++]!, "added");
  return parts;
}

const stateOf = (before: string, now: string): ReviewItem["state"] => (!now && !before ? "empty" : !now ? "removed" : !before ? "new" : before === now ? "same" : "changed");

function verseItems(now: string, before: string, range: RefRange): ReviewItem[] {
  const inRange = (span: { chapter: number; verse: number; verseTo: number }) => span.chapter === range.chapter && span.verse <= range.to && span.verseTo >= range.from;
  const was = listVerseSpans(before).filter(inRange);
  const items = listVerseSpans(now)
    .filter(inRange)
    .map((span): ReviewItem => {
      // A bridge is compared with everything its verses said before.
      const old = was
        .filter((row) => row.verse <= span.verseTo && row.verseTo >= span.verse)
        .map((row) => row.text.trim())
        .filter(Boolean)
        .join(" ");
      const text = span.text.trim();
      return {
        key: `${span.chapter}:${span.verse}${span.segment ?? ""}`,
        ref: `${span.chapter}:${span.verse}${span.verseTo > span.verse ? `–${span.verseTo}` : ""}${span.segment ?? ""}`,
        chapter: span.chapter,
        verse: span.verse,
        now: text,
        before: old,
        state: stateOf(old, text),
      };
    });
  return items;
}

type Row = { id: string; chapter: number; verse: number; text: string; said: string; answer?: string; quote?: string; occurrence?: number };

/** The rows of a help file (TSV with a `Reference` column) that are about the passage. */
function helpRows(tsv: string, range: RefRange): Row[] {
  const lines = tsv.split(/\r?\n/).filter((line) => line.trim());
  const head = (lines[0] ?? "").split("\t").map((cell) => cell.trim().toLowerCase());
  const refAt = head.indexOf("reference");
  if (refAt < 0) return [];
  const idAt = head.indexOf("id");
  // A file of notes says its note in `Note`; one of questions, its question in `Question` and the answer in `Response`.
  const noteAt = head.indexOf("note");
  const questionAt = head.indexOf("question");
  const responseAt = head.indexOf("response");
  const quoteAt = head.indexOf("quote");
  const occurrenceAt = head.indexOf("occurrence");
  const cell = (cells: string[], at: number) => (at >= 0 ? noteFromTsv(cells[at] ?? "").trim() : "");
  const rows: Row[] = [];
  lines.slice(1).forEach((line, index) => {
    const cells = line.split("\t");
    const ref = (cells[refAt] ?? "").trim().match(/^(\d+):(\d+)/);
    if (!ref) return;
    const chapter = Number(ref[1]);
    const verse = Number(ref[2]);
    if (chapter !== range.chapter || verse < range.from || verse > range.to) return;
    const text = cells
      .filter((_, at) => at !== refAt && at !== idAt)
      .map((cell) => cell.replace(/\\n/g, "\n").trim())
      .filter(Boolean)
      .join("\n");
    rows.push({
      id: (idAt >= 0 ? cells[idAt]?.trim() : "") || `${chapter}:${verse}#${index}`,
      chapter,
      verse,
      text,
      said: noteAt >= 0 ? cell(cells, noteAt) : questionAt >= 0 ? cell(cells, questionAt) : text,
      ...(noteAt < 0 && responseAt >= 0 ? { answer: cell(cells, responseAt) } : {}),
      ...(noteAt >= 0 && quoteAt >= 0 ? { quote: (cells[quoteAt] ?? "").trim(), occurrence: Math.max(1, parseInt(cells[occurrenceAt] ?? "1", 10) || 1) } : {}),
    });
  });
  return rows;
}

function rowItems(now: string, before: string, range: RefRange): ReviewItem[] {
  const was = helpRows(before, range);
  const rows = helpRows(now, range);
  const item = (row: Row, old: Row | undefined, gone = false): ReviewItem => {
    const text = gone ? "" : row.text;
    const before = gone ? row.text : (old?.text ?? "");
    return {
      key: row.id,
      ref: `${row.chapter}:${row.verse}`,
      chapter: row.chapter,
      verse: row.verse,
      now: text,
      before,
      state: stateOf(before, text),
      help: {
        text: gone ? "" : row.said,
        before: gone ? row.said : (old?.said ?? ""),
        ...(row.answer !== undefined ? { secondary: gone ? "" : row.answer, beforeSecondary: gone ? row.answer : (old?.answer ?? "") } : {}),
        ...(row.quote !== undefined ? { quote: row.quote, occurrence: row.occurrence } : {}),
      },
    };
  };
  const kept = rows.map((row) => item(row, was.find((old) => old.id === row.id)));
  const gone = was.filter((old) => !rows.some((row) => row.id === old.id)).map((old) => item(old, undefined, true));
  return [...kept, ...gone].sort((a, b) => a.verse - b.verse);
}

/** An introduction among the rows of a file of notes: that of the book, or of a chapter (`chapter`). */
export type IntroItem = { key: string; chapter?: number; now: string; before: string };

/** The rows of a file of notes that are introductions (`front:intro`, `3:intro`), their line breaks made real ones. */
function introRows(tsv: string): { id: string; chapter?: number; note: string }[] {
  const lines = tsv.split(/\r?\n/).filter((line) => line.trim());
  const head = (lines[0] ?? "").split("\t").map((cell) => cell.trim().toLowerCase());
  const refAt = head.indexOf("reference");
  const noteAt = head.indexOf("note");
  const idAt = head.indexOf("id");
  if (refAt < 0 || noteAt < 0) return [];
  return lines.slice(1).flatMap((line) => {
    const cells = line.split("\t");
    const intro = (cells[refAt] ?? "").trim().toLowerCase().match(/^(front|\d+):intro$/);
    if (!intro) return [];
    return [{ id: (idAt >= 0 ? cells[idAt]?.trim() : "") || `${intro[1]}:intro`, chapter: intro[1] === "front" ? undefined : Number(intro[1]), note: noteFromTsv(cells[noteAt] ?? "").trim() }];
  });
}

/**
 * The introductions a draft of notes is reviewed with. A row of the passage is a sentence or two; an introduction is
 * pages, and is not on a verse, so the rows of the passage never showed it: whoever translated it had it reviewed by
 * nobody. They are those of the book and of the passage's chapter that the draft changed, and those the plan gave to
 * this passage (`mine`) even if the draft left them alone, so that one nobody translated is seen too.
 */
export function introItems(now: string, before: string, chapter: number, mine: (id: string) => boolean = () => false): IntroItem[] {
  const was = new Map(introRows(before).map((row) => [row.id, row.note]));
  return introRows(now)
    .filter((row) => row.chapter === undefined || row.chapter === chapter)
    .filter((row) => mine(row.id) || (was.get(row.id) ?? "") !== row.note)
    .map((row) => ({ key: row.id, chapter: row.chapter, now: row.note, before: was.get(row.id) ?? "" }));
}

/** The pieces of the passage to review, in a file of the text (`.usfm`) or of a help (`.tsv`). Other files: none. */
export function reviewItems(params: { filename: string; now: string; before: string; range: RefRange }): ReviewItem[] {
  const name = params.filename.toLowerCase();
  if (name.endsWith(".usfm") || name.endsWith(".sfm")) return verseItems(params.now, params.before, params.range);
  if (name.endsWith(".tsv")) return rowItems(params.now, params.before, params.range);
  return [];
}

/**
 * The articles of a draft (Academia, Palabras), one piece each: an article is not of one verse, so it is named by
 * its own title, or by its folder when it has none yet.
 */
export function articleItems(files: { filename: string; now: string; before: string }[]): ReviewItem[] {
  return files
    .filter((file) => file.filename.toLowerCase().endsWith(".md"))
    .map((file) => {
      const heading = (file.now || file.before).match(/^#{1,6}\s+(.+?)\s*#*$/m)?.[1]?.trim();
      const parts = file.filename.replace(/\.md$/i, "").split("/");
      // `translate/figs-metaphor/01` is the article `figs-metaphor`; `bible/kt/love` is `love`.
      const folder = /^\d+$|^(title|sub-title)$/i.test(parts[parts.length - 1] ?? "") ? (parts[parts.length - 2] ?? file.filename) : (parts[parts.length - 1] ?? file.filename);
      const part = /^(title|sub-title)$/i.test(parts[parts.length - 1] ?? "") ? ` (${parts[parts.length - 1]})` : "";
      return { key: file.filename, ref: `${heading || folder}${heading ? "" : part}`, chapter: 0, verse: 0, now: file.now.trim(), before: file.before.trim(), state: stateOf(file.before.trim(), file.now.trim()) };
    });
}

// How a comment says where it is about (`**JUD 1:2** — …`) is told in `commentPlace.ts`, which the notices read too.
export { parseRefComment, refComment } from "./commentPlace";
