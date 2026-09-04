/**
 * Port of idiomas-puentes-docs/scripts/fcr_scan/detect.py.
 * Heuristic: leftover English in Spanish TA/TW articles. Same text + same
 * English source -> same tokens, similarity, and status. No network, no LLM.
 */

import { sequenceMatcherRatio } from "./sequenceMatcher";

// Closed-class English words that are not ordinary Spanish.
// Isolated loanwords (Christ, Amen, Jehová) are not in this set.
//
// Never treat as English (shared with Spanish or Spanish-only):
//   no, son, si, a, has
// `in` stays: it is English; Spanish uses `en`.
// `am` stays: English "I am"; Spanish "amo" is a different token.
const ENGLISH_FUNCTION_WORDS = new Set([
  "the", "of", "and", "is", "to", "for", "with", "that", "this", "from",
  "are", "was", "were", "be", "been", "being", "have", "had", "not", "but",
  "or", "as", "at", "by", "an", "if", "into", "about", "than", "then",
  "them", "they", "their", "there", "these", "those", "which", "who",
  "will", "would", "can", "could", "should", "may", "might", "also",
  "only", "more", "most", "such", "when", "what", "how", "why", "because",
  "through", "between", "without", "after", "before", "over", "under",
  "again", "very", "just", "even", "still", "already", "it", "in", "on",
  "do", "did", "does", "done", "we", "you", "his", "her", "him", "its",
  "our", "your", "my", "so", "up", "out", "all", "any", "each", "other",
  "some", "us", "onto", "unto", "shall", "cannot", "however", "therefore",
  "although", "whether", "itself", "themselves", "something", "someone",
  "everything", "nothing", "am",
]);

// Tokens that look English but are normal Spanish (or shared). Never count
// them as leftover English, even in an otherwise English file.
const NEVER_ENGLISH = new Set(["no", "son", "si", "a", "has"]);

const SPANISH_FUNCTION_WORDS = new Set([
  "el", "la", "los", "las", "de", "del", "un", "una", "unos", "unas", "y",
  "o", "que", "en", "es", "son", "por", "para", "con", "no", "se", "su",
  "sus", "al", "lo", "como", "mas", "más", "pero", "este", "esta", "esto",
  "estos", "estas", "hay", "está", "están", "entre", "sobre", "desde",
  "hasta", "cuando", "donde", "dónde", "porque", "también", "muy", "ya",
  "todo", "todos", "toda", "todas", "le", "les", "nos", "si", "sí", "ni",
  "sin", "según", "hacia", "durante", "qué", "cuál", "cuáles", "quién",
  "quiénes", "uno", "esa", "ese", "eso", "esos", "esas",
]);

// Spanish closed-class words that also appear in English prose ("no", "son").
// They must not flip leftover-English to "looks Spanish" on their own.
const AMBIGUOUS_ES_EN = new Set(["no", "son", "si"]);

const SPANISH_CHARS = new Set("áéíóúüñ¿¡ÁÉÍÓÚÜÑ".split(""));

const TITLE_FILENAMES = new Set(["title.md", "sub-title.md", "subtitle.md"]);

const BODY_MIN_DISTINCT = 2;
const BODY_MIN_OCCURRENCES = 3;
// Spanish body with a couple of leftover glosses should not trip the low bar.
const STRONG_SPANISH_HITS = 8;
const STRONG_BODY_MIN_DISTINCT = 4;
const STRONG_BODY_MIN_OCCURRENCES = 8;

// Layer 1: spanish_hits / (spanish_hits + english_hits)
const RATIO_SPANISH_CLEAR = 0.65;
const RATIO_ENGLISH_CLEAR = 0.35;

// Layer 2: high enough that a real translation does not look identical.
// Titles are short — exact / near-equality after normalize is the signal.
const TITLE_SIMILARITY = 0.92;
const BODY_SIMILARITY = 0.88;
const BODY_JACCARD = 0.8;
const SHORT_TITLE_TOKENS = 2;
const COMPARE_SEQUENCE_LIMIT = 8000;

const FRONT_MATTER_RE = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;
const CODE_FENCE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`]+`/g;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const URL_RE = /https?:\/\/\S+|www\.\S+/gi;
const RC_RE = /rc:\/\/[^\s)>\]]+/gi;
const MD_LINK_RE = /\[([^\]]+)\]\([^)]+\)/g;
// Stock English labels left in Spanish TW/TA ("How to Translate Names").
const HOWTO_LABEL_RE = /\bhow\s+to\s+translate\s+(?:names|unknowns|unknown)\b/gi;
// Quoted glosses and example snippets, including Spanish guillemets.
const QUOTED_GLOSS_RE = /"[^"\n]{1,80}"|«[^»\n]{1,80}»|“[^”\n]{1,80}”|‘[^’\n]{1,40}’/g;
const VERSE_REF_RE = /\b(?:[1-3]?[A-Za-z]{2,3}\s+)?\d+:\d+(?:-\d+)?\b/g;
const ARTICLE_ID_RE = /\b[a-z]+(?:-[a-z0-9]+){1,}\b/g;
const USFM_RE = /\\[a-zA-Z]+\*?/g;
const TOKEN_RE = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/g;

export const STATUS_TRANSLATED = "translated";
export const STATUS_ENGLISH = "english";
export const STATUS_INCOMPLETE = "incomplete";
export const STATUS_UNKNOWN = "unknown";

export type FileEvidence = {
  path: string;
  empty: boolean;
  englishDistinct: string[];
  englishOccurrences: number;
  spanishMarkers: boolean;
  spanishOccurrences: number;
  functionRatio: number | null;
  short: boolean;
  flagged: boolean;
  fileStatus: string;
  similarity: number | null;
  jaccard: number | null;
  nearDuplicate: boolean;
  noEnglishSource: boolean;
};

function newFileEvidence(path: string, short: boolean): FileEvidence {
  return {
    path,
    empty: false,
    englishDistinct: [],
    englishOccurrences: 0,
    spanishMarkers: false,
    spanishOccurrences: 0,
    functionRatio: null,
    short,
    flagged: false,
    fileStatus: STATUS_UNKNOWN,
    similarity: null,
    jaccard: null,
    nearDuplicate: false,
    noEnglishSource: false,
  };
}

export type ArticleDecision = {
  status: string;
  empty: boolean;
  englishDistinct: string[];
  englishOccurrences: number;
  spanishMarkers: boolean;
  files: FileEvidence[];
};

export function isTitleFile(relpath: string): boolean {
  const filename = relpath.replace(/\\/g, "/").split("/").pop()!.toLowerCase();
  return TITLE_FILENAMES.has(filename);
}

/**
 * Drop YAML, fences, URLs, RC links, verse refs, quotes, and article-id slugs.
 * Used for Layer 1 word counts. Markdown link text and quoted glosses are
 * ignored so leftover "[How to Translate Names](rc://…)" does not flag a
 * Spanish article.
 */
export function stripNoise(text: string): string {
  let cleaned = text.replace(/^﻿+/, "");
  cleaned = cleaned.replace(FRONT_MATTER_RE, "\n");
  cleaned = cleaned.replace(HTML_COMMENT_RE, " ");
  cleaned = cleaned.replace(CODE_FENCE_RE, " ");
  cleaned = cleaned.replace(INLINE_CODE_RE, " ");
  cleaned = cleaned.replace(MD_LINK_RE, " ");
  cleaned = cleaned.replace(HOWTO_LABEL_RE, " ");
  cleaned = cleaned.replace(QUOTED_GLOSS_RE, " ");
  cleaned = cleaned.replace(URL_RE, " ");
  cleaned = cleaned.replace(RC_RE, " ");
  cleaned = cleaned.replace(VERSE_REF_RE, " ");
  cleaned = cleaned.replace(ARTICLE_ID_RE, " ");
  cleaned = cleaned.replace(USFM_RE, " ");
  return cleaned;
}

/** Normalize a file for Layer 2. Quoted glosses stay (a copy still matches). */
export function normalizeForCompare(text: string): string {
  let cleaned = text.replace(/^﻿+/, "");
  cleaned = cleaned.replace(FRONT_MATTER_RE, "\n");
  cleaned = cleaned.replace(HTML_COMMENT_RE, " ");
  cleaned = cleaned.replace(CODE_FENCE_RE, " ");
  cleaned = cleaned.replace(INLINE_CODE_RE, " ");
  cleaned = cleaned.replace(MD_LINK_RE, " ");
  cleaned = cleaned.replace(URL_RE, " ");
  cleaned = cleaned.replace(RC_RE, " ");
  cleaned = cleaned.replace(VERSE_REF_RE, " ");
  cleaned = cleaned.replace(ARTICLE_ID_RE, " ");
  cleaned = cleaned.replace(USFM_RE, " ");
  cleaned = cleaned.toLowerCase();
  return cleaned.replace(/\s+/g, " ").trim();
}

function tokens(text: string): string[] {
  return [...text.matchAll(TOKEN_RE)].map((m) => m[0].toLowerCase());
}

export function tokenJaccard(left: string, right: string): number {
  const a = new Set(tokens(left));
  const b = new Set(tokens(right));
  if (!a.size && !b.size) return 1.0;
  if (!a.size || !b.size) return 0.0;
  let intersect = 0;
  for (const t of a) if (b.has(t)) intersect += 1;
  const union = new Set([...a, ...b]).size;
  return intersect / union;
}

export function sequenceRatio(left: string, right: string): number {
  if (left === right) return 1.0;
  if (!left || !right) return 0.0;
  if (left.length > COMPARE_SEQUENCE_LIMIT || right.length > COMPARE_SEQUENCE_LIMIT) {
    return tokenJaccard(left, right);
  }
  return sequenceMatcherRatio(left, right);
}

export function fileEvidenceToDict(item: FileEvidence): Record<string, unknown> {
  return {
    path: item.path,
    empty: item.empty,
    flagged: item.flagged,
    file_status: item.fileStatus,
    english_distinct: item.englishDistinct,
    english_occurrences: item.englishOccurrences,
    spanish_markers: item.spanishMarkers,
    spanish_occurrences: item.spanishOccurrences,
    function_ratio: item.functionRatio,
    similarity: item.similarity,
    jaccard: item.jaccard,
    near_duplicate: item.nearDuplicate,
    no_english_source: item.noEnglishSource,
  };
}

export function titleNearDuplicate(text: string, englishText: string): [number, number, boolean] {
  const left = normalizeForCompare(text);
  const right = normalizeForCompare(englishText);
  const ratio = sequenceRatio(left, right);
  const jaccard = tokenJaccard(left, right);
  if (!left && !right) return [ratio, jaccard, true];
  if (!left || !right) return [ratio, jaccard, false];
  if (left === right) return [1.0, 1.0, true];
  const leftTokens = tokens(left);
  // One- or two-word titles: only exact equality counts as untranslated.
  // "Metaphor" vs "Metáfora" must not look identical.
  if (leftTokens.length <= SHORT_TITLE_TOKENS || tokens(right).length <= SHORT_TITLE_TOKENS) {
    return [ratio, jaccard, false];
  }
  return [ratio, jaccard, ratio >= TITLE_SIMILARITY || jaccard >= TITLE_SIMILARITY];
}

export function bodyNearDuplicate(text: string, englishText: string): [number, number, boolean] {
  const left = normalizeForCompare(text);
  const right = normalizeForCompare(englishText);
  const ratio = sequenceRatio(left, right);
  const jaccard = tokenJaccard(left, right);
  if (!left && !right) return [ratio, jaccard, true];
  if (!left || !right) return [ratio, jaccard, false];
  if (left === right) return [1.0, 1.0, true];
  const near = ratio >= BODY_SIMILARITY || jaccard >= BODY_JACCARD;
  return [ratio, jaccard, near];
}

function functionCounts(toks: string[]): {
  spanishOnlyCount: number;
  spanishAll: number;
  englishHits: string[];
} {
  const spanishHits = toks.filter((t) => SPANISH_FUNCTION_WORDS.has(t));
  const spanishOnly = spanishHits.filter((t) => !AMBIGUOUS_ES_EN.has(t));
  const englishHits = toks.filter((t) => ENGLISH_FUNCTION_WORDS.has(t) && !NEVER_ENGLISH.has(t));
  return { spanishOnlyCount: spanishOnly.length, spanishAll: spanishHits.length, englishHits };
}

function functionRatioOf(spanishOccurrences: number, englishOccurrences: number): number | null {
  const total = spanishOccurrences + englishOccurrences;
  if (total === 0) return null;
  return spanishOccurrences / total;
}

function englishOverThreshold(
  englishDistinct: string[],
  englishOccurrences: number,
  strongSpanish: boolean,
): boolean {
  const minDistinct = strongSpanish ? STRONG_BODY_MIN_DISTINCT : BODY_MIN_DISTINCT;
  const minOcc = strongSpanish ? STRONG_BODY_MIN_OCCURRENCES : BODY_MIN_OCCURRENCES;
  return englishDistinct.length >= minDistinct || englishOccurrences >= minOcc;
}

function decideBodyStatus(params: {
  empty: boolean;
  nearDuplicate: boolean;
  ratio: number | null;
  spanishMarkers: boolean;
  englishOver: boolean;
  englishOccurrences: number;
  spanishOccurrences: number;
}): string {
  const { empty, nearDuplicate, ratio, spanishMarkers, englishOver, englishOccurrences, spanishOccurrences } = params;
  if (empty) return STATUS_ENGLISH;
  if (nearDuplicate) return STATUS_ENGLISH;
  const clearlySpanish = ratio !== null && ratio >= RATIO_SPANISH_CLEAR && spanishMarkers;
  const clearlyEnglish = ratio !== null && ratio <= RATIO_ENGLISH_CLEAR;
  const englishDominates = englishOccurrences > 0 && englishOccurrences >= spanishOccurrences * 2;
  if (clearlySpanish && !englishOver) return STATUS_TRANSLATED;
  if (englishDominates || clearlyEnglish || (englishOver && !spanishMarkers)) return STATUS_ENGLISH;
  if (englishOver && spanishMarkers) return STATUS_INCOMPLETE;
  if (spanishMarkers && !englishOver) return STATUS_TRANSLATED;
  if (englishOver) return STATUS_ENGLISH;
  return STATUS_INCOMPLETE;
}

function analyzeTitle(text: string, relpath: string, englishText: string | null): FileEvidence {
  const cleaned = stripNoise(text);
  const toks = tokens(cleaned);
  const evidence = newFileEvidence(relpath.replace(/\\/g, "/"), true);
  evidence.empty = !toks.length;
  if (!toks.length) {
    evidence.flagged = true;
    evidence.fileStatus = STATUS_ENGLISH;
    if (englishText === null) evidence.noEnglishSource = true;
    return evidence;
  }
  if (englishText === null) {
    evidence.noEnglishSource = true;
    evidence.fileStatus = STATUS_UNKNOWN;
    evidence.flagged = false;
    return evidence;
  }
  const [ratio, jaccard, near] = titleNearDuplicate(text, englishText);
  evidence.similarity = ratio;
  evidence.jaccard = jaccard;
  evidence.nearDuplicate = near;
  if (near) {
    evidence.fileStatus = STATUS_ENGLISH;
    evidence.flagged = true;
  } else {
    evidence.fileStatus = STATUS_TRANSLATED;
    evidence.flagged = false;
    evidence.spanishMarkers = true;
  }
  return evidence;
}

function analyzeBody(text: string, relpath: string, englishText: string | null): FileEvidence {
  const cleaned = stripNoise(text);
  const toks = tokens(cleaned);
  const evidence = newFileEvidence(relpath.replace(/\\/g, "/"), false);
  evidence.empty = !toks.length;
  if (!toks.length) {
    evidence.flagged = true;
    evidence.fileStatus = STATUS_ENGLISH;
    if (englishText === null) evidence.noEnglishSource = true;
    return evidence;
  }

  const { spanishOnlyCount, spanishAll, englishHits } = functionCounts(toks);
  evidence.spanishOccurrences = spanishAll;
  evidence.englishDistinct = [...new Set(englishHits)].sort();
  evidence.englishOccurrences = englishHits.length;
  evidence.spanishMarkers = spanishOnlyCount > 0;
  evidence.functionRatio = functionRatioOf(spanishAll, englishHits.length);
  const strongSpanish = spanishAll >= STRONG_SPANISH_HITS;
  const englishOver = englishOverThreshold(evidence.englishDistinct, evidence.englishOccurrences, strongSpanish);

  if (englishText === null) {
    evidence.noEnglishSource = true;
  } else {
    const [ratio, jaccard, near] = bodyNearDuplicate(text, englishText);
    evidence.similarity = ratio;
    evidence.jaccard = jaccard;
    evidence.nearDuplicate = near;
  }

  evidence.fileStatus = decideBodyStatus({
    empty: false,
    nearDuplicate: evidence.nearDuplicate,
    ratio: evidence.functionRatio,
    spanishMarkers: evidence.spanishMarkers,
    englishOver,
    englishOccurrences: evidence.englishOccurrences,
    spanishOccurrences: evidence.spanishOccurrences,
  });
  // Accented letters alone (Jehová in an English article) are not Spanish prose.
  if (!evidence.spanishMarkers && evidence.fileStatus === STATUS_TRANSLATED && !evidence.nearDuplicate) {
    evidence.spanishMarkers = [...cleaned].some((ch) => SPANISH_CHARS.has(ch));
  }
  evidence.flagged = evidence.fileStatus === STATUS_ENGLISH || evidence.fileStatus === STATUS_INCOMPLETE;
  return evidence;
}

export function analyzeFile(text: string, relpath: string, englishText: string | null = null): FileEvidence {
  const rel = relpath.replace(/\\/g, "/");
  if (isTitleFile(rel)) return analyzeTitle(text, rel, englishText);
  return analyzeBody(text, rel, englishText);
}

export function decideArticle(files: FileEvidence[]): ArticleDecision {
  if (!files.length || files.every((item) => item.empty)) {
    return {
      status: STATUS_ENGLISH,
      empty: true,
      englishDistinct: [],
      englishOccurrences: 0,
      spanishMarkers: false,
      files,
    };
  }
  const distinct = new Set<string>();
  let occurrences = 0;
  let anySpanish = false;
  let anyEnglish = false;
  let anyIncomplete = false;
  let anyEmpty = false;
  let anyContent = false;
  for (const item of files) {
    for (const d of item.englishDistinct) distinct.add(d);
    occurrences += item.englishOccurrences;
    if (item.empty) {
      anyEmpty = true;
      anyEnglish = true;
      continue;
    }
    anyContent = true;
    if (item.fileStatus === STATUS_UNKNOWN) continue;
    if (item.fileStatus === STATUS_INCOMPLETE) {
      anyIncomplete = true;
      anySpanish = anySpanish || item.spanishMarkers;
      anyEnglish = true;
    } else if (item.fileStatus === STATUS_ENGLISH) {
      anyEnglish = true;
    } else if (item.fileStatus === STATUS_TRANSLATED) {
      anySpanish = true;
    }
    anySpanish = anySpanish || item.spanishMarkers;
  }

  if (anyEmpty && anyContent && anySpanish) {
    return {
      status: STATUS_INCOMPLETE,
      empty: false,
      englishDistinct: [...distinct].sort(),
      englishOccurrences: occurrences,
      spanishMarkers: true,
      files,
    };
  }
  let status: string;
  if (anyIncomplete || (anyEnglish && anySpanish)) {
    status = STATUS_INCOMPLETE;
  } else if (anyEnglish) {
    status = STATUS_ENGLISH;
  } else {
    status = STATUS_TRANSLATED;
  }
  return {
    status,
    empty: false,
    englishDistinct: [...distinct].sort(),
    englishOccurrences: occurrences,
    spanishMarkers: anySpanish,
    files,
  };
}

/** `bible/kt/call-speakloudly` -> `bible/kt/call`; else null. */
export function twParentPath(path: string): string | null {
  let text = (path || "").trim().replace(/^\/+|\/+$/g, "").replace(/\\/g, "/");
  if (text.toLowerCase().endsWith(".md")) text = text.slice(0, -3);
  if (!text.includes("/")) return null;
  const slug = text.slice(text.lastIndexOf("/") + 1);
  if (!slug.includes("-")) return null;
  const directory = text.slice(0, text.lastIndexOf("/"));
  const parentSlug = slug.slice(0, slug.lastIndexOf("-"));
  if (!parentSlug || parentSlug === slug) return null;
  return `${directory}/${parentSlug}`;
}
