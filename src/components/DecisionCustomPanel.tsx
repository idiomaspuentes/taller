import { AlignmentBoxes } from "./AlignmentBoxes";
import { draftTokensOf, originalTokensOf, type DecisionView, type DiffPiece } from "../domain/verseEditView";
import type { AlignmentGroup } from "@usfm-tools/types";

type Custom = { kind: string; data: unknown };

type BoxesData = {
  view: DecisionView;
  draft: "before" | "after";
  groups: AlignmentGroup[];
  sid: string;
  highlight?: { tone: "changed" | "objected"; keys: string[] };
};

/**
 * What a decision card draws that is not text: the word-by-word diff of a verse, and the alignment
 * as the same boxes the person who aligns works with (the ones that change in a colour, the ones an
 * objection is about in yellow).
 */
export function DecisionCustomPanel({ custom }: { custom: Custom }) {
  if (custom.kind === "diff") {
    const pieces = (custom.data as { pieces: DiffPiece[] }).pieces;
    return (
      <p className="al-diff">
        {pieces.map((p, i) => {
          const space = i ? " " : "";
          if (p.kind === "del") return <span key={i}>{space}<del>{p.text}</del></span>;
          if (p.kind === "ins") return <span key={i}>{space}<ins>{p.text}</ins></span>;
          return <span key={i}>{space}{p.text}</span>;
        })}
      </p>
    );
  }
  if (custom.kind === "cajas") {
    const d = custom.data as BoxesData;
    const draft = draftTokensOf(d.draft === "after" ? d.view.draftAfter : d.view.draftBefore, d.sid);
    return (
      <>
        <AlignmentBoxes
          original={originalTokensOf(d.view, d.sid)}
          gloss={d.view.original.map((o) => o.gloss)}
          draft={draft}
          groups={d.groups}
          rtl={d.view.rtl}
          highlight={d.highlight ? { tone: d.highlight.tone, keys: new Set(d.highlight.keys) } : undefined}
        />
        {d.highlight && d.highlight.keys.length ? (
          <p className="al-legend">
            <span>
              <i data-tone={d.highlight.tone} />
              {d.highlight.tone === "changed" ? "Lo que cambia" : "Lo que se objeta"}
            </span>
          </p>
        ) : null}
      </>
    );
  }
  return null;
}
