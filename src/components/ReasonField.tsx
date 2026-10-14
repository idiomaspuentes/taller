import { createContext, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { GtSession } from "../dcs/auth";
import { loadVerseSources, type VerseSources } from "../dcs/reasonSources";
import { readable } from "../domain/checkProposal";
import { articleSnippet, insertAt, noteSnippet, originalSnippet, textSnippet } from "../domain/reasonInsert";
import type { SolverLaunchContext } from "../domain/solverLaunch";
import { useT } from "../i18n/messages";

/**
 * The verse a screen is about, for a reason written in a card it shows (the «no» of a decision): it can then cite
 * like the reason of the proposal itself. A card that is shown without it writes plain text.
 */
export const CiteScope = createContext<{ session: GtSession | null | undefined; ctx: SolverLaunchContext | null | undefined; chapter: number; verse: number } | null>(null);

type Cited = "orig" | "ult" | "ust" | "notes" | "articles";

const isHebrew = (text: string) => /[֐-׿]/.test(text);
/** A note in a line, as it reads: without the marks it is written with. */
const preview = (note: string) => {
  const plain = readable(note).replace(/\s+/g, " ");
  return plain.length > 110 ? `${plain.slice(0, 109).trimEnd()}…` : plain;
};

/**
 * Where the reason of a change to the text is written, with what it would cite a touch away: the words of the
 * original of the verse, of the ULT and of the UST, its notes and the Academy articles they point to. Each is put
 * where the person was writing, written so that whoever reads the reason can open it (`reasonText.ts`). On a phone
 * a reason that quoted the Hebrew was not written: the Hebrew could not be typed.
 */
export function ReasonField({
  value,
  onChange,
  session,
  ctx,
  chapter,
  verse,
  rows = 3,
  id,
  placeholder,
  ariaLabel,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  session: GtSession | null | undefined;
  ctx: SolverLaunchContext | null | undefined;
  chapter: number;
  verse: number;
  rows?: number;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
}) {
  const t = useT();
  const area = useRef<HTMLTextAreaElement>(null);
  // Where the person was writing when they went to cite: a touch on a button takes the focus away.
  const where = useRef<{ start: number; end: number }>({ start: value.length, end: value.length });
  const [sources, setSources] = useState<VerseSources | null | "loading">(null);
  const [open, setOpen] = useState<Cited | null>(null);
  const [picked, setPicked] = useState<number[]>([]);

  const remember = () => {
    const node = area.current;
    if (node) where.current = { start: node.selectionStart, end: node.selectionEnd };
  };

  async function show(kind: Cited) {
    setPicked([]);
    setOpen(open === kind ? null : kind);
    if (sources || !session || !ctx) return;
    setSources("loading");
    setSources(await loadVerseSources(session, ctx, chapter, verse).catch(() => ({ original: [], texts: [], notes: [], articles: [] })));
  }

  function put(snippet: string) {
    const { text, cursor } = insertAt(value, where.current.start, where.current.end, snippet);
    onChange(text);
    where.current = { start: cursor, end: cursor };
    setOpen(null);
    setPicked([]);
    requestAnimationFrame(() => {
      const node = area.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(cursor, cursor);
    });
  }

  if (!session || !ctx) {
    return <textarea id={id} className="af-textarea" rows={rows} value={value} placeholder={placeholder} aria-label={ariaLabel} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} />;
  }

  const loaded = sources && sources !== "loading" ? sources : null;
  const words = (kind: Cited): string[] => {
    if (!loaded) return [];
    if (kind === "orig") return loaded.original.map((word) => word.surface);
    const text = loaded.texts.find((row) => row.id === kind)?.text ?? "";
    return text.split(/\s+/).filter(Boolean);
  };
  const toggle = (index: number) => setPicked((now) => (now.includes(index) ? now.filter((at) => at !== index) : [...now, index].sort((a, b) => a - b)));
  const cite = () => {
    const list = words(open!);
    const chosen = picked.map((index) => list[index]!).filter(Boolean);
    if (!chosen.length) return;
    put(open === "orig" ? originalSnippet(chosen) : textSnippet(open!.toUpperCase(), chosen));
  };

  return (
    <div className="rf">
      <textarea
        ref={area}
        id={id}
        className="af-textarea"
        rows={rows}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        onChange={(e) => {
          onChange(e.target.value);
          where.current = { start: e.target.selectionStart, end: e.target.selectionEnd };
        }}
        onSelect={remember}
        onBlur={remember}
      />
      <div className="rf-bar" role="group" aria-label={t("rf.aria")}>
        <span className="rf-bar__label">{t("rf.cite")}</span>
        {(["orig", "ult", "ust", "notes", "articles"] as Cited[]).map((kind) => (
          <button key={kind} type="button" className="rf-chip" aria-pressed={open === kind} onMouseDown={(e) => e.preventDefault()} onClick={() => void show(kind)}>
            {kind === "orig" ? t("rf.original") : kind === "notes" ? t("rf.notes") : kind === "articles" ? t("rf.articles") : kind.toUpperCase()}
          </button>
        ))}
      </div>
      {open ? (
        <div className="rf-pick">
          {sources === "loading" ? <p className="af-hint">{t("rf.loading")}</p> : null}
          {loaded && (open === "orig" || open === "ult" || open === "ust") ? (
            words(open).length ? (
              <>
                <p className="af-hint">{t("rf.pickWords")}</p>
                <div className={`rf-words${open === "orig" ? " af-orig" : ""}`} dir={open === "orig" && words(open).some(isHebrew) ? "rtl" : undefined}>
                  {words(open).map((word, index) => (
                    <button key={index} type="button" className="rf-word" aria-pressed={picked.includes(index)} onMouseDown={(e) => e.preventDefault()} onClick={() => toggle(index)}>
                      {open === "orig" ? originalSnippet([word]) : word}
                    </button>
                  ))}
                </div>
                <div className="rf-actions">
                  <Button type="button" size="sm" disabled={!picked.length} onClick={cite}>
                    {picked.length === 1 ? t("rf.insertOne") : picked.length ? t("rf.insertN").replace("{n}", String(picked.length)) : t("rf.insert")}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(null)}>
                    {t("rf.cancel")}
                  </Button>
                </div>
              </>
            ) : (
              <p className="af-hint">{t("rf.noText")}</p>
            )
          ) : null}
          {loaded && open === "notes" ? (
            loaded.notes.length ? (
              <ul className="rf-list">
                {loaded.notes.map((note) => (
                  <li key={note.id}>
                    <button type="button" className="rf-item" onMouseDown={(e) => e.preventDefault()} onClick={() => put(noteSnippet(note.id))}>
                      <span className="rf-item__head">
                        <code>{note.id}</code>
                        {note.quote ? (
                          <span lang="hbo" dir="rtl">
                            {originalSnippet([note.quote])}
                          </span>
                        ) : null}
                      </span>
                      <span className="rf-item__text">{preview(note.note)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="af-hint">{t("rf.noNotes")}</p>
            )
          ) : null}
          {loaded && open === "articles" ? (
            loaded.articles.length ? (
              <ul className="rf-list">
                {loaded.articles.map((article) => (
                  <li key={article.path}>
                    <button type="button" className="rf-item" onMouseDown={(e) => e.preventDefault()} onClick={() => put(articleSnippet(article.title, article.path))}>
                      <span className="rf-item__head">{article.title}</span>
                      <span className="rf-item__text">{article.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="af-hint">{t("rf.noArticles")}</p>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
