/**
 * A reviewer's proposal in the author's own editor, over the piece it is about: marked against what her box says now,
 * with «Usar estas palabras» when the piece is still the same one (see `proposalInto`), «Usada» once her box says it, or
 * the line that sends her to write the changes by hand when the piece changed shape.
 *
 * It writes nothing: `onUse` gives the editor the piece as its box will say it, and the editor puts it in the box the
 * way a key does (that is also how it is saved, as it saves what is typed).
 */
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "../i18n/messages";
import { proposalUsed, type PieceText, type Proposal } from "../domain/reviewProposals";
import { proposalInto } from "../domain/proposalInto";
import { ProposalMarked } from "./ProposalMarked";

export function ProposalUse(props: {
  proposal: Proposal;
  /** What the box of exactly this place says now; none when no box is of exactly this place. */
  now?: PieceText;
  /** A box holds the place, joined with others or in another shape (a bridge): there is no box of exactly this place. */
  inside?: boolean;
  /** The draft is her own: nobody else, and not the draft of the team. */
  own: boolean;
  /** What the piece is called in the line about its shape: a verse, or any other piece. */
  what?: "verse" | "piece";
  onUse: (next: PieceText) => void;
}) {
  const t = useT();
  const { proposal, now, inside, own, what = "verse", onUse } = props;
  const used = proposalUsed(proposal, now);
  const next = own && now && !used ? proposalInto(now, proposal) : null;
  const changed = own && !used && !next && (Boolean(now) || Boolean(inside));
  return (
    <div className="pu" data-proposal-use data-used={used ? "true" : undefined}>
      <ProposalMarked proposal={proposal} against={now} />
      {used ? (
        <p className="pu__done" data-used="true">
          <Check size={12} aria-hidden /> {t("pu.used")}
        </p>
      ) : next ? (
        <Button type="button" variant="outline" className="pu__use" data-use-words onClick={() => onUse(next)}>
          {t("pu.use")}
        </Button>
      ) : changed ? (
        <p className="pu__changed" data-shape-changed>
          {t(what === "verse" ? "pu.shapeChanged" : "pu.shapeChangedPiece")}
        </p>
      ) : null}
    </div>
  );
}
