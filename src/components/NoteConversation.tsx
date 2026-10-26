import { useEffect, useState, type ReactNode } from "react";
import { Send } from "lucide-react";
import { Check, ChevronLeft, ChevronRight, Clock3, Columns2, MessageCircle } from "lucide-react";
import type { ProposalView } from "../domain/checkProposal";
import { readable } from "../domain/checkProposal";
import { useT } from "../i18n/messages";
import { TextChangeView, saveLayout, savedLayout } from "./TextChangeView";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/** What one person said of a help: the steps where they found it right, a message, a proposal, or a side taken. */
export type TalkLine =
  | { kind: "fine"; by: string; at: string; steps: string[] }
  | { kind: "comment"; by: string; at: string; text: string }
  | { kind: "proposal"; at: string; view: ProposalView; version?: number; previous?: ProposalView }
  | { kind: "stand"; by: string; at: string; stand: "for" | "against"; version?: number }
  | { kind: "decided"; by: string; at: string; apply: boolean };

/** How the conversation of a help stands: settled one way or the other, or how far it is. */
export type TalkStatus =
  | { kind: "settled"; change?: string; decidedBy?: string }
  | { kind: "open"; proposals: number }
  | { kind: "disputed"; against: string[]; inFavour: string[]; stalled: boolean }
  | { kind: "counting"; steps: { label: string; agree: number }[]; people: number };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The messages read without unfolding, once the conversation is open: the last few, where it is now. */
const SHOWN = 6;
/** What opens the conversation from outside it: the bar at the foot, to answer somebody. */
export const OPEN_TALK = "ck-talk-open";
/** How much of the last thing said is read with the conversation closed. */
const PEEK = 110;

type ProposalLine = Extract<TalkLine, { kind: "proposal" }>;

/**
 * A help as the team talks it over (21 October), in three layers so it is not read as a pile of boxes:
 * - where it stands, first: settled, waiting for opinions, or who still disagrees with whom;
 * - the proposal in play, once: the note as its last version would leave it, who is for it and who would rather
 *   leave it as it is. Each version used to be a box of its own with its own changes, and a fourth box said how
 *   the note would end up: four texts to compare where one decides;
 * - what was said, in order, one line each: who found it right, who wrote what, who proposed or adjusted it (what
 *   that adjustment changed, a touch away), who took which side. The older ones folded once there are many.
 */
export function NoteConversation({
  lines,
  status,
  me,
  original,
  saving,
  onFor,
  onKeep,
  onWithdraw,
  onSay,
  onAdjust,
  ask = true,
  people,
  title,
  editHere: _editHere = true,
  turnAsk,
  onOpenChange,
  children,
}: {
  lines: TalkLine[];
  status: TalkStatus;
  me: string;
  /** The help as it is: what each proposal is read against. */
  original: string;
  saving?: boolean;
  onFor: (proposalId: string) => void;
  onKeep: (proposalId: string) => void;
  onWithdraw: (proposalId: string) => void;
  /** Opens a new version of a proposal, from its words; absent, it cannot be adjusted here. */
  onAdjust?: (view: ProposalView) => void;
  /** Writes something in the conversation; absent, there is no box to write in (a list closed, a trial with nobody). */
  onSay?: (text: string) => Promise<void> | void;
  /** How many people decide: each proposal says how many of them are for it. */
  people?: number;
  /** What is read at the end of it: what other teams said of the help. */
  children?: ReactNode;
  /** Whether each proposal asks here what this person thinks of it: not when the bar at the foot already asks it. */
  ask?: boolean;
  /** What the proposal is called: «Propuesta para la nota». */
  title?: string;
  /** Whether the document offers to edit it: not when the bar at the foot already does. */
  editHere?: boolean;
  /** What this person is asked of the proposal, said at the end of the conversation when it is open. */
  turnAsk?: string;
  /** Told when the conversation opens or closes: open, what to answer is in it, not in the bar at the foot. */
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useT();
  const [apart, setApart] = useState(() => savedLayout() !== "together");
  const [older, setOlder] = useState(false);
  /**
   * Closed, the conversation is where it stands, the proposal and the last thing said: open, all of it and the box to
   * write in. Open by default it grew longer than the note it is about (Abel, 21 October).
   */
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const opening = () => setOpen(true);
    window.addEventListener(OPEN_TALK, opening);
    return () => window.removeEventListener(OPEN_TALK, opening);
  }, []);
  useEffect(() => onOpenChange?.(open), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const [changeOf, setChangeOf] = useState<string | null>(null);
  /**
   * The proposal opened from the conversation, by the id of its last version: read, and answered, from the message
   * that says it was made (Abel, 21 October: the bar at the foot did not feel part of the conversation).
   */
  const [sheetOf, setSheetOf] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const who = (by: string) => (same(by, me) ? t("ck.talkYou") : `@${by}`);
  const names = (list: string[]) => list.map(who).join(", ");
  /** The proposals in play: the last version of each, still to be decided or agreed. */
  const heads = lines.filter((line): line is ProposalLine => line.kind === "proposal" && (line.view.state === "open" || line.view.state === "agreed"));
  /**
   * Each proposal in play with its versions, oldest first: one document the team goes on editing (Abel, 21 October:
   * «no se siente que todos están trabajando sobre una misma propuesta»), its versions a pair of arrows apart.
   */
  const proposalLines = new Map(lines.filter((line): line is ProposalLine => line.kind === "proposal").map((line) => [line.view.proposal.id, line]));
  const chains = heads.map((head) => {
    const out = [head];
    for (let back = head.previous ? proposalLines.get(head.previous.proposal.id) : undefined; back && !out.includes(back); back = back.previous ? proposalLines.get(back.previous.proposal.id) : undefined) out.unshift(back);
    return out;
  });
  /** The version read of each proposal in play (by the id of its last one: a new version shows itself). */
  const [shown, setShown] = useState<Record<string, number>>({});
  /** The version whose change from the one before it is open. */
  const [sinceOf, setSinceOf] = useState<string | null>(null);
  const chainWith = (id: string) => chains.find((chain) => chain.some((line) => line.view.proposal.id === id));
  /** Opens a version in the sheet, from the line of the conversation that says it was made. */
  const showVersion = (id: string) => {
    const chain = chainWith(id);
    if (!chain) return;
    const headId = chain[chain.length - 1]!.view.proposal.id;
    setShown((now) => ({ ...now, [headId]: chain.findIndex((line) => line.view.proposal.id === id) }));
    setComment("");
    setSheetOf(headId);
  };
  // What is being written, kept until it is sent: anybody writes, the one who already said something too.
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const send = async () => {
    const text = draft.trim();
    if (!text || !onSay) return;
    setSending(true);
    try {
      await onSay(text);
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
  /** The note as a version would leave it, against the note as it is: or, `previous` given, what it changed of that one. */
  const changeView = (view: ProposalView, previous?: { view: ProposalView; version: number }, version?: number) =>
    view.proposal.split ? (
      <div className="ck-msg__text">
        <p>{readable(view.proposal.after ?? "")}</p>
        <p>
          <b>{t("ag.splitNew")}</b> {readable(view.proposal.split.after)}
        </p>
        {view.proposal.split.more?.map((one, index) => (
          <p key={index}>
            <b>{t("ag.splitMoreNew")}</b> {readable(one.after)}
          </p>
        ))}
      </div>
    ) : view.proposal.after ? (
      <TextChangeView
        before={readable(previous ? (previous.view.proposal.after ?? "") : (view.proposal.before ?? original))}
        after={readable(view.proposal.after)}
        lines
        layout={apart ? "sides" : "together"}
        labels={{
          now: previous ? t("ck.talkVersion").replace("{n}", String(previous.version)) : t("ag.today"),
          proposed: version && version > 1 ? t("ck.talkVersion").replace("{n}", String(version)) : t("ck.talkProposed"),
        }}
        corner={apartButton}
      />
    ) : null;

  /** One thing said, in a line. */
  const said = (line: TalkLine) => {
    if (line.kind === "comment") {
      return (
        <li key={`say-${line.by}-${line.at}`} className="ck-msg ck-msg--say" data-mine={same(line.by, me) || undefined}>
          <p className="ck-msg__who">{who(line.by)}</p>
          <p className="ck-msg__said">{line.text}</p>
        </li>
      );
    }
    if (line.kind === "fine") {
      return (
        <li key={`fine-${line.by}`} className="ck-msg ck-msg--line" data-mine={same(line.by, me) || undefined}>
          <p className="ck-msg__what">
            <Check size={16} aria-hidden className="ck-msg__ok" />
            <span>
              <b>{who(line.by)}</b> {t(same(line.by, me) ? "ck.talkFineMine" : "ck.talkFine").replace("{steps}", line.steps.join(" · "))}
            </span>
          </p>
        </li>
      );
    }
    if (line.kind === "stand") {
      return (
        <li key={`stand-${line.by}-${line.at}`} className="ck-msg ck-msg--line" data-mine={same(line.by, me) || undefined} data-stand={line.stand}>
          <p className="ck-msg__what">
            {line.stand === "for" ? <Check size={16} aria-hidden className="ck-msg__ok" /> : <MessageCircle size={16} aria-hidden className="ck-msg__no" />}
            <span>
              <b>{who(line.by)}</b> {t(same(line.by, me) ? (line.stand === "for" ? "ck.talkStandForMine" : "ck.talkStandKeepMine") : line.stand === "for" ? "ck.talkStandFor" : "ck.talkStandKeep").replace("{n}", String(line.version ?? 1))}
            </span>
          </p>
        </li>
      );
    }
    if (line.kind === "decided") {
      return (
        <li key={`decided-${line.by}-${line.at}`} className="ck-msg ck-msg--line">
          <p className="ck-msg__what">
            <Check size={16} aria-hidden className="ck-msg__ok" />
            <span>
              <b>{who(line.by)}</b> {t(same(line.by, me) ? (line.apply ? "ck.talkDecidedApplyMine" : "ck.talkDecidedKeepMine") : line.apply ? "ck.talkDecidedApply" : "ck.talkDecidedKeep")}
            </span>
          </p>
        </li>
      );
    }
    // A proposal or a version of it: who and why, in a line. One of the proposal in play leads to it in the document;
    // one left aside or taken back shows what it changed, a touch away.
    const version = line.version ?? 1;
    const inPlay = Boolean(chainWith(line.view.proposal.id));
    const mine = same(line.view.by, me);
    const verb = version > 1 ? t(mine ? "ck.talkEditedMine" : "ck.talkEdited").replace("{n}", String(version)) : t(mine ? "ck.talkProposesMine" : "ck.talkProposes");
    const showing = changeOf === line.view.proposal.id;
    if (inPlay) {
      return (
        <li key={line.view.proposal.id} className="ck-msg ck-msg--proposal" data-mine={mine || undefined} data-state={line.view.state}>
          <p className="ck-msg__who">
            {who(line.view.by)} <span className="ck-msg__verb">{verb}</span>
          </p>
          {line.view.reason ? <p className="ck-msg__why">«{line.view.reason}»</p> : null}
          <button type="button" className="btn ck-msg__open" data-variant="outline" data-size="sm" onClick={() => showVersion(line.view.proposal.id)}>
            {t("ck.talkSeeVersion").replace("{n}", String(version))}
          </button>
        </li>
      );
    }
    return (
      <li key={line.view.proposal.id} className="ck-msg ck-msg--proposal" data-mine={mine || undefined} data-state={line.view.state}>
        <p className="ck-msg__who">
          {who(line.view.by)} <span className="ck-msg__verb">{verb}</span>
        </p>
        {line.view.reason ? <p className="ck-msg__why">«{line.view.reason}»</p> : null}
        {line.view.state === "rejected" || line.view.state === "withdrawn" ? <p className="ck-msg__state">{t(line.view.state === "rejected" ? "ck.talkLeft" : "ck.talkGone")}</p> : null}
        <button type="button" className="af-link ck-msg__change" aria-expanded={showing} onClick={() => setChangeOf(showing ? null : line.view.proposal.id)}>
          {t(showing ? "ck.talkHideChange" : version > 1 ? "ck.talkShowAdjust" : "ck.talkShowChange")}
        </button>
        {showing ? changeView(line.view, line.previous ? { view: line.previous, version: version - 1 } : undefined, version) : null}
      </li>
    );
  };

  const hidden = older ? 0 : Math.max(0, lines.length - SHOWN);
  /** One thing said, in a few words: what is read of the conversation while it is closed. */
  const brief = (line: TalkLine): ReactNode => {
    const cut = (text: string) => (text.length > PEEK ? `${text.slice(0, PEEK - 1).trimEnd()}…` : text);
    if (line.kind === "comment") return (<><b>{who(line.by)}:</b> {cut(line.text)}</>);
    if (line.kind === "fine") return (<><b>{who(line.by)}</b> {t(same(line.by, me) ? "ck.talkFineMine" : "ck.talkFine").replace("{steps}", line.steps.join(" · "))}</>);
    if (line.kind === "stand") return (<><b>{who(line.by)}</b> {t(same(line.by, me) ? (line.stand === "for" ? "ck.talkStandForMine" : "ck.talkStandKeepMine") : line.stand === "for" ? "ck.talkStandFor" : "ck.talkStandKeep").replace("{n}", String(line.version ?? 1))}</>);
    if (line.kind === "decided") return (<><b>{who(line.by)}</b> {t(same(line.by, me) ? (line.apply ? "ck.talkDecidedApplyMine" : "ck.talkDecidedKeepMine") : line.apply ? "ck.talkDecidedApply" : "ck.talkDecidedKeep")}</>);
    const version = line.version ?? 1;
    const mine = same(line.view.by, me);
    return (<><b>{who(line.view.by)}</b> {version > 1 ? t(mine ? "ck.talkEditedMine" : "ck.talkEdited").replace("{n}", String(version)) : t(mine ? "ck.talkProposesMine" : "ck.talkProposes")}</>);
  };

  /**
   * The proposal in play, one document: every version read against the note as it is, so going from one to another
   * only the marks move; the arrows go back through its versions. In the card, and in the sheet the conversation opens.
   */
  const docOf = (chain: ProposalLine[], inSheet: boolean) => {
        const head = chain[chain.length - 1]!;
        const headId = head.view.proposal.id;
        const at = inSheet ? Math.min(shown[headId] ?? chain.length - 1, chain.length - 1) : chain.length - 1;
        const line = chain[at]!;
        const view = line.view;
        const version = at + 1;
        const current = at === chain.length - 1;
        const before = at > 0 ? chain[at - 1]! : undefined;
        const voted = view.inFavour.some((one) => same(one, me)) || view.against.some((one) => same(one, me));
        const go = (to: number) => setShown((now) => ({ ...now, [headId]: to }));
        const mine = same(view.by, me);
        return (
          <div key={`head-${headId}`} id={inSheet ? undefined : `ck-play-${headId}`} className="ck-play" data-state={current ? view.state : "old"}>
            {inSheet ? (
              <>
            <div className="ck-play__top">
              {inSheet ? null : <p className="ck-play__label">{title ?? t("ck.talkProposed")}</p>}
              {chain.length > 1 ? (
                <div className="ck-play__nav">
                  <button type="button" className="ck-play__arrow" disabled={at === 0} aria-label={t("ck.playPrev")} title={t("ck.playPrev")} onClick={() => go(at - 1)}>
                    <ChevronLeft size={18} aria-hidden />
                  </button>
                  <span className="ck-play__which" aria-live="polite">
                    {t("ck.playVersionOf").replace("{n}", String(version)).replace("{total}", String(chain.length))}
                  </span>
                  <button type="button" className="ck-play__arrow" disabled={current} aria-label={t("ck.playNext")} title={t("ck.playNext")} onClick={() => go(at + 1)}>
                    <ChevronRight size={18} aria-hidden />
                  </button>
                </div>
              ) : null}
            </div>
            <p className="ck-play__by">
              <b>{who(view.by)}</b> {t(version > 1 ? (mine ? "ck.playEditedMine" : "ck.playEdited") : mine ? "ck.playMadeMine" : "ck.playMade")}
              {view.reason ? <span className="ck-play__why"> · «{view.reason}»</span> : null}
            </p>
              </>
            ) : (
              // In the card: what it is, like the note's chip, and who proposed it and why, in a line (21 October:
              // four labels and a pair of arrows came before the text).
              <>
                <p className="ck-play__head">
                  <span className="ck-chip">{chain.length > 1 ? t("ck.playChip").replace("{n}", String(chain.length)) : t("ck.playChipOne")}</span>
                </p>
                <p className="ck-play__by">
                  <b>{who(view.by)}</b>
                  {view.reason ? <>: <span className="ck-play__why">«{view.reason}»</span></> : <> {t(version > 1 ? (mine ? "ck.playEditedMine" : "ck.playEdited") : mine ? "ck.playMadeMine" : "ck.playMade")}</>}
                </p>
              </>
            )}
            {current ? null : (
              <p className="ck-play__old">
                {t("ck.playOld").replace("{n}", String(chain.length))}{" "}
                <button type="button" className="af-link" onClick={() => go(chain.length - 1)}>
                  {t("ck.playGoCurrent")}
                </button>
              </p>
            )}
            {changeView(view, undefined, version)}
            {!inSheet && chain.length > 1 ? (
              <button type="button" className="af-link ck-play__earlier" onClick={() => showVersion(chain[chain.length - 2]!.view.proposal.id)}>
                {t("ck.playEarlier")}
              </button>
            ) : null}
            {inSheet && before ? (
              <>
                <button type="button" className="af-link ck-msg__change" aria-expanded={sinceOf === view.proposal.id} onClick={() => setSinceOf(sinceOf === view.proposal.id ? null : view.proposal.id)}>
                  {t(sinceOf === view.proposal.id ? "ck.talkHideChange" : "ck.playSince").replace("{n}", String(version - 1))}
                </button>
                {sinceOf === view.proposal.id ? changeView(view, { view: before.view, version: version - 1 }, version) : null}
              </>
            ) : null}
            {!inSheet ? null : (
            <div className="ck-play__sides">
              {current ? (
                <>
                  <p className="ck-play__side" data-side="for">
                    <Check size={16} aria-hidden /> {t("ck.talkFor").replace("{who}", names(view.inFavour))}
                    {people ? <span className="ck-play__count"> · {t("ck.talkOf").replace("{n}", String(Math.min(view.inFavour.length, people))).replace("{people}", String(people))}</span> : null}
                  </p>
                  {view.against.length ? (
                    <p className="ck-play__side" data-side="against">
                      <MessageCircle size={16} aria-hidden /> {t(view.against.length > 1 ? "ck.talkKeep" : "ck.talkKeepOne").replace("{who}", names(view.against))}
                    </p>
                  ) : null}
                </>
              ) : (
                // An old version only says how it stood: nobody decides on it any more.
                <p className="ck-play__side" data-side="was">
                  {t("ck.playWereFor").replace("{who}", names(view.inFavour))}
                </p>
              )}
            </div>
            )}
            {inSheet || !current || view.state !== "open" ? null : same(view.by, me) ? (
              ask ? (
                <div className="ck-msg__acts">
                  {onAdjust ? (
                    <button type="button" className="af-link" disabled={saving} onClick={() => onAdjust(view)}>
                      {t("ck.adjust")}
                    </button>
                  ) : null}
                  <button type="button" className="af-link" disabled={saving} onClick={() => onWithdraw(view.proposal.id)}>
                    {t("ck.withdraw")}
                  </button>
                </div>
              ) : null
            ) : !ask || voted ? null : (
              <div className="ck-msg__acts">
                <button type="button" className="btn" data-variant="default" data-size="sm" disabled={saving} onClick={() => onFor(view.proposal.id)}>
                  {t("ck.voteFor")}
                </button>
                <button type="button" className="btn" data-variant="outline" data-size="sm" disabled={saving} onClick={() => onKeep(view.proposal.id)}>
                  {t("ck.voteKeep")}
                </button>
                {onAdjust ? (
                  <button type="button" className="af-link" disabled={saving} onClick={() => onAdjust(view)}>
                    {t("ck.adjust")}
                  </button>
                ) : null}
              </div>
            )}
          </div>
        );
  };

  /** The proposal the sheet is open on, and what this person can say of its last version. */
  const sheetChain = sheetOf ? chains.find((chain) => chain[chain.length - 1]!.view.proposal.id === sheetOf) : undefined;
  const sheetHead = sheetChain?.[sheetChain.length - 1]?.view;
  const sheetAt = sheetChain ? Math.min(shown[sheetOf!] ?? sheetChain.length - 1, sheetChain.length - 1) : 0;
  const onCurrent = Boolean(sheetChain) && sheetAt === sheetChain!.length - 1;
  const standOf = (view: ProposalView): "author" | "for" | "against" | "none" =>
    same(view.by, me) ? "author" : view.inFavour.some((one) => same(one, me)) ? "for" : view.against.some((one) => same(one, me)) ? "against" : "none";
  /** This person was for a version before the last: the proposal changed since they agreed. */
  const wasFor = (chain: ProposalLine[]) => chain.slice(0, -1).some((line) => line.view.inFavour.some((one) => same(one, me)));
  const sheetStand = sheetHead ? standOf(sheetHead) : "none";
  /** How the proposal in play goes, at the foot of the card: settled, in dispute, or how many agree and who is missing. */
  const progressHead = chains.length === 1 ? chains[0]![chains[0]!.length - 1]!.view : undefined;
  const progress =
    status.kind === "settled"
      ? status.decidedBy
        ? t(status.change ? "ck.talkSettledDecidedChange" : "ck.talkSettledDecidedKeep").replace("{who}", who(status.decidedBy))
        : status.change
          ? t("ck.talkSettledChange").replace("{who}", who(status.change))
          : t("ck.talkSettledKeep")
      : status.kind === "disputed"
        ? status.against.length === 1 && same(status.against[0]!, me)
          ? t("ck.talkDisputedMine")
          : t(status.against.length > 1 ? "ck.talkDisputedMany" : "ck.talkDisputed").replace("{who}", names(status.against))
        : progressHead
          ? `${t("ck.talkProgress").replace("{n}", String(Math.min(progressHead.inFavour.length, people ?? progressHead.inFavour.length))).replace("{people}", String(people ?? progressHead.inFavour.length))} · ${t(standOf(progressHead) === "none" ? "ck.talkYourTurn" : "ck.talkOthersTurn")}`
          : "";
  const act = (run: () => void) => {
    run();
    setSheetOf(null);
  };

  return (
    <section className="ck-talk" aria-labelledby="ck-talk-title">
      <h3 id="ck-talk-title" className={chains.length && !open ? "ck-talk__title sr-only" : "ck-talk__title"}>
        {t("ck.talkTitle")}
      </h3>
      {/* Where it stands, before anything else: what the rest of it is read for. */}
      {chains.length && !open ? null : (
      <p className="ck-talk__status" data-kind={status.kind}>
        {status.kind === "settled" ? (
          <>
            <Check size={16} aria-hidden />{" "}
            {status.decidedBy
              ? t(status.change ? "ck.talkSettledDecidedChange" : "ck.talkSettledDecidedKeep").replace("{who}", who(status.decidedBy))
              : status.change
                ? t("ck.talkSettledChange").replace("{who}", who(status.change))
                : t("ck.talkSettledKeep")}
          </>
        ) : status.kind === "disputed" ? (
          <>
            <MessageCircle size={16} aria-hidden />{" "}
            <span>
              {status.against.length === 1 && same(status.against[0]!, me) ? t("ck.talkDisputedMine") : t(status.against.length > 1 ? "ck.talkDisputedMany" : "ck.talkDisputed").replace("{who}", names(status.against))}
              {status.stalled ? ` ${t("ck.talkStalled")}` : ""}
            </span>
          </>
        ) : status.kind === "open" ? (
          <>
            <Clock3 size={16} aria-hidden /> {t(status.proposals > 1 ? "ck.talkOpenMany" : "ck.talkOpen").replace("{n}", String(status.proposals))}
          </>
        ) : (
          <>
            <Clock3 size={16} aria-hidden /> {t("ck.talkCount").replace("{steps}", status.steps.map((step) => `${step.label} ${Math.min(step.agree, status.people)}/${status.people}`).join(" · "))}
          </>
        )}
      </p>
      )}

      {/* The proposal in play, one document: every version read against the note as it is, so going from one to
          another only the marks move; the arrows go back through its versions. */}
      {chains.map((chain) => docOf(chain, false))}

      {/* Closed, with a proposal: how it goes, and the conversation in one row that opens it. */}
      {!open && chains.length === 1 ? (
        <div className="ck-talk__foot">
          <p className="ck-talk__progress" data-kind={status.kind}>
            {status.kind === "disputed" ? <MessageCircle size={16} aria-hidden /> : <Check size={16} aria-hidden />}{" "}
            <span>{progress}</span>
          </p>
          <button type="button" className="ck-talk__row" onClick={() => setOpen(true)}>
            <MessageCircle size={18} aria-hidden className="ck-talk__row-icon" />
            <span className="ck-talk__row-text">
              <b>{t(lines.length === 1 ? "ck.talkMessagesOne" : "ck.talkMessages").replace("{n}", String(lines.length))}</b>
              {" · "}
              {brief([...lines].reverse().find((line) => line.kind === "comment") ?? lines[lines.length - 1]!)}
            </span>
            <ChevronRight size={18} aria-hidden className="ck-talk__row-go" />
          </button>
        </div>
      ) : null}
      {/* Closed: the last thing said, and the way in. */}
      {!open && lines.length && chains.length !== 1 ? (
        <div className="ck-talk__peek">
          <p className="ck-talk__last">{brief(lines[lines.length - 1]!)}</p>
          <button type="button" className="btn" data-variant="outline" data-size="sm" onClick={() => setOpen(true)}>
            <MessageCircle size={16} aria-hidden /> {t("ck.talkOpenAll").replace("{n}", String(lines.length))}
          </button>
        </div>
      ) : null}
      {/* What was said, in order. */}
      {!open ? null : lines.length ? (
        <div className="ck-talk__said">
          <p className="ck-talk__sub">{t("ck.talkSaid")}</p>
          {hidden ? (
            <button type="button" className="af-link ck-talk__older" onClick={() => setOlder(true)}>
              {t(hidden > 1 ? "ck.talkOlderMany" : "ck.talkOlder").replace("{n}", String(hidden))}
            </button>
          ) : null}
          <ol className="ck-talk__list">{lines.slice(hidden).map(said)}</ol>
          {turnAsk && chains.length === 1 ? (
            <div className="ck-turn">
              <p className="ck-turn__ask">{turnAsk}</p>
              <button type="button" className="btn" data-variant="default" data-size="default" onClick={() => showVersion(chains[0]![chains[0]!.length - 1]!.view.proposal.id)}>
                {t("ck.talkOpenProposal")}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="af-hint">{t("ck.talkEmpty")}</p>
      )}
      {open ? children : null}
      {open && onSay ? (
        // Something to say about the note, to the team, here: a question, a doubt, a reason. It was only possible by
        // proposing a change or agreeing with one (21 October).
        <form
          className="ck-talk__write"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label className="sr-only" htmlFor="ck-talk-box">
            {t("ck.talkWrite")}
          </label>
          <textarea id="ck-talk-box" className="af-textarea ck-talk__box" rows={2} placeholder={t("ck.talkWrite")} value={draft} onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" className="btn" data-variant="outline" data-size="default" disabled={!draft.trim() || sending || saving}>
            <Send size={16} aria-hidden /> {t("ck.talkSend")}
          </button>
        </form>
      ) : null}
      <Dialog open={Boolean(sheetChain)} onOpenChange={(on) => (on ? null : setSheetOf(null))}>
        <DialogContent className="fix-sheet ck-prop-sheet" aria-describedby={undefined}>
          <header className="fx-head">
            <DialogTitle className="fx-title">{title ?? t("ck.talkProposed")}</DialogTitle>
          </header>
          <div className="fx-body">
            {sheetChain ? docOf(sheetChain, true) : null}
            {onCurrent && sheetHead?.state === "open" && onSay ? (
              // A comment on the proposal, from where it is read: it goes to the conversation like any other.
              <form
                className="ck-talk__write"
                onSubmit={(event) => {
                  event.preventDefault();
                  const text = comment.trim();
                  if (!text) return;
                  void Promise.resolve(onSay(text)).then(() => {
                    setComment("");
                    setSheetOf(null);
                  });
                }}
              >
                <label className="sr-only" htmlFor="ck-sheet-box">
                  {t("ck.sheetWrite")}
                </label>
                <textarea id="ck-sheet-box" className="af-textarea ck-talk__box" rows={2} placeholder={t("ck.sheetWrite")} value={comment} onChange={(event) => setComment(event.target.value)} />
                <button type="submit" className="btn" data-variant="outline" data-size="default" disabled={!comment.trim() || saving}>
                  <Send size={16} aria-hidden /> {t("ck.talkSend")}
                </button>
              </form>
            ) : null}
          </div>
          {onCurrent && sheetHead?.state === "open" ? (
            <footer className="fx-foot ck-prop-sheet__foot">
              {sheetStand === "none" || sheetStand === "against" ? (
                <p className="ck-prop-sheet__ask">
                  {sheetStand === "against" ? t("ck.sheetAskAgainst") : wasFor(sheetChain!) ? t("ck.staleAsk").replace("{n}", String(sheetChain!.length)) : t("ck.proposalAsk").replace("{who}", who(sheetHead.by))}
                </p>
              ) : (
                <p className="ck-prop-sheet__ask ck-prop-sheet__ask--done">{t(sheetStand === "author" ? "ck.sheetYours" : "ck.sheetYouAgree")}</p>
              )}
              <div className="ck-prop-sheet__buttons">
                {sheetStand === "none" || sheetStand === "against" ? (
                  <button type="button" className="btn" data-variant="default" data-size="lg" disabled={saving} onClick={() => act(() => onFor(sheetHead.proposal.id))}>
                    <Check size={16} aria-hidden /> {t(sheetStand === "none" && wasFor(sheetChain!) ? "ck.staleYes" : "ck.voteFor")}
                  </button>
                ) : null}
                {sheetStand === "none" || sheetStand === "for" ? (
                  <button type="button" className="btn" data-variant="outline" data-size="lg" disabled={saving} onClick={() => act(() => onKeep(sheetHead.proposal.id))}>
                    {t("ck.voteKeep")}
                  </button>
                ) : null}
              </div>
              <span className="ck-go__more">
                {onAdjust ? (
                  <button type="button" className="af-link" disabled={saving} onClick={() => act(() => onAdjust(sheetHead))}>
                    {t("ck.adjust")}
                  </button>
                ) : null}
                {sheetStand === "author" ? (
                  <button type="button" className="af-link" disabled={saving} onClick={() => act(() => onWithdraw(sheetHead.proposal.id))}>
                    {t("ck.withdraw")}
                  </button>
                ) : null}
              </span>
            </footer>
          ) : null}
        </DialogContent>
      </Dialog>
      {open && lines.length ? (
        <button type="button" className="af-link ck-talk__close" onClick={() => setOpen(false)}>
          {t("ck.talkClose")}
        </button>
      ) : null}
    </section>
  );
}
