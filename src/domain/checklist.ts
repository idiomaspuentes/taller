import type { ChecklistQuestion } from "./types";

/**
 * A step that closes by a checklist: every item (a note, a term, a question…) is checked with the yes/no questions
 * the process declares for that step. A «no» is settled by what the person does about it: they fix the item, create
 * what was missing, or ask the owner of something they may not change (and the item waits for the answer).
 * Nothing here knows what the items or the questions are.
 */

export type CheckOutcome = "fixed" | "created" | "consult";

export type CheckAnswer = {
  itemId: string;
  questionId: string;
  value: "yes" | "no";
  /** What was done about a «no». */
  outcome?: CheckOutcome;
  /** What was changed or created, or the reason given to the owner. */
  note?: string;
  /** A consultation that was answered: the item no longer waits. */
  resolved?: boolean;
  by: string;
  at: string;
  /** Fingerprint of the text the item was checked against. If the text changes later, the answer no longer counts. */
  textHash?: string;
};

export type CheckItemState = "ok" | "pending" | "open" | "consult";

export type CheckItem = {
  id: string;
  /** Where the item is, to ask the once-per-verse questions once. */
  verseKey: string;
};

export type CheckItemTally = {
  itemId: string;
  state: CheckItemState;
  /** The answer that counts for each question that applies to the item. */
  answers: Record<string, CheckAnswer | undefined>;
  /** Something was fixed or created for this item: it goes in the summary the team agrees on. */
  changed: boolean;
};

export type ChecklistSummary = {
  items: CheckItemTally[];
  done: number;
  complete: boolean;
  /** «No» with nothing done about it yet. */
  open: CheckItemTally[];
  /** Waiting for the owner's answer. */
  consulting: CheckItemTally[];
  /** What was fixed or created: the list the team goes over to agree. */
  changed: CheckItemTally[];
};

/** The id under which the once-per-verse questions of a verse are answered. */
export const verseItemId = (verseKey: string): string => `verse:${verseKey}`;

/** The latest answer for each item and question, whoever gave it. */
export function latestAnswers(answers: CheckAnswer[]): Map<string, CheckAnswer> {
  const out = new Map<string, CheckAnswer>();
  for (const answer of [...answers].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) out.set(`${answer.itemId}\u0000${answer.questionId}`, answer);
  return out;
}

function stateOf(answer: CheckAnswer | undefined): CheckItemState {
  if (!answer) return "pending";
  if (answer.value === "yes") return "ok";
  if (answer.outcome === "fixed" || answer.outcome === "created") return "ok";
  if (answer.outcome === "consult") return answer.resolved ? "ok" : "consult";
  return "open";
}

const RANK: Record<CheckItemState, number> = { ok: 0, pending: 1, consult: 2, open: 3 };

/**
 * How the checklist stands. Questions `per: "verse"` are asked once per verse, on the first item of that verse; the
 * rest are asked for every item.
 */
export function summarizeChecklist(params: {
  items: CheckItem[];
  questions: ChecklistQuestion[];
  answers: CheckAnswer[];
  /** The text of each verse now (by `verseKey`): an answer given on another text is set aside, so the item is checked again. */
  currentHashes?: Record<string, string>;
}): ChecklistSummary {
  const verseOf = new Map<string, string>();
  for (const item of params.items) {
    verseOf.set(item.id, item.verseKey);
    verseOf.set(verseItemId(item.verseKey), item.verseKey);
  }
  const current = (answer: CheckAnswer): boolean => {
    const now = params.currentHashes?.[verseOf.get(answer.itemId) ?? ""];
    return !now || !answer.textHash || answer.textHash === now;
  };
  const latest = latestAnswers(params.answers.filter(current));
  const perItem = params.questions.filter((q) => q.per !== "verse");
  const perVerse = params.questions.filter((q) => q.per === "verse");
  const firstOfVerse = new Set<string>();
  const seenVerse = new Set<string>();
  for (const item of params.items) {
    if (!seenVerse.has(item.verseKey)) {
      seenVerse.add(item.verseKey);
      firstOfVerse.add(item.id);
    }
  }
  const items: CheckItemTally[] = params.items.map((item) => {
    const answers: Record<string, CheckAnswer | undefined> = {};
    for (const q of perItem) answers[q.id] = latest.get(`${item.id}\u0000${q.id}`);
    if (firstOfVerse.has(item.id)) for (const q of perVerse) answers[q.id] = latest.get(`${verseItemId(item.verseKey)}\u0000${q.id}`);
    const states = Object.values(answers).map(stateOf);
    const state = states.reduce<CheckItemState>((worst, s) => (RANK[s] > RANK[worst] ? s : worst), "ok");
    const changed = Object.values(answers).some((a) => a?.value === "no" && (a.outcome === "fixed" || a.outcome === "created"));
    return { itemId: item.id, state, answers, changed };
  });
  const done = items.filter((i) => i.state === "ok").length;
  return {
    items,
    done,
    complete: items.length > 0 && done === items.length,
    open: items.filter((i) => i.state === "open"),
    consulting: items.filter((i) => i.state === "consult"),
    changed: items.filter((i) => i.changed),
  };
}

/** The questions that apply to an item, and under which id each is answered. */
export function questionsFor(item: CheckItem, items: CheckItem[], questions: ChecklistQuestion[]): { question: ChecklistQuestion; answerItemId: string }[] {
  const first = items.find((other) => other.verseKey === item.verseKey)?.id === item.id;
  return questions
    .filter((q) => q.per !== "verse" || first)
    .map((question) => ({ question, answerItemId: question.per === "verse" ? verseItemId(item.verseKey) : item.id }));
}
