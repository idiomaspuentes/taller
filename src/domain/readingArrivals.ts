import type { DcsIssue } from "@ip-lms/dcs-client";
import { passagesOf } from "./groupReading";
import { issueTaskId } from "./myTasks";
import { placeOf } from "./myTasksBoard";
import { chapterFromIssue } from "./solverLaunch";
import { getStepRuntime, parseTaskProgressMarker } from "./taskProgress";
import type { ProjectTask } from "./types";
import { parseWorkOrderMarker } from "./workOrder";
import { isExtraItemId } from "./extraWork";

/**
 * How much of a chapter reached its group reading: the work it reads arrives passage by passage, and Abel asked that
 * the card say how many passages are in and how many are missing (24 November). `waits.ts` stops telling as soon as
 * the first passage arrives, which is when the reading may start. Pure.
 */

export type ArrivedPassage = { from: number; to: number };
/** `who`: whoever has the passage's work open; absent when nobody took it. */
export type MissingPassage = { from: number; to: number; who?: string };
export type ReadingArrivals = {
  chapter: number;
  arrived: ArrivedPassage[];
  missing: MissingPassage[];
  arrivedVerses: number;
  totalVerses: number;
  /** Who joined the reading. */
  joined: string[];
};

/** `3:1–6` → verses 1 to 6; `3` → the whole chapter. Undefined for another chapter or no place at all. */
function rangeOf(place: string, chapter: number): { from: number; to: number } | undefined {
  const at = /^(\d+)(?::(\d+)(?:\s*[-–]\s*(\d+))?)?/.exec(place.trim());
  if (!at || Number(at[1]) !== chapter) return undefined;
  if (!at[2]) return { from: 1, to: Number.MAX_SAFE_INTEGER };
  const from = Number(at[2]);
  return { from, to: at[3] ? Number(at[3]) : from };
}

const verses = (rows: { from: number; to: number }[]) => rows.reduce((sum, row) => sum + row.to - row.from + 1, 0);

/**
 * The passages of a reading subtarea and which of them arrived. The work it reads is that of its first partial wait;
 * a passage is missing while an open subtarea of that work, in the same chapter, covers it. One that none covers was
 * closed, as `waits.ts` assumes: the subtareas of a chapter are published together. `undefined` when what is open is
 * not known, the task reads nothing partially, or the subtarea lists no passages.
 */
export function readingArrivals(issue: DcsIssue, task: ProjectTask, openIssues: DcsIssue[] | undefined): ReadingArrivals | undefined {
  if (!openIssues) return undefined;
  const source = (task.waitsFor ?? []).find((rule) => rule.partial && rule.taskId && !rule.source && !rule.open)?.taskId;
  const chapter = chapterFromIssue(issue);
  if (!source || !chapter) return undefined;
  const passages = passagesOf(parseWorkOrderMarker(issue.body ?? "")?.itemIds ?? [], chapter, 0);
  if (!passages.length) return undefined;
  const open = openIssues
    // Work added by hand afterwards (a correction of 3:12) is not a passage that has yet to arrive: it was delivered.
    .filter((other) => other.number !== issue.number && (other.state ?? "open").toLowerCase() !== "closed" && issueTaskId(other) === source && chapterFromIssue(other) === chapter && !(parseWorkOrderMarker(other.body ?? "")?.itemIds ?? []).some(isExtraItemId))
    .flatMap((other) => {
      const range = rangeOf(placeOf(other).place, chapter);
      const who = other.assignee?.login || other.assignees?.[0]?.login || undefined;
      return range ? [{ ...range, ...(who ? { who } : {}) }] : [];
    });
  const arrived: ArrivedPassage[] = [];
  const missing: MissingPassage[] = [];
  for (const passage of passages) {
    const covering = open.filter((row) => row.from <= passage.to && row.to >= passage.from);
    if (!covering.length) arrived.push({ from: passage.from, to: passage.to });
    else {
      const who = covering.find((row) => row.who)?.who;
      missing.push({ from: passage.from, to: passage.to, ...(who ? { who } : {}) });
    }
  }
  const progress = parseTaskProgressMarker(issue.body ?? "");
  const step = (task.steps ?? []).find((row) => !progress.doneStepIds.includes(row.id));
  return {
    chapter,
    arrived,
    missing,
    arrivedVerses: verses(arrived),
    totalVerses: verses(passages),
    joined: step ? getStepRuntime(progress, step.id).assignees : [],
  };
}
