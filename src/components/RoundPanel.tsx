import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ItemTally, RoundSummary } from "../domain/reviewRound";
import { useT } from "../i18n/messages";

/**
 * How a round of review stands, for any tool that reviews item by item: what is still without agreement (the agenda
 * of a meeting), and closing the step once everything is agreed. It knows nothing of what the items are.
 */
export function RoundPanel(props: {
  summary: RoundSummary;
  /** How to name an item in the list («2:13 · gracia»). */
  labelOf: (itemId: string) => string;
  onJump: (itemId: string) => void;
  /** The step closes here, by consensus (see `closesInItsTool`); otherwise only the standing is shown. */
  closesHere: boolean;
  stepDone: boolean;
  busy: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const { summary } = props;
  const [open, setOpen] = useState(true);
  if (!summary.items.length) return null;
  // Nothing to say yet (no meeting needed, nothing to close): no empty box taking room.
  if (!props.stepDone && !(summary.complete && props.closesHere) && !summary.meeting.length) return null;

  return (
    <section className="round" aria-label={t("round.aria")}>
      {props.stepDone ? (
        <p className="round__done">{t("round.closed")}</p>
      ) : summary.complete && props.closesHere ? (
        <div className="round__ready">
          <p>{t("round.allAgreed")}</p>
          <Button type="button" size="lg" disabled={props.busy} onClick={props.onClose}>
            {props.busy ? t("round.closing") : t("round.close")}
          </Button>
        </div>
      ) : null}

      {summary.meeting.length ? (
        <div className="round__meeting">
          <button type="button" className="round__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {t(summary.meeting.length === 1 ? "round.disputedOne" : "round.disputedMany").replace("{n}", String(summary.meeting.length))}
          </button>
          {open ? (
            <>
              <p className="round__hint">{t("round.meetingHint")}</p>
              <ul className="round__list">
                {summary.meeting.map((item) => (
                  <li key={item.itemId}>
                    <button type="button" className="round__item" onClick={() => props.onJump(item.itemId)}>
                      <span>{props.labelOf(item.itemId)}</span>
                      <span className="round__who">{item.open.map((who) => `@${who}`).join(", ")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * The team's final decision on one item: shown when it was taken; offered to whoever may confirm (the team's
 * coordinator or a persona habilitada) while the item is in dispute.
 */
export function FinalDecision(props: { tally: ItemTally; canConfirm: boolean; busy: boolean; onDecide: (note: string) => void }) {
  const t = useT();
  const [note, setNote] = useState("");
  const [writing, setWriting] = useState(false);
  const { tally } = props;

  if (tally.decided) {
    return (
      <p className="round__decided">
        {t("round.decidedBy").replace("{who}", tally.decided.by)}
        {tally.decided.note ? ` ${tally.decided.note}` : ""}
      </p>
    );
  }
  if (tally.state !== "disputed" || !props.canConfirm) return null;
  if (!writing) {
    return (
      <Button type="button" variant="outline" onClick={() => setWriting(true)}>
        {t("round.decide")}
      </Button>
    );
  }
  return (
    <div className="round__decide">
      <label htmlFor="round-note" className="af-lbl">
        {t("round.whatAgreed")}
      </label>
      <textarea id="round-note" className="af-textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      <p className="round__hint">{t("round.decideHint")}</p>
      <div className="af-buttons">
        <Button type="button" disabled={props.busy || !note.trim()} onClick={() => props.onDecide(note.trim())}>
          {props.busy ? t("af.saving") : t("round.saveDecision")}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setWriting(false)}>
          {t("af.cancel")}
        </Button>
      </div>
    </div>
  );
}
