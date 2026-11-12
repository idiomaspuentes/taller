import { DcsApiError, getRawContent, type DcsIssue } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import { doneElsewherePath, emptyDoneElsewhere, normalizeDoneElsewhere, type DoneElsewhereDoc } from "../domain/doneElsewhere";
import { PM_REPO_NAME } from "../domain/types";
import { listProjectIssues } from "./issues";
import { listPmProjects, loadAssignmentsFromDcs } from "./persist";
import { mergeLocalSolverBindings } from "../domain/myTasks";
import { emptyAssignments, loadLocalAssignments } from "../domain/store";
import type { AssignmentsDoc } from "../domain/types";

export type TodayProject = {
  projectId: string;
  title: string;
  board: AssignmentsDoc;
  /** Every subtarea of the project, open and closed. */
  issues: DcsIssue[];
};

/** Every project of the organization with its plan and all of its subtareas. Read only. */
export async function loadTeamToday(params: {
  session: GtSession;
  pmOrg: string;
  lang: string;
  contentOrg: string;
}): Promise<TodayProject[]> {
  const { session, pmOrg, lang, contentOrg } = params;
  const index = await listPmProjects(session, pmOrg, lang);
  // Every book at once (Door43 is asked a few pages at a time anyway): one after another, the wait grew with each
  // book the team had (9 November 2026).
  const read = await Promise.all(
    index.map(async (row): Promise<TodayProject | null> => {
      const [fromDcs, all] = await Promise.all([
        loadAssignmentsFromDcs(session, pmOrg, lang, row.projectId, contentOrg),
        listProjectIssues(session, pmOrg, row.projectId).catch(() => null),
      ]);
      if (!all) return null;
      const local = loadLocalAssignments(lang, row.projectId, contentOrg, pmOrg);
      const board =
        fromDcs && fromDcs.teams.length
          ? mergeLocalSolverBindings(fromDcs, local)
          : local.teams.length
            ? local
            : fromDcs ?? emptyAssignments(row.projectId, lang, contentOrg, pmOrg);
      if (!all.issues.length) return null;
      return { projectId: board.projectId || row.projectId, title: board.title || row.title || row.projectId, board, issues: all.issues };
    }),
  );
  return read.filter((project): project is TodayProject => project !== null);
}

/**
 * The record of the work the space did before Taller (`doneElsewhere.ts`). A space without one has done nothing
 * elsewhere; a record that could not be read is not the same, and says so (the panels show the books of Taller only).
 */
export async function loadDoneElsewhere(session: GtSession, pmOrg: string, lang: string): Promise<DoneElsewhereDoc | null> {
  try {
    const raw = await getRawContent(dcsConfig(session.host), pmOrg, PM_REPO_NAME, doneElsewherePath(lang), { token: session.token });
    return normalizeDoneElsewhere(JSON.parse(raw));
  } catch (err) {
    if (err instanceof DcsApiError && err.status === 404) return emptyDoneElsewhere();
    return null;
  }
}
