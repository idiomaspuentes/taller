/**
 * The subtarea whose tool was just closed: «Mis tareas» is shown at its card instead of at the top of the list.
 * Whoever comes back from a tool comes back to what they were doing, and after a step is completed, what follows
 * is said on that card. Kept in memory for the one return: a reload starts at the top, as any first visit.
 *
 * A tool may also say what it left to do on the way back (`then`): a draft was just finished, so the list offers
 * the next passage; or the author asked to hand the text to the group, so the list hands it in (one place does).
 * Lost with a reload too: the card then reads «Falta entregar» first in «En curso», so nothing is hidden.
 */
export type ReturnThen = "finished" | "deliver";

let pending: number | null = null;
let then: { issue: number; then: ReturnThen } | null = null;

/** Said by a tool at the very moment it closes to go back to the list, never before something that may open another tool. */
export function markThen(issueNumber: number, what: ReturnThen): void {
  then = issueNumber > 0 ? { issue: issueNumber, then: what } : null;
}

export function rememberReturnTo(issueNumber: number): void {
  pending = issueNumber > 0 ? issueNumber : null;
  // What a tool said of another subtarea does not come along.
  if (then && then.issue !== pending) then = null;
}

/** The subtarea to come back to, and what its tool left to do, once: asking forgets both. */
export function takeReturnTo(): { issue: number; then?: ReturnThen } | null {
  const issue = pending;
  const what = then && then.issue === issue ? then.then : undefined;
  pending = null;
  then = null;
  return issue ? { issue, ...(what ? { then: what } : {}) } : null;
}
