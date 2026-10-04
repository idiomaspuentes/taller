import type { DcsIssue } from "@ip-lms/dcs-client";
import { coordinatorsOf } from "../domain/levels";
import { issueTaskId } from "../domain/myTasks";
import { ownerTaskOf } from "../domain/resourceOwner";
import { buildSolverLaunchContext } from "../domain/solverLaunch";
import { stagingSubtasks } from "../domain/unitStage";
import type { AssignmentsDoc } from "../domain/types";
import { problemLine } from "../unitProblemText";
import type { GtSession } from "./auth";
import { commentOnIssue, listProjectIssues } from "./issues";
import { loadUnitToPublish, stageUnit, unitProblems, type StageOutcome } from "./unitPublish";

type Where = { session: GtSession; pmOrg: string; lang: string; contentOrg: string; board: AssignmentsDoc };

export type StagedUnit = { issue: number; outcomes: StageOutcome[]; problems: number };

/**
 * Put the unit of one validation subtarea on its validation branch. A unit that does not pass the checks (a verse
 * missing, a note badly formed) is not staged: what is wrong is written in the conversation of that subtarea, for
 * whoever maintains each resource, and the committee is not handed something it would have to send back at once.
 */
export async function stageUnitOf(params: Where & { issue: DcsIssue; resources: string[]; aligned: string[] }): Promise<StagedUnit | null> {
  const { session, pmOrg, lang, contentOrg, board, issue } = params;
  const ctx = buildSolverLaunchContext({ username: session.username, lang, pmOrg, contentOrg, board, issue });
  if (!ctx) return null;
  const unit = await loadUnitToPublish({ session, ctx, resources: params.resources });
  const problems = unitProblems(unit, { aligned: params.aligned, endorsement: null, needsEndorsement: false });
  if (problems.length) {
    const byOwner = new Map<string, string[]>();
    for (const problem of problems) {
      const owner = ownerTaskOf(problem.resource, board, unit.task);
      const who = coordinatorsOf(unit.levelBook, owner?.orgTeamName).map((login) => `@${login}`).join(" ") || owner?.name || "";
      byOwner.set(who, [...(byOwner.get(who) ?? []), `- ${problemLine(problem, board)}`]);
    }
    const body = [`La unidad ${unit.book} ${ctx.ref || unit.chapter} todavía no pasó a validación: hay algo que corregir antes.`, ...[...byOwner].map(([who, lines]) => `\n${who}\n${lines.join("\n")}`)].join("\n");
    await commentOnIssue(session, pmOrg, issue.number, body).catch(() => undefined);
    return { issue: issue.number, outcomes: [], problems: problems.length };
  }
  return { issue: issue.number, outcomes: await stageUnit({ session, unit, note: ctx.issueUrl || `#${issue.number}` }), problems: 0 };
}

/**
 * After a subtarea closes: every validation subtarea of that book and chapter that can start now has its unit put
 * on the validation branch. It covers the two moments a unit moves there: the last work before validation closes
 * (the unit arrives), and a correction the committee asked for closes (the unit is renewed, and the committee sees
 * it again). Staging only writes what differs, so doing it again costs nothing. It never undoes the close.
 */
export async function stageUnitsAfterClose(params: Where & { issue: DcsIssue }): Promise<StagedUnit[]> {
  const { session, pmOrg, board, issue } = params;
  const projectId = board.projectId || board.book;
  if (!projectId) return [];
  const { issues } = await listProjectIssues(session, pmOrg, projectId);
  const staged: StagedUnit[] = [];
  for (const row of stagingSubtasks(board, issues, issue)) {
    if (issueTaskId(row.issue) === issueTaskId(issue)) continue;
    const done = await stageUnitOf({ ...params, issue: row.issue, resources: row.resources, aligned: row.aligned }).catch(() => null);
    if (done) staged.push(done);
  }
  return staged;
}
