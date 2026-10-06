/**
 * The subtarea whose tool was just closed: «Mis tareas» is shown at its card instead of at the top of the list.
 * Whoever comes back from a tool comes back to what they were doing, and after a step is completed, what follows
 * is said on that card. Kept in memory for the one return: a reload starts at the top, as any first visit.
 */
let pending: number | null = null;

export function rememberReturnTo(issueNumber: number): void {
  pending = issueNumber > 0 ? issueNumber : null;
}

/** The subtarea to come back to, once: asking forgets it. */
export function takeReturnTo(): number | null {
  const number = pending;
  pending = null;
  return number;
}
