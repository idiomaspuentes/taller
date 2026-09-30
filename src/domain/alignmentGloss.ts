import type { OriginalWordToken } from "@usfm-tools/editor-core";
import type { AlignmentGroup } from "@usfm-tools/types";

/** Same word, ignoring Hebrew points and accents, Greek diacritics, the maqaf and invisible joiners. */
function sameWord(a: string, b: string): boolean {
  const plain = (text: string) =>
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f\u0591-\u05c7\u05be]/g, "")
      .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
      .normalize("NFC")
      .toLocaleLowerCase("es");
  return plain(a) === plain(b);
}

/**
 * A short English gloss for each word of the original, taken from the aligned ULT
 * (or UST): the English words that the ULT links to that word. It helps whoever
 * does not read Hebrew or Greek to know which word a box is about.
 *
 * Words are matched by form and occurrence. A group that links several original
 * words to one English phrase gives that phrase to each of them.
 */
export function glossesFor(original: OriginalWordToken[], groups: AlignmentGroup[]): string[] {
  return original.map((token) => {
    const group = groups.find((g) =>
      g.sources.some((s) => sameWord(s.content, token.surface) && s.occurrence === token.occurrence),
    );
    if (!group) return "";
    return group.targets
      .map((t) => t.word.trim())
      .filter(Boolean)
      .join(" ");
  });
}

/** Keeps a gloss short enough for a box: the first words, then an ellipsis. */
export function shortGloss(gloss: string, maxChars = 22): string {
  const text = gloss.trim();
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const at = cut.lastIndexOf(" ");
  return `${(at > 6 ? cut.slice(0, at) : cut).trimEnd()}…`;
}
