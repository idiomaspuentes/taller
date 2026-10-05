import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { dotsOf, frameWords, marksText, nudgeMarks, readMarks, storyExample, touchMarks, type Marks } from "../domain/storyFrames";
import { useT } from "../i18n/messages";

type Props = {
  /** What the frame is called: «Cuadro 1:1 en las historias del equipo». */
  name: string;
  /** The frame as the team has translated it. */
  frame: string;
  /** The example being translated, as the source has it: its number goes before what is marked. */
  sourcePiece: string;
  /** What the box of the example holds. */
  text: string;
  onWrite: (markdown: string) => void;
};

/**
 * The frame of a Bible story beside the example that quotes it, to mark in it what the example says. Made for a
 * phone: nothing is typed, nothing is pressed long or dragged, and no press takes the cursor (the keyboard stays
 * where it was).
 *
 * Two touches make a part, its first word and its last, and what is marked is written in the box as it is marked.
 * There is nothing to switch on for an example made of several pieces: the next two touches make the next part.
 * A touch on a part takes it away. A finger does not always land on a short word, so the two ends of the last part
 * can also be moved a word at a time, with arrows big enough to hit.
 *
 * While the box is empty, or holds just parts of the frame, it follows the marks. Once somebody has written in it
 * by hand it is theirs: the marks then wait, and a button changes what is written for what is marked.
 */
export function StoryFramePick({ name, frame, sourcePiece, text, onWrite }: Props) {
  const t = useT();
  const words = useMemo(() => frameWords(frame), [frame]);
  const source = useMemo(() => dotsOf(sourcePiece), [sourcePiece]);
  /**
   * What marking last wrote in the box, and the marks it stood for. The text alone does not say everything (which
   * of two «el» was touched, whether a part still waits for its last word), so while the box holds what was written
   * here the marks are the ones made; they are read from the text only when it came from somewhere else.
   */
  const own = useRef<{ text: string; marks: Marks } | null>(null);
  const read = useMemo(() => readMarks(text, words), [text, words]);
  const written: Marks | null = own.current?.text === text ? own.current.marks : read ? { ...read, open: null, current: read.parts.length - 1 } : null;
  const follows = !text.trim() || written !== null;
  const [waiting, setWaiting] = useState<Marks | null>(null);
  // Closing a part of one word changes the marks and not the text: the screen is drawn again all the same.
  const [, redraw] = useState(0);
  const marks = follows ? written : waiting;
  const example = (made: Marks) => storyExample(sourcePiece, marksText(words, made, source.sign));

  const mark = (next: Marks | null) => {
    if (follows) {
      const markdown = next ? example(next) : "";
      own.current = next ? { text: markdown, marks: next } : null;
      onWrite(markdown);
      redraw((n) => n + 1);
    } else setWaiting(next);
  };

  const current = marks?.parts[marks.current];
  const arrow = (end: "first" | "last", by: -1 | 1) => {
    const stuck = !marks || !current || (end === "first" ? (by < 0 ? current[0] === 0 : current[0] === current[1]) : by > 0 ? current[1] === words.length - 1 : current[1] === current[0]);
    return (
      <button
        type="button"
        className="ab-story__arrow"
        disabled={stuck}
        aria-label={`${t(end === "first" ? "ab.storyFirst" : "ab.storyLast")}: ${t(by < 0 ? "ab.storyEarlier" : "ab.storyLater")}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => marks && mark(nudgeMarks(marks, end, by, words.length))}
      >
        {by < 0 ? <ChevronLeft size={20} aria-hidden /> : <ChevronRight size={20} aria-hidden />}
      </button>
    );
  };

  return (
    <div className="ab-story">
      <p className="ab-story__name">{name}</p>
      <p className="ab-story__hint" aria-live="polite">
        {t(!marks ? "ab.storyHint" : marks.open !== null ? "ab.storyHintLast" : "ab.storyHintMore")}
      </p>
      <p className="ab-story__words">
        {words.map((word, at) => {
          const index = marks ? marks.parts.findIndex(([first, last]) => at >= first && at <= last) : -1;
          const part = index >= 0 ? marks!.parts[index]! : null;
          const edge = part ? [at === part[0] ? "first" : "", at === part[1] ? "last" : ""].filter(Boolean).join(" ") : "";
          return (
            // A word and the space after it are one thing to touch: no gap between two words to miss into.
            <button
              key={at}
              type="button"
              className="ab-story__w"
              aria-pressed={Boolean(part)}
              data-edge={edge || undefined}
              data-open={marks && index >= 0 && index === marks.open ? "" : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => mark(touchMarks(marks, at, source.on))}
            >
              {word}{" "}
            </button>
          );
        })}
      </p>
      {marks ? (
        <>
          <div className="ab-story__ends">
            <span className="ab-story__end">
              {t("ab.storyFirst")}
              {arrow("first", -1)}
              {arrow("first", 1)}
            </span>
            <span className="ab-story__end">
              {t("ab.storyLast")}
              {arrow("last", -1)}
              {arrow("last", 1)}
            </span>
          </div>
          <div className="ab-story__acts">
            {follows ? null : (
              <button
                type="button"
                className="ab-story__use"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  const markdown = example(marks);
                  own.current = { text: markdown, marks };
                  onWrite(markdown);
                  setWaiting(null);
                }}
              >
                {t("ab.storyUse")}
              </button>
            )}
            {marks.parts.length > 1 ? (
              <button type="button" role="switch" aria-checked={marks.dots} className="ab-story__btn" onMouseDown={(event) => event.preventDefault()} onClick={() => mark({ ...marks, dots: !marks.dots })}>
                {t("ab.storyDots")}
              </button>
            ) : null}
            <button type="button" className="ab-story__btn" onMouseDown={(event) => event.preventDefault()} onClick={() => mark(null)}>
              {t("ab.storyClear")}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
