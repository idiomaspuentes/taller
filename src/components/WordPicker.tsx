import { useState } from "react";
import { fillBetween, toggleWord, unmarkedBetween, wordSpans } from "../domain/afinacionSelection";
import { useT } from "../i18n/messages";
import { isRtl } from "./OriginalWords";

/** A word as it is named on a button: without the signs around it. */
const bare = (text: string) => text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "") || text;

/**
 * The words of a verse, to mark those that say something: a touch marks one word, or takes it off. When words
 * are left between the last two that were touched they are offered in one touch («Marcar las 4 que hay entre
 * «desde» y «clamé»»), so a long run is its first word, its last and that. Only between those two: a word marked
 * before, further away, stays apart, and «one word, some that do not belong, then several» is that word, and
 * then the run. Under them, the whole verse in one touch, or none.
 *
 * It keeps nothing itself: `selected` are the places of the marked words, and what is saved of them is made by
 * `selectionFromWords`.
 */
export function WordPicker({ text, selected, onChange }: { text: string; selected: number[]; onChange: (selected: number[]) => void }) {
  const t = useT();
  const words = wordSpans(text);
  /** The last two words a touch marked, the latest second. */
  const [touched, setTouched] = useState<[number | null, number | null]>([null, null]);
  if (!words.length) return <span className="af-empty">{t("af.noText")}</span>;
  const [before, last] = touched;
  // Offered while both are still marked (what is marked may be changed from outside: another item, «Quitar»).
  const pair = before !== null && last !== null && selected.includes(before) && selected.includes(last) && words[before] && words[last] ? ([Math.min(before, last), Math.max(before, last)] as const) : null;
  const between = pair ? unmarkedBetween(selected, pair[0], pair[1]) : 0;
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
              onClick={() => {
                // Taking a word off starts over: what is offered is between two words just marked.
                setTouched(selected.includes(word.index) ? [null, null] : [last, word.index]);
                onChange(toggleWord(selected, word.index));
              }}
            >
              {word.text}
            </button>
          ))}
        </span>
      </span>
      <div className="af-run">
        {pair && between ? (
          <button
            type="button"
            className="af-run__fill"
            onClick={() => {
              setTouched([null, null]);
              onChange(fillBetween(selected, pair[0], pair[1]));
            }}
          >
            {t(between === 1 ? "af.fillOne" : "af.fillMany")
              .replace("{n}", String(between))
              .replace("{a}", bare(words[pair[0]]!.text))
              .replace("{b}", bare(words[pair[1]]!.text))}
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
