import type { DcsClientConfig } from "./config.js";
import { request } from "./http.js";
import type { DcsRepo } from "./repos.js";

export interface DcsTeam {
  id: number;
  name: string;
  description?: string;
  permission: "none" | "read" | "write" | "admin" | "owner";
  /** Absent only in malformed/edge-case API responses — a real team always belongs to an org. */
  organization?: { id: number; name: string };
  units?: string[];
  /** What the team may do per unit (`repo.code`: `read` | `write` | …). Current servers answer with this and leave `permission` as `none` when it is set. */
  units_map?: Record<string, string>;
}

/**
 * GET /user/teams — every team the authenticated user belongs to,
 * across every org they're in. Needs no elevated permission: it's the
 * caller's own memberships (confirmed against `dcs-api/swagger.v1.json`,
 * operationId `userListTeams`). This is the mechanism ARQUITECTURA.md
 * §20.2 uses to resolve LMS roles — filter the result to the
 * configured org and check team *names* against `@ip-lms/lms-config`'s
 * `hasLmsCapability`, resolved per-org (not a single hardcoded
 * convention — an org can rename its own teams via `lms-config`).
 */
export function getUserTeams(config: DcsClientConfig, token: string): Promise<DcsTeam[]> {
  return request<DcsTeam[]>(config, { path: "/user/teams", token });
}

export interface ListOrgTeamsParams {
  page?: number;
  limit?: number;
}

/**
 * GET /orgs/{org}/teams — every team *in the org*, not just the
 * caller's own memberships (unlike `getUserTeams`). Used to resolve
 * `LmsCapability` → team `id`, which the member-management endpoints
 * below need (they address a team by numeric id, not by name). Doesn't
 * require org-admin rights to call — just membership in the org.
 */
export function listOrgTeams(
  config: DcsClientConfig,
  org: string,
  token: string,
  params: ListOrgTeamsParams = {},
): Promise<DcsTeam[]> {
  return request<DcsTeam[]>(config, {
    path: `/orgs/${encodeURIComponent(org)}/teams`,
    token,
    query: {
      page: params.page !== undefined ? String(params.page) : undefined,
      limit: params.limit !== undefined ? String(params.limit) : undefined,
    },
  });
}

/** GET /teams/{id} */
export function getTeam(config: DcsClientConfig, teamId: number, token: string): Promise<DcsTeam> {
  return request<DcsTeam>(config, { path: `/teams/${teamId}`, token });
}

export interface CreateTeamParams {
  name: string;
  description?: string;
  permission: "read" | "write" | "admin";
  /** Whether this team's members can create new repos in the org (Gitea's `CanCreateOrgRepo`) — distinct from `permission`, which governs access to repos the team already has, not the ability to make new ones. */
  canCreateOrgRepo?: boolean;
  /** `false` (the default here) scopes the team to only the repos explicitly granted via `addTeamRepo` — `true` grants it every repo in the org, present and future, which is more than most of the three LMS roles should have by default. */
  includesAllRepositories?: boolean;
  /** Gitea unit keys. Defaults to `["repo.code"]`. Pass `["repo.code", "repo.issues"]` when the team needs issue write. */
  units?: string[];
  /** Per-unit access (`{ "repo.code": "write" }`). Current servers need this to grant anything but read: `permission` alone is ignored when `units` is sent. */
  unitsMap?: Record<string, string>;
  token: string;
}

/**
 * POST /orgs/{org}/teams — creates a team (confirmed against the
 * swagger, operationId `orgCreateTeam`). Used exactly once per
 * capability, by the org-bootstrap flow (`apps/admin/src/orgBootstrap.ts`,
 * ARQUITECTURA.md §20 setup wizard) when a configured org doesn't
 * already have the team a capability needs — everyday role management
 * (`useTeamRoles.ts`) only ever adds/removes *members*, never creates
 * a team itself, per §20.2's original boundary.
 */
export function createTeam(config: DcsClientConfig, org: string, params: CreateTeamParams): Promise<DcsTeam> {
  return request<DcsTeam>(config, {
    method: "POST",
    path: `/orgs/${encodeURIComponent(org)}/teams`,
    token: params.token,
    body: {
      name: params.name,
      description: params.description,
      permission: params.permission,
      can_create_org_repo: params.canCreateOrgRepo ?? false,
      includes_all_repositories: params.includesAllRepositories ?? false,
      units: params.units ?? ["repo.code"],
      units_map: params.unitsMap,
    },
  });
}

export interface EditTeamParams {
  token: string;
  name: string;
  description?: string;
  permission?: "read" | "write" | "admin";
  canCreateOrgRepo?: boolean;
  includesAllRepositories?: boolean;
  units?: string[];
  /** Per-unit access; see {@link CreateTeamParams.unitsMap}. */
  unitsMap?: Record<string, string>;
}

/** PATCH /teams/{id} */
export function editTeam(
  config: DcsClientConfig,
  teamId: number,
  params: EditTeamParams,
): Promise<DcsTeam> {
  return request<DcsTeam>(config, {
    method: "PATCH",
    path: `/teams/${teamId}`,
    token: params.token,
    body: {
      name: params.name,
      description: params.description,
      permission: params.permission,
      can_create_org_repo: params.canCreateOrgRepo,
      includes_all_repositories: params.includesAllRepositories,
      units: params.units,
      units_map: params.unitsMap,
    },
  });
}

/**
 * PUT /teams/{id}/repos/{org}/{repo} — grants a team access to one
 * specific repo (204, no body) — how a team created with
 * `includesAllRepositories: false` actually gets scoped to something,
 * e.g. giving `lms-admins`/`lms-instructors` read of `lms-progress`
 * without also handing that same access to `lms-content-editors`.
 */
export function addTeamRepo(config: DcsClientConfig, teamId: number, org: string, repo: string, token: string): Promise<void> {
  return request<void>(config, {
    method: "PUT",
    path: `/teams/${teamId}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`,
    token,
  });
}

/** DELETE /teams/{id}/repos/{org}/{repo} */
export function removeTeamRepo(
  config: DcsClientConfig,
  teamId: number,
  org: string,
  repo: string,
  token: string,
): Promise<void> {
  return request<void>(config, {
    method: "DELETE",
    path: `/teams/${teamId}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`,
    token,
  });
}

export interface ListTeamReposParams {
  page?: number;
  limit?: number;
}

/** GET /teams/{id}/repos */
export function listTeamRepos(
  config: DcsClientConfig,
  teamId: number,
  token: string,
  params: ListTeamReposParams = {},
): Promise<DcsRepo[]> {
  return request<DcsRepo[]>(config, {
    path: `/teams/${teamId}/repos`,
    token,
    query: {
      page: params.page !== undefined ? String(params.page) : undefined,
      limit: params.limit !== undefined ? String(params.limit) : undefined,
    },
  });
}

export interface DcsTeamMember {
  id: number;
  login: string;
  full_name?: string;
  avatar_url?: string;
}

export interface ListTeamMembersParams {
  page?: number;
  limit?: number;
}

/** GET /teams/{id}/members — everyone currently on a team. */
export function listTeamMembers(
  config: DcsClientConfig,
  teamId: number,
  token: string,
  params: ListTeamMembersParams = {},
): Promise<DcsTeamMember[]> {
  return request<DcsTeamMember[]>(config, {
    path: `/teams/${teamId}/members`,
    token,
    query: {
      page: params.page !== undefined ? String(params.page) : undefined,
      limit: params.limit !== undefined ? String(params.limit) : undefined,
    },
  });
}

/**
 * GET /teams/{id}/members/{username} — 200 if the user is a member,
 * 404 otherwise. Returns true/false without throwing on 404.
 */
export async function checkTeamMember(
  config: DcsClientConfig,
  teamId: number,
  username: string,
  token: string,
): Promise<boolean> {
  try {
    await request<DcsTeamMember>(config, {
      path: `/teams/${teamId}/members/${encodeURIComponent(username)}`,
      token,
    });
    return true;
  } catch (err) {
    if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
      return false;
    }
    throw err;
  }
}

/**
 * PUT /teams/{id}/members/{username} — add a user to a team (204, no
 * body). DCS enforces server-side that the caller has org-admin rights
 * over the team; a 403 here means the signed-in admin's own DCS
 * account isn't actually an org owner/admin, not a bug in this call.
 */
export function addTeamMember(config: DcsClientConfig, teamId: number, username: string, token: string): Promise<void> {
  return request<void>(config, { method: "PUT", path: `/teams/${teamId}/members/${encodeURIComponent(username)}`, token });
}

/** DELETE /teams/{id}/members/{username} — remove a user from a team (204, no body). Same server-side permission requirement as `addTeamMember`. */
export function removeTeamMember(config: DcsClientConfig, teamId: number, username: string, token: string): Promise<void> {
  return request<void>(config, { method: "DELETE", path: `/teams/${teamId}/members/${encodeURIComponent(username)}`, token });
}
