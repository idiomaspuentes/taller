import type { GtSession } from "./auth";
import { closeSubtask } from "./closeSubtask";
import { markPhaseIfClosed } from "./phaseMarks";
import { archiveSharedDraft, getPmIssue } from "./portionPr";
import { stageUnitsAfterClose } from "./unitStage";
import { issueTaskId } from "../domain/myTasks";
import { recordOwnClose } from "../domain/pendingEvents";
import { deliverableFromTool } from "../domain/stepClaim";
import { parseTaskProgressMarker } from "../domain/taskProgress";
import type { AssignmentsDoc } from "../domain/types";

/**
 * A subtarea that works on the shared draft, delivered from the tool that closed its last step.
 *
 * Closing a round of review said «para que la tarea siga», and the task did not go on: the subtarea stayed open
 * until one of those who had joined it found «Entregar» on their list, and whoever closed the round, called to it
 * from the conversation, did not have the subtarea on theirs. Nobody was told. There is nothing to land (the work
 * was done on the shared draft), so closing the last step is the delivery. Returns whether it delivered.
 */
export async function deliverSharedSubtask(params: { session: GtSession; pmOrg: string; lang: string; contentOrg: string; board: AssignmentsDoc; issueNumber: number; onStaging?: () => void }): Promise<boolean> {
  const { session, pmOrg, lang, contentOrg, board } = params;
  // Read again: the step was closed a moment ago, and somebody may have delivered meanwhile.
  const issue = await getPmIssue(session, pmOrg, params.issueNumber);
  if (!deliverableFromTool({ teams: board.teams, taskId: issueTaskId(issue), progress: parseTaskProgressMarker(issue.body), closed: issue.state === "closed" })) return false;
  await closeSubtask({
    session,
    pmOrg,
    issue,
    resource: "",
    lang,
    sharedDraft: true,
    archiveShared: () => archiveSharedDraft({ session, pmOrg, lang, contentOrg, board, issue }),
    afterClose: async () => {
      await markPhaseIfClosed({ session, pmOrg, lang, contentOrg, board, issue }).catch(() => null);
      await stageUnitsAfterClose({ session, pmOrg, lang, contentOrg, board, issue, onStart: params.onStaging }).catch(() => []);
    },
  });
  recordOwnClose({ host: session.host, username: session.username, pmOrg }, issue.number);
  return true;
}
