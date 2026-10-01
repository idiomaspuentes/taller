import type { GtSession } from "./auth";
import { dcsConfig } from "./config";

/**
 * Door43 notifications for this person (mentions, assignments, comments on issues they take part in),
 * limited to the project's own repository. They arrive even for issues the app does not know as
 * subtareas, so a mention is never invisible inside the app.
 */
export type MentionRow = { id: number; issue: number; title: string; at: string };

type Thread = {
  id: number;
  unread?: boolean;
  updated_at?: string;
  subject?: { title?: string; url?: string; type?: string };
  repository?: { full_name?: string };
};

export function issueNumberOf(url: string | undefined): number | null {
  const match = /\/issues\/(\d+)(?:$|[?#])/.exec(url ?? "");
  return match ? Number(match[1]) : null;
}

/** Keep unread issue notifications of `org/repo`, newest first. */
export function mentionRows(threads: Thread[], org: string, repo: string): MentionRow[] {
  const wanted = `${org}/${repo}`.toLowerCase();
  const rows: MentionRow[] = [];
  for (const t of threads) {
    if (t.unread === false || t.subject?.type !== "Issue") continue;
    if ((t.repository?.full_name ?? "").toLowerCase() !== wanted) continue;
    const issue = issueNumberOf(t.subject?.url);
    if (!issue) continue;
    rows.push({ id: t.id, issue, title: t.subject?.title ?? `Subtarea #${issue}`, at: t.updated_at ?? "" });
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

function headers(session: GtSession): Record<string, string> {
  return { authorization: `token ${session.token}`, accept: "application/json" };
}

export async function listMentions(session: GtSession, org: string, repo: string, doFetch: typeof fetch = fetch): Promise<MentionRow[]> {
  const base = `${dcsConfig(session.host).host}/api/v1`;
  const res = await doFetch(`${base}/notifications?status-types=unread&subject-type=issue&limit=50`, { headers: headers(session) });
  if (!res.ok) return [];
  return mentionRows((await res.json()) as Thread[], org, repo);
}

export async function markMentionRead(session: GtSession, id: number, doFetch: typeof fetch = fetch): Promise<void> {
  const base = `${dcsConfig(session.host).host}/api/v1`;
  await doFetch(`${base}/notifications/threads/${id}?to-status=read`, { method: "PATCH", headers: headers(session) }).catch(() => undefined);
}
