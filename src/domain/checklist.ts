import type { ProposalPayload } from "./checkProposal";
import type { ChecklistQuestion } from "./types";

/**
 * A step that closes by a checklist: every item (a note, a term, a question…) is checked with the yes/no questions
 * the process declares for that step. A «no» is settled by proposing what should change (see `checkProposal`); the
 * item is then checked, and the proposal goes on to the team's agreement. Lists answered before that settled a
 * «no» by what the person had done about it: they fixed the item, created what was missing, or asked the owner of
 * something they may not change (and the item waited for the answer). Those answers still count.
 * Nothing here knows what the items or the questions are.
 */

export type CheckOutcome = "fixed" | "created" | "consult" | "proposal";

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
  /** What was proposed, when the «no» was settled by a proposal. */
  proposal?: ProposalPayload;
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
  /** What the item says, when known: some questions are only for an item that brings something (see `asksOf`). */
  text?: string;
  /** Whether the item links a support article, when known: some questions are about that article. */
  linked?: boolean;
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
  if (answer.outcome === "fixed" || answer.outcome === "created" || answer.outcome === "proposal") return "ok";
  if (answer.outcome === "consult") return answer.resolved ? "ok" : "consult";
  return "open";
}

const RANK: Record<CheckItemState, number> = { ok: 0, pending: 1, consult: 2, open: 3 };

/**
 * Whether a question is asked of an item: one that names what the item must bring (`when`) is not asked of an item
 * that does not bring it. An item whose text is not known is asked everything.
 */
export function asksOf(question: ChecklistQuestion, item: Pick<CheckItem, "text" | "linked">): boolean {
  if (question.linked && item.linked === false) return false;
  if (!question.when?.length || item.text === undefined) return true;
  const text = item.text.toLowerCase();
  return question.when.some((piece) => text.includes(piece.toLowerCase()));
}

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
    for (const q of perItem) if (asksOf(q, item)) answers[q.id] = latest.get(`${item.id}\u0000${q.id}`);
    if (firstOfVerse.has(item.id)) for (const q of perVerse) answers[q.id] = latest.get(`${verseItemId(item.verseKey)}\u0000${q.id}`);
    const states = Object.values(answers).map(stateOf);
    const state = states.reduce<CheckItemState>((worst, s) => (RANK[s] > RANK[worst] ? s : worst), "ok");
    const changed = Object.values(answers).some((a) => a?.value === "no" && (a.outcome === "fixed" || a.outcome === "created" || a.outcome === "proposal"));
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

export type ThreadLine = { by: string; at: string; body: string };

const REPLY_MAX = 200;

/**
 * What was answered to a consultation: the first thing somebody else said to whoever asked, after they asked, in
 * the conversation of the subtarea. The list went on saying «Consulta enviada» with the answer already given: it
 * was learned of in «Avisos», and the item had to be found again to mark it.
 */
export function consultReply(asked: Pick<CheckAnswer, "by" | "at">, thread: ThreadLine[]): { by: string; text: string } | null {
  const me = asked.by.trim().toLowerCase();
  if (!me) return null;
  const toMe = new RegExp(`@${me.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "i");
  const reply = thread
    .filter((line) => line.by.trim().toLowerCase() !== me && line.at > asked.at && toMe.test(line.body))
    .sort((a, b) => a.at.localeCompare(b.at))[0];
  if (!reply) return null;
  const text = reply.body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^(?:\s*@[\w-]+)+[\s,:]*/, "")
    .replace(/\s+/g, " ")
    .trim();
  return text ? { by: reply.by, text: text.length > REPLY_MAX ? `${text.slice(0, REPLY_MAX - 1).trimEnd()}…` : text } : null;
}

/** The questions that apply to an item, and under which id each is answered. */
export function questionsFor(item: CheckItem, items: CheckItem[], questions: ChecklistQuestion[]): { question: ChecklistQuestion; answerItemId: string }[] {
  const first = items.find((other) => other.verseKey === item.verseKey)?.id === item.id;
  return questions
    .filter((q) => (q.per === "verse" ? first : asksOf(q, item)))
    .map((question) => ({ question, answerItemId: question.per === "verse" ? verseItemId(item.verseKey) : item.id }));
}

// ---------------------------------------------------------------- a list asked in groups

export type CheckRow = { question: ChecklistQuestion; answerItemId: string };
/** The questions of an item that are read against the same thing. */
export type CheckGroup = { about: string; rows: CheckRow[] };

/**
 * The questions of an item by what each is read against (`about`), in the order the process first names each. A
 * help checked against two texts and its article is read once, a group at a time: what the group is read against
 * is put on screen and its few questions answered, and the next group follows. Questions that name nothing are one
 * group, which is a list as it always was.
 */
export function groupsOf(rows: CheckRow[]): CheckGroup[] {
  const out: CheckGroup[] = [];
  for (const row of rows) {
    const about = row.question.about ?? "";
    let group = out.find((other) => other.about === about);
    if (!group) out.push((group = { about, rows: [] }));
    group.rows.push(row);
  }
  return out;
}

/** The group to show: the one asked for when the item has it, else the first with something left to answer, else the first. */
export function groupInView(groups: CheckGroup[], answered: (questionId: string) => boolean, asked?: string): CheckGroup | undefined {
  return (asked === undefined ? undefined : groups.find((group) => group.about === asked)) ?? groups.find((group) => group.rows.some((row) => !answered(row.question.id))) ?? groups[0];
}

// ---------------------------------------------------------------- what a verse has a help for

/**
 * Which words of a verse the helps of that verse are about: for each word (by its place in the verse), the helps
 * whose phrase it is part of, in the order they are gone over. A question asked once per verse («does every
 * difficulty have a note?») is answered by looking at the verse, not at one note: what is covered is marked on it,
 * and what is not stands out by being plain.
 */
export function verseCoverage(helps: { id: string; words: number[] }[]): Map<number, string[]> {
  const covered = new Map<number, string[]>();
  for (const help of helps) {
    for (const word of new Set(help.words)) covered.set(word, [...(covered.get(word) ?? []), help.id]);
  }
  return covered;
}

/**
 * The help a touch on a word leads to: the first that is about it, or the one after the help in view when that is
 * about it too. So touching a word two helps share goes from one to the other and back.
 */
export function helpAtWord(covering: string[] | undefined, inView?: string): string | undefined {
  if (!covering?.length) return undefined;
  const at = inView ? covering.indexOf(inView) : -1;
  const next = covering[(at + 1) % covering.length];
  return next === inView ? undefined : next;
}
