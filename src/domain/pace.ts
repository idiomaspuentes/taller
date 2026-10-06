import type { DcsIssue } from "@ip-lms/dcs-client";
import type { AssignmentsDoc } from "./types";
import { issueFraction } from "./workProgress";

/**
 * The pace of a project: how many subtareas are finished per week, and when it would end going on like that.
 * Read from when each subtarea was closed, which Door43 has kept from the start, so it also speaks of work done
 * before anything else was measured.
 */

const WEEK_MS = 7 * 86_400_000;

/** The pace is taken over this many weeks: long enough not to follow one good day, short enough to follow a change. */
export const PACE_WEEKS = 4;

export type Pace = {
  /** Subtareas finished in each of the last weeks, the oldest first; the last is the seven days up to now. */
  weeks: number[];
  /** Subtareas finished per week, over the weeks measured. */
  perWeek: number;
  /** How much is left, in subtareas: one half done counts for half. */
  left: number;
  /** When it would end at this pace. Absent with nothing left, or nothing finished in the weeks measured. */
  endsAt?: string;
};

export function paceOf(issues: DcsIssue[], board: Pick<AssignmentsDoc, "teams">, now: Date, shown = 8): Pace {
  const weeks = Array.from({ length: shown }, () => 0);
  let left = 0;
  let first = Number.POSITIVE_INFINITY;
  for (const issue of issues) {
    const fraction = issueFraction(issue, board);
    if (fraction === null) continue;
    const created = Date.parse(issue.created_at ?? "");
    if (Number.isFinite(created)) first = Math.min(first, created);
    left += 1 - fraction;
    const closed = issue.state === "closed" ? Date.parse(issue.closed_at ?? "") : Number.NaN;
    if (!Number.isFinite(closed) || closed > now.getTime()) continue;
    const ago = Math.floor((now.getTime() - closed) / WEEK_MS);
    if (ago < shown) weeks[shown - 1 - ago]! += 1;
  }
  // A project younger than the weeks measured is measured over the weeks it has: two subtareas in its first week
  // are two a week, not half of one.
  const age = Number.isFinite(first) ? Math.ceil((now.getTime() - first) / WEEK_MS) : PACE_WEEKS;
  const span = Math.min(PACE_WEEKS, shown, Math.max(1, age));
  const perWeek = weeks.slice(-span).reduce((sum, count) => sum + count, 0) / span;
  const endsAt = left > 0 && perWeek > 0 ? new Date(now.getTime() + (left / perWeek) * WEEK_MS).toISOString() : undefined;
  return { weeks, perWeek, left, ...(endsAt ? { endsAt } : {}) };
}

/**
 * The day a project would end, as it is said: «18 de octubre», and with its year when it is not this one. Without
 * the year, a project a year from its end read as ending in twelve days.
 */
export function endDateText(endsAt: string, language: string, now: Date = new Date()): string {
  const day = new Date(endsAt);
  return day.toLocaleDateString(language, { day: "numeric", month: "long", ...(day.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
}

/** A pace as it is said: «5», «2,5», «0,3» — never «0» of something that moves. */
export function paceNumber(perWeek: number, language: string): string {
  if (!(perWeek > 0)) return "0";
  const rounded = perWeek >= 10 ? Math.round(perWeek) : Math.max(0.1, Math.round(perWeek * 10) / 10);
  return rounded.toLocaleString(language, { maximumFractionDigits: 1 });
}
