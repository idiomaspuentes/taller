import { ChevronDown, ChevronUp } from "lucide-react";

/**
 * The way to the verse or the help before and after the one being written, without letting the keyboard go down:
 * with it up there was no visible way on, and one had to close it, scroll and touch the other verse (B4).
 *
 * Two round arrows of a soft colour, without words (the way on stays in view and is never a filled button: only
 * deciding is); their name is for a screen reader. A press must not take the cursor out of the box: `pointerdown`
 * covers a touch as well as a mouse. The handler opens the other box and focuses it while the press is handled, as
 * a phone raises (and keeps) its keyboard only for a focus given then. Without `onPrev` or `onNext`, that arrow is
 * not shown.
 */
export function StepArrows({ onPrev, onNext, prevLabel, nextLabel }: { onPrev?: () => void; onNext?: () => void; prevLabel: string; nextLabel: string }) {
  if (!onPrev && !onNext) return null;
  return (
    <span className="step-arrows">
      {onPrev ? (
        <button type="button" className="step-arrows__btn" aria-label={prevLabel} title={prevLabel} onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()} onClick={onPrev}>
          <ChevronUp aria-hidden />
        </button>
      ) : null}
      {onNext ? (
        <button type="button" className="step-arrows__btn" aria-label={nextLabel} title={nextLabel} onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()} onClick={onNext}>
          <ChevronDown aria-hidden />
        </button>
      ) : null}
    </span>
  );
}
