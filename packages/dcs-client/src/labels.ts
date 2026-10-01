import type { DcsClientConfig } from "./config.js";
import { request } from "./http.js";
import type { DcsIssueLabel } from "./issues.js";

export type { DcsIssueLabel as DcsLabel };

export interface ListLabelsParams {
  token: string;
  page?: number;
  limit?: number;
}

/** GET /repos/{owner}/{repo}/labels */
export function listLabels(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  params: ListLabelsParams,
): Promise<DcsIssueLabel[]> {
  return request<DcsIssueLabel[]>(config, {
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels`,
    token: params.token,
    query: {
      page: params.page !== undefined ? String(params.page) : undefined,
      limit: params.limit !== undefined ? String(params.limit) : undefined,
    },
  });
}

export interface CreateLabelParams {
  token: string;
  name: string;
  color: string;
  description?: string;
  exclusive?: boolean;
}

/** POST /repos/{owner}/{repo}/labels */
export function createLabel(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  params: CreateLabelParams,
): Promise<DcsIssueLabel> {
  return request<DcsIssueLabel>(config, {
    method: "POST",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels`,
    token: params.token,
    body: {
      name: params.name,
      color: params.color.replace(/^#/, ""),
      description: params.description,
      exclusive: params.exclusive,
    },
  });
}

export interface EditLabelParams {
  token: string;
  name?: string;
  color?: string;
  description?: string;
  exclusive?: boolean;
}

/** PATCH /repos/{owner}/{repo}/labels/{id} */
export function editLabel(
  config: DcsClientConfig,
  owner: string,
  repo: string,
  id: number,
  params: EditLabelParams,
): Promise<DcsIssueLabel> {
  return request<DcsIssueLabel>(config, {
    method: "PATCH",
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels/${id}`,
    token: params.token,
    body: {
      name: params.name,
      color: params.color?.replace(/^#/, ""),
      description: params.description,
      exclusive: params.exclusive,
    },
  });
}
