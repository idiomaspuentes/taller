import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import type { AlignmentMap } from "@usfm-tools/types";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { ChecklistItem, ChecklistKind } from "../dcs/checklistLoad";
import { articleBody, termLabel } from "../domain/afinacionWords";
import type { Concern } from "../domain/endorsement";
import { alignedGatewayQuoteForHelpQuote, tokenizeVersePlainText } from "../domain/helpQuoteMatch";
import { loadSeenHelps, saveSeenHelps, verseInView, verseProgress } from "../domain/unitProgress";
import { concernPlace, concernsAt, concernsOfHelp, helpsOfVerse, shortestQuoteFirst } from "../domain/unitReading";
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
  /** Where what was already gone over is kept on this device (see `seenHelpsKey`); not kept without it. */
  progressKey?: string;
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

/** A concern being written, and under what (`key`: a verse, or one of its helps). */
type Draft = { key: string; kind: Concern["kind"]; about: string; where: string; item?: string; text: string };

/** What stays at the top and at the bottom of the screen over the reading: its row of verses, and the way to the report. */
const KEPT_ABOVE = 60;
const KEPT_BELOW = 68;

/** The box a verse scrolls in: the reading's own on a wide screen, the tool on a phone. */
function scrollerOf(el: HTMLElement): HTMLElement {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const flow = getComputedStyle(node).overflowY;
    if ((flow === "auto" || flow === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

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
 *
 * A chapter is some twenty screens: a row of its verses stays at the top, to go to any of them and to see which
 * were gone through and which have something noted. The two texts are two versions, each in a box of its own, and
 * either can be put away so that a long verse and the help being read fit on the screen together.
 */
export function UnitReading({ book, chapter, verses, texts, helps, label, termTitles, articles, onOpenTerms, onOpenArticle, concerns, onConcern, saving, progressKey }: Props) {
  const t = useT();
  const [open, setOpen] = useState<Open | null>(null);
  /**
   * The concerns being written, by what each is about, and the one in hand. Starting one about the verse with
   * another half written about a note replaced it: what had been typed was gone without a word.
   */
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [writingKey, setWritingKey] = useState<string | null>(null);
  const writing = writingKey ? (drafts[writingKey] ?? null) : null;
  const setWriting = (next: Draft) => setDrafts((prev) => ({ ...prev, [next.key]: next }));
  const stopWriting = (key: string) => {
    setDrafts(({ [key]: _gone, ...rest }) => rest);
    setWritingKey(null);
  };
  const both = BOTH.filter((resource) => texts[resource]);
  /**
   * The texts on the screen. The two of a long verse take 517 px of a phone, and the help being read began under
   * them, the simple text between the literal one and its note: with one put away, verse and help fit together.
   */
  const [hidden, setHidden] = useState<Text | null>(null);
  const shownTexts = both.filter((resource) => resource !== hidden);
  /** The article of a key term being read: on a sheet of its own, over the reading. */
  const [reading, setReading] = useState<ChecklistItem | null>(null);

  /**
   * Opening a help keeps its verse where it was on the screen, and then brings the help into view. Only one help
   * is open: opening one of the next verse closed the one above, everything moved up by its height (713 px, with
   * an article open), and the person was left looking at the verse after the one they touched, its help out of
   * sight above. And a help opened low on the screen stayed under its lower edge.
   */
  const sections = useRef(new Map<number, HTMLElement>());
  const held = useRef<{ verse: number; top: number } | null>(null);
  const hold = (verse: number) => {
    const section = sections.current.get(verse);
    if (section) held.current = { verse, top: section.getBoundingClientRect().top };
  };
  const openKey = open ? `${open.verse}|${open.kind}|${open.kind === "word" ? `${open.resource}:${open.index}` : ""}` : "";
  useLayoutEffect(() => {
    const was = held.current;
    held.current = null;
    const section = was ? sections.current.get(was.verse) : undefined;
    if (!was || !section) return;
    const scroller = scrollerOf(section);
    scroller.scrollTop += section.getBoundingClientRect().top - was.top;
    // In the next frame, once the place is settled: asked for in the same one, the help stayed where it was.
    const reveal = requestAnimationFrame(() => {
      const card = section.querySelector<HTMLElement>(".ur-open");
      if (!card) return;
      const frame = scroller === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
      const under = card.getBoundingClientRect().bottom - (frame.bottom - KEPT_BELOW);
      const spare = section.getBoundingClientRect().top - (frame.top + KEPT_ABOVE);
      if (under > 0 && spare > 0) scroller.scrollBy({ top: Math.min(under, spare), behavior: "smooth" });
    });
    return () => cancelAnimationFrame(reveal);
  }, [openKey, hidden]);

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

  /**
   * Which helps each word of a verse has, in each text, by «verse|text»: from the one whose quote is shortest in
   * that text to the one whose quote is longest (see `shortestQuoteFirst`).
   */
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
    for (const [key, words] of out) {
      const resource = key.slice(key.indexOf("|") + 1) as Text;
      for (const [index, list] of words) {
        if (list.length > 1) words.set(index, shortestQuoteFirst(list, (shown) => new Set(pointed.get(keyOf(shown.kind, shown.row))?.words[resource] ?? []).size));
      }
    }
    return out;
  }, [helps.notas, helps.palabras, pointed]);

  /** The helps open under a verse, one of them in view. */
  const listOf = (at: Open | null): Shown[] =>
    !at ? [] : at.kind === "word" ? (coverage.get(`${at.verse}|${at.resource}`)?.get(at.index) ?? []) : helpsOfVerse(helps[at.kind]?.items, at.verse).map((row) => ({ kind: at.kind as ChecklistKind, row }));
  const openList = listOf(open);
  const openAt = Math.min(open?.at ?? 0, Math.max(openList.length - 1, 0));
  const inView = open ? openList[openAt] : undefined;
  const inViewKey = inView ? keyOf(inView.kind, inView.row) : "";

  /** The helps already shown to this person, here and in earlier sittings. */
  const [seen, setSeen] = useState<Set<string>>(() => (progressKey ? loadSeenHelps(progressKey) : new Set()));
  useEffect(() => setSeen(progressKey ? loadSeenHelps(progressKey) : new Set()), [progressKey]);
  useEffect(() => {
    if (!inViewKey) return;
    setSeen((prev) => {
      if (prev.has(inViewKey)) return prev;
      const next = new Set(prev).add(inViewKey);
      if (progressKey) saveSeenHelps(progressKey, next);
      return next;
    });
  }, [inViewKey, progressKey]);
  const helpKeysOf = (verse: number, kinds: ChecklistKind[] = KINDS) => kinds.flatMap((kind) => helpsOfVerse(helps[kind]?.items, verse).map((row) => keyOf(kind, row)));

  /** The verse being read, for the row of verses: the one at the top of the reading. */
  const [current, setCurrent] = useState<number | null>(null);
  const indexRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = sections.current.get(verses[0] ?? -1);
    if (!first) return;
    const scroller = scrollerOf(first);
    const target: HTMLElement | Window = scroller === document.scrollingElement ? window : scroller;
    let frame = 0;
    const look = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
        setCurrent(verseInView(verses.flatMap((verse) => (sections.current.get(verse) ? [{ verse, top: sections.current.get(verse)!.getBoundingClientRect().top }] : [])), top + KEPT_ABOVE + 24));
      });
    };
    look();
    target.addEventListener("scroll", look, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      target.removeEventListener("scroll", look);
    };
  }, [verses]);
  // The verse being read stays in sight in its row, which is longer than a phone is wide.
  useEffect(() => {
    const row = indexRef.current;
    const button = row?.querySelector<HTMLElement>(`[data-verse="${current}"]`);
    if (row && button) row.scrollTo({ left: button.offsetLeft - row.clientWidth / 2 + button.offsetWidth / 2, behavior: "smooth" });
  }, [current]);
  const goTo = (verse: number) => sections.current.get(verse)?.scrollIntoView({ block: "start", behavior: "smooth" });

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
    hold(verse);
    setOpen(closing ? null : { verse, kind, at: 0 });
    if (!closing && kind === "palabras") onOpenTerms(helpsOfVerse(helps.palabras?.items, verse));
  };

  /** A word was touched: the helps that are about it. Touched again, on to the next of them. */
  const openWord = (verse: number, resource: Text, index: number) => {
    const list = coverage.get(`${verse}|${resource}`)?.get(index) ?? [];
    if (!list.length) return;
    const again = open?.kind === "word" && open.verse === verse && open.resource === resource && open.index === index;
    hold(verse);
    setOpen({ verse, kind: "word", resource, index, at: again ? (open.at + 1) % list.length : 0 });
    const terms = list.filter((shown) => shown.kind === "palabras").map((shown) => shown.row);
    if (terms.length) onOpenTerms(terms);
  };

  /**
   * The box where a concern is written. Short, so that with the keyboard up what is typed and the button that
   * keeps it are on the screen together: it was 331 px, with «Anotar» at its foot, and the cursor had to be put in
   * it with one more touch.
   */
  const concernBox = () =>
    writing ? (
      <div className="ur-concern" role="group" aria-label={t("en.addConcern")}>
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
        <div className="ur-concern__kinds">
          {(["observation", "objection"] as const).map((kind) => (
            <button key={kind} type="button" aria-pressed={writing.kind === kind} onClick={() => setWriting({ ...writing, kind })}>
              {t(kind === "objection" ? "en.objection" : "en.observation")}
            </button>
          ))}
        </div>
        <p className="af-hint ur-concern__hint">{t(writing.kind === "objection" ? "ur.objectionHint" : "ur.observationHint")}</p>
        <textarea className="af-textarea" rows={3} autoFocus value={writing.text} aria-label={t("en.what")} placeholder={t("en.what")} onChange={(e) => setWriting({ ...writing, text: e.target.value })} />
        <div className="ur-concern__buttons">
          <button type="button" className="btn" data-variant="ghost" data-size="default" onClick={() => stopWriting(writing.key)}>
            {t("af.cancel")}
          </button>
          <button
            type="button"
            className="btn"
            data-variant="default"
            data-size="default"
            disabled={saving || !writing.text.trim() || !writing.about}
            onClick={() => {
              onConcern?.({ kind: writing.kind, about: writing.about, where: writing.where, text: writing.text.trim(), ...(writing.item ? { item: writing.item } : {}) });
              stopWriting(writing.key);
            }}
          >
            {t("en.addIt")}
          </button>
        </div>
      </div>
    ) : null;

  /**
   * The line that starts a concern about something, or the box where it is being written. One left half written
   * (another was started) says so, and is found as it was.
   */
  const concernLine = (key: string, about: string, where: string, said: string, item?: string) =>
    !onConcern ? null : writing?.key === key ? (
      concernBox()
    ) : (
      <button
        type="button"
        className="ur-add"
        onClick={() => {
          if (!drafts[key]) setWriting({ key, kind: "observation", about, where, text: "", ...(item ? { item } : {}) });
          setWritingKey(key);
        }}
      >
        <MessageSquare size={14} aria-hidden /> {drafts[key]?.text.trim() ? t("ur.concernResume") : said}
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
      return (
        <li key={key} className="ur-item">
          {tag}
          {/* The words of the text, the name of the term, and its article to open: three lines, each one thing. */}
          {phrase ? <p className="ur-item__head">«{phrase}»</p> : null}
          <p className="ur-item__term">{termLabel(row.title, termTitles)}</p>
          <button
            type="button"
            className="ur-add ur-item__read"
            onClick={() => {
              onOpenArticle(row);
              setReading(row);
            }}
          >
            {t("ur.readArticle")} <ChevronRight size={14} aria-hidden />
          </button>
          {helpFoot(saidOf(kind, row), concernLine(key, kind, placeOfHelp(kind, row), t("ur.concernTerm"), row.id))}
        </li>
      );
    }
    return (
      <li key={key} className="ur-item">
        {tag}
        {kind === "preguntas" ? <p className="ur-item__head">{row.title}</p> : phrase ? <p className="ur-item__head">«{phrase}»</p> : null}
        {/* A question and its answer were two lines told apart by their weight alone. */}
        {kind === "preguntas" && row.body ? <p className="ur-lbl">{t("ur.answer")}</p> : null}
        {row.body ? <HelpMarkdownView className="ur-md" content={row.body} /> : null}
        {helpFoot(saidOf(kind, row), concernLine(key, kind, placeOfHelp(kind, row), t(kind === "preguntas" ? "ur.concernQuestion" : "ur.concernNote"), row.id))}
      </li>
    );
  };

  const article = reading ? articles[reading.title] : undefined;

  return (
    <div className="ur">
      {/* The verses of the passage, always in reach: where one is, which were gone through, which have something
          noted. Twenty screens of passage had no way to a verse but to slide to it. */}
      {verses.length > 1 ? (
        <nav className="ur-index" aria-label={t("ur.indexAria")} ref={indexRef}>
          {verses.map((verse) => {
            const progress = verseProgress(helpKeysOf(verse), seen);
            const noted = concernsAt(concerns, chapter, verse).some((concern) => !concern.withdrawn);
            return (
              <button
                key={verse}
                type="button"
                data-verse={verse}
                aria-current={current === verse ? "true" : undefined}
                data-done={progress.done || undefined}
                data-noted={noted || undefined}
                aria-label={[`${chapter}:${verse}`, progress.done ? t("ur.indexDone") : "", noted ? t("ur.indexNoted") : ""].filter(Boolean).join(", ")}
                onClick={() => goTo(verse)}
              >
                {verse}
              </button>
            );
          })}
        </nav>
      ) : null}
      <div className="ur-top">
        {coverage.size ? (
          // What the marks mean, shown with the marks themselves; folded, so the first verse is not pushed down by
          // what is read once (open, it took 150 px above it).
          <details className="ur-legend">
            <summary>{t("ur.legend")}</summary>
            <p className="af-hint ur-hint">
              {t("ur.legendLead")} <span className="ur-word">{t("ur.legendNote")}</span> · <span className="ur-word" data-term>{t("ur.legendTerm")}</span>. {t("ur.legendTouch")}
            </p>
            {verses.length > 1 ? (
              <p className="af-hint ur-hint">
                {t("ur.legendVerses")} <span className="ur-key" data-done>{t("ur.indexDone")}</span> · <span className="ur-key" data-noted>{t("ur.indexNoted")}</span>
              </p>
            ) : null}
          </details>
        ) : null}
        {both.length > 1 ? (
          <div className="ur-kinds ur-texts" role="group" aria-label={t("ur.textsAria")}>
            <span className="ur-lbl">{t("ur.texts")}</span>
            {both.map((resource) => (
              <button
                key={resource}
                type="button"
                aria-pressed={resource !== hidden}
                onClick={() => {
                  // Never none: only one is ever put away, so putting away the one left brings the other back.
                  const section = sections.current.get(current ?? verses[0] ?? -1);
                  if (section) held.current = { verse: current ?? verses[0]!, top: section.getBoundingClientRect().top };
                  setHidden(resource === hidden ? null : resource);
                }}
              >
                {label(resource)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {verses.map((verse) => {
        const mine = open?.verse === verse ? open : null;
        const shownKind = mine && mine.kind !== "word" ? mine.kind : null;
        // One help in view at a time: which, the words of the verse it is about, and what comes after the last.
        const list = mine ? openList : [];
        const at = mine ? openAt : 0;
        const here = mine && inView ? pointed.get(keyOf(inView.kind, inView.row))?.words : undefined;
        const showing = mine ? inView : undefined;
        const after = shownKind ? KINDS.slice(KINDS.indexOf(shownKind) + 1).find((kind) => helpsOfVerse(helps[kind]?.items, verse).length) : undefined;
        // What was said about the verse; what is about the help in view is under that help, and is not said twice.
        const underHelp = new Set(showing ? saidOf(showing.kind, showing.row) : []);
        const said = concernsAt(concerns, chapter, verse).filter((concern) => !concern.withdrawn && !underHelp.has(concern));
        const touched = mine?.kind === "word" ? (tokenizeVersePlainText(texts[mine.resource]?.verses[verse] ?? "")[mine.index] ?? "").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "") : "";
        return (
          <section
            key={verse}
            className="ur-verse"
            aria-label={`${chapter}:${verse}`}
            ref={(el) => {
              if (el) sections.current.set(verse, el);
              else sections.current.delete(verse);
            }}
          >
            <h3 className="ur-ref">
              {chapter}:{verse}
            </h3>
            {/* Two versions of the verse, each in a box of its own under its name: as two paragraphs with a small
                label at their start they read as one block of text. */}
            {shownTexts.map((resource) => {
              const text = texts[resource]!.verses[verse];
              if (!text) return null;
              const covered = coverage.get(`${verse}|${resource}`);
              const marked = new Set(here?.[resource] ?? []);
              return (
                <div key={resource} className="ur-text" data-text={resource}>
                  <p>
                    <span className="ur-text__name">{label(resource)}</span>{" "}
                    {covered?.size ? (
                      <>
                        {/* Each word a button made 1,357 stops for a keyboard in one chapter, and a verse read out
                            word by word: the verse is said whole, and its helps are reached by their lists. */}
                        <span className="sr-only">{text}</span>
                        <span aria-hidden="true">
                          {tokenizeVersePlainText(text).map((token, index) => (
                            <Fragment key={index}>
                              {index ? <span className="ur-space" data-here={(marked.has(index) && marked.has(index - 1)) || undefined}> </span> : null}
                              {covered.has(index) ? (
                                <button
                                  type="button"
                                  tabIndex={-1}
                                  className="ur-word"
                                  data-here={marked.has(index) || undefined}
                                  data-term={covered.get(index)!.some((shown) => shown.kind === "palabras") || undefined}
                                  data-short={token.replace(/[^\p{L}\p{N}]/gu, "").length <= 2 || undefined}
                                  onClick={() => openWord(verse, resource, index)}
                                >
                                  {token}
                                </button>
                              ) : (
                                token
                              )}
                            </Fragment>
                          ))}
                        </span>
                      </>
                    ) : (
                      text
                    )}
                  </p>
                </div>
              );
            })}
            <div className="ur-kinds">
              {KINDS.map((kind) => {
                const count = helpsOfVerse(helps[kind]?.items, verse).length;
                const done = verseProgress(helpKeysOf(verse, [kind]), seen).done;
                return count ? (
                  <button key={kind} type="button" aria-expanded={shownKind === kind} data-done={done || undefined} onClick={() => toggle(verse, kind)}>
                    {done ? <Check size={14} aria-label={t("ur.indexDone")} /> : null}
                    {countLabel(kind, count)}
                  </button>
                ) : null;
              })}
            </div>
            {mine && showing ? (
              <div className="ur-open">
                {helps[showing.kind]?.fromSource ? <p className="af-hint">{t("ur.fromSource")}</p> : null}
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
                <ul className="ur-items">{item(showing, mine.kind === "word")}</ul>
              </div>
            ) : null}
            {/* About the verse, apart from the help in view: under the card of a key term, a concern about a note of
                the verse read as said of that term. */}
            <div className="ur-foot" data-apart={mine && showing ? true : undefined}>
              {said.length ? (
                <>
                  <p className="ur-lbl">{t(mine && showing ? "ur.verseNoted" : "ur.verseNotedAll")}</p>
                  <ul className="ur-said">
                    {said.map((concern) => {
                      const kind = KINDS.find((candidate) => candidate === concern.about);
                      const index = kind ? helpsOfVerse(helps[kind]?.items, verse).findIndex((row) => saidOf(kind, row).includes(concern)) : -1;
                      return (
                        <li key={`${concern.by ?? ""}-${concern.id}`} data-kind={concern.kind}>
                          {/* Which note or term of the verse it is about is in its place, after the verse the list is under. */}
                          <b>
                            {t(concern.kind === "objection" ? "en.objection" : "en.observation")} · {label(concern.about)}
                            {(concern.where ?? "").replace(/^\s*\d+:\d+\s*/, "") ? ` ${(concern.where ?? "").replace(/^\s*\d+:\d+\s*/, "")}` : ""}
                            {concern.by ? ` · @${concern.by}` : ""}
                          </b>
                          <span>{concern.text}</span>
                          {kind && index >= 0 ? (
                            <button
                              type="button"
                              className="ur-add"
                              onClick={() => {
                                hold(verse);
                                setOpen({ verse, kind, at: index });
                              }}
                            >
                              {t(SEE[kind])} <ChevronRight size={14} aria-hidden />
                            </button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : null}
              {/* By its verse: two of these lines show at once, each at the end of a verse. */}
              {concernLine(`v${verse}`, both.length === 1 ? both[0]! : "", concernPlace(chapter, verse), t("ur.concernVerse").replace("{ref}", `${chapter}:${verse}`))}
            </div>
          </section>
        );
      })}
      {/* The article of a key term is several screens long: read over the passage, on a sheet with its way out. In a
          box under its term, 447 px of 2,862 showed at a time, and the box scrolled inside the page. */}
      <Dialog open={Boolean(reading)} onOpenChange={(next) => !next && setReading(null)}>
        <DialogContent className="ur-sheet" showCloseButton={false}>
          <header className="ur-sheet__head">
            <DialogTitle>{reading ? termLabel(reading.title, termTitles) : ""}</DialogTitle>
            <button type="button" className="btn" data-variant="outline" data-size="default" onClick={() => setReading(null)}>
              {t("ur.close")}
            </button>
          </header>
          <div className="ur-sheet__body">
            {article === undefined ? <p className="af-hint">{t("ur.readingArticle")}</p> : article === null ? <p className="af-hint">{t("ur.noArticle")}</p> : <HelpMarkdownView className="ur-md" content={articleBody(article)} />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
