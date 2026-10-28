import { useState, type ReactNode } from "react";
import { readable, type ProposalView } from "../domain/checkProposal";
import { useT } from "../i18n/messages";
import { TextChangeView } from "./TextChangeView";

/**
 * The note as a proposal would leave it, in the note's own card (Abel, 27 October): with a proposal, every step reviews
 * it, not the note. What changes is marked; the note as it is stays a touch away. It was a list of options to choose
 * among, under questions about the note as it was.
 */
export function ProposalCard({ head, original, title, reason, reasonBy, hint }: {
  head: ProposalView;
  /** The note as it is. */
  original: string;
  /** «La nota con la propuesta de @ana». */
  title: string;
  reason?: string;
  /** Who gave the reason, as they are named («@ana»). */
  reasonBy?: string;
  /** Under the change: what Taller found in it by itself (see `HelpChecksHint`). */
  hint?: ReactNode;
}) {
  const t = useT();
  // Together, what changes is marked in one text; apart, the note as it is and then as it would be.
  const [apart, setApart] = useState(false);
  const p = head.proposal;
  return (
    <div className="ck-pcard">
      <div className="ck-pcard__head">
        <p className="ck-pcard__title">{title}</p>
        {p.after && !p.split ? (
          <button type="button" className="af-link ck-pcard__toggle" aria-pressed={apart} onClick={() => setApart(!apart)}>
            {t(apart ? "ck.cardWithChange" : "ck.cardAsIs")}
          </button>
        ) : null}
      </div>
      {p.split ? (
        <div className="ck-msg__text">
          <p>{readable(p.after ?? "")}</p>
          <p>
            <b>{t("ag.splitNew")}</b> {readable(p.split.after)}
          </p>
          {p.split.more?.map((one, index) => (
            <p key={index}>
              <b>{t("ag.splitMoreNew")}</b> {readable(one.after)}
            </p>
          ))}
        </div>
      ) : p.after ? (
        <TextChangeView before={readable(p.before ?? original)} after={readable(p.after)} lines layout={apart ? "sides" : "together"} labels={{ now: t("ag.today"), proposed: title }} />
      ) : null}
      {reason ? (
        <p className="ck-opt__why">
          <b>{reasonBy}</b>: «{reason}»
        </p>
      ) : null}
      {hint}
    </div>
  );
}
