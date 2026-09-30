/**
 * One conversation per subtarea (plan §3). Pure: sources are loaded
 * elsewhere and normalized here into one timeline. Nothing in this module
 * knows what a verse is; typed events carry their own meaning.
 */
import type { DcsIssue } from "@ip-lms/dcs-client";
import { CHAT_EVENT_SCHEMA, parseChatEvent, type ChatEvent } from "./chatEvent";
import type { CommentSource } from "./notificationMap";
import { parseTaskProgressMarker } from "./taskProgress";

export type ThreadSourceKind = "issue" | "pr" | "review" | "commit" | "local";
export type ThreadItemKind = "humano" | "sistema" | "decision";

export type ThreadItem = {
  /** `{source}:{owner}/{repo}:{id}`: ids of different repos never collide. */
  key: string;
  source: ThreadSourceKind;
  id: number;
  createdAt: string;
  author: string;
  kind: ThreadItemKind;
  /** Visible text: never HTML comments or base64 markers. */
  text: string;
  event?: ChatEvent;
  /** Local items: waiting for DCS, or the send failed. */
  pending?: "enviando" | "error";
  /** Local items drop once the real item with this key arrives. */
  reconcileKey?: string;
  /** Collapsed run of `saved` events. */
  count?: number;
  until?: string;
};

export type ThreadSourceState = {
  kind: ThreadSourceKind;
  /** Only comment sources feed the read cursor. */
  cursorSource?: CommentSource;
  status: "ok" | "error";
  items: ThreadItem[];
  error?: string;
};

export type RawComment = {
  id: number;
  body?: string | null;
  created_at?: string;
  user?: { login?: string } | null;
};

export type RawCommit = {
  sha: string;
  created?: string;
  commit?: { message?: string; author?: { name?: string; date?: string } };
  author?: { login?: string } | null;
};

/** Remove every `<!-- … -->` (also an unterminated one) and the blank lines left behind. */
export function stripHtmlComments(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!--[\s\S]*$/, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function systemEvent(type: string, summary: string, issue = 0): ChatEvent {
  return { schema: CHAT_EVENT_SCHEMA, type, emitter: "tas", issue, summary };
}

const MERGED_RE = /^Versículos\s+(.+?)\s+de\s+#(\d+)\s+(fusionados|ya estaban)/i;
const APPROVED_RE = /^Aprobado en TAS:\s*«([^»]+)»(?:\s*·\s*subtarea\s*#(\d+))?/;
const LEGACY_CONFLICT_RE = /<!-- tas:verse-conflicts [A-Za-z0-9_-]+ -->/;

/**
 * Plan §6.1. Every non-human comment becomes a typed event, even from an
 * older format, so the view has one render path.
 */
export function classifyComment(body: string | null | undefined): {
  kind: ThreadItemKind;
  text: string;
  event?: ChatEvent;
} {
  const raw = body ?? "";
  const event = parseChatEvent(raw);
  if (event) {
    return { kind: event.decision ? "decision" : "sistema", text: event.summary, event };
  }
  const text = stripHtmlComments(raw);
  if (LEGACY_CONFLICT_RE.test(raw)) {
    const summary = "Conflicto de versículos al cerrar";
    return { kind: "sistema", text: summary, event: systemEvent("verse-conflicts-recorded", summary) };
  }
  const merged = MERGED_RE.exec(text);
  if (merged) {
    const summary =
      merged[3]!.toLowerCase() === "fusionados"
        ? `Versículos ${merged[1]} guardados en el borrador grupal`
        : `Versículos ${merged[1]} ya estaban en el borrador grupal`;
    return { kind: "sistema", text: summary, event: systemEvent("verses-merged", summary, Number(merged[2])) };
  }
  const approved = APPROVED_RE.exec(text);
  if (approved) {
    const summary = `Aprobado: ${approved[1]}`;
    return {
      kind: "sistema",
      text: summary,
      event: systemEvent("step-approved", summary, Number(approved[2]) || 0),
    };
  }
  return { kind: "humano", text };
}

export function commentToItem(
  comment: RawComment,
  source: "issue" | "pr",
  repo: { owner: string; repo: string },
): ThreadItem {
  const { kind, text, event } = classifyComment(comment.body);
  return {
    key: `${source}:${repo.owner.toLowerCase()}/${repo.repo.toLowerCase()}:${comment.id}`,
    source,
    id: comment.id,
    createdAt: comment.created_at ?? "",
    author: comment.user?.login ?? "",
    kind,
    text,
    ...(event ? { event } : {}),
  };
}

const SAVE_RE = /^TAS:\s+(.+?)\s+\(([^)]+)\)\s+·\s+#(\d+)\s*$/;

/** `TAS: NEH 1:10–11 (tpl) · #41` → label for that issue; null for other commits. */
export function parseSaveCommit(message: string | undefined, issueNumber: number): string | null {
  const first = (message ?? "").split("\n")[0]!.trim();
  const match = SAVE_RE.exec(first);
  if (!match || Number(match[3]) !== issueNumber) return null;
  return match[1]!.replace(/^[A-Z0-9]{3}\s+/, "").trim() || match[1]!;
}

export function commitToItem(
  commit: RawCommit,
  issueNumber: number,
  repo: { owner: string; repo: string },
): ThreadItem | null {
  const label = parseSaveCommit(commit.commit?.message, issueNumber);
  if (!label) return null;
  const author = commit.author?.login || commit.commit?.author?.name || "";
  const summary = `Guardado ${label}`;
  return {
    key: `commit:${repo.owner.toLowerCase()}/${repo.repo.toLowerCase()}:${commit.sha}`,
    source: "commit",
    id: 0,
    createdAt: commit.created || commit.commit?.author?.date || "",
    author,
    kind: "sistema",
    text: summary,
    event: systemEvent("saved", summary, issueNumber),
    reconcileKey: commit.sha,
  };
}

/** Guardar from a mini-app, shown before the commit list reflects it. */
export function localSavedItem(
  message: string,
  issueNumber: number,
  author: string,
  commitSha: string | undefined,
  now: Date = new Date(),
): Omit<ThreadItem, "source"> | null {
  const label = parseSaveCommit(message, issueNumber);
  if (!label) return null;
  const summary = `Guardado ${label}`;
  const id = commitSha || `${now.getTime()}`;
  return {
    key: `local:save:${id}`,
    id: 0,
    createdAt: now.toISOString(),
    author,
    kind: "sistema",
    text: summary,
    event: systemEvent("saved", summary, issueNumber),
    reconcileKey: commitSha,
  };
}

/** Cerrar from Mis tareas; the real close has no comment, so it expires by TTL. */
export function localClosedItem(
  issueNumber: number,
  author: string,
  now: Date = new Date(),
): Omit<ThreadItem, "source"> {
  const summary = "Tarea cerrada";
  return {
    key: `local:closed:${issueNumber}:${now.getTime()}`,
    id: 0,
    createdAt: now.toISOString(),
    author,
    kind: "sistema",
    text: summary,
    event: systemEvent("closed", summary, issueNumber),
  };
}

const SOURCE_ORDER: Record<ThreadSourceKind, number> = {
  issue: 0,
  pr: 1,
  review: 2,
  commit: 3,
  local: 4,
};

function time(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/**
 * One timeline: by `created_at` (an edit never moves a comment), then
 * source, then id. Duplicate keys (reload, overlapping pages) keep one.
 * Local items whose `reconcileKey` already arrived from DCS are dropped.
 */
export function mergeTimeline(items: ThreadItem[]): ThreadItem[] {
  const real = new Set<string>();
  for (const item of items) {
    if (item.source === "local") continue;
    real.add(item.key);
    if (item.reconcileKey) real.add(item.reconcileKey);
  }
  const seen = new Set<string>();
  const out: ThreadItem[] = [];
  for (const item of items) {
    if (seen.has(item.key)) continue;
    if (item.source === "local" && item.reconcileKey && real.has(item.reconcileKey)) continue;
    seen.add(item.key);
    out.push(item);
  }
  return out.sort(
    (a, b) =>
      time(a.createdAt) - time(b.createdAt) ||
      SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] ||
      a.id - b.id ||
      a.key.localeCompare(b.key),
  );
}

/** Consecutive `saved` events of the same author collapse into one line. */
export function groupSaves(items: ThreadItem[]): ThreadItem[] {
  const out: ThreadItem[] = [];
  for (const item of items) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.event?.type === "saved" &&
      item.event?.type === "saved" &&
      prev.author === item.author &&
      !item.pending
    ) {
      out[out.length - 1] = {
        ...prev,
        count: (prev.count ?? 1) + 1,
        until: item.createdAt,
      };
      continue;
    }
    out.push(item);
  }
  return out;
}

/**
 * Per-source max comment id to store in the read cursor, or null when any
 * comment source failed: the user did not see everything, so the cursor
 * must not move (plan §5).
 */
export function threadReadIds(
  sources: ThreadSourceState[],
): Partial<Record<CommentSource, number>> | null {
  if (!sources.length) return null;
  const ids: Partial<Record<CommentSource, number>> = {};
  for (const source of sources) {
    if (!source.cursorSource) continue;
    if (source.status !== "ok") return null;
    for (const item of source.items) {
      if (item.id > (ids[source.cursorSource] ?? 0)) ids[source.cursorSource] = item.id;
    }
  }
  return ids;
}

/** Assignees plus people seated or approving on any step of the subtarea. */
export function issueParticipants(issue: Pick<DcsIssue, "assignee" | "assignees" | "body">): string[] {
  const logins = new Set<string>();
  if (issue.assignee?.login) logins.add(issue.assignee.login);
  for (const row of issue.assignees ?? []) if (row.login) logins.add(row.login);
  const progress = parseTaskProgressMarker(issue.body ?? "");
  for (const runtime of Object.values(progress.steps ?? {})) {
    for (const login of [...runtime.assignees, ...runtime.approvals]) if (login) logins.add(login);
  }
  return [...logins];
}

/**
 * Workers open only their own subtareas (assigned or step role); a gestor
 * in gestor view opens any. DCS lets members read the whole PM repo, so the
 * app filters (plan §9).
 */
export function canOpenConversation(
  issue: Pick<DcsIssue, "assignee" | "assignees" | "body">,
  username: string,
  canManage: boolean,
  /** A team decision (nobody assigned) opens to the people of the task's team. */
  teamDecision = false,
): boolean {
  if (canManage || teamDecision) return true;
  const me = username.trim().toLowerCase();
  if (!me) return false;
  return issueParticipants(issue).some((login) => login.toLowerCase() === me);
}

/**
 * Something the mini-app lets you quote in a reply (plan §8.4): a verse for
 * Scripture, a note row for TN, a paragraph for TW. v1 ships verses.
 */
export type CiteTarget = { id: string; ref: string; text: string };

const QUOTE_MAX = 160;

/** `> **NEH 1:10** texto…` plus a blank line, ready to prepend to the draft. */
export function quoteVerse(ref: string, text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const short = clean.length > QUOTE_MAX ? `${clean.slice(0, QUOTE_MAX - 1).trimEnd()}…` : clean;
  return `> **${ref.trim()}**${short ? ` ${short}` : ""}\n\n`;
}

export function insertQuote(draft: string, quote: string): string {
  return draft.trim() ? `${quote}${draft.replace(/^\n+/, "")}` : quote;
}

/**
 * Who `@` suggests: assignees, step actors and people who already wrote in
 * this thread. Never teams or the whole org; never me.
 */
export function mentionCandidates(
  issue: Pick<DcsIssue, "assignee" | "assignees" | "body">,
  items: Pick<ThreadItem, "author" | "kind">[],
  me: string,
): string[] {
  const self = me.trim().toLowerCase();
  const out = new Map<string, string>();
  const add = (login: string) => {
    const l = login.trim().replace(/^@/, "");
    if (!l || l.toLowerCase() === self || l.includes("/")) return;
    if (!out.has(l.toLowerCase())) out.set(l.toLowerCase(), l);
  };
  for (const login of issueParticipants(issue)) add(login);
  for (const item of items) if (item.kind === "humano" && item.author) add(item.author);
  return [...out.values()];
}

const MENTION_RE = /(^|[^\w`@])@([A-Za-z0-9][\w.-]*(?:\/[\w.-]+)?)/g;

/**
 * DCS notifies every valid `@login` and `@org/team`. Only participants keep
 * a live mention; anything else is wrapped in code so nobody else (and no
 * team) gets a notification.
 */
export function sanitizeMentions(body: string, allowed: string[]): string {
  const ok = new Set(allowed.map((l) => l.toLowerCase()));
  return body.replace(MENTION_RE, (all, lead: string, login: string) => {
    const trimmed = login.replace(/[.-]+$/, "");
    const tail = login.slice(trimmed.length);
    if (!trimmed.includes("/") && ok.has(trimmed.toLowerCase())) return all;
    return `${lead}\`@${trimmed}\`${tail}`;
  });
}

/** `@pre` being typed right before the caret, or null. */
export function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([\w.-]*)$/.exec(before);
  if (!m) return null;
  return { start: caret - m[2]!.length - 1, query: m[2]! };
}

/** "BO" for "bob", "AM" for "ana-maria". */
export function initials(login: string): string {
  const parts = login.replace(/^@/, "").split(/[-_.\s]+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}
