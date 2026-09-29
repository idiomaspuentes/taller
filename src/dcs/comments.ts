import { DcsApiError, request } from "@ip-lms/dcs-client";
import { dcsConfig } from "./config";
import type { GtSession } from "./auth";

/** Row of `GET /repos/{o}/{r}/issues/comments` (issues and PRs share the index). */
export type DcsRepoComment = {
  id: number;
  body: string;
  html_url?: string;
  issue_url?: string;
  pull_request_url?: string;
  user?: { login?: string } | null;
  created_at: string;
  updated_at?: string;
};

const PAGE_SIZE = 50;

/**
 * Every comment in a repo updated since `since` (DCS filters by `updated_at`,
 * so an edited comment comes back; callers dedupe by id). Read-only.
 * A missing repo returns `[]`.
 */
export async function listRepoComments(
  session: GtSession,
  owner: string,
  repo: string,
  opts: { since?: string; maxPages?: number } = {},
): Promise<DcsRepoComment[]> {
  const config = dcsConfig(session.host);
  const maxPages = Math.max(1, opts.maxPages ?? 4);
  const out: DcsRepoComment[] = [];
  for (let page = 1; page <= maxPages; page++) {
    let rows: DcsRepoComment[];
    try {
      rows = await request<DcsRepoComment[]>(config, {
        path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/comments`,
        token: session.token,
        query: {
          since: opts.since,
          page: String(page),
          limit: String(PAGE_SIZE),
        },
      });
    } catch (err) {
      if (err instanceof DcsApiError && err.status === 404) return out;
      throw err;
    }
    if (!Array.isArray(rows) || !rows.length) break;
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}
