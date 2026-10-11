/**
 * How the Hebrew Bible numbers a verse our texts number otherwise. The app's texts, the UHB among them, follow
 * the numbering of Spanish and English Bibles; some resources keep the Hebrew one (the lexicon lists the verses
 * of each sense of a word in it). Jonah 2:5 here is 2:6 there; Psalm 51:4 is 51:6; most verses are the same.
 */
import table from "./hebrewNumbering.json";

type Place = { chapter: number; verse: number };

let known: Map<string, Place> | undefined;

function lines(): Map<string, Place> {
  if (known) return known;
  known = new Map();
  const SIDE = /^([1-3A-Z][A-Z]{2}) (\d+):(\d+)(?:-(\d+))?$/;
  for (const [ours, theirs] of Object.entries(table.mapped as Record<string, string>)) {
    const a = SIDE.exec(ours);
    const b = SIDE.exec(theirs);
    if (!a || !b) continue;
    const length = Number(a[4] ?? a[3]) - Number(a[3]);
    if (length !== Number(b[4] ?? b[3]) - Number(b[3])) continue;
    for (let i = 0; i <= length; i++) known.set(`${a[1]} ${Number(a[2])}:${Number(a[3]) + i}`, { chapter: Number(b[2]), verse: Number(b[3]) + i });
  }
  return known;
}

/** A verse of ours as the Hebrew Bible numbers it. The same verse where the two agree, and outside the Old Testament. */
export function inHebrewNumbering(book: string, place: Place): Place {
  return lines().get(`${book.trim().toUpperCase()} ${place.chapter}:${place.verse}`) ?? place;
}
