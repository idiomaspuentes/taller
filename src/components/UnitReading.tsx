import { Fragment, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import type { AlignmentMap } from "@usfm-tools/types";
import type { ChecklistItem, ChecklistKind } from "../dcs/checklistLoad";
import { articleBody, termLabel } from "../domain/afinacionWords";
import type { Concern } from "../domain/endorsement";
import { alignedGatewayQuoteForHelpQuote, tokenizeVersePlainText } from "../domain/helpQuoteMatch";
import { concernPlace, concernsAt, concernsOfHelp, helpsOfVerse } from "../domain/unitReading";
import type { VerseTextMap } from "../domain/usfmAst";
import { useT, type MessageKey } from "../i18n/messages";
import { HelpMarkdownView } from "./HelpMarkdownView";

export type UnitHelps = Partial<Record<ChecklistKind, { items: ChecklistItem[]; fromSource: boolean }>>;
export type PlacedConcern = Concern & { by?: string };
export type NewConcern = Pick<Concern, "kind" | "about" | "text" | "item"> & { where: string };

type Text = "tpl" | "tps";
type Props = {
  book: string;
  chapter: number;
  /** The verses of the unit, in order. */
  verses: number[];
  texts: Partial<Record<Text, { verses: VerseTextMap; alignments?: AlignmentMap }>>;
  helps: UnitHelps;
  /** How a resource is called to the person. */
  label: (resource: string) => string;
  termTitles: Record<string, string>;
  /** The article of a term, by its slug: not there until it is read, null when it could not be. */
  articles: Record<string, string | null>;
  /** The terms of a verse are about to be read: their names are wanted. */
  onOpenTerms: (items: ChecklistItem[]) => void;
  /** The article of a term is about to be read. */
  onOpenArticle: (item: ChecklistItem) => void;
  /** What was said about the unit, to show where it was said. */
  concerns: PlacedConcern[];
  /** Noting a concern where it is read; none where the unit is only read (the decision, a step already closed). */
  onConcern?: (concern: NewConcern) => void;
  saving?: boolean;
};

/** A help in view: what it is, and its row. */
type Shown = { kind: ChecklistKind; row: ChecklistItem };
/** What is open under a verse: its helps of one kind, or the helps of one of its words. */
type Open = { verse: number; at: number } & ({ kind: ChecklistKind } | { kind: "word"; resource: Text; index: number });

const KINDS: ChecklistKind[] = ["notas", "preguntas", "palabras"];
/** The helps that point at words of the text. */
const OF_WORDS = ["notas", "palabras"] as const;
const BOTH: Text[] = ["tpl", "tps"];
const COUNT: Record<ChecklistKind, [MessageKey, MessageKey]> = { notas: ["ur.noteOne", "ur.noteMany"], preguntas: ["ur.questionOne", "ur.questionMany"], palabras: ["ur.termOne", "ur.termMany"] };
const SEE: Record<ChecklistKind, MessageKey> = { notas: "ur.seeNote", preguntas: "ur.seeQuestion", palabras: "ur.seeTerm" };
const keyOf = (kind: ChecklistKind, row: ChecklistItem) => `${kind}-${row.id}`;

/**
 * A unit read verse by verse, with what goes with each verse beside it.
 *
 * A committee is asked to judge six resources, and it read two: the passage in its two texts. The notes, the
 * questions and the key terms were a list of what had changed, apart from the verses they explain, and a concern was
 * written by choosing the resource from a list and typing the verse. Under each verse there are now its notes, its
 * questions and its terms to open, and a concern is noted where the person is: about that verse, or that note, with
 * its place and its resource already said.
 *
 * It is the idea of two linked panes (the text, and the helps of what is being read) done in one column: on a phone
 * two panes leave 336px to each, and the helps of one chapter run to 46,000px.
 *
 * The helps of a verse are read one at a time, right under it, and the words the one in view is about are marked in
 * both texts. Opened as a list, the nine notes of one verse ran to 1,783px: the last was two screens away from the
 * text it explains. What has a note or a key term is underlined in the texts, as in the lists of a harmonization:
 * touching a word shows the helps that are about it.
 */
export function UnitReading({ book, chapter, verses, texts, helps, label, termTitles, articles, onOpenTerms, onOpenArticle, concerns, onConcern, saving }: Props) {
  const t = useT();
  const [open, setOpen] = useState<Open | null>(null);
  /** The concern being written: `key` says under what (a verse, or one of its helps). */
  const [writing, setWriting] = useState<{ key: string; kind: Concern["kind"]; about: string; where: string; item?: string; text: string } | null>(null);
  const both = BOTH.filter((resource) => texts[resource]);

  /**
   * For each note and key term, the words its quote of the original points at: where they are in each text (both
   * are aligned to the original), and as a phrase of the literal one, which is what a person calls the help by.
   */
  const pointed = useMemo(() => {
    const out = new Map<string, { phrase: string | null; words: Partial<Record<Text, number[]>> }>();
    for (const kind of OF_WORDS) {
      for (const row of helps[kind]?.items ?? []) {
        if (!row.quote) continue;
        const found: { phrase: string | null; words: Partial<Record<Text, number[]>> } = { phrase: null, words: {} };
        for (const resource of BOTH) {
          const text = texts[resource]?.verses[row.verse];
          if (!text) continue;
          const match = alignedGatewayQuoteForHelpQuote({ verseText: text, quote: row.quote, occurrence: row.occurrence ?? 1, alignments: texts[resource]?.alignments, book, chapter: row.chapter, verse: row.verse });
          found.words[resource] = match.tokenIndices;
          if (resource === "tpl") found.phrase = match.gatewayText;
        }
        out.set(keyOf(kind, row), found);
      }
    }
    return out;
  }, [helps.notas, helps.palabras, texts, book]);

  /** Which helps each word of a verse has, in each text: its notes first, then its key terms. By «verse|text». */
  const coverage = useMemo(() => {
    const out = new Map<string, Map<number, Shown[]>>();
    for (const kind of OF_WORDS) {
      for (const row of helps[kind]?.items ?? []) {
        for (const resource of BOTH) {
          for (const index of new Set(pointed.get(keyOf(kind, row))?.words[resource] ?? [])) {
            const key = `${row.verse}|${resource}`;
            const words = out.get(key) ?? new Map<number, Shown[]>();
            words.set(index, [...(words.get(index) ?? []), { kind, row }]);
            out.set(key, words);
          }
        }
      }
    }
    return out;
  }, [helps.notas, helps.palabras, pointed]);

  const phraseOf = (kind: ChecklistKind, row: ChecklistItem): string | null => pointed.get(keyOf(kind, row))?.phrase ?? null;
  const countLabel = (kind: ChecklistKind, count: number) => t(COUNT[kind][count === 1 ? 0 : 1]).replace("{n}", String(count));
  /** Where a help is, as a concern about it is filed. */
  const placeOfHelp = (kind: ChecklistKind, row: ChecklistItem) =>
    concernPlace(chapter, row.verse, kind === "preguntas" ? row.title : kind === "palabras" ? phraseOf(kind, row) || termLabel(row.title, termTitles) : phraseOf(kind, row));
  /** What was said about one help (see `concernsOfHelp`: two notes of a verse may be about the same words). */
  const saidOf = (kind: ChecklistKind, row: ChecklistItem) =>
    concernsOfHelp(
      concerns,
      kind,
      row.id,
      placeOfHelp(kind, row),
      helpsOfVerse(helps[kind]?.items, row.verse).map((other) => ({ id: other.id, place: placeOfHelp(kind, other) })),
    );

  const toggle = (verse: number, kind: ChecklistKind) => {
    const closing = open?.verse === verse && open.kind === kind;
    setOpen(closing ? null : { verse, kind, at: 0 });
    if (!closing && kind === "palabras") onOpenTerms(helpsOfVerse(helps.palabras?.items, verse));
  };

  /** A word was touched: the helps that are about it. Touched again, on to the next of them. */
  const openWord = (verse: number, resource: Text, index: number) => {
    const list = coverage.get(`${verse}|${resource}`)?.get(index) ?? [];
    if (!list.length) return;
    const again = open?.kind === "word" && open.verse === verse && open.resource === resource && open.index === index;
    setOpen({ verse, kind: "word", resource, index, at: again ? (open.at + 1) % list.length : 0 });
    const terms = list.filter((shown) => shown.kind === "palabras").map((shown) => shown.row);
    if (terms.length) onOpenTerms(terms);
  };

  const concernBox = () =>
    writing ? (
      <div className="ck-no ur-concern" role="group" aria-label={t("en.addConcern")}>
        <p className="ur-concern__about">
          {writing.about ? label(writing.about) : t("ur.whichText")} · {writing.where}
        </p>
        {/* About the verse itself: which of its two texts. One touch, where there was a list of six resources. */}
        {writing.key.startsWith("v") && both.length > 1 ? (
          <div className="ur-kinds">
            {both.map((resource) => (
              <button key={resource} type="button" aria-pressed={writing.about === resource} onClick={() => setWriting({ ...writing, about: resource })}>
                {label(resource)}
              </button>
            ))}
          </div>
        ) : null}
        <div className="ck-no__outcomes">
          {(["observation", "objection"] as const).map((kind) => (
            <button key={kind} type="button" aria-pressed={writing.kind === kind} onClick={() => setWriting({ ...writing, kind })}>
              {t(kind === "objection" ? "en.objectionLong" : "en.observationLong")}
            </button>
          ))}
        </div>
        <textarea className="af-textarea" rows={3} value={writing.text} aria-label={t("en.what")} placeholder={t("en.what")} onChange={(e) => setWriting({ ...writing, text: e.target.value })} />
        <div className="af-buttons">
          <button
            type="button"
            className="btn"
            data-variant="default"
            data-size="default"
            disabled={saving || !writing.text.trim() || !writing.about}
            onClick={() => {
              onConcern?.({ kind: writing.kind, about: writing.about, where: writing.where, text: writing.text.trim(), ...(writing.item ? { item: writing.item } : {}) });
              setWriting(null);
            }}
          >
            {t("en.addIt")}
          </button>
          <button type="button" className="btn" data-variant="ghost" data-size="default" onClick={() => setWriting(null)}>
            {t("af.cancel")}
          </button>
        </div>
      </div>
    ) : null;

  /** The line that starts a concern about something, or the box where it is being written. */
  const concernLine = (key: string, about: string, where: string, said: MessageKey, item?: string) =>
    !onConcern ? null : writing?.key === key ? (
      concernBox()
    ) : (
      <button type="button" className="ur-add" onClick={() => setWriting({ key, kind: "observation", about, where, text: "", ...(item ? { item } : {}) })}>
        <MessageSquare size={14} aria-hidden /> {t(said)}
      </button>
    );

  /**
   * The foot of a help: what was said about it, each concern named by whose it is, and the way to note one. It is
   * a part of the card of its own, under a line and on another ground: as more lines under the note, a concern read
   * as part of what the note says.
   */
  const helpFoot = (list: PlacedConcern[], add: ReturnType<typeof concernLine>) =>
    list.length || add ? (
      <div className="ur-item__foot">
        {list.length ? (
          <>
            <p className="ur-lbl">{t("ur.notedLbl")}</p>
            <ul className="ur-said">
              {list.map((concern) => (
                <li key={`${concern.by ?? ""}-${concern.id}`} data-kind={concern.kind}>
                  <b>{concern.by ? t(concern.kind === "objection" ? "ur.objectionBy" : "ur.observationBy").replace("{who}", concern.by) : t(concern.kind === "objection" ? "ur.yourObjection" : "ur.yourObservation")}</b>
                  <span>{concern.text}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {add}
      </div>
    ) : null;

  /** `tagged`: among the helps of a word a note and a key term come together, and each says which it is. */
  const item = ({ kind, row }: Shown, tagged: boolean) => {
    const phrase = phraseOf(kind, row);
    const key = keyOf(kind, row);
    const tag = tagged ? <p className="ur-item__kind">{t(kind === "palabras" ? "ur.kindTerm" : "ur.kindNote")}</p> : null;
    if (kind === "palabras") {
      const slug = row.title;
      const article = articles[slug];
      return (
        <li key={key} className="ur-item">
          {tag}
          {/* The words of the text, the name of the term, and its article to open: three lines, each one thing. */}
          {phrase ? <p className="ur-item__head">«{phrase}»</p> : null}
          <p className="ur-item__term">{termLabel(slug, termTitles)}</p>
          <details className="ur-term" onToggle={(e) => e.currentTarget.open && onOpenArticle(row)}>
            <summary>{t("ur.readArticle")}</summary>
            {article === undefined ? <p className="af-hint">{t("ur.readingArticle")}</p> : article === null ? <p className="af-hint">{t("ur.noArticle")}</p> : <HelpMarkdownView className="ur-md ur-article" content={articleBody(article)} />}
          </details>
          {helpFoot(saidOf(kind, row), concernLine(key, kind, placeOfHelp(kind, row), "ur.concernTerm", row.id))}
        </li>
      );
    }
    return (
      <li key={key} className="ur-item">
        {tag}
        {kind === "preguntas" ? <p className="ur-item__head">{row.title}</p> : phrase ? <p className="ur-item__head">«{phrase}»</p> : null}
        {row.body ? <HelpMarkdownView className="ur-md" content={row.body} /> : null}
        {helpFoot(saidOf(kind, row), concernLine(key, kind, placeOfHelp(kind, row), kind === "preguntas" ? "ur.concernQuestion" : "ur.concernNote", row.id))}
      </li>
    );
  };

  return (
    <div className="ur">
      {coverage.size ? <p className="af-hint ur-hint">{t("ur.coveredHint")}</p> : null}
      {verses.map((verse) => {
        const mine = open?.verse === verse ? open : null;
        const shownKind = mine && mine.kind !== "word" ? mine.kind : null;
        // One help in view at a time: which, the words of the verse it is about, and what comes after the last.
        const list: Shown[] = !mine
          ? []
          : mine.kind === "word"
            ? (coverage.get(`${verse}|${mine.resource}`)?.get(mine.index) ?? [])
            : helpsOfVerse(helps[mine.kind]?.items, verse).map((row) => ({ kind: mine.kind as ChecklistKind, row }));
        const at = Math.min(mine?.at ?? 0, Math.max(list.length - 1, 0));
        const inView = list[at];
        const here = inView ? pointed.get(keyOf(inView.kind, inView.row))?.words : undefined;
        const after = shownKind ? KINDS.slice(KINDS.indexOf(shownKind) + 1).find((kind) => helpsOfVerse(helps[kind]?.items, verse).length) : undefined;
        // What was said about the verse; what is about the help in view is under that help, and is not said twice.
        const underHelp = new Set(inView ? saidOf(inView.kind, inView.row) : []);
        const said = concernsAt(concerns, chapter, verse).filter((concern) => !concern.withdrawn && !underHelp.has(concern));
        const touched = mine?.kind === "word" ? (tokenizeVersePlainText(texts[mine.resource]?.verses[verse] ?? "")[mine.index] ?? "").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "") : "";
        return (
          <section key={verse} className="ur-verse" aria-label={`${chapter}:${verse}`}>
            <h3 className="ur-ref">
              {chapter}:{verse}
            </h3>
            {both.map((resource) => {
              const text = texts[resource]!.verses[verse];
              if (!text) return null;
              const covered = coverage.get(`${verse}|${resource}`);
              const marked = new Set(here?.[resource] ?? []);
              return (
                <p key={resource} className="ur-text">
                  <span className="af-lbl">{label(resource)}</span>{" "}
                  {covered?.size
                    ? tokenizeVersePlainText(text).map((token, index) => (
                        <Fragment key={index}>
                          {index ? <span className="ur-space" data-here={(marked.has(index) && marked.has(index - 1)) || undefined}> </span> : null}
                          {covered.has(index) ? (
                            <button type="button" className="ur-word" data-here={marked.has(index) || undefined} onClick={() => openWord(verse, resource, index)}>
                              {token}
                            </button>
                          ) : (
                            token
                          )}
                        </Fragment>
                      ))
                    : text}
                </p>
              );
            })}
            <div className="ur-kinds">
              {KINDS.map((kind) => {
                const count = helpsOfVerse(helps[kind]?.items, verse).length;
                return count ? (
                  <button key={kind} type="button" aria-expanded={shownKind === kind} onClick={() => toggle(verse, kind)}>
                    {countLabel(kind, count)}
                  </button>
                ) : null;
              })}
            </div>
            {mine && inView ? (
              <div className="ur-open">
                {helps[inView.kind]?.fromSource ? <p className="af-hint">{t("ur.fromSource")}</p> : null}
                {/* Above the help, so the buttons stay where they are whatever the length of what is read. */}
                <div className="ur-pager">
                  {/* The way back is its arrow alone: with its word the place («Nota 2 de 9») broke in two lines on a phone. */}
                  <button type="button" className="btn" data-variant="outline" data-size="default" aria-label={t("af.prev")} disabled={at === 0} onClick={() => setOpen({ ...mine, at: at - 1 })}>
                    <ChevronLeft size={20} aria-hidden />
                  </button>
                  {/* What is being gone over, and where one is in it: two short lines, which fit beside the buttons. */}
                  <span className="ur-pager__at" role="status">
                    <span className="ur-lbl">{mine.kind === "word" ? t("ur.aboutWord").replace("{word}", touched) : label(mine.kind)}</span>
                    <b>{t("ur.at").replace("{n}", String(at + 1)).replace("{of}", String(list.length))}</b>
                  </span>
                  {at < list.length - 1 ? (
                    <button type="button" className="btn" data-variant="default" data-size="default" onClick={() => setOpen({ ...mine, at: at + 1 })}>
                      {t("af.next")} <ChevronRight size={16} aria-hidden />
                    </button>
                  ) : after ? (
                    // After the last, on to what else the verse has.
                    <button type="button" className="btn" data-variant="default" data-size="default" onClick={() => toggle(verse, after)}>
                      {countLabel(after, helpsOfVerse(helps[after]?.items, verse).length)} <ChevronRight size={16} aria-hidden />
                    </button>
                  ) : (
                    <button type="button" className="btn" data-variant="outline" data-size="default" onClick={() => setOpen(null)}>
                      {t("ur.close")}
                    </button>
                  )}
                </div>
                <ul className="ur-items">{item(inView, mine.kind === "word")}</ul>
              </div>
            ) : null}
            {/* About the verse, apart from the help in view: under the card of a key term, a concern about a note of
                the verse read as said of that term. */}
            <div className="ur-foot" data-apart={mine && inView ? true : undefined}>
              {said.length ? (
                <>
                  <p className="ur-lbl">{t("ur.verseNoted")}</p>
                  <ul className="ur-said">
                    {said.map((concern) => {
                      const kind = KINDS.find((candidate) => candidate === concern.about);
                      const at = kind ? helpsOfVerse(helps[kind]?.items, verse).findIndex((row) => saidOf(kind, row).includes(concern)) : -1;
                      return (
                        <li key={`${concern.by ?? ""}-${concern.id}`} data-kind={concern.kind}>
                          {/* Which note or term of the verse it is about is in its place, after the verse the list is under. */}
                          <b>
                            {t(concern.kind === "objection" ? "en.objection" : "en.observation")} · {label(concern.about)}
                            {(concern.where ?? "").replace(/^\s*\d+:\d+\s*/, "") ? ` ${(concern.where ?? "").replace(/^\s*\d+:\d+\s*/, "")}` : ""}
                            {concern.by ? ` · @${concern.by}` : ""}
                          </b>
                          <span>{concern.text}</span>
                          {kind && at >= 0 ? (
                            <button type="button" className="ur-add" onClick={() => setOpen({ verse, kind, at })}>
                              {t(SEE[kind])} <ChevronRight size={14} aria-hidden />
                            </button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : null}
              {concernLine(`v${verse}`, both.length === 1 ? both[0]! : "", concernPlace(chapter, verse), "ur.concernVerse")}
            </div>
          </section>
        );
      })}
    </div>
  );
}
