import type { DcsIssue } from "@ip-lms/dcs-client";
import { parsePortionPrMarker } from "./portionPr";
import { PM_REPO_NAME } from "./types";

export type CommentSource = "pm" | "pr";

export type IssueUrlRef = {
  owner: string;
  repo: string;
  kind: "issues" | "pulls";
  number: number;
};

export type RepoRef = { owner: string; repo: string };

const ISSUE_URL_RE = /\/([^/?#]+)\/([^/?#]+)\/(issues|pulls)\/(\d+)\/?(?:[?#].*)?$/;

/** `…/{owner}/{repo}/(issues|pulls)/{n}` from an API or web URL, any host. */
export function parseIssueUrl(url: string | undefined): IssueUrlRef | null {
  if (!url) return null;
  const match = ISSUE_URL_RE.exec(url.trim());
  if (!match) return null;
  const number = Number(match[4]);
  if (!Number.isFinite(number) || number < 1) return null;
  return {
    owner: decodeURIComponent(match[1]),
    repo: decodeURIComponent(match[2]),
    kind: match[3] as IssueUrlRef["kind"],
    number,
  };
}

export function issueNumberFromUrl(url: string | undefined): number | null {
  return parseIssueUrl(url)?.number ?? null;
}

export function repoKey(owner: string, repo: string): string {
  return `${owner.trim().toLowerCase()}/${repo.trim().toLowerCase()}`;
}

function prKey(owner: string, repo: string, number: number): string {
  return `${repoKey(owner, repo)}#${number}`;
}

/** PR `owner/repo#n` → PM issue number, from `gateway-portion-pr` markers. */
export function buildPrIndex(issues: DcsIssue[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const issue of issues) {
    const marker = parsePortionPrMarker(issue.body);
    if (!marker) continue;
    index.set(prKey(marker.owner, marker.repo, marker.number), issue.number);
  }
  return index;
}

/** Distinct content repos holding PRs of these issues. */
export function contentReposOf(issues: DcsIssue[]): RepoRef[] {
  const seen = new Map<string, RepoRef>();
  for (const issue of issues) {
    const marker = parsePortionPrMarker(issue.body);
    if (!marker) continue;
    const key = repoKey(marker.owner, marker.repo);
    if (!seen.has(key)) seen.set(key, { owner: marker.owner, repo: marker.repo });
  }
  return [...seen.values()];
}

export type CommentUrls = {
  html_url?: string;
  issue_url?: string;
  pull_request_url?: string;
};

/**
 * Subtarea a comment belongs to. `polled` is the repo the comment was listed
 * from: numbers only mean something next to their `owner/repo`.
 */
export function mapCommentToIssue(
  comment: CommentUrls,
  polled: RepoRef,
  ctx: { pmOrg: string; prIndex: Map<string, number> },
): { issue: number; source: CommentSource } | null {
  const ref =
    parseIssueUrl(comment.pull_request_url) ||
    parseIssueUrl(comment.issue_url) ||
    parseIssueUrl(comment.html_url);
  if (!ref) return null;
  const polledKey = repoKey(polled.owner, polled.repo);
  if (repoKey(ref.owner, ref.repo) !== polledKey) return null;
  if (polledKey === repoKey(ctx.pmOrg, PM_REPO_NAME)) {
    return { issue: ref.number, source: "pm" };
  }
  const issue = ctx.prIndex.get(prKey(polled.owner, polled.repo, ref.number));
  return issue ? { issue, source: "pr" } : null;
}
