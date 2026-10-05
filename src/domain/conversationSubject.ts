/**
 * Thread header data (plan §3, §8.5): title, task, current step and the
 * mini-app to open. Generic: reads the manager's plan and `solvers.json`,
 * never the resource type.
 */
import type { DcsIssue } from "@ip-lms/dcs-client";
import { teamPhaseLabel } from "./assignment";
import { issueTaskId } from "./myTasks";
import { findSolverApp, resolveSolverForIssue, type SolverApp, type SolversCatalog } from "./solvers";
import { parseTaskProgressMarker } from "./taskProgress";
import type { AssignmentsDoc, TaskStep } from "./types";

export type ConversationHeader = {
  title: string;
  taskLabel: string;
  step?: TaskStep;
  assignees: string[];
  /** Who is seated on the step in hand (its reviewers): its tool is theirs to open too. */
  stepPeople: string[];
  solver?: SolverApp;
};

export function conversationHeader(
  issue: DcsIssue,
  board: AssignmentsDoc | null,
  catalog: SolversCatalog,
): ConversationHeader {
  const taskId = issueTaskId(issue);
  const task = board && taskId ? board.teams.find((t) => t.id === taskId) : undefined;
  const steps = task?.steps ?? [];
  const progress = parseTaskProgressMarker(issue.body ?? "");
  const step = steps.find((s) => !progress.doneStepIds.includes(s.id));
  const solver =
    findSolverApp(catalog, step?.solverAppId) ||
    findSolverApp(catalog, task?.solverAppId) ||
    (board && !steps.length ? resolveSolverForIssue(catalog, board, issue) : undefined);
  const assignees = [
    ...new Set(
      [issue.assignee?.login, ...(issue.assignees ?? []).map((a) => a.login)].filter(
        (l): l is string => Boolean(l),
      ),
    ),
  ];
  return {
    title: issue.title,
    taskLabel: task ? teamPhaseLabel(task) : "",
    ...(step ? { step } : {}),
    assignees,
    stepPeople: step ? (progress.steps?.[step.id]?.assignees ?? []) : [],
    ...(solver ? { solver } : {}),
  };
}
