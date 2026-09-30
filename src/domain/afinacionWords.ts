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
    const group = byKey.get(key) ?? { text: mark.selectedText!.text.trim(), uses: [] };
    group.uses.push(use);
    byKey.set(key, group);
  }
  const renderings = [...byKey.values()].sort((a, b) => b.uses.length - a.uses.length);
  const wanted = params.preferred?.trim() ? renderingKey(params.preferred) : "";
  const differing = wanted ? renderings.filter((r) => renderingKey(r.text) !== wanted).flatMap((r) => r.uses) : [];
  return { renderings, unmarked, consistent: renderings.length <= 1, differing };
}
