import type { DcsIssue } from "@ip-lms/dcs-client";
import type { VerseConflict } from "../domain/usfmVerseMerge";
import {
  closeIssueBlockReason,
  parsePortionPrMarker,
  type PortionMergeStatus,
} from "../domain/portionPr";
import type { GtSession } from "./auth";
import { closeIssue, issueAssigneeLogins } from "./issues";
import { loadPortionPrConflicts, mergePortionPrIfOpen } from "./portionPr";
import { clearPrincipalPassMarks } from "./principalPass";
import { issueProjectId, issueTaskId } from "../domain/myTasks";
import { publishVerseConflictEvents, type VerseConflictPublishResult } from "./verseConflictThread";

export type CloseSubtaskResult = {
  target: DcsIssue;
  merge: { status: PortionMergeStatus; conflicts: VerseConflict[]; pullUrl?: string };
  /** Decision-card posts when the merge left conflicts. */
  posted: VerseConflictPublishResult | null;
  /** The issue closed, but the conflict could not be posted on the conversation. */
  publishError: string;
};

/**
 * Cerrar on DCS: link a PR when a TPL/TPS subtarea has none, land its verses
 * on the trunk, close the PM issue, and post the verse-conflict decision.
 */
export async function closeSubtask(params: {
  session: GtSession;
  pmOrg: string;
  issue: DcsIssue;
  resource: string;
  /** Project language; with it, pass marks of the touched subtareas are cleared on a verse conflict. */
  lang?: string;
  ensurePr?: () => Promise<DcsIssue>;
  /** The task did all its work on the shared draft (it is not the translation task of its resource, see `taskHasOwnDraft`): there is nothing to land. */
  sharedDraft?: boolean;
  /** For a task on the shared draft: tag the draft as it stands, so the subtarea leaves a mark of what it left. */
  archiveShared?: () => Promise<unknown>;
  /** Once the subtarea is closed: mark the phase if this was its last one. Never undoes the close. */
  afterClose?: () => Promise<unknown>;
}): Promise<CloseSubtaskResult> {
  const { session, pmOrg, issue } = params;
  const resource = params.resource.toLowerCase();
  if (params.sharedDraft) {
    await params.archiveShared?.().catch(() => undefined);
    await closeIssue(session, pmOrg, issue.number);
    await params.afterClose?.().catch(() => undefined);
    return { target: issue, merge: { status: "none", conflicts: [] }, posted: null, publishError: "" };
  }
  let target = issue;
  if (!parsePortionPrMarker(issue.body) && (resource === "tpl" || resource === "tps") && params.ensurePr) {
    target = await params.ensurePr();
  }
  const merge = await mergePortionPrIfOpen(session, target);
  const blocked = closeIssueBlockReason(resource, merge.status);
  if (blocked) throw new Error(blocked);
  await closeIssue(session, pmOrg, issue.number);
  await params.afterClose?.().catch(() => undefined);

  const marker = parsePortionPrMarker(target.body);
  let posted: VerseConflictPublishResult | null = null;
  let publishError = "";
  if (merge.conflicts.length && marker) {
    const recorded = await loadPortionPrConflicts(session, marker, issue.number).catch(() => null);
    const payload =
      recorded && recorded.issue === issue.number
        ? recorded
        : { issue: issue.number, bookRef: marker.base, conflicts: merge.conflicts };
    try {
      posted = await publishVerseConflictEvents(session, pmOrg, {
        issueNumber: issue.number,
        closer: issueAssigneeLogins(issue)[0] || session.username,
        marker,
        payload,
      });
    } catch (err) {
      publishError = err instanceof Error ? err.message : String(err);
    }
  }
  if (merge.conflicts.length && params.lang) {
    await clearPrincipalPassMarks({
      session,
      pmOrg,
      lang: params.lang,
      projectId: issueProjectId(issue),
      issues: [issue.number, ...(posted?.postedOn ?? [])],
      taskIds: [issueTaskId(issue)],
    }).catch(() => undefined);
  }
  return { target, merge, posted, publishError };
}
