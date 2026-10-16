import type { OriginalWord } from "../dcs/afinacionLoad";
import { wordSpans } from "../domain/afinacionSelection";
import { referentKey } from "../domain/referents";
import { useT } from "../i18n/messages";

export const isRtl = (text: string) => /[֐-׿؀-ۿ]/.test(text);

/** A word without what is not a letter of it, to find it among the words the original tags. */
const bare = (word: string) => word.normalize("NFC").replace(/[^\p{L}\p{M}\p{N}]+/gu, "");

/**
 * The verse of the original with each word a button: touching one opens what it means and its grammar, as when
 * aligning. The words are the ones the text is shown in (the marks of a note count them); each is matched with
 * the word the original tags by what it says and which time it says it.
 */
/** `only`: show just those words of the verse (with «…» where others are left out), each still opening its own. */
export function OriginalWords({ text, words, marked, only, onOpen }: { text: string; words: OriginalWord[] | undefined; marked?: number[]; only?: number[]; onOpen: (word: OriginalWord) => void }) {
  const t = useT();
  const shown = wordSpans(text);
  if (!shown.length) return <span className="af-empty">{t("af.noText")}</span>;
  const seen = new Map<string, number>();
  /** Which one a word is among those of the verse with the same letters: who it refers to is found by that. */
  const lettered = new Map<string, number>();
  /** The word the original tags for a piece of what is shown: the same letters, the same time they are said. */
  const tagged = (piece: string): OriginalWord | undefined => {
    const key = bare(piece);
    if (!key) return undefined;
    const nth = seen.get(key) ?? 0;
    seen.set(key, nth + 1);
    const same = (words ?? []).filter((word) => bare(word.surface) === key);
    const found = same[nth] ?? same[same.length - 1];
    if (!found) return undefined;
    const letters = referentKey(found.surface);
    const occurrence = lettered.get(letters) ?? 0;
    lettered.set(letters, occurrence + 1);
    return { ...found, occurrence };
  };
  return (
    <span className="af-words" dir={isRtl(text) ? "rtl" : undefined}>
      {shown.map((w, at) => {
        // Every word is looked up, shown or not: which one a word is among those with the same letters counts them all.
        const pieces = w.text.split(/(?<=־)/).map((piece) => ({ piece, found: tagged(piece) }));
        if (only && !only.includes(w.index)) return null;
        const gap = only && at > 0 && !only.includes(w.index - 1) && only.some((index) => index < w.index);
        return (
          <span key={w.index} className="af-word" data-marked={marked?.includes(w.index) ? "true" : undefined}>
            {gap ? <span className="af-word__gap" aria-hidden>… </span> : null}
            {/* Two words of Hebrew joined by a maqqef are shown as one and tagged as two: each opens its own. */}
            {pieces.map(({ piece, found }, i) =>
              found ? (
                <button key={i} type="button" className="af-word--open" aria-label={t("lx.wordAria").replace("{word}", piece)} onClick={() => onOpen(found)}>
                  {piece}
                </button>
              ) : (
                piece
              ),
            )}
          </span>
        );
      })}
    </span>
  );
}
