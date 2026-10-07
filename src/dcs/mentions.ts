import type { NoticeIssue } from "../domain/noticeText";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import { asksWhileOpen } from "../domain/commentPlace";
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
  /** The subtarea it is about, as Door43 has it: what names it in the list. */
  about?: NoticeIssue;
  /** What was said to this person, and by whom, when it could be read. */
  text?: string;
  by?: string;
  /**
   * When somebody else last wrote in it. «Already seen» is compared with this, not with `at`: Door43 touches a
   * notification when its subtarea is closed too, and what had been opened came back with nothing new in it.
   */
  saidAt?: string;
};

type CommentRow = { body?: string; user?: { login?: string }; created_at?: string };

const naming = (login: string) => new RegExp(`@${login.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "i");
const authorOf = (row: CommentRow) => (row.user?.login ?? "").toLowerCase();
const newestFirst = (a: CommentRow, b: CommentRow) => (b.created_at ?? "").localeCompare(a.created_at ?? "");

/**
 * The comment a notification is about for this person, and when somebody else last wrote: the latest that names
 * them, or else the latest by somebody else. Once they answered it (they wrote later, to whoever said it), only
 * what was said after their answer counts; `null` when that is nothing. Door43 keeps the notification unread all
 * the same, and a question answered from its tool stayed in «Avisos» as if nobody had seen it.
 */
export function mentionComment(comments: CommentRow[], login: string): { about: CommentRow; lastAt: string } | null {
  const me = login.trim().toLowerCase();
  const said = comments.filter((row) => typeof row.body === "string");
  const pick = (from: CommentRow[]) => {
    const others = from.filter((row) => authorOf(row) !== me).sort(newestFirst);
    const about = others.find((row) => naming(me).test(row.body!)) ?? others[0];
    return about ? { about, lastAt: others[0]!.created_at ?? "" } : null;
  };
  const first = pick(said);
  if (!first || !authorOf(first.about)) return first;
  const toAuthor = naming(authorOf(first.about));
  const answer = said.filter((row) => authorOf(row) === me && (row.created_at ?? "") > (first.about.created_at ?? "") && toAuthor.test(row.body!)).sort(newestFirst)[0];
  return answer ? pick(said.filter((row) => (row.created_at ?? "") > (answer.created_at ?? ""))) : first;
}

/**
 * What a notification is about, in the words of whoever wrote it. Mentions at the start and hidden marks are left
 * out; it is cut to a few lines.
 */
export function mentionText(comments: CommentRow[], login: string): { text: string; by: string; saidAt: string } | null {
  const found = mentionComment(comments, login);
  if (!found) return null;
  const pick = found.about;
  const text = pick
    .body!.replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^(\*\*[^*]+\*\*\s*—\s*)?(?:\s*@[\w-]+)+[\s,:]*/, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return { text: text.length > 220 ? `${text.slice(0, 217).trimEnd()}…` : text, by: pick.user?.login ?? "", saidAt: found.lastAt };
}

/** Whether somebody else named this person in what was said about a subtarea. */
export function namesPerson(comments: CommentRow[], login: string): boolean {
  const me = login.trim().toLowerCase();
  if (!me) return false;
  const named = new RegExp(`@${me.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "i");
  return comments.some((row) => typeof row.body === "string" && (row.user?.login ?? "").toLowerCase() !== me && named.test(row.body));
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

type Placed = { show: boolean; about?: NoticeIssue; closed?: boolean; sure: boolean };

async function belongsToSpace(session: GtSession, org: string, repo: string, issue: number, doFetch: typeof fetch): Promise<Placed> {
  try {
    const res = await doFetch(`${dcsConfig(session.host).host}/api/v1/repos/${org}/${repo}/issues/${issue}`, { headers: headers(session) });
    // A subtarea that was deleted leaves its notification behind in Door43: there is nothing to open, so it is
    // not listed. Any other failure cannot tell: a mention is not hidden for it.
    if (res.status === 404) return { show: false, sure: true };
    if (!res.ok) return { show: true, sure: false };
    const found = (await res.json()) as NoticeIssue & { labels?: { name: string }[]; state?: string };
    return { show: issueInScope(found), about: { number: issue, title: found.title, body: found.body, milestone: found.milestone, labels: found.labels }, closed: found.state === "closed", sure: true };
  } catch {
    return { show: true, sure: false };
  }
}

/**
 * What each notification came to, kept until Door43 touches it again. Forty notifications of finished subtareas had
 * their subtarea and its comments read every minute, to be left out every time.
 */
const settled = new Map<string, MentionRow | null>();

/**
 * Notifications are per person, not per workspace. When several workspaces share an organization, only the
 * mentions of issues of the active one are shown. Each says what was said, so the list can be read without opening
 * every conversation; one whose comments cannot be read still shows, by its title.
 */
export async function listMentions(session: GtSession, org: string, repo: string, doFetch: typeof fetch = fetch): Promise<MentionRow[]> {
  const base = `${dcsConfig(session.host).host}/api/v1`;
  const res = await doFetch(`${base}/notifications?status-types=unread&subject-type=issue&limit=50`, { headers: headers(session) });
  if (!res.ok) return [];
  const rows = mentionRows((await res.json()) as Thread[], org, repo);
  const said = await Promise.all(
    rows.map(async (row): Promise<MentionRow | null> => {
      const key = `${session.host}|${session.username}|${org}/${repo}|${activeScope()}|${row.id}|${row.at}`.toLowerCase();
      if (settled.has(key)) return settled.get(key)!;
      const placed = await belongsToSpace(session, org, repo, row.issue, doFetch);
      const keep = (out: MentionRow | null, sure = placed.sure) => {
        if (sure) settled.set(key, out);
        return out;
      };
      if (!placed.show) return keep(null);
      const mine = placed.about ? { ...row, about: placed.about } : row;
      try {
        const got = await doFetch(`${base}/repos/${org}/${repo}/issues/${row.issue}/comments`, { headers: headers(session) });
        const list = got.ok ? ((await got.json()) as unknown) : null;
        if (!Array.isArray(list)) return keep(mine, false);
        const comments = list as CommentRow[];
        // A subtarea that is finished, where nobody named this person: Door43 keeps its notification unread until
        // it is opened, and twenty-seven of them stood over the one mention that asked something.
        if (placed.closed && !namesPerson(comments, session.username)) return keep(null);
        const found = mentionComment(comments, session.username);
        // Answered already; or it asked for something of a subtarea that is finished now.
        if (!found && comments.some((comment) => typeof comment.body === "string")) return keep(null);
        if (placed.closed && asksWhileOpen(found?.about.body)) return keep(null);
        const text = mentionText(comments, session.username);
        return keep(text ? { ...mine, ...text } : mine);
      } catch {
        return mine;
      }
    }),
  );
  return said.filter((row): row is MentionRow => row !== null);
}

export async function markMentionRead(session: GtSession, id: number, doFetch: typeof fetch = fetch): Promise<void> {
  const base = `${dcsConfig(session.host).host}/api/v1`;
  await doFetch(`${base}/notifications/threads/${id}?to-status=read`, { method: "PATCH", headers: headers(session) }).catch(() => undefined);
}

/**
 * What this device has already opened, as notification id → its `updated_at` when it was opened. Door43 is told
 * too, but a pasted token may not be allowed to, and Door43 makes a notification unread again whenever its subtarea
 * is touched: "already seen" is remembered here. Something newer said in the conversation shows it again.
 */
export type SeenMentions = Record<string, string>;

export function withoutSeen(rows: MentionRow[], seen: SeenMentions): MentionRow[] {
  return rows.filter((r) => !seen[String(r.id)] || (r.saidAt || r.at) > seen[String(r.id)]!);
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
