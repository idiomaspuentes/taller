/**
 * The steps the Scripture editor runs between a verse box and the file, as pure functions the component calls: what a
 * box says to be compared with a proposal, the text «Usar estas palabras» puts in it, and how the boxes become the
 * file when they are saved. Tests call these same functions.
 */
import { applyVerseEditsKeepingAlignment } from "./alignmentKeep";
import { proposalInto } from "./proposalInto";
import type { PieceText, Proposal } from "./reviewProposals";
import { textLines } from "./usfmEdit";

export type VerseBox = { from: number; to: number; text: string };

/** What a verse box says, in the form proposals are compared in. */
export const verseBoxText = (box: Pick<VerseBox, "text">): PieceText => ({ text: textLines(box.text).join("\n") });

/** The text the box holds once the proposal is used, as if typed; `null` when the verse changed shape. */
export function boxTextWithProposal(box: Pick<VerseBox, "text">, proposal: Proposal): string | null {
  return proposalInto({ text: box.text }, proposal)?.text ?? null;
}

/** The file as it is written from the boxes (`sourceLeads`: the line marks of the source, for a line the verse did not have). */
export function usfmFromBoxes(usfm: string, chapter: number, boxes: VerseBox[], sourceLeads: Record<number, string[]>) {
  return applyVerseEditsKeepingAlignment(
    usfm,
    chapter,
    boxes.map((d) => (d.from === d.to && sourceLeads[d.from] ? { ...d, leads: sourceLeads[d.from] } : d)),
  );
}
