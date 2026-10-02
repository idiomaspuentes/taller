/**
 * The markdown of the helps (translation notes, articles of the Academy and of the words) as a small tree, so that
 * it can be edited as it looks and written back as it was. Only what those texts use is understood: paragraphs,
 * headings, lists, quotes, bold, italics, links, and the links of the resources (`[[rc://…]]`). A text that uses
 * anything else does not come back the same from the tree: `roundTrips` says so, and the editor then leaves it as
 * its source instead of rewriting it.
 * Pure: `MarkdownEditor` turns the tree into what is edited and back.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "b"; c: Inline[] }
  | { t: "i"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] }
  /** A link to a resource as the helps write it: `[[rc://*​/ta/man/translate/figs-metaphor]]`. Kept as it is. */
  | { t: "rc"; href: string }
  | { t: "br" };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: number; c: Inline[] }
  | { t: "ul"; marker: string; items: Inline[][] }
  | { t: "ol"; items: Inline[][] }
  | { t: "quote"; c: Inline[] };

const INLINE = /\[\[(rc:\/\/[^\]\s]+)\]\]|\[([^\]\n]*)\]\(([^)\s]+)\)|\*\*([^*\n](?:[^\n]*?[^*\n])?)\*\*|\*([^*\s\n](?:[^*\n]*?[^*\s\n])?)\*/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push({ t: "text", v: rest });
      break;
    }
    if (m.index > 0) out.push({ t: "text", v: rest.slice(0, m.index) });
    if (m[1] !== undefined) out.push({ t: "rc", href: m[1] });
    else if (m[3] !== undefined) out.push({ t: "link", href: m[3], c: parseInline(m[2] ?? "") });
    else if (m[4] !== undefined) out.push({ t: "b", c: parseInline(m[4]) });
    else out.push({ t: "i", c: parseInline(m[5] ?? "") });
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

/** Lines of one paragraph: a single line break inside it is kept as a break. */
function inlineOfLines(lines: string[]): Inline[] {
  return lines.flatMap((line, index) => [...(index ? [{ t: "br" } as Inline] : []), ...parseInline(line)]);
}

/** A text without what does not change what it says: line endings, spaces at the end of a line, extra blank lines. */
export const normalizeMarkdown = (md: string) => clean(md);

function clean(md: string) { return cleanOf(md); }
const cleanOf = (md: string) => md.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = clean(md).split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ t: "p", c: inlineOfLines(para) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^([*-])\s+(.*)$/.exec(line);
    const numbered = /^\d+\.\s+(.*)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);
    if (!line.trim()) flush();
    else if (heading) {
      flush();
      blocks.push({ t: "h", level: heading[1]!.length, c: parseInline(heading[2]!) });
    } else if (bullet || numbered) {
      flush();
      const last = blocks[blocks.length - 1];
      const item = parseInline((bullet ? bullet[2] : numbered![1]) ?? "");
      // A list goes on while its lines follow one another; a blank line ends it.
      const joins = i > 0 && lines[i - 1]!.trim() !== "";
      if (bullet && joins && last?.t === "ul" && last.marker === bullet[1]) last.items.push(item);
      else if (numbered && joins && last?.t === "ol") last.items.push(item);
      else blocks.push(bullet ? { t: "ul", marker: bullet[1]!, items: [item] } : { t: "ol", items: [item] });
    } else if (quote) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.t === "quote" && i > 0 && lines[i - 1]!.trim() !== "") last.c.push({ t: "br" }, ...parseInline(quote[1]!));
      else blocks.push({ t: "quote", c: parseInline(quote[1]!) });
    } else para.push(line);
  }
  flush();
  return blocks;
}

export function serializeInline(nodes: Inline[]): string {
  return nodes
    .map((node) =>
      node.t === "text" ? node.v : node.t === "br" ? "\n" : node.t === "rc" ? `[[${node.href}]]` : node.t === "b" ? `**${serializeInline(node.c)}**` : node.t === "i" ? `*${serializeInline(node.c)}*` : `[${serializeInline(node.c)}](${node.href})`,
    )
    .join("");
}

export function serializeMarkdown(blocks: Block[]): string {
  return blocks
    .map((block) => {
      if (block.t === "h") return `${"#".repeat(block.level)} ${serializeInline(block.c)}`;
      if (block.t === "ul") return block.items.map((item) => `${block.marker} ${serializeInline(item)}`).join("\n");
      if (block.t === "ol") return block.items.map((item, index) => `${index + 1}. ${serializeInline(item)}`).join("\n");
      if (block.t === "quote") return serializeInline(block.c).split("\n").map((line) => `> ${line}`).join("\n");
      return serializeInline(block.c);
    })
    .join("\n\n");
}

/** Does this text come back the same after being read into the tree? If not, it must not be edited through it. */
export function roundTrips(md: string): boolean {
  return serializeMarkdown(parseMarkdown(md)) === clean(md);
}

/**
 * A note in a table file keeps its line breaks written out (`\n` as two characters, and `<br>`): they are turned
 * into real ones to edit it, and written out again to save it.
 */
export function noteFromTsv(text: string): string {
  return text.replace(/\\n/g, "\n").replace(/<br\s*\/?>/gi, "\n");
}
export function noteToTsv(md: string): string {
  return md.replace(/\r\n/g, "\n").trim().replace(/\n/g, "\\n");
}

// ---------------------------------------------------------------- the links of the resources

/** `[[rc://*​/ta/man/translate/figs-metaphor]]`: an article of the Academy. */
export function academyLink(slug: string, manual = "translate"): string {
  return `[[rc://*/ta/man/${manual}/${slug.trim().toLowerCase()}]]`;
}

/** `[[rc://*​/tw/dict/bible/kt/grace]]`: an article of the words. */
export function wordLink(kind: string, slug: string): string {
  return `[[rc://*/tw/dict/bible/${kind.trim().toLowerCase()}/${slug.trim().toLowerCase()}]]`;
}

/**
 * A link to a verse as the notes write it: `[2:3](../02/03.md)` inside the same book, `[Tito 1:5](../../tit/01/05.md)`
 * to another. Psalms number their chapters and verses with three digits.
 */
export function referenceLink(params: { chapter: number; verse: number; label?: string; book?: string; inBook?: string }): string {
  const book = (params.book ?? "").trim().toLowerCase();
  const wide = (book || (params.inBook ?? "").trim().toLowerCase()) === "psa" ? 3 : 2;
  const pad = (n: number) => String(n).padStart(wide, "0");
  const label = params.label?.trim() || `${params.chapter}:${params.verse}`;
  return `[${label}](${book ? `../../${book}/` : "../"}${pad(params.chapter)}/${pad(params.verse)}.md)`;
}

/** What a resource link points at, to name it where it is shown. */
export function describeRc(href: string): { kind: "academia" | "palabra" | "otro"; slug: string } {
  const ta = /\/ta\/man\/[^/]+\/([^/?#]+)/.exec(href);
  if (ta) return { kind: "academia", slug: ta[1]!.toLowerCase() };
  const tw = /\/tw\/dict\/bible\/[^/]+\/([^/?#]+)/.exec(href);
  if (tw) return { kind: "palabra", slug: tw[1]!.toLowerCase() };
  return { kind: "otro", slug: href.replace(/^rc:\/\/[^/]*\//, "") };
}
