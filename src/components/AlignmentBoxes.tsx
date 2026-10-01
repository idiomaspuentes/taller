import { useMemo } from "react";
import { useT } from "../i18n/messages";
import type { OriginalWordToken, WordToken } from "@usfm-tools/editor-core";
import type { AlignmentGroup } from "@usfm-tools/types";
import { computeAlignedSourceIndices, deriveAlignmentBoxes, transIndexForAlignedWord, type AlignmentBoxModel } from "@usfm-ast/alignment-box-model";
import { shortGloss } from "../domain/alignmentGloss";
import { boxKey } from "../domain/verseEditView";

export type BoxTone = "changed" | "objected";

type Props = {
  original: OriginalWordToken[];
  /** English gloss of each word of the original, same order. */
  gloss: string[];
  draft: WordToken[];
  groups: AlignmentGroup[];
  rtl: boolean;
  /** Boxes to call out: what a proposal changes (one colour) or what an objection is about (yellow). */
  highlight?: { keys: Set<string>; tone: BoxTone };
  /** Empty boxes folded into one line (default) or shown as slim boxes. */
  foldEmpty?: boolean;
  /** A reviewer points at boxes: tap to pick (yellow). */
  onPick?: (box: AlignmentBoxModel) => void;
  picked?: Set<string>;
  label?: string;
};

/**
 * The alignment of a verse as the same boxes the person who aligns works with, read only and
 * compact: each box holds the word of the original (with its English gloss) and the words of the
 * draft linked to it. Used in the review and in the cards of the team decisions.
 */
export function AlignmentBoxes({ original, gloss, draft, groups, rtl, highlight, foldEmpty = true, onPick, picked, label }: Props) {
  const t = useT();
  const boxes = useMemo(() => deriveAlignmentBoxes(original, groups, draft), [original, groups, draft]);
  const aligned = useMemo(() => computeAlignedSourceIndices(draft, boxes), [draft, boxes]);
  const loose = draft.filter((_, i) => !aligned[i]);
  const filled = boxes.filter((b) => b.alignedSourceWords.length > 0);
  const empty = boxes.filter((b) => b.alignedSourceWords.length === 0);

  const render = (box: AlignmentBoxModel, slot: number) => {
    const key = boxKey(box);
    const tone = picked?.has(key) ? "objected" : highlight?.keys.has(key) ? highlight.tone : undefined;
    const merged = box.targetTokens.length > 1;
    const body = (
      <>
        <div className="al-box__head">
          <div className="al-box__refs" dir={rtl ? "rtl" : undefined}>
            {box.targetTokens.map((tok, i) => {
              const at = box.targetTokenIndices[i] ?? 0;
              return (
                <span key={at} className="al-ref">
                  <span className="al-ref__word">{tok.surface}</span>
                  {gloss[at] ? (
                    <span className="al-ref__gloss" dir="ltr" title={gloss[at]}>
                      {shortGloss(gloss[at]!)}
                    </span>
                  ) : null}
                </span>
              );
            })}
          </div>
        </div>
        <div className="al-box__body">
          {box.alignedSourceWords.length === 0 ? (
            <span className="al-box__empty" aria-hidden>
              —
            </span>
          ) : (
            box.alignedSourceWords.map((aw) => {
              const at = transIndexForAlignedWord(draft, aw);
              const token = at !== null ? draft[at] : undefined;
              return (
                <span key={`${aw.word}-${aw.occurrence}`} className="al-chip">
                  <span className="al-chip__word">{token?.surface ?? aw.word}</span>
                </span>
              );
            })
          )}
        </div>
      </>
    );
    const common = {
      className: "al-box al-box--read",
      "data-slot": box.groupIndex !== null ? slot : undefined,
      "data-merged": merged ? "true" : undefined,
      "data-tone": tone,
    } as const;
    return onPick ? (
      <button key={box.id} type="button" {...common} aria-pressed={picked?.has(key) ?? false} onClick={() => onPick(box)}>
        {body}
      </button>
    ) : (
      <div key={box.id} role="group" {...common}>
        {body}
      </div>
    );
  };

  return (
    <div className="al-read" aria-label={label}>
      {loose.length ? (
        <p className="af-stale" role="status">
          {t("ab.looseWords").replace("{list}", loose.map((w) => w.surface).join(" · "))}
        </p>
      ) : null}
      <div className="al-grid al-grid--dense" dir={rtl ? "rtl" : undefined}>
        {filled.map((box, i) => render(box, i % 6))}
        {foldEmpty ? null : empty.map((box, i) => render(box, i % 6))}
      </div>
      {foldEmpty && empty.length ? (
        <details className="al-pairs__alone">
          <summary>
            {t(empty.length === 1 ? "ab.untranslatedOne" : "ab.untranslatedMany").replace("{n}", String(empty.length))}
          </summary>
          <div className="al-grid al-grid--dense" dir={rtl ? "rtl" : undefined}>
            {empty.map((box, i) => render(box, i % 6))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
