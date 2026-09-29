/**
 * Browser notifications for conversation attention (plan slice 9). Pure:
 * which attention items are new, which to show, and the ids already notified
 * in this browser. The page-side Notification calls live in
 * `src/browserNotifications.ts`.
 */
import type { CommentSource } from "./notificationMap";
import type { ReadCursorDoc } from "./readCursor";
import { isNewTask } from "./readCursor";
import { previewLine } from "./attention";

export type NotifyKind = "comment" | "decision" | "task";

export type NotifyCandidate = {
  /** Stable per item: `c:{source}:{commentId}`, `d:{source}:{commentId}`, `t:{issue}`. */
  id: string;
  issue: number;
  kind: NotifyKind;
  /** Produced by the signed-in user: remembered, never shown. */
  own: boolean;
  title: string;
  body: string;
};

export type NotifiedDoc = {
  v: 1;
  /** First evaluation in this browser recorded what already existed. */
  seeded: boolean;
  ids: string[];
};

export type NotifyPermission = "unsupported" | "default" | "granted" | "denied";

const SOURCES: CommentSource[] = ["pm", "pr"];
const MAX_IDS = 400;

export function emptyNotified(): NotifiedDoc {
  return { v: 1, seeded: false, ids: [] };
}

/** Sits next to the read cursor key (same host/user/org). */
export function notifiedStorageKey(cursorKey: string): string {
  return `${cursorKey}:avisos`;
}

export function parseNotified(raw: string | null | undefined): NotifiedDoc {
  if (!raw) return emptyNotified();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || (parsed as NotifiedDoc).v !== 1) return emptyNotified();
    const ids = (parsed as NotifiedDoc).ids;
    return {
      v: 1,
      seeded: (parsed as NotifiedDoc).seeded === true,
      ids: Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [],
    };
  } catch {
    return emptyNotified();
  }
}

function portionTitle(issue: number, titles: Record<string, string>): string {
  const title = titles[String(issue)]?.trim();
  return title || `Subtarea #${issue}`;
}

/**
 * Current attention items for the badge's subtareas: unread comments from
 * others, decision cards past the cursor and subtareas not opened yet.
 */
export function attentionCandidates(params: {
  doc: ReadCursorDoc;
  issues: number[];
  decisionIssues: number[];
  titles: Record<string, string>;
  me: string;
  /** Comment ids written by the signed-in user (from the poll). */
  ownCommentIds?: Iterable<number>;
}): NotifyCandidate[] {
  const { doc, titles } = params;
  const me = params.me.trim().toLowerCase();
  const own = new Set(params.ownCommentIds ?? []);
  const out: NotifyCandidate[] = [];

  for (const issue of new Set(params.issues)) {
    if (issue < 1) continue;
    const key = String(issue);
    const cursor = doc.threads[key];
    for (const source of SOURCES) {
      const latest = doc.latest[key]?.[source];
      if (!latest || latest.id <= (cursor?.[source] ?? 0)) continue;
      out.push({
        id: `c:${source}:${latest.id}`,
        issue,
        kind: "comment",
        own: own.has(latest.id) || (Boolean(me) && latest.author.trim().toLowerCase() === me),
        title: portionTitle(issue, titles),
        body: previewLine(latest),
      });
    }
    if (isNewTask(doc, issue)) {
      out.push({
        id: `t:${issue}`,
        issue,
        kind: "task",
        own: false,
        title: portionTitle(issue, titles),
        body: "Tarea nueva asignada",
      });
    }
  }

  for (const issue of new Set(params.decisionIssues)) {
    if (issue < 1) continue;
    const key = String(issue);
    const cursor = doc.threads[key];
    for (const source of SOURCES) {
      const id = doc.decisions[key]?.[source];
      if (!id || id <= (cursor?.[source] ?? 0)) continue;
      out.push({
        id: `d:${source}:${id}`,
        issue,
        kind: "decision",
        own: own.has(id),
        title: portionTitle(issue, titles),
        body: "Decisión pendiente: conflicto de versículos",
      });
    }
  }

  return out;
}

/**
 * Which candidates to show now, and the notified ids to remember. Every
 * current candidate is remembered, shown or not, so an item that appeared
 * while the tab was visible (or before permission) never fires later.
 */
export function shouldNotify(params: {
  candidates: NotifyCandidate[];
  notified: NotifiedDoc;
  visibility: DocumentVisibilityState | string;
  permission: NotifyPermission;
}): { show: NotifyCandidate[]; notified: NotifiedDoc } {
  const known = new Set(params.notified.ids);
  const fresh: NotifyCandidate[] = [];
  const added: string[] = [];
  for (const candidate of params.candidates) {
    if (known.has(candidate.id)) continue;
    known.add(candidate.id);
    added.push(candidate.id);
    fresh.push(candidate);
  }
  const canShow =
    params.notified.seeded && params.visibility === "hidden" && params.permission === "granted";
  const show = canShow ? fresh.filter((c) => !c.own) : [];
  const ids = [...params.notified.ids, ...added];
  return {
    show,
    notified: { v: 1, seeded: true, ids: ids.length > MAX_IDS ? ids.slice(-MAX_IDS) : ids },
  };
}

/** Hash route opened when the notification is clicked. */
export function notificationHref(candidate: Pick<NotifyCandidate, "issue">): string {
  return candidate.issue > 0 ? `#/mis-tareas/${candidate.issue}` : "#/mis-tareas";
}
