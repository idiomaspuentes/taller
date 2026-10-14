/**
 * The words of a translation aligned with each word of the original, for the sentence diagram: under each Hebrew
 * or Greek word, how the team's text says it (or the ULT where the team's is not aligned). The lexicon's gloss is
 * the dictionary form («cimentar», «construir»); the aligned words are the ones of this verse («pusieron los
 * cimientos», «los constructores»).
 */
import type { AlignmentGroup } from "@usfm-tools/types";

/** A word of the original as the alignment and the app's text write it: the joiner between its parts is not counted. */
const plain = (text: string) => text.normalize("NFC").replace(/⁠/g, "").trim();

/**
 * For each word of the verse, in order, the words of the translation aligned with it, as they are read; empty
 * when it is aligned with none. Words of the original aligned together share their words. `occurrence` is counted
 * here, among the like words of the verse, as the alignment counts it.
 */
export function alignedWordsOfVerse(groups: AlignmentGroup[] | undefined, words: Array<{ surface: string }>): string[] {
  if (!groups?.length) return words.map(() => "");
  const byWord = new Map<string, string>();
  for (const group of groups) {
    const said = group.targets.map((target) => target.word.trim()).filter(Boolean).join(" ");
    if (!said) continue;
    for (const source of group.sources) byWord.set(`${plain(source.content)}#${source.occurrence || 1}`, said);
  }
  const seen = new Map<string, number>();
  return words.map((word) => {
    const key = plain(word.surface);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return byWord.get(`${key}#${n}`) ?? "";
  });
}

/** Whether a verse is aligned at all: some word of the original has words of the translation. */
export function verseIsAligned(groups: AlignmentGroup[] | undefined): boolean {
  return Boolean(groups?.some((group) => group.sources.length && group.targets.some((target) => target.word.trim())));
}
