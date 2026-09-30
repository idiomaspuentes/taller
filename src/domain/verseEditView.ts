import {
  lcsWordAlignment,
  normalizeWordForAlignmentMatch,
  reconcileAlignments,
  tokenizeWords,
  type OriginalWordToken,
  type WordToken,
} from "@usfm-tools/editor-core";
import type { AlignmentGroup } from "@usfm-tools/types";
import { deriveAlignmentBoxes, type AlignmentBoxModel } from "@usfm-ast/alignment-box-model";

/**
 * What a team decision shows about a verse: the text of the draft before and after, the
 * alignment as boxes, which boxes changed and which ones an objection is about. Pure.
 */

export type DiffPiece = { kind: "same" | "del" | "ins"; text: string };

/** The old and the new verse, word by word: what stays, what goes and what is new. */
export function wordDiff(oldText: string, newText: string): DiffPiece[] {
  const ow: string[] = tokenizeWords(oldText);
  const nw: string[] = tokenizeWords(newText);
  const { oldKept, newKept } = lcsWordAlignment(ow.map((w: string) => normalizeWordForAlignmentMatch(w)), nw.map((w: string) => normalizeWordForAlignmentMatch(w)));
  const out: DiffPiece[] = [];
  let i = 0;
  let j = 0;
  const push = (kind: DiffPiece["kind"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += ` ${text}`;
    else out.push({ kind, text });
  };
  while (i < ow.length || j < nw.length) {
    if (i < ow.length && !oldKept.has(i)) push("del", ow[i++]!);
    else if (j < nw.length && !newKept.has(j)) push("ins", nw[j++]!);
    else if (i < ow.length && j < nw.length) {
      push("same", nw[j]!);
      i++;
      j++;
    } else break;
  }
  return out;
}

/** Whether two verse texts say the same, ignoring spacing. */
export function sameText(a: string, b: string): boolean {
  return (tokenizeWords(a) as string[]).join(" ") === (tokenizeWords(b) as string[]).join(" ");
}

/** The words of a text as the alignment reads them, with their occurrence among equal words. */
export function tokensFromText(text: string, verseSid: string): WordToken[] {
  const words: string[] = tokenizeWords(text);
  const seen = new Map<string, number>();
  const total = new Map<string, number>();
  for (const w of words) total.set(w, (total.get(w) ?? 0) + 1);
  return words.map((surface: string, index: number) => {
    const occurrence = (seen.get(surface) ?? 0) + 1;
    seen.set(surface, occurrence);
    return { verseSid, surface, occurrence, occurrences: total.get(surface) ?? 1, index } as WordToken;
  });
}

/** The links that survive a change of text: those on words that stayed, renumbered in the new verse. */
export function groupsAfterTextEdit(groups: AlignmentGroup[], oldText: string, newText: string): AlignmentGroup[] {
  return reconcileAlignments(oldText, newText, groups);
}

/** A box is named by the words of the original it holds, so it can be found in another version of the alignment. */
export function boxKey(box: Pick<AlignmentBoxModel, "targetTokenIndices">): string {
  return [...box.targetTokenIndices].sort((a, b) => a - b).join(",");
}

const norm = (w: string) => normalizeWordForAlignmentMatch(w);

function wordsOf(box: AlignmentBoxModel): string {
  return box.alignedSourceWords.map((w) => norm(w.word)).join(" ");
}

/**
 * The boxes of the new alignment that are not as they were: other words in them, or a box
 * that did not exist (two words of the original joined, or split).
 */
export function changedBoxKeys(before: AlignmentBoxModel[], after: AlignmentBoxModel[]): Set<string> {
  const was = new Map(before.map((b) => [boxKey(b), wordsOf(b)]));
  const out = new Set<string>();
  for (const b of after) {
    const key = boxKey(b);
    if (!was.has(key) || was.get(key) !== wordsOf(b)) out.add(key);
  }
  return out;
}

/** Boxes that hold a word an objection points at (`word#occurrence`). */
export function objectedBoxKeys(boxes: AlignmentBoxModel[], words: string[]): Set<string> {
  const wanted = new Set(words);
  const out = new Set<string>();
  for (const b of boxes) {
    if (b.targetTokens.some((t) => wanted.has(`${t.surface}#${t.occurrence}`))) out.add(boxKey(b));
  }
  return out;
}

/** What the card carries to draw a verse: the original with its glosses and the draft words. */
export type DecisionView = {
  rtl: boolean;
  original: { surface: string; strong: string; lemma: string; morph?: string; occurrence: number; occurrences: number; gloss: string }[];
  /** The draft words before and after (equal unless the decision edits the text). */
  draftBefore: { surface: string; occurrence: number; occurrences: number }[];
  draftAfter: { surface: string; occurrence: number; occurrences: number }[];
};

export function originalTokensOf(view: DecisionView, verseSid: string): OriginalWordToken[] {
  return view.original.map((o, index) => ({ verseSid, surface: o.surface, strong: o.strong, lemma: o.lemma, morph: o.morph, occurrence: o.occurrence, occurrences: o.occurrences, index }) as OriginalWordToken);
}

export function draftTokensOf(words: DecisionView["draftBefore"], verseSid: string): WordToken[] {
  return words.map((w, index) => ({ verseSid, surface: w.surface, occurrence: w.occurrence, occurrences: w.occurrences, index }) as WordToken);
}

/** The boxes of an alignment over the words of a decision's view. */
export function boxesOf(view: DecisionView, draft: DecisionView["draftBefore"], groups: AlignmentGroup[], verseSid: string): AlignmentBoxModel[] {
  return deriveAlignmentBoxes(originalTokensOf(view, verseSid), groups, draftTokensOf(draft, verseSid));
}

export function viewFromTokens(params: { rtl: boolean; original: OriginalWordToken[]; gloss: string[]; draftBefore: WordToken[]; draftAfter?: WordToken[] }): DecisionView {
  const plain = (t: WordToken) => ({ surface: t.surface, occurrence: t.occurrence, occurrences: t.occurrences });
  return {
    rtl: params.rtl,
    original: params.original.map((o, i) => ({ surface: o.surface, strong: o.strong, lemma: o.lemma, morph: o.morph, occurrence: o.occurrence, occurrences: o.occurrences, gloss: params.gloss[i] ?? "" })),
    draftBefore: params.draftBefore.map(plain),
    draftAfter: (params.draftAfter ?? params.draftBefore).map(plain),
  };
}
