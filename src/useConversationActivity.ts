import { movedSince, type PollMark } from "./domain/attention";
import { noticeLang } from "./domain/noticeText";
import { getUiLanguage } from "./i18n/language";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DcsIssue } from "@ip-lms/dcs-client";
import type { GtSession } from "./dcs/auth";
import { pollActivity } from "./dcs/activityPoll";
import {
  countAttention,
  cursorStorageKey,
  emptyCursor,
  loadCursor,
  markSeen as markSeenDoc,
  markThreadRead,
  mergeCursors,
  parseCursor,
  saveCursor,
  seedSeenIfEmpty,
  type CommentSource,
  type ReadCursorDoc,
} from "./domain/readCursor";
import { attentionCandidates, notifiedStorageKey, shouldNotify } from "./domain/browserNotify";
import {
  loadNotified,
  notificationPermission,
  saveNotified,
  showAttentionNotification,
} from "./browserNotifications";

/** Plan §12.18: 60 s with the tab visible. Backoff on errors. */
const POLL_MS = 60_000;
/** Hidden tab, only with browser notifications granted; one hidden tab polls per window. */
const HIDDEN_POLL_MS = 120_000;
/** Returning to the tab polls at once, but never twice within this gap. */
const MIN_GAP_MS = 20_000;
const BACKOFF_MS = [120_000, 300_000];

function canPollNow(): boolean {
  return document.visibilityState === "visible" || notificationPermission() === "granted";
}

function readStamp(key: string): number {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

function writeStamp(key: string, at: number): void {
  try {
    localStorage.setItem(key, String(at));
  } catch {
    /* best-effort */
  }
}

export type ConversationActivity = {
  cursor: ReadCursorDoc;
  /** Subtareas that count for the badge (assigned + step roles). */
  issues: number[];
  /** Closed subtareas with a verse conflict to decide, from the last poll (null: not known yet). */
  decisionIssues: DcsIssue[] | null;
  unreadCount: number;
  /** Last poll failed; lo ya cargado sigue visible. */
  offline: boolean;
  /**
   * Goes up each time a poll finds that a subtarea of mine moved on Door43 (a reviewer approved, a step was closed,
   * somebody wrote): the list on the screen is read again. It read «Te avisaremos cuando te toque» for minutes after
   * it was the person's turn, until they left the screen and came back.
   */
  changes: number;
  refresh: () => void;
  /** Mis tareas reports its "Mías" rows so step-role subtareas count too. */
  setExtraIssues: (issues: DcsIssue[]) => void;
  /** Mis tareas reports free subtareas of my teams (worth a notice) and the ones held back. */
  setAudience: (audience: { free: DcsIssue[]; held: number[] }) => void;
  /** Free subtareas of my teams: they count and notify as «libre», not as assigned. */
  freeIssues: number[];
  /** Opening one thread with every source loaded: advances that thread only. */
  markRead: (issue: number, maxIds: Partial<Record<CommentSource, number>>) => void;
  /** Opening a thread or launching its mini-app: the subtarea is no longer "nueva". */
  markSeen: (issue: number) => void;
};

export function useConversationActivity(
  session: GtSession | null,
  pmOrg: string,
): ConversationActivity {
  const key = useMemo(
    () =>
      session?.token && session.username && pmOrg
        ? cursorStorageKey({ host: session.host, username: session.username, pmOrg })
        : null,
    [session?.token, session?.host, session?.username, pmOrg],
  );
  const [cursor, setCursor] = useState<ReadCursorDoc>(() => (key ? loadCursor(key) : emptyCursor()));
  const [issues, setIssues] = useState<number[]>([]);
  const [decisionIssues, setDecisionIssues] = useState<DcsIssue[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [changes, setChanges] = useState(0);
  const markRef = useRef<PollMark | null>(null);
  const extraRef = useRef<DcsIssue[]>([]);
  const freeRef = useRef<DcsIssue[]>([]);
  const heldRef = useRef<Set<number>>(new Set());
  const [audienceVersion, setAudienceVersion] = useState(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const runRef = useRef<() => void>(() => {});

  useEffect(() => {
    setCursor(key ? loadCursor(key) : emptyCursor());
    setIssues([]);
    setDecisionIssues(null);
    setOffline(false);
    markRef.current = null;
    extraRef.current = [];
    freeRef.current = [];
    heldRef.current = new Set();
  }, [key]);

  // Other tabs write the same key: pick up their reads and polls.
  useEffect(() => {
    if (!key) return;
    function onStorage(event: StorageEvent) {
      if (event.key !== key) return;
      setCursor((prev) => mergeCursors(prev, parseCursor(event.newValue)));
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    let timer: number | undefined;
    let running = false;
    let failures = 0;
    let dueAt = 0;
    let lastRunAt = 0;

    const stampKey = `${key}:sondeo`;

    function schedule(ms: number) {
      window.clearTimeout(timer);
      dueAt = Date.now() + ms;
      if (document.visibilityState === "visible") {
        timer = window.setTimeout(() => void run(), ms);
      } else if (canPollNow()) {
        timer = window.setTimeout(() => void run(), Math.max(ms, HIDDEN_POLL_MS));
      }
    }

    async function run() {
      const current = sessionRef.current;
      if (cancelled || running || !current) return;
      if (!canPollNow()) return;
      const hidden = document.visibilityState !== "visible";
      // Another tab (visible or hidden) polled recently: its cursor reaches us via `storage`.
      if (hidden && Date.now() - readStamp(stampKey) < HIDDEN_POLL_MS - 5_000) {
        schedule(HIDDEN_POLL_MS);
        return;
      }
      running = true;
      lastRunAt = Date.now();
      writeStamp(stampKey, lastRunAt);
      try {
        const stored = loadCursor(key!);
        const result = await pollActivity({
          session: current,
          pmOrg,
          doc: stored,
          extraIssues: [...extraRef.current, ...freeRef.current],
        });
        if (cancelled) return;
        const merged = seedSeenIfEmpty(mergeCursors(loadCursor(key!), result.doc), result.issues);
        saveCursor(key!, merged);
        setCursor(merged);
        setIssues(result.issues);
        if (result.decisions) setDecisionIssues(result.decisions);
        notifyNew(merged, result);
        if (movedSince(markRef.current, result.mark)) setChanges((n) => n + 1);
        markRef.current = { ...result.mark, newest: Math.max(markRef.current?.newest ?? 0, result.mark.newest) };
        setOffline(false);
        failures = 0;
        schedule(POLL_MS);
      } catch {
        if (cancelled) return;
        setOffline(true);
        const delay = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)];
        failures += 1;
        schedule(delay);
      } finally {
        running = false;
      }
    }

    function notifyNew(doc: ReadCursorDoc, result: Awaited<ReturnType<typeof pollActivity>>) {
      const notifiedKey = notifiedStorageKey(key!);
      const { show, notified } = shouldNotify({
        candidates: attentionCandidates({
          doc,
          issues: result.issues.filter((n) => !heldRef.current.has(n)),
          freeIssues: freeRef.current.map((issue) => issue.number),
          decisionIssues: (result.decisions ?? []).map((issue) => issue.number),
          titles: result.titles,
          me: sessionRef.current?.username ?? "",
          ownCommentIds: result.ownCommentIds,
          lang: noticeLang(getUiLanguage()),
        }),
        notified: loadNotified(notifiedKey),
        visibility: document.visibilityState,
        permission: notificationPermission(),
      });
      saveNotified(notifiedKey, notified);
      for (const candidate of show) showAttentionNotification(candidate);
    }

    function onVisibility() {
      if (document.visibilityState !== "visible") {
        window.clearTimeout(timer);
        if (canPollNow()) timer = window.setTimeout(() => void run(), Math.max(0, dueAt - Date.now(), HIDDEN_POLL_MS));
        return;
      }
      // Back after a while: poll now (after an error, keep the backoff).
      const wait = failures
        ? Math.max(0, dueAt - Date.now())
        : Math.max(0, lastRunAt + MIN_GAP_MS - Date.now());
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void run(), wait);
    }

    runRef.current = () => {
      window.clearTimeout(timer);
      void run();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void run();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      runRef.current = () => {};
    };
  }, [key, pmOrg]);

  const refresh = useCallback(() => runRef.current(), []);
  const setExtraIssues = useCallback((next: DcsIssue[]) => {
    extraRef.current = next;
  }, []);
  const setAudience = useCallback((next: { free: DcsIssue[]; held: number[] }) => {
    freeRef.current = next.free;
    heldRef.current = new Set(next.held);
    setAudienceVersion((v) => v + 1);
  }, []);

  const markRead = useCallback(
    (issue: number, maxIds: Partial<Record<CommentSource, number>>) => {
      if (!key || issue < 1) return;
      const next = markThreadRead(loadCursor(key), issue, maxIds);
      saveCursor(key, next);
      setCursor((prev) => mergeCursors(prev, next));
    },
    [key],
  );

  const markSeen = useCallback(
    (issue: number) => {
      if (!key || issue < 1) return;
      const stored = loadCursor(key);
      const next = markSeenDoc(stored, issue);
      if (next === stored) return;
      saveCursor(key, next);
      setCursor((prev) => mergeCursors(prev, next));
    },
    [key],
  );

  // Held subtareas (waiting, or above my level) never count: the notice comes when the hold lifts.
  const visibleIssues = useMemo(
    () => issues.filter((n) => !heldRef.current.has(n)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [issues, audienceVersion],
  );
  const unreadCount = useMemo(
    () =>
      key ? countAttention(cursor, visibleIssues, (decisionIssues ?? []).map((issue) => issue.number)) : 0,
    [key, cursor, visibleIssues, decisionIssues],
  );
  const freeIssues = useMemo(
    () => freeRef.current.map((issue) => issue.number),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [audienceVersion],
  );

  return {
    cursor,
    issues,
    decisionIssues,
    unreadCount,
    offline,
    changes,
    refresh,
    setExtraIssues,
    setAudience,
    freeIssues,
    markRead,
    markSeen,
  };
}
