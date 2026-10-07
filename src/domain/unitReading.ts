import type { Concern } from "./endorsement";
import { portionRange } from "./usfmEdit";

/**
 * Reading a unit verse by verse, with what goes with each verse beside it: its notes, its questions, its key terms,
 * and what was said about any of them. Where a concern is filed, and which concerns are of a verse. Pure.
 */

/** The least a help needs to be placed: its verse. */
type Placed = { verse: number };

/**
 * The verses of a unit that have text. A stretch of a split chapter («1:1–4») is those verses only; a whole chapter
 * (a bare «1») is every verse of it. The texts are read by chapter, so a stretch has to be cut out of them.
 */
export function unitVerses(ref: string | undefined, chapter: number, texts: (Record<number, string> | undefined)[]): number[] {
  const range = /:/.test(ref ?? "") ? portionRange(ref ?? "", chapter) : null;
  const all = new Set<number>();
  for (const verses of texts) for (const verse of Object.keys(verses ?? {})) all.add(Number(verse));
  return [...all].filter((verse) => verse > 0 && (!range || (verse >= range.from && verse <= range.to))).sort((a, b) => a - b);
}

/** The helps of one verse, in the order they were given. */
export function helpsOfVerse<T extends Placed>(items: T[] | undefined, verse: number): T[] {
  return (items ?? []).filter((item) => item.verse === verse);
}

/**
 * Where a concern noted while reading is filed: the verse, and what of it the concern is about when it is about a
 * note, a question or a term («1:1 «conforme a la fe»»). It is what the person would have had to type.
 */
export function concernPlace(chapter: number, verse: number, about?: string | null): string {
  const said = (about ?? "").replace(/\s+/g, " ").trim();
  const short = said.length > 60 ? `${said.slice(0, 59).trimEnd()}…` : said;
  return short ? `${chapter}:${verse} «${short}»` : `${chapter}:${verse}`;
}

/** The concerns filed at a verse, whatever of it they are about. One filed at «1:1» is not of «1:12». */
export function concernsAt<T extends Pick<Concern, "where">>(concerns: T[], chapter: number, verse: number): T[] {
  const at = new RegExp(`^\\s*${chapter}:${verse}(?!\\d)`);
  return concerns.filter((concern) => at.test(concern.where ?? ""));
}

/**
 * The concerns about one help of a verse. A concern says which help it is of (`item`); one noted before it did is
 * told by its place, and when several helps of the verse share that place (two notes about the same words) it is
 * of the first of them, not of all.
 */
export function concernsOfHelp<T extends Pick<Concern, "about" | "where" | "item" | "withdrawn">>(concerns: T[], about: string, id: string, place: string, helps: { id: string; place: string }[]): T[] {
  const firstThere = helps.find((help) => help.place === place)?.id;
  return concerns.filter((concern) => !concern.withdrawn && concern.about === about && (concern.item ? concern.item === id : (concern.where ?? "") === place && firstThere === id));
}

/**
 * The helps of one word in the order they are read: from the one whose quote is shortest, which is the nearest to
 * the word touched, to the one whose quote is longest. Those of the same length stay as they came. Touching
 * «Jesucristo» gave first the note about a phrase of six words, and the key term «de Jesucristo» third.
 */
export function shortestQuoteFirst<T>(helps: T[], quoteWords: (help: T) => number): T[] {
  return helps
    .map((help, at) => ({ help, at, size: quoteWords(help) }))
    .sort((a, b) => a.size - b.size || a.at - b.at)
    .map((row) => row.help);
}

/**
 * Where the helps of a verse open: where the person left them (the kind, and which of them), or at the first of
 * the first kind the verse has. `kinds`: the kinds of help the verse has, in the order they are read; `null`
 * when it has none.
 */
export function helpsToOpen<K extends string>(kinds: K[], left: { kind: K; at: number } | undefined): { kind: K; at: number } | null {
  if (left && kinds.includes(left.kind)) return left;
  return kinds.length ? { kind: kinds[0]!, at: 0 } : null;
}
