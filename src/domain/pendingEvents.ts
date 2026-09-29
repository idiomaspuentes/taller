/**
 * Own actions shown at once, before DCS reflects them (plan §3.1 source 5):
 * replies, Guardar, Cerrar. Each local item carries a `reconcileKey`
 * (thread item key of the real comment, or the commit SHA); when the real
 * item arrives it replaces the local one. TTL 10 min.
 *
 * `localStorage`, not `sessionStorage`: mini-apps open in another tab, and
 * a save there must show in the thread tab too.
 */
import { localClosedItem, localSavedItem, type ThreadItem } from "./conversation";

export const PENDING_TTL_MS = 10 * 60_000;

export type PendingDoc = { v: 1; items: Record<string, ThreadItem[]> };

function hostOnly(host: string): string {
  return host.replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
}

export function pendingStorageKey(params: { host: string; username: string; pmOrg: string }): string {
  return `tas-chat-pending:${hostOnly(params.host)}:${params.username.toLowerCase()}:${params.pmOrg.toLowerCase()}`;
}

export function parsePending(raw: string | null | undefined): PendingDoc {
  if (!raw) return { v: 1, items: {} };
  try {
    const parsed = JSON.parse(raw) as Partial<PendingDoc>;
    if (parsed?.v !== 1 || !parsed.items || typeof parsed.items !== "object") return { v: 1, items: {} };
    return { v: 1, items: parsed.items as Record<string, ThreadItem[]> };
  } catch {
    return { v: 1, items: {} };
  }
}

function fresh(item: ThreadItem, now: number): boolean {
  const t = Date.parse(item.createdAt);
  // A failed send stays until the user retries or discards it.
  return item.pending === "error" || (Number.isFinite(t) && now - t < PENDING_TTL_MS);
}

export function pruneExpired(doc: PendingDoc, now: number = Date.now()): PendingDoc {
  const items: Record<string, ThreadItem[]> = {};
  for (const [issue, rows] of Object.entries(doc.items)) {
    const kept = rows.filter((row) => fresh(row, now));
    if (kept.length) items[issue] = kept;
  }
  return { v: 1, items };
}

export function pushLocal(doc: PendingDoc, issue: number, item: ThreadItem): PendingDoc {
  const key = String(issue);
  const rows = (doc.items[key] ?? []).filter((row) => row.key !== item.key);
  return { v: 1, items: { ...doc.items, [key]: [...rows, { ...item, source: "local" }] } };
}

export function updateLocal(
  doc: PendingDoc,
  issue: number,
  itemKey: string,
  patch: Partial<ThreadItem>,
): PendingDoc {
  const key = String(issue);
  const rows = doc.items[key];
  if (!rows) return doc;
  return {
    v: 1,
    items: { ...doc.items, [key]: rows.map((row) => (row.key === itemKey ? { ...row, ...patch } : row)) },
  };
}

export function removeLocal(doc: PendingDoc, issue: number, itemKey: string): PendingDoc {
  const key = String(issue);
  const rows = (doc.items[key] ?? []).filter((row) => row.key !== itemKey);
  const items = { ...doc.items };
  if (rows.length) items[key] = rows;
  else delete items[key];
  return { v: 1, items };
}

export function listLocal(doc: PendingDoc, issue: number, now: number = Date.now()): ThreadItem[] {
  return (doc.items[String(issue)] ?? []).filter((row) => fresh(row, now));
}

/** Local items whose real counterpart is not in `real` yet. */
export function reconcile(local: ThreadItem[], real: ThreadItem[]): ThreadItem[] {
  const seen = new Set<string>();
  for (const item of real) {
    seen.add(item.key);
    if (item.reconcileKey) seen.add(item.reconcileKey);
  }
  return local.filter((item) => !item.reconcileKey || !seen.has(item.reconcileKey));
}

export function loadPending(key: string): PendingDoc {
  try {
    return pruneExpired(parsePending(localStorage.getItem(key)));
  } catch {
    return { v: 1, items: {} };
  }
}

export function savePending(key: string, doc: PendingDoc): void {
  try {
    if (Object.keys(doc.items).length) localStorage.setItem(key, JSON.stringify(doc));
    else localStorage.removeItem(key);
  } catch {
    /* best-effort */
  }
}

/** Record an own action from any screen (mini-app, Mis tareas). */
export function recordOwnAction(
  params: { host: string; username: string; pmOrg: string },
  issue: number,
  item: Omit<ThreadItem, "source">,
): void {
  if (!params.pmOrg || issue < 1) return;
  const key = pendingStorageKey(params);
  savePending(key, pushLocal(loadPending(key), issue, { ...item, source: "local" }));
}

type OwnActionParams = { host: string; username: string; pmOrg?: string };

export function recordOwnSave(
  params: OwnActionParams,
  issue: number | undefined,
  message: string,
  commitSha: string | undefined,
): void {
  if (!params.pmOrg || !issue) return;
  const item = localSavedItem(message, issue, params.username, commitSha);
  if (item) recordOwnAction({ ...params, pmOrg: params.pmOrg }, issue, item);
}

export function recordOwnClose(params: OwnActionParams, issue: number): void {
  if (!params.pmOrg) return;
  recordOwnAction({ ...params, pmOrg: params.pmOrg }, issue, localClosedItem(issue, params.username));
}
