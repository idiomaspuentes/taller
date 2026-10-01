import type { DcsClientConfig } from "./config.js";
import { request } from "./http.js";

export interface DcsRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { id: number; login: string };
  private: boolean;
  html_url: string;
  default_branch: string;
  description?: string;
  /** True when this repo was created as a fork. */
  fork?: boolean;
  /** Present (non-null) only when `fork` is true — the repo this one was forked from (Gitea's `Repository.parent`). */
  parent?: DcsRepo | null;
}

export interface CreateRepoParams {
  name: string;
  description?: string;
  private?: boolean;
  auto_init?: boolean;
  /**
   * The branch name Gitea records as this repo's default, even with
   * `auto_init: false` (no commits exist yet) — the first file created
   * afterward via the contents API lands on this branch, since that API
   * defaults to `repo.DefaultBranch` when no `branch` is given. Omit to
   * take the server's own configured default (not necessarily `main` —
   * e.g. this LMS's actual QA org's repos default to `master`), which
   * is why anything that later builds a raw-content URL by guessing a
   * branch name should set this explicitly instead of assuming.
   */
  default_branch?: string;
  token: string;
}

/**
 * POST /user/repos — creates a repo owned by the authenticated user
 * (API_DCS.md §4d). This is the "per-user progress repo" shape from
 * ARQUITECTURA.md §21 open question #1; kept here regardless of which
 * way that question resolves, since org-owned repos need it too as a
 * fallback/admin path.
 */
export function createUserRepo(config: DcsClientConfig, params: CreateRepoParams): Promise<DcsRepo> {
  return request<DcsRepo>(config, {
    method: "POST",
    path: "/user/repos",
    token: params.token,
    body: {
      name: params.name,
      description: params.description,
      private: params.private ?? false,
      auto_init: params.auto_init ?? true,
      default_branch: params.default_branch,
    },
  });
}

/** POST /org/{org}/repos — creates a repo under an organization (API_DCS.md §4d). */
export function createOrgRepo(config: DcsClientConfig, org: string, params: CreateRepoParams): Promise<DcsRepo> {
  return request<DcsRepo>(config, {
    method: "POST",
    path: `/org/${encodeURIComponent(org)}/repos`,
    token: params.token,
    body: {
      name: params.name,
      description: params.description,
      private: params.private ?? false,
      auto_init: params.auto_init ?? true,
      default_branch: params.default_branch,
    },
  });
}

export interface ListOrgReposParams {
  page?: number;
  limit?: number;
  token?: string;
}

/** GET /orgs/{org}/repos (API_DCS.md §4d). */
export function listOrgRepos(config: DcsClientConfig, org: string, params: ListOrgReposParams = {}): Promise<DcsRepo[]> {
  return request<DcsRepo[]>(config, {
    path: `/orgs/${encodeURIComponent(org)}/repos`,
    query: {
      page: params.page !== undefined ? String(params.page) : undefined,
      limit: params.limit !== undefined ? String(params.limit) : undefined,
    },
    token: params.token,
  });
}

export interface DcsOrg {
  id: number;
  name: string;
  full_name?: string;
  description?: string;
}

/** GET /user/orgs — the orgs the authenticated user belongs to (API_DCS.md §4d). */
export function getUserOrgs(config: DcsClientConfig, token: string): Promise<DcsOrg[]> {
  return request<DcsOrg[]>(config, { path: "/user/orgs", token });
}

/** GET /orgs/{org} (API_DCS.md §4d). */
export function getOrg(config: DcsClientConfig, org: string, token?: string): Promise<DcsOrg> {
  return request<DcsOrg>(config, { path: `/orgs/${encodeURIComponent(org)}`, token });
}

export interface CreateOrgParams {
  name: string;
  description?: string;
  /** Gitea default is "public" server-side when omitted; passed through explicitly here since an LMS hub org has no reason to default to anything else. */
  visibility?: "public" | "limited" | "private";
  token: string;
}

/**
 * POST /orgs — creates a new organization, owned by the signed-in
 * user (confirmed against `dcs-api/swagger.v1.json`, operationId
 * `orgCreate`; `CreateOrgOption`'s one required field is confusingly
 * named `username`, not `name`, even though it's the org's name).
 * ARQUITECTURA.md §20's org-bootstrap flow: creating the org is step
 * one, only reached when `getOrg` 404s for the configured org name.
 */
export function createOrg(config: DcsClientConfig, params: CreateOrgParams): Promise<DcsOrg> {
  return request<DcsOrg>(config, {
    method: "POST",
    path: "/orgs",
    token: params.token,
    body: {
      username: params.name,
      description: params.description,
      visibility: params.visibility ?? "public",
    },
  });
}

export interface DcsOrgMember {
  id: number;
  login: string;
  email?: string;
}

/** GET /orgs/{org}/members (API_DCS.md §4d). */
export function listOrgMembers(config: DcsClientConfig, org: string, token?: string): Promise<DcsOrgMember[]> {
  return request<DcsOrgMember[]>(config, { path: `/orgs/${encodeURIComponent(org)}/members`, token });
}

/** GET /repos/{owner}/{repo} (API_DCS.md, operationId `repoGet`) — the one call that returns a fork's `parent` and a repo's `default_branch` together. */
export function getRepo(config: DcsClientConfig, owner: string, repo: string, token?: string): Promise<DcsRepo> {
  return request<DcsRepo>(config, { path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, token });
}

export interface ForkRepoParams {
  /** Org to fork into (ARQUITECTURA.md §20.3's org-as-hub flow); omit to fork into the token owner's own account instead. */
  organization?: string;
  /** Rename on fork; omit to keep the source repo's name. */
  name?: string;
  token: string;
}

/**
 * POST /repos/{owner}/{repo}/forks — a real, server-side fork
 * (confirmed against `dcs-api/swagger.v1.json`, operationId
 * `createFork`; API_DCS.md). ARQUITECTURA.md §20.3: how an external
 * course gets incorporated into the configured org without cloning or
 * pushing anything from the browser. The response's `parent` is how
 * the LMS later recognizes "this repo is a fork of X" — no separate
 * bookkeeping needed on our side.
 */
export function forkRepo(config: DcsClientConfig, owner: string, repo: string, params: ForkRepoParams): Promise<DcsRepo> {
  return request<DcsRepo>(config, {
    method: "POST",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/forks`,
    token: params.token,
    body: {
      organization: params.organization,
      name: params.name,
    },
  });
}

export interface SearchReposParams {
  /** Repo topic(s) — Gitea ORs multiple values (confirmed against the swagger, `repoSearch`'s `topic` param). */
  topic: string | string[];
  owner?: string;
  page?: number;
  limit?: number;
  token?: string;
}

/**
 * GET /repos/search?topic=... — plain Gitea repo search by git topic,
 * NOT `GET /catalog/search` (`catalog.ts`). The two look similar but
 * aren't interchangeable: DCS's catalog only indexes repos with a
 * Resource-Container `manifest.yaml` (Bible translations,
 * translationNotes, etc.) — confirmed live 2026-09-07 by publishing a
 * real course repo (topic set, non-draft release cut) and finding it
 * absent from `searchCatalog` but present here immediately. This LMS's
 * `course.json` format isn't RC-shaped, so course discovery
 * (ARQUITECTURA.md §20.1, `apps/learner`'s `useCourseCatalog.ts` and
 * `apps/admin`'s `courseDiscovery.ts`) has to use this endpoint, not
 * the catalog one — API_DCS.md §4a had flagged this as unvalidated risk
 * before that test.
 */
export function searchReposByTopic(config: DcsClientConfig, params: SearchReposParams): Promise<{ ok: boolean; data: DcsRepo[] }> {
  return request<{ ok: boolean; data: DcsRepo[] }>(config, {
    path: "/repos/search",
    token: params.token,
    query: {
      topic: params.topic,
      owner: params.owner,
      page: params.page !== undefined ? String(params.page) : undefined,
      limit: params.limit !== undefined ? String(params.limit) : undefined,
    },
  });
}

/**
 * PUT /repos/{owner}/{repo}/topics — replaces a repo's full topic list
 * (204, no body; confirmed against the swagger, operationId
 * `repoUpdateTopics`). Idempotent by design (a full replace, not an
 * add), which is what publishing a course repo needs: setting the
 * org's configured course topic(s) (`@ip-lms/lms-config`) is how a
 * course becomes discoverable via `GET /catalog/search`'s `topic`
 * filter (ARQUITECTURA.md §20.1) — safe to call every time a course is
 * (re-)published, not just once.
 */
export function setRepoTopics(config: DcsClientConfig, owner: string, repo: string, topics: string[], token: string): Promise<void> {
  return request<void>(config, {
    method: "PUT",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/topics`,
    token,
    body: { topics },
  });
}

export interface MergeUpstreamParams {
  /** Branch to merge upstream into; omit to use the repo's default branch. */
  branch?: string;
  /** Reject instead of creating a merge commit when the merge isn't a fast-forward. */
  ffOnly?: boolean;
  token: string;
}

export interface MergeUpstreamResult {
  /** e.g. "fast-forward", "merge", "none" — whatever DCS/Gitea reports for the merge it just performed. */
  mergeType: string;
}

/**
 * POST /repos/{owner}/{repo}/merge-upstream — Gitea's server-side "sync
 * fork" (confirmed against the spec, operationId `repoMergeUpstream`).
 * Pulls new commits from `parent`'s branch into this fork's branch
 * entirely server-side. ARQUITECTURA.md §20.3: the mechanism behind
 * "Sincronizar con el original" for a course adopted as-is — NOT the
 * right tool for a translated/adapted fork, where §20.4's drift report
 * (no automatic merge) applies instead.
 */
export async function mergeUpstreamRepo(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  params: MergeUpstreamParams,
): Promise<MergeUpstreamResult> {
  const result = await request<{ merge_type: string }>(config, {
    method: "POST",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/merge-upstream`,
    token: params.token,
    body: {
      branch: params.branch,
      ff_only: params.ffOnly,
    },
  });
  return { mergeType: result.merge_type };
}
