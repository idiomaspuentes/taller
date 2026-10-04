import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { articleProgress, articleRows, rowPending, rowsMarkdown, vocabularyOf, type ArticleRow } from "../domain/articleBlocks";
import { normalizeMarkdown } from "../domain/helpMarkup";
import { useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";
import { HelpMarkdownView } from "./HelpMarkdownView";
import { MarkdownEditor } from "./MarkdownEditor";

type Props = {
  /** Prefix of the ids of the boxes: the first one is `${id}-0`. */
  id: string;
  /** The article as the source package has it. */
  source: string;
  /** The article as the team has it: one markdown text, which the rows are a way of showing. */
  value: string;
  onChange: (markdown: string) => void;
  book?: string;
  showSource: boolean;
  /** How many pieces there are to translate and how many are, said whenever it changes. */
  onProgress?: (done: number, total: number) => void;
};

type Words = { pending: string; copy: string; clear: string; placeholder: string };

type RowProps = {
  id: string;
  index: number;
  row: ArticleRow;
  /** What the box shows: what the article has for the row, or nothing while that is still the source untouched. */
  shown: string;
  pending: boolean;
  showSource: boolean;
  book?: string;
  words: Words;
  onEdit: (index: number, markdown: string) => void;
  onCopy: (index: number) => void;
  onClear: (index: number) => void;
};

/** One piece: what the source says, and right under it (beside it, on a wide screen) what is written for it. */
const Row = memo(function Row({ id, index, row, shown, pending, showSource, book, words, onEdit, onCopy, onClear }: RowProps) {
  return (
    <div className="ab-row" data-pending={pending ? "true" : undefined}>
      {showSource ? <HelpMarkdownView className="ab-source af-note af-note--md" content={row.source} /> : null}
      <MarkdownEditor
        id={`${id}-${index}`}
        compact
        emptyAs={row.shape}
        value={shown}
        book={book}
        placeholder={words.placeholder}
        onChange={(markdown) => onEdit(index, markdown)}
        aside={
          pending ? (
            <>
              <span className="ab-tag">{words.pending}</span>
              {shown.trim() ? (
                <button type="button" className="ab-act" onClick={() => onClear(index)}>
                  {words.clear}
                </button>
              ) : (
                <button type="button" className="ab-act" onClick={() => onCopy(index)}>
                  {words.copy}
                </button>
              )}
            </>
          ) : undefined
        }
      />
    </div>
  );
});

/**
 * An article translated piece by piece. Each heading, paragraph, quote and item of the source has its own box, so a
 * glance up from what is being written lands on the paragraph being translated.
 *
 * A piece nobody has translated yet is in the article as the source has it, and its box is shown empty: whoever
 * translates writes, and does not have to clear a paragraph in another language first. Until something is written
 * the article keeps what it had; «Copiar el original» puts the source in the box for whoever prefers to write over
 * it (it keeps its links and its bold).
 */
export function ArticleBlocks({ id, source, value, onChange, book, showSource, onProgress }: Props) {
  const t = useT();
  const vocabulary = useMemo(() => vocabularyOf(source), [source]);
  const [rows, setRows] = useState<ArticleRow[]>(() => articleRows(source, value) ?? []);
  /** The rows written in since they were made: what they hold is shown, whatever language it is in. */
  const [touched, setTouched] = useState<ReadonlySet<number>>(() => new Set());
  /** What the rows were last made from, or last said: another text or another source comes from outside. */
  const made = useRef({ text: normalizeMarkdown(value), source });
  const latest = useRef(rows);
  latest.current = rows;
  const say = useRef(onChange);
  say.current = onChange;
  const tell = useRef(onProgress);
  tell.current = onProgress;

  useEffect(() => {
    const text = normalizeMarkdown(value);
    if (text === made.current.text && source === made.current.source) return;
    made.current = { text, source };
    setRows(articleRows(source, value) ?? []);
    setTouched(new Set());
  }, [value, source]);

  useEffect(() => {
    const { done, total } = articleProgress(rows, vocabulary);
    tell.current?.(done, total);
  }, [rows, vocabulary]);

  const touch = useCallback((index: number) => setTouched((prev) => (prev.has(index) ? prev : new Set(prev).add(index))), []);
  const focus = useCallback((index: number) => requestAnimationFrame(() => document.getElementById(`${id}-${index}`)?.focus()), [id]);

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
      focus(index);
    },
    [put, touch, focus],
  );

  const clear = useCallback(
    (index: number) => {
      put(index, "");
      focus(index);
    },
    [put, focus],
  );

  // The words change only with the language: made once, every row that did not change is left as it is.
  const language = useUiLanguage();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const words = useMemo<Words>(() => ({ pending: t("ab.pending"), copy: t("ab.copy"), clear: t("ab.clear"), placeholder: t("ab.placeholder") }), [language]);

  return (
    <div className="ab" data-source={showSource ? "shown" : "hidden"}>
      {rows.map((row, index) => {
        const pending = rowPending(row, vocabulary);
        const untouched = pending && Boolean(row.draft.trim()) && !touched.has(index);
        return <Row key={index} id={id} index={index} row={row} shown={untouched ? "" : row.draft} pending={pending} showSource={showSource} book={book} words={words} onEdit={put} onCopy={copy} onClear={clear} />;
      })}
    </div>
  );
}
