import { scopeKey } from "./scope";

/**
 * What a person has already gone over of a unit they review: the helps (notes, questions, key terms) that were shown
 * to them, kept on this device. A chapter is some twenty screens and three hundred helps, read over several sittings:
 * without it nothing told a verse gone through from one still to read.
 */

/** Where it is kept: by workspace, server, person and the subtarea of the review. */
export function seenHelpsKey(host: string, username: string, book: string, issue: number | string): string {
  return `gt-unit-seen:${scopeKey()}${host.replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase()}:${username.trim().toLowerCase()}:${book.toUpperCase()}.${issue}`;
}

export function loadSeenHelps(key: string): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

export function saveSeenHelps(key: string, seen: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...seen]));
  } catch {
    /* a private window: it is only not remembered */
  }
}

/** How far a verse is: `done` once every one of its helps was shown; a verse with no help is never «done». */
export function verseProgress(helps: string[], seen: Set<string>): { total: number; seen: number; done: boolean } {
  const shown = helps.filter((id) => seen.has(id)).length;
  return { total: helps.length, seen: shown, done: helps.length > 0 && shown === helps.length };
}

/**
 * The verse a person is reading: the last one whose top has come up to the line where reading starts (under what
 * stays fixed at the top), or the first when none has. `tops`: each verse with where its top is on the screen.
 */
export function verseInView(tops: { verse: number; top: number }[], line: number): number | null {
  let current: number | null = tops[0]?.verse ?? null;
  for (const row of tops) {
    if (row.top <= line) current = row.verse;
    else break;
  }
  return current;
}

/**
 * How far to scroll so that the words a help is about are in sight, in the room left between what stays at the top
 * and the help held at the foot of the screen (`top` to `bottom`); 0 when they already are. Words under the help
 * come up over it, but never so far that the first of them goes under what stays at the top: of a quote longer
 * than the room, its start is what shows.
 */
export function scrollToShow(words: { top: number; bottom: number }, room: { top: number; bottom: number }): number {
  if (words.bottom > room.bottom) return Math.min(words.bottom - room.bottom, words.top - room.top);
  return words.top < room.top ? words.top - room.top : 0;
}
