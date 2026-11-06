import { createIssueComment, editIssueComment, listIssueComments, request } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import type { PortionPrMarker } from "../domain/portionPr";
import { editedCommentBody, glossaryComment, resolutionComment, reviewCommentsFrom, type ReviewComment } from "../domain/reviewComments";

export type { ReviewComment } from "../domain/reviewComments";

/**
 * The conversation of a draft's review, oldest first, each comment with whether it was given as resolved. Read by
 * the review tool and by the editor of the draft. `draftAuthor`: see `reviewCommentsFrom`.
 */
export async function loadReviewComments(session: GtSession, marker: PortionPrMarker, draftAuthor?: string): Promise<ReviewComment[]> {
  const rows = await listIssueComments(dcsConfig(session.host), marker.owner, marker.repo, marker.number, session.token);
  return reviewCommentsFrom(rows, draftAuthor);
}

/**
 * Change what a comment says, in its place on the review (see `canEditComment` for when). Door43 keeps when it was
 * changed, and the comment says so to whoever had read it.
 */
export async function editReviewComment(session: GtSession, marker: PortionPrMarker, comment: ReviewComment, words: string): Promise<void> {
  await editIssueComment(dcsConfig(session.host), marker.owner, marker.repo, comment.id, editedCommentBody(comment, words), session.token);
}

/** Take a comment back, while nobody has answered it (see `canEditComment`). */
export async function deleteReviewComment(session: GtSession, marker: PortionPrMarker, comment: ReviewComment): Promise<void> {
  // A comment's id is unique in its repository (as for editing it); Door43 lets only its writer take it back.
  const path = `/repos/${encodeURIComponent(marker.owner)}/${encodeURIComponent(marker.repo)}/issues/comments/${comment.id}`;
  await request<void>(dcsConfig(session.host), { method: "DELETE", path, token: session.token });
}

/** Give a comment as resolved, or open it again: written on the review as a comment of its own, never an edit. */
export async function setReviewCommentResolved(session: GtSession, marker: PortionPrMarker, comment: ReviewComment, issueNumber: number, resolved: boolean): Promise<void> {
  await createIssueComment(dcsConfig(session.host), marker.owner, marker.repo, marker.number, resolutionComment(comment, issueNumber, !resolved), session.token);
}

/** Say on the review that a comment became a decision of the glossary (see `reviewComments.ts`). */
export async function markReviewCommentInGlossary(session: GtSession, marker: PortionPrMarker, comment: ReviewComment, issueNumber: number, decision: string, entry: string): Promise<void> {
  await createIssueComment(dcsConfig(session.host), marker.owner, marker.repo, marker.number, glossaryComment(comment, issueNumber, decision, entry), session.token);
}
