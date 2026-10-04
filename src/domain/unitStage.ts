/**
 * Which units go to their validation branch when a subtarea closes. The engine does not know which task validates:
 * a tool of the process says it works on the staged unit (`stagesUnit`), and a task one of whose steps opens that
 * tool is one whose subtareas need their unit staged before they start.
 */
import type { DcsIssue } from "@ip-lms/dcs-client";
import { issueTaskId } from "./myTasks";
import { chapterFromIssue } from "./solverLaunch";
import { DEFAULT_SOLVERS_CATALOG, type SolverApp } from "./solvers";
import type { AssignmentsDoc, ProjectTask } from "./types";
import { waitBlocks } from "./waits";
import { parseWorkOrderMarker } from "./workOrder";

export type StagingTask = { task: ProjectTask; resources: string[]; aligned: string[] };

/** The tasks of a board that work on a staged unit, with what each one stages. */
export function stagingTasks(board: Pick<AssignmentsDoc, "teams">, tools: SolverApp[] = DEFAULT_SOLVERS_CATALOG.solvers): StagingTask[] {
  const out: StagingTask[] = [];
  for (const task of board.teams) {
    const tool = (task.steps ?? []).map((step) => tools.find((row) => row.id === step.solverAppId)).find((row) => row?.stagesUnit);
    if (tool?.stagesUnit) out.push({ task, resources: tool.stagesUnit.resources, aligned: tool.stagesUnit.aligned ?? [] });
  }
  return out;
}

const placeOf = (issue: DcsIssue) => ({ book: (parseWorkOrderMarker(issue.body)?.book ?? "").toUpperCase(), chapter: chapterFromIssue(issue) });

/**
 * The open subtareas whose unit is to be staged now that `closed` closed: those of a staging task, of the same book
 * (and chapter, when both say one), that nothing holds back any more. `issues` are the project's, open and closed,
 * as they were read; `closed` may still say open in them.
 */
export function stagingSubtasks(
  board: Pick<AssignmentsDoc, "teams"> & Partial<Pick<AssignmentsDoc, "settings">>,
  issues: DcsIssue[],
  closed: DcsIssue,
  tools: SolverApp[] = DEFAULT_SOLVERS_CATALOG.solvers,
): { issue: DcsIssue; resources: string[]; aligned: string[] }[] {
  const staging = stagingTasks(board, tools);
  if (!staging.length) return [];
  const open = issues.filter((issue) => issue.state !== "closed" && issue.number !== closed.number);
  const where = placeOf(closed);
  const out: { issue: DcsIssue; resources: string[]; aligned: string[] }[] = [];
  for (const issue of open) {
    const row = staging.find((entry) => entry.task.id === issueTaskId(issue));
    if (!row) continue;
    const place = placeOf(issue);
    if (where.book && place.book && where.book !== place.book) continue;
    if (where.chapter && place.chapter && where.chapter !== place.chapter) continue;
    if (waitBlocks(issue, board, open).length) continue;
    out.push({ issue, resources: row.resources, aligned: row.aligned });
  }
  return out;
}
