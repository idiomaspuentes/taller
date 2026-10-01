import { useCallback, useEffect, useRef, useState } from "react";
import type { GtSession } from "./dcs/auth";
import { listMentions, markMentionRead, type MentionRow } from "./dcs/mentions";
import { PM_REPO_NAME } from "./domain/types";

const POLL_MS = 60_000;

/**
 * Unread Door43 notifications of the project repository: for the Avisos list and its badge.
 * Polled while the tab is visible, and again whenever it becomes visible.
 */
export function useMentions(session: GtSession | null, pmOrg: string) {
  const [rows, setRows] = useState<MentionRow[]>([]);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const token = session?.token ?? "";

  const refresh = useCallback(async () => {
    const s = sessionRef.current;
    if (!s?.token || !pmOrg) return setRows([]);
    try {
      setRows(await listMentions(s, pmOrg, PM_REPO_NAME));
    } catch {
      /* offline: keep what is shown */
    }
  }, [pmOrg]);

  useEffect(() => {
    if (!token || !pmOrg) {
      setRows([]);
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

  const markRead = useCallback((id: number) => {
    setRows((current) => current.filter((r) => r.id !== id));
    const s = sessionRef.current;
    if (s) void markMentionRead(s, id);
  }, []);

  return { rows, refresh, markRead };
}
