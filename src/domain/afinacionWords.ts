import { isIntroRef, parseVerseRef } from "../prep/inventory";
import type { NoteItem } from "./afinacionNotes";
import { normalizeHelpsText } from "./helpQuoteMatch";
import { textFingerprint, type ReviewDecision } from "./reviewRound";

/**
 * The «Revisar palabras clave» step of a Afinación: one item per use of a key
 * term in the chapter (from the words-links list of the source package). What
 * the step adds to the notes is the comparison: how the same term was rendered
 * in every other place of the book, so a reviewer can see if it is consistent.
 */

export type TermKind = "kt" | "other" | "names";

const KIND_LABEL: Record<TermKind, string> = {
  kt: "Términos clave",
  other: "Otros términos",
  names: "Nombres",
};

/** `rc://*​/tw/dict/bible/kt/god` → `{ kind: "kt", slug: "god" }`. */
export function termFromLink(link: string): { kind: TermKind; slug: string } | null {
  const m = /\/bible\/(kt|other|names)\/([^/?#\s]+)/.exec(link.trim());
  return m ? { kind: m[1] as TermKind, slug: m[2]!.toLowerCase() } : null;
}

/** The name of a term: the title of its article when it was read, otherwise the slug spelled out. */
export function termLabel(slug: string, titles?: Record<string, string>): string {
  const title = titles?.[slug]?.trim();
  if (title) return title;
  const words = slug.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Where the article of a term lives in the words repository. */
export function termArticlePath(kind: TermKind, slug: string): string {
  return `bible/${kind}/${slug}.md`;
}

/** Title of a words article: its first heading. */
export function parseArticleTitle(markdown: string): string | null {
  const m = /^#{1}[ 	]+(.+?)[ 	#]*$/m.exec(markdown.replace(/^﻿/, ""));
  return m ? m[1]!.trim() || null : null;
}

/** A words article without its first heading, for where its title is already said just above it. */
export function articleBody(markdown: string): string {
  return markdown.replace(/^\uFEFF/, "").replace(/^\s*#[ \t]+.*(\r?\n)+/, "");
}

/** The translation the team chose for each term, by slug. */
export type PreferredTerm = { text: string; by: string; at: string };
export type PreferredTerms = Record<string, PreferredTerm>;

export function parsePreferredTerms(text: string): PreferredTerms {
  try {
    const raw = JSON.parse(text) as { terms?: Record<string, Partial<PreferredTerm>> };
    const out: PreferredTerms = {};
    for (const [slug, row] of Object.entries(raw?.terms ?? {})) {
      const value = typeof row?.text === "string" ? row.text.trim() : "";
      if (value) out[slug] = { text: value, by: String(row?.by ?? ""), at: String(row?.at ?? "") };
    }
    return out;
  } catch {
    return {};
  }
}

export function serializePreferredTerms(terms: PreferredTerms): string {
  return `${JSON.stringify({ terms }, null, 2)}
`;
}

/** Choose the preferred translation of a term; an empty text clears it. */
export function withPreferredTerm(terms: PreferredTerms, slug: string, text: string, by: string, at: string): PreferredTerms {
  const next = { ...terms };
  const value = text.trim();
  if (value) next[slug] = { text: value, by, at };
  else delete next[slug];
  return next;
}

export type TermItem = NoteItem & { termSlug: string; termKind: TermKind };

/** One item per use of a term. `chapter` keeps only that chapter; omit it to read the whole book. */
export function parseTermRows(rows: Record<string, string>[], chapter?: number): TermItem[] {
  const items: TermItem[] = [];
  for (const row of rows) {
    const reference = (row.Reference ?? row.reference ?? "").trim();
    if (!reference || isIntroRef(reference)) continue;
    const parsed = parseVerseRef(reference);
    if (!parsed || (chapter !== undefined && parsed.chapter !== chapter)) continue;
    const id = (row.ID ?? row.Id ?? row.id ?? "").trim();
    const term = termFromLink(row.TWLink ?? row.twlink ?? row.TWLINK ?? "");
    if (!id || !term) continue;
    items.push({
      // Notes and words share one decisions file per person: a prefix keeps their ids apart.
      id: `w:${id}`,
      chapter: parsed.chapter,
      verse: parsed.verses[0]!,
      verseTo: parsed.verses[parsed.verses.length - 1]!,
      category: term.kind,
      categoryLabel: KIND_LABEL[term.kind],
      supportRef: (row.TWLink ?? "").trim(),
      quote: (row.OrigWords ?? row.origwords ?? "").trim(),
      occurrence: Math.max(1, parseInt(row.Occurrence ?? row.occurrence ?? "1", 10) || 1),
      note: "",
      phraseTokens: [],
      termSlug: term.slug,
      termKind: term.kind,
    });
  }
  return items;
}

export type TermGroup = { slug: string; label: string; kind: TermKind; uses: TermItem[] };

/** Terms in order of first use; each keeps its uses in book order. */
export function groupByTerm(items: TermItem[]): TermGroup[] {
  const groups = new Map<string, TermGroup>();
  for (const item of [...items].sort((a, b) => a.chapter - b.chapter || a.verse - b.verse || a.id.localeCompare(b.id))) {
    const group = groups.get(item.termSlug) ?? { slug: item.termSlug, label: termLabel(item.termSlug), kind: item.termKind, uses: [] };
    group.uses.push(item);
    groups.set(item.termSlug, group);
  }
  return [...groups.values()];
}

export type Rendering = {
  /** How the term reads in the draft, as marked by reviewers. */
  text: string;
  uses: TermItem[];
};

export type TermComparison = {
  renderings: Rendering[];
  /** Uses nobody has marked yet (or whose verse changed after the mark). */
  unmarked: TermItem[];
  /** True when every marked use reads the same. */
  consistent: boolean;
  /** Marked uses that do not read like the preferred translation (empty when none is chosen). */
  differing: TermItem[];
};

/** The words as they are said: a mark at either end is not part of them («entienden;» is «entienden»). */
function withoutEdgeMarks(text: string): string {
  return text.replace(/^[\s.,;:!?¡¿«»“”"'()]+|[\s.,;:!?¡¿«»“”"'()]+$/g, "");
}

function renderingKey(text: string): string {
  return normalizeHelpsText(text).toLocaleLowerCase("es");
}

/**
 * How a term was rendered across the book, from what reviewers marked.
 * The newest mark of a use counts; a mark made on a verse that has changed
 * since no longer applies (the answer carries the fingerprint of the text).
 */
export function compareTermRenderings(params: {
  uses: TermItem[];
  decisions: ReviewDecision[];
  /** Plain draft text of a verse, `"c:v"`. */
  verseText: (chapter: number, verse: number) => string;
  /** The translation the team chose for this term, if any. */
  preferred?: string;
}): TermComparison {
  const latestMark = new Map<string, ReviewDecision>();
  for (const d of params.decisions) {
    if (!d.selectedText?.text.trim()) continue;
    const prev = latestMark.get(d.itemId);
    if (!prev || Date.parse(d.timestamp) >= Date.parse(prev.timestamp)) latestMark.set(d.itemId, d);
  }
  const byKey = new Map<string, Rendering>();
  const unmarked: TermItem[] = [];
  for (const use of params.uses) {
    const mark = latestMark.get(use.id);
    const current = params.verseText(use.chapter, use.verse);
    const fresh = mark && (mark.textHash === undefined || mark.textHash === textFingerprint(current));
    if (!mark || !fresh) {
      unmarked.push(use);
      continue;
    }
    const key = renderingKey(mark.selectedText!.text);
    const group = byKey.get(key) ?? { text: withoutEdgeMarks(mark.selectedText!.text), uses: [] };
    group.uses.push(use);
    byKey.set(key, group);
  }
  const renderings = [...byKey.values()].sort((a, b) => b.uses.length - a.uses.length);
  const wanted = params.preferred?.trim() ? renderingKey(params.preferred) : "";
  const differing = wanted ? renderings.filter((r) => renderingKey(r.text) !== wanted).flatMap((r) => r.uses) : [];
  return { renderings, unmarked, consistent: renderings.length <= 1, differing };
}

export type TermOrder = "term" | "text";

/**
 * The uses of the key terms in the order they are gone through.
 *
 * `text`: as they come in the passage. `term`: every use of one term one after the other (the terms in the order
 * they first appear, each one's uses in the order of the text), which is what checking a term for consistency
 * needs: decide it once, and see at once where it was said otherwise.
 */
export function orderTermUses<T extends TermItem>(uses: T[], order: TermOrder): T[] {
  const inText = [...uses].sort((a, b) => a.chapter - b.chapter || a.verse - b.verse || (a.phraseTokens[0] ?? 9999) - (b.phraseTokens[0] ?? 9999) || a.id.localeCompare(b.id));
  if (order === "text") return inText;
  const first = new Map<string, number>();
  inText.forEach((use, index) => {
    if (!first.has(use.termSlug)) first.set(use.termSlug, index);
  });
  return inText
    .map((use, index) => ({ use, index }))
    .sort((a, b) => first.get(a.use.termSlug)! - first.get(b.use.termSlug)! || a.index - b.index)
    .map((row) => row.use);
}

/** The first of these items the person has not answered on the text as it is now; -1 when none is left. */
export function firstUnanswered(params: { items: { id: string }[]; decisions: ReviewDecision[]; me: string; hashOf: (id: string) => string; from?: number }): number {
  const me = params.me.trim().toLowerCase();
  const mine = new Set(
    params.decisions
      .filter((d) => d.reviewer.trim().toLowerCase() === me && (d.textHash === undefined || d.textHash === params.hashOf(d.itemId)))
      .map((d) => d.itemId),
  );
  for (let i = params.from ?? 0; i < params.items.length; i++) if (!mine.has(params.items[i]!.id)) return i;
  return -1;
}

/**
 * The other uses of a term, among those in hand, that somebody already marked with the same words and this person
 * has not answered: they can be agreed with in one go, so that the person stops only where the term reads
 * otherwise. Each comes with the words that were marked there, to answer about those and no others.
 */
export function sameRenderingUses(params: {
  use: TermItem;
  /** The uses in hand (the chapter or the stretch of it that arrived): never beyond them. */
  uses: TermItem[];
  rendering: string;
  decisions: ReviewDecision[];
  me: string;
  verseText: (chapter: number, verse: number) => string;
}): { use: TermItem; selectedText: NonNullable<ReviewDecision["selectedText"]> }[] {
  const wanted = renderingKey(params.rendering);
  if (!wanted) return [];
  const me = params.me.trim().toLowerCase();
  const out: { use: TermItem; selectedText: NonNullable<ReviewDecision["selectedText"]> }[] = [];
  for (const use of params.uses) {
    if (use.id === params.use.id || use.termSlug !== params.use.termSlug) continue;
    const hash = textFingerprint(params.verseText(use.chapter, use.verse));
    const fresh = params.decisions.filter((d) => d.itemId === use.id && (d.textHash === undefined || d.textHash === hash));
    if (fresh.some((d) => d.reviewer.trim().toLowerCase() === me)) continue;
    // Somebody objected or proposed a change there: that one is looked at, not agreed with in passing.
    if (fresh.some((d) => d.status !== "approved")) continue;
    const mark = fresh.filter((d) => d.selectedText?.text.trim()).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
    if (!mark || renderingKey(mark.selectedText!.text) !== wanted) continue;
    out.push({ use, selectedText: mark.selectedText! });
  }
  return out;
}
