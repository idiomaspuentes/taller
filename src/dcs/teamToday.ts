import type { DcsIssue } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
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
  const projects: TodayProject[] = [];
  for (const row of index) {
    const [fromDcs, all] = await Promise.all([
      loadAssignmentsFromDcs(session, pmOrg, lang, row.projectId, contentOrg),
      listProjectIssues(session, pmOrg, row.projectId).catch(() => null),
    ]);
    if (!all) continue;
    const local = loadLocalAssignments(lang, row.projectId, contentOrg, pmOrg);
    const board =
      fromDcs && fromDcs.teams.length
        ? mergeLocalSolverBindings(fromDcs, local)
        : local.teams.length
          ? local
          : fromDcs ?? emptyAssignments(row.projectId, lang, contentOrg, pmOrg);
    if (!all.issues.length) continue;
    projects.push({ projectId: board.projectId || row.projectId, title: board.title || row.title || row.projectId, board, issues: all.issues });
  }
  return projects;
}
