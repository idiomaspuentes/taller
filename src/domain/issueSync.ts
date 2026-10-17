/**
 * The open subtareas of a project brought up to date from a list read before, with only what changed since then:
 * one page whatever the size of the book, where reading it whole grows with every phase open in it (17 October).
 * Door43 marks a subtarea as changed when somebody takes it, closes it, or changes its labels or its progress.
 */
type Changed = { number: number; state?: string | null };

/** How far back from the last reading changes are asked for: the two clocks, and what changed while it was read. */
export const SYNC_SLACK_MS = 10 * 60 * 1000;
/** Past this, the list is read whole again: what a change cannot tell (a subtarea moved to another book) is put right. */
export const SYNC_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export const changesSince = (at: string): string => new Date(Date.parse(at) - SYNC_SLACK_MS).toISOString();

/** Whether a list read at `at` can be brought up to date by its changes, or has to be read whole. */
export const canSyncFrom = (at: string | undefined, now: Date = new Date()): boolean => {
  const read = at ? Date.parse(at) : NaN;
  return Number.isFinite(read) && now.getTime() - read <= SYNC_MAX_AGE_MS && read <= now.getTime() + SYNC_SLACK_MS;
};

/**
 * The open list with its changes: one that closed leaves it, one that changed takes its place where it was, and
 * one new comes first (the newest first, as Door43 lists them).
 */
export function mergeChanged<T extends Changed>(known: T[], changed: T[]): T[] {
  const latest = new Map(changed.map((issue) => [issue.number, issue]));
  const open = (issue: T) => (issue.state ?? "open").toLowerCase() !== "closed";
  const kept = known.flatMap((issue) => {
    const now = latest.get(issue.number);
    if (!now) return [issue];
    return open(now) ? [now] : [];
  });
  const had = new Set(known.map((issue) => issue.number));
  const added = changed.filter((issue) => !had.has(issue.number) && open(issue));
  return [...added, ...kept];
}
