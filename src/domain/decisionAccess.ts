import type { DcsIssue } from "@ip-lms/dcs-client";
import type { GtSession } from "../dcs/auth";
import { issueTaskId } from "./myTasks";
import type { AssignmentsDoc } from "./types";
import { parseWorkOrderMarker } from "./workOrder";

/** A subtarea opened so the whole team can decide something (see `alignmentDecision.ts`). */
export function isDecisionIssue(issue: Pick<DcsIssue, "body">): boolean {
  return Boolean(parseWorkOrderMarker(issue.body)?.key.includes("|decision:"));
}

/**
 * Whether this person belongs to the team of the task the subtarea is under: they are in
 * the task's people, or in its organization team. Used to open a team decision, which
 * nobody has assigned, to the people who have to vote on it.
 */
export function isTeamMemberOfIssue(session: Pick<GtSession, "username" | "teams">, pmOrg: string, board: Pick<AssignmentsDoc, "teams"> | null | undefined, issue: DcsIssue): boolean {
  const me = session.username.trim().toLowerCase();
  const task = board?.teams.find((t) => t.id === issueTaskId(issue));
  if (!me || !task) return false;
  if (task.memberIds.some((m) => m.trim().toLowerCase() === me)) return true;
  return Boolean(task.orgTeamName) && (session.teams ?? []).some((t) => t.organization?.name === pmOrg && t.name === task.orgTeamName);
}

/** Team members may open a team decision; any other subtarea opens only for its people or a gestor. */
export function opensAsTeamDecision(session: Pick<GtSession, "username" | "teams">, pmOrg: string, board: Pick<AssignmentsDoc, "teams"> | null | undefined, issue: DcsIssue): boolean {
  return isDecisionIssue(issue) && isTeamMemberOfIssue(session, pmOrg, board, issue);
}
