import { useCallback, useEffect, useRef, useState } from "react";
import type { GtSession } from "./dcs/auth";
import { listMentions, loadSeen, markMentionRead, markSeen, saveSeen, seenKey, withoutSeen, type MentionRow } from "./dcs/mentions";
import { PM_REPO_NAME } from "./domain/types";

const POLL_MS = 60_000;

/**
 * Unread Door43 notifications of the project repository: for the Avisos list and its badge.
 * Polled while the tab is visible, and again whenever it becomes visible.
 */
export function useMentions(session: GtSession | null, pmOrg: string) {
  const [all, setAll] = useState<MentionRow[]>([]);
  const [seen, setSeen] = useState(() => (session ? loadSeen(seenKey(session.host, session.username)) : {}));
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const token = session?.token ?? "";
  const key = session ? seenKey(session.host, session.username) : "";
  useEffect(() => setSeen(key ? loadSeen(key) : {}), [key]);

  const refresh = useCallback(async () => {
    const s = sessionRef.current;
    if (!s?.token || !pmOrg) return setAll([]);
    try {
      setAll(await listMentions(s, pmOrg, PM_REPO_NAME));
    } catch {
      /* offline: keep what is shown */
    }
  }, [pmOrg]);

  useEffect(() => {
    if (!token || !pmOrg) {
      setAll([]);
      return;
    }
    void refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token, pmOrg, refresh]);

  const markRead = useCallback(
    (id: number) => {
      const row = all.find((r) => r.id === id);
      if (row && key) {
        const next = markSeen(loadSeen(key), row);
        saveSeen(key, next);
        setSeen(next);
      }
      // Also tell Door43; it only takes effect if the token may write notifications.
      const s = sessionRef.current;
      if (s) void markMentionRead(s, id);
    },
    [all, key],
  );

  return { rows: withoutSeen(all, seen), refresh, markRead };
}
