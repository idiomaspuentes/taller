import type { GtSession } from "./auth";
import { setIssueTaskProgress } from "./issues";
import { getPmIssue } from "./portionPr";
import { agreeInTool, agreementStanding, approveStep, isStepUnlocked, type AgreementStanding } from "../domain/stepClaim";
import { isStepDone, markStepDone, parseTaskProgressMarker } from "../domain/taskProgress";
import type { TaskStep } from "../domain/types";

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

/**
 * The signed-in person's part of a step is done (they handed in their report): it counts as their approval of the
 * step, which completes it when enough people have. Returns whether the step is complete now.
 */
export async function approveStepFromTool(params: { session: GtSession; pmOrg: string; issueNumber: number; step: TaskStep }): Promise<boolean> {
  const { session, pmOrg, issueNumber, step } = params;
  const issue = await getPmIssue(session, pmOrg, issueNumber);
  const progress = parseTaskProgressMarker(issue.body);
  const author = issue.assignee?.login || issue.assignees?.[0]?.login || undefined;
  const next = approveStep(progress, step, session.username, author);
  if (next !== progress) await setIssueTaskProgress(session, pmOrg, issue, next);
  return isStepDone(next, step.id);
}

/** The agreement on a step as the subtarea has it: its standing, whether the step has come, and whether it is closed. */
export type StepAgreement = AgreementStanding & { open: boolean; done: boolean };

const agreementOf = (progress: ReturnType<typeof parseTaskProgressMarker>, steps: TaskStep[], step: TaskStep): StepAgreement => ({
  ...agreementStanding(progress, step),
  open: isStepUnlocked(steps, progress, step.id),
  done: isStepDone(progress, step.id),
});

export async function stepAgreement(params: { session: GtSession; pmOrg: string; issueNumber: number; steps: TaskStep[]; step: TaskStep }): Promise<StepAgreement> {
  const issue = await getPmIssue(params.session, params.pmOrg, params.issueNumber);
  return agreementOf(parseTaskProgressMarker(issue.body), params.steps, params.step);
}

/**
 * The signed-in person's agreement on a step, given in its tool (see `agreeInTool`): kept in the subtarea, which
 * is read again first, and closing the step when it is everybody's. Returns how the agreement stands afterwards.
 */
export async function agreeStepFromTool(params: { session: GtSession; pmOrg: string; issueNumber: number; steps: TaskStep[]; step: TaskStep; settled: boolean; mine?: boolean }): Promise<StepAgreement> {
  const { session, pmOrg, issueNumber, steps, step } = params;
  const issue = await getPmIssue(session, pmOrg, issueNumber);
  const progress = parseTaskProgressMarker(issue.body);
  const author = issue.assignee?.login || issue.assignees?.[0]?.login || undefined;
  const next = agreeInTool({ progress, steps, step, login: session.username, settled: params.settled, mine: params.mine, author });
  if (next !== progress) await setIssueTaskProgress(session, pmOrg, issue, next);
  return agreementOf(next, steps, step);
}

/** Is the step already completed in the subtarea? */
export async function stepIsDone(params: { session: GtSession; pmOrg: string; issueNumber: number; stepId: string }): Promise<boolean> {
  const issue = await getPmIssue(params.session, params.pmOrg, params.issueNumber);
  return isStepDone(parseTaskProgressMarker(issue.body), params.stepId);
}
