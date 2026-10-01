import { issueInScope } from "../domain/scope";
import { tNow } from "../i18n/messages";
import { getIssue, listCommits, listIssueComments, type DcsIssue } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import { loadSolversCatalog } from "./issues";
import { loadAssignmentsFromDcs } from "./persist";
import {
  commentToItem,
  commitToItem,
  type RawCommit,
  type ThreadItem,
  type ThreadSourceState,
} from "../domain/conversation";
import { issueProjectId, mergeLocalSolverBindings } from "../domain/myTasks";
import { parsePortionPrMarker } from "../domain/portionPr";
import { loadLocalAssignments } from "../domain/store";
import { DEFAULT_SOLVERS_CATALOG, type SolversCatalog } from "../domain/solvers";
import { PM_REPO_NAME, type AssignmentsDoc } from "../domain/types";

export type ConversationSubjectData = {
  issue: DcsIssue;
  board: AssignmentsDoc | null;
  catalog: SolversCatalog;
};

/** The PM issue plus its project plan and solver catalog (for the header). Read-only. */
export async function loadConversationSubject(params: {
  session: GtSession;
  pmOrg: string;
  lang: string;
  contentOrg: string;
  issueNumber: number;
}): Promise<ConversationSubjectData> {
  const { session, pmOrg, lang, contentOrg, issueNumber } = params;
  const issue = await getIssue(dcsConfig(session.host), pmOrg, PM_REPO_NAME, issueNumber, session.token);
  // A link (a notice, a bookmark) can point to another workspace of the same organization.
  if (!issueInScope(issue)) throw new Error(tNow("thread.otherSpace"));
  const projectId = issueProjectId(issue);
  const [remote, catalog] = await Promise.all([
    projectId
      ? loadAssignmentsFromDcs(session, pmOrg, lang, projectId, contentOrg).catch(() => null)
      : Promise.resolve(null),
    loadSolversCatalog(session, pmOrg).catch(() => DEFAULT_SOLVERS_CATALOG),
  ]);
  const local = projectId ? loadLocalAssignments(lang, projectId, contentOrg, pmOrg) : null;
  const board = remote?.teams.length
    ? mergeLocalSolverBindings(remote, local)
    : local?.teams.length
      ? local
      : remote;
  return { issue, board, catalog };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Only the sources this subtarea has (plan §3.1): PM issue comments always;
 * PR comments and save commits when the issue carries a PR marker. Never
 * calls `resolveVisiblePortionPr` (it edits the issue). GET only.
 */
export async function loadThreadSources(
  session: GtSession,
  pmOrg: string,
  issue: DcsIssue,
): Promise<ThreadSourceState[]> {
  const config = dcsConfig(session.host);
  const pmRepo = { owner: pmOrg, repo: PM_REPO_NAME };
  const marker = parsePortionPrMarker(issue.body);

  const pm = listIssueComments(config, pmOrg, PM_REPO_NAME, issue.number, session.token).then(
    (rows): ThreadSourceState => ({
      kind: "issue",
      cursorSource: "pm",
      status: "ok",
      items: rows.map((c) => commentToItem(c, "issue", pmRepo)),
    }),
    (err): ThreadSourceState => ({
      kind: "issue",
      cursorSource: "pm",
      status: "error",
      items: [],
      error: errorText(err),
    }),
  );
  if (!marker) return [await pm];

  const prRepo = { owner: marker.owner, repo: marker.repo };
  const pr = listIssueComments(config, marker.owner, marker.repo, marker.number, session.token).then(
    (rows): ThreadSourceState => ({
      kind: "pr",
      cursorSource: "pr",
      status: "ok",
      items: rows.map((c) => commentToItem(c, "pr", prRepo)),
    }),
    (err): ThreadSourceState => ({
      kind: "pr",
      cursorSource: "pr",
      status: "error",
      items: [],
      error: errorText(err),
    }),
  );
  const commits = listCommits(config, marker.owner, marker.repo, {
    sha: marker.head,
    limit: 50,
    token: session.token,
  }).then(
    (rows): ThreadSourceState => ({
      kind: "commit",
      status: "ok",
      items: (rows as unknown as RawCommit[])
        .map((c) => commitToItem(c, issue.number, prRepo))
        .filter((row): row is ThreadItem => Boolean(row)),
    }),
    // The work branch is deleted after Cerrar: saves are optional context.
    (): ThreadSourceState => ({ kind: "commit", status: "ok", items: [] }),
  );
  return Promise.all([pm, pr, commits]);
}

/** Reload only the failed sources, keeping the ones already loaded. */
export async function retryThreadSources(
  session: GtSession,
  pmOrg: string,
  issue: DcsIssue,
  current: ThreadSourceState[],
): Promise<ThreadSourceState[]> {
  const fresh = await loadThreadSources(session, pmOrg, issue);
  return fresh.map((next) => {
    const prev = current.find((s) => s.kind === next.kind);
    return next.status === "error" && prev?.status === "ok" ? prev : next;
  });
}
