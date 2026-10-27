import { useState, type ReactNode } from "react";
import { Check, Columns2, MessageCircle, Pencil, Plus, Send } from "lucide-react";
import { KEEP_OPTION, readable, type ProposalView } from "../domain/checkProposal";
import { useT } from "../i18n/messages";
import { TextChangeView, saveLayout, savedLayout } from "./TextChangeView";
import { ProposalCheck, type ProposalCheckGroup } from "./ProposalCheck";

/** One proposal for a help as an option: its versions, oldest first, the last one what is chosen. */
export type HelpOption = { id: string; versions: ProposalView[] };
/** A message of the conversation of one option. */
export type OptionMessage = { by: string; at: string; text: string; about: string };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * How a help should end up, decided together (Abel, 21 October): its options, leaving it as it is one of them, each
 * proposal another, and each person chooses one with a touch, as in a poll. Settled when everybody chose the same.
 * Each option keeps its own conversation, its versions as it is edited, and who chose it. It was a proposal voted on
 * in versions, in a conversation of its own beside it: hard to follow, and a simpler change could only be made on
 * top of the last one.
 */
export function NoteOptions({
  title,
  options,
  choices,
  messages,
  me,
  people,
  original,
  saving,
  closed,
  winner,
  decidedBy,
  stalled,
  canDecide,
  onChoose,
  onPropose,
  onEdit,
  onWithdraw,
  onSay,
  onDecide,
  checkGroupsOf,
  onMark,
  children,
}: {
  /** «¿Cómo debe quedar la nota?» */
  title: string;
  options: HelpOption[];
  /** What each person chose, by their name in lower case. */
  choices: Record<string, string>;
  messages: OptionMessage[];
  me: string;
  people: number;
  /** The help as it is: what each option is read against. */
  original: string;
  saving?: boolean;
  /** The list is closed: what was chosen is read, nothing is chosen any more. */
  closed?: boolean;
  /** The option the team agreed on, when it did. */
  winner?: string;
  decidedBy?: string;
  /** The team has gone days without agreeing. */
  stalled?: boolean;
  /** This person coordinates the team, and the team could not agree: they choose for it. */
  canDecide?: boolean;
  onChoose: (option: string) => void;
  onPropose: () => void;
  onEdit: (view: ProposalView) => void;
  onWithdraw: (proposalId: string) => void;
  onSay: (text: string, about: string) => Promise<void> | void;
  onDecide: (option: string) => void;
  /**
   * A proposal is checked with the note's questions instead of chosen with a touch (27 October): the steps and
   * questions to check a version with, and what saves a mark. Without them, it is chosen with a touch.
   */
  checkGroupsOf?: (view: ProposalView) => ProposalCheckGroup[];
  onMark?: (view: ProposalView, questionId: string, value: "yes" | "no", note?: string) => Promise<void> | void;
  /** What other teams said of the help, at the end. */
  children?: ReactNode;
}) {
  const t = useT();
  const mine = choices[me.trim().toLowerCase()];
  const [apart, setApart] = useState(() => savedLayout() !== "together");
  // The option read open: this person's, or the first proposal.
  const [open, setOpen] = useState<string>(() => (mine && mine !== KEEP_OPTION ? mine : (options[0]?.id ?? KEEP_OPTION)));
  const [talking, setTalking] = useState<string | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // The proposal being checked, question by question.
  const checks = Boolean(checkGroupsOf && onMark);
  // A version with no question to check it with (a change of a text) is chosen with a touch.
  const checkable = (head: ProposalView | undefined) => Boolean(checks && head && checkGroupsOf!(head).length);
  const [inCheck, setInCheck] = useState<string | null>(null);
  const who = (by: string) => (same(by, me) ? t("ck.talkYou") : `@${by}`);
  const chosers = (option: string) =>
    Object.entries(choices)
      .filter(([, one]) => one === option)
      .map(([name]) => {
        const shown = options.flatMap((o) => o.versions).find((view) => same(view.by, name))?.by ?? messages.find((m) => same(m.by, name))?.by ?? name;
        return who(shown);
      });
  const nameOf = (option: string) => {
    if (option === KEEP_OPTION) return t("ck.optKeep");
    const first = options.find((one) => one.id === option)?.versions[0];
    return first && same(first.by, me) ? t("ck.optMine") : t("ck.optBy").replace("{who}", `@${first?.by ?? ""}`);
  };
  const voices = Object.keys(choices).length;
  const split = new Set(Object.values(choices)).size > 1;
  const status = winner
    ? (decidedBy ? t("ck.optDecided").replace("{who}", who(decidedBy)) : t("ck.optSettled")).replace("{option}", nameOf(winner))
    : split
      ? `${t("ck.optSplit")} ${[KEEP_OPTION, ...options.map((one) => one.id)]
          .map((option) => ({ option, n: chosers(option).length }))
          .filter((row) => row.n)
          .map((row) => t("ck.optCount").replace("{n}", String(row.n)).replace("{option}", nameOf(row.option)))
          .join(" · ")}.${stalled ? ` ${t("ck.talkStalled")}` : ""}`
      : `${t("ck.optChose").replace("{n}", String(Math.min(voices, people))).replace("{people}", String(people))} · ${t(mine ? "ck.talkOthersTurn" : "ck.optYourTurn")}`;

  const send = async (about: string) => {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      await onSay(text, about);
      setDraft("");
    } finally {
      setSending(false);
    }
  };
  const apartButton = (
    <button
      type="button"
      className="pl-apart"
      aria-pressed={apart}
      aria-label={t(apart ? "tc.joinedAria" : "tc.apartAria")}
      title={t(apart ? "tc.joinedAria" : "tc.apartAria")}
      onClick={() => {
        saveLayout(apart ? "together" : "sides");
        setApart(!apart);
      }}
    >
      <Columns2 aria-hidden className="size-5" />
    </button>
  );

  /** A version against the note as it is: what the list shows of an option, and what is read while checking it. */
  const changeOf = (head: ProposalView, option: string) =>
    head.proposal.split ? (
      <div className="ck-msg__text">
        <p>{readable(head.proposal.after ?? "")}</p>
        <p>
          <b>{t("ag.splitNew")}</b> {readable(head.proposal.split.after)}
        </p>
        {head.proposal.split.more?.map((one, index) => (
          <p key={index}>
            <b>{t("ag.splitMoreNew")}</b> {readable(one.after)}
          </p>
        ))}
      </div>
    ) : head.proposal.after ? (
      <TextChangeView before={readable(head.proposal.before ?? original)} after={readable(head.proposal.after)} lines layout={apart ? "sides" : "together"} labels={{ now: t("ag.today"), proposed: nameOf(option) }} corner={apartButton} />
    ) : null;

  const rows = [{ id: KEEP_OPTION, versions: [] as ProposalView[] }, ...options];
  return (
    <section className="ck-opts" id="ck-opts" aria-labelledby="ck-opts-title">
      <h3 id="ck-opts-title" className="ck-opts__title">
        {title}
      </h3>
      <p className="ck-opts__status" data-kind={winner ? "settled" : split ? "split" : "open"}>
        {status}
      </p>
      <ul className="ck-opts__list" role="radiogroup" aria-labelledby="ck-opts-title">
        {rows.map((option) => {
          const head = option.versions[option.versions.length - 1];
          const chosen = mine === option.id;
          const isOpen = open === option.id;
          const said = messages.filter((m) => m.about === option.id);
          const stale = Boolean(head && chosen && head.staleFor?.includes(me.trim().toLowerCase()));
          const names = chosers(option.id);
          return (
            <li key={option.id} className="ck-opt" data-chosen={chosen || undefined} data-won={winner === option.id || undefined}>
              <button
                type="button"
                role="radio"
                aria-checked={chosen}
                className="ck-opt__pick"
                disabled={saving || closed || Boolean(winner)}
                onClick={() => {
                  setOpen(option.id);
                  // A proposal is chosen by checking it; leaving the note as it is, with a touch.
                  if (checkable(head)) setInCheck(option.id);
                  else if (!chosen) onChoose(option.id);
                }}
              >
                <span className="ck-opt__dot" aria-hidden>
                  {chosen ? <Check size={14} /> : null}
                </span>
                <span className="ck-opt__name">{nameOf(option.id)}</span>
                <span className="ck-opt__who">{names.length ? names.join(", ") : ""}</span>
              </button>
              {head && inCheck === option.id && checkGroupsOf && onMark ? (
                <ProposalCheck
                  lead={same(option.versions[0]!.by, me) ? t("ck.checkOfMine") : t("ck.checkOf").replace("{who}", `@${option.versions[0]!.by}`)}
                  groups={checkGroupsOf(head)}
                  mine={head.marks?.[me.trim().toLowerCase()] ?? {}}
                  change={changeOf(head, option.id)}
                  saving={saving}
                  onMark={(questionId, value, note) => onMark(head, questionId, value, note)}
                  onAdjust={() => onEdit(head)}
                  onDone={() => setInCheck(null)}
                />
              ) : head ? (
                isOpen ? (
                  <div className="ck-opt__body">
                    {head.reason || option.versions[0]!.reason ? (
                      <p className="ck-opt__why">
                        <b>{who(head.by)}</b>: «{head.reason || option.versions[0]!.reason}»
                      </p>
                    ) : null}
                    {head.noBy?.map((name) => {
                      // Who says «no» to it, with what they said fails.
                      const why = [...said].reverse().find((m) => same(m.by, name));
                      return (
                        <p key={name} className="ck-opt__no">
                          <b>{t("ck.optSaysNo").replace("{who}", who(name))}</b>
                          {why ? `: «${why.text}»` : ""}
                        </p>
                      );
                    })}
                    {stale ? (
                      // Edited since it was chosen: read again, and chosen again (checked again, when it is checked).
                      <div className="ck-opt__stale">
                        <p>{t("ck.optStale")}</p>
                        <button type="button" className="btn" data-variant="default" data-size="sm" disabled={saving} onClick={() => (checkable(head) ? setInCheck(option.id) : onChoose(option.id))}>
                          <Check size={16} aria-hidden /> {t(checkable(head) ? "ck.optCheckAgain" : "ck.optStillYes")}
                        </button>
                        {option.versions.length > 1 ? (
                          <button type="button" className="af-link" onClick={() => setHistory(option.id)}>
                            {t("ck.optWhatChanged")}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {changeOf(head, option.id)}
                    {checkable(head) && !chosen && !stale && !closed && !winner ? (
                      // What is asked of this person: to check it, the one obvious thing on it.
                      <button type="button" className="btn ck-opt__check" data-variant="default" data-size="lg" disabled={saving} onClick={() => setInCheck(option.id)}>
                        {t("ck.optCheck")}
                      </button>
                    ) : null}
                  </div>
                ) : null
              ) : null}
              <div className="ck-opt__acts">
                {head && !isOpen ? (
                  // Folded, an option is its name and who chose it: its text a touch away, with what else it offers.
                  <button type="button" className="af-link" onClick={() => setOpen(option.id)}>
                    {t("ck.optShow")}
                  </button>
                ) : null}
                <button type="button" className="af-link" aria-expanded={talking === option.id} onClick={() => setTalking(talking === option.id ? null : option.id)}>
                  <MessageCircle size={16} aria-hidden /> {said.length ? t(said.length === 1 ? "ck.talkMessagesOne" : "ck.talkMessages").replace("{n}", String(said.length)) : t("ck.optComment")}
                </button>
                {head && !closed && !winner ? (
                  <button type="button" className="af-link" disabled={saving} onClick={() => onEdit(head)}>
                    <Pencil size={16} aria-hidden /> {t("ck.optEdit")}
                  </button>
                ) : null}
                {head && option.versions.length > 1 ? (
                  <button type="button" className="af-link" aria-expanded={history === option.id} onClick={() => setHistory(history === option.id ? null : option.id)}>
                    {t("ck.optVersions").replace("{n}", String(option.versions.length))}
                  </button>
                ) : null}
                {head && same(head.by, me) && !closed && !winner ? (
                  <button type="button" className="af-link" disabled={saving} onClick={() => onWithdraw(head.proposal.id)}>
                    {t("ck.withdraw")}
                  </button>
                ) : null}
                {canDecide && !winner ? (
                  <button type="button" className="af-link ck-opt__decide" disabled={saving} onClick={() => onDecide(option.id)}>
                    {t("ck.optDecide")}
                  </button>
                ) : null}
              </div>
              {history === option.id ? (
                // How it was edited: each version, who made it and why, and what it changed of the one before.
                <ol className="ck-opt__history">
                  {option.versions.map((view, index) => (
                    <li key={view.proposal.id}>
                      <p className="ck-opt__why">
                        <b>{t("ck.talkVersion").replace("{n}", String(index + 1))}</b> · {who(view.by)}
                        {view.reason ? `: «${view.reason}»` : ""}
                      </p>
                      {view.proposal.after ? (
                        <TextChangeView
                          before={readable(index ? (option.versions[index - 1]!.proposal.after ?? "") : (view.proposal.before ?? original))}
                          after={readable(view.proposal.after)}
                          lines
                          layout="together"
                          labels={{ now: index ? t("ck.talkVersion").replace("{n}", String(index)) : t("ag.today"), proposed: t("ck.talkVersion").replace("{n}", String(index + 1)) }}
                        />
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : null}
              {talking === option.id ? (
                <div className="ck-opt__talk">
                  {said.length ? (
                    <ol className="ck-talk__list">
                      {said.map((m) => (
                        <li key={`${m.by}-${m.at}`} className="ck-msg ck-msg--say" data-mine={same(m.by, me) || undefined}>
                          <p className="ck-msg__who">{who(m.by)}</p>
                          <p className="ck-msg__said">{m.text}</p>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  {closed ? null : (
                    <form
                      className="ck-talk__write"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void send(option.id);
                      }}
                    >
                      <label className="sr-only" htmlFor={`ck-say-${option.id}`}>
                        {t("ck.optWrite")}
                      </label>
                      <textarea id={`ck-say-${option.id}`} className="af-textarea ck-talk__box" rows={2} placeholder={t("ck.optWrite")} value={draft} onChange={(event) => setDraft(event.target.value)} />
                      <button type="submit" className="btn" data-variant="outline" data-size="default" disabled={!draft.trim() || sending || saving}>
                        <Send size={16} aria-hidden /> {t("ck.talkSend")}
                      </button>
                    </form>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {closed || winner ? null : (
        <button type="button" className="btn ck-opts__new" data-variant="outline" data-size="default" disabled={saving} onClick={onPropose}>
          <Plus size={16} aria-hidden /> {t("ck.optPropose")}
        </button>
      )}
      {children}
    </section>
  );
}
