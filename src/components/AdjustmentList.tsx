import { Check, Pencil } from "lucide-react";
import { readable, type ProposalView } from "../domain/checkProposal";
import { useT } from "../i18n/messages";
import { TextChangeView } from "./TextChangeView";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * What others suggest changing of a proposal, each for its author to accept or not (27 October): who suggests it and
 * why, what it changes of the proposal as it is now, and what each person can do with it.
 */
export function AdjustmentList({
  adjustments,
  head,
  author,
  me,
  who,
  currentLabel,
  closed,
  canAnswerFor,
  canDecide,
  saving,
  onAccept,
  onDecline,
  onRewrite,
  onWithdraw,
}: {
  adjustments: ProposalView[];
  /** The version of the proposal in force: what each adjustment is read against. */
  head: ProposalView;
  /** Who made the proposal: the one who accepts or not. */
  author: string;
  me: string;
  /** How a person is named («Tú», «@ana»). */
  who: (login: string) => string;
  /** What the proposal is called, over its words in the comparison. */
  currentLabel: string;
  closed?: boolean;
  /** Whoever coordinates may answer this adjustment for its author, who has not in days. */
  canAnswerFor?: (adjustment: ProposalView) => boolean;
  /** Whoever coordinates may settle the dispute with an adjustment. */
  canDecide?: boolean;
  saving?: boolean;
  onAccept?: (adjustment: ProposalView, head: ProposalView, decide?: boolean) => void;
  onDecline?: (adjustment: ProposalView) => void;
  onRewrite?: (adjustment: ProposalView, head: ProposalView) => void;
  onWithdraw: (proposalId: string) => void;
}) {
  const t = useT();
  if (!adjustments.length) return null;
  const mine = same(author, me);
  return (
    <ul className="ck-adj">
      {adjustments.map((adjustment) => {
        const answers = !closed && adjustment.adjustment === "pending" && (mine || Boolean(canAnswerFor?.(adjustment)));
        const writer = same(adjustment.by, me);
        const declinedBy = adjustment.declinedBy ?? author;
        return (
          <li key={adjustment.proposal.id} className="ck-adj__one" data-state={adjustment.adjustment}>
            <p className="ck-adj__who">{writer ? t("ck.adjSuggestsMine") : t("ck.adjSuggests").replace("{who}", who(adjustment.by))}</p>
            {adjustment.reason ? <p className="ck-opt__why">«{adjustment.reason}»</p> : null}
            {adjustment.adjustment === "declined" ? <p className="ck-adj__state">{same(declinedBy, me) ? t("ck.adjDeclinedMine") : t("ck.adjDeclined").replace("{who}", who(declinedBy))}</p> : null}
            {adjustment.adjustment === "stale" ? <p className="ck-adj__state">{t("ck.adjStale")}</p> : null}
            <TextChangeView before={readable(head.proposal.after ?? "")} after={readable(adjustment.proposal.after ?? "")} lines layout="together" labels={{ now: currentLabel, proposed: t("ck.adjLabel") }} />
            {answers || (writer && !closed && adjustment.adjustment !== "declined") || (canDecide && !closed) ? (
              <div className="ck-adj__acts">
                {answers ? (
                  <>
                    <button type="button" className="btn" data-variant="default" data-size="default" disabled={saving} onClick={() => onAccept?.(adjustment, head)}>
                      <Check size={16} aria-hidden /> {t("ck.adjAccept")}
                    </button>
                    <button type="button" className="btn" data-variant="outline" data-size="default" disabled={saving} onClick={() => onDecline?.(adjustment)}>
                      {t("ck.adjDecline")}
                    </button>
                  </>
                ) : null}
                {writer && adjustment.adjustment === "stale" && !closed ? (
                  <button type="button" className="btn" data-variant="default" data-size="default" disabled={saving} onClick={() => onRewrite?.(adjustment, head)}>
                    <Pencil size={16} aria-hidden /> {t("ck.adjRewrite")}
                  </button>
                ) : null}
                {writer && adjustment.adjustment !== "declined" && !closed ? (
                  <button type="button" className="af-link" disabled={saving} onClick={() => onWithdraw(adjustment.proposal.id)}>
                    {t("ck.withdraw")}
                  </button>
                ) : null}
                {canDecide && !closed ? (
                  <button type="button" className="af-link ck-opt__decide" disabled={saving} onClick={() => onAccept?.(adjustment, head, true)}>
                    {t("ck.adjDecide")}
                  </button>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
