import { createIssueComment, listIssueComments } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import type { PortionPrMarker } from "../domain/portionPr";
import { resolutionComment, reviewCommentsFrom, type ReviewComment } from "../domain/reviewComments";

export type { ReviewComment } from "../domain/reviewComments";

/**
 * The conversation of a draft's review, oldest first, each comment with whether it was given as resolved. Read by
 * the review tool and by the editor of the draft. `draftAuthor`: see `reviewCommentsFrom`.
 */
export async function loadReviewComments(session: GtSession, marker: PortionPrMarker, draftAuthor?: string): Promise<ReviewComment[]> {
  const rows = await listIssueComments(dcsConfig(session.host), marker.owner, marker.repo, marker.number, session.token);
  return reviewCommentsFrom(rows, draftAuthor);
}

/** Give a comment as resolved, or open it again: written on the review as a comment of its own, never an edit. */
export async function setReviewCommentResolved(session: GtSession, marker: PortionPrMarker, comment: ReviewComment, issueNumber: number, resolved: boolean): Promise<void> {
  await createIssueComment(dcsConfig(session.host), marker.owner, marker.repo, marker.number, resolutionComment(comment, issueNumber, !resolved), session.token);
}
