import { fillBetween, toggleWord, unmarkedBetween, wordSpans } from "../domain/afinacionSelection";
import { useT } from "../i18n/messages";
import { isRtl } from "./OriginalWords";

/**
 * The words of a verse, to mark those that say something: a touch marks one word, or takes it off. When words
 * are left between the marked ones they are offered in one touch («Marcar también las 4 de en medio»), so a long
 * run is the first word, the last and that, and two words apart stay two touches. Under them, the whole verse in
 * one touch, or none.
 *
 * It keeps nothing itself: `selected` are the places of the marked words, and what is saved of them is made by
 * `selectionFromWords`.
 */
export function WordPicker({ text, selected, onChange }: { text: string; selected: number[]; onChange: (selected: number[]) => void }) {
  const t = useT();
  const words = wordSpans(text);
  const between = unmarkedBetween(selected);
  if (!words.length) return <span className="af-empty">{t("af.noText")}</span>;
  return (
    <>
      <span className="af-draft__words">
        <span className="af-words" dir={isRtl(text) ? "rtl" : undefined}>
          {words.map((word) => (
            <button
              key={word.index}
              type="button"
              className="af-word af-word--tap"
              data-selected={selected.includes(word.index) ? "true" : undefined}
              aria-pressed={selected.includes(word.index)}
              onClick={() => onChange(toggleWord(selected, word.index))}
            >
              {word.text}
            </button>
          ))}
        </span>
      </span>
      <div className="af-run">
        {between ? (
          <button type="button" className="af-run__fill" onClick={() => onChange(fillBetween(selected))}>
            {t(between === 1 ? "af.fillOne" : "af.fillMany").replace("{n}", String(between))}
          </button>
        ) : null}
        <button type="button" className="af-link" disabled={selected.length === words.length} onClick={() => onChange(words.map((word) => word.index))}>
          {t("af.pickAll")}
        </button>
        {selected.length ? (
          <button type="button" className="af-link" onClick={() => onChange([])}>
            {t("af.pickNone")}
          </button>
        ) : null}
      </div>
    </>
  );
}
