import type { CheckAnswer } from "./checklist";
import { ITEM_SAYS, PROPOSAL_DECIDED, type ProposalView } from "./checkProposal";
import { ADJUSTMENT_SAYS } from "./singleProposal";
import type { StepRow } from "./noteSituation";

/**
 * The conversation of a note (Abel, 27 October): one for all its steps, with the messages of everybody and, as
 * short lines, what each person did (reviewed it, agreed, proposed, adjusted, said «no»), each with the step it is
 * about. It was a fold at the foot of the note, and what was decided was a count beside it.
 */

export type TimelineEntry =
  | { kind: "message"; by: string; at: string; text: string; step?: string }
  /** «Yes» to every question of a step, of the note as it is; the first person to do it reviewed it. */
  | { kind: "reviewed"; by: string; at: string; step: string; first: boolean }
  /** The same, of a version of a proposal. */
  | { kind: "agreed"; by: string; at: string; step: string }
  | { kind: "saidNo"; by: string; at: string; step?: string }
  | { kind: "proposed" | "changed" | "suggested" | "accepted" | "declined"; by: string; at: string; view: ProposalView }
  | { kind: "decided"; by: string; at: string; apply: boolean };

/** A step of the note: what its questions are about, and where each is answered. */
export type NoteStep = { about: string; rows: StepRow[] };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Every entry of the conversation of `itemId`, oldest first, and where what is new for `me` begins: the first entry
 * by somebody else after the last of theirs (-1 when there is nothing after it, or when they have done nothing).
 */
export function noteTimeline(p: { me: string; itemId: string; answers: CheckAnswer[]; proposals: ProposalView[]; steps: NoteStep[] }): { entries: TimelineEntry[]; newFrom: number } {
  const rows = [...p.answers].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const views = p.proposals.filter((view) => view.proposal.rowId === p.itemId || view.itemId === p.itemId);
  const byId = new Map(views.map((view) => [view.proposal.id, view]));
  const stepOf = (questionId: string) => p.steps.find((step) => step.rows.some((row) => row.questionId === questionId))?.about;
  const entries: TimelineEntry[] = [];

  for (const view of views) {
    const kind = view.adjusts || view.proposal.suggests ? "suggested" : view.proposal.accepts ? "accepted" : view.proposal.replaces && byId.has(view.proposal.replaces) ? "changed" : "proposed";
    entries.push({ kind, by: view.by, at: view.at, view });
  }

  // Each person's «yes» to the note's questions and marks of each version, as the reading goes: a step completed is a line.
  const noteSlots = new Map(p.steps.flatMap((step) => step.rows.map((row) => [`${row.answerItemId}\u0000${row.questionId}`, step.about] as const)));
  const said = new Map<string, "yes" | "no">();
  const done = new Set<string>();
  const reviewedSteps = new Set<string>();
  const complete = (prefix: string, step: { rows: StepRow[] }, versionId?: string) =>
    step.rows.every((row) => said.get(`${prefix}\u0000${versionId ?? row.answerItemId}\u0000${row.questionId}`) === "yes");

  for (const row of rows) {
    const who = row.by.trim().toLowerCase();
    if (row.questionId === ITEM_SAYS && row.itemId === p.itemId && row.note) {
      entries.push({ kind: "message", by: row.by, at: row.at, text: row.note, ...(row.step ? { step: row.step } : {}) });
      continue;
    }
    const view = byId.get(row.itemId);
    if (view && row.questionId === ADJUSTMENT_SAYS && row.value === "no") {
      entries.push({ kind: "declined", by: row.by, at: row.at, view });
      continue;
    }
    if (view && row.questionId === PROPOSAL_DECIDED) {
      entries.push({ kind: "decided", by: row.by, at: row.at, apply: row.value === "yes" });
      continue;
    }
    if (row.questionId.startsWith("@")) continue;
    // A mark on a version of a proposal.
    if (view) {
      const key = `${who}\u0000${row.itemId}\u0000${row.questionId}`;
      if (row.cleared) said.delete(key);
      else said.set(key, row.value);
      if (row.value === "no" && !row.cleared) {
        const step = stepOf(row.questionId);
        entries.push({ kind: "saidNo", by: row.by, at: row.at, ...(step ? { step } : {}) });
      }
      for (const step of p.steps) {
        const mark = `${who}\u0000${row.itemId}\u0000${step.about}`;
        const now = step.rows.some((one) => one.questionId === row.questionId) && complete(who, step, row.itemId);
        if (now && !done.has(mark)) entries.push({ kind: "agreed", by: row.by, at: row.at, step: step.about });
        if (now) done.add(mark);
        else if (step.rows.some((one) => one.questionId === row.questionId)) done.delete(mark);
      }
      continue;
    }
    // An answer to a question of the note as it is.
    const about = noteSlots.get(`${row.itemId}\u0000${row.questionId}`);
    if (about === undefined) continue;
    const key = `${who}\u0000${row.itemId}\u0000${row.questionId}`;
    if (row.cleared) said.delete(key);
    else said.set(key, row.value === "yes" ? "yes" : "no");
    const step = p.steps.find((one) => one.about === about)!;
    const mark = `${who}\u0000note\u0000${about}`;
    const now = complete(who, step);
    if (now && !done.has(mark)) {
      entries.push({ kind: "reviewed", by: row.by, at: row.at, step: about, first: !reviewedSteps.has(about) });
      reviewedSteps.add(about);
    }
    if (now) done.add(mark);
    else done.delete(mark);
  }

  entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  let mine = -1;
  entries.forEach((entry, index) => {
    if (same(entry.by, p.me)) mine = index;
  });
  const newFrom = mine < 0 ? -1 : entries.findIndex((entry, index) => index > mine && !same(entry.by, p.me));
  return { entries, newFrom };
}
