import type { CheckingDecision, CheckingDecisionsFile } from "@usfm-tools/types";
import { countsForMinimum, type PersonLevel } from "./levels";

/**
 * Consensus of an asynchronous review round (Afinación, Validación, …).
 *
 * People answer one item at a time, each when they can. An item is agreed
 * when enough habilitadas who did not write the text agree and nobody has an
 * open objection. What stays disputed becomes the short list for a meeting.
 * Nothing here is specific to the FCR: the thresholds come from the task.
 *
 * Answers use the `CheckingDecision` shape of the enhanced project model
 * (`approved` | `revise` | `rejected`), with two extra keys that readers of
 * that format must preserve: `itemId` and `textHash`.
 */

export type ReviewStance = "approved" | "revise" | "rejected";

export type ReviewDecision = CheckingDecision & {
  /** The note, term or verse this answer is about. */
  itemId: string;
  /** Fingerprint of the text that was reviewed; a different text makes the answer stale. */
  textHash?: string;
  /** The proposal or objection this answer was made with (see alignmentDecision.ts). */
  proposalId?: string;
  /**
   * The team's final decision on this item, after talking it over: recorded by the team's coordinator or a persona
   * habilitada of the team, with what was agreed in `note`. It settles the item for everybody.
   */
  final?: boolean;
};

export type ReviewThresholds = {
  /** Habilitadas who must agree. */
  minAgree: number;
  /** Of those, how many must not have written the text. */
  minIndependent: number;
};

export type ItemState = "agreed" | "disputed" | "pending";

export type ItemTally = {
  itemId: string;
  state: ItemState;
  /** Latest answer of each person whose answer still applies. */
  answers: ReviewDecision[];
  /** Answers given on an older text: kept as history, not counted. */
  stale: ReviewDecision[];
  agree: number;
  agreeIndependent: number;
  /** Logins with an objection or a change proposal still open. */
  open: string[];
  /** The final decision that settled the item, when there is one. */
  decided?: { by: string; note?: string; at: string };
};

/** Small stable fingerprint of a verse's plain text (whitespace and NFC normalised). */
export function textFingerprint(text: string): string {
  const s = text.normalize("NFC").replace(/\s+/g, " ").trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function isStance(status: string): status is ReviewStance {
  return status === "approved" || status === "revise" || status === "rejected";
}

/** The newest answer of each reviewer for one item. */
function latestPerReviewer(decisions: ReviewDecision[]): ReviewDecision[] {
  const byPerson = new Map<string, ReviewDecision>();
  for (const d of decisions) {
    const key = d.reviewer.trim().toLowerCase();
    const prev = byPerson.get(key);
    if (!prev || Date.parse(d.timestamp) >= Date.parse(prev.timestamp)) byPerson.set(key, d);
  }
  return [...byPerson.values()];
}

export function tallyItem(params: {
  itemId: string;
  decisions: ReviewDecision[];
  /** Fingerprint of the text now. Answers on another text are stale. Omitted = nothing is stale. */
  currentHash?: string;
  levels: Record<string, PersonLevel>;
  /** Logins who wrote the text under review: they may answer but never count as independent. */
  authors: string[];
  thresholds: ReviewThresholds;
  /** Logins who may record the team's final decision. A `final` answer of anybody else is an ordinary answer. */
  confirmers?: string[];
}): ItemTally {
  const { itemId, currentHash, levels, thresholds } = params;
  const authors = new Set(params.authors.map((a) => a.trim().toLowerCase()));
  const mine = params.decisions.filter((d) => d.itemId === itemId && isStance(d.status));
  const latest = latestPerReviewer(mine);
  const stale = latest.filter((d) => currentHash !== undefined && d.textHash !== undefined && d.textHash !== currentHash);
  const staleSet = new Set(stale);
  const answers = latest.filter((d) => !staleSet.has(d));

  let agree = 0;
  let agreeIndependent = 0;
  const open: string[] = [];
  for (const d of answers) {
    const who = d.reviewer.trim().toLowerCase();
    if (d.status === "approved") {
      if (countsForMinimum(levels[who])) {
        agree++;
        if (!authors.has(who)) agreeIndependent++;
      }
    } else {
      open.push(d.reviewer);
    }
  }
  // A final decision on the text as it is now settles the item, unless somebody objects after it.
  const confirmers = new Set((params.confirmers ?? []).map((c) => c.trim().toLowerCase()));
  const final = mine
    .filter((d) => d.final === true && confirmers.has(d.reviewer.trim().toLowerCase()))
    .filter((d) => !(currentHash !== undefined && d.textHash !== undefined && d.textHash !== currentHash))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
  if (final) {
    const after = answers.filter((d) => d.status !== "approved" && Date.parse(d.timestamp) > Date.parse(final.timestamp)).map((d) => d.reviewer);
    if (!after.length) {
      return { itemId, state: "agreed", answers, stale, agree, agreeIndependent, open: [], decided: { by: final.reviewer, note: final.note, at: final.timestamp } };
    }
  }

  const agreed = agree >= thresholds.minAgree && agreeIndependent >= thresholds.minIndependent && open.length === 0;
  const state: ItemState = agreed ? "agreed" : open.length > 0 ? "disputed" : "pending";
  return { itemId, state, answers, stale, agree, agreeIndependent, open };
}

const MARKS = ".,;:!?¡¿«»“”\"'()";
const withoutMarksBefore = (word: string) => word.replace(new RegExp(`^[${MARKS}]+`), "");
const withoutMarksAfter = (word: string) => word.replace(new RegExp(`[${MARKS}]+$`), "");

/**
 * Whether a verse still has these words, whole and in a row, as they were chosen. The marks around them are not
 * part of what was asked about: a comma taken from after the last word leaves the words as they were.
 */
function hasWords(text: string, words: string): boolean {
  const all = text.normalize("NFC").split(/\s+/).filter(Boolean);
  const want = words.normalize("NFC").split(/\s+/).filter(Boolean);
  if (!want.length) return false;
  const last = want.length - 1;
  const edge = (word: string, at: number) => (at === last ? withoutMarksAfter : (w: string) => w)(at === 0 ? withoutMarksBefore(word) : word);
  for (let i = 0; i + want.length <= all.length; i++) {
    if (want.every((word, j) => edge(all[i + j]!, j) === edge(word, j))) return true;
  }
  return false;
}

/**
 * The answers as they stand over the text as it is now. Correcting one word of a verse made every answer about
 * that verse stale, whatever it was about: an article taken out of Jude 1:3 sent seven challenges back to each
 * person who had answered them, six of them about words nobody had touched. An agreement is given about some words:
 * while a correction leaves those very words as they were, it holds. A proposal or an objection is looked at again
 * (the correction may be its answer), and so is the team's final decision, which is about the whole point.
 *
 * Nothing is written: each person's file keeps the fingerprint of the text they saw.
 */
export function standingAnswers(decisions: ReviewDecision[], textNow: (decision: ReviewDecision) => string | undefined): ReviewDecision[] {
  return decisions.map((d) => {
    if (d.status !== "approved" || d.final || d.textHash === undefined || !d.selectedText?.text) return d;
    const text = textNow(d);
    if (text === undefined) return d;
    const hash = textFingerprint(text);
    return d.textHash !== hash && hasWords(text, d.selectedText.text) ? { ...d, textHash: hash } : d;
  });
}

/**
 * What a correction changed, short enough to be said in a message: the stretch of each text that differs, with a
 * word or two around it so that it can be found in the verse.
 */
export function changedStretch(before: string, now: string, around = 2): { before: string; now: string } {
  const a = before.trim().split(/\s+/).filter(Boolean);
  const b = now.trim().split(/\s+/).filter(Boolean);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const from = Math.max(0, head - around);
  const cut = (words: string[]) => {
    const to = Math.min(words.length, words.length - tail + around);
    return `${from > 0 ? "… " : ""}${words.slice(from, to).join(" ")}${to < words.length ? " …" : ""}`;
  };
  return { before: cut(a), now: cut(b) };
}

/**
 * Someone corrected the text of an item: who had answered on the old text and
 * should look again. The person who made the correction is not told.
 */
export function reviewersToNotifyAfterEdit(params: {
  itemId: string;
  decisions: ReviewDecision[];
  newHash: string;
  editor: string;
}): string[] {
  const editor = params.editor.trim().toLowerCase();
  return latestPerReviewer(params.decisions.filter((d) => d.itemId === params.itemId && isStance(d.status)))
    .filter((d) => d.textHash !== undefined && d.textHash !== params.newHash)
    .map((d) => d.reviewer)
    .filter((login) => login.trim().toLowerCase() !== editor);
}

export type RoundSummary = {
  items: ItemTally[];
  agreed: number;
  disputed: number;
  pending: number;
  /** The round closes when every item is agreed. */
  complete: boolean;
  /** Disputed items, with the positions already written: the agenda of a short meeting. */
  meeting: ItemTally[];
  /** Habilitadas who have answered nothing yet: who to remind. */
  waitingOn: string[];
};

export function summarizeRound(params: {
  itemIds: string[];
  decisions: ReviewDecision[];
  currentHashes?: Record<string, string>;
  levels: Record<string, PersonLevel>;
  authors: string[];
  /** Authors of one item only (for example whoever aligned that verse); added to `authors` for it. */
  authorsByItem?: Record<string, string[]>;
  thresholds: ReviewThresholds;
  /** People asked to take part; used to say who has not answered. */
  reviewers?: string[];
  /** Logins who may record the team's final decision. */
  confirmers?: string[];
}): RoundSummary {
  const items = params.itemIds.map((itemId) =>
    tallyItem({
      itemId,
      decisions: params.decisions,
      currentHash: params.currentHashes?.[itemId],
      levels: params.levels,
      authors: [...params.authors, ...(params.authorsByItem?.[itemId] ?? [])],
      thresholds: params.thresholds,
      confirmers: params.confirmers,
    }),
  );
  const agreed = items.filter((i) => i.state === "agreed").length;
  const disputed = items.filter((i) => i.state === "disputed").length;
  const answered = new Set(items.flatMap((i) => i.answers.map((a) => a.reviewer.trim().toLowerCase())));
  const waitingOn = (params.reviewers ?? []).filter((r) => !answered.has(r.trim().toLowerCase()));
  return {
    items,
    agreed,
    disputed,
    pending: items.length - agreed - disputed,
    complete: items.length > 0 && agreed === items.length,
    meeting: items.filter((i) => i.state === "disputed"),
    waitingOn,
  };
}

/** One file per person (`decisions/TIT.ana.decisions.json`) so two people never write the same file. */
export function decisionsFilePath(book: string, login: string): string {
  return `checkings/decisions/${book.trim().toUpperCase()}.${login.trim().toLowerCase()}.decisions.json`;
}

/** Everyone's files of a book read as one list. Answers are kept in time order. */
export function mergeDecisionFiles(files: CheckingDecisionsFile[]): ReviewDecision[] {
  return files
    .flatMap((file) => file.decisions as ReviewDecision[])
    .filter((d) => typeof d.itemId === "string" && d.itemId.length > 0)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}
