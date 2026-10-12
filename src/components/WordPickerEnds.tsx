import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { moveEnd, stretchesOf, toggleWord, wordSpans, type EndMove } from "../domain/afinacionSelection";
import { useT } from "../i18n/messages";

/**
 * Proposal B, being tried (`#/prueba/seleccion`): the app marks what it takes for the answer, and the person says
 * whether that is it. What is wrong is put right at the ends of each stretch, with two large buttons each: it
 * begins a word earlier or later, it ends a word earlier or later. No small word has to be hit with a thumb. A
 * touch on a word still marks it, which is how another stretch is begun.
 */
export function WordPickerEnds({ text, selected, onChange }: { text: string; selected: number[]; onChange: (selected: number[]) => void }) {
  const t = useT();
  const words = wordSpans(text);
  const stretches = stretchesOf(selected);
  if (!words.length) return <span className="af-empty">{t("af.noText")}</span>;
  const move = (stretch: { from: number; to: number }, how: EndMove) => onChange(moveEnd(selected, stretch, how, words.length));
  return (
    <>
      <span className="af-draft__words">
        <span className="af-words">
          {words.map((word) => (
            <button key={word.index} type="button" className="af-word af-word--tap" data-selected={selected.includes(word.index) ? "true" : undefined} aria-pressed={selected.includes(word.index)} onClick={() => onChange(toggleWord(selected, word.index))}>
              {word.text}
            </button>
          ))}
        </span>
      </span>
      <div className="sp-ends">
        {stretches.map((stretch, i) => (
          <div key={stretch.from} className="sp-end" role="group" aria-label={t("sp.stretchN").replace("{n}", String(i + 1))}>
            <div className="sp-end__head">
              <span className="af-lbl">{stretches.length > 1 ? t("sp.stretchN").replace("{n}", String(i + 1)) : t("sp.marked")}</span>
              <button type="button" className="th-icon" aria-label={t("sp.dropStretch")} title={t("sp.dropStretch")} onClick={() => onChange(selected.filter((index) => index < stretch.from || index > stretch.to))}>
                <X size={16} aria-hidden />
              </button>
            </div>
            <div className="sp-end__row">
              <span className="sp-end__what">
                {t("sp.beginsAt")} <b>{words[stretch.from]!.text}</b>
              </span>
              <button type="button" className="sp-step" disabled={stretch.from === 0} aria-label={t("sp.startEarlier")} title={t("sp.startEarlier")} onClick={() => move(stretch, "startEarlier")}>
                <ChevronLeft size={20} aria-hidden />
              </button>
              <button type="button" className="sp-step" disabled={stretch.from === stretch.to} aria-label={t("sp.startLater")} title={t("sp.startLater")} onClick={() => move(stretch, "startLater")}>
                <ChevronRight size={20} aria-hidden />
              </button>
            </div>
            <div className="sp-end__row">
              <span className="sp-end__what">
                {t("sp.endsAt")} <b>{words[stretch.to]!.text}</b>
              </span>
              <button type="button" className="sp-step" disabled={stretch.from === stretch.to} aria-label={t("sp.endEarlier")} title={t("sp.endEarlier")} onClick={() => move(stretch, "endEarlier")}>
                <ChevronLeft size={20} aria-hidden />
              </button>
              <button type="button" className="sp-step" disabled={stretch.to === words.length - 1} aria-label={t("sp.endLater")} title={t("sp.endLater")} onClick={() => move(stretch, "endLater")}>
                <ChevronRight size={20} aria-hidden />
              </button>
            </div>
          </div>
        ))}
        {!stretches.length ? <p className="af-hint">{t("sp.tapToStart")}</p> : <p className="af-hint">{t("sp.tapForAnother")}</p>}
      </div>
    </>
  );
}
