/**
 * The group review of a deliverable: everything translated of a stretch (a chapter, or a part of a long one), read
 * together on the group's draft, passage by passage as each arrives. Each verse of each text is an item of a
 * consensus round (`reviewRound.ts`); a passage nobody delivered yet has no text, and is waited for.
 * Pure: `dcs/groupReading.ts` reads the drafts, the view shows this.
 */
import type { ItemTally } from "./reviewRound";
import type { VerseTextMap } from "./usfmAst";

export type PassageRange = { from: number; to: number };

/**
 * The passages of the stretch, from what the subtarea lists (`porcion:3JN 1:1-4`), in order. A subtarea that lists
 * none covers its whole chapter as one passage.
 */
export function passagesOf(itemIds: string[], chapter: number, lastVerse: number): PassageRange[] {
  const found: PassageRange[] = [];
  for (const id of itemIds) {
    const m = /(\d+):(\d+)(?:\s*[-–]\s*(\d+))?\s*$/.exec(id);
    if (!m || Number(m[1]) !== chapter) continue;
    const from = Number(m[2]);
    const to = m[3] ? Number(m[3]) : from;
    if (from > 0 && to >= from && !found.some((row) => row.from === from)) found.push({ from, to });
  }
  found.sort((a, b) => a.from - b.from);
  return found.length ? found : lastVerse > 0 ? [{ from: 1, to: lastVerse }] : [];
}

/** One answer is about one verse of one text. */
export function readingItemId(resource: string, chapter: number, verse: number): string {
  return `lectura:${resource.toLowerCase()}:${chapter}:${verse}`;
}

export type ReadingText = {
  resource: string;
  /** The verses of the chapter as they are in the group's draft now. */
  verses: VerseTextMap;
  /**
   * The passages whose translation is still under way (its subtarea is open). A draft that starts from a text
   * that already existed has words in every verse, so having text does not say that a passage arrived.
   */
  pending?: PassageRange[];
};

export type ReadingPassage = PassageRange & {
  verses: number[];
  /** Per text: whether its translation of this passage reached the group's draft. */
  arrived: Record<string, boolean>;
};

/** The passages with their verses, and which texts already have each. */
export function readingPassages(passages: PassageRange[], texts: ReadingText[]): ReadingPassage[] {
  return passages.map((passage) => {
    const verses = Array.from({ length: passage.to - passage.from + 1 }, (_, i) => passage.from + i);
    const waited = (text: ReadingText) => (text.pending ?? []).some((row) => row.from <= passage.to && row.to >= passage.from);
    const arrived = Object.fromEntries(texts.map((text) => [text.resource, !waited(text) && verses.some((verse) => Boolean(text.verses[verse]?.trim()))]));
    return { ...passage, verses, arrived };
  });
}

export type ReadingProgress = {
  /** Verses with text, of every text. */
  items: number;
  agreed: number;
  disputed: number;
  /** Passages × texts still being translated. */
  missing: number;
  /** Everything arrived and everything is agreed: the review can be closed. */
  complete: boolean;
};

/** Where the review stands. What has not arrived cannot be agreed, so the review cannot close without it. */
export function readingProgress(passages: ReadingPassage[], texts: ReadingText[], chapter: number, tallies: Map<string, ItemTally>): ReadingProgress {
  let items = 0;
  let agreed = 0;
  let disputed = 0;
  let missing = 0;
  for (const passage of passages) {
    for (const text of texts) {
      if (!passage.arrived[text.resource]) {
        missing++;
        continue;
      }
      for (const verse of passage.verses) {
        // A verse left empty inside a delivered passage (joined to its neighbour) has nothing to agree on.
        if (!text.verses[verse]?.trim()) continue;
        items++;
        const state = tallies.get(readingItemId(text.resource, chapter, verse))?.state;
        if (state === "agreed") agreed++;
        else if (state === "disputed") disputed++;
      }
    }
  }
  return { items, agreed, disputed, missing, complete: items > 0 && missing === 0 && agreed === items };
}
