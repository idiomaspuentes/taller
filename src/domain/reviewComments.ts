/**
 * What was said about a draft in its review, and whether each thing said still stands.
 *
 * A review ended with two approvals, and nothing tied them to what had been said: a reviewer could approve with an
 * observation of their own still unanswered, and so could the author. A comment is now open until whoever made it
 * gives it as resolved (the paragraph was corrected, or the answer convinced them), and a review is not approved
 * while one is open.
 *
 * Giving a comment as resolved, or opening it again, is itself a comment on the review: a typed event that names
 * the comment. Nothing is edited, so it is seen in the conversation by whoever was waiting for it. Pure.
 */
import { formatChatEvent, parseChatEvent } from "./chatEvent";
import { parseRefComment } from "./commentPlace";
import { classifyComment, type RawComment } from "./conversation";

export type ReviewComment = {
  id: number;
  by: string;
  /** The place it is about (`1:2`, «figs-metaphor ¶5»); empty when it is about the whole draft. */
  ref: string;
  text: string;
  at: string;
  /** Given as resolved: by whom, and when. */
  resolved?: { by: string; at: string };
};

export const COMMENT_RESOLVED = "comment-resolved";
export const COMMENT_REOPENED = "comment-reopened";

/** Comments the app leaves for itself on the review (markers): not part of what people said. */
const isMachineComment = (body: string) => /<!--\s*(tas|gateway)[:-]/.test(body);
const same = (a: string | undefined, b: string | undefined) => Boolean(a && b) && a!.trim().toLowerCase() === b!.trim().toLowerCase();

/**
 * The conversation of a draft's review, oldest first, each comment with how it stands. `draftAuthor`: whoever wrote
 * the draft does not close what was said about it, so an event of theirs counts for nothing.
 */
export function reviewCommentsFrom(rows: RawComment[], draftAuthor?: string): ReviewComment[] {
  const standing = new Map<number, { by: string; at: string } | null>();
  // In the order they were written: the last word about a comment says how it stands.
  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    const event = parseChatEvent(row.body);
    if (!event || (event.type !== COMMENT_RESOLVED && event.type !== COMMENT_REOPENED)) continue;
    const target = Number(event.data?.comment);
    const by = row.user?.login ?? "";
    if (!target || same(by, draftAuthor)) continue;
    standing.set(target, event.type === COMMENT_RESOLVED ? { by, at: row.created_at ?? "" } : null);
  }
  return rows
    .filter((row) => row.body && !isMachineComment(row.body) && classifyComment(row.body).kind === "humano")
    .map((row) => {
      const resolved = standing.get(row.id);
      return { id: row.id, by: row.user?.login ?? "", at: row.created_at ?? "", ...parseRefComment(row.body ?? ""), ...(resolved ? { resolved } : {}) };
    });
}

/**
 * The comments that hold a review: what somebody other than the author said, and has not been given as resolved.
 * What the author writes there is an answer, and holds nothing.
 */
export function openComments(comments: ReviewComment[], draftAuthor?: string): ReviewComment[] {
  return comments.filter((comment) => !comment.resolved && !same(comment.by, draftAuthor));
}

/**
 * Who may give a comment as resolved, or open it again: whoever made it, and a person who coordinates (for a comment
 * whose writer is no longer there). Never the author of the draft, whose part is to answer it.
 */
export function canResolveComment(comment: ReviewComment, login: string, opts: { draftAuthor?: string; canManage?: boolean }): boolean {
  if (!login.trim() || same(login, opts.draftAuthor) || same(comment.by, opts.draftAuthor)) return false;
  return same(comment.by, login) || Boolean(opts.canManage);
}

/** The comment that gives another one as resolved (or opens it again), to be written on the review. */
export function resolutionComment(comment: ReviewComment, issueNumber: number, reopen = false): string {
  const said = comment.text.replace(/\s+/g, " ").trim();
  const short = said.length > 80 ? `${said.slice(0, 79).trimEnd()}…` : said;
  return formatChatEvent({
    type: reopen ? COMMENT_REOPENED : COMMENT_RESOLVED,
    emitter: "tas",
    issue: issueNumber,
    summary: `${reopen ? "Comentario reabierto" : "Comentario resuelto"}: ${short}`,
    data: { comment: comment.id },
  });
}
