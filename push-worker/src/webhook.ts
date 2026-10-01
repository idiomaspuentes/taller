/** What Door43 tells the Worker (a Gitea webhook) turned into who to notify and what to say. */

export type Notice = { login: string; title: string; body: string; url: string; tag: string };

const MENTION = /(?:^|[^\w@/])@([A-Za-z0-9][A-Za-z0-9._-]*)/g;
const CHAT_MARKER = /<!--\s*tas:[^>]*-->/g;

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

/** The part of a comment people read: the app's comments end with a machine marker. */
export function readableLine(body: string, max = 140): string {
  const first =
    body
      .replace(CHAT_MARKER, "")
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith(">")) ?? "";
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

type Person = { login?: string };
type Issue = { number?: number; title?: string; html_url?: string; assignees?: Person[]; assignee?: Person | null };
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

/** The name of a subtarea in a notice: its number and its title, shortened. */
function subtarea(issue: Issue): string {
  const t = (issue.title ?? "").trim();
  return `#${issue.number ?? "?"}${t ? ` ${t.length > 60 ? `${t.slice(0, 59)}…` : t}` : ""}`;
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
  const what = isPr ? "la solicitud de cambios" : "";
  const name = (i: Issue) => (isPr ? `${what} #${i.number}${i.title ? ` ${i.title}` : ""}` : subtarea(i));
  const notices: Notice[] = [];

  if ((event === "issue_comment" || event === "pull_request_comment") && payload.action === "created" && payload.comment?.body) {
    const body = payload.comment.body;
    const mentioned = new Set(mentionsIn(body));
    const assignees = new Set((issue.assignees ?? (issue.assignee ? [issue.assignee] : [])).map((a) => lower(a.login)).filter(Boolean));
    const line = readableLine(body);
    for (const login of new Set([...mentioned, ...assignees])) {
      if (!login || login === sender) continue;
      notices.push({
        login,
        title: mentioned.has(login) ? `Te mencionaron en ${name(issue)}` : `Comentario nuevo en ${name(issue)}`,
        body: `${payload.comment.user?.login ?? "Alguien"}: ${line}`.trim(),
        url,
        tag: `subtarea-${number}`,
      });
    }
  } else if (event === "issues" && payload.action === "assigned") {
    const login = lower(payload.assignee?.login);
    if (login && login !== sender) {
      notices.push({ login, title: "Te asignaron una subtarea", body: subtarea(issue), url, tag: `subtarea-${number}` });
    }
  } else if (event === "pull_request" && (payload.action === "assigned" || payload.action === "review_requested")) {
    const login = lower(payload.action === "assigned" ? payload.assignee?.login : (payload as { requested_reviewer?: Person }).requested_reviewer?.login);
    if (login && login !== sender) {
      notices.push({ login, title: payload.action === "assigned" ? "Te asignaron una solicitud de cambios" : "Te pidieron revisar una solicitud de cambios", body: name(issue), url, tag: `pr-${number}` });
    }
  }
  return notices;
}
