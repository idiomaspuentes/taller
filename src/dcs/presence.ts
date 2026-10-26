import type { GtSession } from "./auth";
import { applyServerMessage, livePeers, PRESENCE_BEAT_MS, type Peer, type PresenceFocus } from "../domain/presence";

/**
 * The connection to the relay server that says who is in a subtask (see `usfm-relay-server`): joined with the
 * person's Door43 session, saying again where they are every half minute, and back after a cut, waiting longer each
 * time. Refused (no access, an expired session), it stays off: Taller works the same without it.
 */

/** What one person tells the others: they answered something, so the others read the answers again. */
export type PresenceEvent = { type: "taller:answered"; item: string };
export type PresenceConnection = { setFocus(focus: PresenceFocus | null): void; announce(event: PresenceEvent): void; close(): void };

/** What is used of a WebSocket, so that a test can stand in for it. */
export type SocketLike = {
  send(data: string): void;
  close(): void;
  onopen: null | (() => void);
  onmessage: null | ((ev: { data: unknown }) => void);
  onclose: null | (() => void);
};
export type PresenceTimers = { after(ms: number, fn: () => void): unknown; every(ms: number, fn: () => void): unknown; clear(id: unknown): void };

const realTimers: PresenceTimers = {
  after: (ms, fn) => setTimeout(fn, ms),
  every: (ms, fn) => setInterval(fn, ms),
  clear: (id) => {
    clearTimeout(id as ReturnType<typeof setTimeout>);
    clearInterval(id as ReturnType<typeof setInterval>);
  },
};

const BACKOFF_FIRST_MS = 1000;
const BACKOFF_MOST_MS = 30_000;

export function connectPresence(p: {
  url: string;
  room: string;
  session: GtSession;
  onPeers(peers: Peer[]): void;
  onEvent(e: PresenceEvent & { by: string }): void;
  socket?: (url: string) => SocketLike;
  now?: () => number;
  timers?: PresenceTimers;
}): PresenceConnection {
  const now = p.now ?? (() => Date.now());
  const timers = p.timers ?? realTimers;
  const open = p.socket ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
  const me = p.session.username.trim().toLowerCase();
  const address = `${p.url.replace(/\/+$/, "")}/rooms/${encodeURIComponent(p.room)}`;

  let ws: SocketLike | null = null;
  let connected = false;
  let stopped = false;
  let wait = BACKOFF_FIRST_MS;
  let beat: unknown = null;
  let retry: unknown = null;
  let focus: PresenceFocus | null = null;
  let peers = new Map<string, Peer>();

  const presence = () => ({ userId: me, displayName: me, color: "", ...(focus ? { focus } : {}), lastSeen: now() });
  const send = (data: unknown) => {
    if (ws && connected) ws.send(JSON.stringify(data));
  };
  const tell = () => p.onPeers(livePeers(peers, now(), me));

  const connect = () => {
    if (stopped) return;
    const socket = open(address);
    ws = socket;
    socket.onopen = () => {
      connected = true;
      wait = BACKOFF_FIRST_MS;
      socket.send(JSON.stringify({ type: "join", roomId: p.room, userId: me, presence: presence(), auth: { token: p.session.token } }));
      beat = timers.every(PRESENCE_BEAT_MS, () => {
        send({ type: "presence", presence: presence() });
        // Whoever stopped giving signs is let go even when nothing else comes.
        tell();
      });
    };
    socket.onmessage = (ev) => {
      let msg: { type?: string; message?: { type?: string; senderId?: string; payload?: unknown } };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === "denied") {
        stopped = true;
        return;
      }
      if (msg.type === "relay") {
        const payload = msg.message?.payload as Partial<PresenceEvent> | undefined;
        if (msg.message?.type === "taller:answered" && typeof payload?.item === "string") p.onEvent({ type: "taller:answered", item: payload.item, by: String(msg.message.senderId ?? "").toLowerCase() });
        return;
      }
      peers = applyServerMessage(peers, msg, now());
      tell();
    };
    socket.onclose = () => {
      connected = false;
      if (beat !== null) timers.clear(beat);
      beat = null;
      if (ws === socket) ws = null;
      peers = new Map();
      tell();
      if (stopped) return;
      retry = timers.after(wait, connect);
      wait = Math.min(wait * 2, BACKOFF_MOST_MS);
    };
  };
  connect();

  return {
    setFocus(next) {
      focus = next;
      send({ type: "presence", presence: presence() });
    },
    announce(event) {
      send({ type: "relay", message: { type: event.type, senderId: me, payload: event } });
    },
    close() {
      stopped = true;
      if (retry !== null) timers.clear(retry);
      if (beat !== null) timers.clear(beat);
      ws?.close();
    },
  };
}
