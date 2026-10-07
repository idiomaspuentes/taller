import { getRawContent } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { isWriteRace, raceDelay, readRepoFile } from "./afinacionStore";
import { forgetBranches } from "./branchList";
import { loadCheckAnswers, type CheckTarget } from "./checkStore";
import { dcsConfig } from "./config";
import { correctionSubtask, createCorrections } from "./corrections";
import { commentOnIssue } from "./issues";
import { ensureBranchFrom, getDefaultBranch } from "./pulls";
import { readTeamHelps, saveTeamHelpsFile, saveTeamHelpsRows, teamDraftBranch } from "./teamHelps";
import { sameWording, proposalAsk, proposalFit, proposalWords, type ProposalPayload, type ProposalView } from "../domain/checkProposal";
import type { CheckAnswer } from "../domain/checklist";
import { helpsRowField, type HelpsRowEdit } from "../domain/helpsDraft";
import { resolveHelpsTarget, type HelpsResource } from "../domain/helpsTarget";
import { shippedStepsMissing } from "../domain/processes";
import { bookBranchName } from "../domain/portionPr";
import type { PmConfig } from "../domain/roles";
import type { SolverLaunchContext } from "../domain/solverLaunch";
import { DEFAULT_SOLVERS_CATALOG, findSolverApp } from "../domain/solvers";
import type { AssignmentsDoc, ChecklistQuestion, ProjectTask } from "../domain/types";
import { tNow } from "../i18n/messages";

/** A step of a task that is checked with a list, and where its answers are kept. */
export type CheckedStep = { stepId: string; key: string; target: CheckTarget; /** The texts its helps are checked against. */ texts: string[]; /** What it asks of each help. */ questions: ChecklistQuestion[] };

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
    const params = findSolverApp(DEFAULT_SOLVERS_CATALOG, step.solverAppId)?.stepParams?.[step.id];
    const items = params?.items ?? task?.rules[0]?.resource ?? "";
    const helps = resolveHelpsTarget({ ...ctx, resource: items }, pmConfig);
    const texts = (params?.text ?? "").split(",").map((text) => text.trim()).filter(Boolean);
    return "error" in helps ? [] : [{ stepId: step.id, key: `${book}.${ctx.issueNumber || ctx.taskId}.${step.id}`, target: { owner: helps.owner, repo: helps.repo }, texts, questions: step.checklist ?? [] }];
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
 * A proposal that cannot be written: the help no longer says what the proposal was written from. `current` is what
 * it says now, for whoever writes the proposal again.
 */
export class HelpChangedError extends Error {
  readonly current: string;
  constructor(current: string) {
    super(tNow("ag.stale"));
    this.name = "HelpChangedError";
    this.current = current;
  }
}

type ProposalPlace = { session: GtSession; ctx: SolverLaunchContext; pmConfig: PmConfig; board: AssignmentsDoc | null };

/**
 * An article as the team has it now, without starting a draft to find out: on its draft of those articles, or as
 * published. Empty when the team has none.
 */
async function articleNow(place: ProposalPlace, proposal: ProposalPayload, helps: { owner: string; repo: string; book: string }): Promise<string> {
  const { session } = place;
  const read = (ref?: string) => getRawContent(dcsConfig(session.host), helps.owner, helps.repo, proposal.path ?? "", { token: session.token, ...(ref ? { ref } : {}) }).catch(() => "");
  const draft = await teamDraftBranch({ session, owner: helps.owner, repo: helps.repo, book: helps.book, teams: place.board?.teams ?? [], resource: proposal.resource });
  return (draft ? await read(draft) : "") || (await read());
}

/**
 * The words each of some proposals would write over, as the team has them now, by `proposalWords`: the agreement
 * reads its proposals against them, so one written from words that are no longer there is seen before anybody
 * agrees on it. What cannot be read is left out; applying finds it.
 */
export async function readProposedWords(params: ProposalPlace & { proposals: ProposalPayload[] }): Promise<Record<string, string>> {
  // The notes of a book are one file: read once for all the proposals about them.
  const files = new Map<string, Promise<string | undefined>>();
  const words: Record<string, string> = {};
  await Promise.all(
    params.proposals.map(async (proposal) => {
      const key = proposalWords(proposal);
      const helps = resolveHelpsTarget({ ...params.ctx, resource: proposal.resource }, params.pmConfig);
      if (!key || "error" in helps) return;
      if (proposal.rowId && helps.filepath) {
        if (!files.has(proposal.resource)) files.set(proposal.resource, readTeamHelps({ ...params, kind: proposal.resource as HelpsResource }).then((own) => own?.text, () => undefined));
        const text = await files.get(proposal.resource);
        const now = text === undefined ? undefined : helpsRowField(text, proposal.rowId, proposal.field ?? "Note");
        if (now !== undefined) words[key] = now;
      } else if (proposal.path) {
        const now = await articleNow(params, proposal, helps).catch(() => "");
        if (now) words[key] = now;
      }
    }),
  );
  return words;
}

/**
 * The new version of a proposal the team agreed on, written where the team keeps that help: the row of its notes
 * or questions, or the file of the article. Over the file as it is at that moment, so what somebody else changed
 * meanwhile in another row stays.
 *
 * And only over the words it was written from. A new version is the whole of a note: written over one that had
 * changed since (another proposal for it applied first, from another list of the task or from the same one), it
 * took that change out with nobody told. It is refused instead (`HelpChangedError`), on the file about to be
 * written and not on one read earlier: two people who agree at the same moment on two versions of a note both
 * find, reading first, the note as it was.
 */
export async function applyProposal(params: ProposalPlace & { proposal: ProposalPayload }): Promise<void> {
  const { session, ctx, board, proposal } = params;
  const { after } = proposal;
  if (!after) throw new Error(tNow("ag.needsVersion"));
  const helps = resolveHelpsTarget({ ...ctx, resource: proposal.resource }, params.pmConfig);
  if ("error" in helps) throw new Error(helps.error);
  const message = `Taller: propuesta acordada ${helps.book} ${proposal.where}`;
  if (proposal.rowId && helps.filepath) {
    const { rowId } = proposal;
    const column = proposal.field ?? "Note";
    const edits = (text: string) => {
      const now = helpsRowField(text, rowId, column);
      if (proposal.add) {
        // A help the team found missing: its row is added at its verse. There already (it was written, and saying
        // so failed), nothing is written; there with other words, another row has taken its id.
        if (now === undefined) return [{ id: rowId, fields: { ...proposal.fields, [column]: after }, addAt: proposal.where }];
        if (sameWording(now, after)) return [];
        throw new HelpChangedError(now);
      }
      // Written over no row, it was said to be applied and nothing had changed.
      if (now === undefined) throw new Error(tNow("ag.helpGone"));
      const fit = proposalFit(proposal, now);
      if (fit === "changed") throw new HelpChangedError(now);
      const own: HelpsRowEdit[] = fit === "done" ? [] : [{ id: rowId, fields: { [column]: after } }];
      // A note parted in two: what was taken out of it is a new row beside it, written with it or not at all.
      // There already (the two were written, and saying so failed), it is not added again; with other words,
      // another row has taken its id, and nothing is written rather than lose that half.
      const half = proposal.split;
      const there = half ? helpsRowField(text, half.rowId, column) : undefined;
      if (!half) return own;
      if (there === undefined) return [...own, { id: half.rowId, fields: { ...half.fields, [column]: half.after }, addAt: proposal.where, addAfter: rowId }];
      if (!sameWording(there, half.after)) throw new Error(tNow("ag.splitTaken"));
      return own;
    };
    const own = await readTeamHelps({ session, ctx, pmConfig: params.pmConfig, board, kind: proposal.resource as HelpsResource });
    // Refused before a draft is started for it.
    if (own) edits(own.text);
    const branch = await draftBranch({ session, owner: helps.owner, repo: helps.repo, book: helps.book, board, resource: proposal.resource, known: own?.branch });
    await saveTeamHelpsRows({ session, owner: helps.owner, repo: helps.repo, filepath: helps.filepath, branch, edits, message });
    return;
  }
  if (!proposal.path) throw new Error(tNow("ag.noOwner"));
  const { path } = proposal;
  // Refused before a draft is started for it.
  const known = await articleNow(params, proposal, helps);
  if (known && proposalFit(proposal, known) === "changed") throw new HelpChangedError(known);
  const branch = await draftBranch({ session, owner: helps.owner, repo: helps.repo, book: helps.book, board, resource: proposal.resource });
  for (let attempt = 1; ; attempt++) {
    const current = await readRepoFile(session, { owner: helps.owner, repo: helps.repo, branch }, path);
    // An article the team does not have yet is written new: there are no words of its own to take out.
    const fit = current ? proposalFit(proposal, current.text) : "fits";
    if (current && fit === "changed") throw new HelpChangedError(current.text);
    if (fit === "done") return;
    try {
      await saveTeamHelpsFile({ session, owner: helps.owner, repo: helps.repo, filepath: path, branch, content: after, sha: current?.sha, message });
      return;
    } catch (err) {
      // Somebody wrote it between the reading and the writing: read again, and it is told from what it says now.
      if (!isWriteRace(err) || attempt === 3) throw err;
      await raceDelay(attempt);
    }
  }
}

/**
 * A proposal about something another team maintains, asked of that team once this one agreed on it: a subtarea of
 * correction in the task that maintains it, as what a committee does not endorse becomes, with the whole proposal
 * said in its conversation. Returns how that subtarea is called («#151»).
 */
export async function sendProposal(params: { session: GtSession; ctx: SolverLaunchContext; board: AssignmentsDoc; task: ProjectTask; view: ProposalView; /** The question it answered «no» to, as it is said to a person. */ failed?: string }): Promise<string> {
  const { session, ctx, view } = params;
  const ask = proposalAsk(view, params.failed);
  const asking = { session, pmOrg: ctx.pmOrg, board: params.board, from: params.task };
  const { issues } = await createCorrections({ ...asking, asks: [ask], portionIds: ctx.portionIds, ...(ctx.issueNumber ? { askedIn: ctx.issueNumber } : {}) });
  // Asked already, and this screen does not know: it is that subtarea. It said «no se pudo pedir», and a proposal
  // whose «pedida» could not be written down stayed agreed and never asked, holding the step for good.
  const issue = issues[0] ?? (await correctionSubtask({ ...asking, ask }).catch(() => null));
  if (!issue) throw new Error(tNow("ag.notSent"));
  if (issues[0] && view.proposal.after) {
    const body = tNow("ag.askBody").replace("{who}", view.by).replace("{where}", view.proposal.where).replace("{after}", view.proposal.after).replace("{reason}", [params.failed, view.reason].filter(Boolean).join(" ") || "—");
    await commentOnIssue(session, ctx.pmOrg, issue.number, view.proposal.before ? `${body}\n\n${tNow("ag.askBefore").replace("{before}", view.proposal.before)}` : body).catch(() => undefined);
  }
  return `#${issue.number}`;
}
