/**
 * The words a reviewer proposed, with what changed marked against `against` (what the piece says now, in the form of
 * the editor box; when it is not known, how it stood when the proposal was written). Read by the author in the review
 * and in her editors, where «Usar estas palabras» is under it.
 */
import { useT } from "../i18n/messages";
import { diffWords } from "../domain/reviewItems";
import type { PieceText, Proposal } from "../domain/reviewProposals";

export function markedWords(before: string, now: string): React.ReactNode[] {
  return diffWords(before, now).map((part, index) => (part.kind === "same" ? part.text : part.kind === "added" ? <ins key={index}>{part.text}</ins> : <del key={index}>{part.text}</del>));
}

export function ProposalMarked({ proposal, against }: { proposal: Proposal; against?: PieceText }) {
  const t = useT();
  const was = against ?? proposal.over;
  return (
    <div className="rv-proposal-read" data-proposal-read>
      <p className="rv-comment__lead">{t("rv.proposes")}</p>
      <p className="rv-comment__text ab-marked">{markedWords(was.text, proposal.words.text)}</p>
      {proposal.words.secondary !== undefined ? <p className="rv-comment__text ab-marked">{markedWords(was.secondary ?? "", proposal.words.secondary)}</p> : null}
      {proposal.why ? <p className="rv-comment__text">{proposal.why}</p> : null}
    </div>
  );
}
