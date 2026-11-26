/**
 * «Usar estas palabras»: what an editor box says after the words a reviewer proposed are put in it. Pure.
 *
 * It does what typing those words would do and no more: line i of the proposal takes the place of the words of line i
 * of the box, and the box keeps the rest of what it has (the indentation of a line, its empty lines). The marks of a
 * line of poetry (`\q1`, `\q2`), the footnotes and the marked words are not in the box: the editor keeps them apart,
 * as it does when the author types, so they stay.
 */
import type { PieceText, Proposal } from "./reviewProposals";
import { sameShape } from "./reviewProposals";

/** The box text with the words of each of its lines replaced by the lines of `words`; `null` when the counts differ. */
export function replaceLineWords(box: string, words: string): string | null {
  const said = words.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const raw = box.split(/\r?\n/);
  if (raw.filter((line) => line.trim()).length !== said.length) return null;
  let at = 0;
  return raw
    .map((line) => {
      if (!line.trim()) return line;
      const lead = /^\s*/.exec(line)![0];
      const tail = /\s*$/.exec(line)![0];
      return `${lead}${said[at++]}${tail}`;
    })
    .join("\n");
}

/** The piece as its box will say it with the proposal used; `null` when the piece changed shape (see `sameShape`). */
export function proposalInto(box: PieceText, proposal: Proposal): PieceText | null {
  if (!sameShape(proposal, box)) return null;
  const text = replaceLineWords(box.text, proposal.words.text);
  if (text === null) return null;
  if (proposal.words.secondary === undefined) return { text };
  const secondary = replaceLineWords(box.secondary ?? "", proposal.words.secondary);
  return secondary === null ? null : { text, secondary };
}
