/**
 * Generic typed event inside a DCS comment (plan §6.3):
 *
 *   {summary in plain text, with @mentions when needed}
 *
 *   <!-- tas:chat-event BASE64URL({ schema, type, emitter, issue, summary, … }) -->
 *
 * `type` is open: a mini-app defines it. TAS only validates the shape, so an
 * unknown type still renders as a system line with its `summary`.
 */
import { decodeBase64Url, encodeBase64Url } from "./markerCodec";

export const CHAT_EVENT_SCHEMA = "tas-chat-event-1";

export type ChatDecisionState = "pendiente" | "resuelta";

export type ChatDecision = {
  id: string;
  options: Array<{ id: string; label: string }>;
  state: ChatDecisionState;
  chosen?: string;
  by?: string;
};

export type ChatEvent = {
  schema: typeof CHAT_EVENT_SCHEMA;
  type: string;
  emitter: string;
  issue: number;
  summary: string;
  mentions?: string[];
  decision?: ChatDecision;
  data?: Record<string, unknown>;
};

const MARKER_RE = /<!-- tas:chat-event ([A-Za-z0-9_-]+) -->/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseDecision(raw: unknown): ChatDecision | undefined {
  if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id) return undefined;
  const options = Array.isArray(raw.options)
    ? raw.options
        .filter(isRecord)
        .filter((o) => typeof o.id === "string" && typeof o.label === "string")
        .map((o) => ({ id: String(o.id), label: String(o.label) }))
    : [];
  return {
    id: raw.id,
    options,
    state: raw.state === "resuelta" ? "resuelta" : "pendiente",
    ...(typeof raw.chosen === "string" ? { chosen: raw.chosen } : {}),
    ...(typeof raw.by === "string" ? { by: raw.by } : {}),
  };
}

/** Last `tas:chat-event` marker in a body, or null (bad JSON / wrong shape). */
export function parseChatEvent(body: string | null | undefined): ChatEvent | null {
  const matches = [...(body ?? "").matchAll(MARKER_RE)];
  const last = matches[matches.length - 1];
  if (!last) return null;
  try {
    const parsed: unknown = JSON.parse(decodeBase64Url(last[1]!));
    if (!isRecord(parsed) || parsed.schema !== CHAT_EVENT_SCHEMA) return null;
    const type = typeof parsed.type === "string" ? parsed.type.trim() : "";
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    if (!type || !summary) return null;
    const decision = parseDecision(parsed.decision);
    return {
      schema: CHAT_EVENT_SCHEMA,
      type,
      emitter: typeof parsed.emitter === "string" ? parsed.emitter : "tas",
      issue: Number(parsed.issue) || 0,
      summary,
      ...(Array.isArray(parsed.mentions)
        ? { mentions: parsed.mentions.filter((m): m is string => typeof m === "string") }
        : {}),
      ...(decision ? { decision } : {}),
      ...(isRecord(parsed.data) ? { data: parsed.data } : {}),
    };
  } catch {
    return null;
  }
}

/** A comment that carries a decision card (e.g. `verse-conflict`). */
export function isDecisionComment(body: string | null | undefined): boolean {
  return Boolean(parseChatEvent(body)?.decision);
}

/**
 * Comment body: the visible text (defaults to `summary`) then the marker.
 * `visible` lets a type add quoted texts under the summary for Door43 readers.
 */
export function formatChatEvent(
  event: Omit<ChatEvent, "schema">,
  opts: { visible?: string } = {},
): string {
  const summary = event.summary.trim();
  if (!summary) throw new Error("Un evento de conversación necesita summary.");
  if (!event.type.trim()) throw new Error("Un evento de conversación necesita type.");
  const payload: ChatEvent = { schema: CHAT_EVENT_SCHEMA, ...event, summary };
  const visible = (opts.visible ?? summary).trim();
  return `${visible}\n\n<!-- tas:chat-event ${encodeBase64Url(JSON.stringify(payload))} -->`;
}
