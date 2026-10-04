import { useEffect, useMemo, useRef, useState } from "react";
import { Bold, BookOpen, Code2, Heading2, Italic, Link2, List, ListOrdered, Quote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KNOWN_ARTICLES } from "../domain/afinacionNotes";
import { academyLink, describeRc, normalizeMarkdown, parseMarkdown, referenceLink, roundTrips, serializeMarkdown, wordLink, type Block, type Inline } from "../domain/helpMarkup";
import { useT } from "../i18n/messages";

type Props = {
  id?: string;
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  /** The book the text belongs to, for the links to verses of the same book. */
  book?: string;
  /** Rows of the plain box, when the text is shown as its source. */
  rows?: number;
  /**
   * One piece of a longer text (a paragraph of an article): the box is as tall as what it holds, and the tools are
   * only the ones a paragraph needs (bold, italics, a link), shown under it while it is being written.
   */
  compact?: boolean;
  /** What an empty box starts as: a heading, a quote, an item of a list. What is typed in it then is one. */
  emptyAs?: Block;
  /** Shown beside the tools of a compact box: what is to be said about the piece, and done with it. */
  aside?: React.ReactNode;
  /** Shown at the end of that line, always: where the way on from this piece goes. */
  trailing?: React.ReactNode;
};

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** How a resource link reads where it is shown: the kind of resource and what it points at. */
function chipLabel(href: string, names: { academia: string; palabra: string }): string {
  const what = describeRc(href);
  if (what.kind === "academia") return `${names.academia}: ${KNOWN_ARTICLES.find((row) => row.slug === what.slug)?.label ?? what.slug}`;
  if (what.kind === "palabra") return `${names.palabra}: ${what.slug}`;
  return what.slug;
}

function inlineHtml(nodes: Inline[], names: { academia: string; palabra: string }): string {
  return nodes
    .map((node) => {
      if (node.t === "text") return esc(node.v);
      if (node.t === "br") return "<br>";
      if (node.t === "b") return `<strong>${inlineHtml(node.c, names)}</strong>`;
      if (node.t === "i") return `<em>${inlineHtml(node.c, names)}</em>`;
      // A resource link is one piece: it is put in and taken out whole, never typed into.
      if (node.t === "rc") return `<span class="mde-chip" contenteditable="false" data-rc="${esc(node.href)}">${esc(chipLabel(node.href, names))}</span>`;
      return `<a data-href="${esc(node.href)}" title="${esc(node.href)}">${inlineHtml(node.c, names)}</a>`;
    })
    .join("");
}

function blocksHtml(blocks: Block[], names: { academia: string; palabra: string }): string {
  return blocks
    .map((block) => {
      if (block.t === "h") return `<h${Math.min(6, block.level)}>${inlineHtml(block.c, names)}</h${Math.min(6, block.level)}>`;
      // How the list was written (its spaces, its first number) rides on the element, to write it back the same.
      const gap = `${(block.t === "ul" || block.t === "ol") && block.gap ? ` data-gap="${block.gap.length}"` : ""}${(block.t === "ul" || block.t === "ol" || block.t === "quote") && block.tight ? ' data-tight="1"' : ""}`;
      if (block.t === "ul") return `<ul data-marker="${block.marker}"${gap}>${block.items.map((item) => `<li>${inlineHtml(item, names)}</li>`).join("")}</ul>`;
      if (block.t === "ol") return `<ol${block.start ? ` start="${block.start}"` : ""}${gap}>${block.items.map((item) => `<li>${inlineHtml(item, names)}</li>`).join("")}</ol>`;
      if (block.t === "quote") return `<blockquote${gap}${block.depth ? ` data-depth="${block.depth}"` : ""}${block.bare ? ' data-bare="1"' : ""}>${inlineHtml(block.c, names)}</blockquote>`;
      return `<p>${inlineHtml(block.c, names)}</p>`;
    })
    .join("");
}

/** What was written, read back from the page into the tree. */
function inlineOf(parent: Node): Inline[] {
  const out: Inline[] = [];
  parent.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").replace(/ /g, " ");
      if (text) out.push({ t: "text", v: text });
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const tag = node.tagName;
    if (node.dataset.rc) out.push({ t: "rc", href: node.dataset.rc });
    else if (tag === "BR") out.push({ t: "br" });
    else if (tag === "B" || tag === "STRONG") out.push({ t: "b", c: inlineOf(node) });
    else if (tag === "I" || tag === "EM") out.push({ t: "i", c: inlineOf(node) });
    else if (tag === "A") out.push({ t: "link", href: node.dataset.href || node.getAttribute("href") || "", c: inlineOf(node) });
    else out.push(...inlineOf(node));
  });
  // A break at the very end of a block is how browsers keep an empty line open: it is not part of the text.
  while (out.length && out[out.length - 1]!.t === "br") out.pop();
  return out.filter((node) => !((node.t === "b" || node.t === "i") && !node.c.length));
}

function blocksOf(root: HTMLElement): Block[] {
  const blocks: Block[] = [];
  let loose: ChildNode[] = [];
  const flush = () => {
    if (!loose.length) return;
    const holder = document.createElement("div");
    loose.forEach((node) => holder.appendChild(node.cloneNode(true)));
    const c = inlineOf(holder);
    if (c.length) blocks.push({ t: "p", c });
    loose = [];
  };
  root.childNodes.forEach((node) => {
    const el = node instanceof HTMLElement ? node : null;
    const tag = el?.tagName ?? "";
    if (el && /^H[1-6]$/.test(tag)) {
      flush();
      const c = inlineOf(el);
      if (c.length) blocks.push({ t: "h", level: Number(tag[1]), c });
    } else if (el && (tag === "UL" || tag === "OL")) {
      flush();
      const items = [...el.children].filter((li) => li.tagName === "LI").map((li) => inlineOf(li)).filter((item) => item.length);
      const gap = Number(el.dataset.gap) > 1 ? { gap: " ".repeat(Number(el.dataset.gap)) } : {};
      const start = Number(el.getAttribute("start")) > 1 ? { start: Number(el.getAttribute("start")) } : {};
      const tight = el.dataset.tight && blocks.length ? { tight: true } : {};
      if (items.length) blocks.push(tag === "UL" ? { t: "ul", marker: el.dataset.marker || "*", ...gap, ...tight, items } : { t: "ol", ...start, ...gap, ...tight, items });
    } else if (el && tag === "BLOCKQUOTE") {
      flush();
      const c = inlineOf(el);
      if (c.length) blocks.push({ t: "quote", ...(el.dataset.tight && blocks.length ? { tight: true } : {}), ...(Number(el.dataset.depth) > 1 ? { depth: Number(el.dataset.depth) } : {}), ...(el.dataset.bare ? { bare: true } : {}), c });
    } else if (el && (tag === "P" || tag === "DIV")) {
      flush();
      const c = inlineOf(el);
      if (c.length) blocks.push({ t: "p", c });
    } else loose.push(node);
  });
  flush();
  return blocks;
}

type LinkKind = "academia" | "palabra" | "versiculo" | "web";

/**
 * A help edited as it looks: bold is bold, a heading is a heading, a link to another resource is a piece that is put
 * in from a button and reads «Academia: Metáfora» instead of its address. What is kept is still the same markdown.
 * A text that uses something this editor does not handle is shown as its source, so that nothing is rewritten by
 * opening it; the source is always one button away.
 */
/** The empty box of a piece that is not a plain paragraph: its element, with the line a browser needs to write in it. */
function shapeHtml(shape: Block | undefined, names: { academia: string; palabra: string }): string {
  return shape && shape.t !== "p" ? blocksHtml([shape], names) : "";
}

export function MarkdownEditor({ id, value, onChange, placeholder, book, rows = 6, compact, emptyAs, aside, trailing }: Props) {
  const t = useT();
  const names = useMemo(() => ({ academia: t("mde.academy"), palabra: t("mde.word") }), [t]);
  const safe = useMemo(() => roundTrips(value), [value]);
  const [source, setSource] = useState(!safe);
  const [linking, setLinking] = useState<LinkKind | null>(null);
  const [fields, setFields] = useState({ slug: "", kind: "kt", chapter: "", verse: "", label: "", book: "", url: "" });
  const box = useRef<HTMLDivElement | null>(null);
  /** What this editor last said the text is: a different `value` came from outside, and is shown. */
  const said = useRef<string | null>(null);
  const range = useRef<Range | null>(null);

  useEffect(() => {
    if (source || !box.current) return;
    if (said.current === value) return;
    box.current.innerHTML = value.trim() ? blocksHtml(parseMarkdown(value), names) : shapeHtml(emptyAs, names);
    said.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, source, names]);

  function emit() {
    if (!box.current) return;
    const next = serializeMarkdown(blocksOf(box.current));
    said.current = next;
    // Opening a text and leaving it is not a change: only what reads differently is said.
    if (next !== normalizeMarkdown(value)) onChange(next);
  }

  function keepSelection() {
    const sel = window.getSelection();
    if (sel?.rangeCount && box.current?.contains(sel.anchorNode)) range.current = sel.getRangeAt(0).cloneRange();
  }

  function backToSelection() {
    box.current?.focus();
    const sel = window.getSelection();
    if (range.current && sel) {
      sel.removeAllRanges();
      sel.addRange(range.current);
    }
  }

  function run(command: string, arg?: string) {
    backToSelection();
    document.execCommand(command, false, arg);
    emit();
  }

  /** A heading or a quote, or back to a plain paragraph when the line already is one. */
  function block(tag: "h2" | "blockquote") {
    backToSelection();
    const at = window.getSelection()?.anchorNode;
    const el = (at instanceof HTMLElement ? at : at?.parentElement)?.closest(tag);
    document.execCommand("formatBlock", false, el ? "p" : tag);
    emit();
  }

  function insert(markdown: string) {
    const html = inlineHtml(parseMarkdown(markdown).flatMap((b) => (b.t === "p" ? b.c : [])), names);
    backToSelection();
    // A space after it, so that typing goes on outside the piece.
    document.execCommand("insertHTML", false, `${html}&nbsp;`);
    emit();
    setLinking(null);
    setFields({ slug: "", kind: "kt", chapter: "", verse: "", label: "", book: "", url: "" });
  }

  function addLink() {
    const chapter = Number(fields.chapter);
    const verse = Number(fields.verse);
    if (linking === "academia" && fields.slug.trim()) {
      const known = KNOWN_ARTICLES.find((row) => row.label.toLowerCase() === fields.slug.trim().toLowerCase());
      insert(academyLink(known?.slug ?? fields.slug));
    } else if (linking === "palabra" && fields.slug.trim()) insert(wordLink(fields.kind, fields.slug));
    else if (linking === "versiculo" && chapter > 0 && verse > 0) insert(referenceLink({ chapter, verse, label: fields.label, book: fields.book, inBook: book }));
    else if (linking === "web" && fields.url.trim()) insert(`[${fields.label.trim() || fields.url.trim()}](${fields.url.trim()})`);
  }

  const tool = (label: string, icon: React.ReactNode, onPress: () => void) => (
    // The press must not take the cursor out of the text.
    <button type="button" className="mde-tool" aria-label={label} title={label} onMouseDown={(e) => e.preventDefault()} onClick={onPress}>
      {icon}
    </button>
  );
  const field = (key: keyof typeof fields, label: string, extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <label className="mde-field">
      <span>{label}</span>
      <input className="af-input" value={fields[key]} onChange={(e) => setFields({ ...fields, [key]: e.target.value })} {...extra} />
    </label>
  );

  return (
    <div className={compact ? `mde mde--compact${value.trim() ? "" : " mde--empty"}` : "mde"}>
      <div className="mde-bar" role="toolbar" aria-label={t("mde.toolbar")}>
        {compact && aside ? <div className="mde-aside">{aside}</div> : null}
        {source ? null : (
          <span className="mde-tools">
            {tool(t("mde.bold"), <Bold size={16} aria-hidden />, () => run("bold"))}
            {tool(t("mde.italic"), <Italic size={16} aria-hidden />, () => run("italic"))}
            {compact ? null : (
              <>
                {tool(t("mde.heading"), <Heading2 size={16} aria-hidden />, () => block("h2"))}
                {tool(t("mde.list"), <List size={16} aria-hidden />, () => run("insertUnorderedList"))}
                {tool(t("mde.numbered"), <ListOrdered size={16} aria-hidden />, () => run("insertOrderedList"))}
                {tool(t("mde.quote"), <Quote size={16} aria-hidden />, () => block("blockquote"))}
              </>
            )}
            <span className="mde-sep" aria-hidden />
            <button
              type="button"
              className="mde-tool mde-tool--text"
              aria-expanded={linking !== null}
              onMouseDown={(e) => {
                e.preventDefault();
                keepSelection();
              }}
              onClick={() => setLinking(linking ? null : "academia")}
            >
              <Link2 size={16} aria-hidden /> {t("mde.link")}
            </button>
          </span>
        )}
        {/* A piece is not read as its source: the whole text has that, one switch away. */}
        {compact && !source ? null : (
          <button type="button" className="mde-tool mde-tool--text mde-tool--end" aria-pressed={source}
            onClick={() => {
              // The box is made anew when coming back to it: it must be filled again.
              said.current = null;
              setSource(!source);
            }}
          >
            {source ? <BookOpen size={16} aria-hidden /> : <Code2 size={16} aria-hidden />} {t(source ? "mde.visual" : "mde.source")}
          </button>
        )}
        {compact && trailing ? <div className="mde-trailing">{trailing}</div> : null}
      </div>

      {linking && !source ? (
        <div className="mde-link">
          <div className="mde-kinds" role="tablist" aria-label={t("mde.linkTo")}>
            {(["academia", "palabra", "versiculo", "web"] as const).map((kind) => (
              <button key={kind} type="button" role="tab" aria-selected={linking === kind} className="mde-kind" onClick={() => setLinking(kind)}>
                {t(`mde.kind.${kind}`)}
              </button>
            ))}
          </div>
          {linking === "academia" ? (
            <>
              {field("slug", t("mde.article"), { list: "mde-articles", placeholder: t("mde.articleHint") })}
              <datalist id="mde-articles">
                {KNOWN_ARTICLES.map((row) => (
                  <option key={row.slug} value={row.label} />
                ))}
              </datalist>
            </>
          ) : linking === "palabra" ? (
            <div className="mde-row">
              <label className="mde-field">
                <span>{t("mde.wordKind")}</span>
                <select className="af-input" value={fields.kind} onChange={(e) => setFields({ ...fields, kind: e.target.value })}>
                  <option value="kt">{t("mde.wordKt")}</option>
                  <option value="names">{t("mde.wordNames")}</option>
                  <option value="other">{t("mde.wordOther")}</option>
                </select>
              </label>
              {field("slug", t("mde.wordSlug"), { placeholder: "grace" })}
            </div>
          ) : linking === "versiculo" ? (
            <>
              <div className="mde-row">
                {field("chapter", t("mde.chapter"), { inputMode: "numeric" })}
                {field("verse", t("mde.verse"), { inputMode: "numeric" })}
                {field("book", t("mde.otherBook"), { placeholder: t("mde.otherBookHint"), maxLength: 3 })}
              </div>
              {field("label", t("mde.linkText"), { placeholder: fields.chapter && fields.verse ? `${fields.chapter}:${fields.verse}` : "" })}
            </>
          ) : (
            <>
              {field("url", t("mde.url"), { inputMode: "url", placeholder: "https://" })}
              {field("label", t("mde.linkText"))}
            </>
          )}
          <div className="mde-row">
            <Button type="button" size="sm" onClick={addLink}>
              {t("mde.insert")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setLinking(null)}>
              {t("af.cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      {source ? (
        <>
          {!safe ? <p className="af-hint">{t("mde.sourceOnly")}</p> : null}
          <textarea id={id} className="scripture-editor__input" rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        </>
      ) : (
        <div
          id={id}
          ref={box}
          className="mde-box scripture-editor__help-md"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          data-placeholder={placeholder}
          data-empty={value.trim() ? undefined : "true"}
          data-shaped={!value.trim() && emptyAs && emptyAs.t !== "p" ? (emptyAs.t === "ul" || emptyAs.t === "ol" ? "item" : emptyAs.t) : undefined}
          onInput={emit}
          onBlur={() => {
            keepSelection();
            emit();
            // Emptied by hand, the box may have lost its shape: it gets it back for the next thing written in it.
            if (box.current && !value.trim() && !serializeMarkdown(blocksOf(box.current)) && emptyAs) box.current.innerHTML = shapeHtml(emptyAs, names);
          }}
          onKeyUp={keepSelection}
          onMouseUp={keepSelection}
          onPaste={(e) => {
            // What is pasted comes in as plain text: the formatting of another page is not markdown of ours.
            e.preventDefault();
            document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
          }}
        />
      )}
    </div>
  );
}
