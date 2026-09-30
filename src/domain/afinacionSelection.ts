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

/** The text between the first and the last selected word (words in between are included). */
export function selectionFromWords(
  verseText: string,
  selected: number[],
  ref: { chapter: number; verse: number },
): SelectedText | undefined {
  if (!selected.length) return undefined;
  const spans = wordSpans(verseText);
  const picked = selected.map((i) => spans[i]).filter((s): s is WordSpan => Boolean(s));
  if (!picked.length) return undefined;
  const startOffset = picked[0]!.start;
  const endOffset = picked[picked.length - 1]!.end;
  return {
    text: verseText.slice(startOffset, endOffset),
    startOffset,
    endOffset,
    verseSnapshots: [{ chapter: ref.chapter, verse: ref.verse, text: verseText }],
  };
}

/** Which words of the current text a saved selection covers now, or none when it no longer applies. */
export function wordsOfSelection(
  verseText: string,
  selection: Pick<SelectedText, "text" | "startOffset" | "endOffset"> | undefined,
): number[] {
  if (!selection?.text) return [];
  const spans = wordSpans(verseText);
  let start = selection.startOffset;
  let end = selection.endOffset;
  if (verseText.slice(start, end) !== selection.text) {
    const at = verseText.indexOf(selection.text);
    if (at < 0) return [];
    start = at;
    end = at + selection.text.length;
  }
  return spans.filter((s) => s.start < end && s.end > start).map((s) => s.index);
}
