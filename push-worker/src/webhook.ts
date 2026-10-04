/** What Door43 tells the Worker (a Gitea webhook) turned into who to notify and what to say. */
import { askedNotice, commentNotice, readableLine, say, subtaskName, type AskedKind, type NoticeIssue, type NoticeLang, type NoticeWords } from "../../src/domain/noticeText";

export { readableLine };

/**
 * A notice for one person. What it says depends on the language of each of their devices (`words`); `title`, `body`
 * and `grouped` are those words in Spanish, for the log and for a device that never said its language.
 * `grouped` is what the app shows when several notices share a tag; `{n}` is their count.
 */
export type Notice = { login: string; url: string; tag: string; words: (lang: NoticeLang) => NoticeWords; title: string; body: string; grouped?: string };

function notice(login: string, url: string, tag: string, words: (lang: NoticeLang) => NoticeWords): Notice {
  return { login, url, tag, words, ...words("es") };
}

const MENTION = /(?:^|[^\w@/])@([A-Za-z0-9][A-Za-z0-9._-]*)/g;

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Gitea signs the body with HMAC-SHA256 and sends it hex encoded (optionally as `sha256=…`). */
export async function validSignature(secret: string, body: string, header: string | null): Promise<boolean> {
  if (!secret || !header) return false;
  const given = header.replace(/^sha256=/i, "").trim().toLowerCase();
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export function mentionsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(MENTION)) out.add(m[1]!.toLowerCase());
  return [...out];
}

type Person = { login?: string };
type Issue = NoticeIssue & { html_url?: string; assignees?: Person[]; assignee?: Person | null };
export type GiteaPayload = {
  action?: string;
  issue?: Issue;
  pull_request?: Issue;
  comment?: { body?: string; user?: Person };
  sender?: Person;
  assignee?: Person;
  repository?: { html_url?: string; full_name?: string };
};

/** `https://qa.door43.org/BSOJ/gateway-tasks` → `https://qa.door43.org`. */
export function hostOf(payload: GiteaPayload): string | null {
  try {
    return payload.repository?.html_url ? new URL(payload.repository.html_url).origin : null;
  } catch {
    return null;
  }
}

const lower = (login: string | undefined) => (login ?? "").toLowerCase();

/** A subtarea as a notice names it, in Spanish (see `subtaskName`). */
export function subtarea(issue: Issue): string {
  return subtaskName(issue, "es");
}

/**
 * Who to tell, and what, for one Door43 event:
 * - a comment mentions people, or is on a subtarea somebody has: they are told (never its author);
 * - a subtarea is assigned to somebody: that person is told.
 */
export function noticesFor(event: string | null, payload: GiteaPayload, appUrl: string): Notice[] {
  const isPr = event === "pull_request_comment" || event === "pull_request";
  const issue = isPr ? (payload.pull_request ?? payload.issue) : payload.issue;
  const number = issue?.number;
  if (!issue || !number) return [];
  const sender = lower(payload.sender?.login ?? payload.comment?.user?.login);
  // Pull requests are not subtareas: the notice opens the request on Door43.
  const url = isPr ? (issue.html_url ?? "") : `${appUrl.replace(/\/$/, "")}/#/mis-tareas/${number}`;
  if (!url) return [];
  const name = (lang: NoticeLang) => (isPr ? `${say(lang, "nt.prName", { n: number })}${issue.title ? ` ${issue.title}` : ""}` : subtaskName(issue, lang));
  const notices: Notice[] = [];

  if ((event === "issue_comment" || event === "pull_request_comment") && payload.action === "created" && payload.comment?.body) {
    const body = payload.comment.body;
    const author = payload.comment.user?.login ?? "";
    const mentioned = new Set(mentionsIn(body));
    const assignees = new Set((issue.assignees ?? (issue.assignee ? [issue.assignee] : [])).map((a) => lower(a.login)).filter(Boolean));
    for (const login of new Set([...mentioned, ...assignees])) {
      if (!login || login === sender) continue;
      notices.push(notice(login, url, `subtarea-${number}`, (lang) => commentNotice({ issue, body, author, mentioned: mentioned.has(login), name: name(lang) }, lang)));
    }
  } else if (event === "issues" && payload.action === "assigned") {
    const login = lower(payload.assignee?.login);
    if (login && login !== sender) {
      // Many assignments at once (a bulk plan) become one notice: «Te asignaron 100 subtareas».
      notices.push(notice(login, url, "asignaciones", (lang) => ({ title: say(lang, "nt.assignedTitle"), body: subtaskName(issue, lang), grouped: say(lang, "nt.assignedGrouped") })));
    }
  } else if (event === "pull_request" && (payload.action === "assigned" || payload.action === "review_requested")) {
    const login = lower(payload.action === "assigned" ? payload.assignee?.login : (payload as { requested_reviewer?: Person }).requested_reviewer?.login);
    if (login && login !== sender) {
      const key = payload.action === "assigned" ? "nt.prAssignedTitle" : "nt.prReviewTitle";
      notices.push(notice(login, url, `pr-${number}`, (lang) => ({ title: say(lang, key), body: name(lang) })));
    }
  }
  return notices;
}

const KINDS: AskedKind[] = ["free", "your-turn", "step-turn", "step-free", "decision"];
export const isAskedKind = (value: unknown): value is AskedKind => KINDS.includes(value as AskedKind);

/**
 * What the app asks to be told, because Door43 does not announce it by itself: a subtarea became free for a team,
 * it is somebody's turn, a decision waits. The app says which subtareas and who; what the notice says is worded
 * here, from the subtarea as Door43 has it, never from text the caller sends.
 */
export function askedNotices(params: { kind: AskedKind; issue: Issue; count: number; to: string[]; step?: string; from: string; appUrl: string }): Notice[] {
  const { kind, issue, count } = params;
  const app = params.appUrl.replace(/\/$/, "");
  const one = count <= 1 && issue.number;
  // One subtarea opens its own thread; a free one, or several, open the list where it is taken.
  const url = one && kind !== "free" ? `${app}/#/mis-tareas/${issue.number}` : `${app}/#/avisos`;
  const tag = kind === "free" ? "libres" : kind === "your-turn" ? "turno" : `subtarea-${issue.number}`;
  const from = lower(params.from);
  return [...new Set(params.to.map(lower))]
    .filter((login) => login && login !== from)
    .map((login) => notice(login, url, tag, (lang) => askedNotice(kind, { name: subtaskName(issue, lang), step: params.step, count }, lang)));
}
