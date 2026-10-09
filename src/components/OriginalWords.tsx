import type { OriginalWord } from "../dcs/afinacionLoad";
import { wordSpans } from "../domain/afinacionSelection";
import { useT } from "../i18n/messages";

export const isRtl = (text: string) => /[֐-׿؀-ۿ]/.test(text);

/** A word without what is not a letter of it, to find it among the words the original tags. */
const bare = (word: string) => word.normalize("NFC").replace(/[^\p{L}\p{M}\p{N}]+/gu, "");

/**
 * The verse of the original with each word a button: touching one opens what it means and its grammar, as when
 * aligning. The words are the ones the text is shown in (the marks of a note count them); each is matched with
 * the word the original tags by what it says and which time it says it.
 */
export function OriginalWords({ text, words, marked, onOpen }: { text: string; words: OriginalWord[] | undefined; marked?: number[]; onOpen: (word: OriginalWord) => void }) {
  const t = useT();
  const shown = wordSpans(text);
  if (!shown.length) return <span className="af-empty">{t("af.noText")}</span>;
  const seen = new Map<string, number>();
  /** The word the original tags for a piece of what is shown: the same letters, the same time they are said. */
  const tagged = (piece: string): OriginalWord | undefined => {
    const key = bare(piece);
    if (!key) return undefined;
    const nth = seen.get(key) ?? 0;
    seen.set(key, nth + 1);
    const same = (words ?? []).filter((word) => bare(word.surface) === key);
    return same[nth] ?? same[same.length - 1];
  };
  return (
    <span className="af-words" dir={isRtl(text) ? "rtl" : undefined}>
      {shown.map((w) => (
        // Two words of Hebrew joined by a maqqef are shown as one and tagged as two: each opens its own.
        <span key={w.index} className="af-word" data-marked={marked?.includes(w.index) ? "true" : undefined}>
          {w.text.split(/(?<=־)/).map((piece, at) => {
            const found = tagged(piece);
            return found ? (
              <button key={at} type="button" className="af-word--open" aria-label={t("lx.wordAria").replace("{word}", piece)} onClick={() => onOpen(found)}>
                {piece}
              </button>
            ) : (
              piece
            );
          })}
        </span>
      ))}
    </span>
  );
}
