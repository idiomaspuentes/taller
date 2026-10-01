import type { DcsClientConfig } from "./config.js";
import { request } from "./http.js";

/** Only the fields ARQUITECTURA.md §20.4's drift report actually reads — DCS returns considerably more. */
export interface DcsCommit {
  sha: string;
  html_url: string;
  created: string;
  commit: { message: string };
  /** Present when the caller didn't ask for a stripped-down response — which files this one commit touched. */
  files?: Array<{ filename: string; status: string }>;
}

export interface ListCommitsParams {
  /** Branch/tag/SHA to start listing from; omit for the repo's default branch. */
  sha?: string;
  limit?: number;
  token?: string;
}

/**
 * GET /repos/{owner}/{repo}/commits (API_DCS.md, operationId
 * `repoGetAllCommits`), newest first. `stat`/`verification` are
 * disabled — this is used to grab a HEAD sha cheaply (§20.4's baseline
 * capture), not to render commit detail.
 */
export function listCommits(config: DcsClientConfig, owner: string, repo: string, params: ListCommitsParams = {}): Promise<DcsCommit[]> {
  return request<DcsCommit[]>(config, {
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits`,
    query: {
      sha: params.sha,
      limit: params.limit !== undefined ? String(params.limit) : undefined,
      stat: "false",
      verification: "false",
    },
    token: params.token,
  });
}

export interface CompareResult {
  totalCommits: number;
  commits: DcsCommit[];
}

/**
 * GET /repos/{owner}/{repo}/compare/{basehead} (API_DCS.md, operationId
 * `repoCompareDiff`). `basehead` is `{base}...{head}` — both refs
 * resolved within *this one* `owner/repo`; the spec has no cross-repo
 * (`owner:branch`) syntax, confirmed against `dcs-api/swagger.v1.json`.
 * ARQUITECTURA.md §20.4's drift report relies on that: it compares a
 * fork's saved baseline commit against the *parent's* own current
 * branch by calling this on the parent repo, which only works because
 * that baseline SHA is a real commit in the parent's own history (see
 * `apps/admin/src/driftReport.ts`).
 */
export async function compareCommits(config: DcsClientConfig, owner: string, repo: string, basehead: string, token?: string): Promise<CompareResult> {
  const result = await request<{ total_commits: number; commits: DcsCommit[] }>(config, {
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(basehead)}`,
    token,
  });
  return { totalCommits: result.total_commits, commits: result.commits };
}
