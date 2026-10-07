import { Fragment, useState } from "react";
import { ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import type { AlignmentMap } from "@usfm-tools/types";
import type { ChecklistItem, ChecklistKind } from "../dcs/checklistLoad";
import { articleBody, termLabel } from "../domain/afinacionWords";
import type { Concern } from "../domain/endorsement";
import { alignedGatewayQuoteForHelpQuote, tokenizeVersePlainText } from "../domain/helpQuoteMatch";
import { concernPlace, concernsAt, helpsOfVerse } from "../domain/unitReading";
import type { VerseTextMap } from "../domain/usfmAst";
import { useT, type MessageKey } from "../i18n/messages";
import { HelpMarkdownView } from "./HelpMarkdownView";

export type UnitHelps = Partial<Record<ChecklistKind, { items: ChecklistItem[]; fromSource: boolean }>>;
export type PlacedConcern = Concern & { by?: string };
export type NewConcern = Pick<Concern, "kind" | "about" | "text"> & { where: string };

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

const KINDS: ChecklistKind[] = ["notas", "preguntas", "palabras"];
const COUNT: Record<ChecklistKind, [MessageKey, MessageKey]> = { notas: ["ur.noteOne", "ur.noteMany"], preguntas: ["ur.questionOne", "ur.questionMany"], palabras: ["ur.termOne", "ur.termMany"] };
const AT: Record<ChecklistKind, MessageKey> = { notas: "ur.atNote", preguntas: "ur.atQuestion", palabras: "ur.atTerm" };

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
 * The helps of a verse are read one at a time, right under it, and the words of the literal text the one in view is
 * about are marked in the verse. Opened as a list, the nine notes of one verse ran to 1,783px: the last was two
 * screens away from the text it explains.
 */
export function UnitReading({ book, chapter, verses, texts, helps, label, termTitles, articles, onOpenTerms, onOpenArticle, concerns, onConcern, saving }: Props) {
  const t = useT();
  const [open, setOpen] = useState<{ verse: number; kind: ChecklistKind; at: number } | null>(null);
  /** The concern being written: `key` says under what (a verse, or one of its helps). */
  const [writing, setWriting] = useState<{ key: string; kind: Concern["kind"]; about: string; where: string; text: string } | null>(null);
  const both = (["tpl", "tps"] as Text[]).filter((resource) => texts[resource]);

  /** The words of the literal text an item's quote of the original points at: where they are in the verse, and as a phrase. */
  const quoteOf = (item: ChecklistItem) => {
    const text = texts.tpl?.verses[item.verse];
    if (!item.quote || !text) return null;
    return alignedGatewayQuoteForHelpQuote({ verseText: text, quote: item.quote, occurrence: item.occurrence ?? 1, alignments: texts.tpl?.alignments, book, chapter: item.chapter, verse: item.verse });
  };
  /** What a person calls the item by. */
  const phraseOf = (item: ChecklistItem): string | null => quoteOf(item)?.gatewayText ?? null;
  const countLabel = (kind: ChecklistKind, count: number) => t(COUNT[kind][count === 1 ? 0 : 1]).replace("{n}", String(count));

  const toggle = (verse: number, kind: ChecklistKind) => {
    const closing = open?.verse === verse && open.kind === kind;
    setOpen(closing ? null : { verse, kind, at: 0 });
    if (!closing && kind === "palabras") onOpenTerms(helpsOfVerse(helps.palabras?.items, verse));
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
              onConcern?.({ kind: writing.kind, about: writing.about, where: writing.where, text: writing.text.trim() });
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
  const concernLine = (key: string, about: string, where: string, said: MessageKey) =>
    !onConcern ? null : writing?.key === key ? (
      concernBox()
    ) : (
      <button type="button" className="ur-add" onClick={() => setWriting({ key, kind: "observation", about, where, text: "" })}>
        <MessageSquare size={14} aria-hidden /> {t(said)}
      </button>
    );

  /**
   * What was said about one help, under that help. It was listed only at the foot of its verse: whoever noted a
   * concern on the first of nine notes saw the box close and the note as it was before, and found what they had
   * written two screens further down.
   */
  const saidHere = (kind: ChecklistKind, where: string) => {
    const said = concerns.filter((concern) => !concern.withdrawn && concern.about === kind && (concern.where ?? "") === where);
    return said.length ? (
      <ul className="ur-said">
        {said.map((concern) => (
          <li key={`${concern.by ?? ""}-${concern.id}`} data-kind={concern.kind}>
            <b>{t(concern.kind === "objection" ? "en.objection" : "en.observation")}</b>
            {concern.by ? ` · @${concern.by}` : ""}: {concern.text}
          </li>
        ))}
      </ul>
    ) : null;
  };

  /** Where a help is, as a concern about it is filed. */
  const placeOfHelp = (kind: ChecklistKind, row: ChecklistItem) =>
    concernPlace(chapter, row.verse, kind === "preguntas" ? row.title : kind === "palabras" ? phraseOf(row) || termLabel(row.title, termTitles) : phraseOf(row));

  const item = (kind: ChecklistKind, row: ChecklistItem) => {
    const phrase = phraseOf(row);
    const key = `${kind}-${row.id}`;
    if (kind === "palabras") {
      const slug = row.title;
      const article = articles[slug];
      return (
        <li key={key} className="ur-item">
          <details className="ur-term" onToggle={(e) => e.currentTarget.open && onOpenArticle(row)}>
            <summary>
              {phrase ? <b>«{phrase}»</b> : null}
              <span>{termLabel(slug, termTitles)}</span>
            </summary>
            {article === undefined ? <p className="af-hint">{t("ur.readingArticle")}</p> : article === null ? <p className="af-hint">{t("ur.noArticle")}</p> : <HelpMarkdownView className="ur-md ur-article" content={articleBody(article)} />}
            {saidHere(kind, placeOfHelp(kind, row))}
            {/* With the article, not under every name of a list of eleven: a concern about a term comes of reading it. */}
            {concernLine(key, kind, placeOfHelp(kind, row), "ur.concernTerm")}
          </details>
        </li>
      );
    }
    return (
      <li key={key} className="ur-item">
        {kind === "preguntas" ? <p className="ur-item__head">{row.title}</p> : phrase ? <p className="ur-item__head">«{phrase}»</p> : null}
        {row.body ? <HelpMarkdownView className="ur-md" content={row.body} /> : null}
        {saidHere(kind, placeOfHelp(kind, row))}
        {concernLine(key, kind, placeOfHelp(kind, row), kind === "preguntas" ? "ur.concernQuestion" : "ur.concernNote")}
      </li>
    );
  };

  return (
    <div className="ur">
      {verses.map((verse) => {
        const shown = open?.verse === verse ? open.kind : null;
        // One help in view at a time: which, the words of the verse it is about, and what comes after the last.
        const rows = shown ? helpsOfVerse(helps[shown]?.items, verse) : [];
        const at = Math.min(open?.at ?? 0, Math.max(rows.length - 1, 0));
        const inView = rows[at];
        const marked = new Set(inView ? (quoteOf(inView)?.tokenIndices ?? []) : []);
        const after = shown ? KINDS.slice(KINDS.indexOf(shown) + 1).find((kind) => helpsOfVerse(helps[kind]?.items, verse).length) : undefined;
        // What was said about the verse; what is about the help in view is under that help, and is not said twice.
        const here = shown && inView ? placeOfHelp(shown, inView) : null;
        const said = concernsAt(concerns, chapter, verse).filter((concern) => !concern.withdrawn && !(here !== null && concern.about === shown && (concern.where ?? "") === here));
        return (
          <section key={verse} className="ur-verse" aria-label={`${chapter}:${verse}`}>
            <h3 className="ur-ref">
              {chapter}:{verse}
            </h3>
            {both.map((resource) =>
              texts[resource]!.verses[verse] ? (
                <p key={resource} className="ur-text">
                  <span className="af-lbl">{label(resource)}</span>{" "}
                  {resource === "tpl" && marked.size
                    ? tokenizeVersePlainText(texts.tpl!.verses[verse]!).map((token, index) => (
                        <Fragment key={index}>
                          {index ? " " : ""}
                          {marked.has(index) ? <mark className="ur-mark">{token}</mark> : token}
                        </Fragment>
                      ))
                    : texts[resource]!.verses[verse]}
                </p>
              ) : null,
            )}
            <div className="ur-kinds">
              {KINDS.map((kind) => {
                const count = helpsOfVerse(helps[kind]?.items, verse).length;
                return count ? (
                  <button key={kind} type="button" aria-expanded={shown === kind} onClick={() => toggle(verse, kind)}>
                    {countLabel(kind, count)}
                  </button>
                ) : null;
              })}
            </div>
            {shown ? (
              <div className="ur-open">
                {helps[shown]?.fromSource ? <p className="af-hint">{t("ur.fromSource")}</p> : null}
                {/* Above the help, so the buttons stay where they are whatever the length of what is read. */}
                <div className="ur-pager">
                  {/* The way back is its arrow alone: with its word the place («Nota 2 de 9») broke in two lines on a phone. */}
                  <button type="button" className="btn" data-variant="outline" data-size="default" aria-label={t("af.prev")} disabled={at === 0} onClick={() => setOpen({ verse, kind: shown, at: at - 1 })}>
                    <ChevronLeft size={20} aria-hidden />
                  </button>
                  <span className="ur-pager__at" role="status">
                    {t(AT[shown]).replace("{n}", String(at + 1)).replace("{of}", String(rows.length))}
                  </span>
                  {at < rows.length - 1 ? (
                    <button type="button" className="btn" data-variant="default" data-size="default" onClick={() => setOpen({ verse, kind: shown, at: at + 1 })}>
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
                <ul className="ur-items">{inView ? item(shown, inView) : null}</ul>
              </div>
            ) : null}
            {said.length ? (
              <ul className="ur-said">
                {said.map((concern) => (
                  <li key={`${concern.by ?? ""}-${concern.id}`} data-kind={concern.kind}>
                    {/* Which note or term of the verse it is about is in its place, after the verse the list is under. */}
                    <b>{t(concern.kind === "objection" ? "en.objection" : "en.observation")}</b> · {label(concern.about)}
                    {(concern.where ?? "").replace(/^\s*\d+:\d+\s*/, "") ? ` ${(concern.where ?? "").replace(/^\s*\d+:\d+\s*/, "")}` : ""}
                    {concern.by ? ` · @${concern.by}` : ""}: {concern.text}
                  </li>
                ))}
              </ul>
            ) : null}
            {concernLine(`v${verse}`, both.length === 1 ? both[0]! : "", concernPlace(chapter, verse), "ur.concernVerse")}
          </section>
        );
      })}
    </div>
  );
}
