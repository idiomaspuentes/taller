/**
 * Local read cursor for subtarea conversations (plan §5). Lives only in this
 * browser (`localStorage`); it is NOT the Door43 inbox `unread` flag, and
 * reading on git.door43.org never clears it.
 *
 * One cursor per source (`pm` = PM issue comments, `pr` = the subtarea PR's
 * comments in the content repo) instead of one merged id. Whether Gitea
 * comment ids are comparable across repos is an open QA item (plan §13), so
 * each id is only compared with ids from the same source.
 */
import type { CommentSource } from "./notificationMap";

export type { CommentSource };

export type ThreadCursor = Partial<Record<CommentSource, number>> & { at: string };

export type LatestComment = {
  id: number;
  at: string;
  author: string;
  preview: string;
};

export type ThreadLatest = Partial<Record<CommentSource, LatestComment>>;

export type ReadCursorDoc = {
  v: 1;
  seeded: boolean;
  /** Per polled repo (`owner/repo`, lowercase): client time of the last poll start. */
  polls: Record<string, string>;
  threads: Record<string, ThreadCursor>;
  /** Subtareas opened (thread or mini-app) in this browser: issue → time. */
  seenIssues: Record<string, string>;
  /** First load marked every subtarea assigned then as seen (slice 7). */
  seenSeeded: boolean;
  latest: Record<string, ThreadLatest>;
  /**
   * Highest decision-card comment id per issue and source, any author (the
   * closer's own card counts: it asks them to decide). Recorded for every PM
   * issue polled, so a subtarea that joins "decidir" later keeps its card.
   */
  decisions: Record<string, Partial<Record<CommentSource, number>>>;
};

const SOURCES: CommentSource[] = ["pm", "pr"];

export function emptyCursor(): ReadCursorDoc {
  return {
    v: 1,
    seeded: false,
    polls: {},
    threads: {},
    seenIssues: {},
    seenSeeded: false,
    latest: {},
    decisions: {},
  };
}

function hostOnly(host: string): string {
  return host.replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
}

export function cursorStorageKey(params: { host: string; username: string; pmOrg: string }): string {
  return `tas-chat:${hostOnly(params.host)}:${params.username.toLowerCase()}:${params.pmOrg.toLowerCase()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Corrupt or foreign JSON resets to an empty cursor instead of throwing. */
export function parseCursor(raw: string | null | undefined): ReadCursorDoc {
  if (!raw) return emptyCursor();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.v !== 1) return emptyCursor();
    return {
      v: 1,
      seeded: parsed.seeded === true,
      polls: isRecord(parsed.polls) ? (parsed.polls as Record<string, string>) : {},
      threads: isRecord(parsed.threads) ? (parsed.threads as Record<string, ThreadCursor>) : {},
      seenIssues: isRecord(parsed.seenIssues)
        ? (parsed.seenIssues as Record<string, string>)
        : {},
      seenSeeded: parsed.seenSeeded === true,
      latest: isRecord(parsed.latest) ? (parsed.latest as Record<string, ThreadLatest>) : {},
      decisions: isRecord(parsed.decisions)
        ? (parsed.decisions as ReadCursorDoc["decisions"])
        : {},
    };
  } catch {
    return emptyCursor();
  }
}

export function loadCursor(key: string): ReadCursorDoc {
  try {
    return parseCursor(localStorage.getItem(key));
  } catch {
    return emptyCursor();
  }
}

export function saveCursor(key: string, doc: ReadCursorDoc): void {
  try {
    localStorage.setItem(key, JSON.stringify(doc));
  } catch {
    /* quota / private mode: the dot is best-effort */
  }
}

function laterIso(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/**
 * Union of two cursors (tabs share `localStorage`): highest id wins per
 * thread and source, so a poll in one tab never undoes a read in another.
 */
export function mergeCursors(a: ReadCursorDoc, b: ReadCursorDoc): ReadCursorDoc {
  const polls: Record<string, string> = { ...a.polls };
  for (const [key, at] of Object.entries(b.polls)) polls[key] = laterIso(polls[key], at) ?? at;

  const threads: Record<string, ThreadCursor> = { ...a.threads };
  for (const [key, row] of Object.entries(b.threads)) {
    const prev = threads[key];
    const next: ThreadCursor = { ...prev, ...row, at: laterIso(prev?.at, row.at) ?? row.at };
    for (const source of SOURCES) {
      next[source] = Math.max(prev?.[source] ?? 0, row[source] ?? 0) || undefined;
    }
    threads[key] = next;
  }

  const latest: Record<string, ThreadLatest> = { ...a.latest };
  for (const [key, row] of Object.entries(b.latest)) {
    const next: ThreadLatest = { ...latest[key] };
    for (const source of SOURCES) {
      const other = row[source];
      if (other && (!next[source] || other.id > next[source]!.id)) next[source] = other;
    }
    latest[key] = next;
  }

  const decisions: ReadCursorDoc["decisions"] = { ...a.decisions };
  for (const [key, row] of Object.entries(b.decisions)) {
    const next = { ...decisions[key] };
    for (const source of SOURCES) {
      const id = Math.max(next[source] ?? 0, row[source] ?? 0);
      if (id) next[source] = id;
    }
    decisions[key] = next;
  }

  return {
    v: 1,
    seeded: a.seeded || b.seeded,
    polls,
    threads,
    seenIssues: { ...a.seenIssues, ...b.seenIssues },
    seenSeeded: a.seenSeeded || b.seenSeeded,
    latest,
    decisions,
  };
}

export type MappedComment = {
  issue: number;
  source: CommentSource;
  id: number;
  createdAt: string;
  author: string;
  body: string;
};

/**
 * Fold polled comments into `latest`. Own comments never count (own actions
 * never raise the dot). Keeps the highest id per issue and source.
 */
export function recordLatest(
  doc: ReadCursorDoc,
  comments: MappedComment[],
  opts: { me: string; preview: (body: string) => string },
): ReadCursorDoc {
  const me = opts.me.trim().toLowerCase();
  let latest = doc.latest;
  for (const row of comments) {
    if (!Number.isFinite(row.id) || row.issue < 1) continue;
    if (me && row.author.trim().toLowerCase() === me) continue;
    const key = String(row.issue);
    const prev = latest[key]?.[row.source];
    if (prev && prev.id >= row.id) continue;
    if (latest === doc.latest) latest = { ...doc.latest };
    latest[key] = {
      ...latest[key],
      [row.source]: {
        id: row.id,
        at: row.createdAt,
        author: row.author,
        preview: opts.preview(row.body),
      },
    };
  }
  return latest === doc.latest ? doc : { ...doc, latest };
}

/** Fold decision-card comments (any author) into `decisions`; highest id wins. */
export function recordDecisions(
  doc: ReadCursorDoc,
  comments: MappedComment[],
  isDecision: (body: string) => boolean,
): ReadCursorDoc {
  let decisions = doc.decisions;
  for (const row of comments) {
    if (!Number.isFinite(row.id) || row.issue < 1) continue;
    const key = String(row.issue);
    if ((decisions[key]?.[row.source] ?? 0) >= row.id) continue;
    if (!isDecision(row.body)) continue;
    if (decisions === doc.decisions) decisions = { ...doc.decisions };
    decisions[key] = { ...decisions[key], [row.source]: row.id };
  }
  return decisions === doc.decisions ? doc : { ...doc, decisions };
}

/**
 * Mark everything currently in `latest` as read for the given issues and
 * sources (or all of `latest` when `issues` is omitted). Used for the first
 * poll in a browser, and for a repo polled for the first time, so existing
 * history does not flood the list with dots. Never passes a recorded
 * decision card: only opening the thread reads it.
 */
export function seedRead(
  doc: ReadCursorDoc,
  opts: { issues?: number[]; sources?: CommentSource[]; now?: string } = {},
): ReadCursorDoc {
  const at = opts.now ?? new Date().toISOString();
  const sources = opts.sources ?? SOURCES;
  const keys = opts.issues ? opts.issues.map(String) : Object.keys(doc.latest);
  const threads = { ...doc.threads };
  for (const key of keys) {
    const latest = doc.latest[key];
    if (!latest) continue;
    const next: ThreadCursor = { ...threads[key], at: threads[key]?.at ?? at };
    for (const source of sources) {
      let id = latest[source]?.id;
      const decision = doc.decisions[key]?.[source];
      if (id && decision && decision <= id && decision > (next[source] ?? 0)) id = decision - 1;
      if (id && id > (next[source] ?? 0)) next[source] = id;
    }
    threads[key] = next;
  }
  return { ...doc, threads };
}

export function seedIfEmpty(doc: ReadCursorDoc, now?: string): ReadCursorDoc {
  if (doc.seeded) return doc;
  return { ...seedRead(doc, { now }), seeded: true };
}

/** Advance one thread's cursor; never moves backwards, never touches others. */
export function markThreadRead(
  doc: ReadCursorDoc,
  issue: number,
  maxIds: Partial<Record<CommentSource, number>>,
  now: string = new Date().toISOString(),
): ReadCursorDoc {
  const key = String(issue);
  const next: ThreadCursor = { ...doc.threads[key], at: now };
  for (const source of SOURCES) {
    const id = maxIds[source];
    if (id && id > (next[source] ?? 0)) next[source] = id;
  }
  return { ...doc, threads: { ...doc.threads, [key]: next } };
}

export function hasUnread(doc: ReadCursorDoc, issue: number): boolean {
  const key = String(issue);
  const latest = doc.latest[key];
  if (!latest) return false;
  const cursor = doc.threads[key];
  return SOURCES.some((source) => {
    const id = latest[source]?.id;
    return Boolean(id && id > (cursor?.[source] ?? 0));
  });
}

/**
 * A pending decision (DECIDIR row) is unread until the thread is opened past
 * its card. With no card recorded (older than the poll window), until the
 * thread has any cursor here.
 */
export function hasDecisionUnread(doc: ReadCursorDoc, issue: number): boolean {
  const key = String(issue);
  const ids = doc.decisions[key];
  const cursor = doc.threads[key];
  if (!ids || !SOURCES.some((source) => ids[source])) return !cursor;
  return SOURCES.some((source) => {
    const id = ids[source];
    return Boolean(id && id > (cursor?.[source] ?? 0));
  });
}

export function countUnread(doc: ReadCursorDoc, issues: Iterable<number>): number {
  let n = 0;
  for (const issue of new Set(issues)) if (hasUnread(doc, issue)) n++;
  return n;
}

/** Newest comment from another person across sources (by creation time). */
export function latestActivity(doc: ReadCursorDoc, issue: number): LatestComment | null {
  const latest = doc.latest[String(issue)];
  if (!latest) return null;
  let best: LatestComment | null = null;
  for (const source of SOURCES) {
    const row = latest[source];
    if (!row) continue;
    if (!best || Date.parse(row.at) > Date.parse(best.at)) best = row;
  }
  return best;
}

/**
 * First time in this browser: everything assigned now counts as seen, so
 * only subtareas assigned later show "nueva". Runs once per cursor key.
 */
export function seedSeenIfEmpty(doc: ReadCursorDoc, issues: number[], now: string = new Date().toISOString()): ReadCursorDoc {
  if (doc.seenSeeded) return doc;
  const seenIssues = { ...doc.seenIssues };
  for (const issue of issues) if (issue > 0 && !seenIssues[String(issue)]) seenIssues[String(issue)] = now;
  return { ...doc, seenIssues, seenSeeded: true };
}

export function markSeen(doc: ReadCursorDoc, issue: number, now: string = new Date().toISOString()): ReadCursorDoc {
  if (issue < 1 || doc.seenIssues[String(issue)]) return doc;
  return { ...doc, seenIssues: { ...doc.seenIssues, [String(issue)]: now } };
}

/** Assigned after the seed and never opened here. */
export function isNewTask(doc: ReadCursorDoc, issue: number): boolean {
  return doc.seenSeeded && issue > 0 && !doc.seenIssues[String(issue)];
}

/**
 * Badge: subtareas with unread messages, not opened yet, or with a pending
 * decision not read yet (each counted once).
 */
export function countAttention(
  doc: ReadCursorDoc,
  issues: Iterable<number>,
  pendingDecisions: Iterable<number> = [],
): number {
  const deciding = new Set(pendingDecisions);
  let n = 0;
  for (const issue of new Set([...issues, ...deciding])) {
    if (hasUnread(doc, issue) || isNewTask(doc, issue) || (deciding.has(issue) && hasDecisionUnread(doc, issue))) {
      n++;
    }
  }
  return n;
}
