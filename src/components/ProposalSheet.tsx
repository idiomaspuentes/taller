import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { diffExcerpt, readable, wordDiff, type ProposalState } from "../domain/checkProposal";
import { toggleQuoteWord, wholeQuoteWords } from "../domain/quoteFromSelection";
import { noteFromTsv, noteToTsv } from "../domain/helpMarkup";
import { MarkdownEditor } from "./MarkdownEditor";
import { HelpMarkdownView } from "./HelpMarkdownView";
import { FormalAddressHint } from "./FormalAddressHint";
import { HelpChecksHint, helpKindOf } from "./HelpChecksHint";
import type { HelpsAddress } from "../domain/formalAddress";
import { isScriptureResource, type ScopeKey } from "../domain/types";
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
  /** Whose that version is, when it is not this person's: another starts from it and goes beside it. */
  startBy?: string;
  /**
   * How its words are kept: a `note` in a table file (its line ends written out), an article in `markdown`. Those
   * are written as they look (bold is bold, a link to an article is a piece that names it), not as they are kept:
   * the box showed «**Fe**» and «[[rc://…]]» to somebody who came to change a word.
   */
  format?: "note" | "markdown";
  /** A help that does not exist yet: what is written is all of it, and there is nothing to comment on instead. */
  add?: boolean;
  /**
   * The words of the verse, for a new help to be said what it is about by touching them. A note that is added
   * when its list is already closed has no other moment to be tied to its words.
   */
  words?: string[];
  /** For each of `words`, those that go with it in a quote (tied to the same words of the original); `null`: none. */
  units?: (number[] | null)[];
  /**
   * A note that can be parted in two: the id its other half would have and, to say what each half is about, the
   * words of the verse and those the note quotes now (where both halves start from).
   */
  split?: { rowId: string; words?: string[]; units?: (number[] | null)[]; marked?: number[]; /** What the new note quotes, when it is not that: a note already parted. */ newMarked?: number[] };
  /** There is nothing to rewrite (what is missing has no words yet): only a comment. */
  commentOnly?: boolean;
  /** Who maintains it, when it is not this team: the proposal is asked of them once the team agrees on it. */
  team?: string;
};

export type ProposalDraft = {
  target: ProposalTarget;
  after?: string;
  reason: string;
  /** Which of `target.words` were marked. */
  marked?: number[];
  /** A note parted in two: what the new note says, and which of `target.split.words` it is about. */
  split?: { after: string; marked?: number[]; /** The other new notes, parted in more than two. */ more?: { after: string; marked?: number[] }[] };
  /** A note parted in two, the words of `target.split.words` the note that stays is about, when they changed. */
  keepMarked?: number[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  targets: ProposalTarget[];
  /**
   * The question that was answered «no»: said as what it is, over the sheet. It came written as the reason, and a
   * question is not a reason: «Motivo: ¿Tiene sentido con el texto?» is what the team then read on the proposal.
   */
  failed?: string;
  /** The rule of the step, small under the question: what a change has to keep (the helps explain without softening). */
  rule?: string;
  /** Why, to start with: what was said of the proposal this one answers. */
  reason: string;
  /** The book the helps are of, for the links to its verses. */
  book?: string;
  /** The version to start from, instead of the words as they are: answering a proposal with another. */
  startFrom?: string;
  /** The new note to start from, answering a proposal that parts a note in two: the sheet opens on its two halves. */
  startSplit?: string;
  saving?: boolean;
  /** How the team's helps speak to the translator: a new version of a help that says otherwise is pointed out. */
  address?: HelpsAddress;
  /**
   * The things to change offered first, by id: what the step reads the help against and the help itself («Esta
   * nota», «El TPL»). The others are a touch away. Folded behind one «Cambiar», a change to the TPL for the team of
   * afinación was three touches deep, and nobody found it (20 October).
   */
  primary?: string[];
  /** What the sheet is for, over everything: adjusting the version of somebody («Ajustas la versión 2 de @carla…»). */
  lead?: string;
  onSend: (draft: ProposalDraft) => void;
};

/**
 * Proposing a change: what, how (the new version written over the words as they are, a note parted in two, or a
 * comment) and why. A sheet over the help, so the help stays where it was.
 */
export function ProposalSheet({ open, onClose, targets, failed, reason: firstReason, book, startFrom, startSplit, saving, address, primary, lead, onSend }: Props) {
  const t = useT();
  const [targetId, setTargetId] = useState(targets[0]?.id ?? "");
  const [mode, setMode] = useState<"text" | "split" | "comment">("text");
  const [text, setText] = useState("");
  // A note parted in two, in two steps: the new note first, written with the note as it is in sight; then the note
  // that stays, with the new one in sight to take out of it what went there. Each with the words it quotes.
  const [other, setOther] = useState("");
  /** The new notes after the first, when the note is parted in more than two: what each says and is about. */
  const [extra, setExtra] = useState<{ text: string; marked: number[] }[]>([]);
  const [part, setPart] = useState<1 | 2>(1);
  const [keepMarked, setKeepMarked] = useState<number[]>([]);
  // The boxes are made anew when they start again, since they keep what they last said the text was.
  const [turn, setTurn] = useState(0);
  const [reason, setReason] = useState(firstReason);
  const [marked, setMarked] = useState<number[]>([]);
  // What is changed, said in a line until asked to change: five things to change and three ways to, ten choices
  // before the box, when what failed already says it is the note (20 October). How stays in sight: it is one row.
  const [askHow, setAskHow] = useState(false);
  const target = targets.find((row) => row.id === targetId) ?? targets[0];
  /** The things to change in sight: those offered first, the one chosen, or all of them once asked for. */
  const offered = askHow || !primary?.length ? targets : targets.filter((row) => primary.includes(row.id) || row.id === target?.id).sort((a, b) => primary.indexOf(a.id) - primary.indexOf(b.id));
  const current = target?.text ?? "";
  const canWrite = Boolean(target && !target.commentOnly && target.text !== undefined);
  const canSplit = canWrite && Boolean(target?.split) && !target?.add;
  // A verse is what its people say, «tú» included: only a help speaks to the translator.
  const helpAddress = target && !isScriptureResource(target.resource as ScopeKey) ? address : undefined;
  /** Notes and Words articles are checked as they are written: what Taller finds goes under the box. */
  const helpKind = helpKindOf(target?.resource);
  /** What is written starts from: the version this one answers, the one already proposed, or the words as they are. */
  const base = startFrom ?? target?.start ?? current;

  // Opened again: for another help, or for another question of the same one.
  const opening = open ? `${targets.map((row) => row.id).join(",")}|${failed ?? ""}|${firstReason}|${startFrom ?? ""}|${startSplit ?? ""}` : "";
  useEffect(() => {
    if (!opening) return;
    setTargetId(targets[0]?.id ?? "");
    setReason(firstReason);
    setAskHow(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening]);
  // What is written starts from the words of what was chosen; a long article starts as a comment.
  useEffect(() => {
    if (!open || !target) return;
    setText(base);
    setOther(startSplit ?? "");
    setExtra([]);
    setPart(1);
    setMarked(wholeQuoteWords(target.split?.newMarked ?? target.split?.marked ?? [], target.split?.units ?? []));
    setKeepMarked(wholeQuoteWords(target.split?.marked ?? [], target.split?.units ?? []));
    setMode(canSplit && startSplit !== undefined ? "split" : canWrite && (target.add || current.length <= 1200) ? "text" : "comment");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening, targetId, current, canWrite]);

  const writing = mode === "text" && canWrite;
  const splitting = mode === "split" && canSplit;

  function choose(next: "text" | "split" | "comment") {
    // Into parting the note or out of it, the boxes start again from the note: half a note is no new version of it.
    if ((next === "split") !== (mode === "split")) {
      setText(base);
      setOther(startSplit ?? "");
      setExtra([]);
      setPart(1);
      setMarked(next === "split" ? wholeQuoteWords(target?.split?.newMarked ?? target?.split?.marked ?? [], target?.split?.units ?? []) : []);
      setKeepMarked(wholeQuoteWords(target?.split?.marked ?? [], target?.split?.units ?? []));
      setTurn((n) => n + 1);
    }
    setMode(next);
  }
  const bodyRef = useRef<HTMLDivElement>(null);
  /** On to a step of parting a note, read from its heading: the other note is right under it. */
  const goTo = (next: 1 | 2) => {
    setPart(next);
    requestAnimationFrame(() => bodyRef.current?.querySelector(".pr-step")?.scrollIntoView({ block: "start" }));
  };
  const toggle = (list: number[], index: number) => (list.includes(index) ? list.filter((i) => i !== index) : [...list, index].sort((a, b) => a - b));

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
  const parted = changed && Boolean(other.trim());
  const ready = Boolean(target) && (splitting ? part === 2 && parted : writing ? changed : Boolean(reason.trim()));
  // What a new note is about is said by touching the words of the verse; parting a note, what each half is about.
  const words = writing && target?.add ? target.words : undefined;
  const splitWords = splitting ? (target?.split?.words ?? []) : [];
  /** The words of the verse to touch for what a note is about: one row of them, under the box of that note. */
  // A word goes with those tied to the same words of the original: marked and unmarked together.
  const wordsField = (list: string[], picked: number[], onPick: Dispatch<SetStateAction<number[]>>, units: (number[] | null)[] = []) => (
    <div className="pr-field">
      <p className="af-lbl">{t("pr.aboutWords")}</p>
      <div className="pr-words" role="group" aria-label={t("pr.aboutWords")}>
        {list.map((word, index) => (
          <button key={index} type="button" className="ck-word" aria-pressed={picked.includes(index)} disabled={units.some(Boolean) && !units[index]} onClick={() => onPick((prev) => (units.some(Boolean) ? toggleQuoteWord(prev, index, units) : toggle(prev, index)))}>
            {word}
          </button>
        ))}
      </div>
      <p className="af-hint">{t("pr.aboutWordsHint")}</p>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="ur-sheet pr-sheet" showCloseButton={false}>
        <header className="ur-sheet__head">
          <DialogTitle>{t("pr.title")}</DialogTitle>
          <button type="button" className="btn" data-variant="outline" data-size="default" onClick={onClose}>
            {t("ur.close")}
          </button>
        </header>
        <div ref={bodyRef} className="ur-sheet__body pr-body">
          {lead ? <p className="pr-lead">{lead}</p> : null}
          {failed ? <p className="pr-failed">{t("pr.failed").replace("{q}", failed)}</p> : null}
          {/* What to change and how, asked only when asked for (26 October): the box to write the new version comes
              first, since what failed already says it is this help; the rest are the «Otras formas» at the foot. */}
          {askHow && targets.length > 1 && !(splitting && part === 2) ? (
            <div className="pr-field">
              <p className="af-lbl">{t("pr.what")}</p>
              <div className="pr-chips" role="group" aria-label={t("pr.what")}>
                {offered.map((row) => (
                  <button key={row.id} type="button" aria-pressed={row.id === target?.id} onClick={() => setTargetId(row.id)}>
                    {row.label}
                  </button>
                ))}
              </div>
              {offered.length < targets.length ? (
                <button type="button" className="af-link pr-what-more" onClick={() => setAskHow(true)}>
                  {t("pr.whatMore")}
                </button>
              ) : null}
              {/* Where it goes, said where it is chosen: a change to the TPL is asked of the team that keeps it. */}
              {target?.team ? <p className="af-hint pr-goes">{t("pr.goesToOther").replace("{team}", target.team)}</p> : null}
            </div>
          ) : null}
          {target?.team && !askHow ? <p className="af-hint pr-goes">{t("pr.goesToOther").replace("{team}", target.team)}</p> : null}
          {askHow && canWrite && !target?.add && !(splitting && part === 2) ? (
            <div className="pr-field">
              <p className="af-lbl">{t("pr.how")}</p>
              <div className="pr-chips" role="group" aria-label={t("pr.how")}>
                <button type="button" aria-pressed={writing} onClick={() => choose("text")}>
                  {t("pr.newVersion")}
                </button>
                {canSplit ? (
                  <button type="button" aria-pressed={splitting} onClick={() => choose("split")}>
                    {t("pr.split")}
                  </button>
                ) : null}
                <button type="button" aria-pressed={!writing && !splitting} onClick={() => choose("comment")}>
                  {t("pr.onlyComment")}
                </button>
              </div>
            </div>
          ) : null}
          {writing ? (
            <div className="pr-field">
              <label className="af-lbl" htmlFor="pr-text">
                {target?.add ? t("pr.newNoteLbl") : t("pr.writeAs").replace("{what}", (target?.label ?? "").replace(/^./, (first) => first.toLocaleLowerCase()))}
              </label>
              {target?.format ? (
                <MarkdownEditor
                  // Made anew for another help or another start: it keeps what it last said the text was.
                  key={`${opening}|${targetId}|${turn}`}
                  id="pr-text"
                  compact={target.format === "note"}
                  book={book}
                  value={target.format === "note" ? noteFromTsv(text) : text}
                  onChange={(written) => setText(target.format === "note" ? noteToTsv(written) : written)}
                />
              ) : (
                <textarea id="pr-text" ref={textRef} className="af-textarea pr-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
              )}
              <FormalAddressHint
                text={target?.format === "note" ? noteFromTsv(text) : text}
                address={helpAddress}
                onFix={(fixed) => setText(target?.format === "note" ? noteToTsv(fixed) : fixed)}
              />
              {helpKind ? (
                <HelpChecksHint
                  text={target?.format === "note" ? noteFromTsv(text) : text}
                  kind={helpKind}
                  before={target?.format === "note" ? noteFromTsv(current) : current}
                  onFix={(fixed) => setText(target?.format === "note" ? noteToTsv(fixed) : fixed)}
                />
              ) : null}
              {target?.start ? <p className="af-hint">{target.startBy ? t("pr.fromOther").replace("{who}", target.startBy) : t("pr.fromPrior")}</p> : !changed ? <p className="af-hint">{t(target?.add ? "pr.writeNew" : "pr.same")}</p> : null}
              {/* What the new version changes, as it is written: what is crossed out and what is new. */}
              {changed && !target?.add ? (
                <div className="pr-change">
                  <p className="pr-change__lbl">{t("pr.changesLbl")}</p>
                  <span className="ag-diff">
                    <ProposalDiff before={current} after={text} plain />
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
          {splitting ? (
            // Two steps, one box at a time, with the other note in sight (20 October). The sentences of the note
            // were offered to touch, to say which went to the new one, and the boxes of both notes were under them:
            // three versions of the same words at once, and the touching said little that the boxes did not.
            <>
              <p className="pr-step">{t(part === 1 ? "pr.splitStep1" : "pr.splitStep2")}</p>
              {/* Over a change already proposed for the note, it is that version that is parted. */}
              {part === 1 ? (
                <section className="pr-ref" aria-label={t(base !== current ? "pr.splitProposed" : "pr.splitNow")}>
                  <p className="pr-ref__lbl">{t(base !== current ? "pr.splitProposed" : "pr.splitNow")}</p>
                  <HelpMarkdownView className="af-note af-note--md pr-ref__text" content={noteFromTsv(base)} />
                </section>
              ) : (
                // Every new note in sight, to take out of this one what went to each.
                [other, ...extra.map((one) => one.text)].filter((one) => one.trim()).map((one, index) => (
                  <section key={index} className="pr-ref" aria-label={t("pr.newNoteN").replace("{n}", String(index + 1))}>
                    <p className="pr-ref__lbl">{t("pr.newNoteN").replace("{n}", String(index + 1))}</p>
                    <HelpMarkdownView className="af-note af-note--md pr-ref__text" content={noteFromTsv(one)} />
                  </section>
                ))
              )}
              {part === 1 ? (
                <div className="pr-field">
                  <label className="af-lbl" htmlFor="pr-other">
                    {t(extra.length ? "pr.newNoteN" : "pr.newNoteLbl").replace("{n}", "1")}
                  </label>
                  <MarkdownEditor key={`${opening}|${targetId}|new|${turn}`} id="pr-other" compact book={book} value={noteFromTsv(other)} onChange={(written) => setOther(noteToTsv(written))} />
                  <FormalAddressHint text={noteFromTsv(other)} address={helpAddress} onFix={(fixed) => setOther(noteToTsv(fixed))} />
                  {helpKind ? <HelpChecksHint text={noteFromTsv(other)} kind={helpKind} onFix={(fixed) => setOther(noteToTsv(fixed))} /> : null}
                </div>
              ) : (
                <div className="pr-field">
                  <label className="af-lbl" htmlFor="pr-text">
                    {t("pr.splitKeeps")}
                  </label>
                  <MarkdownEditor key={`${opening}|${targetId}|keeps|${turn}`} id="pr-text" compact book={book} value={noteFromTsv(text)} onChange={(written) => setText(noteToTsv(written))} />
                  <FormalAddressHint text={noteFromTsv(text)} address={helpAddress} onFix={(fixed) => setText(noteToTsv(fixed))} />
                  {helpKind ? <HelpChecksHint text={noteFromTsv(text)} kind={helpKind} before={noteFromTsv(current)} onFix={(fixed) => setText(noteToTsv(fixed))} /> : null}
                  <p className="af-hint">{t(changed ? "pr.splitKeepsHint" : "pr.splitTakeOut")}</p>
                </div>
              )}
              {splitWords.length ? (part === 1 ? wordsField(splitWords, marked, setMarked, target?.split?.units) : wordsField(splitWords, keepMarked, setKeepMarked, target?.split?.units)) : null}
              {/* Parted in more than two: another new note, each with what it says and the words it is about. */}
              {part === 1
                ? extra.map((one, index) => (
                    <div key={index} className="pr-extra">
                      <div className="pr-field">
                        <label className="af-lbl" htmlFor={`pr-other-${index}`}>
                          {t("pr.newNoteN").replace("{n}", String(index + 2))}
                        </label>
                        <MarkdownEditor key={`${opening}|${targetId}|new${index}|${turn}`} id={`pr-other-${index}`} compact book={book} value={noteFromTsv(one.text)} onChange={(written) => setExtra((now) => now.map((row, at) => (at === index ? { ...row, text: noteToTsv(written) } : row)))} />
                      </div>
                      {splitWords.length
                        ? wordsField(splitWords, one.marked, (next) => setExtra((now) => now.map((row, at) => (at === index ? { ...row, marked: typeof next === "function" ? next(row.marked) : next } : row))), target?.split?.units)
                        : null}
                      <button type="button" className="af-link pr-extra__drop" onClick={() => setExtra((now) => now.filter((_, at) => at !== index))}>
                        {t("pr.dropNote")}
                      </button>
                    </div>
                  ))
                : null}
              {part === 1 ? (
                <button type="button" className="af-link pr-extra__add" disabled={!other.trim() || extra.some((one) => !one.text.trim())} onClick={() => setExtra((now) => [...now, { text: "", marked: [] }])}>
                  <Plus size={16} aria-hidden /> {t("pr.addNote")}
                </button>
              ) : null}
            </>
          ) : null}
          {words?.length ? wordsField(words, marked, setMarked, target?.units) : null}
          {splitting && part === 1 ? null : (
            <div className="pr-field">
              <label className="af-lbl" htmlFor="pr-reason">
                {t(writing || splitting ? "pr.whyTeam" : "pr.commentLbl")}
              </label>
              <textarea id="pr-reason" className="af-textarea" rows={writing || splitting ? 2 : 4} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          )}
          {/* The other ways, quiet, at the foot: another thing to change, parting the note, only a comment. */}
          {!askHow && !(splitting && part === 2) ? (
            <p className="pr-ways">
              <span>{t("pr.otherWays")}</span>
              {canWrite && !writing && !target?.add ? (
                <button type="button" className="af-link" onClick={() => choose("text")}>
                  {t("pr.newVersion")}
                </button>
              ) : null}
              {targets.length > 1 ? (
                <button type="button" className="af-link" onClick={() => setAskHow(true)}>
                  {t("pr.changeOther")}
                </button>
              ) : null}
              {canSplit && !splitting ? (
                <button type="button" className="af-link" onClick={() => choose("split")}>
                  {t("pr.split")}
                </button>
              ) : null}
              {!(mode === "comment") ? (
                <button type="button" className="af-link" onClick={() => choose("comment")}>
                  {t("pr.onlyComment")}
                </button>
              ) : null}
            </p>
          ) : null}
          {/* Where a change to what another team keeps goes is said where it is chosen, above. */}
          {target?.team ? null : <p className="af-hint">{t("pr.goesToTeam")}</p>}
        </div>
        <footer className="pr-foot">
          <button type="button" className="btn" data-variant="ghost" data-size="default" onClick={() => (splitting && part === 2 ? goTo(1) : onClose())}>
            {t(splitting && part === 2 ? "pr.back" : "af.cancel")}
          </button>
          {splitting && part === 1 ? (
            <button type="button" className="btn" data-variant="default" data-size="default" disabled={!other.trim()} onClick={() => goTo(2)}>
              {t("pr.next")}
            </button>
          ) : (
            <button
              type="button"
              className="btn"
              data-variant="default"
              data-size="default"
              disabled={saving || !ready}
              onClick={() =>
                target &&
                onSend({
                  target,
                  reason: reason.trim(),
                  ...(writing || splitting ? { after: text.trim() } : {}),
                  ...(splitting
                    ? {
                        split: {
                          after: other.trim(),
                          ...(marked.length ? { marked } : {}),
                          ...(extra.some((one) => one.text.trim()) ? { more: extra.filter((one) => one.text.trim()).map((one) => ({ after: one.text.trim(), ...(one.marked.length ? { marked: one.marked } : {}) })) } : {}),
                        },
                      }
                    : {}),
                  ...(splitting && keepMarked.length ? { keepMarked } : {}),
                  ...(writing && target.add && marked.length ? { marked } : {}),
                })
              }
            >
              {t(writing ? "pr.sendVersion" : "pr.send")}
            </button>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
