import type { AlignmentGroup } from "@usfm-tools/types";
import { buildGatewayTokenOccurrences, mapTargetToTokenIndex } from "./helpQuoteMatch";
import { listVerseSpans } from "./usfmEdit";

/**
 * A note points at its phrase with a quote in the original language. Nobody types Greek or Hebrew to fix one: the
 * person marks the words in the aligned text and the quote is worked out from the alignment.
 */

export type OriginalToken = { content: string; occurrence: number };

/** The words of a verse of the original, in order, each with which occurrence of that word it is. */
export function originalTokens(originalUsfm: string, chapter: number, verse: number): OriginalToken[] {
  const span = listVerseSpans(originalUsfm).find((s) => s.chapter === chapter && s.verse <= verse && s.verseTo >= verse);
  if (!span) return [];
  const seen = new Map<string, number>();
  const out: OriginalToken[] = [];
  for (const match of span.rawBody.matchAll(/\\w\s+([^|\\]+?)\s*(?:\|[^\\]*)?\\w\*/g)) {
    const content = match[1]!.normalize("NFC");
    const occurrence = (seen.get(content) ?? 0) + 1;
    seen.set(content, occurrence);
    out.push({ content, occurrence });
  }
  return out;
}

/** Where the words of each group of the alignment are in the verse. */
function groupTokens(verseTokens: string[], groups: AlignmentGroup[]): number[][] {
  const meta = buildGatewayTokenOccurrences(verseTokens);
  return groups.map((group) => group.targets.map((target) => mapTargetToTokenIndex(meta, target)).filter((index) => index >= 0));
}

/**
 * The words of a verse that go together in a quote, for each of its words: those tied to the same words of the
 * original. A quote is in the original, so marking «los» of «en los días de» (one Hebrew word) marks all four, and
 * unmarking one unmarks them all; «mientras … se sentaba» (one Hebrew word too, «el rey Asuero» between) goes
 * together though apart. `null`: a word tied to none, which no quote can have.
 */
export function quoteUnits(verseTokens: string[], groups: AlignmentGroup[]): (number[] | null)[] {
  const units: (number[] | null)[] = verseTokens.map(() => null);
  for (const indices of groupTokens(verseTokens, groups)) {
    for (const index of indices) units[index] = [...new Set([...(units[index] ?? []), ...indices])].sort((a, b) => a - b);
  }
  return units;
}

/** A word touched while marking a quote: it and every word that goes with it, marked or unmarked together. */
export function toggleQuoteWord(selected: number[], index: number, units: (number[] | null)[]): number[] {
  const unit = units[index];
  if (!unit) return selected;
  return selected.includes(index) ? selected.filter((at) => !unit.includes(at)) : [...new Set([...selected, ...unit])].sort((a, b) => a - b);
}

/** Marked words made whole: a word marked brings the words that go with it. Those tied to nothing are let go. */
export function wholeQuoteWords(selected: number[], units: (number[] | null)[]): number[] {
  if (!units.some(Boolean)) return selected;
  return [...new Set(selected.flatMap((index) => units[index] ?? []))].sort((a, b) => a - b);
}

/**
 * The quote for the words marked in a verse of the aligned text: the words of the original those words stand on,
 * in the order of the original, with ` & ` where they are not next to each other (as translation notes write it),
 * and which occurrence of that phrase it is. `null` when the marked words are not aligned.
 */
export function quoteFromSelection(params: { verseTokens: string[]; selected: number[]; groups: AlignmentGroup[]; original: OriginalToken[] }): { quote: string; occurrence: number } | null {
  const { verseTokens, groups, original } = params;
  // Each marked word as the alignment names it, as the words of a quote are found to be marked. Counted without
  // capitals, «Y» and the «y» after it were the first and the second «y», and the alignment counts «Y» and «y»
  // apart: the second «y» marked took the words of another one (20 October).
  const where = groupTokens(verseTokens, groups);
  const positions = new Set<number>();
  for (const index of params.selected) {
    const group = groups.find((_, at) => where[at]!.includes(index));
    if (!group) continue;
    for (const source of group.sources) {
      const at = original.findIndex((token) => token.content === source.content.normalize("NFC") && token.occurrence === source.occurrence);
      if (at >= 0) positions.add(at);
    }
  }
  const ordered = [...positions].sort((a, b) => a - b);
  if (!ordered.length) return null;
  let quote = "";
  ordered.forEach((at, i) => {
    quote += i === 0 ? original[at]!.content : `${ordered[i - 1] === at - 1 ? " " : " & "}${original[at]!.content}`;
  });
  // Which time this phrase starts in the verse: the occurrence of its first word is the closest the format has.
  return { quote, occurrence: original[ordered[0]!]!.occurrence };
}

/** The notes table with one row's quote replaced. `null` when the row is not there. */
export function withQuote(tsv: string, id: string, quote: string, occurrence: number): string | null {
  const eol = tsv.includes("\r\n") ? "\r\n" : "\n";
  const lines = tsv.split(/\r?\n/);
  const header = (lines[0] ?? "").split("\t").map((cell) => cell.trim().toLowerCase());
  const idAt = header.indexOf("id");
  const quoteAt = header.indexOf("quote");
  const occurrenceAt = header.indexOf("occurrence");
  if (idAt < 0 || quoteAt < 0) return null;
  let found = false;
  const next = lines.map((line, index) => {
    if (index === 0 || !line) return line;
    const cells = line.split("\t");
    if ((cells[idAt] ?? "").trim() !== id) return line;
    found = true;
    cells[quoteAt] = quote;
    if (occurrenceAt >= 0) cells[occurrenceAt] = String(occurrence);
    return cells.join("\t");
  });
  return found ? next.join(eol) : null;
}
