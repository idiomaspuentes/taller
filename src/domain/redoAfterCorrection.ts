/**
 * What a corrected text asks to be done again. A team reviews a text in several tasks, one after another (its
 * challenges, its key terms, its alignment; then the helps against it, then a committee endorses it). A correction
 * that arrives when some of that is already delivered leaves it standing on a text that is no longer there: the
 * answers and the links go stale inside their tools, and nobody is asked to look again.
 *
 * So each task the process says so of (`TaskTemplate.redoAfter`) gets a subtarea of its own for the verses that
 * changed, added to the plan as the corrections of a committee are (`extraWork.ts`): it opens the tools of the
 * task on those verses alone, and waits for the tasks before it as any other subtarea of its task does.
 *
 * Nothing here names a process: which tasks, and for which texts, is read from the process package.
 */
import type { DcsIssue } from "@ip-lms/dcs-client";
import { addExtraWork, extraWorkOf } from "./extraWork";
import { issueTaskId } from "./myTasks";
import { chapterFromIssue } from "./solverLaunch";
import type { AssignmentsDoc, ExtraWork, ProjectSettings } from "./types";
import { parseRefRange } from "./usfmEdit";
import { parseWorkOrderMarker } from "./workOrder";

/** A text that was corrected: which one, where, and the decision of the team it came from. */
export type TextCorrected = {
  /** The resource of the process the text is (`tpl`, `tps`). */
  resource: string;
  chapter: number;
  from: number;
  to: number;
  /** The subtarea where the team decided the correction: what is asked again says so, and is told there. */
  decision?: number;
  by?: string;
};

/** «2:3», or «2:4-5» for verses written as one. */
export function correctedRef(corrected: Pick<TextCorrected, "chapter" | "from" | "to">): string {
  return `${corrected.chapter}:${corrected.from}${corrected.to > corrected.from ? `-${corrected.to}` : ""}`;
}

/** «Revisar de nuevo 2:3: se corrigió el texto». */
export function redoTitle(corrected: Pick<TextCorrected, "chapter" | "from" | "to">): string {
  return `Revisar de nuevo ${correctedRef(corrected)}: se corrigió el texto`;
}

/**
 * How the work of a task on some verses stands: `closed` when it was delivered, `open` while a subtarea that
 * covers them is still being worked on (or waits its turn), `none` when the task has nothing about them.
 */
export type WorkState = "closed" | "open" | "none";

/**
 * A subtarea covers the verses when it is about their passage; one asked for some verses alone (a correction, a
 * review asked again) covers only those. Without a passage on it, the chapter is what can be compared.
 */
function covers(issue: DcsIssue, settings: ProjectSettings | undefined, corrected: TextCorrected, portionId: string | undefined): boolean {
  const marker = parseWorkOrderMarker(issue.body ?? "");
  const own = extraWorkOf(settings, marker?.itemIds);
  const range = own?.ref ? parseRefRange(own.ref) : null;
  if (range) return range.chapter === corrected.chapter && range.from <= corrected.to && range.to >= corrected.from;
  const portions = marker?.portionIds ?? [];
  if (portions.length && portionId) return portions.includes(portionId);
  return chapterFromIssue(issue) === corrected.chapter;
}

/** How the work of a task on the corrected verses stands, from every subtarea of the project, open and closed. */
export function workStateOf(taskId: string, issues: DcsIssue[], settings: ProjectSettings | undefined, corrected: TextCorrected, portionId: string | undefined): WorkState {
  const mine = issues.filter((issue) => issueTaskId(issue) === taskId && covers(issue, settings, corrected, portionId));
  if (mine.some((issue) => (issue.state ?? "open").toLowerCase() !== "closed")) return "open";
  return mine.length ? "closed" : "none";
}

export type RedoPlan = {
  settings: ProjectSettings;
  /** The subtareas to publish: one for each task that had delivered its work on these verses. */
  added: ExtraWork[];
  /** Tasks still at work on these verses: nothing is added, their tools show what changed. */
  open: string[];
};

/**
 * The plan with a subtarea in each task that has to look at the corrected verses again. `taskIds` are the tasks
 * the process names for this text, in the order of the plan; one that had not delivered its work on those verses
 * gets none, since it will do it over the text as it is now.
 */
export function redoRows(
  board: Pick<AssignmentsDoc, "teams" | "settings">,
  taskIds: string[],
  corrected: TextCorrected,
  portionId: string | undefined,
  stateOf: (taskId: string) => WorkState,
): RedoPlan {
  let settings: ProjectSettings = board.settings ?? {};
  const had = new Set((settings.extraWork ?? []).map((row) => row.id));
  const wanted = new Set(taskIds);
  const open: string[] = [];
  const ref = correctedRef(corrected);
  for (const task of board.teams) {
    if (!wanted.has(task.id)) continue;
    const state = stateOf(task.id);
    if (state === "open") open.push(task.id);
    if (state !== "closed") continue;
    settings = addExtraWork(settings, {
      taskId: task.id,
      title: redoTitle(corrected),
      ...(portionId ? { portionId } : {}),
      ref,
      ...(corrected.by ? { askedBy: corrected.by } : {}),
      ...(corrected.decision ? { redoOf: corrected.decision } : {}),
    });
  }
  return { settings, added: (settings.extraWork ?? []).filter((row) => !had.has(row.id)), open };
}

/** The passage a verse is of, among the passages of the book. */
export function portionOfVerse(portions: { id: string; chapter: number; verses: number[] }[], corrected: Pick<TextCorrected, "chapter" | "from">): string | undefined {
  return portions.find((portion) => portion.chapter === corrected.chapter && portion.verses.includes(corrected.from))?.id;
}

/**
 * The phase that has a text in its hands: the earliest one, among the tasks that would look at it again, that
 * has begun its work on those verses (`begun`). A text is proposed to be changed from that phase or from a later
 * one, never from one before it: whoever read it in an earlier phase handed it over, and what they see is no
 * longer theirs to change. `undefined` while no such task has begun.
 */
export function phaseHolding(board: Pick<AssignmentsDoc, "teams" | "phases">, taskIds: string[], begun: (taskId: string) => boolean): { id: string; name: string; order: number } | undefined {
  const wanted = new Set(taskIds);
  const order = new Map(board.phases.map((phase) => [phase.id, phase]));
  return board.teams
    .filter((task) => wanted.has(task.id) && begun(task.id))
    .map((task) => order.get(task.phaseId))
    .filter((phase): phase is NonNullable<typeof phase> => Boolean(phase))
    .sort((a, b) => a.order - b.order)
    .map((phase) => ({ id: phase.id, name: phase.name, order: phase.order }))[0];
}

/** Whether a task may propose a change to a text some phase holds: its own phase is that one, or a later one. */
export function mayProposeFrom(board: Pick<AssignmentsDoc, "teams" | "phases">, fromTaskId: string, holding: { order: number } | undefined): boolean {
  if (!holding) return true;
  const from = board.teams.find((task) => task.id === fromTaskId);
  const phase = from ? board.phases.find((row) => row.id === from.phaseId) : undefined;
  // A task the plan does not know (a plan read before it was added) is not held back by a rule it cannot be placed in.
  return !phase || phase.order >= holding.order;
}
