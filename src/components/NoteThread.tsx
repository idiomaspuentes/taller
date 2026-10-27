import { useEffect, useRef, useState, type ReactNode } from "react";
import { MessageCircle, Send } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { readable, type ProposalView } from "../domain/checkProposal";
import type { TimelineEntry } from "../domain/noteTimeline";
import { useT, type MessageKey } from "../i18n/messages";
import { RosterFace } from "./ChapterHelpsList";
import { TextChangeView } from "./TextChangeView";

/** The box of the conversation on the note: what «Responder» brings into view. */
export const THREAD_BOX = "ck-thread-box";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The conversation of a note (Abel, 27 October): one for all its steps. On the note, its last two messages and a box
 * to write to the team, so that a long conversation does not push the answer out of the screen; the whole of it in a
 * sheet, from where what is new begins. Writing does not ask to decide anything: the conversation goes on.
 */
export function NoteThread({ entries, newFrom, me, nameOf, stepLabel, step, saving, onSay, children }: {
  entries: TimelineEntry[];
  newFrom: number;
  me: string;
  nameOf: (login: string) => string;
  stepLabel: (about: string) => string;
  /** The step in view: what is written is said of it. */
  step: string;
  saving?: boolean;
  onSay: (text: string, step: string) => Promise<void> | void;
  /** What other teams said of the note, at the end of the sheet. */
  children?: ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sheetDraft, setSheetDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const marker = useRef<HTMLLIElement | null>(null);
  const messages = entries.filter((entry): entry is Extract<TimelineEntry, { kind: "message" }> => entry.kind === "message");
  const last = messages.slice(-2);
  const send = async (text: string, clear: () => void) => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await onSay(text.trim(), step);
      clear();
    } finally {
      setSending(false);
    }
  };
  // The sheet opens where what is new for this person begins.
  useEffect(() => {
    if (open) window.setTimeout(() => marker.current?.scrollIntoView({ block: "start" }), 60);
  }, [open]);

  const tag = (about?: string) => (about ? <span className="ck-thread__tag">{stepLabel(about)}</span> : null);
  const bubble = (entry: Extract<TimelineEntry, { kind: "message" }>, key: string) => (
    <li key={key} className="ck-thread__msg" data-mine={same(entry.by, me) || undefined}>
      <RosterFace login={entry.by} name={nameOf(entry.by)} now={false} />
      <div className="ck-thread__bubble">
        <p className="ck-thread__who">
          {same(entry.by, me) ? t("ck.talkYou") : nameOf(entry.by)}
          {tag(entry.step)}
        </p>
        <p className="ck-thread__text">{entry.text}</p>
      </div>
    </li>
  );
  const lineText = (entry: Exclude<TimelineEntry, { kind: "message" }>) => {
    const mine = same(entry.by, me);
    const say = (key: string, other?: string) => t(`${key}${mine ? "Mine" : ""}` as MessageKey).replace("{who}", nameOf(entry.by)).replace("{other}", other ? nameOf(other) : "");
    switch (entry.kind) {
      case "proposed":
        return say("ck.tlProposed");
      case "changed":
        return say("ck.tlChanged");
      case "suggested":
        return say("ck.tlSuggested");
      case "accepted":
        return say("ck.tlAccepted", entry.view.proposal.adjustedBy);
      case "declined":
        return say("ck.tlDeclined", entry.view.by);
      case "reviewed":
        return entry.first ? say("ck.tlReviewed") : say("ck.tlAgreed");
      case "agreed":
        return say("ck.tlAgreed");
      case "saidNo":
        return say("ck.tlSaidNo");
      case "decided":
        return t(entry.apply ? "ck.tlDecidedApply" : "ck.tlDecidedKeep").replace("{who}", nameOf(entry.by));
    }
  };
  const line = (entry: Exclude<TimelineEntry, { kind: "message" }>, key: string) => {
    const view: ProposalView | undefined = "view" in entry ? entry.view : undefined;
    const step = "step" in entry ? entry.step : undefined;
    return (
      <li key={key} className="ck-thread__line">
        <span>
          {lineText(entry)}
          {tag(step)}
          {view?.proposal.after ? (
            <>
              {" · "}
              <button type="button" className="af-link ck-thread__see" aria-expanded={shown === key} onClick={() => setShown(shown === key ? null : key)}>
                {t(shown === key ? "ck.tlHide" : "ck.tlSee")}
              </button>
            </>
          ) : null}
        </span>
        {view?.proposal.after && shown === key ? <TextChangeView before={readable(view.proposal.before ?? "")} after={readable(view.proposal.after)} lines layout="together" labels={{ now: t("ag.today"), proposed: lineText(entry) }} /> : null}
      </li>
    );
  };
  const box = (id: string, value: string, set: (v: string) => void) => (
    <form
      className="ck-thread__write"
      onSubmit={(event) => {
        event.preventDefault();
        void send(value, () => set(""));
      }}
    >
      <label className="sr-only" htmlFor={id}>
        {t("ck.threadWrite")}
      </label>
      <textarea id={id} className="af-textarea ck-thread__box" rows={2} placeholder={t("ck.threadWrite")} value={value} onChange={(event) => set(event.target.value)} />
      <button type="submit" className="btn ck-thread__send" data-variant="outline" data-size="default" aria-label={t("ck.threadSend")} disabled={!value.trim() || sending || saving}>
        <Send size={16} aria-hidden /> {t("ck.threadSend")}
      </button>
    </form>
  );

  return (
    // The conversation's card, in the place of the step's order where what the team said is read (`.ck-talk`).
    <section className="ck-talk ck-thread" aria-labelledby="ck-thread-title">
      <p className="ck-thread__title" id="ck-thread-title">
        <MessageCircle size={16} aria-hidden /> {t("ck.threadTitle")}
        {messages.length ? <span className="ck-thread__count"> · {t(messages.length === 1 ? "ck.threadCountOne" : "ck.threadCount").replace("{n}", String(messages.length))}</span> : null}
      </p>
      {last.length ? <ol className="ck-thread__list">{last.map((entry, index) => bubble(entry, `last-${index}`))}</ol> : null}
      {entries.length > last.length ? (
        <button type="button" className="af-link ck-thread__all" onClick={() => setOpen(true)}>
          {t("ck.threadAll").replace("{n}", String(messages.length))}
        </button>
      ) : null}
      {box(THREAD_BOX, draft, setDraft)}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="fix-sheet help-sheet ck-thread-sheet" aria-describedby={undefined}>
          <header className="fx-head">
            <DialogTitle className="fx-title">{t("ck.threadTitle")}</DialogTitle>
          </header>
          <div className="fx-body">
            <ol className="ck-thread__list ck-thread__list--all">
              {entries.map((entry, index) => {
                const key = `all-${index}`;
                const item = entry.kind === "message" ? bubble(entry, key) : line(entry, key);
                return index === newFrom ? (
                  [
                    <li key={`${key}-new`} className="ck-thread__new" ref={marker}>
                      {t("ck.threadNew")}
                    </li>,
                    item,
                  ]
                ) : (
                  item
                );
              })}
            </ol>
            {children}
          </div>
          {box(`${THREAD_BOX}-sheet`, sheetDraft, setSheetDraft)}
        </DialogContent>
      </Dialog>
    </section>
  );
}
