import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, MessageSquare } from "lucide-react";
import { articleProgress, articleRows, rowPending, rowsMarkdown, vocabularyOf, type ArticleRow } from "../domain/articleBlocks";
import { normalizeMarkdown } from "../domain/helpMarkup";
import { useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";
import { HelpMarkdownView } from "./HelpMarkdownView";
import { MarkdownEditor } from "./MarkdownEditor";

type Props = {
  /** Prefix of the ids: a piece is `${id}-row-${index}`, and its box, once open, `${id}-${index}`. */
  id: string;
  /** The article as the source package has it. */
  source: string;
  /** The article as the team has it: one markdown text, which the pieces are a way of showing. */
  value: string;
  /** Absent where the article is only read (its review). */
  onChange?: (markdown: string) => void;
  /** The article is read, not written: the open piece shows the source and what was written for it, as text. */
  readOnly?: boolean;
  book?: string;
  /** The piece being written, when it is one of this text's. The screen has one piece open at a time. */
  open: number | null;
  /** A piece was touched to be written: `element` is where it is on the screen now. */
  onOpen: (index: number, element: HTMLElement) => void;
  /** How many pieces there are to translate, how many are, the first that is not (-1: none), how many pieces in all, and which of them the app writes. */
  onProgress?: (done: number, total: number, firstPending: number, count: number, made: number[]) => void;
  /** What the app writes itself: the text of the row of a piece of the source, or `null` for one that is translated (see `articleRows`). */
  make?: (sourcePiece: string) => string | null;
  /** Whether a piece comes after the open one, in this text or in the one that follows it. */
  hasNext?: boolean;
  /** Go on to the piece after `index`: whoever translates down the article does not have to find and touch it. */
  onNext?: (index: number) => void;
  /** No piece comes after the one being written: where the way on was, there is a way out of it. */
  onDone?: () => void;
  /** A file of an Academy article that is not its body: it reads as a title, or as the line under it. */
  part?: "title" | "sub-title";
  /** Under the open piece: what goes with it (the comments about it, what to check in it). */
  below?: (index: number, row: ArticleRow, pending: boolean) => React.ReactNode;
  /** How many comments wait on a piece: a piece that is not open says so with a mark. */
  marksOf?: (index: number) => number;
  /** Over the piece being written: what was said about it, read before it is corrected. */
  above?: (index: number) => React.ReactNode;
  /**
   * Beside the source of the piece being written: what the team already has for it somewhere else (the frame of a
   * story an example quotes). `text` is what the box holds and `write` puts another text in it; the box is not
   * given the cursor, so that on a phone the keyboard stays down while the piece is made by touching.
   */
  beside?: (row: ArticleRow, box: { text: string; write: (markdown: string) => void }) => React.ReactNode;
  /** The text is plain sentences (a question, its answer): its box offers no bold, italics or link. */
  plain?: boolean;
};

/** A piece as it reads: what is written for it, or the source, in grey, while nothing is. */
const Piece = memo(function Piece({ id, index, content, pending, marks, onOpen }: { id: string; index: number; content: string; pending: boolean; marks: number; onOpen: (index: number, element: HTMLElement) => void }) {
  return (
    <div
      id={id}
      className="ab-text"
      data-slide
      role="button"
      tabIndex={0}
      data-pending={pending ? "true" : undefined}
      onClick={(event) => onOpen(index, event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpen(index, event.currentTarget);
      }}
    >
      <HelpMarkdownView content={content} />
      {marks ? (
        <span className="ab-mark">
          <MessageSquare size={12} aria-hidden /> {marks}
        </span>
      ) : null}
    </div>
  );
});

/**
 * An article read as an article, and translated a piece at a time. What is translated reads in its own colour and
 * what is not, in grey, as the source has it. Touching a piece opens it: what the source says for it is right over
 * the box where its translation is written, so a glance up lands on the paragraph in hand. Only that piece is open;
 * the rest stays text, and the article keeps its length and its shape.
 *
 * A piece nobody has translated is in the article as the source has it, and its box opens empty: whoever translates
 * writes, and does not have to clear a paragraph in another language first. Until something is written the article
 * keeps what it had; «Copiar el original» puts the source in the box for whoever prefers to write over it (it keeps
 * its links and its bold).
 */
export function ArticleBlocks({ id, source, value, onChange, readOnly, book, open, onOpen, onProgress, make, hasNext, onNext, onDone, part, below, marksOf, above, beside, plain }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const vocabulary = useMemo(() => vocabularyOf(source), [source]);
  const [rows, setRows] = useState<ArticleRow[]>(() => articleRows(source, value, make) ?? []);
  /** The pieces written in since they were made: what they hold is shown, whatever language it is in. */
  const [touched, setTouched] = useState<ReadonlySet<number>>(() => new Set());
  /** What the pieces were last made from, or last said: another text or another source comes from outside. */
  const made = useRef({ text: normalizeMarkdown(value), source });
  const latest = useRef(rows);
  latest.current = rows;
  const say = useRef(onChange);
  say.current = onChange;
  const tell = useRef(onProgress);
  tell.current = onProgress;
  const opened = useRef(onOpen);
  opened.current = onOpen;

  useEffect(() => {
    const text = normalizeMarkdown(value);
    if (text === made.current.text && source === made.current.source) return;
    made.current = { text, source };
    setRows(articleRows(source, value, make) ?? []);
    setTouched(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `make` says the same for the same source
  }, [value, source]);

  useEffect(() => {
    const { done, total } = articleProgress(rows, vocabulary);
    tell.current?.(
      done,
      total,
      rows.findIndex((row) => row.words && rowPending(row, vocabulary)),
      rows.length,
      rows.flatMap((row, index) => (row.made ? [index] : [])),
    );
  }, [rows, vocabulary]);

  const touch = useCallback((index: number) => setTouched((prev) => (prev.has(index) ? prev : new Set(prev).add(index))), []);

  const put = useCallback(
    (index: number, draft: string) => {
      const next = latest.current.map((row, at) => (at === index ? { ...row, draft } : row));
      latest.current = next;
      const text = rowsMarkdown(next);
      made.current = { ...made.current, text };
      setRows(next);
      touch(index);
      say.current?.(text);
    },
    [touch],
  );

  const copy = useCallback(
    (index: number) => {
      const row = latest.current[index];
      if (!row) return;
      // The article already has the source here: it only has to be shown. Where it has nothing, the source is put in.
      if (row.draft.trim()) touch(index);
      else put(index, row.source);
      requestAnimationFrame(() => document.getElementById(`${id}-${index}`)?.focus());
    },
    [put, touch, id],
  );

  const openPiece = useCallback((index: number, element: HTMLElement) => opened.current(index, element), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const words = useMemo(() => ({ copy: t("ab.copy"), placeholder: t("ab.placeholder"), next: t("ab.next"), done: t("ab.done"), untranslated: t("ab.untranslated"), made: t("ab.made") }), [language]);

  return (
    <div className="ab" data-part={part}>
      {rows.map((row, index) => {
        const pending = rowPending(row, vocabulary);
        const rowId = `${id}-row-${index}`;
        if (row.made && !readOnly) {
          // Written by the app: it reads as the text of the article and is not opened. The first of a run says why.
          const over = above?.(index);
          return (
            <div key={index} id={rowId} className="ab-text" data-slide data-made>
              {rows[index - 1]?.made ? null : <p className="ab-made">{words.made}</p>}
              {over ? <div className="ab-over">{over}</div> : null}
              <HelpMarkdownView content={row.draft} />
            </div>
          );
        }
        if (open !== index) return <Piece key={index} id={rowId} index={index} content={pending || !row.draft.trim() ? row.source : row.draft} pending={pending || !row.draft.trim()} marks={marksOf?.(index) ?? 0} onOpen={openPiece} />;
        const next =
          hasNext && onNext ? (
            // The press must not take the cursor out of the text: on a phone the keyboard would go down and come up again.
            <button type="button" className="ab-next" onMouseDown={(event) => event.preventDefault()} onClick={() => onNext(index)}>
              {words.next} <ChevronDown size={16} aria-hidden />
            </button>
          ) : onDone && !readOnly ? (
            // The last piece: the press takes the cursor out on purpose, so the keyboard goes down and the bar with
            // what to do next comes back.
            <button type="button" className="ab-next ab-next--done" onClick={onDone}>
              <Check size={16} aria-hidden /> {words.done}
            </button>
          ) : undefined;
        const under = below?.(index, row, pending || !row.draft.trim());
        if (readOnly) {
          // Read, not written: the source and what was written for it, and under them what goes with the piece.
          return (
            <div key={index} id={rowId} className="ab-open ab-open--read" data-slide>
              <HelpMarkdownView className="ab-peek" content={row.source} />
              <div className="ab-read">{pending || !row.draft.trim() ? <p className="ab-read__none">{words.untranslated}</p> : <HelpMarkdownView content={row.draft} />}</div>
              {under || next ? (
                <div className="ab-under">
                  {under}
                  {next ? <div className="ab-under__next">{next}</div> : null}
                </div>
              ) : null}
            </div>
          );
        }
        // Still the source, and not written in yet: the box is empty for the translation.
        const shown = pending && Boolean(row.draft.trim()) && !touched.has(index) ? "" : row.draft;
        const over = above?.(index);
        const ours = beside?.(row, { text: shown, write: (markdown) => put(index, markdown) });
        return (
          <div key={index} id={rowId} className="ab-open" data-slide>
            {over ? <div className="ab-over">{over}</div> : null}
            {ours ? (
              // The source and what the team has for it read together, on the same side of the box.
              <div className="ab-source">
                <HelpMarkdownView className="ab-peek" content={row.source} />
                {ours}
              </div>
            ) : (
              <HelpMarkdownView className="ab-peek" content={row.source} />
            )}
            <MarkdownEditor
              id={`${id}-${index}`}
              compact
              plain={plain}
              emptyAs={row.shape}
              value={shown}
              book={book}
              placeholder={words.placeholder}
              onChange={(markdown) => put(index, markdown)}
              aside={
                shown.trim() ? undefined : (
                  <button type="button" className="ab-act" onClick={() => copy(index)}>
                    {words.copy}
                  </button>
                )
              }
              trailing={next}
            />
            {under ? <div className="ab-under">{under}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
