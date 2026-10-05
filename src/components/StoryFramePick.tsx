import { useMemo, useRef, useState } from "react";
import { frameWords, gapOf, marksText, pickedRanges, storyExample, touchMarks, type Marks, type WordRange } from "../domain/storyFrames";
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
 * The frame of a Bible story beside the example that quotes it, to mark in it what the example says. The example
 * is a piece of the frame cut by hand, often in the middle of a sentence, so it is marked to the word: its first
 * word is touched and then its last, and it is written in the box as it is marked. An example that leaves
 * something out («God … the universe … in six days») is marked a part at a time, and what was left out is shown
 * between the parts as its source shows it. Made for a phone: nothing is typed, and no press takes the cursor (the
 * keyboard stays where it was).
 *
 * While the box is empty, or holds just parts of the frame, it follows the marks. Once somebody has written in it
 * by hand it is theirs: the marks then wait, and a button changes what is written for what is marked.
 */
export function StoryFramePick({ name, frame, sourcePiece, text, onWrite }: Props) {
  const t = useT();
  const words = useMemo(() => frameWords(frame), [frame]);
  /**
   * What marking last wrote in the box, and the parts it stood for. The text alone does not always say which words
   * were marked (a frame says «el» more than once), so while the box still holds what was written here, the parts
   * are the ones marked; they are read from the text only when it came from somewhere else (another day, a hand).
   */
  const own = useRef<{ text: string; parts: WordRange[] } | null>(null);
  const read = useMemo(() => pickedRanges(text, words), [text, words]);
  const written = own.current?.text === text ? own.current.parts : read;
  const follows = !text.trim() || written !== null;
  const [waiting, setWaiting] = useState<WordRange[] | null>(null);
  /** The part the next touch moves, and whether the next touch starts a part of its own. */
  const [active, setActive] = useState(0);
  const [another, setAnother] = useState(false);
  const parts = (follows ? written : waiting) ?? [];
  const example = (marked: WordRange[]) => storyExample(sourcePiece, marksText(words, marked, gapOf(sourcePiece)));

  const mark = (next: Marks | null) => {
    setAnother(false);
    setActive(next?.active ?? 0);
    if (follows) {
      const markdown = next ? example(next.parts) : "";
      own.current = next ? { text: markdown, parts: next.parts } : null;
      onWrite(markdown);
    } else setWaiting(next?.parts ?? null);
  };

  return (
    <div className="ab-story">
      <p className="ab-story__name">{name}</p>
      <p className="ab-story__hint">{t(another ? "ab.storyMoreOn" : "ab.storyHint")}</p>
      <p className="ab-story__words">
        {words.map((word, at) => {
          const part = parts.find(([first, last]) => at >= first && at <= last);
          const edge = part ? [at === part[0] ? "first" : "", at === part[1] ? "last" : ""].filter(Boolean).join(" ") : "";
          return (
            // A word and the space after it are one thing to touch: no gap between two words to miss into.
            <button
              key={at}
              type="button"
              className="ab-story__w"
              aria-pressed={Boolean(part)}
              data-edge={edge || undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => mark(touchMarks(parts.length ? { parts, active: Math.min(active, parts.length - 1) } : null, at, another))}
            >
              {word}{" "}
            </button>
          );
        })}
      </p>
      {parts.length ? (
        <>
          <div className="ab-story__acts">
            {follows ? null : (
              <button
                type="button"
                className="ab-story__use"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  const markdown = example(parts);
                  own.current = { text: markdown, parts };
                  onWrite(markdown);
                  setWaiting(null);
                }}
              >
                {t("ab.storyUse")}
              </button>
            )}
            <button type="button" className="ab-story__more" aria-pressed={another} onMouseDown={(event) => event.preventDefault()} onClick={() => setAnother(!another)}>
              {t("ab.storyMore")}
            </button>
            <button type="button" className="ab-act" onMouseDown={(event) => event.preventDefault()} onClick={() => mark(null)}>
              {t("ab.storyClear")}
            </button>
          </div>
          <p className="ab-story__hint">{t("ab.storyMoreHint")}</p>
        </>
      ) : null}
    </div>
  );
}
