import { editIssue, listIssueComments, listRepoIssues, type DcsIssue } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import { closeIssue, listProjectIssues } from "./issues";
import { loadAssignmentsFromDcs } from "./persist";
import { getPmIssue } from "./portionPr";
import { commentToItem, type ThreadItem } from "../domain/conversation";
import { issueProjectId, issueTaskId } from "../domain/myTasks";
import { isProposalList, proposalsOfList } from "../domain/proposalList";
import { parseTaskProgressMarker, upsertTaskProgressInBody } from "../domain/taskProgress";
import { PM_REPO_NAME, type AssignmentsDoc } from "../domain/types";

export type ProposalListData = {
  /** The subtarea that lists the proposals. */
  card: DcsIssue;
  board: AssignmentsDoc;
  /** The decisions opened from it, open and closed, in the order of the text. */
  proposals: DcsIssue[];
};

/**
 * The subtareas of the task and chapter of a list, open and closed: its decisions carry the same labels. Reading every
 * subtarea of the book to find them took 14 seconds for Ezra (a thousand of them); these are a page.
 */
async function issuesNear(session: GtSession, pmOrg: string, card: DcsIssue): Promise<DcsIssue[]> {
  const facets = (card.labels ?? []).map((label) => label.name ?? "").filter((name) => /\/(tarea|cap):/.test(name));
  const milestone = card.milestone?.title;
  if (facets.length !== 2 || !milestone) return (await listProjectIssues(session, pmOrg, issueProjectId(card))).issues;
  const out = new Map<number, DcsIssue>();
  for (let page = 1; page <= 10; page++) {
    const batch = await listRepoIssues(dcsConfig(session.host), pmOrg, PM_REPO_NAME, { token: session.token, state: "all", labels: facets, milestones: [milestone], page, limit: 50 });
    const had = out.size;
    for (const issue of batch) out.set(issue.number, issue);
    // A server that does not page answers the same page again: nothing new is the end too.
    if (batch.length < 50 || out.size === had) break;
  }
  return [...out.values()];
}

/** A list of proposals and the decisions it has, as they stand. Throws when the subtarea is not such a list. */
export async function loadProposalList(params: { session: GtSession; pmOrg: string; lang: string; contentOrg: string; issueNumber: number }): Promise<ProposalListData> {
  const { session, pmOrg } = params;
  const card = await getPmIssue(session, pmOrg, params.issueNumber);
  const projectId = issueProjectId(card);
  const [board, issues] = await Promise.all([loadAssignmentsFromDcs(session, pmOrg, params.lang, projectId, params.contentOrg), issuesNear(session, pmOrg, card)]);
  if (!board || !isProposalList(board.settings, card)) throw new Error("Esta subtarea no es una lista de propuestas.");
  return { card, board, proposals: proposalsOfList(issues, card.number) };
}

/** The conversation of one decision, as the conversation screen reads it. */
export async function loadDecisionThread(session: GtSession, pmOrg: string, issueNumber: number): Promise<ThreadItem[]> {
  const comments = await listIssueComments(dcsConfig(session.host), pmOrg, PM_REPO_NAME, issueNumber, session.token);
  return comments.map((comment) => commentToItem(comment, "issue", { owner: pmOrg, repo: PM_REPO_NAME }));
}

/**
 * Every proposal of the list was decided: the subtarea is delivered, its steps done, and whoever asked for it is
 * told as for any correction finished.
 */
export async function finishProposalList(params: { session: GtSession; pmOrg: string; card: DcsIssue; board: AssignmentsDoc }): Promise<DcsIssue> {
  const { session, pmOrg, card } = params;
  const steps = (params.board.teams.find((task) => task.id === issueTaskId(card))?.steps ?? []).map((step) => step.id);
  const had = parseTaskProgressMarker(card.body ?? "");
  const body = upsertTaskProgressInBody(card.body ?? "", { ...had, doneStepIds: [...new Set([...had.doneStepIds, ...steps])] });
  await editIssue(dcsConfig(session.host), pmOrg, PM_REPO_NAME, card.number, { token: session.token, body });
  return closeIssue(session, pmOrg, card.number);
}
