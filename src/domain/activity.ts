import type { DcsIssue } from "@ip-lms/dcs-client";
import { parseTaskProgressMarker } from "./taskProgress";
import type { AssignmentsDoc } from "./types";
import { issueFraction } from "./workProgress";

/**
 * How much a person has worked, and when. Two things are read, and neither is kept by Taller:
 *
 * - **When**, from Door43: it counts what each person does (every save of a draft, every comment, every review) in
 *   stretches of fifteen minutes. A stretch with something done in it is a stretch worked.
 * - **What**, from the plan: the steps the person closed and the subtareas they finished.
 *
 * Door43 counts all a person does there, in any organization: somebody who also works elsewhere on Door43 has that
 * counted too. And it sees what is saved, not what is read: an hour of study with nothing written leaves no trace.
 */

/** One stretch as Door43 gives it: when it starts (seconds since 1970, UTC) and how many things were done in it. */
export type HeatSlot = { timestamp: number; contributions: number };

export const SLOT_MINUTES = 15;
const DAY_MS = 86_400_000;

export type DayWork = {
  /** The day where the person reading lives: `2026-10-06`. */
  day: string;
  /** Minutes worked: the stretches with something done in them. */
  minutes: number;
  /** When the first stretch starts and the last one ends, in milliseconds. */
  from: number;
  to: number;
};

/** Minutes to add to UTC to have the hour of whoever is reading, at that moment (it changes with summer time). */
const zoneAt = (ms: number) => -new Date(ms).getTimezoneOffset();

/** The day a moment falls on, as `YYYY-MM-DD`, for a reader `offset` minutes from UTC. */
export function dayOf(ms: number, offset = zoneAt(ms)): string {
  return new Date(ms + offset * 60_000).toISOString().slice(0, 10);
}

/** The days worked, each with its minutes and between which hours. */
export function workDays(slots: HeatSlot[], offset?: number): Map<string, DayWork> {
  const days = new Map<string, DayWork>();
  for (const slot of slots) {
    const from = Number(slot?.timestamp) * 1000;
    if (!Number.isFinite(from) || !(Number(slot.contributions) > 0)) continue;
    const day = dayOf(from, offset);
    const to = from + SLOT_MINUTES * 60_000;
    const row = days.get(day);
    if (row) days.set(day, { day, minutes: row.minutes + SLOT_MINUTES, from: Math.min(row.from, from), to: Math.max(row.to, to) });
    else days.set(day, { day, minutes: SLOT_MINUTES, from, to });
  }
  return days;
}

/** How strongly a day is drawn: nothing, up to half an hour, an hour, two hours, more. */
export function workLevel(minutes: number): 0 | 1 | 2 | 3 | 4 {
  if (!(minutes > 0)) return 0;
  if (minutes <= 30) return 1;
  if (minutes <= 60) return 2;
  if (minutes <= 120) return 3;
  return 4;
}

export type CalendarDay = { day: string; minutes: number; level: 0 | 1 | 2 | 3 | 4; future: boolean };

/**
 * The last weeks as a calendar is read: one column a week, Monday at the top, the week in course last (with the
 * days still to come marked as such).
 */
export function calendarWeeks(days: Map<string, DayWork>, now: Date, weeks: number, offset?: number): CalendarDay[][] {
  const today = dayOf(now.getTime(), offset);
  const noon = Date.parse(`${today}T12:00:00Z`);
  // Monday = 0 … Sunday = 6.
  const weekday = (new Date(noon).getUTCDay() + 6) % 7;
  const monday = noon - weekday * DAY_MS;
  return Array.from({ length: weeks }, (_, week) =>
    Array.from({ length: 7 }, (_, index) => {
      const day = new Date(monday - (weeks - 1 - week) * 7 * DAY_MS + index * DAY_MS).toISOString().slice(0, 10);
      const minutes = days.get(day)?.minutes ?? 0;
      return { day, minutes, level: workLevel(minutes), future: day > today };
    }),
  );
}

/** The last `span` days one after another, today last: the same days `workSummary` sums. */
export function lastDays(days: Map<string, DayWork>, now: Date, span: number, offset?: number): CalendarDay[] {
  const noon = Date.parse(`${dayOf(now.getTime(), offset)}T12:00:00Z`);
  return Array.from({ length: span }, (_, index) => {
    const day = new Date(noon - (span - 1 - index) * DAY_MS).toISOString().slice(0, 10);
    const minutes = days.get(day)?.minutes ?? 0;
    return { day, minutes, level: workLevel(minutes), future: false };
  });
}

export type WorkSummary = { days: number; minutes: number };

/** The days worked and the minutes, over the last `span` days counting today. */
export function workSummary(days: Map<string, DayWork>, now: Date, span: number, offset?: number): WorkSummary {
  const today = dayOf(now.getTime(), offset);
  const since = new Date(Date.parse(`${today}T12:00:00Z`) - (span - 1) * DAY_MS).toISOString().slice(0, 10);
  let count = 0;
  let minutes = 0;
  for (const row of days.values()) {
    if (row.day < since || row.day > today) continue;
    count += 1;
    minutes += row.minutes;
  }
  return { days: count, minutes };
}

/** The days worked among the last `span`, the latest first. */
export function recentDays(days: Map<string, DayWork>, now: Date, span: number, offset?: number): DayWork[] {
  const today = dayOf(now.getTime(), offset);
  const since = new Date(Date.parse(`${today}T12:00:00Z`) - (span - 1) * DAY_MS).toISOString().slice(0, 10);
  return [...days.values()].filter((row) => row.day >= since && row.day <= today).sort((a, b) => b.day.localeCompare(a.day));
}

export type PersonWork = {
  login: string;
  /** Steps the person closed since `since`. */
  steps: number;
  /** Subtareas of theirs finished since `since`. */
  finished: number;
  /** Subtareas they have in hand now. */
  inHand: number;
};

const assigneeOf = (issue: DcsIssue) => issue.assignee?.login || issue.assignees?.[0]?.login || "";

/**
 * What each person did in the plan since a day: the steps they closed and the subtareas of theirs that were
 * finished, and what they have in hand. Everyone the subtareas name, the busiest first.
 */
export function peopleWork(issues: DcsIssue[], board: Pick<AssignmentsDoc, "teams">, since: Date): PersonWork[] {
  const people = new Map<string, PersonWork>();
  const of = (login: string) => {
    const key = login.trim().toLowerCase();
    if (!key) return null;
    let row = people.get(key);
    if (!row) people.set(key, (row = { login: login.trim(), steps: 0, finished: 0, inHand: 0 }));
    return row;
  };
  for (const issue of issues) {
    const fraction = issueFraction(issue, board);
    if (fraction === null) continue;
    const owner = of(assigneeOf(issue));
    if (issue.state === "closed") {
      if (owner && Date.parse(issue.closed_at ?? "") >= since.getTime()) owner.finished += 1;
    } else if (owner) owner.inHand += 1;
    for (const runtime of Object.values(parseTaskProgressMarker(issue.body ?? undefined).steps ?? {})) {
      // Whoever sits on a step is of the team's work too, even with nothing closed yet.
      runtime.assignees.forEach(of);
      const closer = runtime.done ? of(runtime.done.by) : null;
      if (closer && Date.parse(runtime.done!.at) >= since.getTime()) closer.steps += 1;
    }
  }
  return [...people.values()].sort((a, b) => b.steps + b.finished - (a.steps + a.finished) || b.inHand - a.inHand || a.login.localeCompare(b.login));
}

/** Several projects' people as one list: a person is the same one in all of them. */
export function mergePeople(lists: PersonWork[][]): PersonWork[] {
  const people = new Map<string, PersonWork>();
  for (const row of lists.flat()) {
    const key = row.login.toLowerCase();
    const had = people.get(key);
    people.set(key, had ? { login: had.login, steps: had.steps + row.steps, finished: had.finished + row.finished, inHand: had.inHand + row.inHand } : row);
  }
  return [...people.values()].sort((a, b) => b.steps + b.finished - (a.steps + a.finished) || b.inHand - a.inHand || a.login.localeCompare(b.login));
}
