import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  onChange: (markdown: string) => void;
  book?: string;
  /** The piece being written, when it is one of this text's. The screen has one piece open at a time. */
  open: number | null;
  /** A piece was touched to be written: `element` is where it is on the screen now. */
  onOpen: (index: number, element: HTMLElement) => void;
  /** How many pieces there are to translate, how many are, and the first that is not (-1: none). */
  onProgress?: (done: number, total: number, firstPending: number) => void;
  /** A file of an Academy article that is not its body: it reads as a title, or as the line under it. */
  part?: "title" | "sub-title";
};

/** A piece as it reads: what is written for it, or the source, in grey, while nothing is. */
const Piece = memo(function Piece({ id, index, content, pending, onOpen }: { id: string; index: number; content: string; pending: boolean; onOpen: (index: number, element: HTMLElement) => void }) {
  return (
    <div
      id={id}
      className="ab-text"
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
export function ArticleBlocks({ id, source, value, onChange, book, open, onOpen, onProgress, part }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const vocabulary = useMemo(() => vocabularyOf(source), [source]);
  const [rows, setRows] = useState<ArticleRow[]>(() => articleRows(source, value) ?? []);
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
    setRows(articleRows(source, value) ?? []);
    setTouched(new Set());
  }, [value, source]);

  useEffect(() => {
    const { done, total } = articleProgress(rows, vocabulary);
    tell.current?.(done, total, rows.findIndex((row) => row.words && rowPending(row, vocabulary)));
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
      say.current(text);
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
  const words = useMemo(() => ({ copy: t("ab.copy"), placeholder: t("ab.placeholder") }), [language]);

  return (
    <div className="ab" data-part={part}>
      {rows.map((row, index) => {
        const pending = rowPending(row, vocabulary);
        const rowId = `${id}-row-${index}`;
        if (open !== index) return <Piece key={index} id={rowId} index={index} content={pending || !row.draft.trim() ? row.source : row.draft} pending={pending || !row.draft.trim()} onOpen={openPiece} />;
        // Still the source, and not written in yet: the box is empty for the translation.
        const shown = pending && Boolean(row.draft.trim()) && !touched.has(index) ? "" : row.draft;
        return (
          <div key={index} id={rowId} className="ab-open">
            <HelpMarkdownView className="ab-peek" content={row.source} />
            <MarkdownEditor
              id={`${id}-${index}`}
              compact
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
            />
          </div>
        );
      })}
    </div>
  );
}
