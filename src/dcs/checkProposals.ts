import type { GtSession } from "./auth";
import { readRepoFile } from "./afinacionStore";
import { forgetBranches } from "./branchList";
import { loadCheckAnswers, type CheckTarget } from "./checkStore";
import { dcsConfig } from "./config";
import { createCorrections } from "./corrections";
import { commentOnIssue } from "./issues";
import { ensureBranchFrom, getDefaultBranch } from "./pulls";
import { readTeamHelps, saveTeamHelpsFile, saveTeamHelpsRows, teamDraftBranch } from "./teamHelps";
import { proposalAsk, type ProposalPayload, type ProposalView } from "../domain/checkProposal";
import type { CheckAnswer } from "../domain/checklist";
import { resolveHelpsTarget, type HelpsResource } from "../domain/helpsTarget";
import { shippedStepsMissing } from "../domain/processes";
import { bookBranchName } from "../domain/portionPr";
import type { PmConfig } from "../domain/roles";
import type { SolverLaunchContext } from "../domain/solverLaunch";
import { DEFAULT_SOLVERS_CATALOG, findSolverApp } from "../domain/solvers";
import type { AssignmentsDoc, ProjectTask } from "../domain/types";
import { tNow } from "../i18n/messages";

/** A step of a task that is checked with a list, and where its answers are kept. */
export type CheckedStep = { stepId: string; key: string; target: CheckTarget };

/**
 * The steps of a task that are checked with a list, each with where its answers are: the list of a step is kept
 * with the helps it goes over (the tool of the step says which), under the subtarea and the step.
 */
export function checkedSteps(ctx: SolverLaunchContext, task: ProjectTask | null, pmConfig: PmConfig): CheckedStep[] {
  const book = (ctx.book || ctx.projectId || "").toUpperCase();
  // A trial may have gone over a list the process has now and the project does not: what was proposed there is read too.
  const steps = [...(task?.steps ?? []), ...(ctx.lab && task ? shippedStepsMissing(task) : [])];
  return steps.flatMap((step) => {
    if (step.closing !== "checklist") return [];
    const items = findSolverApp(DEFAULT_SOLVERS_CATALOG, step.solverAppId)?.stepParams?.[step.id]?.items ?? task?.rules[0]?.resource ?? "";
    const helps = resolveHelpsTarget({ ...ctx, resource: items }, pmConfig);
    return "error" in helps ? [] : [{ stepId: step.id, key: `${book}.${ctx.issueNumber || ctx.taskId}.${step.id}`, target: { owner: helps.owner, repo: helps.repo } }];
  });
}

/** Everybody's answers of every list of a task, each with the step it is of. */
export async function loadTaskAnswers(session: GtSession, steps: CheckedStep[]): Promise<{ step: CheckedStep; answers: CheckAnswer[] }[]> {
  return Promise.all(steps.map(async (step) => ({ step, answers: await loadCheckAnswers(session, step.target, step.key).catch(() => [] as CheckAnswer[]) })));
}

/**
 * The branch the team's version of a resource is written on: its group draft, started from what is published when
 * the team has none yet. `known` is the branch the team's version was just read from. Any other is made sure of
 * before writing: when the branches cannot be listed the draft is known by its name alone, and taken as there, a
 * note the team had agreed on found no file to be written in.
 */
async function draftBranch(params: { session: GtSession; owner: string; repo: string; book: string; board: AssignmentsDoc | null; resource: string; known?: string }): Promise<string> {
  const { session, owner, repo, book, board, resource } = params;
  if (params.known) return params.known;
  let branch = await teamDraftBranch({ session, owner, repo, book, teams: board?.teams ?? [], resource });
  if (!branch) {
    const task = (board?.teams ?? []).find((row) => row.rules.some((rule) => rule.resource === resource));
    if (!task) throw new Error(tNow("ag.noOwner"));
    branch = bookBranchName(book, task.id);
  }
  const config = dcsConfig(session.host);
  const made = await ensureBranchFrom(config, owner, repo, branch, session.token, await getDefaultBranch(config, owner, repo, session.token));
  // The list of branches kept for a few seconds does not have it: whoever reads the notes next would get the published ones.
  if (made.created) forgetBranches(config, owner, repo);
  return branch;
}

/**
 * The new version of a proposal the team agreed on, written where the team keeps that help: the row of its notes
 * or questions, or the file of the article. Over the file as it is at that moment, so what somebody else changed
 * meanwhile in another row stays.
 */
export async function applyProposal(params: { session: GtSession; ctx: SolverLaunchContext; pmConfig: PmConfig; board: AssignmentsDoc | null; proposal: ProposalPayload }): Promise<void> {
  const { session, ctx, board, proposal } = params;
  if (!proposal.after) throw new Error(tNow("ag.needsVersion"));
  const helps = resolveHelpsTarget({ ...ctx, resource: proposal.resource }, params.pmConfig);
  if ("error" in helps) throw new Error(helps.error);
  const message = `Taller: propuesta acordada ${helps.book} ${proposal.where}`;
  if (proposal.rowId && helps.filepath) {
    const own = await readTeamHelps({ session, ctx, pmConfig: params.pmConfig, board, kind: proposal.resource as HelpsResource });
    const branch = await draftBranch({ session, owner: helps.owner, repo: helps.repo, book: helps.book, board, resource: proposal.resource, known: own?.branch });
    await saveTeamHelpsRows({ session, owner: helps.owner, repo: helps.repo, filepath: helps.filepath, branch, edits: [{ id: proposal.rowId, fields: { [proposal.field ?? "Note"]: proposal.after } }], message });
    return;
  }
  if (!proposal.path) throw new Error(tNow("ag.noOwner"));
  const branch = await draftBranch({ session, owner: helps.owner, repo: helps.repo, book: helps.book, board, resource: proposal.resource });
  const current = await readRepoFile(session, { owner: helps.owner, repo: helps.repo, branch }, proposal.path);
  await saveTeamHelpsFile({ session, owner: helps.owner, repo: helps.repo, filepath: proposal.path, branch, content: proposal.after, sha: current?.sha, message });
}

/**
 * A proposal about something another team maintains, asked of that team once this one agreed on it: a subtarea of
 * correction in the task that maintains it, as what a committee does not endorse becomes, with the whole proposal
 * said in its conversation. Returns how that subtarea is called («#151»).
 */
export async function sendProposal(params: { session: GtSession; ctx: SolverLaunchContext; board: AssignmentsDoc; task: ProjectTask; view: ProposalView }): Promise<string> {
  const { session, ctx, view } = params;
  const { issues } = await createCorrections({ session, pmOrg: ctx.pmOrg, board: params.board, from: params.task, asks: [proposalAsk(view)], portionIds: ctx.portionIds, ...(ctx.issueNumber ? { askedIn: ctx.issueNumber } : {}) });
  const issue = issues[0];
  if (!issue) throw new Error(tNow("ag.notSent"));
  if (view.proposal.after) {
    const body = tNow("ag.askBody").replace("{who}", view.by).replace("{where}", view.proposal.where).replace("{after}", view.proposal.after).replace("{reason}", view.reason || "—");
    await commentOnIssue(session, ctx.pmOrg, issue.number, view.proposal.before ? `${body}\n\n${tNow("ag.askBefore").replace("{before}", view.proposal.before)}` : body).catch(() => undefined);
  }
  return `#${issue.number}`;
}
