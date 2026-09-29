/**
 * After Cerrar with verse conflicts: post the `verse-conflict` decision on
 * the closer's PM issue and, when the trunk history says who wrote the
 * displaced text, on theirs with an @mention; label both subtareas.
 * Never touches the verse-merge engine or the PR comment.
 */
import { createIssueComment, listCommits } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import { markIssueConflict } from "./issues";
import { commentToItem, type ThreadItem } from "../domain/conversation";
import { bookCodeFromWorkHead, bookTrunkFromWorkHead, type PortionPrMarker } from "../domain/portionPr";
import { findDisplacedAuthor } from "../domain/trunkAuthor";
import type { VerseConflictsPayload } from "../domain/verseConflicts";
import { buildVerseConflictPosts } from "../domain/verseConflictEvent";
import { PM_REPO_NAME } from "../domain/types";
import { bookUsfmName } from "../prep/discover";

export async function deduceConflictAuthors(
  session: GtSession,
  marker: Pick<PortionPrMarker, "owner" | "repo">,
  bookRef: string,
  issueNumber: number,
  conflicts: VerseConflictsPayload["conflicts"],
): Promise<Array<{ otherIssue: number; otherLogin: string | null } | null>> {
  let commits: Awaited<ReturnType<typeof listCommits>> = [];
  try {
    commits = await listCommits(dcsConfig(session.host), marker.owner, marker.repo, {
      sha: bookRef,
      limit: 50,
      token: session.token,
    });
  } catch {
    return conflicts.map(() => null);
  }
  return conflicts.map((c) =>
    findDisplacedAuthor(commits, { issueNumber, chapter: c.chapter, from: c.from, to: c.to }),
  );
}

export type VerseConflictPublishResult = {
  /** Items for the closer's own thread, to show before the next poll. */
  ownItems: ThreadItem[];
  postedOn: number[];
  /** Ranges whose other author could not be deduced (card only on the closer's thread). */
  unknownOther: string[];
};

export async function publishVerseConflictEvents(
  session: GtSession,
  pmOrg: string,
  params: {
    issueNumber: number;
    closer: string;
    marker: PortionPrMarker;
    payload: Pick<VerseConflictsPayload, "issue" | "bookRef" | "trunkSha" | "conflicts">;
  },
): Promise<VerseConflictPublishResult> {
  const { marker, payload } = params;
  const bookRef = payload.bookRef || marker.base || bookTrunkFromWorkHead(marker.head);
  const book = bookCodeFromWorkHead(marker.head).toUpperCase();
  const others = await deduceConflictAuthors(session, marker, bookRef, params.issueNumber, payload.conflicts);
  const posts = buildVerseConflictPosts({
    payload: { ...payload, issue: params.issueNumber, bookRef },
    closer: params.closer,
    pr: { owner: marker.owner, repo: marker.repo, number: marker.number },
    book,
    usfmPath: bookUsfmName(book),
    others,
    stamp: payload.trunkSha?.slice(0, 12) || Date.now().toString(36),
  });
  const config = dcsConfig(session.host);
  const ownItems: ThreadItem[] = [];
  const postedOn = new Set<number>();
  for (const post of posts) {
    const comment = await createIssueComment(config, pmOrg, PM_REPO_NAME, post.issue, post.body, session.token);
    postedOn.add(post.issue);
    if (post.issue === params.issueNumber) {
      ownItems.push(commentToItem(comment, "issue", { owner: pmOrg, repo: PM_REPO_NAME }));
    }
  }
  for (const issue of postedOn) {
    await markIssueConflict(session, pmOrg, issue).catch(() => undefined);
  }
  return {
    ownItems,
    postedOn: [...postedOn],
    unknownOther: payload.conflicts
      .filter((_, i) => !others[i]?.otherIssue)
      .map((c) => (c.to > c.from ? `${c.chapter}:${c.from}–${c.to}` : `${c.chapter}:${c.from}`)),
  };
}
