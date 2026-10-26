/**
 * Who is in a subtask right now, and on which help (26 October), as the relay server tells it. Nothing here is kept:
 * a person who stops giving signs is gone after a while, and nobody holds a help by being on it.
 */

export type PresenceFocus = { item: string; doing: "viewing" | "writing" };
export type Peer = { login: string; name: string; focus?: PresenceFocus; lastSeen: number };

/** A person with no sign for this long is taken as gone (a phone that lost its signal does not say goodbye). */
export const PEER_STALE_MS = 75_000;
/** How often each person says again where they are. */
export const PRESENCE_BEAT_MS = 30_000;

/** The room of a subtask: the Door43 host, the repository its answers are kept in, and the key of its answers. */
export function presenceRoom(p: { host: string; owner: string; repo: string; key: string }): string {
  const host = p.host.replace(/^[a-z]+:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  return `${host}|${p.owner}/${p.repo}|${p.key}`;
}

const isFocus = (value: unknown): value is PresenceFocus =>
  Boolean(value) && typeof (value as PresenceFocus).item === "string" && ((value as PresenceFocus).doing === "viewing" || (value as PresenceFocus).doing === "writing");

/**
 * The peers after a message of the server. When a person was last seen is the time it came here, not the server's,
 * so that a clock that runs ahead or behind does not keep anybody or take them away.
 */
export function applyServerMessage(peers: ReadonlyMap<string, Peer>, msg: unknown, now: number): Map<string, Peer> {
  const next = new Map(peers);
  if (!msg || typeof msg !== "object") return next;
  const m = msg as { type?: string; peer?: { userId?: string; displayName?: string; focus?: unknown }; userId?: string };
  if (m.type === "peer-join" && typeof m.peer?.userId === "string") {
    const login = m.peer.userId.trim().toLowerCase();
    const peer: Peer = { login, name: (m.peer.displayName ?? "").trim() || login, lastSeen: now };
    if (isFocus(m.peer.focus)) peer.focus = { item: m.peer.focus.item, doing: m.peer.focus.doing };
    next.set(login, peer);
  } else if (m.type === "peer-leave" && typeof m.userId === "string") {
    next.delete(m.userId.trim().toLowerCase());
  }
  return next;
}

export function livePeers(peers: ReadonlyMap<string, Peer>, now: number, me: string): Peer[] {
  const self = me.trim().toLowerCase();
  return [...peers.values()].filter((peer) => peer.login !== self && now - peer.lastSeen <= PEER_STALE_MS).sort((a, b) => a.name.localeCompare(b.name));
}

export function peersOn(peers: Peer[], item: string): Peer[] {
  return peers.filter((peer) => peer.focus?.item === item);
}
