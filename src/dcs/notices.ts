import type { DcsIssue } from "@ip-lms/dcs-client";
import type { Ask } from "../domain/askNotices";
import { projectFromMilestone } from "../domain/scope";
import { parseTaskProgressMarker } from "../domain/taskProgress";
import { PM_REPO_NAME, type AssignmentsDoc } from "../domain/types";
import { askNotices } from "../push";
import type { GtSession } from "./auth";

/**
 * Telling people what Door43 does not announce (see `domain/askNotices`), from the few places where the app changes
 * a subtarea: its progress, its closing, giving it back, creating it. Each is done after the change, on the side:
 * a notice that could not be sent never fails or delays the work that caused it.
 *
 * Who is told depends on the plan, which those places do not have in hand. The last plan read of each project is
 * kept here; without one, nothing is told.
 */

const boards = new Map<string, AssignmentsDoc>();
const boardKey = (host: string, org: string, projectId: string) => `${host}|${org}|${projectId.toUpperCase()}`;

/** Every plan read from Door43 passes through here. */
export function rememberBoard(session: Pick<GtSession, "host">, org: string, board: AssignmentsDoc | null): void {
  if (board?.projectId && board.teams.length) boards.set(boardKey(session.host, org, board.projectId), board);
}

/** The plan of a project as it was last read, when it was. */
export function rememberedBoard(session: Pick<GtSession, "host">, org: string, projectId: string): AssignmentsDoc | undefined {
  return boards.get(boardKey(session.host, org, projectId));
}

function boardOf(session: Pick<GtSession, "host">, org: string, issue: DcsIssue): AssignmentsDoc | undefined {
  const projectId = projectFromMilestone(issue.milestone?.title);
  return projectId ? boards.get(boardKey(session.host, org, projectId)) : undefined;
}

function send(session: GtSession, org: string, asks: Ask[]): void {
  if (asks.length) askNotices(session, { org, repo: PM_REPO_NAME }, asks);
}

/** Runs on the side; whatever goes wrong stays here. */
function later(work: () => Promise<void>): void {
  void work().catch(() => undefined);
}

export function noticesAfterProgress(session: GtSession, org: string, before: DcsIssue, after: DcsIssue): void {
  later(async () => {
    const board = boardOf(session, org, after);
    if (!board) return;
    const { afterStep } = await import("../domain/askNotices");
    send(session, org, afterStep(after, board, parseTaskProgressMarker(before.body), parseTaskProgressMarker(after.body)));
  });
}

/**
 * A correction somebody asked for was finished: they are told in the subtarea they asked from, with what was
 * answered. The answer stayed in the conversation of the correction, which a committee does not follow, and the
 * task of the committee said nothing of its corrections having come back.
 */
async function tellWhoAsked(session: GtSession, org: string, board: AssignmentsDoc, closed: DcsIssue): Promise<void> {
  const [{ parseWorkOrderMarker }, { askedFrom, extraWorkOf }, { correctionOutcome }] = await Promise.all([import("../domain/workOrder"), import("../domain/extraWork"), import("../domain/corrections")]);
  const row = extraWorkOf(board.settings, parseWorkOrderMarker(closed.body ?? "")?.itemIds);
  if (!row?.askedIn) return;
  const [{ listIssueComments }, { dcsConfig }, { commentOnIssue, listProjectOpenIssues }, { tNow }] = await Promise.all([import("@ip-lms/dcs-client"), import("./config"), import("./issues"), import("../i18n/messages")]);
  const comments = await listIssueComments(dcsConfig(session.host), org, PM_REPO_NAME, closed.number, session.token).catch(() => []);
  const open = (await listProjectOpenIssues(session, org, board.projectId).catch(() => [])).filter((issue) => issue.number !== closed.number);
  const left = askedFrom(board.settings, row.askedIn, open.flatMap((issue) => parseWorkOrderMarker(issue.body ?? "")?.itemIds ?? [])).filter((asked) => asked.open).length;
  await commentOnIssue(session, org, row.askedIn, correctionOutcome(row, comments.map((comment) => ({ body: comment.body ?? "", by: comment.user?.login ?? "" })), left, tNow));
}

export function noticesAfterClose(session: GtSession, org: string, closed: DcsIssue): void {
  later(async () => {
    const board = boardOf(session, org, closed);
    if (!board) return;
    await tellWhoAsked(session, org, board, closed).catch(() => undefined);
    if (!board.teams.some((task) => task.waitsFor?.length)) return;
    const [{ afterClose }, { listProjectOpenIssues }] = await Promise.all([import("../domain/askNotices"), import("./issues")]);
    const stillOpen = await listProjectOpenIssues(session, org, board.projectId);
    send(session, org, afterClose(closed, board, [...stillOpen.filter((issue) => issue.number !== closed.number), { ...closed, state: "open" }]));
  });
}

export function noticesAfterRelease(session: GtSession, org: string, released: DcsIssue): void {
  later(async () => {
    const board = boardOf(session, org, released);
    if (!board) return;
    const { afterRelease } = await import("../domain/askNotices");
    send(session, org, afterRelease(released, board));
  });
}

export function noticesAfterDecision(session: GtSession, org: string, opened: DcsIssue): void {
  later(async () => {
    const board = boardOf(session, org, opened);
    if (!board) return;
    const { afterDecision } = await import("../domain/askNotices");
    send(session, org, afterDecision(opened, board));
  });
}

export function noticesAfterPublish(session: GtSession, org: string, board: AssignmentsDoc, created: DcsIssue[], open: DcsIssue[]): void {
  later(async () => {
    if (!created.length) return;
    const { afterPublish } = await import("../domain/askNotices");
    send(session, org, afterPublish(created, board, open));
  });
}
