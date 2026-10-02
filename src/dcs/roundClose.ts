import type { GtSession } from "./auth";
import { setIssueTaskProgress } from "./issues";
import { getPmIssue } from "./portionPr";
import { isStepDone, markStepDone, parseTaskProgressMarker } from "../domain/taskProgress";

/**
 * A step that closes by consensus is completed from its tool, once every item is agreed. The subtarea is read
 * again first, so a seat or an approval somebody saved meanwhile is not lost. Returns whether it changed anything.
 */
export async function completeStepFromTool(params: { session: GtSession; pmOrg: string; issueNumber: number; stepId: string }): Promise<boolean> {
  const { session, pmOrg, issueNumber, stepId } = params;
  const issue = await getPmIssue(session, pmOrg, issueNumber);
  const progress = parseTaskProgressMarker(issue.body);
  if (isStepDone(progress, stepId)) return false;
  await setIssueTaskProgress(session, pmOrg, issue, markStepDone(progress, stepId));
  return true;
}

/** Is the step already completed in the subtarea? */
export async function stepIsDone(params: { session: GtSession; pmOrg: string; issueNumber: number; stepId: string }): Promise<boolean> {
  const issue = await getPmIssue(params.session, params.pmOrg, params.issueNumber);
  return isStepDone(parseTaskProgressMarker(issue.body), params.stepId);
}
