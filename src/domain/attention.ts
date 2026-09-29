import type { LatestComment, ReadCursorDoc } from "./readCursor";
import { latestActivity, hasDecisionUnread, hasUnread, isNewTask } from "./readCursor";

const PREVIEW_MAX = 140;

function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "").replace(/<!--[\s\S]*$/, "");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Plain-language line for known TAS system comments; null for anything else. */
function systemSummary(text: string): string | null {
  if (/^#{0,6}\s*Conflictos de versículo al cerrar/i.test(text)) {
    return "Conflicto de versículos al cerrar";
  }
  const merged = /^Versículos\s+(.+?)\s+de\s+#\d+\s+(fusionados|ya estaban)/i.exec(text);
  if (merged) {
    return merged[2].toLowerCase() === "fusionados"
      ? `Versículos ${merged[1]} guardados en el borrador grupal`
      : `Versículos ${merged[1]} ya estaban en el borrador grupal`;
  }
  const approved = /^Aprobado en TAS:\s*«([^»]+)»/.exec(text);
  if (approved) return `Aprobado: ${approved[1]}`;
  return null;
}

/**
 * One plain line for a Mis tareas row. Never returns HTML comments, base64
 * markers, SHAs, branch names or `archivo/` refs.
 */
export function rowPreview(body: string | undefined): string {
  const stripped = stripHtmlComments(body ?? "").trim();
  if (!stripped) return "";
  const system = systemSummary(stripped);
  if (system) return system;
  const text = stripped
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/^\s{0,3}(?:>+|#{1,6})\s?/gm, "")
    .replace(/\*\*|__/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/«[^»]*\/[^»]*»/g, " ")
    .replace(/\b(?:refs\/heads\/|archivo\/|tas\/|w\/)[^\s«»"'()]+/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,64}\b/gi, " ")
    .replace(/[A-Za-z0-9+/_=-]{32,}/g, " ")
    .replace(/\(\s*\)|«\s*»/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return truncate(text, PREVIEW_MAX);
}

const DAY_MS = 86_400_000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "ahora", "hace 5 min", "hace 3 h", "ayer", "12 sept" (+ year if not this year). */
export function formatRelativeEs(date: Date | string, now: Date = new Date()): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const t = d.getTime();
  if (!Number.isFinite(t)) return "";
  const diff = now.getTime() - t;
  if (diff < 45_000) return "ahora";
  const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto", style: "short" });
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return rtf.format(-Math.max(1, minutes), "minute");
  const dayDelta = Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS);
  if (dayDelta === 0) return rtf.format(-Math.round(diff / 3_600_000), "hour");
  if (dayDelta === 1) return "ayer";
  return d.toLocaleDateString("es", {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

export type RowActivity = {
  unread: boolean;
  /** Assigned after this browser's first load and not opened yet. */
  isNew: boolean;
  /** Unread or new (closed subtareas with a decision are added by Mis tareas). */
  needsAttention: boolean;
  latest: LatestComment | null;
};

/** `decision`: the row is listed for a pending decision (DECIDIR). */
export function rowActivity(
  doc: ReadCursorDoc,
  issueNumber: number,
  opts: { decision?: boolean } = {},
): RowActivity {
  const unread =
    hasUnread(doc, issueNumber) || Boolean(opts.decision && hasDecisionUnread(doc, issueNumber));
  const isNew = isNewTask(doc, issueNumber);
  return { unread, isNew, needsAttention: unread || isNew, latest: latestActivity(doc, issueNumber) };
}

/** "Bob: ¿seguro de 'siervo'?" — author prefix only when there is text. */
export function previewLine(latest: LatestComment | null): string {
  if (!latest) return "";
  const text = latest.preview || "Mensaje nuevo";
  return latest.author ? `${latest.author}: ${text}` : text;
}

function activityTime(a: RowActivity): number {
  const t = a.latest ? Date.parse(a.latest.at) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** Attention first, then most recent activity first; stable otherwise. */
export function attentionRank(a: RowActivity, b: RowActivity): number {
  if (a.needsAttention !== b.needsAttention) return a.needsAttention ? -1 : 1;
  return activityTime(b) - activityTime(a);
}
