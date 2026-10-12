import { useRef } from "react";
import { toggleWord, wordSpans } from "../domain/afinacionSelection";
import { useT } from "../i18n/messages";
import { isRtl } from "./OriginalWords";

/**
 * The words of a verse, to mark those that say something, as with a highlighter. A touch marks one word, or takes
 * it off. A finger slid over the words marks all it passes, from the word it began on to the one it is on, across
 * lines as reading goes; begun on a marked word, the same stroke takes them off. Each stroke is a stretch, so
 * several stretches are several strokes: there is no button, no rule to learn, and nothing marked beforehand.
 *
 * The page still moves under a finger that goes up or down first (`touch-action: pan-y`): a stroke is one that
 * begins sideways, and may then go down to the next lines.
 *
 * It keeps nothing itself: `selected` are the places of the marked words, and what is saved of them is made by
 * `selectionFromWords`.
 */
export function WordPicker({ text, selected, onChange }: { text: string; selected: number[]; onChange: (selected: number[]) => void }) {
  const t = useT();
  const words = wordSpans(text);
  /** The stroke in hand: the word it began on, what was marked then, and whether it marks or takes off. */
  const stroke = useRef<{ from: number; base: number[]; marks: boolean; moved: boolean } | null>(null);
  /** A stroke that ends on the word it began on is followed by a click there, which is not a touch of its own. */
  const justStroked = useRef(false);
  if (!words.length) return <span className="af-empty">{t("af.noText")}</span>;
  const wordAt = (x: number, y: number): number | null => {
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-word]");
    return hit ? Number(hit.dataset.word) : null;
  };
  return (
    <span className="af-draft__words">
      <span
        className="af-words af-words--stroke"
        dir={isRtl(text) ? "rtl" : undefined}
        onPointerDown={(event) => {
          const from = wordAt(event.clientX, event.clientY);
          justStroked.current = false;
          stroke.current = from === null ? null : { from, base: selected, marks: !selected.includes(from), moved: false };
        }}
        onPointerMove={(event) => {
          const now = stroke.current;
          // A mouse that only passes over, with no button down, is no stroke.
          if (!now || (event.pointerType === "mouse" && event.buttons === 0)) return;
          const at = wordAt(event.clientX, event.clientY);
          if (at === null || (at === now.from && !now.moved)) return;
          now.moved = true;
          const run = new Set(Array.from({ length: Math.abs(at - now.from) + 1 }, (_, i) => Math.min(at, now.from) + i));
          onChange(now.marks ? [...new Set([...now.base, ...run])].sort((a, b) => a - b) : now.base.filter((index) => !run.has(index)));
        }}
        onPointerUp={() => {
          justStroked.current = Boolean(stroke.current?.moved);
          stroke.current = null;
        }}
        onPointerCancel={() => {
          // The page took the gesture to move: what the stroke had marked on its way is undone.
          if (stroke.current?.moved) onChange(stroke.current.base);
          stroke.current = null;
        }}
      >
        {words.map((word) => (
          <button
            key={word.index}
            type="button"
            className="af-word af-word--tap"
            data-word={word.index}
            data-selected={selected.includes(word.index) ? "true" : undefined}
            aria-pressed={selected.includes(word.index)}
            onClick={() => {
              if (justStroked.current) justStroked.current = false;
              else onChange(toggleWord(selected, word.index));
            }}
          >
            {word.text}
          </button>
        ))}
      </span>
    </span>
  );
}
