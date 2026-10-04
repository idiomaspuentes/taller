import { noticeLang, subtaskName } from "../domain/noticeText";
import { getUiLanguage } from "../i18n/language";
import type { DcsIssue } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { listMyConflictIssues, listMyIssues } from "./issues";
import { listRepoComments } from "./comments";
import { rowPreview } from "../domain/attention";
import { isDecisionComment } from "../domain/chatEvent";
import {
  buildPrIndex,
  contentReposOf,
  mapCommentToIssue,
  repoKey,
  type CommentSource,
  type RepoRef,
} from "../domain/notificationMap";
import {
  recordDecisions,
  recordLatest,
  seedIfEmpty,
  seedRead,
  type MappedComment,
  type ReadCursorDoc,
} from "../domain/readCursor";
import { PM_REPO_NAME } from "../domain/types";

/** How far back the first poll in a browser (or of a new repo) looks. */
const SEED_LOOKBACK_MS = 30 * 86_400_000;
/** `since` overlaps the previous poll; ids dedupe, so overlap is harmless. */
const SINCE_OVERLAP_MS = 2 * 60_000;

export type ActivityPollResult = {
  doc: ReadCursorDoc;
  /** Subtareas that count for this user (assigned, plus step-role rows from Mis tareas). */
  issues: number[];
  /** Closed subtareas of mine with a verse conflict to decide; null if that search failed. */
  decisions: DcsIssue[] | null;
  /** Issue number → title (the portion label the list shows). */
  titles: Record<string, string>;
  /** Comment ids in this poll written by the signed-in user. */
  ownCommentIds: number[];
};

/**
 * One read-only poll: my open subtareas and pending decisions, then
 * `issues/comments?since=` on the PM repo and on each content repo that holds
 * PRs of those subtareas. Only comments of my subtareas feed the preview;
 * decision cards are kept for every PM issue, because the conflict label (and
 * the search index) can land after the card and `since` does not look back.
 */
export async function pollActivity(params: {
  session: GtSession;
  pmOrg: string;
  doc: ReadCursorDoc;
  extraIssues?: DcsIssue[];
  now?: Date;
}): Promise<ActivityPollResult> {
  const { session, pmOrg } = params;
  const now = params.now ?? new Date();
  const [assigned, decisions] = await Promise.all([
    listMyIssues(session, pmOrg),
    listMyConflictIssues(session, pmOrg).catch(() => null),
  ]);
  const byNumber = new Map<number, DcsIssue>();
  for (const issue of [...assigned, ...(decisions ?? []), ...(params.extraIssues ?? [])]) {
    if (!byNumber.has(issue.number)) byNumber.set(issue.number, issue);
  }
  const mine = [...byNumber.values()];
  const mineSet = new Set(mine.map((i) => i.number));
  const prIndex = buildPrIndex(mine);

  const pmRepo: RepoRef = { owner: pmOrg, repo: PM_REPO_NAME };
  const repos: Array<{ ref: RepoRef; source: CommentSource }> = [
    { ref: pmRepo, source: "pm" },
    ...contentReposOf(mine)
      .filter((r) => repoKey(r.owner, r.repo) !== repoKey(pmOrg, PM_REPO_NAME))
      .map((ref) => ({ ref, source: "pr" as const })),
  ];

  let doc = params.doc;
  const me = session.username.trim().toLowerCase();
  const ownCommentIds: number[] = [];
  const nextPollAt = new Date(now.getTime() - SINCE_OVERLAP_MS).toISOString();
  const seedSince = new Date(now.getTime() - SEED_LOOKBACK_MS).toISOString();

  for (const { ref, source } of repos) {
    const key = repoKey(ref.owner, ref.repo);
    const firstTime = !doc.polls[key];
    let comments;
    try {
      comments = await listRepoComments(session, ref.owner, ref.repo, {
        since: doc.polls[key] ?? seedSince,
        maxPages: firstTime ? 6 : 4,
      });
    } catch (err) {
      if (source === "pm") throw err;
      continue;
    }
    const all: MappedComment[] = [];
    for (const c of comments) {
      const hit = mapCommentToIssue(c, ref, { pmOrg, prIndex });
      if (!hit) continue;
      all.push({
        issue: hit.issue,
        source: hit.source,
        id: c.id,
        createdAt: c.created_at,
        author: c.user?.login ?? "",
        body: c.body ?? "",
      });
      if (me && (c.user?.login ?? "").trim().toLowerCase() === me) ownCommentIds.push(c.id);
    }
    const mapped = all.filter((m) => mineSet.has(m.issue));
    doc = recordDecisions(doc, all, isDecisionComment);
    doc = recordLatest(doc, mapped, { me: session.username, preview: rowPreview });
    if (firstTime && doc.seeded) {
      doc = seedRead(doc, {
        issues: [...new Set(mapped.map((m) => m.issue))],
        sources: [source],
        now: now.toISOString(),
      });
    }
    doc = { ...doc, polls: { ...doc.polls, [key]: nextPollAt } };
  }

  doc = seedIfEmpty(doc, now.toISOString());
  const titles: Record<string, string> = {};
  // A notification names a subtarea as every notice does: the book in words, the passage, the task and the phase.
  for (const issue of mine) titles[String(issue.number)] = subtaskName(issue, noticeLang(getUiLanguage()));
  return { doc, issues: [...mineSet], decisions, titles, ownCommentIds };
}
