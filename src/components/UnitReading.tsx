import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import type { AlignmentMap } from "@usfm-tools/types";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { ChecklistItem, ChecklistKind } from "../dcs/checklistLoad";
import { articleBody, termLabel } from "../domain/afinacionWords";
import type { Concern } from "../domain/endorsement";
import { alignedGatewayQuoteForHelpQuote, alignmentGroupsForVerse, gatewayQuoteFromTokenIndices, tokenizeVersePlainText, tokensSayingTheSame } from "../domain/helpQuoteMatch";
import { originalTokens } from "../domain/quoteFromSelection";
import { loadSeenHelps, saveSeenHelps, scrollToShow, verseInView, verseProgress } from "../domain/unitProgress";
import { concernPlace, concernsAt, concernsOfHelp, helpsOfVerse, helpsToOpen, shortestQuoteFirst } from "../domain/unitReading";
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
  /** The book in the original language: what the quote of each help is found in. Without it, it is guessed. */
  original?: string;
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

/** A help of the catalogue: what it is, and its row. */
type Shown = { kind: ChecklistKind; row: ChecklistItem };
/** What the card shows at a time: the other text of the verse, or one of its helps. */
type Page = { kind: "text" } | Shown;
/** What a verse has to open, each a tab of its card: its other text, and each kind of help. */
type Tab = "text" | ChecklistKind;
/** Words of the verse, by where they are in each text. */
type Marks = Partial<Record<Text, number[]>>;
/** What is open under a verse: one of its tabs, what goes with one of its words, or what was noted about it. */
type Open = { verse: number; at: number } & ({ kind: "text"; marks?: Marks } | { kind: ChecklistKind } | { kind: "word"; resource: Text; index: number } | { kind: "concerns" });

const KINDS: ChecklistKind[] = ["notas", "preguntas", "palabras"];
/** The helps that point at words of the text. */
const OF_WORDS = ["notas", "palabras"] as const;
const BOTH: Text[] = ["tpl", "tps"];
const SEE: Record<ChecklistKind, MessageKey> = { notas: "ur.seeNote", preguntas: "ur.seeQuestion", palabras: "ur.seeTerm" };
const keyOf = (kind: ChecklistKind, row: ChecklistItem) => `${kind}-${row.id}`;
const isTab = (open: Open): open is Open & { kind: Tab } => open.kind !== "word" && open.kind !== "concerns";

/** A concern being written, and under what (`key`: a verse, its other text, or one of its helps). */
type Draft = { key: string; kind: Concern["kind"]; about: string; where: string; item?: string; text: string };

/** What stays at the top of the screen over the reading (its bar), and the room left under a help at its foot. */
const KEPT_ABOVE = 60;
const KEPT_BELOW = 12;

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
 * written by choosing the resource from a list and typing the verse.
 *
 * The page is the passage in its literal text, and little else: each verse with one button to its helps and one to
 * what is noted about it. What goes with a verse comes when asked for, in one layer at a time and always in the
 * same place:
 *
 * - The helps of a verse, in a card held at the foot of the screen while the verse is on it, so that text and help
 *   are read together: one at a time, the words it is about marked in the verse. Opened as a list, the nine notes
 *   of one verse ran to 1,783 px. The simple text is one more of them, the last (Abel: «el TPS debería mostrarse
 *   como una ayuda», «la última pestaña»): beside the literal one, the two filled a phone (608 px in Jude 1:12)
 *   before any help was opened.
 * - Touching a word of the verse shows the notes and key terms about it, the nearest first, where the word is
 *   underlined, and then how the simple text says it (both are aligned to the original).
 * - Going to a verse and the article of a key term: each on a sheet over the reading, with its way out said in a
 *   word.
 *
 * Laid out on the page, every verse carried two texts, three chips and a line to note a concern (a hundred controls
 * in a chapter), over a row of verses, a legend and two switches.
 */
export function UnitReading({ book, chapter, verses, texts, original, helps, label, termTitles, articles, onOpenTerms, onOpenArticle, concerns, onConcern, saving, progressKey }: Props) {
  const t = useT();
  const [open, setOpen] = useState<Open | null>(null);
  /** Where the person was among the helps of each verse, to open them there again. */
  const [left, setLeft] = useState<Record<number, { kind: Tab; at: number }>>({});
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
  /** The text on the page (the literal one, which the helps were written about), and the one read as a help. */
  const main: Text = texts.tpl ? "tpl" : "tps";
  const other: Text | null = texts.tpl && texts.tps ? "tps" : null;
  const otherOf = (verse: number) => (other ? texts[other]!.verses[verse] : undefined);
  /** The sheets over the reading: going to a verse, and the article of a key term. One at a time. */
  const [picking, setPicking] = useState(false);
  const [reading, setReading] = useState<ChecklistItem | null>(null);

  /**
   * Opening a help keeps its verse where it was on the screen. Only one help is open: opening one of the next verse
   * closed the one above, everything moved up by its height (713 px, with an article open), and the person was left
   * looking at the verse after the one they touched, its help out of sight above.
   */
  const sections = useRef(new Map<number, HTMLElement>());
  const held = useRef<{ verse: number; top: number } | null>(null);
  const hold = (verse: number) => {
    const section = sections.current.get(verse);
    if (section) held.current = { verse, top: section.getBoundingClientRect().top };
  };
  const openKey = open ? `${open.verse}|${open.kind}|${open.kind === "word" ? `${open.resource}:${open.index}` : ""}` : "";

  /**
   * For each note and key term, the words its quote of the original points at: where they are in each text (both
   * are aligned to the original), and as a phrase of the literal one, which is what a person calls the help by.
   */
  const pointed = useMemo(() => {
    const out = new Map<string, { phrase: string | null; words: Marks }>();
    // Each verse of the original, read once: the book is gone through to find it.
    const inOriginal = new Map<string, ReturnType<typeof originalTokens>>();
    const originalOf = (inChapter: number, verse: number) => {
      const key = `${inChapter}:${verse}`;
      if (original && !inOriginal.has(key)) inOriginal.set(key, originalTokens(original, inChapter, verse));
      return inOriginal.get(key);
    };
    for (const kind of OF_WORDS) {
      for (const row of helps[kind]?.items ?? []) {
        if (!row.quote) continue;
        const found: { phrase: string | null; words: Marks } = { phrase: null, words: {} };
        for (const resource of BOTH) {
          const text = texts[resource]?.verses[row.verse];
          if (!text) continue;
          const match = alignedGatewayQuoteForHelpQuote({ verseText: text, quote: row.quote, occurrence: row.occurrence ?? 1, alignments: texts[resource]?.alignments, book, chapter: row.chapter, verse: row.verse, original: originalOf(row.chapter, row.verse) });
          found.words[resource] = match.tokenIndices;
          if (resource === "tpl") found.phrase = match.gatewayText;
        }
        out.set(keyOf(kind, row), found);
      }
    }
    return out;
  }, [helps.notas, helps.palabras, texts, book, original]);

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

  /** What a verse has to open, in the order it is gone through: each kind of help, and its other text last. */
  const tabsOf = (verse: number): Tab[] => [...KINDS.filter((kind) => helpsOfVerse(helps[kind]?.items, verse).length), ...(otherOf(verse) ? (["text"] as const) : [])];
  /** What the card goes through, one at a time. Of a word: the helps about it, then how the other text says it. */
  const pagesOf = (at: Open | null): Page[] =>
    !at || at.kind === "concerns"
      ? []
      : at.kind === "text"
        ? [{ kind: "text" }]
        : at.kind === "word"
          ? [...(coverage.get(`${at.verse}|${at.resource}`)?.get(at.index) ?? []), ...(otherOf(at.verse) ? [{ kind: "text" } as const] : [])]
          : helpsOfVerse(helps[at.kind]?.items, at.verse).map((row) => ({ kind: at.kind as ChecklistKind, row }));
  const pageKey = (verse: number, page: Page) => (page.kind === "text" ? `text-${verse}` : keyOf(page.kind, page.row));
  const openList = pagesOf(open);
  const openAt = Math.min(open?.at ?? 0, Math.max(openList.length - 1, 0));
  const inView = open ? openList[openAt] : undefined;
  const inViewKey = open && inView ? pageKey(open.verse, inView) : "";

  /**
   * The words marked in each text: those of the help in view; and with the other text in view, those that say what
   * the touched word says (both texts are aligned to the original), or what was marked when one went to it.
   */
  const marks = useMemo((): Marks => {
    if (!open || !inView) return {};
    if (inView.kind !== "text") return pointed.get(keyOf(inView.kind, inView.row))?.words ?? {};
    if (open.kind === "text") return open.marks ?? {};
    if (open.kind !== "word") return {};
    const side = (resource: Text) => ({ tokens: tokenizeVersePlainText(texts[resource]?.verses[open.verse] ?? ""), groups: alignmentGroupsForVerse(texts[resource]?.alignments, book, chapter, open.verse) });
    const out: Marks = {};
    for (const resource of BOTH) {
      if (!texts[resource]) continue;
      const same = tokensSayingTheSame({ from: side(open.resource), indices: [open.index], to: side(resource) });
      out[resource] = resource === open.resource ? [...new Set([open.index, ...same])].sort((a, b) => a - b) : same;
    }
    return out;
  }, [open, inViewKey, pointed, texts, book, chapter]);

  /**
   * Where things are once what is open changes: the verse where it was, and what the help in view is about in
   * sight between the bar and the card (its words in the verse, or the verse when it is about none of them). The
   * card is held at the foot of the screen, over its own verse when that one is low on it: opened there, the card
   * covered the text it goes with, and a note about the last words of a long verse had them under it.
   *
   * At once, before the screen is drawn, and again whenever the card changes size: settled only when the card is
   * first drawn, 18 of 49 helps tried still had their words under it; this way, none of the 312 of a chapter. Not
   * as a slide over later frames: where the verse ends up would hang on every one of them being drawn.
   */
  useLayoutEffect(() => {
    const was = held.current;
    held.current = null;
    const section = sections.current.get(was?.verse ?? open?.verse ?? -1);
    if (!section) return;
    const scroller = scrollerOf(section);
    if (was) scroller.scrollTop += section.getBoundingClientRect().top - was.top;
    const card = section.querySelector<HTMLElement>(".ur-open");
    if (!card) return;
    const settle = () => {
      const frame = scroller === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
      if (getComputedStyle(card).position !== "sticky") {
        // Not held at the foot (something is being written in it): it is where it belongs in the page, in view.
        const under = card.getBoundingClientRect().bottom - (frame.bottom - KEPT_BELOW);
        const spare = section.getBoundingClientRect().top - (frame.top + KEPT_ABOVE);
        if (under > 0 && spare > 0) scroller.scrollTop += Math.min(under, spare);
        return;
      }
      const those = [...section.querySelectorAll<HTMLElement>(".ur-text .ur-word[data-here]")];
      const about = those.length ? { top: those[0]!.getBoundingClientRect().top, bottom: those[those.length - 1]!.getBoundingClientRect().bottom } : section.querySelector(".ur-text")?.getBoundingClientRect();
      const by = about ? scrollToShow({ top: about.top, bottom: about.bottom }, { top: frame.top + KEPT_ABOVE + 8, bottom: card.getBoundingClientRect().top - 8 }) : 0;
      if (by) scroller.scrollTop += by;
    };
    settle();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(settle);
    watch.observe(card);
    return () => watch.disconnect();
  }, [openKey, inViewKey]);
  // And inside the card, each thing starts at its top; the other text, at the words marked in it.
  useEffect(() => {
    const items = open ? sections.current.get(open.verse)?.querySelector<HTMLElement>(".ur-open > .ur-items") : null;
    if (!items) return;
    const mark = items.querySelector<HTMLElement>(".ur-other .ur-word[data-here]");
    items.scrollTop = mark ? Math.max(0, items.scrollTop + mark.getBoundingClientRect().top - items.getBoundingClientRect().top - 40) : 0;
  }, [inViewKey, openKey]);

  /**
   * Whether the card is on the screen, said on the reading (`data-docked`): the screen that shows it gives the foot
   * of the screen to the card while it is there, and has it back when the verse is scrolled away with its card open.
   */
  const [docked, setDocked] = useState(false);
  useEffect(() => {
    const card = open ? sections.current.get(open.verse)?.querySelector(".ur-open") : null;
    if (!card || typeof IntersectionObserver === "undefined") return setDocked(Boolean(card));
    const watch = new IntersectionObserver((entries) => setDocked(entries[entries.length - 1]!.isIntersecting));
    watch.observe(card);
    return () => watch.disconnect();
  }, [openKey]);

  /** What was already shown to this person, here and in earlier sittings. */
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
  /** Everything a verse has to go through: its other text is one more of its helps. */
  const helpKeysOf = (verse: number) => [...(otherOf(verse) ? [`text-${verse}`] : []), ...KINDS.flatMap((kind) => helpsOfVerse(helps[kind]?.items, verse).map((row) => keyOf(kind, row)))];
  // Where one was among the helps of a verse is where they open next time.
  useEffect(() => {
    if (open && isTab(open)) setLeft((prev) => ({ ...prev, [open.verse]: { kind: open.kind, at: open.at } }));
  }, [open]);

  /** The verse being read, for the bar: the one at the top of the reading. */
  const [current, setCurrent] = useState<number | null>(null);
  useEffect(() => {
    let frame = 0;
    const look = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const first = sections.current.get(verses[0] ?? -1);
        if (!first) return;
        // Asked each time: what the reading scrolls in changes with the width of the screen (a tablet turned), and
        // heard from the box it was at first, the bar went on saying the verse it was left at.
        const scroller = scrollerOf(first);
        const top = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
        setCurrent(verseInView(verses.flatMap((verse) => (sections.current.get(verse) ? [{ verse, top: sections.current.get(verse)!.getBoundingClientRect().top }] : [])), top + KEPT_ABOVE + 24));
      });
    };
    look();
    // Scrolling is not heard above the box it happens in, unless it is listened for on the way down.
    document.addEventListener("scroll", look, { passive: true, capture: true });
    window.addEventListener("resize", look);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("scroll", look, { capture: true });
      window.removeEventListener("resize", look);
    };
  }, [verses]);
  // At once: a slide over ten verses says nothing a jump does not.
  const goTo = (verse: number) => sections.current.get(verse)?.scrollIntoView({ block: "start" });

  const phraseOf = (kind: ChecklistKind, row: ChecklistItem): string | null => pointed.get(keyOf(kind, row))?.phrase ?? null;
  /** How the other text says what a help is about: its words there, as they come. */
  const otherPhraseOf = (kind: ChecklistKind, row: ChecklistItem): string | null => {
    const text = otherOf(row.verse);
    const words = other ? (pointed.get(keyOf(kind, row))?.words[other] ?? []) : [];
    return text && words.length ? gatewayQuoteFromTokenIndices(tokenizeVersePlainText(text), words) : null;
  };
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
      helpsOfVerse(helps[kind]?.items, row.verse).map((help) => ({ id: help.id, place: placeOfHelp(kind, help) })),
    );

  const show = (verse: number, next: Open | null) => {
    hold(verse);
    setOpen(next);
    if (next && next.kind === "palabras") onOpenTerms(helpsOfVerse(helps.palabras?.items, verse));
  };
  /** The helps of a verse: where they were left, or its first. Pressed again with them open, they close. */
  const toggleHelps = (verse: number) => {
    if (open?.verse === verse && open.kind !== "concerns") return show(verse, null);
    const start = helpsToOpen(tabsOf(verse), left[verse]);
    if (start) show(verse, { verse, ...start });
  };
  const notedAt = (verse: number) => concernsAt(concerns, chapter, verse).filter((concern) => !concern.withdrawn);
  /**
   * What is noted about a verse. With nothing noted yet, it opens ready to write: «Anotar inquietud» said what it
   * does, and one more press to start doing it was one too many. It is about the text on the page: what is noted
   * about the other one is noted where that one is read.
   */
  const toggleConcerns = (verse: number) => {
    if (open?.verse === verse && open.kind === "concerns") return show(verse, null);
    show(verse, { verse, kind: "concerns", at: 0 });
    const key = `v${verse}`;
    if (!onConcern || notedAt(verse).length) return;
    if (!drafts[key]) setWriting({ key, kind: "observation", about: main, where: concernPlace(chapter, verse), text: "" });
    setWritingKey(key);
  };

  /** A word was touched: the helps that are about it, and how the other text says it. Touched again, on to the next. */
  const openWord = (verse: number, resource: Text, index: number) => {
    const list = pagesOf({ verse, kind: "word", resource, index, at: 0 });
    if (!list.length) return;
    const again = open?.kind === "word" && open.verse === verse && open.resource === resource && open.index === index;
    hold(verse);
    setOpen({ verse, kind: "word", resource, index, at: again ? (open.at + 1) % list.length : 0 });
    const terms = list.flatMap((page) => (page.kind === "palabras" ? [page.row] : []));
    if (terms.length) onOpenTerms(terms);
  };

  /**
   * A text with its words to touch. What has a note or a key term is underlined; with another text to show it in,
   * every word leads somewhere. Each word a button made 1,357 stops for a keyboard in one chapter, and a verse read
   * out word by word: the verse is said whole, and its helps are reached by their button.
   */
  const words = (resource: Text, verse: number, text: string) => {
    const covered = coverage.get(`${verse}|${resource}`);
    if (!covered?.size && !other) return text;
    const marked = new Set(open?.verse === verse ? (marks[resource] ?? []) : []);
    return (
      <>
        <span className="sr-only">{text}</span>
        <span aria-hidden="true">
          {tokenizeVersePlainText(text).map((token, index) => (
            <Fragment key={index}>
              {index ? <span className="ur-space" data-here={(marked.has(index) && marked.has(index - 1)) || undefined}> </span> : null}
              {covered?.has(index) || (other && /[\p{L}\p{N}]/u.test(token)) ? (
                <button
                  type="button"
                  tabIndex={-1}
                  className="ur-word"
                  data-plain={!covered?.has(index) || undefined}
                  data-here={marked.has(index) || undefined}
                  data-term={covered?.get(index)?.some((shown) => shown.kind === "palabras") || undefined}
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
    );
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
          {label(writing.about)} · {writing.where}
        </p>
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
          <button
            type="button"
            className="btn"
            data-variant="ghost"
            data-size="default"
            onClick={() => {
              stopWriting(writing.key);
              // Given up with nothing noted about the verse: there is nothing left to show under it.
              if (open?.kind === "concerns" && writing.key === `v${open.verse}` && !notedAt(open.verse).length) show(open.verse, null);
            }}
          >
            {t("af.cancel")}
          </button>
          <button
            type="button"
            className="btn"
            data-variant="default"
            data-size="default"
            disabled={saving || !writing.text.trim()}
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

  /**
   * The other text of a verse, read as one of its helps. `tagged`: among what goes with a word, each thing says
   * what it is.
   */
  const otherItem = (verse: number, tagged: boolean) => {
    const text = other ? otherOf(verse) : undefined;
    if (!other || !text) return null;
    const said = notedAt(verse).filter((concern) => concern.about === other);
    return (
      <li key={`text-${verse}`} className="ur-item">
        {tagged ? <p className="ur-item__kind">{label(other)}</p> : null}
        {/* A word with nothing marked for it here: said, so that it does not read as a failure of the touch. */}
        {tagged && !marks[other]?.length ? <p className="af-hint ur-hint">{t("ur.noMatch").replace("{name}", label(other))}</p> : null}
        <p className="ur-other">{words(other, verse, text)}</p>
        {helpFoot(said, concernLine(`t${verse}`, other, concernPlace(chapter, verse), t("ur.concernText").replace("{name}", label(other))))}
      </li>
    );
  };

  /** `tagged`: among the helps of a word a note and a key term come together, and each says which it is. */
  const item = ({ kind, row }: Shown, tagged: boolean) => {
    const phrase = phraseOf(kind, row);
    const says = kind === "preguntas" ? null : otherPhraseOf(kind, row);
    const key = keyOf(kind, row);
    const tag = tagged ? <p className="ur-item__kind">{t(kind === "palabras" ? "ur.kindTerm" : "ur.kindNote")}</p> : null;
    // The words the help is about, as each text says them: the other one is not on the page to be marked.
    const quoted = (
      <>
        {phrase ? <p className="ur-item__head">«{phrase}»</p> : null}
        {says && other ? (
          <p className="ur-item__other">
            <span className="ur-text__name" data-text={other}>{label(other)}</span> «{says}»
          </p>
        ) : null}
      </>
    );
    if (kind === "palabras") {
      return (
        <li key={key} className="ur-item">
          {tag}
          {/* The words of the text, the name of the term, and its article to open: each line one thing. */}
          {quoted}
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
        {kind === "preguntas" ? <p className="ur-item__head">{row.title}</p> : quoted}
        {/* A question and its answer were two lines told apart by their weight alone. */}
        {kind === "preguntas" && row.body ? <p className="ur-lbl">{t("ur.answer")}</p> : null}
        {row.body ? <HelpMarkdownView className="ur-md" content={row.body} /> : null}
        {helpFoot(saidOf(kind, row), concernLine(key, kind, placeOfHelp(kind, row), t(kind === "preguntas" ? "ur.concernQuestion" : "ur.concernNote"), row.id))}
      </li>
    );
  };

  const article = reading ? articles[reading.title] : undefined;
  const place = current ?? verses[0] ?? 0;
  const tabName = (tab: Tab) => label(tab === "text" ? (other ?? main) : tab);

  return (
    <div className="ur" data-docked={docked || undefined}>
      {/* What stays at the top: where one is, which is the way to any verse. */}
      {verses.length > 1 ? (
        <div className="ur-bar">
          <button type="button" className="btn ur-bar__verse" data-variant="outline" data-size="default" aria-haspopup="dialog" onClick={() => setPicking(true)}>
            <b>{t("ur.barVerse").replace("{ref}", `${chapter}:${place}`)}</b>
            <span>{t("ur.at").replace("{n}", String(verses.indexOf(place) + 1)).replace("{of}", String(verses.length))}</span>
            <ChevronDown size={16} aria-hidden />
          </button>
        </div>
      ) : null}
      {/* What the marks mean, said once where the reading starts. */}
      <p className="af-hint ur-hint ur-legend">
        <span className="ur-word">{t("ur.legendNote")}</span> · <span className="ur-word" data-term>{t("ur.legendTerm")}</span>. {other ? t("ur.legendTouchOther").replace("{name}", label(other)) : t("ur.legendTouch")}
      </p>
      {verses.map((verse) => {
        const mine = open?.verse === verse ? open : null;
        const list = mine ? openList : [];
        const at = mine ? openAt : 0;
        const showing = mine ? inView : undefined;
        const text = texts[main]?.verses[verse];
        const tabs = tabsOf(verse);
        const helpCount = helpKeysOf(verse).length;
        const done = verseProgress(helpKeysOf(verse), seen).done;
        const after = mine && isTab(mine) ? tabs[tabs.indexOf(mine.kind) + 1] : undefined;
        const noted = notedAt(verse);
        const following = verses[verses.indexOf(verse) + 1];
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
            {text ? (
              <div className="ur-text" data-text={main}>
                <p>
                  <span className="ur-text__name" data-text={main}>{label(main)}</span> {words(main, verse, text)}
                </p>
              </div>
            ) : null}
            {/* One button to the helps of the verse and one to what is noted about it: it carried three chips and a
                line, and a list under them. */}
            <div className="ur-acts">
              {helpCount ? (
                <button type="button" data-helps aria-expanded={Boolean(mine && mine.kind !== "concerns")} data-done={done || undefined} onClick={() => toggleHelps(verse)}>
                  {done ? <Check size={14} aria-label={t("ur.indexDone")} /> : null}
                  {t("ur.helps").replace("{n}", String(helpCount))}
                </button>
              ) : null}
              {onConcern || noted.length ? (
                <button type="button" aria-expanded={mine?.kind === "concerns"} data-noted={noted.length ? true : undefined} onClick={() => toggleConcerns(verse)}>
                  <MessageSquare size={14} aria-hidden />
                  {noted.length ? t("ur.concernsN").replace("{n}", String(noted.length)) : t("ur.noteConcern")}
                </button>
              ) : null}
            </div>
            {mine ? (
              <div className="ur-open">
                {/* Its first row says what it is and is the way out; where the verse has more than one thing to
                    open, the way from one to another. */}
                <div className="ur-tabs">
                  {mine.kind === "concerns" ? (
                    <b className="ur-tabs__title">{t("ur.concernsOf").replace("{ref}", `${chapter}:${verse}`)}</b>
                  ) : (
                    <div className="ur-tabs__list" role="group" aria-label={t("ur.helpsOf").replace("{ref}", `${chapter}:${verse}`)}>
                      {tabs.map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          aria-pressed={mine.kind === tab}
                          // Going to the other text from a help, the words that help is about stay marked in it.
                          onClick={() => show(verse, tab === "text" ? { verse, kind: "text", at: 0, ...(showing && showing.kind !== "text" ? { marks } : {}) } : { verse, kind: tab, at: left[verse]?.kind === tab ? left[verse]!.at : 0 })}
                        >
                          {tabName(tab)}
                        </button>
                      ))}
                    </div>
                  )}
                  <button type="button" className="btn" data-variant="outline" data-size="default" onClick={() => show(verse, null)}>
                    {t("ur.close")}
                  </button>
                </div>
                {showing && mine.kind !== "concerns" ? (
                  <>
                    {showing.kind !== "text" && helps[showing.kind]?.fromSource ? <p className="af-hint">{t("ur.fromSource")}</p> : null}
                    {/* Above the help, so the buttons stay where they are whatever the length of what is read. */}
                    <div className="ur-pager">
                      <button type="button" className="btn" data-variant="outline" data-size="default" aria-label={t("af.prev")} disabled={at === 0} onClick={() => setOpen({ ...mine, at: at - 1 })}>
                        <ChevronLeft size={20} aria-hidden />
                      </button>
                      <span className="ur-pager__at" role="status">
                        {mine.kind === "word" ? <span className="ur-lbl">{t("ur.aboutWord").replace("{word}", touched)}</span> : null}
                        <b>{t("ur.at").replace("{n}", String(at + 1)).replace("{of}", String(list.length))}</b>
                      </span>
                      {at < list.length - 1 ? (
                        <button type="button" className="btn" data-variant="default" data-size="default" onClick={() => setOpen({ ...mine, at: at + 1 })}>
                          {t("af.next")} <ChevronRight size={16} aria-hidden />
                        </button>
                      ) : after ? (
                        // After the last, on to what else the verse has.
                        <button type="button" className="btn" data-variant="default" data-size="default" onClick={() => show(verse, { verse, kind: after, at: 0 })}>
                          {tabName(after)} <ChevronRight size={16} aria-hidden />
                        </button>
                      ) : mine.kind !== "word" && following !== undefined ? (
                        // After the last help of the verse, on to the next verse: it is read before its helps.
                        <button
                          type="button"
                          className="btn"
                          data-variant="default"
                          data-size="default"
                          onClick={() => {
                            setOpen(null);
                            // Once the card is gone: asked for with it still there, the verse ended up above the screen.
                            requestAnimationFrame(() => goTo(following));
                          }}
                        >
                          {t("ur.barVerse").replace("{ref}", `${chapter}:${following}`)} <ChevronRight size={16} aria-hidden />
                        </button>
                      ) : (
                        <span />
                      )}
                    </div>
                    <ul className="ur-items">{showing.kind === "text" ? otherItem(verse, mine.kind === "word") : item(showing, mine.kind === "word")}</ul>
                  </>
                ) : null}
                {mine.kind === "concerns" ? (
                  <div className="ur-items ur-item">
                    {noted.length ? (
                      <ul className="ur-said">
                        {noted.map((concern) => {
                          const kind = KINDS.find((candidate) => candidate === concern.about);
                          const index = kind ? helpsOfVerse(helps[kind]?.items, verse).findIndex((row) => saidOf(kind, row).includes(concern)) : -1;
                          return (
                            <li key={`${concern.by ?? ""}-${concern.id}`} data-kind={concern.kind}>
                              <b>
                                {t(concern.kind === "objection" ? "en.objection" : "en.observation")} · {label(concern.about)}
                                {(concern.where ?? "").replace(/^\s*\d+:\d+\s*/, "") ? ` ${(concern.where ?? "").replace(/^\s*\d+:\d+\s*/, "")}` : ""}
                                {concern.by ? ` · @${concern.by}` : ""}
                              </b>
                              <span>{concern.text}</span>
                              {kind && index >= 0 ? (
                                <button type="button" className="ur-add" onClick={() => show(verse, { verse, kind, at: index })}>
                                  {t(SEE[kind])} <ChevronRight size={14} aria-hidden />
                                </button>
                              ) : other && concern.about === other && otherOf(verse) ? (
                                <button type="button" className="ur-add" onClick={() => show(verse, { verse, kind: "text", at: 0 })}>
                                  {t("ur.seeText").replace("{name}", label(other))} <ChevronRight size={14} aria-hidden />
                                </button>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    ) : writingKey === `v${verse}` ? null : (
                      <p className="af-hint">{t("ur.noConcernsHere")}</p>
                    )}
                    {concernLine(`v${verse}`, main, concernPlace(chapter, verse), t("ur.concernVerse").replace("{ref}", `${chapter}:${verse}`))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}

      {/* Going to a verse: all of them at once, each saying whether it was gone through and whether something is
          noted in it. As a row that slid sideways, twelve showed of twenty-five and nothing said it went on. */}
      <Dialog open={picking} onOpenChange={(next) => !next && setPicking(false)}>
        <DialogContent className="ur-pick" showCloseButton={false}>
          <header className="ur-sheet__head">
            <DialogTitle>{t("ur.pickTitle")}</DialogTitle>
            <button type="button" className="btn" data-variant="outline" data-size="default" onClick={() => setPicking(false)}>
              {t("ur.close")}
            </button>
          </header>
          <div className="ur-pick__body">
            <div className="ur-pick__grid" role="group" aria-label={t("ur.indexAria")}>
              {verses.map((verse) => {
                const done = verseProgress(helpKeysOf(verse), seen).done;
                const noted = notedAt(verse).length > 0;
                return (
                  <button
                    key={verse}
                    type="button"
                    aria-current={place === verse ? "true" : undefined}
                    data-done={done || undefined}
                    data-noted={noted || undefined}
                    aria-label={[`${chapter}:${verse}`, done ? t("ur.indexDone") : "", noted ? t("ur.indexNoted") : ""].filter(Boolean).join(", ")}
                    onClick={() => {
                      setPicking(false);
                      goTo(verse);
                    }}
                  >
                    {verse}
                  </button>
                );
              })}
            </div>
            <p className="af-hint ur-hint">
              <span className="ur-key" data-current>{t("ur.indexHere")}</span> · <span className="ur-key" data-done>{t("ur.indexDone")}</span> · <span className="ur-key" data-noted>{t("ur.indexNoted")}</span>
            </p>
          </div>
        </DialogContent>
      </Dialog>

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
