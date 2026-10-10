import { DECISION_DAYS, LATE_APPROVALS } from "../domain/alignmentDecision";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { CorrectionReason } from "../domain/correctionLog";
import { sameText, wordDiff } from "../domain/verseEditView";
import { useT } from "../i18n/messages";
import { CorrectionReasons, reasonLine } from "./CorrectionReasons";

/** Why a verse is corrected, as it is kept: the kinds chosen and what the person wrote. */
export type CorrectionWhy = { reasons: CorrectionReason[]; note: string };

/** A text the verse is read against while it is corrected. */
export type CorrectionReference = { id: string; label: string; text: string; lang?: string; rtl?: boolean; original?: boolean };

/**
 * Changing the text of a verse from the tool, or asking the group to. Over the tool, with what a person needs in
 * view while writing: the texts the draft is read against, the verse itself, and what the change does.
 *
 * Two ways out, because they are different acts. "Corregir ahora" writes the group's draft. "Pedir al grupo"
 * writes nothing: it leaves the comment, with the wording proposed if there is one, as a decision the others answer.
 */
export function CorrectionSheet({
  open,
  refLabel,
  text,
  references,
  busy,
  error,
  onFix,
  onAsk,
  onClose,
}: {
  open: boolean;
  /** "3JN 1:5" */
  refLabel: string;
  /** The verse as the draft has it now. */
  text: string;
  references: CorrectionReference[];
  busy: boolean;
  error: string;
  onFix: (text: string, why: string, detail: CorrectionWhy) => void;
  onAsk: (text: string, why: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState(text);
  const [why, setWhy] = useState("");
  const [reasons, setReasons] = useState<CorrectionReason[]>([]);
  const [refId, setRefId] = useState(references[0]?.id ?? "");
  /** Which of the two ways out is under way: its button says so, the other only waits. */
  const [acting, setActing] = useState<"fix" | "ask" | null>(null);
  useEffect(() => {
    if (!busy) setActing(null);
  }, [busy]);

  // Each opening starts from the verse as it is: nothing of a correction left half-written elsewhere. Done while
  // rendering, not in an effect after it: the sheet stays mounted, and opened right after moving to another verse
  // it showed the text of the verse before under the name of the new one, with «Corregir ahora» within reach,
  // until the effect ran (about a second on a slow phone).
  const shown = open ? text : null;
  const [last, setLast] = useState<string | null>(null);
  if (shown !== last) {
    setLast(shown);
    if (open) {
      setDraft(text);
      setWhy("");
      setReasons([]);
      setRefId((id) => (references.some((r) => r.id === id) ? id : (references[0]?.id ?? "")));
    }
  }

  const reference = references.find((r) => r.id === refId) ?? references[0];
  // What is kept with the change, and what the group reads: the reasons chosen, then what the person wrote.
  const reason = reasonLine(reasons, why, t);
  const changed = Boolean(draft.trim()) && !sameText(draft, text);
  const diff = changed ? wordDiff(text, draft) : [];
  // A piece of the diff may hold several words in a row.
  const added = diff.filter((piece) => piece.kind === "ins").reduce((n, piece) => n + piece.text.trim().split(/\s+/).length, 0);

  return (
    <Dialog open={open} onOpenChange={(next) => (next || busy ? undefined : onClose())}>
      <DialogContent className="fix-sheet" aria-label={t("fx.title")}>
        <header className="fx-head">
          <DialogTitle className="fx-title">{t("fx.title")}</DialogTitle>
          <p className="ws-meta">{refLabel}</p>
        </header>

        <div className="fx-body">
          {reference ? (
            <section className="af-ref fx-ref" aria-label={t("af.readAgainst")}>
              <div className="af-ref__bar">
                <span className="af-lbl">{t("af.refLabel")}</span>
                <div className="af-ref__texts" role="tablist" aria-label={t("af.readAgainst")}>
                  {references.map((row) => (
                    <button key={row.id} type="button" role="tab" aria-selected={row.id === reference.id} onClick={() => setRefId(row.id)}>
                      {row.original ? t("af.tabOriginal") : row.label}
                    </button>
                  ))}
                </div>
              </div>
              <p className={reference.original ? "fx-ref__text af-orig" : "fx-ref__text"} lang={reference.lang} dir={reference.rtl ? "rtl" : undefined}>
                {reference.text}
              </p>
            </section>
          ) : null}

          <label className="fx-field">
            <span className="af-lbl">{t("af.verseText")}</span>
            <textarea className="af-textarea" rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} />
          </label>

          {changed ? (
            <div className="fx-effect" role="status">
              <p className="al-diff" aria-label={t("al.textDiffAria")}>
                {diff.map((piece, i) => (
                  <span key={i}>
                    {i ? " " : ""}
                    {piece.kind === "del" ? <del>{piece.text}</del> : piece.kind === "ins" ? <ins>{piece.text}</ins> : piece.text}
                  </span>
                ))}
              </p>
              <p className="ws-meta">{added ? t(added === 1 ? "fx.toPlaceOne" : "fx.toPlaceMany").replace("{n}", String(added)) : t("fx.keeps")}</p>
            </div>
          ) : null}

          <div className="fx-field" role="group" aria-label={t("fx.reasons")}>
            <span className="af-lbl">{t("fx.reasons")}</span>
            <CorrectionReasons value={reasons} onChange={setReasons} />
            <textarea className="af-textarea" rows={2} value={why} aria-label={t("fx.why")} placeholder={t("fx.whyHint")} onChange={(e) => setWhy(e.target.value)} />
          </div>

          {error ? (
            <p className="ws-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="fx-foot">
          <div className="fx-choice">
            <Button type="button" disabled={busy || !changed} onClick={() => {
                setActing("fix");
                onFix(draft.trim(), reason, { reasons, note: why.trim() });
              }}
            >
              {busy && acting === "fix" ? t("af.saving") : t("fx.fixNow")}
            </Button>
            <p className="ws-meta">{t("fx.fixNowHint").replace("{days}", String(DECISION_DAYS)).replace("{n}", String(LATE_APPROVALS))}</p>
          </div>
          {/* With the text changed there is one way out: the change is proposed. A comment alone is asked of the group. */}
          {changed ? null : (
          <div className="fx-choice">
            <Button type="button" variant="outline" disabled={busy || !reason} onClick={() => {
                setActing("ask");
                onAsk(draft.trim(), reason);
              }}
            >
              {busy && acting === "ask" ? t("lx.reportSending") : t("fx.ask")}
            </Button>
            <p className="ws-meta">{!reason ? t("fx.askNeeds") : t("fx.askHint")}</p>
          </div>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
