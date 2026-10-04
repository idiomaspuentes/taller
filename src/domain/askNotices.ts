import type { DcsIssue } from "@ip-lms/dcs-client";
import { issueTaskId } from "./myTasks";
import type { AskedKind } from "./noticeText";
import { isStepDone, type TaskProgressMarker } from "./taskProgress";
import { isStepUnlocked, stepClaimMode } from "./stepClaim";
import type { AssignmentsDoc, ProjectTask } from "./types";
import { isWaiting, newlyEnabled } from "./waits";

/**
 * What the app asks the push Worker to tell, because Door43 does not announce it: Door43 only says «a comment was
 * written» and «a subtarea was assigned». That a subtarea became free for a team, that the step somebody waited for
 * is theirs now, that a step is free to take: only the app knows, at the moment somebody does the thing that causes
 * it. Pure: who is told and about what; sending is `src/dcs/notices.ts`.
 */

export type Ask = { kind: AskedKind; issue: number; to: string[]; step?: string; count?: number };

const logins = (issue: DcsIssue): string[] => [...new Set([issue.assignee?.login, ...(issue.assignees ?? []).map((a) => a.login)].filter((x): x is string => Boolean(x)))];
const taskOf = (issue: DcsIssue, board: Pick<AssignmentsDoc, "teams">): ProjectTask | undefined => board.teams.find((task) => task.id === issueTaskId(issue));
/** The people of the task's team, as the plan lists them. */
const team = (task: ProjectTask | undefined): string[] => [...new Set(task?.memberIds ?? [])];

/**
 * A step was completed. The next one that can be done now is somebody's turn: whoever sits on it, or whoever has the
 * subtarea when the step is not taken apart. A step people take that nobody sits on yet is free for the team (never
 * for those the step leaves out).
 */
export function afterStep(issue: DcsIssue, board: Pick<AssignmentsDoc, "teams">, before: TaskProgressMarker, after: TaskProgressMarker): Ask[] {
  const task = taskOf(issue, board);
  const steps = task?.steps ?? [];
  const done = steps.filter((step) => isStepDone(after, step.id) && !isStepDone(before, step.id));
  if (!done.length) return [];
  const next = steps.find((step) => !isStepDone(after, step.id) && isStepUnlocked(steps, after, step.id));
  if (!next) return [];
  if (stepClaimMode(next) === "none") {
    const to = logins(issue);
    return to.length ? [{ kind: "step-turn", issue: issue.number, to, step: next.name }] : [];
  }
  const seated = after.steps?.[next.id]?.assignees ?? [];
  if (seated.length) return [{ kind: "step-turn", issue: issue.number, to: seated, step: next.name }];
  const out = new Set((next.excludePriorStepIds ?? []).flatMap((id) => after.steps?.[id]?.assignees ?? (stepClaimMode(steps.find((s) => s.id === id) ?? next) === "none" ? logins(issue) : [])).map((l) => l.toLowerCase()));
  if (next.excludeIssueAssignee) for (const login of logins(issue)) out.add(login.toLowerCase());
  const to = team(task).filter((login) => !out.has(login.toLowerCase()));
  return to.length ? [{ kind: "step-free", issue: issue.number, to, step: next.name }] : [];
}

/**
 * A subtarea was closed. What it held back and nothing else holds now can start: whoever has it is told it is
 * their turn; one nobody has is free for its team. `openBefore` are the open subtareas of the project, the closed
 * one among them.
 */
export function afterClose(closed: DcsIssue, board: Pick<AssignmentsDoc, "teams">, openBefore: DcsIssue[]): Ask[] {
  const asks: Ask[] = [];
  for (const issue of newlyEnabled(closed, board, openBefore)) {
    const to = logins(issue);
    if (to.length) asks.push({ kind: "your-turn", issue: issue.number, to });
    else if (team(taskOf(issue, board)).length) asks.push({ kind: "free", issue: issue.number, to: team(taskOf(issue, board)) });
  }
  return asks;
}

/** A decision was opened for the team (an objection, a proposal): each of its people is asked for theirs. */
export function afterDecision(issue: DcsIssue, board: Pick<AssignmentsDoc, "teams">): Ask[] {
  const to = team(taskOf(issue, board));
  return to.length ? [{ kind: "decision", issue: issue.number, to }] : [];
}

/** A subtarea was given back to the team: it is free for them again. */
export function afterRelease(issue: DcsIssue, board: Pick<AssignmentsDoc, "teams">): Ask[] {
  const to = team(taskOf(issue, board));
  return to.length ? [{ kind: "free", issue: issue.number, to }] : [];
}

/**
 * Subtareas were created. Each person is told once, with how many are free for a team of theirs right now (those
 * that wait for other work are told when that work closes), not once per subtarea.
 */
export function afterPublish(created: DcsIssue[], board: Pick<AssignmentsDoc, "teams">, open: DcsIssue[]): Ask[] {
  const free = created.filter((issue) => issue.state !== "closed" && !logins(issue).length && !isWaiting(issue, board, open));
  const byPerson = new Map<string, DcsIssue[]>();
  for (const issue of free) for (const login of team(taskOf(issue, board))) byPerson.set(login, [...(byPerson.get(login) ?? []), issue]);
  // People with the same subtareas are told together, in one request.
  const groups = new Map<string, { issues: DcsIssue[]; to: string[] }>();
  for (const [login, issues] of byPerson) {
    const key = issues.map((issue) => issue.number).join(",");
    const group = groups.get(key) ?? { issues, to: [] };
    group.to.push(login);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({ kind: "free" as const, issue: group.issues[0]!.number, to: group.to, count: group.issues.length }));
}
