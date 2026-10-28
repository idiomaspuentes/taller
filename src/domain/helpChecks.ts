import type { WritingCheck } from "../config/types";
import type { MessageKey } from "../i18n/messages";
import { BOOKS, bookLabel, usfmStudyBookId } from "./books";

/**
 * What Taller finds by itself in a proposed note or Words article. Mechanical slips (a link to a book that does not
 * exist, a doubled space) can be fixed with one tap; they only change the form of the text, never what it says.
 * Quote characters are never reported: they are adjusted when the text is published.
 */
export type HelpKind = "notas" | "palabras";

export type HelpCheck = {
  /** A mechanical check's id, or the id of a rule of the process package. */
  id: string;
  /** "auto": «Arreglar» fixes it. */
  fix: "auto" | "none";
  /** The piece of the text that is shown. */
  excerpt: string;
  /** Mechanical checks: an hc.* key. Rules: the package's text in the language asked for. */
  message: { key: MessageKey; params?: Record<string, string> } | { text: string };
  /** Only rules: why the team writes it so. */
  why?: string;
  start: number;
  end: number;
  /** Only for fix "auto". */
  replacement?: string;
};

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** The book a link's label names («2 Crónicas 3:14» → 2CH), in Spanish or Portuguese. */
function bookOfLabel(label: string): string | null {
  const name = fold(label.replace(/\s*\d+\s*[:.]\s*\d+.*$/, "").replace(/\s+\d+\s*$/, ""));
  if (!name) return null;
  const book = BOOKS.find((b) => fold(b.name) === name || fold(bookLabel(b.code, "pt")) === name);
  return book?.code ?? null;
}

/** A few words around a place in the text, to show where the check is. */
function excerptAt(text: string, start: number, end: number): string {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const lineEndAt = text.indexOf("\n", end);
  const lineEnd = lineEndAt < 0 ? text.length : lineEndAt;
  let from = Math.max(lineStart, start - 24);
  let to = Math.min(lineEnd, end + 24);
  // Cut at word boundaries so the piece reads as words.
  if (from > lineStart) from = text.indexOf(" ", from) + 1 || from;
  if (to < lineEnd) to = Math.max(end, text.lastIndexOf(" ", to));
  return `${from > lineStart ? "…" : ""}${text.slice(from, to)}${to < lineEnd ? "…" : ""}`;
}

/** Lines of a text with where each one starts. */
function linesOf(text: string): { line: string; at: number }[] {
  const out: { line: string; at: number }[] = [];
  let at = 0;
  for (const line of text.split("\n")) {
    out.push({ line, at });
    at += line.length + 1;
  }
  return out;
}

const BULLET = /^(\s*(?:[*-]|\d+\.)\s+)/;

function badLinks(text: string, out: HelpCheck[]) {
  // rc://*/tn/help/<book>/<chapter>/<verse>, the way the notes link a verse.
  for (const m of text.matchAll(/\[([^\]]*)\]\((rc:\/\/[^/)]*\/tn\/help\/)([^/)]+)\/(\d+)\/(\d+)\)/g)) {
    const [whole, label, prefix, code, chapter, verse] = m as unknown as string[];
    if (usfmStudyBookId(code!)) continue;
    const start = m.index! + 1 + label!.length + 2;
    const end = m.index! + whole!.length - 1;
    const book = bookOfLabel(label!);
    const wide = book === "PSA" ? 3 : 2;
    const pad = (n: string) => String(Number(n)).padStart(wide, "0");
    out.push({
      id: "bad-link",
      fix: book ? "auto" : "none",
      excerpt: whole!,
      message: { key: "hc.badLink", params: { code: code! } },
      start,
      end,
      ...(book ? { replacement: `${prefix}${book.toLowerCase()}/${pad(chapter!)}/${pad(verse!)}` } : {}),
    });
  }
  // ../../<book>/<chapter>/<verse>.md, the same link written as a path.
  for (const m of text.matchAll(/\[([^\]]*)\]\(\.\.\/\.\.\/([^/)]+)\/(\d+\/\d+\.md)\)/g)) {
    const [whole, label, code, rest] = m as unknown as string[];
    if (usfmStudyBookId(code!)) continue;
    const start = m.index! + 1 + label!.length + 2;
    const book = bookOfLabel(label!);
    out.push({
      id: "bad-link",
      fix: book ? "auto" : "none",
      excerpt: whole!,
      message: { key: "hc.badLink", params: { code: code! } },
      start,
      end: m.index! + whole!.length - 1,
      ...(book ? { replacement: `../../${book.toLowerCase()}/${rest}` } : {}),
    });
  }
}

function lineChecks(text: string, before: string | undefined, out: HelpCheck[]) {
  const headings = new Map<string, string>();
  for (const { line } of linesOf(before ?? "")) {
    const h = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (h) headings.set(fold(h[2]!), `${h[1]} ${h[2]}`);
  }
  for (const { line, at } of linesOf(text)) {
    const bullet = BULLET.exec(line);
    // A doubled space inside the text; the indentation and the space after a bullet are layout, not a slip.
    const bodyAt = bullet ? bullet[1]!.length : (/^\s*/.exec(line)?.[0].length ?? 0);
    // Before a comma or a stop the spaces are one slip, «space-before», which takes them all.
    for (const m of line.slice(bodyAt).matchAll(/(?<=\S) {2,}(?=[^\s,.;:!?])/g)) {
      const start = at + bodyAt + m.index!;
      const end = start + m[0].length;
      out.push({ id: "double-space", fix: "auto", excerpt: excerptAt(text, start, end), message: { key: "hc.doubleSpace" }, start, end, replacement: " " });
    }
    // A space before a comma or a stop (an ellipsis is left alone).
    for (const m of line.matchAll(/(?<=\S) +(?=[,.;:!?](?!\.))/g)) {
      const start = at + m.index!;
      const end = start + m[0].length;
      out.push({ id: "space-before", fix: "auto", excerpt: excerptAt(text, start, end + 1), message: { key: "hc.spaceBefore" }, start, end, replacement: "" });
    }
    // A list line that ends in a comma.
    if (/^\s*[*-]\s/.test(line) && /,\s*$/.test(line)) {
      const start = at + line.lastIndexOf(",");
      out.push({ id: "list-comma", fix: "auto", excerpt: excerptAt(text, start, start + 1), message: { key: "hc.listComma" }, start, end: start + 1, replacement: "." });
    }
    // A heading of the text before that lost its marks.
    const heading = !line.trimStart().startsWith("#") ? headings.get(fold(line)) : undefined;
    if (heading && line.trim()) {
      out.push({ id: "bare-heading", fix: "auto", excerpt: line.trim(), message: { key: "hc.bareHeading" }, start: at, end: at + line.length, replacement: heading });
    }
    // A bullet with no space after it. An opening italic (`*la palabra* significa`) has its closing star.
    const star = /^(\s*)\*(?=[^\s*])/.exec(line);
    if (star && (line.replace(/\*\*/g, "").match(/\*/g)?.length ?? 0) % 2 === 1) {
      const start = at + star[1]!.length + 1;
      out.push({ id: "bullet-space", fix: "auto", excerpt: excerptAt(text, start - 1, start + 1), message: { key: "hc.bulletSpace" }, start, end: start, replacement: " " });
    }
  }
}

/** The mechanical slips of a proposed text. `before` is the text it changes, to know its headings. */
export function mechanicalChecks(text: string, opts: { kind: HelpKind; before?: string }): HelpCheck[] {
  const out: HelpCheck[] = [];
  badLinks(text, out);
  lineChecks(text, opts.before, out);
  return out.sort((a, b) => a.start - b.start);
}

/** The sentence around a place: the text between stops or line breaks. */
function sentenceAt(text: string, start: number, end: number): string {
  let from = start;
  while (from > 0 && !/[.?!\n]/.test(text[from - 1]!)) from--;
  let to = end;
  while (to < text.length && !/[.?!\n]/.test(text[to]!)) to++;
  return text.slice(from, to);
}

/** Where the team's writing rules apply in a proposed text. They are never fixed for the person. */
export function ruleChecks(text: string, kind: HelpKind, rules: WritingCheck[], lang: string): HelpCheck[] {
  const out: HelpCheck[] = [];
  for (const rule of rules) {
    if (!rule.resources.includes(kind)) continue;
    let pattern: RegExp;
    let near: RegExp | null;
    let scope = text;
    try {
      pattern = new RegExp(rule.pattern, "gu");
      near = rule.near ? new RegExp(rule.near, "u") : null;
      if (rule.until) {
        const until = new RegExp(rule.until, "u");
        const stop = linesOf(text).find(({ line }) => until.test(line));
        if (stop) scope = text.slice(0, stop.at);
      }
    } catch {
      continue; // The package check reports a broken expression; here it just does not apply.
    }
    for (const m of scope.matchAll(pattern)) {
      const start = m.index!;
      const end = start + m[0].length;
      if (end === start) continue;
      if (near && !near.test(sentenceAt(text, start, end))) continue;
      out.push({
        id: rule.id,
        fix: "none",
        excerpt: excerptAt(text, start, end),
        message: { text: rule.message[lang] ?? rule.message.es ?? Object.values(rule.message)[0] ?? "" },
        why: rule.why[lang] ?? rule.why.es ?? Object.values(rule.why)[0],
        start,
        end,
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The text with every automatic fix applied. When two fixes overlap, only the one further on is applied. */
export function applyFixes(text: string, checks: HelpCheck[]): string {
  const auto = checks.filter((c) => c.fix === "auto" && c.replacement !== undefined).sort((a, b) => b.start - a.start);
  let out = text;
  let floor = Infinity;
  for (const c of auto) {
    if (c.end > floor) continue;
    out = out.slice(0, c.start) + c.replacement + out.slice(c.end);
    floor = c.start;
  }
  return out;
}
