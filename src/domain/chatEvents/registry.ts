/**
 * Registry of typed conversation events (plan §6.4). A mini-app registers
 * its types; the thread view only asks the registry. Unknown types render
 * as a system line with their `summary` and never break the thread.
 * Pure: no React, no DCS. Writing code lives with the mini-app.
 */
import type { ChatEvent } from "../chatEvent";
import type { ThreadItem } from "../conversation";

export type ChatEventRender = "system" | "decision";

/** One text shown in a decision card (e.g. the two versions side by side). */
export type DecisionPanel = {
  label: string;
  text: string;
  tag?: string;
  /** Something other than text: the card draws it with a renderer registered for its `kind`. */
  custom?: { kind: string; data: unknown };
};

export type DecisionViewer = {
  username: string;
  canManage: boolean;
  /** Assignees of the thread's subtarea. */
  assignees: string[];
};

export type DecisionOption = {
  id: string;
  label: string;
  primary?: boolean;
  /** `null` = enabled; otherwise the reason, shown as text inside the card. */
  blockReason: string | null;
  /** Inline confirmation text before a write. */
  confirm?: string;
  /** Shown in the card while `run` works (e.g. "Guardando en el tronco…"). */
  busyLabel?: string;
  /** The block is fixed in the editor: the reason offers to open it on this range. */
  openEditor?: { chapter: number; from: number; to: number };
};

export type DecisionContext<P = unknown> = {
  viewer: DecisionViewer;
  /** Result of `prepare` (e.g. the current trunk verse); undefined while loading. */
  prepared?: P;
  prepareError?: string;
};

/** Opaque to the registry; the app passes session and org through. */
export type ChatEventEnv = Record<string, unknown>;

export type ChatEventType<P = unknown> = {
  type: string;
  render: ChatEventRender;
  /** False when the event's data does not match the type: shown as a system line. */
  valid?(event: ChatEvent): boolean;
  title(event: ChatEvent): string;
  panels?(event: ChatEvent): DecisionPanel[];
  /** Decisions with the same group: only the newest one keeps its buttons. */
  group?(event: ChatEvent): string | null;
  /** Decision id this event resolves (e.g. a `verse-choice`), or null. */
  resolves?(event: ChatEvent): string | null;
  prepare?(event: ChatEvent, env: ChatEventEnv): Promise<P>;
  options?(event: ChatEvent, ctx: DecisionContext<P>): DecisionOption[];
  /**
   * After `resolution`: the event as it now stands (title, panels and
   * `options` / `prepare` / `run` read it) and the option ids still offered.
   */
  decided?(event: ChatEvent, resolution: ChatEvent): { event: ChatEvent; title: string; options: string[] } | null;
  /** Writes, then returns the resulting items of this thread to show right away. */
  run?(optionId: string, event: ChatEvent, env: ChatEventEnv): Promise<ThreadItem[]>;
};

export type ResolvedChatEvent = {
  render: ChatEventRender;
  title: string;
  panels: DecisionPanel[];
  known: boolean;
  definition?: ChatEventType<unknown>;
};

const registry = new Map<string, ChatEventType<unknown>>();

export function registerChatEventType<P>(definition: ChatEventType<P>): void {
  registry.set(definition.type, definition as ChatEventType<unknown>);
}

export function getChatEventType(type: string): ChatEventType<unknown> | undefined {
  return registry.get(type);
}

export function resolveChatEvent(event: ChatEvent): ResolvedChatEvent {
  const definition = registry.get(event.type);
  if (!definition || definition.valid?.(event) === false) {
    return { render: "system", title: event.summary, panels: [], known: false };
  }
  return {
    render: definition.render,
    title: definition.title(event) || event.summary,
    panels: definition.panels?.(event) ?? [],
    known: true,
    definition,
  };
}

/** Decision ids resolved by events already in the thread. */
export function resolvedDecisions(events: ChatEvent[]): Map<string, ChatEvent> {
  const out = new Map<string, ChatEvent>();
  for (const event of events) {
    const id = registry.get(event.type)?.resolves?.(event);
    if (id) out.set(id, event);
  }
  return out;
}

export type DecisionStatus = {
  decisionId: string;
  /** Event that resolved it (e.g. a `verse-choice` in the thread). */
  resolution?: ChatEvent;
  /** A newer decision of the same group exists: history only, no buttons. */
  superseded: boolean;
};

/** Status of every decision card, by item key; `items` in timeline order. */
export function decisionStatuses(items: Array<{ key: string; event?: ChatEvent }>): Map<string, DecisionStatus> {
  const events = items.flatMap((i) => (i.event ? [i.event] : []));
  const resolved = resolvedDecisions(events);
  const cards = items.filter((i) => i.event?.decision && resolveChatEvent(i.event).render === "decision");
  const latest = new Map<string, string>();
  for (const item of cards) {
    const event = item.event!;
    const group = registry.get(event.type)?.group?.(event) ?? event.decision!.id;
    latest.set(group, item.key);
  }
  const out = new Map<string, DecisionStatus>();
  for (const item of cards) {
    const event = item.event!;
    const group = registry.get(event.type)?.group?.(event) ?? event.decision!.id;
    const resolution = resolved.get(event.decision!.id);
    out.set(item.key, {
      decisionId: event.decision!.id,
      ...(resolution ? { resolution } : {}),
      superseded: latest.get(group) !== item.key,
    });
  }
  return out;
}

/**
 * Keys of resolution events whose decision card is in the same thread: the
 * card already shows the outcome, so the thread hides the separate line.
 * Resolutions without a card here (e.g. the other person's thread) stay.
 */
export function resolutionsOnCards(items: Array<{ key: string; event?: ChatEvent }>): Set<string> {
  const cards = new Set(
    items.flatMap((i) =>
      i.event?.decision && resolveChatEvent(i.event).render === "decision" ? [i.event.decision.id] : [],
    ),
  );
  const out = new Set<string>();
  for (const item of items) {
    const id = item.event ? registry.get(item.event.type)?.resolves?.(item.event) : null;
    if (id && cards.has(id)) out.add(item.key);
  }
  return out;
}

/** Decisions still waiting in this thread (not resolved, not superseded). */
export function pendingDecisionIds(statuses: Map<string, DecisionStatus>): string[] {
  return [...new Set([...statuses.values()].filter((s) => !s.resolution && !s.superseded).map((s) => s.decisionId))];
}

// Render-only system types emitted by TAS itself (plan slice 3).
registerChatEventType({ type: "verses-merged", render: "system", title: (e) => e.summary });
registerChatEventType({ type: "step-approved", render: "system", title: (e) => e.summary });
registerChatEventType({
  type: "saved",
  render: "system",
  title: (e) => e.summary,
});
registerChatEventType({ type: "closed", render: "system", title: (e) => e.summary });
