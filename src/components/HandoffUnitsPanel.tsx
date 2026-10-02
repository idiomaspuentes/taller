import { useMemo, useState } from "react";
import { Scissors } from "lucide-react";
import { groupPortionsByChapter, portionKey } from "../domain/chapters";
import { cutsOfChapter, splitChapter } from "../domain/handoff";
import type { HandoffUnit, Portion } from "../domain/types";
import { useT } from "../i18n/messages";

/**
 * What moves together from one phase to the next. Every chapter is one unit; whoever prepares the book can cut a long
 * one into stretches, and each stretch then moves on by itself. The cuts can only fall between portions.
 */
export function HandoffUnitsPanel(props: { portions: Portion[]; units: HandoffUnit[] | undefined; onChange: (units: HandoffUnit[]) => void }) {
  const t = useT();
  const chapters = useMemo(() => groupPortionsByChapter(props.portions), [props.portions]);
  const [open, setOpen] = useState<number | null>(null);
  const splittable = chapters.filter((chapter) => chapter.portions.length > 1);
  if (!chapters.length) return null;

  const splitCount = chapters.filter((chapter) => cutsOfChapter(props.units, chapter.chapter, chapter.portions.map(portionKey)).length > 0).length;

  return (
    <section className="hub-panel handoff" aria-labelledby="handoff-title">
      <h2 id="handoff-title" className="handoff__title">
        {t("ho.title")}
      </h2>
      <p className="handoff__lede">{t("ho.lede")}</p>
      <p className="handoff__summary">
        {splitCount === 0
          ? t("ho.allWhole").replace("{n}", String(chapters.length))
          : t(splitCount === 1 ? "ho.someSplitOne" : "ho.someSplitMany").replace("{n}", String(splitCount))}
      </p>
      {!splittable.length ? <p className="handoff__hint">{t("ho.nothingToSplit")}</p> : null}
      <ul className="handoff__list">
        {splittable.map((chapter) => {
          const ids = chapter.portions.map(portionKey);
          const cuts = cutsOfChapter(props.units, chapter.chapter, ids);
          const isOpen = open === chapter.chapter;
          return (
            <li key={chapter.chapter} className="handoff__chapter" data-split={cuts.length ? "true" : undefined}>
              <button type="button" className="handoff__head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : chapter.chapter)}>
                <span className="handoff__name">{t("ho.chapter").replace("{n}", String(chapter.chapter))}</span>
                <span className="handoff__state">
                  {cuts.length ? t("ho.parts").replace("{n}", String(cuts.length + 1)) : t("ho.whole").replace("{n}", String(ids.length))}
                </span>
              </button>
              {isOpen ? (
                <div className="handoff__body">
                  <p className="handoff__hint">{t("ho.cutHint")}</p>
                  <ol className="handoff__portions">
                    {chapter.portions.map((portion, index) => (
                      <li key={portionKey(portion)}>
                        <span className="handoff__portion">{portion.ref}</span>
                        {index < ids.length - 1 ? (
                          <button
                            type="button"
                            className="handoff__cut"
                            aria-pressed={cuts.includes(index)}
                            onClick={() => {
                              const next = cuts.includes(index) ? cuts.filter((cut) => cut !== index) : [...cuts, index];
                              props.onChange(splitChapter(props.units, chapter.chapter, ids, next));
                            }}
                          >
                            <Scissors aria-hidden />
                            {cuts.includes(index) ? t("ho.joinHere") : t("ho.cutHere")}
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
