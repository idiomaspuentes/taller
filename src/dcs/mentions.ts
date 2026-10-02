import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import { activeScope, issueInScope } from "../domain/scope";

/**
 * Door43 notifications for this person (mentions, assignments, comments on issues they take part in),
 * limited to the project's own repository. They arrive even for issues the app does not know as
 * subtareas, so a mention is never invisible inside the app.
 */
export type MentionRow = {
  id: number;
  issue: number;
  title: string;
  at: string;
  /** What was said to this person, and by whom, when it could be read. */
  text?: string;
  by?: string;
};

type CommentRow = { body?: string; user?: { login?: string }; created_at?: string };

/**
 * What a notification is about, in the words of whoever wrote it: the latest comment that names this person, or
 * else the latest by somebody else. Mentions at the start and hidden marks are left out; it is cut to a few lines.
 */
export function mentionText(comments: CommentRow[], login: string): { text: string; by: string } | null {
  const me = login.trim().toLowerCase();
  const others = comments.filter((row) => typeof row.body === "string" && (row.user?.login ?? "").toLowerCase() !== me);
  const named = others.filter((row) => new RegExp(`@${me.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "i").test(row.body!));
  const pick = (named.length ? named : others).sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
  if (!pick) return null;
  const text = pick
    .body!.replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^(\s*@[\w-]+)+[\s,:]*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return { text: text.length > 220 ? `${text.slice(0, 217).trimEnd()}…` : text, by: pick.user?.login ?? "" };
}

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

/** Which issues belong to the active workspace, remembered so each is looked up once. */
const inSpace = new Map<string, boolean>();

async function belongsToSpace(session: GtSession, org: string, repo: string, issue: number, doFetch: typeof fetch): Promise<boolean> {
  const key = `${session.host}|${org}|${repo}|${issue}|${activeScope()}`;
  const known = inSpace.get(key);
  if (known !== undefined) return known;
  try {
    const res = await doFetch(`${dcsConfig(session.host).host}/api/v1/repos/${org}/${repo}/issues/${issue}`, { headers: headers(session) });
    if (!res.ok) return true; // not able to tell: do not hide a mention
    const ok = issueInScope((await res.json()) as { labels?: { name: string }[] });
    inSpace.set(key, ok);
    return ok;
  } catch {
    return true;
  }
}

/**
 * Notifications are per person, not per workspace. When several workspaces share an organization, only the
 * mentions of issues of the active one are shown.
 */
export async function listMentions(session: GtSession, org: string, repo: string, doFetch: typeof fetch = fetch): Promise<MentionRow[]> {
  const base = `${dcsConfig(session.host).host}/api/v1`;
  const res = await doFetch(`${base}/notifications?status-types=unread&subject-type=issue&limit=50`, { headers: headers(session) });
  if (!res.ok) return [];
  const rows = mentionRows((await res.json()) as Thread[], org, repo);
  const keep = await Promise.all(rows.map((row) => belongsToSpace(session, org, repo, row.issue, doFetch)));
  const mine = rows.filter((_, i) => keep[i]);
  // What each one says, so the list can be read without opening every conversation. A row whose comments cannot
  // be read still shows, by its title.
  return Promise.all(
    mine.map(async (row) => {
      try {
        const got = await doFetch(`${base}/repos/${org}/${repo}/issues/${row.issue}/comments`, { headers: headers(session) });
        const list = got.ok ? ((await got.json()) as unknown) : null;
        const said = Array.isArray(list) ? mentionText(list as CommentRow[], session.username) : null;
        return said ? { ...row, ...said } : row;
      } catch {
        return row;
      }
    }),
  );
}

export async function markMentionRead(session: GtSession, id: number, doFetch: typeof fetch = fetch): Promise<void> {
  const base = `${dcsConfig(session.host).host}/api/v1`;
  await doFetch(`${base}/notifications/threads/${id}?to-status=read`, { method: "PATCH", headers: headers(session) }).catch(() => undefined);
}

/**
 * What this device has already opened, as notification id → its `updated_at` when it was opened.
 * Door43 only lets a token mark notifications read with `write:notification`, which the app does not
 * ask for, so "already seen" is remembered here. A newer comment on the thread shows it again.
 */
export type SeenMentions = Record<string, string>;

export function withoutSeen(rows: MentionRow[], seen: SeenMentions): MentionRow[] {
  return rows.filter((r) => !seen[String(r.id)] || r.at > seen[String(r.id)]!);
}

export function markSeen(seen: SeenMentions, row: Pick<MentionRow, "id" | "at">, max = 200): SeenMentions {
  const next = { ...seen, [String(row.id)]: row.at };
  const keys = Object.keys(next);
  if (keys.length <= max) return next;
  // Forget the oldest ones.
  keys.sort((a, b) => (next[a]! < next[b]! ? -1 : 1));
  for (const key of keys.slice(0, keys.length - max)) delete next[key];
  return next;
}

export const seenKey = (host: string, username: string) => `gt-mentions-seen:${host.replace(/\/$/, "")}:${username.toLowerCase()}`;

export function loadSeen(key: string): SeenMentions {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" ? (parsed as SeenMentions) : {};
  } catch {
    return {};
  }
}

export function saveSeen(key: string, seen: SeenMentions): void {
  try {
    localStorage.setItem(key, JSON.stringify(seen));
  } catch {
    /* private window: they just show again next time */
  }
}
