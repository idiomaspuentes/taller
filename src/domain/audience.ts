import { isDecisionIssue } from "./decisionAccess";
import type { DcsIssue } from "@ip-lms/dcs-client";
import type { GtSession } from "../dcs/auth";
import { isIssueAssignedTo, isIssueUnassigned } from "../dcs/issues";
import { issueTaskId } from "./myTasks";
import { levelRequirementText, meetsLevel, type PersonLevel } from "./levels";
import type { AssignmentsDoc } from "./types";
import { waitBlocks, waitReason } from "./waits";

/**
 * Who a subtarea is for, from one person's point of view.
 *
 * - `mine`: assigned to me (created for me, or I took it).
 * - `free`: nobody has it, and it belongs to a task of a team I am on.
 * - `other`: not for me.
 *
 * A subtarea that is `held` (it waits for other work, or asks for a level I
 * do not have yet) is shown but never announced: the notice comes when the
 * hold lifts, so nobody is called to work that cannot start.
 */
export type AudienceHold = { kind: "espera" | "nivel"; text: string };

export type Audience = {
  relation: "mine" | "free" | "other";
  hold?: AudienceHold;
  /** Worth a notice: for me, and nothing holds it back. */
  notify: boolean;
};

export type AudienceProject = {
  board: Pick<AssignmentsDoc, "teams" | "phases">;
  /** Open subtareas of the project; needed to know what still waits. */
  openIssues?: DcsIssue[];
};

/** Member of the org team linked to the task (managers do not count: they see everything anyway). */
function onTeamOfTask(session: Pick<GtSession, "teams">, pmOrg: string, orgTeamName: string | undefined): boolean {
  const name = orgTeamName?.trim();
  if (!name) return false;
  return (session.teams ?? []).some((t) => t.organization?.name === pmOrg && t.name === name);
}

export function audienceOf(params: {
  issue: DcsIssue;
  project: AudienceProject;
  session: Pick<GtSession, "username" | "teams">;
  pmOrg: string;
  myLevel?: PersonLevel;
}): Audience {
  const { issue, project, session, pmOrg, myLevel } = params;
  const taskId = issueTaskId(issue);
  const task = taskId ? project.board.teams.find((t) => t.id === taskId) : undefined;

  // A team decision belongs to everybody on the task's team (its people or its organization team).
  const decision = isDecisionIssue(issue);
  const me = session.username.trim().toLowerCase();
  const inTaskPeople = Boolean(task?.memberIds.some((m) => m.trim().toLowerCase() === me));
  let relation: Audience["relation"] = "other";
  if (isIssueAssignedTo(issue, session.username)) relation = "mine";
  else if (isIssueUnassigned(issue) && (onTeamOfTask(session, pmOrg, task?.orgTeamName) || (decision && inTaskPeople))) relation = "free";
  if (relation === "other") return { relation, notify: false };

  let hold: AudienceHold | undefined;
  const blocks = project.openIssues ? waitBlocks(issue, project.board, project.openIssues) : [];
  if (blocks.length) {
    hold = { kind: "espera", text: waitReason(blocks, project.board) };
  } else if (!decision && task?.minLevel && !meetsLevel(myLevel, task.minLevel)) {
    hold = { kind: "nivel", text: levelRequirementText(task.minLevel) };
  } else if (!meetsLevel(myLevel, undefined)) {
    // Oyente: watches, never gets work.
    hold = { kind: "nivel", text: "Solo observas" };
  }
  return { relation, hold, notify: !hold };
}
