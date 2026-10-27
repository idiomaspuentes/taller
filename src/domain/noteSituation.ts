import type { CheckAnswer } from "./checklist";
import { ITEM_SAYS, proposalSaying, type ProposalView } from "./checkProposal";
import { SINGLE_PROPOSAL_FROM, proposalMark } from "./singleProposal";

/**
 * Where a step of a note stands for whoever looks at it (Abel, 27 October): whether they open it, with the first
 * criterion; or collaborate on what somebody else said, confirming a review, reviewing a proposal, or answering a
 * question. A note somebody had reviewed looked like a new one, and a proposal was something to vote for or against.
 */

/** Where a question of the step is answered: the item's own id, its verse's or its article's. */
export type StepRow = { answerItemId: string; questionId: string };

export type NoteSituation =
  | { kind: "first" }
  /** Others said «yes» to every question of the step, of the note as it is. */
  | { kind: "confirm"; by: string[] }
  | { kind: "proposal"; head: ProposalView; author: string; since: string; agreed: string[]; doubts: string[] }
  | { kind: "ownProposal"; head: ProposalView; since: string; agreed: string[]; doubts: string[] }
  /** Somebody wrote and waits for an answer; with a proposal on the note, it is still what is reviewed. */
  | { kind: "asked"; by: string; at: string; text: string; head?: ProposalView; author?: string }
  /** Two or more proposals from before one proposal per note: chosen among, as before. */
  | { kind: "options" };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const byTime = (rows: CheckAnswer[]) => [...rows].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

/**
 * The situation of a step for `me`. `options`: the live proposals of the note (heads of their versions, without
 * adjustments), as `proposalsOf` reads them by agreement of all. Asked first, since what somebody wrote waits for an
 * answer; then a proposal, which is what every step reviews; then a review to confirm; else this person opens it.
 */
export function noteSituation(p: { me: string; itemId: string; stepRows: StepRow[]; answers: CheckAnswer[]; options: ProposalView[] }): NoteSituation {
  const rows = byTime(p.answers);
  const versions = new Set(p.options.flatMap((view) => [view.proposal.id, view.option ?? view.proposal.id]));
  const aboutNote = (row: CheckAnswer) => row.itemId === p.itemId || versions.has(row.itemId) || row.proposal?.rowId === p.itemId || p.stepRows.some((step) => step.answerItemId === row.itemId);
  const myLast = rows.filter((row) => same(row.by, p.me) && aboutNote(row)).pop();
  const said = rows.filter((row) => row.questionId === ITEM_SAYS && row.itemId === p.itemId && row.note).pop();
  // Notes with two or more proposals from before stay as they were, a list of options, whatever is said of them.
  if (p.options.length > 1) return { kind: "options" };
  const head = p.options[0];
  if (said && !same(said.by, p.me) && (!myLast || Date.parse(said.at) > Date.parse(myLast.at))) return { kind: "asked", by: said.by, at: said.at, text: said.note!, ...(head ? { head, author: head.optionBy ?? head.by } : {}) };
  if (head) {
    const author = head.optionBy ?? head.by;
    const since = head.optionAt ?? head.at;
    const agreed = head.inFavour;
    const doubts = head.noBy ?? [];
    return same(author, p.me) ? { kind: "ownProposal", head, since, agreed, doubts } : { kind: "proposal", head, author, since, agreed, doubts };
  }
  // Each person's last answer to each question of the step; one taken back is none.
  const last = new Map<string, CheckAnswer>();
  const slots = new Set(p.stepRows.map((step) => `${step.answerItemId}\u0000${step.questionId}`));
  for (const row of rows) {
    if (!slots.has(`${row.itemId}\u0000${row.questionId}`)) continue;
    const key = `${row.itemId}\u0000${row.questionId}\u0000${row.by.trim().toLowerCase()}`;
    if (row.cleared) last.delete(key);
    else last.set(key, row);
  }
  const people = [...new Set([...last.values()].map((row) => row.by))].filter((who) => !same(who, p.me));
  const by = people.filter((who) => p.stepRows.length > 0 && p.stepRows.every((step) => last.get(`${step.answerItemId}\u0000${step.questionId}\u0000${who.trim().toLowerCase()}`)?.value === "yes"));
  return by.length ? { kind: "confirm", by } : { kind: "first" };
}

/**
 * What «Estoy de acuerdo» writes in a step (27 October): «yes» to each of its questions, of the note as it is; or,
 * with a proposal, the marks of its version (its author does not mark the questions it was proposed from). An option
 * begun before one proposal per note answers only its own questions: the others are said «yes» of the note too, or
 * they would stay open. A proposal with no questions to check it with is agreed to as before.
 */
export function agreementRows(p: { me: string; at: string; situation: NoteSituation; stepRows: StepRow[]; proposalQuestions: string[] }): CheckAnswer[] {
  const s = p.situation;
  if (s.kind === "first" || s.kind === "confirm") return p.stepRows.map((step) => ({ itemId: step.answerItemId, questionId: step.questionId, value: "yes" as const, by: p.me, at: p.at }));
  if (s.kind !== "proposal" && s.kind !== "ownProposal") return [];
  if (!p.proposalQuestions.length) return [proposalSaying(s.head.proposal.id, p.me, p.at, true)];
  const origin = s.head.origin ?? [];
  const marks = p.stepRows
    .filter((step) => p.proposalQuestions.includes(step.questionId) && !(s.kind === "ownProposal" && origin.includes(step.questionId)))
    .map((step) => proposalMark(s.head.proposal.id, step.questionId, p.me, p.at, "yes"));
  // Said «yes» of the note: what the proposal is not checked with (a question asked once per article or per verse),
  // and, of an option from before, what it does not answer.
  const old = s.since < SINGLE_PROPOSAL_FROM;
  const ofNote = p.stepRows
    .filter((step) => !p.proposalQuestions.includes(step.questionId) || (old && !origin.includes(step.questionId)))
    .map((step) => ({ itemId: step.answerItemId, questionId: step.questionId, value: "yes" as const, by: p.me, at: p.at }));
  return [...marks, ...ofNote];
}
