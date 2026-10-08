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
  /**
   * A list keeps how it was written (the spaces after its mark, the number it starts at): the articles of the
   * Academy and of the words write `*  item`, and number a list across blank lines (`1.` … `2.` … `3.`). Without
   * this the text did not come back the same, and every such article was shown as its source.
   */
  | { t: "ul"; marker: string; gap?: string; tight?: boolean; items: Inline[][] }
  | { t: "ol"; start?: number; gap?: string; tight?: boolean; items: Inline[][] }
  /** `tight`: written right under what comes before it, with no blank line between (the articles often do). */
  /** `depth`: a quote inside a quote (`>>`), as the articles write an alternative under an example. `bare`: `>text`, with no space. */
  | { t: "quote"; tight?: boolean; depth?: number; bare?: boolean; c: Inline[] };

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
    const bullet = /^([*-])([ \t]+)(.*)$/.exec(line);
    const numbered = /^(\d+)\.([ \t]+)(.*)$/.exec(line);
    const quote = /^(>+)( ?)(.*)$/.exec(line);
    if (!line.trim()) flush();
    else if (heading) {
      flush();
      blocks.push({ t: "h", level: heading[1]!.length, c: parseInline(heading[2]!) });
    } else if (bullet || numbered) {
      flush();
      const last = blocks[blocks.length - 1];
      const item = parseInline((bullet ? bullet[3] : numbered![3]) ?? "");
      const gap = (bullet ? bullet[2] : numbered![2])!;
      const spaced = gap === " " ? {} : { gap };
      // A list goes on while its lines follow one another; a blank line ends it.
      const joins = i > 0 && lines[i - 1]!.trim() !== "";
      const number = numbered ? Number(numbered[1]) : 0;
      if (bullet && joins && last?.t === "ul" && last.marker === bullet[1] && (last.gap ?? " ") === gap) last.items.push(item);
      else if (numbered && joins && last?.t === "ol" && (last.gap ?? " ") === gap && number === (last.start ?? 1) + last.items.length) last.items.push(item);
      else {
        const tight = joins && blocks.length ? { tight: true } : {};
        blocks.push(bullet ? { t: "ul", marker: bullet[1]!, ...spaced, ...tight, items: [item] } : { t: "ol", ...(number === 1 ? {} : { start: number }), ...spaced, ...tight, items: [item] });
      }
    } else if (quote) {
      flush();
      const last = blocks[blocks.length - 1];
      const depth = quote[1]!.length;
      const text = quote[3]!;
      const bare = Boolean(text) && !quote[2];
      // An empty line of a quote (`>`) belongs to the quote it is in, however that one is written.
      const same = last?.t === "quote" && (last.depth ?? 1) === depth && (!text || Boolean(last.bare) === bare);
      if (same && last?.t === "quote" && i > 0 && lines[i - 1]!.trim() !== "") last.c.push({ t: "br" }, ...parseInline(text));
      else blocks.push({ t: "quote", ...(i > 0 && lines[i - 1]!.trim() !== "" && blocks.length ? { tight: true } : {}), ...(depth > 1 ? { depth } : {}), ...(bare ? { bare } : {}), c: parseInline(text) });
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
    .map((block, index) => {
      const lead = index === 0 ? "" : (block.t === "ul" || block.t === "ol" || block.t === "quote") && block.tight ? "\n" : "\n\n";
      return lead + blockText(block);
    })
    .join("");
}

function blockText(block: Block): string {
  return [block]
    .map((block) => {
      if (block.t === "h") return `${"#".repeat(block.level)} ${serializeInline(block.c)}`;
      if (block.t === "ul") return block.items.map((item) => `${block.marker}${block.gap ?? " "}${serializeInline(item)}`).join("\n");
      if (block.t === "ol") return block.items.map((item, index) => `${index + (block.start ?? 1)}.${block.gap ?? " "}${serializeInline(item)}`).join("\n");
      // An empty line of a quote is `>` alone: a space after it would be a change.
      if (block.t === "quote") {
        const mark = ">".repeat(block.depth ?? 1);
        return serializeInline(block.c).split("\n").map((line) => (line ? `${mark}${block.bare ? "" : " "}${line}` : mark)).join("\n");
      }
      return serializeInline(block.c);
    })
    .join("");
}

/** Does this text come back the same after being read into the tree? If not, it must not be edited through it. */
export function roundTrips(md: string): boolean {
  return serializeMarkdown(parseMarkdown(md)) === clean(md);
}

// ---------------------------------------------------------------- an article on the lines its file has

type FileLine = { body: string; end: string };
/** A stretch of an article: a line that says something, or the empty lines between two of them. */
type Stretch = { key: string; lines: FileLine[] };

const GAP = "\u0000";

function stretches(lines: FileLine[]): Stretch[] {
  const out: Stretch[] = [];
  for (const line of lines) {
    const key = line.body.replace(/\s+$/, "");
    const last = out[out.length - 1];
    if (!key && last?.key === GAP) last.lines.push(line);
    else out.push({ key: key || GAP, lines: [line] });
  }
  return out;
}

/**
 * An article as it is to be saved: what was edited, on the lines the file had. The tree gives a text back without
 * what does not change what it says (`normalizeMarkdown`), and that was what got saved: an article with one word
 * corrected lost the line end at its end (102 of the 178 the team has published of the Academy would), the spaces
 * at the ends of its lines and the empty lines it had more than one of. A line that says what it said is written
 * as the file has it, with its own line end; so are the empty lines between two blocks that are both still there,
 * and what the file has before its first line and after its last.
 *
 * An article the team does not have yet ends with a line end, as the ones it is translated from do.
 */
export function articleAsWritten(original: string, edited: string): string {
  const typed = edited.replace(/\r\n/g, "\n").replace(/^\n+/, "").replace(/\s+$/, "");
  if (!typed) return edited;
  if (!original.trim()) return `${typed}\n`;
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const file: FileLine[] = original.split(/(?<=\n)/).map((chunk) => {
    const end = /\r?\n$/.exec(chunk)?.[0] ?? "";
    return { body: chunk.slice(0, chunk.length - end.length), end };
  });
  const had = stretches(file);
  const lead = had[0]?.key === GAP ? had.shift()!.lines : [];
  const tail = had[had.length - 1]?.key === GAP ? had.pop()!.lines : [];
  const now = stretches(typed.split("\n").map((body) => ({ body, end: eol })));
  // The longest run of stretches both have, in order: those are the ones that stay as the file has them.
  const common = Array.from({ length: had.length + 1 }, () => new Uint16Array(now.length + 1));
  for (let i = had.length - 1; i >= 0; i--) {
    for (let j = now.length - 1; j >= 0; j--) common[i]![j] = had[i]!.key === now[j]!.key ? common[i + 1]![j + 1]! + 1 : Math.max(common[i + 1]![j]!, common[i]![j + 1]!);
  }
  const out: FileLine[] = [...lead];
  let i = 0;
  let j = 0;
  while (j < now.length) {
    const mine = now[j]!;
    const theirs = had[i];
    if (theirs && theirs.key === mine.key) {
      // Spaces somebody typed at the end of a line (in the source of the article) are theirs to keep; and so is a
      // number of empty lines that is neither the one the tree writes nor the one the file had.
      const typedOwn = mine.key === GAP ? mine.lines.length !== 1 && mine.lines.length !== theirs.lines.length : mine.lines[0]!.body !== mine.key;
      out.push(...(typedOwn ? mine.lines : theirs.lines));
      i++;
      j++;
    } else if (theirs && common[i + 1]![j]! >= common[i]![j + 1]!) i++;
    else {
      out.push(...mine.lines);
      j++;
    }
  }
  out.push(...tail);
  const last = file[file.length - 1]?.end ?? "";
  return out.map((line, index) => line.body + (index === out.length - 1 ? last : line.end || eol)).join("");
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
