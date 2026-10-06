/**
 * Store-free TN/TWL quote matching, ported from
 * `@usfm-tools/editor-adapters` `helps/quote-matcher.ts` +
 * `helps/alignment-annotate.ts` (those modules pull editor-core / DocumentStore).
 */
import type { AlignmentGroup, AlignmentMap } from "@usfm-tools/types";

export function normalizeHelpsText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0591-\u05AF\u05BD]/g, "")
    .replace(/\u05BE/g, " ")
    .replace(/\u200B|\u200C|\u200D|\u2060|\uFEFF/g, "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu, "")
    .trim();
}

export function tokenizeVersePlainText(plain: string): string[] {
  const t = plain.trim();
  return t ? t.split(/\s+/).filter(Boolean) : [];
}

type TokenCharSpan = { tokenIndex: number; startInJoined: number; endInJoined: number };

function tokenJoinedSpans(tokens: string[]): { joined: string; spans: TokenCharSpan[] } {
  const normTokens = tokens.map((t) => normalizeHelpsText(t));
  const spans: TokenCharSpan[] = [];
  let offset = 0;
  for (let i = 0; i < normTokens.length; i++) {
    const raw = normTokens[i]!;
    const start = offset;
    const end = offset + raw.length;
    spans.push({ tokenIndex: i, startInJoined: start, endInJoined: end });
    offset = end;
    if (i < normTokens.length - 1) offset += 1;
  }
  return { joined: normTokens.join(" "), spans };
}

function findNthSubstringIndex(
  haystack: string,
  needle: string,
  occurrence: number,
  fromIndex = 0,
): { start: number; end: number } | null {
  const n = needle.length;
  if (!needle || occurrence < 1) return null;
  let pos = fromIndex;
  let seen = 0;
  while (pos <= haystack.length - n) {
    const idx = haystack.indexOf(needle, pos);
    if (idx < 0) return null;
    seen += 1;
    if (seen === occurrence) return { start: idx, end: idx + n };
    pos = idx + 1;
  }
  return null;
}

function tokenIndicesOverlappingRange(spans: TokenCharSpan[], start: number, end: number): number[] {
  const out: number[] = [];
  for (const s of spans) {
    if (s.endInJoined > start && s.startInJoined < end) out.push(s.tokenIndex);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Match a TN Quote / TWL OrigWords (+ occurrence, `&` segments) to verse tokens. */
export function matchHelpQuoteToTokenIndices(
  tokens: string[],
  origWordsOrQuote: string,
  occurrence: number,
): number[] {
  const quote = (origWordsOrQuote ?? "").trim();
  if (!quote || tokens.length === 0) return [];
  const { joined, spans } = tokenJoinedSpans(tokens);
  if (!joined) return [];
  const parts = quote
    .split("&")
    .map((p) => normalizeHelpsText(p))
    .filter(Boolean);
  if (parts.length === 0) return [];
  let searchFrom = 0;
  const allTokenIdx = new Set<number>();
  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi]!;
    const occ = pi === 0 ? Math.max(1, occurrence || 1) : 1;
    const hit = findNthSubstringIndex(joined, part, occ, searchFrom);
    if (!hit) return [];
    for (const ti of tokenIndicesOverlappingRange(spans, hit.start, hit.end)) allTokenIdx.add(ti);
    searchFrom = hit.end;
  }
  return [...allTokenIdx].sort((a, b) => a - b);
}

type FlatSource = { gIdx: number; contentNorm: string; occurrence: number };

function flattenSources(groups: AlignmentGroup[]): FlatSource[] {
  const out: FlatSource[] = [];
  for (let gIdx = 0; gIdx < groups.length; gIdx++) {
    for (const w of groups[gIdx]!.sources) {
      out.push({ gIdx, contentNorm: normalizeHelpsText(w.content), occurrence: w.occurrence });
    }
  }
  return out;
}

function verseHasAlignmentTargets(groups: AlignmentGroup[] | undefined): boolean {
  return Boolean(groups?.some((g) => g.targets.length > 0));
}

function buildGatewayTokenOccurrences(tokens: string[]): Array<{ norm: string; occurrence: number }> {
  const counts = new Map<string, number>();
  return tokens.map((t) => {
    const norm = normalizeHelpsText(t);
    const c = (counts.get(norm) ?? 0) + 1;
    counts.set(norm, c);
    return { norm, occurrence: c };
  });
}

function matchPhraseSubsequenceFrom(
  flat: FlatSource[],
  partWords: string[],
  startFlatIdx: number,
): number[] | null {
  if (partWords.length === 0) return [];
  let fp = Math.max(0, startFlatIdx);
  const matchedIdx: number[] = [];
  for (let pw = 0; pw < partWords.length; pw++) {
    const want = partWords[pw]!;
    while (fp < flat.length && flat[fp]!.contentNorm !== want) fp += 1;
    if (fp >= flat.length) return null;
    matchedIdx.push(fp);
    fp += 1;
  }
  return matchedIdx;
}

/**
 * Every place the words are found in order, each once. A search from a position looks ahead for the first word, so
 * every position before a match finds that same match: counted each time, the second occurrence of a quote was the
 * first one again, and a help about the second «de Dios» of a verse was marked on the first.
 */
function enumerateSubsequenceMatches(flat: FlatSource[], partWords: string[], minFlatIdx: number): number[][] {
  const hits: number[][] = [];
  const seen = new Set<string>();
  const lo = Math.max(0, minFlatIdx);
  for (let s = lo; s < flat.length; s++) {
    const m = matchPhraseSubsequenceFrom(flat, partWords, s);
    if (!m || seen.has(m.join(","))) continue;
    seen.add(m.join(","));
    hits.push(m);
  }
  return hits;
}

function matchPhraseMultisetFromStart(
  flat: FlatSource[],
  partWords: string[],
  startFlatIdx: number,
): number[] | null {
  if (partWords.length === 0) return [];
  const need = new Map<string, number>();
  for (const w of partWords) need.set(w, (need.get(w) ?? 0) + 1);
  const first = flat[startFlatIdx]!.contentNorm;
  if ((need.get(first) ?? 0) === 0) return null;
  need.set(first, need.get(first)! - 1);
  const matchedIdx: number[] = [startFlatIdx];
  let remaining = partWords.length - 1;
  for (let i = startFlatIdx + 1; i < flat.length && remaining > 0; i++) {
    const w = flat[i]!.contentNorm;
    const left = need.get(w) ?? 0;
    if (left > 0) {
      need.set(w, left - 1);
      matchedIdx.push(i);
      remaining -= 1;
    }
  }
  return remaining > 0 ? null : matchedIdx;
}

function enumerateMultisetMatches(flat: FlatSource[], partWords: string[], minFlatIdx: number): number[][] {
  const hits: number[][] = [];
  const lo = Math.max(0, minFlatIdx);
  for (let s = lo; s < flat.length; s++) {
    const m = matchPhraseMultisetFromStart(flat, partWords, s);
    if (m) hits.push(m);
  }
  return hits;
}

function mapTargetToTokenIndex(
  meta: Array<{ norm: string; occurrence: number }>,
  target: { word: string; occurrence: number },
): number {
  const norm = normalizeHelpsText(target.word);
  for (let i = 0; i < meta.length; i++) {
    if (meta[i]!.norm === norm && meta[i]!.occurrence === target.occurrence) return i;
  }
  return -1;
}

/** Hebrew/Greek catalog quote → gateway tokens via ULT/UST `zaln-s` groups. */
export function matchHelpEntryToTokenIndicesByAlignment(
  tokens: string[],
  quote: string,
  occurrence: number,
  groups: AlignmentGroup[],
): number[] {
  const raw = (quote ?? "").trim();
  if (!raw || tokens.length === 0 || !verseHasAlignmentTargets(groups)) return [];
  const rawParts = raw
    .split("&")
    .map((p) => normalizeHelpsText(p))
    .filter(Boolean);
  if (rawParts.length === 0) return [];
  const flat = flattenSources(groups);
  const meta = buildGatewayTokenOccurrences(tokens);
  const multiSegment = rawParts.length > 1;
  let minFlat = 0;
  const tokenIdx = new Set<number>();
  for (let pi = 0; pi < rawParts.length; pi++) {
    const partWords = rawParts[pi]!
      .split(/\s+/)
      .map((w) => normalizeHelpsText(w))
      .filter(Boolean);
    if (partWords.length === 0) return [];
    const occ = pi === 0 ? Math.max(1, occurrence || 1) : 1;
    const ordered = enumerateSubsequenceMatches(flat, partWords, multiSegment ? 0 : minFlat);
    const hits = ordered.length > 0 ? ordered : enumerateMultisetMatches(flat, partWords, multiSegment ? 0 : minFlat);
    if (hits.length < occ) return [];
    const matchedFlatIdxs = hits[occ - 1]!;
    if (!multiSegment) minFlat = Math.max(...matchedFlatIdxs) + 1;
    const primaryKeys = new Set<string>();
    for (const k of matchedFlatIdxs) {
      const f = flat[k]!;
      primaryKeys.add(`${f.contentNorm}\x00${f.occurrence}`);
    }
    const touchedGroups = new Set<number>();
    for (const f of flat) {
      if (primaryKeys.has(`${f.contentNorm}\x00${f.occurrence}`)) touchedGroups.add(f.gIdx);
    }
    for (const gIdx of touchedGroups) {
      for (const t of groups[gIdx]!.targets) {
        const ti = mapTargetToTokenIndex(meta, t);
        if (ti >= 0) tokenIdx.add(ti);
      }
    }
  }
  return [...tokenIdx].sort((a, b) => a - b);
}

export function alignmentGroupsForVerse(
  map: AlignmentMap | undefined,
  book: string,
  chapter: number,
  verse: number,
): AlignmentGroup[] | undefined {
  if (!map) return undefined;
  const sid = `${book.trim().toUpperCase()} ${chapter}:${verse}`;
  if (map[sid]?.length) return map[sid];
  const suffix = ` ${chapter}:${verse}`;
  for (const [key, groups] of Object.entries(map)) {
    if (key.toUpperCase().endsWith(suffix) && groups.length) return groups;
  }
  return undefined;
}

export function tokenIndicesForHelpQuote(opts: {
  verseText: string;
  quote: string;
  occurrence: number;
  alignments?: AlignmentMap;
  book?: string;
  chapter?: number;
  verse?: number;
}): number[] {
  const quote = opts.quote.trim();
  if (!quote) return [];
  const tokens = tokenizeVersePlainText(opts.verseText);
  if (!tokens.length) return [];
  const direct = matchHelpQuoteToTokenIndices(tokens, quote, opts.occurrence);
  if (direct.length) return direct;
  if (opts.book && opts.chapter && opts.verse) {
    const groups = alignmentGroupsForVerse(opts.alignments, opts.book, opts.chapter, opts.verse);
    if (groups?.length) {
      return matchHelpEntryToTokenIndicesByAlignment(tokens, quote, opts.occurrence, groups);
    }
  }
  return [];
}

/** Hebrew / Greek / coptic-extended — catalog OrigWords, not gateway English. */
export function isOriginalLanguageScript(text: string): boolean {
  return /[\u0590-\u05FF\u0370-\u03FF\u1F00-\u1FFF]/.test(text);
}

export type GatewayQuoteMatch = {
  gatewayText: string | null;
  tokenIndices: number[];
};

/** Join matched verse tokens; non-contiguous spans use an ellipsis (usfm-editor). */
export function gatewayQuoteFromTokenIndices(tokens: string[], idxs: number[]): string | null {
  if (!idxs.length || !tokens.length) return null;
  const clean = (i: number) => {
    const raw = tokens[i] ?? "";
    return raw.replace(/^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu, "");
  };
  const first = clean(idxs[0]!);
  if (!first && idxs.length === 1) return null;
  const parts: string[] = [];
  let groupWords: string[] = [first];
  for (let k = 1; k < idxs.length; k++) {
    const word = clean(idxs[k]!);
    if (idxs[k] === idxs[k - 1]! + 1) {
      groupWords.push(word);
    } else {
      parts.push(groupWords.filter(Boolean).join(" "));
      groupWords = [word];
    }
  }
  parts.push(groupWords.filter(Boolean).join(" "));
  const text = parts.filter(Boolean).join(" \u2026 ");
  return text.trim() ? text : null;
}

/**
 * English (gateway) span for a TN Quote / TWL OrigWords row, via ULT/UST verse
 * tokens and `zaln` alignments. Hebrew catalog text is never returned as the label.
 */
export function alignedGatewayQuoteForHelpQuote(opts: {
  verseText: string;
  quote: string;
  occurrence: number;
  alignments?: AlignmentMap;
  book?: string;
  chapter?: number;
  verse?: number;
}): GatewayQuoteMatch {
  const tokens = tokenizeVersePlainText(opts.verseText);
  const tokenIndices = tokenIndicesForHelpQuote(opts);
  if (!tokenIndices.length) return { gatewayText: null, tokenIndices: [] };
  const gatewayText = gatewayQuoteFromTokenIndices(tokens, tokenIndices);
  if (gatewayText && isOriginalLanguageScript(gatewayText)) {
    return { gatewayText: null, tokenIndices };
  }
  return { gatewayText, tokenIndices };
}

function quoteContainsNormalizedWord(haystack: string, word: string): boolean {
  const want = normalizeHelpsText(word);
  if (!want) return false;
  return tokenizeVersePlainText(haystack.replace(/\u2026/g, " ")).some(
    (t) => normalizeHelpsText(t) === want,
  );
}

/**
 * True when this help row’s quote maps to the clicked ULT/UST word
 * (alignment token index, constructed English span, or shared zaln group).
 */
export function helpQuoteMatchesWord(opts: {
  verseText: string;
  quote: string;
  occurrence: number;
  alignments?: AlignmentMap;
  book?: string;
  chapter?: number;
  verse?: number;
  wordIndex: number;
  word?: string;
  extraTokenIndices?: number[];
}): boolean {
  const quote = opts.quote.trim();
  if (!quote) return false;
  const match = alignedGatewayQuoteForHelpQuote(opts);
  const indices = new Set(match.tokenIndices);
  if (indices.has(opts.wordIndex)) return true;
  for (const extra of opts.extraTokenIndices ?? []) {
    if (indices.has(extra)) return true;
  }
  const tokens = tokenizeVersePlainText(opts.verseText);
  const clicked = opts.word?.trim() || tokens[opts.wordIndex] || "";
  if (clicked && match.gatewayText && quoteContainsNormalizedWord(match.gatewayText, clicked)) {
    return true;
  }
  if (!opts.book || !opts.chapter || !opts.verse || !clicked) return false;
  const groups = alignmentGroupsForVerse(opts.alignments, opts.book, opts.chapter, opts.verse);
  if (!verseHasAlignmentTargets(groups)) return false;
  const meta = buildGatewayTokenOccurrences(tokens);
  const touched = new Set<number>();
  for (let gIdx = 0; gIdx < groups!.length; gIdx++) {
    for (const t of groups![gIdx]!.targets) {
      const ti = mapTargetToTokenIndex(meta, t);
      if (ti === opts.wordIndex || (opts.extraTokenIndices ?? []).includes(ti)) {
        touched.add(gIdx);
      }
    }
  }
  if (!touched.size) return false;
  const quoteNorm = normalizeHelpsText(quote);
  for (const gIdx of touched) {
    for (const source of groups![gIdx]!.sources) {
      const src = normalizeHelpsText(source.content);
      if (src && quoteNorm.includes(src)) return true;
    }
  }
  return false;
}

/** Unmatched quotes sort after mapped spans in the same verse. */
export const HELP_QUOTE_UNMATCHED_TOKEN = Number.MAX_SAFE_INTEGER;

export type HelpQuoteScriptureOrderKey = {
  chapter: number;
  verse: number;
  tokenIndex: number;
  occurrence: number;
};

/**
 * Sort key for mixing TN notes and TW articles in ULT (fallback UST) order:
 * chapter, verse, first gateway token of the constructed quote / alignment
 * group, then occurrence. Rows with no quote (chapter intro) sort first in
 * that chapter (`verse` / `tokenIndex` = -1).
 */
export function helpQuoteScriptureOrderKey(opts: {
  chapter: number;
  verse?: number;
  hasQuote: boolean;
  firstTokenIndex: number | null;
  occurrence?: number;
}): HelpQuoteScriptureOrderKey {
  if (!opts.hasQuote) {
    return {
      chapter: opts.chapter,
      verse: opts.verse ?? -1,
      tokenIndex: -1,
      occurrence: 0,
    };
  }
  return {
    chapter: opts.chapter,
    verse: opts.verse ?? 0,
    tokenIndex: opts.firstTokenIndex ?? HELP_QUOTE_UNMATCHED_TOKEN,
    occurrence: opts.occurrence && opts.occurrence > 0 ? opts.occurrence : 1,
  };
}

export function compareHelpQuoteScriptureOrder(
  a: HelpQuoteScriptureOrderKey,
  b: HelpQuoteScriptureOrderKey,
): number {
  return (
    a.chapter - b.chapter ||
    a.verse - b.verse ||
    a.tokenIndex - b.tokenIndex ||
    a.occurrence - b.occurrence
  );
}
