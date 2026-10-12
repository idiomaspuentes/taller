import { selectionFromWords, wordSpans } from "./afinacionSelection";
import { textFingerprint, type ReviewDecision } from "./reviewRound";

/**
 * What a team already checked in a translationCore project, read as the answers this app keeps.
 *
 * A team that comes from translationCore has its checks of the notes and of the key terms in the project's
 * `.apps/translationCore/index/<tool>/<book>/<group>.json`: one entry per note or use of a term, with the words
 * of the translation that were marked for it. Each entry carries the id of the note or of the row of the list of
 * words (`checkId`), which is the id an item has here: nothing has to be matched by its words.
 *
 * Nothing here reads or writes a repository.
 */

export type TcSelection = { text: string; occurrence: number; occurrences?: number };

export type TcCheck = {
  selections?: TcSelection[] | false | null;
  nothingToSelect?: boolean;
  /** translationCore set this when the verse was edited after the check: the check is to be done again. */
  invalidated?: boolean;
  contextId?: {
    checkId?: string;
    tool?: string;
    groupId?: string;
    reference?: { bookId?: string; chapter?: number | string; verse?: number | string };
  };
};

export type TcTool = "translationNotes" | "translationWords";

/** The id an item of this app has for a check of translationCore: the notes by their own, the words apart. */
export function itemIdOfTcCheck(check: TcCheck, tool: TcTool): string | null {
  const id = check.contextId?.checkId?.trim();
  if (!id) return null;
  return tool === "translationWords" ? `w:${id}` : id;
}

/** Where the n-th time these words are said in a verse begins, or -1. */
function nthIndexOf(text: string, words: string, occurrence: number): number {
  let at = -1;
  for (let n = 0; n < Math.max(1, occurrence); n++) {
    at = text.indexOf(words, at + 1);
    if (at < 0) return -1;
  }
  return at;
}

/**
 * The words of the verse, by their place, that the selections of a check cover. Null when one of them is no longer
 * said in the verse: the text was changed after the check, and what was marked cannot be told any more.
 */
export function wordsOfTcSelections(verseText: string, selections: TcSelection[]): number[] | null {
  const spans = wordSpans(verseText);
  const marked = new Set<number>();
  for (const selection of selections) {
    const words = selection.text ?? "";
    if (!words.trim()) continue;
    const start = nthIndexOf(verseText, words, selection.occurrence);
    if (start < 0) return null;
    const end = start + words.length;
    for (const span of spans) if (span.start < end && span.end > start) marked.add(span.index);
  }
  return [...marked].sort((a, b) => a - b);
}

export type TcImportLeftOut = { itemId: string; chapter: number; verse: number; why: "pending" | "invalidated" | "words-not-found" | "no-verse" };

export type TcImportResult = {
  decisions: ReviewDecision[];
  /** The checks that give no answer, and why: these are the work that is left. */
  leftOut: TcImportLeftOut[];
  /** Entries with no id of their own: older projects of translationCore, which cannot be told apart here. */
  withoutId: number;
};

/**
 * The answers of one tool. A check that was done is an agreement about the words marked, on the text as it is now;
 * one that translationCore invalidated, one never done, and one whose words are no longer in the verse are left
 * for the team to do.
 */
export function decisionsFromTcChecks(params: {
  checks: TcCheck[];
  tool: TcTool;
  /** The verse as the draft has it now, by chapter and verse. */
  verseText: (chapter: number, verse: number) => string | undefined;
  /** Who the answers are recorded for, and when. */
  reviewer: string;
  timestamp: string;
  sessionId: string;
  stageId: string;
  /** What is written with each answer, so that it is known where it came from. */
  note?: string;
  /** Record each as the decision of the team (it is one: the team checked it together), not as one person's answer. */
  final?: boolean;
}): TcImportResult {
  const decisions: ReviewDecision[] = [];
  const leftOut: TcImportLeftOut[] = [];
  let withoutId = 0;
  const seen = new Set<string>();
  for (const check of params.checks) {
    const itemId = itemIdOfTcCheck(check, params.tool);
    if (!itemId) {
      withoutId++;
      continue;
    }
    if (seen.has(itemId)) continue;
    seen.add(itemId);
    const chapter = Number(check.contextId?.reference?.chapter);
    const verse = Number.parseInt(String(check.contextId?.reference?.verse ?? ""), 10);
    const out = (why: TcImportLeftOut["why"]) => leftOut.push({ itemId, chapter, verse, why });
    const selections = Array.isArray(check.selections) ? check.selections : [];
    if (check.invalidated) {
      out("invalidated");
      continue;
    }
    if (!selections.length && !check.nothingToSelect) {
      out("pending");
      continue;
    }
    const text = Number.isFinite(chapter) && Number.isFinite(verse) ? params.verseText(chapter, verse) : undefined;
    if (text === undefined) {
      out("no-verse");
      continue;
    }
    const words = selections.length ? wordsOfTcSelections(text, selections) : [];
    if (words === null || (selections.length > 0 && !words.length)) {
      out("words-not-found");
      continue;
    }
    decisions.push({
      itemId,
      ref: { start: { chapter, verse } },
      selectedText: selectionFromWords(text, words, { chapter, verse }),
      sessionId: params.sessionId,
      stageId: params.stageId,
      status: "approved",
      reviewer: params.reviewer,
      timestamp: params.timestamp,
      note: params.note || undefined,
      textHash: textFingerprint(text),
      ...(params.final ? { final: true } : {}),
    });
  }
  return { decisions, leftOut, withoutId };
}

/** How far each chapter is, as a team would say it: so many of so many checked. */
export function tcProgressByChapter(result: TcImportResult): Record<number, { done: number; total: number }> {
  const out: Record<number, { done: number; total: number }> = {};
  const row = (chapter: number) => (out[chapter] ??= { done: 0, total: 0 });
  for (const decision of result.decisions) {
    const at = row(decision.ref.start.chapter);
    at.done++;
    at.total++;
  }
  for (const left of result.leftOut) row(left.chapter).total++;
  return out;
}
