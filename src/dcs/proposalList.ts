import { editIssue, listIssueComments, listRepoIssues, type DcsIssue } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import { closeIssue, listProjectIssues, loadPmConfig } from "./issues";
import { readRaw } from "./afinacionLoad";
import { readTeamHelps } from "./teamHelps";
import { helpsTsvFilename } from "../domain/helpsTarget";
import { DEFAULT_PM_CONFIG } from "../domain/roles";
import type { SolverLaunchContext } from "../domain/solverLaunch";
import { resolveSourcePackage } from "../domain/sourcePackage";
import { parseTsvTable } from "../prep/tsv";
import { supportReferenceOf } from "../prep/inventory";
import { loadAssignmentsFromDcs } from "./persist";
import { getPmIssue } from "./portionPr";
import { commentToItem, type ThreadItem } from "../domain/conversation";
import { isDecisionIssue } from "../domain/decisionAccess";
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
  /** One proposal opened on its own, not a list: `card` is the decision itself. */
  single?: true;
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

/**
 * A list of proposals and the decisions it has, as they stand; or one decision about the text, read the same way.
 * Throws when the subtarea is neither.
 */
export async function loadProposalList(params: { session: GtSession; pmOrg: string; lang: string; contentOrg: string; issueNumber: number }): Promise<ProposalListData> {
  const { session, pmOrg } = params;
  const card = await getPmIssue(session, pmOrg, params.issueNumber);
  const projectId = issueProjectId(card);
  if (isDecisionIssue(card)) {
    const board = await loadAssignmentsFromDcs(session, pmOrg, params.lang, projectId, params.contentOrg);
    if (!board) throw new Error("No se pudo leer el plan del proyecto.");
    return { card, board, proposals: [card], single: true };
  }
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

/** A note of the book, as one opened from a reason reads it. */
export type BookNote = { id: string; ref: string; quote: string; note: string; supportRef: string };

/**
 * The notes of a book, by their id: the team's own when it has them (its draft, or what it published), else the
 * source package's. A reason names a note by its id, and the id is the same in both.
 */
export async function loadBookNotes(session: GtSession, ctx: SolverLaunchContext, board: AssignmentsDoc): Promise<Map<string, BookNote>> {
  const book = (ctx.book || ctx.projectId || "").toUpperCase();
  const pmConfig = await loadPmConfig(session, ctx.pmOrg).catch(() => DEFAULT_PM_CONFIG);
  const own = await readTeamHelps({ session, ctx, pmConfig, board, kind: "notas" }).catch(() => null);
  const pkg = resolveSourcePackage(board.settings);
  const text = own?.text ?? (await readRaw(session, pkg.owner, pkg.tn, helpsTsvFilename("notas", book)));
  const out = new Map<string, BookNote>();
  for (const row of text ? parseTsvTable(text).rows : []) {
    const id = (row.ID ?? row.Id ?? row.id ?? "").trim();
    if (!id) continue;
    out.set(id, { id, ref: (row.Reference ?? row.reference ?? "").trim(), quote: (row.Quote ?? row.OrigQuote ?? "").trim(), note: (row.Note ?? row.OccurrenceNote ?? "").replace(/\\n/g, "\n").trim(), supportRef: supportReferenceOf(row) });
  }
  return out;
}
