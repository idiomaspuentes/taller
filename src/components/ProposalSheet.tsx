import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { diffExcerpt, readable, wordDiff, type ProposalState } from "../domain/checkProposal";
import { noteFromTsv, noteToTsv } from "../domain/helpMarkup";
import { MarkdownEditor } from "./MarkdownEditor";
import { useT, type MessageKey } from "../i18n/messages";

/** How a proposal stands, said to the person. `{team}`: who maintains what it would change, when it went to them. */
export const PROPOSAL_STATE_KEY: Record<ProposalState, MessageKey> = { open: "ag.stateOpen", agreed: "ag.stateAgreed", applied: "ag.stateApplied", sent: "ag.stateSent", withdrawn: "ag.stateWithdrawn", replaced: "ag.stateReplaced", rejected: "ag.stateRejected" };

/**
 * A new version read against the one before: what was taken out struck through, what was put in marked. `whole`:
 * every word of it, for reading the proposal; otherwise a few words around what changed.
 */
export function ProposalDiff({ before, after, whole, plain }: { before: string; after: string; whole?: boolean; /** As it reads, without the marks it is written with (see `readable`). */ plain?: boolean }) {
  // As it reads, unless the two versions read the same and differ only in how they are written (a link that now
  // points elsewhere, bold put on a word): then what is written is what changed, and is what is shown.
  const asRead = Boolean(plain) && readable(before) !== readable(after);
  const all = asRead ? wordDiff(readable(before), readable(after)) : wordDiff(before, after);
  const pieces = whole ? all : diffExcerpt(all);
  // A note keeps its line ends as the two characters «\n»: they are line ends here too, not words of the note.
  const read = (text: string) => text.replace(/\\n/g, whole ? "\n" : " ");
  return (
    <>
      {pieces.map((piece, index) => (piece.kind === "gone" ? <del key={index}>{read(piece.text)}</del> : piece.kind === "new" ? <ins key={index}>{read(piece.text)}</ins> : <span key={index}>{read(piece.text)}</span>))}
    </>
  );
}

/** Something a proposal can be about: the help in view, its article, or a text it is checked against. */
export type ProposalTarget = {
  id: string;
  /** How it is called to the person: «Esta nota», «El TPL». */
  label: string;
  resource: string;
  field?: string;
  path?: string;
  rowId?: string;
  /** The words as they are now: what a new version starts from. Not there while it is being read. */
  text?: string;
  /** The new version already proposed for it and still to be settled: another one starts from it, and takes its place. */
  start?: string;
  /**
   * How its words are kept: a `note` in a table file (its line ends written out), an article in `markdown`. Those
   * are written as they look (bold is bold, a link to an article is a piece that names it), not as they are kept:
   * the box showed «**Fe**» and «[[rc://…]]» to somebody who came to change a word.
   */
  format?: "note" | "markdown";
  /** There is nothing to rewrite (what is missing has no words yet): only a comment. */
  commentOnly?: boolean;
  /** Who maintains it, when it is not this team: the proposal is asked of them once the team agrees on it. */
  team?: string;
};

export type ProposalDraft = { target: ProposalTarget; after?: string; reason: string };

type Props = {
  open: boolean;
  onClose: () => void;
  targets: ProposalTarget[];
  /**
   * The question that was answered «no»: said as what it is, over the sheet. It came written as the reason, and a
   * question is not a reason: «Motivo: ¿Tiene sentido con el texto?» is what the team then read on the proposal.
   */
  failed?: string;
  /** Why, to start with: what was said of the proposal this one answers. */
  reason: string;
  /** The book the helps are of, for the links to its verses. */
  book?: string;
  /** The version to start from, instead of the words as they are: answering a proposal with another. */
  startFrom?: string;
  saving?: boolean;
  onSend: (draft: ProposalDraft) => void;
};

/**
 * Proposing a change: what, how (the new version written over the words as they are, or a comment) and why. The
 * reason comes written: it is the question that failed. A sheet over the help, so the help stays where it was.
 */
export function ProposalSheet({ open, onClose, targets, failed, reason: firstReason, book, startFrom, saving, onSend }: Props) {
  const t = useT();
  const [targetId, setTargetId] = useState(targets[0]?.id ?? "");
  const [mode, setMode] = useState<"text" | "comment">("text");
  const [text, setText] = useState("");
  const [reason, setReason] = useState(firstReason);
  const target = targets.find((row) => row.id === targetId) ?? targets[0];
  const current = target?.text ?? "";
  const canWrite = Boolean(target && !target.commentOnly && target.text !== undefined);

  // Opened again: for another help, or for another question of the same one.
  const opening = open ? `${targets.map((row) => row.id).join(",")}|${failed ?? ""}|${firstReason}|${startFrom ?? ""}` : "";
  useEffect(() => {
    if (!opening) return;
    setTargetId(targets[0]?.id ?? "");
    setReason(firstReason);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening]);
  // What is written starts from the words of what was chosen; a long article starts as a comment.
  useEffect(() => {
    if (!open || !target) return;
    setText(startFrom ?? target.start ?? current);
    setMode(canWrite && current.length <= 1200 ? "text" : "comment");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening, targetId, current, canWrite]);

  const writing = mode === "text" && canWrite;
  // The box is as tall as what is in it, up to half the screen: at six lines the end of a note of seven, where its
  // alternate translation usually is, was out of sight, with room to spare under the box.
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const box = textRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight + 2, Math.round(window.innerHeight * 0.5))}px`;
  }, [text, writing, open]);
  const changed = text.trim() !== current.trim() && Boolean(text.trim());
  const ready = Boolean(target) && (writing ? changed : Boolean(reason.trim()));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="ur-sheet pr-sheet" showCloseButton={false}>
        <header className="ur-sheet__head">
          <DialogTitle>{t("pr.title")}</DialogTitle>
          <button type="button" className="btn" data-variant="outline" data-size="default" onClick={onClose}>
            {t("ur.close")}
          </button>
        </header>
        <div className="ur-sheet__body pr-body">
          {failed ? <p className="pr-failed">{t("pr.failed").replace("{q}", failed)}</p> : null}
          {targets.length > 1 ? (
            <div className="pr-field">
              <p className="af-lbl">{t("pr.what")}</p>
              <div className="pr-chips" role="group" aria-label={t("pr.what")}>
                {targets.map((row) => (
                  <button key={row.id} type="button" aria-pressed={row.id === target?.id} onClick={() => setTargetId(row.id)}>
                    {row.label}
                  </button>
                ))}
              </div>
            </div>
          ) : target ? (
            <p className="pr-about">{target.label}</p>
          ) : null}
          {canWrite ? (
            <div className="pr-field">
              <p className="af-lbl">{t("pr.how")}</p>
              <div className="pr-chips" role="group" aria-label={t("pr.how")}>
                <button type="button" aria-pressed={writing} onClick={() => setMode("text")}>
                  {t("pr.newVersion")}
                </button>
                <button type="button" aria-pressed={!writing} onClick={() => setMode("comment")}>
                  {t("pr.onlyComment")}
                </button>
              </div>
            </div>
          ) : null}
          {writing ? (
            <div className="pr-field">
              <label className="af-lbl" htmlFor="pr-text">
                {t("pr.versionLbl")}
              </label>
              {target?.format ? (
                <MarkdownEditor
                  // Made anew for another help or another start: it keeps what it last said the text was.
                  key={`${opening}|${targetId}`}
                  id="pr-text"
                  compact={target.format === "note"}
                  book={book}
                  value={target.format === "note" ? noteFromTsv(text) : text}
                  onChange={(written) => setText(target.format === "note" ? noteToTsv(written) : written)}
                />
              ) : (
                <textarea id="pr-text" ref={textRef} className="af-textarea pr-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
              )}
              {!changed ? <p className="af-hint">{t("pr.same")}</p> : target?.start ? <p className="af-hint">{t("pr.fromPrior")}</p> : null}
            </div>
          ) : null}
          <div className="pr-field">
            <label className="af-lbl" htmlFor="pr-reason">
              {t(writing ? "pr.reasonOptional" : "pr.commentLbl")}
            </label>
            <textarea id="pr-reason" className="af-textarea" rows={writing ? 2 : 4} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <p className="af-hint">{target?.team ? t("pr.goesToOther").replace("{team}", target.team) : t("pr.goesToTeam")}</p>
        </div>
        <footer className="pr-foot">
          <button type="button" className="btn" data-variant="ghost" data-size="default" onClick={onClose}>
            {t("af.cancel")}
          </button>
          <button type="button" className="btn" data-variant="default" data-size="default" disabled={saving || !ready} onClick={() => target && onSend({ target, reason: reason.trim(), ...(writing ? { after: text.trim() } : {}) })}>
            {t("pr.send")}
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
