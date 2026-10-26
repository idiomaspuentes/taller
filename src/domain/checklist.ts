import type { ProposalPayload, ProposalView } from "./checkProposal";
import { ITEM_SAYS } from "./checkProposal";
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
  /** The answer was taken back (a line ticked by mistake, touched again): its question is to be answered again. */
  cleared?: true;
  /** What was proposed, when the «no» was settled by a proposal. */
  proposal?: ProposalPayload;
  by: string;
  at: string;
  /** Fingerprint of the text the item was checked against. If the text changes later, the answer no longer counts. */
  textHash?: string;
  /**
   * What a message of the conversation of an item is said of: one of the options for it, by the id of the first
   * version of its proposal, or `KEEP_OPTION` (21 October: a conversation of its own for each option).
   */
  about?: string;
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
  /** Which article it links: the questions asked once per article (`per: "article"`) are answered for it once. */
  article?: string;
  /**
   * A stop of its own for a verse, after its last help (see `withVerseStops`): the questions asked once per verse
   * are answered there, with every help of the verse read.
   */
  stop?: true;
};

/**
 * What a team said of one question of an item, when the list is decided by several people (see `agreement` in
 * `summarizeChecklist`): who said it is right, the proposals still to be decided, and whether it is settled.
 */
export type CheckSlot = {
  /** Who said it is right, each once, in the order they said it. */
  yesBy: string[];
  /** The proposals made on it that are still to be decided. */
  open: ProposalView[];
  /** Those of them some are for and some against: the team has to come to an agreement on them (21 October). */
  disputed: ProposalView[];
  /** A proposal made on it was decided: agreed, carried out, or left aside by the team. */
  decided: boolean;
  /** Everybody who said something of it: that it is right, a proposal, or for or against one. */
  voices: string[];
  settled: boolean;
};

/** Whose turn an item is, for the person looking: theirs to give an opinion, nobody's yet, or the others'. */
export type CheckTurn = "mine" | "new" | "waiting" | "done";

export type CheckItemTally = {
  itemId: string;
  state: CheckItemState;
  /** The answer that counts for each question that applies to the item. */
  answers: Record<string, CheckAnswer | undefined>;
  /** Decided by several people: what each of them said of each question, and whose turn it is. */
  slots?: Record<string, CheckSlot>;
  turn?: CheckTurn;
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
/** The id under which the once-per-article questions of an article are answered. */
export const articleItemId = (article: string): string => `article:${article}`;
/** Where an item answers a question: its own id, its verse's or its article's. */
function answeredAt(question: ChecklistQuestion, item: CheckItem): string {
  return question.per === "verse" ? verseItemId(item.verseKey) : question.per === "article" && item.article ? articleItemId(item.article) : item.id;
}

/**
 * The walk of a list with a stop for each verse after its last help, where the questions asked once per verse
 * (`per: "verse"`) are answered: whether every difficulty of the verse has its help. They were asked on its first
 * help, before the others had been read, and what was underlined (the words each help quotes) did not say what each
 * resolves: a long quote resolves one of its words, and one word may need two notes (20 October). A list with no such
 * question has no stops.
 */
export function withVerseStops(items: CheckItem[], questions: ChecklistQuestion[]): CheckItem[] {
  if (!questions.some((q) => q.per === "verse")) return items;
  const out: CheckItem[] = [];
  items.forEach((item, at) => {
    out.push(item);
    if (items[at + 1]?.verseKey !== item.verseKey && !item.stop) out.push({ id: verseItemId(item.verseKey), verseKey: item.verseKey, stop: true });
  });
  return out;
}

/** The latest answer for each item and question, whoever gave it. */
export function latestAnswers(answers: CheckAnswer[]): Map<string, CheckAnswer> {
  const out = new Map<string, CheckAnswer>();
  for (const answer of [...answers].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) out.set(`${answer.itemId}\u0000${answer.questionId}`, answer);
  for (const [key, answer] of out) if (answer.cleared) out.delete(key);
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
  /**
   * The list is decided by several people (21 October): each question of an item is settled when `people` of them
   * said it is right, or when a proposal made on it was decided (`proposals`, as `proposalsOf` reads them); a
   * proposal still to be decided keeps it open. One person who found nothing to change was the whole decision, and
   * the team never saw it. `me`: whose turn each item is, said for this person.
   */
  agreement?: { people: number; proposals: ProposalView[]; me?: string };
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
  const slotOf = params.agreement ? slotsOf(params.answers.filter(current), params.agreement) : undefined;
  const perItem = params.questions.filter((q) => q.per !== "verse");
  const perVerse = params.questions.filter((q) => q.per === "verse");
  // With stops for the verses (see `withVerseStops`), each verse's questions are its stop's; else its first help's.
  const stops = params.items.some((item) => item.stop);
  const firstOfVerse = new Set<string>();
  const seenVerse = new Set<string>();
  for (const item of params.items) {
    if (!stops && !seenVerse.has(item.verseKey)) {
      seenVerse.add(item.verseKey);
      firstOfVerse.add(item.id);
    }
  }
  // What was said of an article's question on one of the notes that link it, before it was asked once per article:
  // it still counts, for that note and for the others, so a list half done does not open again (20 October).
  const saidOfArticle = new Map<string, CheckAnswer>();
  for (const item of params.items) {
    if (!item.article) continue;
    for (const q of perItem) {
      if (q.per !== "article") continue;
      const own = latest.get(`${item.id}\u0000${q.id}`);
      const key = `${articleItemId(item.article)}\u0000${q.id}`;
      if (own && (!saidOfArticle.has(key) || Date.parse(own.at) > Date.parse(saidOfArticle.get(key)!.at))) saidOfArticle.set(key, own);
    }
  }
  const items: CheckItemTally[] = params.items.map((item) => {
    const answers: Record<string, CheckAnswer | undefined> = {};
    if (item.stop) for (const q of perVerse) answers[q.id] = latest.get(`${item.id}\u0000${q.id}`);
    else for (const q of perItem) if (asksOf(q, item)) answers[q.id] = latest.get(`${answeredAt(q, item)}\u0000${q.id}`) ?? (q.per === "article" && item.article ? saidOfArticle.get(`${articleItemId(item.article)}\u0000${q.id}`) : undefined);
    if (firstOfVerse.has(item.id)) for (const q of perVerse) answers[q.id] = latest.get(`${verseItemId(item.verseKey)}\u0000${q.id}`);
    const changed = Object.values(answers).some((a) => a?.value === "no" && (a.outcome === "fixed" || a.outcome === "created" || a.outcome === "proposal"));
    if (slotOf) {
      // Each question by what everybody said of it, where it is answered (the item's own id, its verse's or its article's).
      const slots: Record<string, CheckSlot> = {};
      for (const qid of Object.keys(answers)) {
        const q = params.questions.find((one) => one.id === qid)!;
        slots[qid] = slotOf(item.stop ? item.id : answeredAt(q, item), qid);
      }
      const all = Object.values(slots);
      const waiting = Object.values(answers).some((a) => a?.outcome === "consult" && !a.resolved);
      const state: CheckItemState = waiting ? "consult" : all.every((slot) => slot.settled) ? "ok" : "pending";
      const me = (params.agreement!.me ?? "").trim().toLowerCase();
      const unsettled = all.filter((slot) => !slot.settled);
      // In a disagreement each side answers the other: it is one's turn while the last word is not of one's side.
      const disputed = unsettled.flatMap((slot) => slot.disputed).filter((view) => [...view.inFavour, ...view.against].some((who) => who.toLowerCase() === me));
      const lastBy = disputed.length ? lastWordOn(params.answers, item.id, disputed)?.trim().toLowerCase() : undefined;
      const sideOf = (who: string) => disputed.find((view) => view.choices)?.choices?.[who] ?? (disputed.find((view) => view.against.some((one) => one.toLowerCase() === who)) ? "against" : disputed.find((view) => view.inFavour.some((one) => one.toLowerCase() === who)) ? "for" : "");
      // One whose option changed since they chose it has to look at it again.
      const stale = unsettled.some((slot) => slot.open.some((view) => view.staleFor?.includes(me)));
      const lastWord = lastBy !== undefined && sideOf(lastBy) !== sideOf(me) ? lastBy : undefined;
      const turn: CheckTurn = !unsettled.length
        ? "done"
        : unsettled.some((slot) => slot.voices.length && !slot.voices.some((who) => who.toLowerCase() === me)) || lastWord !== undefined || stale
          ? "mine"
          : unsettled.some((slot) => !slot.voices.length)
            ? "new"
            : "waiting";
      return { itemId: item.id, state, answers, changed, slots, turn };
    }
    const states = Object.values(answers).map(stateOf);
    const state = states.reduce<CheckItemState>((worst, s) => (RANK[s] > RANK[worst] ? s : worst), "ok");
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

/**
 * What everybody said of each question, read once for a whole list: the last answer of each person to it, the
 * proposals made on it, and whether it is settled (see `agreement` in `summarizeChecklist`).
 */
function slotsOf(answers: CheckAnswer[], agreement: { people: number; proposals: ProposalView[] }): (answerItemId: string, questionId: string) => CheckSlot {
  // Each person's last answer to each question; one taken back is no answer.
  const mine = new Map<string, CheckAnswer>();
  for (const answer of [...answers].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const key = `${answer.itemId}\u0000${answer.questionId}\u0000${answer.by.trim().toLowerCase()}`;
    if (answer.cleared) mine.delete(key);
    else mine.set(key, answer);
  }
  const bySlot = new Map<string, CheckAnswer[]>();
  for (const [key, answer] of mine) {
    const slot = key.slice(0, key.lastIndexOf("\u0000"));
    bySlot.set(slot, [...(bySlot.get(slot) ?? []), answer]);
  }
  const views = new Map(agreement.proposals.map((view) => [view.proposal.id, view]));
  // A proposal belongs to every question its author answered with it (one proposal may answer several).
  const proposalsAt = new Map<string, ProposalView[]>();
  for (const answer of answers) {
    const view = answer.outcome === "proposal" && answer.proposal?.id ? views.get(answer.proposal.id) : undefined;
    if (!view || view.state === "withdrawn" || view.state === "replaced") continue;
    const slot = `${answer.itemId}\u0000${answer.questionId}`;
    const there = proposalsAt.get(slot) ?? [];
    if (!there.includes(view)) proposalsAt.set(slot, [...there, view]);
  }
  return (answerItemId, questionId) => {
    const slot = `${answerItemId}\u0000${questionId}`;
    const rows = (bySlot.get(slot) ?? []).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    // Something done about a «no» before lists were decided by several (fixed, created, a consultation answered)
    // is what that person said: that it is right now.
    const yesBy = rows.filter((row) => row.value === "yes" || row.outcome === "fixed" || row.outcome === "created" || (row.outcome === "consult" && row.resolved)).map((row) => row.by);
    const made = proposalsAt.get(slot) ?? [];
    const open = made.filter((view) => view.state === "open");
    const decided = made.some((view) => view.state === "agreed" || view.state === "applied" || view.state === "sent" || view.state === "rejected");
    const voices: string[] = [];
    for (const who of [...yesBy, ...made.flatMap((view) => [...view.inFavour, ...view.against])]) {
      if (!voices.some((one) => one.toLowerCase() === who.toLowerCase())) voices.push(who);
    }
    const waiting = rows.some((row) => row.outcome === "consult" && !row.resolved);
    const settled = !waiting && !open.length && (decided || yesBy.length >= agreement.people);
    // Some for it and some against it; or, decided by agreement of all, more than one option chosen.
    const disputed = open.filter((view) => (view.choices ? Boolean(view.disputedSince) : view.inFavour.length > 0 && view.against.length > 0));
    return { yesBy, open, disputed, decided, voices, settled };
  };
}

/** Who said something last of an item's disagreement: wrote in its conversation, adjusted a proposal, or took a side. */
function lastWordOn(answers: CheckAnswer[], itemId: string, disputed: ProposalView[]): string | undefined {
  const ids = new Set(disputed.map((view) => view.proposal.id));
  const at = Math.max(...disputed.map((view) => Date.parse(view.at)));
  let last: CheckAnswer | undefined;
  for (const row of answers) {
    const about = (row.itemId === itemId && row.questionId === ITEM_SAYS) || ids.has(row.itemId) || (row.outcome === "proposal" && row.proposal && ids.has(row.proposal.id));
    if (about && Date.parse(row.at) >= at && (!last || Date.parse(row.at) >= Date.parse(last.at))) last = row;
  }
  return last?.by;
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
  if (item.stop) return questions.filter((q) => q.per === "verse").map((question) => ({ question, answerItemId: item.id }));
  const first = !items.some((other) => other.stop) && items.find((other) => other.verseKey === item.verseKey)?.id === item.id;
  return questions
    .filter((q) => (q.per === "verse" ? first : asksOf(q, item)))
    .map((question) => ({ question, answerItemId: answeredAt(question, item) }));
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
