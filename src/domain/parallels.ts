/**
 * Parallel passages: the verses of other books that tell the same thing, or quote this one. The list is the one
 * of the United Bible Societies (github.com/ubsicap/ubs-open-license, CC BY-SA 4.0), reshaped by
 * `scripts/build-parallels.mts` into one small file per book, in the numbering the app's texts use.
 */

export type VerseSpan = { from: number; to: number };

/** Verses of one chapter: «MAT 12:40», «3JN 1:13-14», «LUK 6:27-28,35». */
export type ParallelRef = { book: string; chapter: number; spans: VerseSpan[] };

/** The passages a book takes part in: each a list of references that are parallel to one another. */
export type ParallelFile = { passages: ParallelRef[][] };

const REF = /^([1-3A-Z][A-Z]{2}) (\d+):(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)$/;

export function parseParallelRef(text: string): ParallelRef | null {
  const found = REF.exec(text.trim());
  if (!found) return null;
  const spans = found[3]!.split(",").map((piece) => {
    const [from, to] = piece.split("-").map(Number);
    return { from: from!, to: to ?? from! };
  });
  if (spans.some((span) => span.to < span.from)) return null;
  return { book: found[1]!, chapter: Number(found[2]), spans };
}

const spansText = (spans: VerseSpan[]) => spans.map((span) => (span.to > span.from ? `${span.from}-${span.to}` : String(span.from))).join(",");

export function formatParallelRef(ref: ParallelRef): string {
  return `${ref.book} ${ref.chapter}:${spansText(ref.spans)}`;
}

/** A reference as a person reads it: «Mateo 12:40», «Lucas 6:27-28, 35». */
export function parallelLabel(ref: ParallelRef, bookName: (code: string) => string): string {
  return `${bookName(ref.book)} ${ref.chapter}:${spansText(ref.spans).replace(/,/g, ", ")}`;
}

export function versesOfRef(ref: ParallelRef): number[] {
  return ref.spans.flatMap((span) => Array.from({ length: span.to - span.from + 1 }, (_, i) => span.from + i));
}

/** Verse numbers in order as the fewest spans: 27, 28, 35 → 27-28, 35. */
function spansOf(verses: number[]): VerseSpan[] {
  const spans: VerseSpan[] = [];
  for (const verse of [...new Set(verses)].sort((a, b) => a - b)) {
    const last = spans[spans.length - 1];
    if (last && verse === last.to + 1) last.to = verse;
    else spans.push({ from: verse, to: verse });
  }
  return spans;
}

/** A file as it is served (`{ passages: [["JON 1:17", "MAT 12:40"]] }`). `null` when it holds no passage. */
export function normalizeParallelFile(raw: unknown): ParallelFile | null {
  const rows = (raw as { passages?: unknown } | null)?.passages;
  if (!Array.isArray(rows)) return null;
  const passages = rows
    .map((row) => (Array.isArray(row) ? row.map((ref) => (typeof ref === "string" ? parseParallelRef(ref) : null)).filter((ref): ref is ParallelRef => Boolean(ref)) : []))
    .filter((refs) => refs.length > 1);
  return passages.length ? { passages } : null;
}

/**
 * The passages parallel to a verse, each once, in the order the list gives them. A passage that also names other
 * verses of the same book (a refrain) lists those too: only the verse in hand is left out.
 */
export function parallelsAt(file: ParallelFile | null | undefined, book: string, chapter: number, verse: number): ParallelRef[] {
  const out = new Map<string, ParallelRef>();
  const here = (ref: ParallelRef) => ref.book === book && ref.chapter === chapter && ref.spans.some((span) => verse >= span.from && verse <= span.to);
  for (const passage of file?.passages ?? []) {
    if (!passage.some(here)) continue;
    for (const ref of passage) if (!here(ref)) out.set(formatParallelRef(ref), ref);
  }
  return [...out.values()];
}

/** The verses of a chapter that have some parallel passage: what a screen marks. */
export function versesWithParallels(file: ParallelFile | null | undefined, book: string, chapter: number): Set<number> {
  const out = new Set<number>();
  for (const passage of file?.passages ?? []) for (const ref of passage) if (ref.book === book && ref.chapter === chapter) for (const verse of versesOfRef(ref)) out.add(verse);
  return out;
}

// ---------------------------------------------------------------- building the files

export type SourceVerse = { hebrew: boolean; ref: string };

/** The passages of the UBS file: `<Passage><Verse HEB="…">JON 2:1</Verse><Verse GRK="…">MAT 12:40</Verse></Passage>`. */
export function passagesOfXml(xml: string): SourceVerse[][] {
  return [...xml.matchAll(/<Passage\b[^>]*>([\s\S]*?)<\/Passage>/g)].map((passage) =>
    [...passage[1]!.matchAll(/<Verse (HEB|GRK)="[^"]*">([^<]+)<\/Verse>/g)].map((verse) => ({ hebrew: verse[1] === "HEB", ref: verse[2]!.trim() })),
  );
}

type Place = { chapter: number; verse: number };

/**
 * From the numbering of the Hebrew Bible to the one the app's texts use, which is that of most English and
 * Spanish Bibles (Jonah 2:1 there is 1:17 here). `mapped` is the standard table of Paratext, which says it the
 * other way round: «JON 1:17» → «JON 2:1», «JON 2:1-10» → «JON 2:2-11».
 */
export function hebrewToOurs(mapped: Record<string, string>): (book: string, place: Place) => Place {
  const table = new Map<string, Place>();
  const SIDE = /^([1-3A-Z][A-Z]{2}) (\d+):(\d+)(?:-(\d+))?$/;
  for (const [ours, theirs] of Object.entries(mapped)) {
    const a = SIDE.exec(ours);
    const b = SIDE.exec(theirs);
    // A side with a letter («ESG 1:1a») is of a book the list of passages does not have.
    if (!a || !b || a[1] !== b[1]) continue;
    const length = Number(a[4] ?? a[3]) - Number(a[3]);
    if (length !== Number(b[4] ?? b[3]) - Number(b[3])) continue;
    for (let i = 0; i <= length; i++) table.set(`${b[1]} ${Number(b[2])}:${Number(b[3]) + i}`, { chapter: Number(a[2]), verse: Number(a[3]) + i });
  }
  return (book, place) => {
    const found = table.get(`${book} ${place.chapter}:${place.verse}`) ?? place;
    // Verse 0 is the title of a psalm: the app's texts show it with the first verse.
    return { chapter: found.chapter, verse: Math.max(1, found.verse) };
  };
}

/** A reference of the list in our numbering. One that runs over the end of a chapter here becomes two. */
export function refInOurs(verse: SourceVerse, toOurs: (book: string, place: Place) => Place): ParallelRef[] {
  const ref = parseParallelRef(verse.ref);
  if (!ref) return [];
  if (!verse.hebrew) return [ref];
  const byChapter = new Map<number, number[]>();
  for (const number of versesOfRef(ref)) {
    const place = toOurs(ref.book, { chapter: ref.chapter, verse: number });
    byChapter.set(place.chapter, [...(byChapter.get(place.chapter) ?? []), place.verse]);
  }
  return [...byChapter].sort((a, b) => a[0] - b[0]).map(([chapter, verses]) => ({ book: ref.book, chapter, spans: spansOf(verses) }));
}

/**
 * What is written for each book: the passages it takes part in, as text. A passage that says nothing another one
 * of the book does not already say (the list repeats a short one inside a longer one) is left out.
 */
export function parallelFiles(passages: SourceVerse[][], toOurs: (book: string, place: Place) => Place): Map<string, string[][]> {
  const files = new Map<string, string[][]>();
  for (const passage of passages) {
    const refs = [...new Set(passage.flatMap((verse) => refInOurs(verse, toOurs)).map(formatParallelRef))];
    if (refs.length < 2) continue;
    for (const book of new Set(refs.map((ref) => ref.slice(0, 3)))) files.set(book, [...(files.get(book) ?? []), refs]);
  }
  for (const [book, rows] of files) {
    const kept = rows.filter((row, at) => !rows.some((other, i) => i !== at && (other.length > row.length || (other.length === row.length && i < at)) && row.every((ref) => other.includes(ref))));
    files.set(book, kept);
  }
  return files;
}
