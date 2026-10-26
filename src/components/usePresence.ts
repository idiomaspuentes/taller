import { useCallback, useEffect, useRef, useState } from "react";
import type { GtSession } from "../dcs/auth";
import { connectPresence, type PresenceConnection, type PresenceEvent } from "../dcs/presence";
import type { Peer, PresenceFocus } from "../domain/presence";

/** The relay server's address; empty, nobody is shown and nothing is sent (see `push-worker` for the same idea). */
const PRESENCE_URL = String(import.meta.env.VITE_PRESENCE_URL ?? "").trim();

/**
 * Who else is in this room right now, and on which help; where this person is, said to them. Off without a server
 * or a room: `peers` stays empty and `announce` does nothing.
 */
export function usePresence(p: {
  room: string | null;
  session: GtSession | null;
  focus: PresenceFocus | null;
  onEvent?: (event: PresenceEvent & { by: string }) => void;
  /** Joined again after a cut: what the others said meanwhile was not heard. */
  onRejoin?: () => void;
}): { peers: Peer[]; announce(event: PresenceEvent): void } {
  const [peers, setPeers] = useState<Peer[]>([]);
  const connection = useRef<PresenceConnection | null>(null);
  const onEvent = useRef(p.onEvent);
  onEvent.current = p.onEvent;
  const onRejoin = useRef(p.onRejoin);
  onRejoin.current = p.onRejoin;
  const focus = useRef(p.focus);
  focus.current = p.focus;

  const token = p.session?.token;
  useEffect(() => {
    if (!PRESENCE_URL || !p.room || !p.session?.token) return;
    const conn = connectPresence({
      url: PRESENCE_URL,
      room: p.room,
      session: p.session,
      onPeers: setPeers,
      onEvent: (event) => onEvent.current?.(event),
      onRejoin: () => onRejoin.current?.(),
    });
    connection.current = conn;
    if (focus.current) conn.setFocus(focus.current);
    // Back to the page (a phone unlocked): a connection that died unseen is made again, and what was said is read.
    const back = () => {
      if (document.visibilityState === "visible") conn.refresh();
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      conn.close();
      connection.current = null;
      setPeers([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.room, token]);

  const focusKey = p.focus ? `${p.focus.item}|${p.focus.doing}` : "";
  useEffect(() => {
    connection.current?.setFocus(focus.current);
  }, [focusKey]);

  const announce = useCallback((event: PresenceEvent) => connection.current?.announce(event), []);
  return { peers, announce };
}
