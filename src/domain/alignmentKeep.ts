import {
  extractAlignmentDocumentFromUsfm,
  mergeAlignmentIntoUsfm,
  reconcileAlignments,
  stripAlignmentFromUsfm,
} from "@usfm-tools/editor-core";
import { tNow } from "../i18n/messages";
import { applyVerseEdits, asSlotEdit, changingEdits, listVerseSpans, verseParts, type VerseEdit, type VerseSlotEdit } from "./usfmEdit";

/**
 * Keep word alignment when the text of a verse is saved.
 *
 * The plain writer (`applyVerseEdits`) writes a verse from its words (and its
 * notes and marked words), which drops its `\zaln-s` / `\w` marks. The enhanced
 * project model keeps two layers: USFM without marks while working, and the
 * alignment as data. Here the alignment is lifted out, the text is edited, and
 * the alignment is put back: words that did not change keep their links, the
 * rest lose them. Only the verses that were edited are taken from the book
 * written that way; every other verse stays as the file has it.
 */

export type AlignmentSource = { id: string; version?: string };

const DEFAULT_SOURCE: AlignmentSource = { id: "unfoldingword/original" };

export type KeepAlignmentResult = {
  usfm: string;
  /** Verses that had links and lost all of them (cleared, or joined into a range). */
  clearedVerses: number[];
  /** Verses whose edit removed some links but kept the rest. */
  reducedVerses: number[];
};

export function usfmHasAlignment(usfm: string): boolean {
  return /\\zaln-s\b/.test(usfm);
}

function bookOf(usfm: string): string {
  return /\\id\s+([A-Z0-9]{3})/i.exec(usfm)?.[1]?.toUpperCase() ?? "";
}

/** The word tokenizer keeps punctuation on a token ("Pablo,"); a linked word is the word alone. */
export function withoutPunctuation<T extends { targets: { word: string }[] }>(groups: T[]): T[] {
  const strip = (w: string) => w.replace(/^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu, "");
  return groups
    .map((g) => ({ ...g, targets: g.targets.map((t) => ({ ...t, word: strip(t.word) })).filter((t) => t.word) }))
    .filter((g) => g.targets.length > 0);
}

function normalizeEdits(edits: VerseEdit[]): VerseSlotEdit[] {
  return edits.map(asSlotEdit);
}

/** Same as `applyVerseEdits`, but the alignment of untouched words survives. */
export function applyVerseEditsKeepingAlignment(
  usfm: string,
  chapter: number,
  edits: VerseEdit[],
  source: AlignmentSource = DEFAULT_SOURCE,
): KeepAlignmentResult {
  if (!edits.length || !usfmHasAlignment(usfm)) {
    return { usfm: applyVerseEdits(usfm, chapter, edits), clearedVerses: [], reducedVerses: [] };
  }
  const book = bookOf(usfm);
  const doc = extractAlignmentDocumentFromUsfm(usfm, { id: book || "translation" }, source);
  const plain = stripAlignmentFromUsfm(usfm);
  const oldText = new Map<number, string>();
  for (const span of listVerseSpans(plain)) {
    if (span.chapter === chapter) oldText.set(span.verse, span.text);
  }

  // Edits that leave the verse as it is must not reformat the file or touch its alignment.
  const changing = changingEdits(plain, chapter, edits);
  if (!changing.length) return { usfm, clearedVerses: [], reducedVerses: [] };
  edits = changing;

  const verses = { ...doc.verses };
  const cleared: number[] = [];
  const reduced: number[] = [];
  for (const edit of normalizeEdits(edits)) {
    for (let v = edit.from; v <= edit.to; v++) {
      const sid = `${book} ${chapter}:${v}`;
      const groups = verses[sid];
      if (!groups?.length) continue;
      // A joined range has no single old text to compare with: its links are dropped.
      const next = edit.from === edit.to ? withoutPunctuation(reconcileAlignments(oldText.get(v) ?? "", edit.text, groups)) : [];
      if (next.length) {
        verses[sid] = next;
        if (next.length < groups.length) reduced.push(v);
      } else {
        delete verses[sid];
        cleared.push(v);
      }
    }
  }

  const edited = applyVerseEdits(plain, chapter, edits);
  const whole = mergeAlignmentIntoUsfm(edited, { ...doc, verses });
  const written = editedVersesInto(usfm, whole, chapter, normalizeEdits(edits)) ?? whole;
  const besides = versesChangedBesides(usfm, written, chapter, normalizeEdits(edits));
  if (besides.length) throw new Error(tNow("se.wouldChangeOthers").replace("{list}", besides.slice(0, 6).join(", ")));
  return {
    usfm: written,
    clearedVerses: cleared,
    reducedVerses: reduced,
  };
}

/**
 * The book as it was, with the verses that were edited taken from the book written again (`rewritten`): from each
 * one's `\v` to the end of its text. Lifting the alignment out of a book and putting it back writes every verse of
 * it, and the writer does not give back every verse as another tool wrote it (two neighbours of one original word
 * become one group; a word inside `\nd …\nd*` comes back without its link): saving one verse changed lines of
 * verses nobody had touched, or was refused because of them.
 *
 * Null when a verse is not one verse in both books (verses joined or parted, a verse the book did not have): the
 * book written again is then the one to save, and `versesChangedBesides` still stands in its way.
 */
function editedVersesInto(book: string, rewritten: string, chapter: number, edits: Pick<VerseSlotEdit, "from" | "to">[]): string | null {
  const eol = book.includes("\r\n") ? "\r\n" : "\n";
  const verseOf = (usfm: string, edit: Pick<VerseSlotEdit, "from" | "to">) => {
    const hits = listVerseSpans(usfm).filter((span) => span.chapter === chapter && span.verse <= edit.to && span.verseTo >= edit.from);
    const only = hits.length === 1 ? hits[0]! : null;
    return only && !only.segment && only.verse === edit.from && only.verseTo === edit.to ? only : null;
  };
  const pieces: { start: number; end: number; text: string }[] = [];
  for (const edit of edits) {
    const was = verseOf(book, edit);
    const now = verseOf(rewritten, edit);
    if (!was || !now) return null;
    const body = rewritten.slice(now.start, verseParts(rewritten, now).textEnd);
    pieces.push({ start: was.start, end: verseParts(book, was).textEnd, text: body.split(/\r?\n/).join(eol) });
  }
  let out = book;
  for (const piece of pieces.sort((a, b) => b.start - a.start)) out = out.slice(0, piece.start) + piece.text + out.slice(piece.end);
  return out;
}

/**
 * Saving the text of some verses writes the whole book again, and nothing else of it may change: not the words of
 * another verse, not its alignment. It did: quotation marks were moved in verses nobody had touched, and verses
 * of poetry lost their alignment. That is fixed where the book is written; this is what stands in the way if it
 * ever happens again, so the book is not saved that way. Returns the verses («2:4») that would change: their
 * words, or how many of them are aligned.
 */
export function versesChangedBesides(before: string, after: string, chapter: number, edits: Pick<VerseSlotEdit, "from" | "to">[]): string[] {
  const touched = (span: { chapter: number; verse: number; verseTo: number }) =>
    span.chapter === chapter && edits.some((edit) => span.verse <= edit.to && span.verseTo >= edit.from);
  /** The words alone: how they are spaced and laid out is the writer's to choose. */
  const words = (text: string) => (text.match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
  /** How many words of a verse are inside a group. */
  const linked = (raw: string) => {
    let open = 0;
    let count = 0;
    for (const mark of raw.matchAll(/\\zaln-s\b|\\zaln-e\\\*|\\w\s/g)) {
      if (mark[0].startsWith("\\zaln-s")) open++;
      else if (mark[0].startsWith("\\zaln-e")) open--;
      else if (open > 0) count++;
    }
    return count;
  };
  const was = new Map(listVerseSpans(before).map((span) => [`${span.chapter}:${span.verse}`, span]));
  const moved: string[] = [];
  for (const span of listVerseSpans(after)) {
    if (touched(span)) continue;
    const old = was.get(`${span.chapter}:${span.verse}`);
    if (!old) continue;
    if (words(old.text) !== words(span.text) || linked(span.rawBody) < linked(old.rawBody)) moved.push(`${span.chapter}:${span.verse}`);
  }
  return moved;
}
