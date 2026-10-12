import { useState } from "react";
import { phrasesOf, togglePhrase, toggleWord, wordSpans } from "../domain/afinacionSelection";
import { useT } from "../i18n/messages";

/**
 * Proposal A, being tried (`#/prueba/seleccion`): the verse in the pieces it is read in, each one a line to
 * touch. A touch marks the piece whole or takes it off. What a note marks is nearly always a phrase: twenty words
 * are two or three touches, and there is no rule to learn. For the cases a piece is too much (one word of it),
 * «Ajustar palabra por palabra» shows the words, and a touch marks one.
 */
export function WordPickerPhrases({ text, selected, onChange }: { text: string; selected: number[]; onChange: (selected: number[]) => void }) {
  const t = useT();
  const [byWord, setByWord] = useState(false);
  const words = wordSpans(text);
  const pieces = phrasesOf(text);
  if (!words.length) return <span className="af-empty">{t("af.noText")}</span>;
  return (
    <>
      {byWord ? (
        <span className="af-draft__words">
          <span className="af-words">
            {words.map((word) => (
              <button key={word.index} type="button" className="af-word af-word--tap" data-selected={selected.includes(word.index) ? "true" : undefined} aria-pressed={selected.includes(word.index)} onClick={() => onChange(toggleWord(selected, word.index))}>
                {word.text}
              </button>
            ))}
          </span>
        </span>
      ) : (
        <div className="sp-phrases">
          {pieces.map((piece) => {
            const inside = words.slice(piece.from, piece.to + 1);
            const marked = inside.filter((word) => selected.includes(word.index)).length;
            return (
              <button key={piece.from} type="button" className="sp-phrase" data-selected={marked === inside.length ? "true" : marked ? "part" : undefined} aria-pressed={marked === inside.length} onClick={() => onChange(togglePhrase(selected, piece))}>
                {/* A piece marked in part (word by word) shows which of its words are. */}
                {inside.map((word) => (
                  <span key={word.index} data-in={marked && marked < inside.length && selected.includes(word.index) ? "true" : undefined}>
                    {word.text}{" "}
                  </span>
                ))}
              </button>
            );
          })}
        </div>
      )}
      <div className="af-run">
        <button type="button" className="af-link" onClick={() => setByWord(!byWord)}>
          {t(byWord ? "sp.byPhrase" : "sp.byWord")}
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
