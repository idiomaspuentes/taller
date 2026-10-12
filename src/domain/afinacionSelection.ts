import type { SelectedText } from "@usfm-tools/types";

/**
 * The words of a verse the reviewer marked as the rendering of a note or term.
 * Words are whitespace-separated tokens; the selection is stored as text and
 * offsets plus a snapshot of the verse, so it can be located again (exact,
 * moved, approximate or stale) when the text changes.
 */

export type WordSpan = { index: number; text: string; start: number; end: number };

export function wordSpans(verseText: string): WordSpan[] {
  const spans: WordSpan[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(verseText)) !== null) {
    spans.push({ index: spans.length, text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

/** Toggle a word: selections are kept as a set of positions, in verse order. */
export function toggleWord(selected: number[], index: number): number[] {
  return selected.includes(index) ? selected.filter((i) => i !== index) : [...selected, index].sort((a, b) => a - b);
}

/**
 * How many words between two words are not marked. A touch marks one word and no other, so that two words apart
 * are two touches; a phrase of twelve words would be twelve. When words are left between the last two that were
 * touched, the screen offers to mark them too, in one touch (`fillBetween`): the first word of a run, its last,
 * and that. Only between those two: a word marked earlier, further away, stays apart from the run.
 */
export function unmarkedBetween(selected: number[], a: number, b: number): number {
  let count = 0;
  for (let i = Math.min(a, b) + 1; i < Math.max(a, b); i++) if (!selected.includes(i)) count++;
  return count;
}

/** What is marked, and every word from one word to another. */
export function fillBetween(selected: number[], a: number, b: number): number[] {
  const from = Math.min(a, b);
  const run = Array.from({ length: Math.max(a, b) - from + 1 }, (_, i) => from + i);
  return [...new Set([...selected, ...run])].sort((x, y) => x - y);
}

/** A stretch of a verse that was marked: its text and where it is. */
export type SelectedPart = Pick<SelectedText, "text" | "startOffset" | "endOffset">;

/**
 * What is kept of the words somebody marked. `text` runs from the first to the last of them, as it always did;
 * when they are not all together, `parts` says each stretch on its own, so that the words between two stretches
 * are not taken for marked ones.
 */
export type SelectedWords = SelectedText & { parts?: SelectedPart[] };

/** The words marked, as the stretches they make: `[0, 1, 2, 5, 6]` is two, 0 to 2 and 5 to 6. */
export function stretchesOf(selected: number[]): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (const index of [...new Set(selected)].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && index === last.to + 1) last.to = index;
    else out.push({ from: index, to: index });
  }
  return out;
}

/** The text between the first and the last selected word, and each stretch of it when they are several. */
export function selectionFromWords(
  verseText: string,
  selected: number[],
  ref: { chapter: number; verse: number },
): SelectedWords | undefined {
  if (!selected.length) return undefined;
  const spans = wordSpans(verseText);
  const parts = stretchesOf(selected.filter((i) => spans[i])).map((stretch): SelectedPart => {
    const startOffset = spans[stretch.from]!.start;
    const endOffset = spans[stretch.to]!.end;
    return { text: verseText.slice(startOffset, endOffset), startOffset, endOffset };
  });
  if (!parts.length) return undefined;
  const startOffset = parts[0]!.startOffset;
  const endOffset = parts[parts.length - 1]!.endOffset;
  return {
    text: verseText.slice(startOffset, endOffset),
    startOffset,
    endOffset,
    verseSnapshots: [{ chapter: ref.chapter, verse: ref.verse, text: verseText }],
    ...(parts.length > 1 ? { parts } : {}),
  };
}

/**
 * Which words of the current text a saved selection covers now, or none when it no longer applies. One made of
 * several stretches applies only while every stretch is still in the verse.
 */
export function wordsOfSelection(
  verseText: string,
  selection: (SelectedPart & { parts?: SelectedPart[] }) | undefined,
): number[] {
  if (!selection?.text) return [];
  const spans = wordSpans(verseText);
  const wordsOf = (part: SelectedPart): number[] => {
    let start = part.startOffset;
    let end = part.endOffset;
    if (verseText.slice(start, end) !== part.text) {
      const at = verseText.indexOf(part.text);
      if (at < 0) return [];
      start = at;
      end = at + part.text.length;
    }
    return spans.filter((s) => s.start < end && s.end > start).map((s) => s.index);
  };
  const parts = Array.isArray(selection.parts) && selection.parts.length > 1 ? selection.parts : null;
  if (!parts) return wordsOf(selection);
  const found = parts.map(wordsOf);
  return found.every((words) => words.length) ? [...new Set(found.flat())].sort((a, b) => a - b) : [];
}

// ---------------------------------------------------------------- two other ways to mark, being tried

/**
 * The pieces a verse is read in: cut where its punctuation cuts it, and a long piece cut again before a word that
 * joins («y», «pero», «porque»), so that none is a line and a half of a phone. What a note marks is nearly always
 * a phrase, and a phrase is one of these or a few of them: a touch on a piece marks it whole.
 */
export function phrasesOf(verseText: string, most = 7): { from: number; to: number }[] {
  const words = wordSpans(verseText);
  const pieces: { from: number; to: number }[] = [];
  let from = 0;
  words.forEach((word, i) => {
    if (/[,;:.!?»”)]$/.test(word.text) || i === words.length - 1) {
      pieces.push({ from, to: i });
      from = i + 1;
    }
  });
  const JOINS = /^(y|e|o|u|ni|pero|sino|porque|pues|que|para|cuando|como|aunque|e|ou|mas|porém|quando)$/i;
  return pieces.flatMap((piece) => {
    const out: { from: number; to: number }[] = [];
    let start = piece.from;
    for (let i = piece.from + 3; i <= piece.to - 2; i++) {
      // Only where both sides are left with something to read.
      if (piece.to - start + 1 > most && i - start >= 3 && JOINS.test(words[i]!.text)) {
        out.push({ from: start, to: i - 1 });
        start = i;
      }
    }
    out.push({ from: start, to: piece.to });
    return out;
  });
}

/** A piece marked whole, or taken off whole when all of it was marked. */
export function togglePhrase(selected: number[], piece: { from: number; to: number }): number[] {
  const words = Array.from({ length: piece.to - piece.from + 1 }, (_, i) => piece.from + i);
  const all = words.every((i) => selected.includes(i));
  return all ? selected.filter((i) => i < piece.from || i > piece.to) : [...new Set([...selected, ...words])].sort((a, b) => a - b);
}

/** How a stretch of marked words is moved by one word at one of its ends. */
export type EndMove = "startEarlier" | "startLater" | "endEarlier" | "endLater";

/**
 * A stretch with one of its ends moved a word: it begins a word earlier or later, or ends a word earlier or
 * later. Nothing changes when there is no word to take in, or when the stretch is one word and would be none.
 */
export function moveEnd(selected: number[], stretch: { from: number; to: number }, move: EndMove, wordCount: number): number[] {
  const add = (i: number) => (i < 0 || i >= wordCount ? selected : [...new Set([...selected, i])].sort((a, b) => a - b));
  const drop = (i: number) => (stretch.from === stretch.to ? selected : selected.filter((other) => other !== i));
  if (move === "startEarlier") return add(stretch.from - 1);
  if (move === "endLater") return add(stretch.to + 1);
  return drop(move === "startLater" ? stretch.from : stretch.to);
}
