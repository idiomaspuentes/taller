import { useEffect } from "react";
import type { DcsIssue } from "@ip-lms/dcs-client";
import type { GtSession } from "./dcs/auth";
import { sweepDecisionReminders } from "./dcs/alignmentDecisionStore";
import { isDecisionIssue } from "./domain/decisionAccess";
import { issueTaskId } from "./domain/myTasks";
import type { AssignmentsDoc } from "./domain/types";

type Project = { board: Pick<AssignmentsDoc, "teams">; issues: DcsIssue[] };

/**
 * When somebody of the team opens the app, the decisions that are near their deadline remind the
 * people who have not voted (see `sweepDecisionReminders`). It is quiet: nothing is shown here; the
 * reminder is a comment with a mention, so it reaches the notices of the people it names.
 */
export function useDecisionReminders(session: GtSession | undefined, pmOrg: string, projects: Project[]): void {
  useEffect(() => {
    if (!session?.token || !pmOrg || !projects.length) return;
    let cancelled = false;
    void (async () => {
      for (const project of projects) {
        if (cancelled) return;
        await sweepDecisionReminders({
          session,
          pmOrg,
          issues: project.issues,
          isDecision: isDecisionIssue,
          teamOf: (issue) => project.board.teams.find((t) => t.id === issueTaskId(issue))?.memberIds ?? [],
          teamNameOf: (issue) => project.board.teams.find((t) => t.id === issueTaskId(issue))?.orgTeamName,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, pmOrg, projects]);
}
