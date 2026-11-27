import type { DcsIssue } from "@ip-lms/dcs-client";
import { issueProjectId } from "./myTasks";
import { parseTaskProgressMarker } from "./taskProgress";

/**
 * What a person did this week, for their profile («Lo que hiciste esta semana») (team report and Abel's decisions, 26–27 November 2026, #78): the
 * subtareas of theirs that were finished and the steps they closed, day by day, and what they finished by project
 * (closed projects too). Counted in things done, never in time; no streaks, points or comparisons.
 *
 * Steps come from the mark each closed step keeps (`done: {by, at}`). A step that is opened again loses it, so it is
 * not counted: counting it would be saying more than what stands.
 */
export type WeekDay = { date: Date; tasks: number; steps: number };
export type MyWeek = {
  /** Monday, 00:00, local time. */
  start: Date;
  days: WeekDay[];
  tasks: number;
  steps: number;
  /** The subtareas finished, by project, the project with the latest one first; each newest first. */
  projects: { projectId: string; issues: DcsIssue[] }[];
};

const DAY = 86_400_000;

/** The Monday of `now`'s week, at 00:00 local time. */
export function weekStart(now: Date): Date {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

const same = (a: string | undefined, b: string) => Boolean(a) && a!.trim().toLowerCase() === b.trim().toLowerCase();
const ownerOf = (issue: DcsIssue) => issue.assignee?.login || issue.assignees?.[0]?.login || "";

export function myWeek(issues: DcsIssue[], login: string, now: Date = new Date()): MyWeek {
  const start = weekStart(now);
  const days: WeekDay[] = Array.from({ length: 7 }, (_, i) => ({ date: new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), tasks: 0, steps: 0 }));
  const dayOf = (at: string | undefined | null): WeekDay | undefined => {
    const time = Date.parse(at ?? "");
    if (!Number.isFinite(time) || time < start.getTime() || time > now.getTime()) return undefined;
    return days.find((day, i) => time < (days[i + 1]?.date.getTime() ?? day.date.getTime() + DAY));
  };
  const finished = new Map<string, DcsIssue[]>();
  const seen = new Set<number>();
  for (const issue of issues) {
    if (seen.has(issue.number)) continue;
    seen.add(issue.number);
    if ((issue.state ?? "").toLowerCase() === "closed" && same(ownerOf(issue), login)) {
      const day = dayOf(issue.closed_at);
      if (day) {
        day.tasks += 1;
        const project = issueProjectId(issue) || "";
        finished.set(project, [...(finished.get(project) ?? []), issue]);
      }
    }
    for (const runtime of Object.values(parseTaskProgressMarker(issue.body ?? undefined).steps ?? {})) {
      if (!runtime.done || !same(runtime.done.by, login)) continue;
      const day = dayOf(runtime.done.at);
      if (day) day.steps += 1;
    }
  }
  const closedAt = (issue: DcsIssue) => Date.parse(issue.closed_at ?? "");
  const projects = [...finished.entries()]
    .map(([projectId, list]) => ({ projectId, issues: list.sort((a, b) => closedAt(b) - closedAt(a)) }))
    .sort((a, b) => closedAt(b.issues[0]!) - closedAt(a.issues[0]!));
  return {
    start,
    days,
    tasks: days.reduce((n, day) => n + day.tasks, 0),
    steps: days.reduce((n, day) => n + day.steps, 0),
    projects,
  };
}
