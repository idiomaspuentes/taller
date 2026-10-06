import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { frameSentences, proposedSentences, readSentences, sentencesText, storyExample } from "../domain/storyFrames";
import { useT } from "../i18n/messages";
import { HelpMarkdownView } from "./HelpMarkdownView";
import { StoryFramePick } from "./StoryFramePick";

type Props = {
  /** What the frame is called: «Cuadro 1:1 en las historias del equipo». */
  name: string;
  /** The frame as the team has translated it. */
  frame: string;
  /** The same frame as the source has it; empty when it could not be read. */
  sourceFrame: string;
  /** The example being translated, as the source has it. */
  sourcePiece: string;
  /** The terms the article is about, in the team's language: what the example shows in bold. */
  terms: string[];
  /** What the article has for this example. */
  text: string;
  onWrite: (markdown: string) => void;
  /** The box to write in by hand is open under this. */
  hand: boolean;
  onHand: (on: boolean) => void;
  /** Go on from this example, as its «Siguiente» does. */
  goOn: () => void;
  /** The way on («Siguiente», or «Listo» on the last piece). */
  next: React.ReactNode;
};

/**
 * An example an article takes from a Bible story, translated from the story the team already has.
 *
 * The app proposes: the sentences of the team's frame that stand where the example's stand in the source frame,
 * with the article's word in bold. Whoever translates reads the proposal under the example and says it is right,
 * one press. When it is not, or when the app could not propose (an example far from its frame, frames cut into
 * different sentences), the frame is shown a sentence at a time to touch the one that says it. An example is
 * nearly always whole sentences (see `storyFrames`), so marking it word by word, which this used to open with, is
 * kept for the rare piece of a sentence, one press further in; and so is writing it by hand.
 */
export function StoryExample({ name, frame, sourceFrame, sourcePiece, terms, text, onWrite, hand, onHand, goOn, next }: Props) {
  const t = useT();
  const sentences = useMemo(() => frameSentences(frame), [frame]);
  const proposal = useMemo(() => {
    const run = proposedSentences(sourcePiece, sourceFrame, frame);
    return run ? storyExample(sourcePiece, sentencesText(frame, Array.from({ length: run[1] - run[0] + 1 }, (_, n) => run[0] + n), terms)) : "";
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the terms are a new list each time, with the same words
  }, [sourcePiece, sourceFrame, frame, terms.join("|")]);
  /** What the person asked to see instead of what the example opens with. */
  const [mode, setMode] = useState<"auto" | "sentences" | "words">("auto");
  const picked = useMemo(() => readSentences(text, frame) ?? [], [text, frame]);
  const has = Boolean(text.trim());

  const result = has ? (
    <>
      <p className="ab-result__name">{t("ab.result")}</p>
      <HelpMarkdownView className="ab-result__text" content={text} />
    </>
  ) : null;
  const link = (label: string, run: () => void) => (
    <button type="button" className="ab-act" onClick={run}>
      {label}
    </button>
  );

  if (hand) {
    // Written by hand, in the box under this: the frame stays in sight, to read from.
    return (
      <div className="ab-story">
        <p className="ab-story__name">{name}</p>
        <p className="ab-story__frame">{frame}</p>
        <div className="ab-story__more">{link(t("ab.fromFrame"), () => onHand(false))}</div>
      </div>
    );
  }

  if (mode === "words") {
    return (
      <div className="ab-result">
        <StoryFramePick name={name} frame={frame} sourcePiece={sourcePiece} text={text} onWrite={onWrite} />
        <div className="ab-story__more">
          {link(t("ab.wholeSentences"), () => setMode("sentences"))}
          {link(t("ab.byHand"), () => onHand(true))}
        </div>
        {result}
        <div className="ab-result__bar">{next ? <div className="mde-trailing">{next}</div> : null}</div>
      </div>
    );
  }

  if (mode === "sentences" || (!has && !proposal)) {
    const toggle = (at: number) => {
      const chosen = picked.includes(at) ? picked.filter((other) => other !== at) : [...picked, at];
      // The frame stays open once a sentence is touched: an example may be two of them.
      setMode("sentences");
      onWrite(chosen.length ? storyExample(sourcePiece, sentencesText(frame, chosen, terms)) : "");
    };
    return (
      <div className="ab-result">
        <div className="ab-story">
          <p className="ab-story__name">{name}</p>
          <p className="ab-story__hint">{t("ab.sentencesHint")}</p>
          <ul className="ab-sents">
            {sentences.map((sentence, at) => (
              <li key={at}>
                {/* The press must not take the cursor: nothing here is typed. */}
                <button type="button" className="ab-sent" aria-pressed={picked.includes(at)} onMouseDown={(event) => event.preventDefault()} onClick={() => toggle(at)}>
                  {sentence}
                </button>
              </li>
            ))}
          </ul>
          <div className="ab-story__more">
            {link(t("ab.partOnly"), () => setMode("words"))}
            {link(t("ab.byHand"), () => onHand(true))}
          </div>
        </div>
        {result}
        <div className="ab-result__bar">{next ? <div className="mde-trailing">{next}</div> : null}</div>
      </div>
    );
  }

  if (!has) {
    // Nothing written yet and the app has something to propose: it is read against the example, and taken or not.
    return (
      <div className="ab-result">
        <p className="ab-result__name">{t("ab.proposal")}</p>
        <HelpMarkdownView className="ab-result__text" content={proposal} />
        <div className="ab-result__bar">
          {link(t("ab.change"), () => setMode("sentences"))}
          <div className="mde-trailing">
            <button
              type="button"
              className="ab-next ab-next--done"
              onClick={() => {
                onWrite(proposal);
                goOn();
              }}
            >
              <Check size={16} aria-hidden /> {t("ab.proposalOk")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Translated already: it reads as text, with the way to change it and the way on.
  return (
    <div className="ab-result">
      {result}
      <div className="ab-result__bar">
        {link(t("ab.change"), () => setMode("sentences"))}
        {next ? <div className="mde-trailing">{next}</div> : null}
      </div>
    </div>
  );
}
