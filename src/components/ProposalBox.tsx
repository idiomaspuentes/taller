import { useState } from "react";
import { Button } from "@/components/ui/button";
import { samePiece, type PieceText } from "../domain/reviewProposals";
import { useT } from "../i18n/messages";

/** What is written in the box: the proposed words and, once «Decir por qué» was touched, why (`undefined`: that box is closed). */
export type ProposalDraft = {
  words: PieceText;
  why?: string;
  /** How the piece stood when the box was opened: kept by the screen, to tell whether anything was written. */
  over?: PieceText;
};

const rowsFor = (text: string) => Math.min(8, Math.max(2, text.split("\n").length));

/**
 * The box in which whoever reviews proposes other words for a piece. It opens with the piece's words already written
 * (`initial`, in the form of the author's editor box) and only what is changed counts: «Enviar propuesta» stays off
 * while the words say what the piece says. A question has two boxes, the question and its answer. «Decir por qué» opens
 * one more box, only when it is touched.
 *
 * `value` and `onValue`: when the screen keeps the draft (a piece may close while words are written in it), the box is
 * controlled; otherwise it keeps its own.
 */
export function ProposalBox({
  initial,
  busy,
  onSend,
  onCancel,
  value,
  onValue,
  box,
  focus = true,
  editing,
  startWhy,
}: {
  initial: PieceText;
  busy: boolean;
  onSend: (words: PieceText, why?: string) => void;
  onCancel: () => void;
  value?: ProposalDraft;
  onValue?: (draft: ProposalDraft) => void;
  /** Which box this is, to bring the finger back to it. */
  box?: string;
  focus?: boolean;
  /** A proposal being changed: its reason counts as part of what changes, and starts as it was written. */
  editing?: boolean;
  startWhy?: string;
}) {
  const t = useT();
  const [own, setOwn] = useState<ProposalDraft>({ words: initial, ...(startWhy !== undefined ? { why: startWhy } : {}) });
  const draft = onValue ? (value ?? { words: initial }) : own;
  const set = onValue ?? setOwn;
  const { words, why } = draft;
  const two = initial.secondary !== undefined;
  const same = samePiece(initial, { text: words.text, ...(two ? { secondary: words.secondary ?? "" } : {}) }) && (!editing || (why ?? "").trim() === (startWhy ?? "").trim());
  return (
    <div className="rv-proposal" data-box-kind="proposal">
      <textarea
        className="af-textarea"
        rows={rowsFor(words.text)}
        autoFocus={focus}
        data-box={box}
        data-part="text"
        value={words.text}
        aria-label={t(two ? "rv.proposalQuestion" : "rv.proposalWords")}
        onChange={(e) => set({ ...draft, words: { ...words, text: e.target.value } })}
      />
      {two ? (
        <textarea
          className="af-textarea"
          rows={rowsFor(words.secondary ?? "")}
          data-part="secondary"
          value={words.secondary ?? ""}
          aria-label={t("rv.proposalAnswer")}
          onChange={(e) => set({ ...draft, words: { ...words, secondary: e.target.value } })}
        />
      ) : null}
      {why === undefined ? (
        <button type="button" className="rv-proposal__why" onClick={() => set({ ...draft, why: "" })}>
          {t("rv.sayWhy")}
        </button>
      ) : (
        <textarea className="af-textarea" rows={2} autoFocus data-part="why" value={why} placeholder={t("rv.whyPlaceholder")} aria-label={t("rv.whyPlaceholder")} onChange={(e) => set({ ...draft, why: e.target.value })} />
      )}
      <div className="rv-composer__row">
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onCancel}>
          {t("rv.cancelEdit")}
        </Button>
        <Button type="button" size="sm" disabled={busy || same} onClick={() => onSend(words, why?.trim() || undefined)}>
          {t("rv.sendProposal")}
        </Button>
      </div>
    </div>
  );
}
