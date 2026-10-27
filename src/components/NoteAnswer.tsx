import { Check, ChevronRight, MessageCircle, Pencil } from "lucide-react";
import type { NoteSituation } from "../domain/noteSituation";
import { useT } from "../i18n/messages";
import { Button } from "@/components/ui/button";

/** How the person answers, by the situation of the step (`asked` checking the points is read as a proposal or a first review). */
export type AnswerMode = "confirm" | "proposal" | "ownProposal" | "asked";

/**
 * How a person answers a step they collaborate on (Abel, 27 October): one filled button, agreeing with somebody, and
 * «No del todo…» for what does not convince them, which opens the points to mark what fails; or, asked something,
 * answering first. It was «Sí, de acuerdo» beside «Dejarla como está», a vote.
 */
export function NoteAnswer(p: {
  mode: AnswerMode;
  situation: NoteSituation;
  /** The points are open to be marked one by one. */
  doubting: boolean;
  /** Every point open was marked, and which said «no». */
  allTicked: boolean;
  failing: string[];
  /** This person already agreed with this step. */
  agreedAlready: boolean;
  /** Who asked, as the project names them. */
  askedBy?: string;
  saving?: boolean;
  canGoOn: boolean;
  onAgree: () => void;
  onDoubt: () => void;
  onPropose: () => void;
  onAdjust: () => void;
  onSayWhat: () => void;
  onComment: () => void;
  onReply: () => void;
  onCheckToo: () => void;
  onChangeMine: () => void;
  onWithdrawMine: () => void;
  onGoOn: () => void;
}) {
  const t = useT();
  const s = p.situation;
  const goOn = p.canGoOn ? (
    <Button type="button" size="lg" variant="outline" onClick={p.onGoOn}>
      {t("ck.goOn")} <ChevronRight size={16} aria-hidden />
    </Button>
  ) : null;

  if (p.mode === "asked" && s.kind === "asked") {
    return (
      <>
        <p className="ck-ask ck-asked">{t("ck.ansAsked").replace("{who}", p.askedBy ?? s.by).replace("{text}", s.text)}</p>
        <div className="ck-go__buttons">
          <Button type="button" size="lg" disabled={p.saving} onClick={p.onReply}>
            <MessageCircle size={16} aria-hidden /> {t("ck.ansReplyTo").replace("{who}", p.askedBy ?? s.by)}
          </Button>
        </div>
        <span className="ck-go__more">
          <button type="button" className="af-link" onClick={p.onCheckToo}>
            {t("ck.ansCheckToo")}
          </button>
        </span>
      </>
    );
  }

  if (p.mode === "ownProposal" && s.kind === "ownProposal") {
    return (
      <>
        {p.agreedAlready && !s.doubts.length ? <p className="ck-ask ck-ask--wait">{t("ck.ansAlready")}</p> : null}
        <div className="ck-go__buttons" data-one={!(s.doubts.length || !p.agreedAlready) || undefined}>
          {s.doubts.length ? (
            <Button type="button" size="lg" disabled={p.saving} onClick={p.onReply}>
              <MessageCircle size={16} aria-hidden /> {t("ck.ansReply")}
            </Button>
          ) : !p.agreedAlready ? (
            <Button type="button" size="lg" disabled={p.saving} onClick={p.onAgree}>
              <Check size={16} aria-hidden /> {t("ck.ansOwnAgree")}
            </Button>
          ) : (
            goOn
          )}
        </div>
        <span className="ck-go__more">
          <button type="button" className="af-link" disabled={p.saving} onClick={p.onChangeMine}>
            <Pencil size={16} aria-hidden /> {t("ck.adjEditMine")}
          </button>
          <button type="button" className="af-link" disabled={p.saving} onClick={p.onWithdrawMine}>
            {t("ck.withdraw")}
          </button>
        </span>
      </>
    );
  }

  const proposal = p.mode === "proposal";
  if (p.agreedAlready) {
    return (
      <>
        <p className="ck-ask ck-ask--wait">{t("ck.ansAlready")}</p>
        <div className="ck-go__buttons" data-one>
          {goOn}
        </div>
      </>
    );
  }
  if (p.doubting) {
    // The points are open: what fails leads to a change (or an adjustment) or to saying it; all «sí», to agreeing.
    return (
      <>
        {!p.allTicked ? <p className="ck-ask" data-wait>{t("ck.ansTick")}</p> : null}
        <div className="ck-go__buttons">
          {p.failing.length ? (
            <>
              <Button type="button" size="lg" disabled={p.saving} onClick={proposal ? p.onAdjust : p.onPropose}>
                <Pencil size={16} aria-hidden /> {t(proposal ? "ck.adjSuggest" : "ck.proposeChange")}
              </Button>
              <Button type="button" size="lg" variant="outline" disabled={p.saving} onClick={p.onSayWhat}>
                <MessageCircle size={16} aria-hidden /> {t("ck.ansSayWhat")}
              </Button>
            </>
          ) : (
            <Button type="button" size="lg" disabled={p.saving || !p.allTicked} onClick={p.onAgree}>
              <Check size={16} aria-hidden /> {t(proposal ? "ck.ansAgreeProposal" : "ck.ansAgree")}
            </Button>
          )}
        </div>
      </>
    );
  }
  return (
    <>
      <div className="ck-go__buttons">
        <Button type="button" size="lg" disabled={p.saving} onClick={p.onAgree}>
          <Check size={16} aria-hidden /> {t(proposal ? "ck.ansAgreeProposal" : "ck.ansAgree")}
        </Button>
        <Button type="button" size="lg" variant="outline" disabled={p.saving} onClick={p.onDoubt}>
          {t("ck.ansDoubt")}
        </Button>
      </div>
      {proposal ? (
        <span className="ck-go__more">
          <button type="button" className="af-link" disabled={p.saving} onClick={p.onAdjust}>
            <Pencil size={16} aria-hidden /> {t("ck.adjSuggest")}
          </button>
          <button type="button" className="af-link" disabled={p.saving} onClick={p.onComment}>
            <MessageCircle size={16} aria-hidden /> {t("ck.optComment")}
          </button>
        </span>
      ) : null}
    </>
  );
}
