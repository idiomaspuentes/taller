import type { DcsClientConfig } from "./config.js";
import { request } from "./http.js";

export interface DcsRelease {
  id: number;
  tag_name: string;
  name?: string;
  body?: string;
  draft: boolean;
  prerelease: boolean;
  target_commitish?: string;
}

export interface ListReleasesParams {
  page?: number;
  limit?: number;
  token?: string;
}

/** GET /repos/{owner}/{repo}/releases (swagger operationId `repoListReleases`). */
export function listReleases(config: DcsClientConfig, owner: string, repo: string, params: ListReleasesParams = {}): Promise<DcsRelease[]> {
  return request<DcsRelease[]>(config, {
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`,
    token: params.token,
    query: {
      page: params.page !== undefined ? String(params.page) : undefined,
      limit: params.limit !== undefined ? String(params.limit) : undefined,
    },
  });
}

export interface CreateReleaseParams {
  tagName: string;
  name?: string;
  body?: string;
  /** Branch/commit the tag is cut from; omit to use the repo's default branch. */
  targetCommitish?: string;
  token: string;
}

/**
 * POST /repos/{owner}/{repo}/releases (swagger operationId
 * `repoCreateRelease`) — not a draft, not a prerelease. DCS's catalog
 * classifies a release with neither flag set as `stage: "prod"`
 * (API_DCS.md §4a), which is what `searchCatalog({ stage: "prod" })`
 * requires for a course to be discoverable (ARQUITECTURA.md §20.1) —
 * that classification is exactly why this function doesn't expose
 * `draft`/`prerelease` params: every caller in this codebase wants prod.
 */
export function createRelease(config: DcsClientConfig, owner: string, repo: string, params: CreateReleaseParams): Promise<DcsRelease> {
  return request<DcsRelease>(config, {
    method: "POST",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`,
    token: params.token,
    body: {
      tag_name: params.tagName,
      name: params.name,
      body: params.body,
      target_commitish: params.targetCommitish,
      draft: false,
      prerelease: false,
    },
  });
}
