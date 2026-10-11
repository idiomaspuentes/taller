/**
 * Verses a draft writes as one (`\v 4-5`). Such a verse is one verse of the draft against two of the original:
 * it is known everywhere by its first number, and written, aligned and corrected as the whole it is.
 */
import { listVerseSpans } from "./usfmEdit";

export type JoinedSpan = { from: number; to: number };

/** The verses a name of a verse stands for («JUD 1:4-5», «JUD 1:6»), when it is of the chapter. */
export function spanOfSid(sid: string, chapter: number): JoinedSpan | null {
  const m = /(\d+):(\d+)(?:\s*[-–]\s*(\d+))?\s*$/.exec(sid);
  if (!m || Number(m[1]) !== chapter) return null;
  const from = Number(m[2]);
  const to = Number(m[3] ?? m[2]);
  return to >= from ? { from, to } : { from, to: from };
}

/** The verses a verse is written with in a book: itself alone, or all those of the `\v 4-5` it is in. */
export function spanOfVerse(usfm: string, chapter: number, verse: number): JoinedSpan {
  const hit = listVerseSpans(usfm).find((span) => span.chapter === chapter && !span.segment && span.verse <= verse && span.verseTo >= verse);
  return hit ? { from: hit.verse, to: hit.verseTo } : { from: verse, to: verse };
}

/** «4», or «4–5» for verses written as one. */
export function spanLabel(span: { verse: number; to?: number } | JoinedSpan): string {
  const from = "verse" in span ? span.verse : span.from;
  const to = span.to ?? from;
  return to > from ? `${from}–${to}` : String(from);
}
