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

/**
 * How each word is shown: without the braces of the simple text, and whether it is inside them (what the text makes
 * explicit that the original leaves implied). «{antes de que los israelitas regresaran allí},» was shown with its
 * braces, which read as a fault of the text. Only the showing: the words, their positions and what is saved of a
 * choice keep the braces, as the text has them.
 */
export function shownWords(words: WordSpan[]): { text: string; implied: boolean }[] {
  let depth = 0;
  return words.map((word) => {
    const opens = (word.text.match(/\{/g) ?? []).length;
    const closes = (word.text.match(/\}/g) ?? []).length;
    const implied = depth > 0 || opens > 0;
    depth = Math.max(0, depth + opens - closes);
    return { text: word.text.replace(/[{}]/g, "") || word.text, implied };
  });
}

/**
 * The stretch of a verse shown around the words chosen: `around` words before the first and after the last, or the
 * whole verse when it is short. The chosen words were shown alone («Durante el … año»), and the question asks whether
 * they are right *here*, in a verse that was not on the screen (16 October).
 */
export function selectionWindow(count: number, selected: number[], around = 8): { from: number; to: number } {
  if (!selected.length || count <= around * 3) return { from: 0, to: count };
  const first = Math.min(...selected);
  const last = Math.max(...selected);
  return { from: Math.max(0, first - around), to: Math.min(count, last + around + 1) };
}

/**
 * The words of the reference shown in steps 2 and 3: what is highlighted with `around` words before and after, so
 * that the translation under it is in sight; the whole verse took a phone's screen to say three words (19 October).
 * `null` when there is nothing highlighted or too little would be left out (fewer than `least` words): then the
 * whole verse is shown.
 */
export function referenceExcerpt(count: number, marked: number[], around = 3, least = 4): number[] | null {
  if (!marked.length || !count) return null;
  const from = Math.max(0, Math.min(...marked) - around);
  const to = Math.min(count - 1, Math.max(...marked) + around);
  if (count - (to - from + 1) < least) return null;
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** Toggle a word: selections are kept as a set of positions, in verse order. */
export function toggleWord(selected: number[], index: number): number[] {
  return selected.includes(index) ? selected.filter((i) => i !== index) : [...selected, index].sort((a, b) => a - b);
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
