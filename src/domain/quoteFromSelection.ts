import type { AlignmentGroup } from "@usfm-tools/types";
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

const plain = (word: string) => word.replace(/[^\p{L}\p{N}\p{M}]/gu, "").toLowerCase();

/**
 * The quote for the words marked in a verse of the aligned text: the words of the original those words stand on,
 * in the order of the original, with ` & ` where they are not next to each other (as translation notes write it),
 * and which occurrence of that phrase it is. `null` when the marked words are not aligned.
 */
export function quoteFromSelection(params: { verseTokens: string[]; selected: number[]; groups: AlignmentGroup[]; original: OriginalToken[] }): { quote: string; occurrence: number } | null {
  const { verseTokens, groups, original } = params;
  // Each marked token as the alignment names it: the word and which occurrence in the verse.
  const counts = new Map<string, number>();
  const occurrenceAt = verseTokens.map((token) => {
    const key = plain(token);
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    return n;
  });
  const positions = new Set<number>();
  for (const index of params.selected) {
    const word = plain(verseTokens[index] ?? "");
    if (!word) continue;
    const group = groups.find((g) => g.targets.some((t) => plain(t.word) === word && t.occurrence === occurrenceAt[index]));
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
