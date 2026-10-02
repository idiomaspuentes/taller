/**
 * What a checklist of helps against the texts needs done before it: the helps translated, and each text aligned
 * with the original (a note is tied to the words of the text through that alignment). When something is missing
 * the checklist says what, and whose work it is, instead of letting the team check against half-done work.
 * Pure: `ChecklistView` shows it and tells the teams.
 */
import type { AlignmentMap } from "@usfm-tools/types";
import { verseFromSid, type VerseTextMap } from "./usfmAst";

export type MissingWork =
  /** The helps are still the ones of the source language. */
  | { kind: "helps"; resource: string }
  /** The text has nothing for these verses. */
  | { kind: "text"; resource: string; verses: number[] }
  /** The text is there, but these verses are not aligned with the original. */
  | { kind: "alignment"; resource: string; verses: number[] };

/** Is this verse of the text aligned: does any group of its alignment tie words of it to the original? */
export function verseIsAligned(alignments: AlignmentMap | undefined, chapter: number, verse: number): boolean {
  if (!alignments) return false;
  return Object.entries(alignments).some(([sid, groups]) => verseFromSid(sid, chapter) === verse && groups.length > 0);
}

export function missingWork(params: {
  /** The helps being checked (notes, questions…) and whether they were read from the source language. */
  helps: string;
  fromSource: boolean;
  chapter: number;
  /** The verses the items of the checklist are about. */
  verses: number[];
  texts: { resource: string; verses?: VerseTextMap; alignments?: AlignmentMap }[];
}): MissingWork[] {
  const out: MissingWork[] = [];
  if (params.fromSource) out.push({ kind: "helps", resource: params.helps });
  const wanted = [...new Set(params.verses)].sort((a, b) => a - b);
  for (const text of params.texts) {
    const empty = wanted.filter((verse) => !text.verses?.[verse]?.trim());
    if (empty.length) out.push({ kind: "text", resource: text.resource, verses: empty });
    const loose = wanted.filter((verse) => text.verses?.[verse]?.trim() && !verseIsAligned(text.alignments, params.chapter, verse));
    if (loose.length) out.push({ kind: "alignment", resource: text.resource, verses: loose });
  }
  return out;
}

/** `3, 4, 5, 9` → `3–5, 9`. */
export function verseList(verses: number[]): string {
  const sorted = [...new Set(verses)].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    runs.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
    i = j;
  }
  return runs.join(", ");
}
