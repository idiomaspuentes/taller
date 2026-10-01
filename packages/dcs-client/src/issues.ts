import type { DcsClientConfig } from "./config.js";
import { request } from "./http.js";

export interface DcsIssueUser {
  id: number;
  login: string;
  full_name?: string;
  avatar_url?: string;
  html_url?: string;
}

export interface DcsIssueLabel {
  id: number;
  name: string;
  color?: string;
  description?: string;
  exclusive?: boolean;
}

export interface DcsIssueMilestone {
  id: number;
  title: string;
  description?: string;
  state?: string;
  open_issues?: number;
  closed_issues?: number;
  due_on?: string;
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
}

export interface DcsIssue {
  id: number;
  number: number;
  title: string;
  body?: string;
  state: string;
  html_url?: string;
  url?: string;
  comments?: number;
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
  user?: DcsIssueUser;
  assignee?: DcsIssueUser | null;
  assignees?: DcsIssueUser[];
  labels?: DcsIssueLabel[];
  milestone?: DcsIssueMilestone | null;
  repository?: { id?: number; name?: string; owner?: string; full_name?: string };
}

export interface ListRepoIssuesParams {
  token: string;
  state?: "open" | "closed" | "all";
  labels?: string | string[];
  milestones?: string | string[];
  q?: string;
  type?: "issues" | "pulls";
  assignedBy?: string;
  createdBy?: string;
  mentionedBy?: string;
  since?: string;
  before?: string;
  page?: number;
  limit?: number;
}

function joinCsv(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.join(",") : value;
}

/** GET /repos/{owner}/{repo}/issues */
export function listRepoIssues(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  params: ListRepoIssuesParams,
): Promise<DcsIssue[]> {
  return request<DcsIssue[]>(config, {
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
    token: params.token,
    query: {
      state: params.state,
      labels: joinCsv(params.labels),
      milestones: joinCsv(params.milestones),
      q: params.q,
      type: params.type ?? "issues",
      assigned_by: params.assignedBy,
      created_by: params.createdBy,
      mentioned_by: params.mentionedBy,
      since: params.since,
      before: params.before,
      page: params.page !== undefined ? String(params.page) : undefined,
      limit: params.limit !== undefined ? String(params.limit) : undefined,
    },
  });
}

export interface SearchIssuesParams {
  token: string;
  state?: "open" | "closed" | "all";
  labels?: string | string[];
  milestones?: string | string[];
  q?: string;
  type?: "issues" | "pulls";
  /** Filter issues assigned to the authenticated user. */
  assigned?: boolean;
  created?: boolean;
  mentioned?: boolean;
  owner?: string;
  team?: string;
  createdBy?: string;
  since?: string;
  before?: string;
  page?: number;
  limit?: number;
}

/** GET /repos/issues/search — cross-repo search over repos the caller can see. */
export function searchIssues(config: DcsClientConfig, params: SearchIssuesParams): Promise<DcsIssue[]> {
  return request<DcsIssue[]>(config, {
    path: "/repos/issues/search",
    token: params.token,
    query: {
      state: params.state,
      labels: joinCsv(params.labels),
      milestones: joinCsv(params.milestones),
      q: params.q,
      type: params.type ?? "issues",
      assigned: params.assigned !== undefined ? String(params.assigned) : undefined,
      created: params.created !== undefined ? String(params.created) : undefined,
      mentioned: params.mentioned !== undefined ? String(params.mentioned) : undefined,
      owner: params.owner,
      team: params.team,
      created_by: params.createdBy,
      since: params.since,
      before: params.before,
      page: params.page !== undefined ? String(params.page) : undefined,
      limit: params.limit !== undefined ? String(params.limit) : undefined,
    },
  });
}

export interface CreateIssueParams {
  token: string;
  title: string;
  body?: string;
  assignee?: string;
  assignees?: string[];
  /** Label IDs (not names). */
  labels?: number[];
  milestone?: number;
  closed?: boolean;
  dueDate?: string;
  ref?: string;
}

/** POST /repos/{owner}/{repo}/issues */
export function createIssue(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  params: CreateIssueParams,
): Promise<DcsIssue> {
  return request<DcsIssue>(config, {
    method: "POST",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
    token: params.token,
    body: {
      title: params.title,
      body: params.body,
      assignee: params.assignee,
      assignees: params.assignees,
      labels: params.labels,
      milestone: params.milestone,
      closed: params.closed,
      due_date: params.dueDate,
      ref: params.ref,
    },
  });
}

/** GET /repos/{owner}/{repo}/issues/{index} */
export function getIssue(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  index: number,
  token: string,
): Promise<DcsIssue> {
  return request<DcsIssue>(config, {
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${index}`,
    token,
  });
}

export interface EditIssueParams {
  token: string;
  title?: string;
  body?: string;
  assignee?: string;
  assignees?: string[];
  milestone?: number;
  state?: "open" | "closed";
  dueDate?: string;
  unsetDueDate?: boolean;
  ref?: string;
}

/** PATCH /repos/{owner}/{repo}/issues/{index} */
export function editIssue(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  index: number,
  params: EditIssueParams,
): Promise<DcsIssue> {
  return request<DcsIssue>(config, {
    method: "PATCH",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${index}`,
    token: params.token,
    body: {
      title: params.title,
      body: params.body,
      assignee: params.assignee,
      assignees: params.assignees,
      milestone: params.milestone,
      state: params.state,
      due_date: params.dueDate,
      unset_due_date: params.unsetDueDate,
      ref: params.ref,
    },
  });
}

/** POST /repos/{owner}/{repo}/issues/{index}/assignees */
export function addIssueAssignees(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  index: number,
  assignees: string[],
  token: string,
): Promise<DcsIssue> {
  return request<DcsIssue>(config, {
    method: "POST",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${index}/assignees`,
    token,
    body: { assignees },
  });
}

/** DELETE /repos/{owner}/{repo}/issues/{index}/assignees */
export function removeIssueAssignees(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  index: number,
  assignees: string[],
  token: string,
): Promise<DcsIssue> {
  return request<DcsIssue>(config, {
    method: "DELETE",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${index}/assignees`,
    token,
    body: { assignees },
  });
}

export interface DcsIssueComment {
  id: number;
  body: string;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
  user?: DcsIssueUser;
}

/** GET /repos/{owner}/{repo}/issues/{index}/comments */
export function listIssueComments(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  index: number,
  token: string,
  opts: { since?: string; before?: string } = {},
): Promise<DcsIssueComment[]> {
  return request<DcsIssueComment[]>(config, {
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${index}/comments`,
    token,
    query: {
      since: opts.since,
      before: opts.before,
    },
  });
}

/** POST /repos/{owner}/{repo}/issues/{index}/comments */
export function createIssueComment(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  index: number,
  body: string,
  token: string,
): Promise<DcsIssueComment> {
  return request<DcsIssueComment>(config, {
    method: "POST",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${index}/comments`,
    token,
    body: { body },
  });
}

/** POST /repos/{owner}/{repo}/issues/{index}/labels — body is label ids or names. */
export function addIssueLabels(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  index: number,
  labels: Array<number | string>,
  token: string,
): Promise<DcsIssueLabel[]> {
  return request<DcsIssueLabel[]>(config, {
    method: "POST",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${index}/labels`,
    token,
    body: { labels },
  });
}

/** PUT /repos/{owner}/{repo}/issues/{index}/labels — replace all labels. */
export function replaceIssueLabels(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  index: number,
  labels: Array<number | string>,
  token: string,
): Promise<DcsIssueLabel[]> {
  return request<DcsIssueLabel[]>(config, {
    method: "PUT",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${index}/labels`,
    token,
    body: { labels },
  });
}
