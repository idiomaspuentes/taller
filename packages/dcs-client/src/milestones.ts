import type { DcsClientConfig } from "./config.js";
import { request } from "./http.js";
import type { DcsIssueMilestone } from "./issues.js";

export type { DcsIssueMilestone as DcsMilestone };

export interface ListMilestonesParams {
  token: string;
  state?: "open" | "closed" | "all";
  name?: string;
  page?: number;
  limit?: number;
}

/** GET /repos/{owner}/{repo}/milestones */
export function listMilestones(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  params: ListMilestonesParams,
): Promise<DcsIssueMilestone[]> {
  return request<DcsIssueMilestone[]>(config, {
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/milestones`,
    token: params.token,
    query: {
      state: params.state,
      name: params.name,
      page: params.page !== undefined ? String(params.page) : undefined,
      limit: params.limit !== undefined ? String(params.limit) : undefined,
    },
  });
}

export interface CreateMilestoneParams {
  token: string;
  title: string;
  description?: string;
  dueOn?: string;
  state?: "open" | "closed";
}

/** POST /repos/{owner}/{repo}/milestones */
export function createMilestone(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  params: CreateMilestoneParams,
): Promise<DcsIssueMilestone> {
  return request<DcsIssueMilestone>(config, {
    method: "POST",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/milestones`,
    token: params.token,
    body: {
      title: params.title,
      description: params.description,
      due_on: params.dueOn,
      state: params.state,
    },
  });
}

export interface EditMilestoneParams {
  token: string;
  title?: string;
  description?: string;
  dueOn?: string;
  state?: "open" | "closed";
}

/** PATCH /repos/{owner}/{repo}/milestones/{id} */
export function editMilestone(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  id: number | string,
  params: EditMilestoneParams,
): Promise<DcsIssueMilestone> {
  return request<DcsIssueMilestone>(config, {
    method: "PATCH",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/milestones/${encodeURIComponent(String(id))}`,
    token: params.token,
    body: {
      title: params.title,
      description: params.description,
      due_on: params.dueOn,
      state: params.state,
    },
  });
}
