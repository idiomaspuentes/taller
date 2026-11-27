import type { DcsIssue } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { closeSubtask, type CloseSubtaskResult } from "./closeSubtask";
import { markPhaseIfClosed } from "./phaseMarks";
import { archiveSharedDraft, ensurePortionPr } from "./portionPr";
import { notifyNextBook } from "./startBook";
import { stageUnitsAfterClose } from "./unitStage";
import { taskHasOwnDraft } from "../domain/branchNames";
import { issueTaskId } from "../domain/myTasks";
import { recordOwnClose } from "../domain/pendingEvents";
import { buildSolverLaunchContext } from "../domain/solverLaunch";
import type { AssignmentsDoc } from "../domain/types";

/**
 * Hands a subtarea in: its draft goes into the team's text (or, for a task on the shared draft, its mark is left),
 * it is closed, and what it held back can start. «Mis tareas» does it on «Entregar»; the peer review does it when
 * the reviewer approves a step that hands in on its own (`TaskStep.reviewerHandsIn`, #85).
 *
 * `nextBook`: tell whoever coordinates when this delivery calls for the next book (false when a later book is
 * already open). Neither that nor what follows the close undoes it.
 */
export async function handInSubtask(params: {
  session: GtSession;
  pmOrg: string;
  lang: string;
  contentOrg: string;
  board: AssignmentsDoc;
  issue: DcsIssue;
  nextBook: boolean;
  onStaging?: () => void;
}): Promise<CloseSubtaskResult> {
  const { session, pmOrg, lang, contentOrg, board, issue } = params;
  const resource = (buildSolverLaunchContext({ username: session.username, lang, pmOrg, contentOrg, board, issue })?.resource || "").toLowerCase();
  const result = await closeSubtask({
    session,
    pmOrg,
    issue,
    resource,
    lang,
    sharedDraft: !taskHasOwnDraft(board.teams, issueTaskId(issue)),
    archiveShared: () => archiveSharedDraft({ session, pmOrg, lang, contentOrg, board, issue }),
    // What a close leaves behind, each on its own: the mark of a phase that ended, and the units that can go to their
    // validation branch now. Neither undoes the close.
    afterClose: async () => {
      await markPhaseIfClosed({ session, pmOrg, lang, contentOrg, board, issue }).catch(() => null);
      await stageUnitsAfterClose({ session, pmOrg, lang, contentOrg, board, issue, onStart: params.onStaging }).catch(() => []);
    },
    ensurePr: async () => (await ensurePortionPr({ session, pmOrg, lang, contentOrg, board, issue })).issue,
  });
  recordOwnClose({ host: session.host, username: session.username, pmOrg }, issue.number);
  // Books overlap by phase: when this delivery is the one that calls for the next book, whoever coordinates is told.
  if (params.nextBook) void notifyNextBook({ session, pmOrg, board, issueNumber: issue.number }).catch(() => undefined);
  return result;
}
