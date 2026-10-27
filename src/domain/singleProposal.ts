import type { CheckAnswer } from "./checklist";
import type { ProposalView } from "./checkProposal";

/**
 * One proposal per note (Abel, 27 October): a team that disagreed with a proposal wrote another one, and ended up
 * voting between two or three similar texts instead of writing one together. Now what anybody else writes about a
 * note that already has a proposal is an adjustment to it, which its author accepts or not; whoever coordinates the
 * team settles what stays in dispute. Read here; `proposalsOf` (by agreement of all) applies it.
 */

/**
 * From when a proposal written beside another one is read as an adjustment to it. Notes that had two or more
 * proposals before keep them as options until they are resolved: the team may already have chosen among them.
 */
export const SINGLE_PROPOSAL_FROM = "2026-10-28T00:00:00Z";

/** The row by which the author of a proposal (or whoever coordinates the team) does not accept an adjustment. */
export const ADJUSTMENT_SAYS = "@ajuste";

export function adjustmentDeclined(adjustmentId: string, by: string, at: string, note?: string): CheckAnswer {
  return { itemId: adjustmentId, questionId: ADJUSTMENT_SAYS, value: "no", by, at, ...(note?.trim() ? { note: note.trim() } : {}) };
}

/**
 * What a person says of one question of a proposal (27 October): a proposal is checked as the note is, with the
 * step's questions, instead of being chosen with a touch. `versionId` is the version they read.
 */
export function proposalMark(versionId: string, questionId: string, by: string, at: string, value: "yes" | "no", note?: string): CheckAnswer {
  return { itemId: versionId, questionId, value, by, at, ...(note?.trim() ? { note: note.trim() } : {}) };
}

/**
 * Which of the proposals of one item are its options and which adjust one of them. `roots`: the first version of
 * each chain of versions, oldest first. `live`: whether a chain still stands (not taken back, not carried out).
 * `rootOf`: the chain a version belongs to. `declined`: an adjustment its option's author did not accept, which is
 * not the proposal even if that option is taken back.
 *
 * An adjustment names the version it was written over (`suggests`). One that names none, written since
 * `SINGLE_PROPOSAL_FROM` when the item already had a proposal (two people proposing at once), adjusts the first
 * option. When the option an adjustment was written for is taken back, the first adjustment still waiting is the
 * proposal, and the rest adjust it.
 */
export function optionsAndAdjustments(
  roots: ProposalView[],
  live: (rootId: string) => boolean,
  rootOf: (versionId: string) => string,
  declined: (rootId: string) => boolean = () => false,
): { options: string[]; adjusts: Map<string, string> } {
  const options: string[] = [];
  const adjusts = new Map<string, string>();
  for (const root of roots) {
    const id = root.proposal.id;
    if (!live(id)) continue;
    const target = root.proposal.suggests ? rootOf(root.proposal.suggests) : undefined;
    const option = target === undefined ? undefined : options.includes(target) ? target : adjusts.get(target);
    if (option) adjusts.set(id, option);
    else if ((root.proposal.suggests || root.at >= SINGLE_PROPOSAL_FROM) && options.length) adjusts.set(id, options[0]!);
    else if (!(root.proposal.suggests && declined(id))) options.push(id);
  }
  return { options, adjusts };
}
