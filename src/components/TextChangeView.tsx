import { useState } from "react";
import { wordDiff, type DiffPiece } from "../domain/verseEditView";
import { useT } from "../i18n/messages";

/** How a change to a verse is read: in one text with its marks, or the two versions apart. */
export type ChangeLayout = "together" | "stacked" | "sides";
export const LAYOUTS: ChangeLayout[] = ["together", "stacked", "sides"];
const KEY = "gt-change-layout";

export function savedLayout(): ChangeLayout {
  try {
    const saved = localStorage.getItem(KEY) as ChangeLayout | null;
    return saved && LAYOUTS.includes(saved) ? saved : "together";
  } catch {
    return "together";
  }
}

/** Keeps the way the person reads changes, for every proposal and the next visit. */
export function saveLayout(next: ChangeLayout): void {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* a private window: the choice lasts as long as the screen */
  }
}

/** The name of a way to read a change, as its button and the «Más» menu say it. */
export const layoutLabelKey = (one: ChangeLayout) => (one === "together" ? "tc.together" : one === "stacked" ? "tc.stacked" : "tc.sides");

function Pieces({ pieces }: { pieces: DiffPiece[] }) {
  return (
    <p className="al-diff">
      {pieces.map((piece, i) => {
        const space = i ? " " : "";
        if (piece.kind === "del") return <span key={i}>{space}<del>{piece.text}</del></span>;
        if (piece.kind === "ins") return <span key={i}>{space}<ins>{piece.text}</ins></span>;
        return <span key={i}>{space}{piece.text}</span>;
      })}
    </p>
  );
}

/** One version of the verse, with what the other one does not have marked. */
function Side({ pieces, keep, label }: { pieces: DiffPiece[]; keep: "del" | "ins"; label: string }) {
  return (
    <figure className="tc-side" data-side={keep === "del" ? "now" : "proposed"}>
      <figcaption className="af-lbl">{label}</figcaption>
      <Pieces pieces={pieces.filter((piece) => piece.kind === "same" || piece.kind === keep)} />
    </figure>
  );
}

/**
 * A change to a verse, as diff viewers show one: the verse once with what goes and what comes marked in it, or the
 * verse as it is and as proposed, one under the other or side by side. A long change read in one text mixed the two
 * wordings word by word, and what the proposal says as a whole could not be read. The choice is kept per browser.
 */
export function TextChangeView({ before, after, layout: chosen }: { before: string; after: string; /** Chosen by the screen (in its «Más»): no buttons here. */ layout?: ChangeLayout }) {
  const t = useT();
  const [own, setOwn] = useState<ChangeLayout>(savedLayout);
  const layout = chosen ?? own;
  const pieces = wordDiff(before, after);
  const choose = (next: ChangeLayout) => {
    setOwn(next);
    saveLayout(next);
  };
  return (
    <div className="tc">
      {chosen ? null : (
        <span className="af-order tc-layout" role="group" aria-label={t("tc.layoutAria")}>
          {LAYOUTS.map((one) => (
            <button key={one} type="button" aria-pressed={layout === one} onClick={() => choose(one)}>
              {t(layoutLabelKey(one))}
            </button>
          ))}
        </span>
      )}
      {layout === "together" ? (
        <Pieces pieces={pieces} />
      ) : (
        <div className="tc-pair" data-layout={layout}>
          <Side pieces={pieces} keep="del" label={t("tc.now")} />
          <Side pieces={pieces} keep="ins" label={t("tc.proposed")} />
        </div>
      )}
    </div>
  );
}
