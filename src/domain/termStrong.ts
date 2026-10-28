import type { OriginalWord } from "../dcs/afinacionLoad";
import { quoteInOriginal } from "./helpQuoteMatch";

/**
 * Whether the word a Words row links is one the article is about. The word lists are reused from book to book and
 * now and then link a word to the wrong article; the article's Strong numbers tell. Taller only says so: the person
 * decides whether the link is right.
 */

/**
 * The comparable form of a Strong number: no prefix (`b:`, `c:d:`), no leading zeros, no letter at the end. Greek
 * numbers written with five digits carry one more digit at the end (`G07440` is G744).
 */
export function strongKey(raw: string): string | null {
  const m = /([HG])(\d+)[a-z]?\s*$/i.exec(raw.split(":").pop() ?? "");
  if (!m) return null;
  const letter = m[1]!.toUpperCase();
  const digits = letter === "G" && m[2]!.length === 5 ? m[2]!.slice(0, 4) : m[2]!;
  const n = Number(digits);
  return n > 0 ? `${letter}${n}` : null;
}

/** The Strong numbers an article lists in «Datos de esta palabra» / «Word Data». */
export function articleStrongs(article: string): string[] {
  const out: string[] = [];
  for (const line of article.split(/\r?\n/)) {
    if (!/strong/i.test(line) || !line.includes(":")) continue;
    for (const token of line.slice(line.indexOf(":") + 1).match(/[HG]\d+[a-z]?/gi) ?? []) {
      const key = strongKey(token);
      if (key && !out.includes(key)) out.push(key);
    }
  }
  return out;
}

/**
 * `{ strongs }` (the Strong numbers of the linked words) when none of them is among the article's; null when there is
 * nothing to say: the article lists none (in the team's language nor in the source's), or the verse does not say the
 * quote, or its words carry no number.
 */
export function strongMismatch(p: {
  words: OriginalWord[];
  quote: string;
  occurrence: number;
  article: string | null;
  sourceArticle: string | null;
}): { strongs: string[] } | null {
  const listed = articleStrongs(p.article ?? "");
  const strongs = listed.length ? listed : articleStrongs(p.sourceArticle ?? "");
  if (!strongs.length) return null;
  const at = quoteInOriginal(
    p.words.map((word) => ({ content: word.surface, occurrence: 0 })),
    p.quote,
    p.occurrence,
  );
  if (!at) return null;
  const linked = [...new Set(at.map((i) => strongKey(p.words[i]?.strong ?? "")).filter((key): key is string => Boolean(key)))];
  if (!linked.length || linked.some((key) => strongs.includes(key))) return null;
  return { strongs: linked };
}
