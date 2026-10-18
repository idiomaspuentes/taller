/**
 * A chapter read in several texts at once, one row per verse: the TPL beside the original, the TPS beside the UST.
 * The afinación team asked for it to compare versions; one text at a time, a verse had to be held in memory while
 * the other text was opened.
 *
 * Texts do not divide a chapter the same way. A verse is as long as it is in each text, and the row is as tall as
 * the longest; a text may write two verses as one (`\v 4-5`), and then its cell in the row of 4 holds both and the
 * row of 5 says where they are; a verse one text does not have is said to be missing, never left out, so the rows
 * of every text stay in step.
 */

/** Verses of a book by «chapter:verse»; a verse written with others is kept under its first number. */
export type VerseBook = Record<string, string>;

export type ParallelSource = {
  id: string;
  book: VerseBook;
  /** Verses written as one: «4:4» → 5 for `\v 4-5` in chapter 4. */
  joined?: Record<string, number>;
};

export type ParallelCell =
  /** The verse as this text has it; `to`: the last verse it also holds, when it is written with them. */
  | { kind: "text"; text: string; to?: number }
  /** This text has this verse inside an earlier one: the cell says which. */
  | { kind: "joined"; from: number }
  /** This text has nothing for this verse. */
  | { kind: "missing" };

export type ParallelRow = { verse: number; cells: ParallelCell[] };

/** At most this many texts side by side: more columns than that are too narrow to read even on a wide screen. */
export const MAX_PARALLEL = 4;

const chapterOf = (key: string) => Number(key.split(":")[0]);
const verseOf = (key: string) => Number(key.split(":")[1]);

/** The chapters any of the texts has, in order. */
export function chaptersOf(sources: ParallelSource[]): number[] {
  const all = new Set<number>();
  for (const source of sources) for (const key of Object.keys(source.book)) if (Number.isFinite(chapterOf(key))) all.add(chapterOf(key));
  return [...all].sort((a, b) => a - b);
}

/** One row for each verse that any of the texts has in `chapter`, with what each text says there. */
export function chapterRows(sources: ParallelSource[], chapter: number): ParallelRow[] {
  const verses = new Set<number>();
  for (const source of sources) {
    for (const key of Object.keys(source.book)) {
      if (chapterOf(key) !== chapter || !(verseOf(key) > 0)) continue;
      const from = verseOf(key);
      const to = source.joined?.[key] ?? from;
      for (let v = from; v <= to; v++) verses.add(v);
    }
  }
  return [...verses]
    .sort((a, b) => a - b)
    .map((verse) => ({
      verse,
      cells: sources.map((source): ParallelCell => {
        const key = `${chapter}:${verse}`;
        const text = source.book[key];
        if (text !== undefined) {
          const to = source.joined?.[key];
          return to && to > verse ? { kind: "text", text, to } : { kind: "text", text };
        }
        for (const [at, to] of Object.entries(source.joined ?? {})) {
          if (chapterOf(at) === chapter && verseOf(at) < verse && to >= verse) return { kind: "joined", from: verseOf(at) };
        }
        return { kind: "missing" };
      }),
    }));
}

/**
 * The texts shown after touching `id`: added, or taken away when it was shown. The texts keep the order the screen
 * lists them in; one always stays, and past `max` the touch does nothing (the person takes one away first).
 */
export function toggleShown(shown: string[], id: string, order: string[], max = MAX_PARALLEL): string[] {
  const on = shown.includes(id);
  if (on && shown.length === 1) return shown;
  if (!on && shown.length >= max) return shown;
  const next = on ? shown.filter((x) => x !== id) : [...shown, id];
  return order.filter((x) => next.includes(x));
}

/**
 * The texts shown when the chapter opens: those shown last time that this screen has, with `initial` (the text the
 * person was reading) among them; with nothing kept, `initial` or the first text.
 */
export function shownAtStart(kept: unknown, order: string[], initial?: string, max = MAX_PARALLEL): string[] {
  let valid = Array.isArray(kept) ? order.filter((id) => (kept as unknown[]).includes(id)).slice(0, max) : [];
  const first = initial && order.includes(initial) ? initial : undefined;
  if (first && !valid.includes(first)) valid = order.filter((id) => [...valid.slice(0, max - 1), first].includes(id));
  if (valid.length) return valid;
  return order.length ? [first ?? order[0]!] : [];
}
