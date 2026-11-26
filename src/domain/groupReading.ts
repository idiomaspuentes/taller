/**
 * The group review of a deliverable: everything translated of a stretch (a chapter, or a part of a long one), read
 * together on the group's draft, passage by passage as each arrives. Each verse of each text is an item of a
 * consensus round (`reviewRound.ts`); a passage nobody delivered yet has no text, and is waited for.
 * Pure: `dcs/groupReading.ts` reads the drafts, the view shows this.
 */
import { latestOf } from "./openWindow";
import type { ItemTally, ReviewDecision } from "./reviewRound";
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
  /** Everything arrived and everything is agreed (some verses may still be open for the rest of the step). */
  allAgreed: boolean;
  /** When the last verse still open closes; absent when none is open. */
  closesAt?: string;
  /** Everything arrived, everything is agreed and nothing is still open: the review can be closed. */
  complete: boolean;
};

/** Where the review stands. What has not arrived cannot be agreed, so the review cannot close without it. */
export function readingProgress(passages: ReadingPassage[], texts: ReadingText[], chapter: number, tallies: Map<string, ItemTally>): ReadingProgress {
  let items = 0;
  let agreed = 0;
  let disputed = 0;
  let missing = 0;
  const openUntil: (string | undefined)[] = [];
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
        const tally = tallies.get(readingItemId(text.resource, chapter, verse));
        if (tally?.state === "agreed") {
          agreed++;
          openUntil.push(tally.openUntil);
        } else if (tally?.state === "disputed") disputed++;
      }
    }
  }
  const allAgreed = items > 0 && missing === 0 && agreed === items;
  const closesAt = latestOf(openUntil);
  return { items, agreed, disputed, missing, allAgreed, ...(closesAt ? { closesAt } : {}), complete: allAgreed && !closesAt };
}

// ---- The passage as a unit ----

const keyOf = (login: string) => login.trim().toLowerCase();

/**
 * The verses of a passage there is something to read in: those of this text with words in them, with their tallies.
 * A passage that has not arrived has none. Those closed by a final decision are kept: each caller decides about them.
 */
function versesOf(passage: ReadingPassage, text: ReadingText, chapter: number, tallies: Map<string, ItemTally>) {
  if (!passage.arrived[text.resource]) return [];
  return passage.verses
    .filter((verse) => text.verses[verse]?.trim())
    .map((verse) => ({ verse, tally: tallies.get(readingItemId(text.resource, chapter, verse)) }));
}

/**
 * Who agrees with the whole passage: those whose current answer is «approved» on every verse that still asks for one.
 * Levels are not looked at: whoever agreed is shown, even when their agreement does not count for the minimum. In the
 * order in which each began to agree (their earliest agreement among these verses).
 */
export function passageAgreers(passage: ReadingPassage, text: ReadingText, chapter: number, tallies: Map<string, ItemTally>): string[] {
  const rows = versesOf(passage, text, chapter, tallies).filter((row) => !row.tally?.decided);
  if (!rows.length) return [];
  const perVerse = rows.map(({ tally }) => {
    const approved = new Map<string, ReviewDecision>();
    for (const d of tally?.answers ?? []) if (d.status === "approved") approved.set(keyOf(d.reviewer), d);
    return approved;
  });
  const [first, ...rest] = perVerse;
  const found: { reviewer: string; at: number }[] = [];
  for (const [key, d] of first!) {
    if (!rest.every((approved) => approved.has(key))) continue;
    const at = Math.min(Date.parse(d.timestamp), ...rest.map((approved) => Date.parse(approved.get(key)!.timestamp)));
    found.push({ reviewer: d.reviewer, at });
  }
  return found.sort((a, b) => a.at - b.at).map((row) => row.reviewer);
}

export type PassageAgreement = {
  /** What «agree with this passage» would save. */
  verses: number[];
  /** Left out: somebody else has a doubt still open there, and one tap must not answer it for me. */
  othersDoubt: number[];
  /** Left alone: my own doubt is current there. */
  myDoubt: number[];
  /** Of the ones saved, those where my last answer was about an older text (it is being renewed, not added). */
  changed: number[];
};

/**
 * What one tap on «agree with this passage» does for `me`, and what it leaves. A verse I already agreed to (with or
 * without a note) is not asked again, even if others doubt it; my own current doubt stays mine to withdraw.
 */
export function passageAgreement(passage: ReadingPassage, text: ReadingText, chapter: number, tallies: Map<string, ItemTally>, me: string): PassageAgreement {
  const who = keyOf(me);
  const out: PassageAgreement = { verses: [], othersDoubt: [], myDoubt: [], changed: [] };
  for (const { verse, tally } of versesOf(passage, text, chapter, tallies)) {
    if (tally?.decided) continue;
    const mine = tally?.answers.find((d) => keyOf(d.reviewer) === who);
    const stale = tally?.stale.some((d) => keyOf(d.reviewer) === who) ?? false;
    if (mine?.status === "approved") continue;
    if (mine) {
      out.myDoubt.push(verse);
      continue;
    }
    if (stale) out.changed.push(verse);
    if ((tally?.open ?? []).some((login) => keyOf(login) !== who)) out.othersDoubt.push(verse);
    else out.verses.push(verse);
  }
  return out;
}

export type PassageBlocker = { kind: "doubt"; verses: number[] } | { kind: "tc"; verse: number } | { kind: "more" } | { kind: "independent" };

/**
 * Why the passage is not agreed, said from its first verse that is not: an open doubt (with every verse that has one),
 * else agreements on different words (to be settled as in translationCore), else too few agreements, else enough of
 * them but all from people who wrote the text. A verse closed by a final decision is agreed. `null` when all are.
 */
export function passageBlocker(passage: ReadingPassage, text: ReadingText, chapter: number, tallies: Map<string, ItemTally>, minAgree: number): PassageBlocker | null {
  const pending = versesOf(passage, text, chapter, tallies).filter(({ tally }) => tally?.state !== "agreed");
  const first = pending[0];
  if (!first) return null;
  if (first.tally?.open.length) return { kind: "doubt", verses: pending.filter(({ tally }) => tally?.open.length).map(({ verse }) => verse) };
  if (first.tally?.selections) return { kind: "tc", verse: first.verse };
  if ((first.tally?.agree ?? 0) < minAgree) return { kind: "more" };
  return { kind: "independent" };
}

export type OpenDoubt = { verse: number; mine: boolean; answered: boolean };

/**
 * The doubts still open in what arrived of this text, one row per verse. `answered`: of my doubt, someone else has
 * since agreed with a note (the answer to it), so I should look and decide. Mine first, then the rest, each by verse.
 */
export function openDoubts(passages: ReadingPassage[], text: ReadingText, chapter: number, tallies: Map<string, ItemTally>, decisions: ReviewDecision[], me: string): OpenDoubt[] {
  const who = keyOf(me);
  const rows: OpenDoubt[] = [];
  for (const passage of passages) {
    for (const { verse, tally } of versesOf(passage, text, chapter, tallies)) {
      if (!tally?.open.length) continue;
      const mine = tally.open.some((login) => keyOf(login) === who);
      let answered = false;
      if (mine) {
        const doubt = tally.answers.find((d) => keyOf(d.reviewer) === who)!;
        const since = Date.parse(doubt.timestamp);
        // An answer about another text than the one my doubt is about is not an answer to it.
        const sameText = (d: ReviewDecision) => d.textHash === undefined || doubt.textHash === undefined || d.textHash === doubt.textHash;
        answered = decisions.some((d) => d.itemId === tally.itemId && d.status === "approved" && Boolean(d.note?.trim()) && keyOf(d.reviewer) !== who && Date.parse(d.timestamp) > since && sameText(d));
      }
      rows.push({ verse, mine, answered });
    }
  }
  return [...rows.filter((row) => row.mine), ...rows.filter((row) => !row.mine)].sort((a, b) => Number(b.mine) - Number(a.mine) || a.verse - b.verse);
}

export type ConversationLine = { reviewer: string; status: string; note: string; timestamp: string; earlier: boolean };

/**
 * Everything said with a note about a verse, from every answer ever given: a doubt later withdrawn and an answer about
 * an older text stay, because the talk is the point. `earlier`: said about a text that has since changed.
 */
export function verseConversation(decisions: ReviewDecision[], itemId: string, currentHash: string | undefined): ConversationLine[] {
  return decisions
    .filter((d) => d.itemId === itemId && Boolean(d.note?.trim()))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .map((d) => ({ reviewer: d.reviewer, status: d.status, note: d.note!.trim(), timestamp: d.timestamp, earlier: currentHash !== undefined && d.textHash !== undefined && d.textHash !== currentHash }));
}
