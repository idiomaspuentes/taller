import { useEffect } from "react";
import type { DcsIssue } from "@ip-lms/dcs-client";
import type { GtSession } from "./dcs/auth";
import { sweepDecisionReminders } from "./dcs/alignmentDecisionStore";
import { loadPmConfig } from "./dcs/issues";
import { isDecisionIssue } from "./domain/decisionAccess";
import { inProposalList } from "./domain/proposalList";
import { issueTaskId } from "./domain/myTasks";
import type { AssignmentsDoc } from "./domain/types";

type Project = { projectId?: string; board: Pick<AssignmentsDoc, "teams">; issues: DcsIssue[] };

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
      // A project set aside reminds nobody: its decisions wait as they are until it is resumed.
      const paused = new Set((await loadPmConfig(session, pmOrg).catch(() => null))?.paused ?? []);
      for (const project of projects) {
        if (cancelled) return;
        if (project.projectId && paused.has(project.projectId.toUpperCase())) continue;
        await sweepDecisionReminders({
          session,
          pmOrg,
          issues: project.issues,
          // The proposals of a list are not reminded one by one: a book's list was a mention per verse.
          isDecision: (issue) => isDecisionIssue(issue) && !inProposalList(issue),
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
