import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, MoreHorizontal, SendHorizontal, TextQuote } from "lucide-react";
import type { DcsIssue } from "@ip-lms/dcs-client";
import type { GtSession } from "../dcs/auth";
import { loadConversationSubject, loadThreadSources, retryThreadSources } from "../dcs/thread";
import { postThreadReply } from "../dcs/conversationPost";
import {
  activeMention,
  canOpenConversation,
  commentToItem,
  groupSaves,
  initials,
  insertQuote,
  mentionCandidates,
  mergeTimeline,
  quoteVerse,
  sanitizeMentions,
  threadReadIds,
  type CiteTarget,
  type ThreadItem,
  type ThreadSourceState,
} from "../domain/conversation";
import type { ChatEvent } from "../domain/chatEvent";
import { loadCiteTargets } from "../domain/chatEvents/cites";
import {
  listLocal,
  loadPending,
  pendingStorageKey,
  pushLocal,
  removeLocal,
  savePending,
  updateLocal,
  type PendingDoc,
} from "../domain/pendingEvents";
import { conversationHeader, type ConversationHeader } from "../domain/conversationSubject";
import {
  decisionStatuses,
  pendingDecisionIds,
  resolutionsOnCards,
  resolveChatEvent,
  type ResolvedChatEvent,
} from "../domain/chatEvents/registry";
import { formatRelativeEs } from "../domain/attention";
import { issueProjectId } from "../domain/myTasks";
import { hasUnread, type CommentSource, type ReadCursorDoc } from "../domain/readCursor";
import {
  buildSolverLaunchContext,
  openSolverApp,
  resolveSolverLaunchUrl,
  solverLaunchBlockReason,
  type SolverLaunchContext,
} from "../domain/solverLaunch";
import { launchForRange } from "../domain/solverLab";
import {
  DEFAULT_SOLVERS_CATALOG,
  isScriptureSolver,
  scriptureSolverFor,
  solverActionLabel,
  type SolverApp,
  type SolversCatalog,
} from "../domain/solvers";
import type { AssignmentsDoc } from "../domain/types";
import { PM_REPO_NAME } from "../domain/types";
import { Button } from "@/components/ui/button";
import { opensAsTeamDecision } from "../domain/decisionAccess";
import { DecisionCard } from "./DecisionCard";
import { tNow, useT } from "../i18n/messages";
import { getUiLanguage, useUiLanguage } from "../i18n/language";
import { localizeThread } from "../domain/threadNames";
import { localizeName } from "../domain/templateNames";
import { explainError } from "../dcs/userError";

export type ConversationDemo = {
  issue: DcsIssue;
  sources: ThreadSourceState[];
  cites?: CiteTarget[];
  /** Per decision id: stands in for the registry `prepare` (no DCS read). */
  prepared?: Record<string, unknown>;
  /** Stands in for the registry `run` (no DCS write). */
  decide?: (optionId: string, item: ThreadItem) => Promise<ThreadItem[]>;
  /** Login shown as "you" when nobody is signed in. */
  viewer?: string;
  /** Replaces the default "Demostración local" line. */
  notice?: string;
  /** Extra controls under the header (e.g. reset a fictional task). */
  toolbar?: ReactNode;
  /** Mini-app for the header and the card's editor link; must not write to DCS (lab launch). */
  launch?: { app: SolverApp; ctx: SolverLaunchContext } | null;
};

type Props = {
  session: GtSession | null;
  pmOrg: string;
  lang: string;
  contentOrg: string;
  issueNumber: number;
  /** `effectiveCanManage`: gestor view opens any thread. */
  canManage: boolean;
  cursor: ReadCursorDoc;
  /** Local fixture instead of DCS (dev only). Never marks read. */
  demo?: ConversationDemo | null;
  /** Other "Mías" rows for the list panel on wide screens. */
  siblings: DcsIssue[];
  onMarkRead: (issue: number, maxIds: Partial<Record<CommentSource, number>>) => void;
  onMarkSeen: (issue: number) => void;
  onBack: () => void;
  onOpenThread: (issue: number) => void;
  onSignIn: () => void;
  announce: (msg: string) => void;
};

type LoadState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "missing" }
  | { status: "forbidden" }
  | { status: "error"; message: string };

const SOURCE_LABEL: Record<string, "cv.srcIssue" | "cv.srcPr" | "cv.srcCommit"> = {
  issue: "cv.srcIssue",
  pr: "cv.srcPr",
  commit: "cv.srcCommit",
};

function isNotFound(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "status" in err && (err as { status?: number }).status === 404);
}

function clock(iso: string, now: Date): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString(getUiLanguage(), { hour: "2-digit", minute: "2-digit" })
    : formatRelativeEs(d, now, getUiLanguage());
}

/** Time inside a bubble ("22:04"); the day lives in the day divider above. */
function timeOfDay(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString(getUiLanguage(), { hour: "2-digit", minute: "2-digit" }) : "";
}

function fullStamp(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString(getUiLanguage(), { dateStyle: "long", timeStyle: "short" }) : "";
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toDateString() : "";
}

function dayLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const days = Math.round(
    (new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000,
  );
  if (days === 0) return tNow("cv.today");
  if (days === 1) return tNow("cv.yesterday");
  if (days > 1 && days < 7) {
    const weekday = d.toLocaleDateString(getUiLanguage(), { weekday: "long" });
    return weekday.charAt(0).toUpperCase() + weekday.slice(1);
  }
  return d.toLocaleDateString(getUiLanguage(), {
    day: "numeric",
    month: "long",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

function isSystemLine(item: ThreadItem | undefined): boolean {
  return Boolean(item && item.kind !== "humano" && item.event && resolveChatEvent(item.event).render !== "decision");
}

function door43IssueUrl(session: GtSession | null, pmOrg: string, issue: number): string {
  const host = (session?.host || "https://git.door43.org").replace(/\/+$/, "");
  const base = /^https?:\/\//.test(host) ? host : `https://${host}`;
  return `${base}/${pmOrg}/${PM_REPO_NAME}/issues/${issue}`;
}

export function ConversationView(props: Props) {
  const t = useT();
  const { session, pmOrg, issueNumber, demo } = props;
  const threadTitle = t("cv.thread").replace("{n}", String(issueNumber));
  if (!demo && !session) {
    return (
      <ThreadShell onBack={props.onBack} title={threadTitle}>
        <div className="chat-state">
          <p className="chat-state__title">{t("cv.signInTitle")}</p>
          <Button type="button" onClick={props.onSignIn}>
            {t("cv.enter")}
          </Button>
        </div>
      </ThreadShell>
    );
  }
  if (!demo && !pmOrg) {
    return (
      <ThreadShell onBack={props.onBack} title={threadTitle}>
        <div className="chat-state">
          <p className="chat-state__title">{t("cv.pickOrgTitle")}</p>
          <p className="chat-state__body">
            {t("cv.pickOrgBody")}
          </p>
        </div>
      </ThreadShell>
    );
  }
  return <ConversationThread key={`${pmOrg}#${issueNumber}${demo ? ":demo" : ""}`} {...props} />;
}

function ThreadShell({
  onBack,
  title,
  children,
}: {
  onBack: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className="chat-main">
      <header className="chat-header">
        <div className="chat-header__row">
          <button type="button" className="chat-back" onClick={onBack} aria-label={t("cv.backToMy")}>
            <ArrowLeft aria-hidden className="size-4" />
            <span className="chat-back__label">{t("nav.myTasks")}</span>
          </button>
          <h1 className="chat-header__title">{title}</h1>
        </div>
      </header>
      {children}
    </div>
  );
}

function ConversationThread({
  session,
  pmOrg,
  lang,
  contentOrg,
  issueNumber,
  canManage,
  cursor,
  demo,
  siblings,
  onMarkRead,
  onMarkSeen,
  onBack,
  onOpenThread,
  announce,
}: Props) {
  const t = useT();
  const language = useUiLanguage();
  const loc = (text: string) => localizeThread(text, language);
  const username = session?.username || demo?.viewer || "";
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [issue, setIssue] = useState<DcsIssue | null>(demo?.issue ?? null);
  const [board, setBoard] = useState<AssignmentsDoc | null>(null);
  const [catalog, setCatalog] = useState<SolversCatalog>(DEFAULT_SOLVERS_CATALOG);
  const [header, setHeader] = useState<ConversationHeader | null>(null);
  const [sources, setSources] = useState<ThreadSourceState[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const readSnapshot = useRef<ReadCursorDoc | null>(null);
  const markedFor = useRef<string>("");
  const logRef = useRef<HTMLDivElement>(null);
  const [cites, setCites] = useState<CiteTarget[]>([]);

  const pendingKey =
    session && pmOrg ? pendingStorageKey({ host: session.host, username: session.username, pmOrg }) : null;
  const demoPending = useRef<PendingDoc>({ v: 1, items: {} });
  const readPending = useCallback(
    (): PendingDoc => (demo || !pendingKey ? demoPending.current : loadPending(pendingKey)),
    [demo, pendingKey],
  );
  const writePending = useCallback(
    (doc: PendingDoc) => {
      if (demo || !pendingKey) demoPending.current = doc;
      else savePending(pendingKey, doc);
    },
    [demo, pendingKey],
  );
  const [local, setLocal] = useState<ThreadItem[]>(() => listLocal(readPending(), issueNumber));
  const refreshLocal = useCallback(() => setLocal(listLocal(readPending(), issueNumber)), [readPending, issueNumber]);

  // Own actions from other tabs (mini-app Guardar, Cerrar) show here at once.
  useEffect(() => {
    if (demo || !pendingKey) return;
    refreshLocal();
    const onStorage = (event: StorageEvent) => {
      if (event.key === pendingKey) refreshLocal();
    };
    window.addEventListener("storage", onStorage);
    const tick = window.setInterval(refreshLocal, 30_000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(tick);
    };
  }, [demo, pendingKey, refreshLocal]);

  useEffect(() => {
    let cancelled = false;
    readSnapshot.current = cursor;
    if (demo) {
      setIssue(demo.issue);
      setHeader(conversationHeader(demo.issue, null, DEFAULT_SOLVERS_CATALOG));
      setSources(demo.sources);
      setCites(demo.cites ?? []);
      setLoad({ status: "ready" });
      return;
    }
    if (!session) return;
    setLoad({ status: "loading" });
    void (async () => {
      try {
        const subject = await loadConversationSubject({ session, pmOrg, lang, contentOrg, issueNumber });
        if (cancelled) return;
        const teamDecision = opensAsTeamDecision(session, pmOrg, subject.board, subject.issue);
        if (!canOpenConversation(subject.issue, session.username, canManage, teamDecision)) {
          setLoad({ status: "forbidden" });
          return;
        }
        setIssue(subject.issue);
        setBoard(subject.board);
        setCatalog(subject.catalog);
        setHeader(conversationHeader(subject.issue, subject.board, subject.catalog));
        const loaded = await loadThreadSources(session, pmOrg, subject.issue);
        if (cancelled) return;
        setSources(loaded);
        setLoad({ status: "ready" });
      } catch (err) {
        if (cancelled) return;
        if (isNotFound(err)) setLoad({ status: "missing" });
        else setLoad({ status: "error", message: explainError(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
    // The cursor snapshot is taken once per open; later polls must not reload the thread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token, pmOrg, issueNumber, demo, canManage, lang, contentOrg, reloadTick]);

  useEffect(() => {
    if (!demo && load.status === "ready" && issue) onMarkSeen(issue.number);
  }, [demo, load.status, issue, onMarkSeen]);

  // Plan §5: only when every comment source loaded, and only this thread.
  useEffect(() => {
    if (demo || load.status !== "ready" || !issue) return;
    const ids = threadReadIds(sources);
    if (!ids) return;
    const key = `${issue.number}:${ids.pm ?? 0}:${ids.pr ?? 0}`;
    if (markedFor.current === key) return;
    markedFor.current = key;
    onMarkRead(issue.number, ids);
  }, [demo, load.status, issue, sources, onMarkRead]);

  const timeline = useMemo(
    () => groupSaves(mergeTimeline([...sources.flatMap((s) => s.items), ...local])),
    [sources, local],
  );
  /** A decided card already shows its resolution; its separate line is not repeated. */
  const visible = useMemo(() => {
    const onCards = resolutionsOnCards(timeline);
    return onCards.size ? timeline.filter((item) => !onCards.has(item.key)) : timeline;
  }, [timeline]);

  useEffect(() => {
    if (load.status !== "ready" || !issue || demo || !session) return;
    let cancelled = false;
    void loadCiteTargets(issue, { session }).then((rows) => {
      if (!cancelled) setCites(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [load.status, issue, demo, session]);

  const participants = useMemo(
    () => (issue ? mentionCandidates(issue, timeline, username) : []),
    [issue, timeline, username],
  );

  const statuses = useMemo(() => decisionStatuses(timeline), [timeline]);
  const pendingDecisions = useMemo(() => pendingDecisionIds(statuses), [statuses]);
  const resolutionAt = useMemo(() => {
    const out = new Map<unknown, string>();
    for (const row of timeline) if (row.event) out.set(row.event, row.createdAt);
    return out;
  }, [timeline]);
  const viewer = useMemo(
    () => ({
      username,
      canManage,
      assignees: issue
        ? [...new Set([issue.assignee?.login, ...(issue.assignees ?? []).map((a) => a.login)].filter((l): l is string => Boolean(l)))]
        : [],
    }),
    [username, canManage, issue],
  );
  const projectId = issue ? issueProjectId(issue) : "";
  const decisionEnv = useMemo(
    () => ({ session, pmOrg, issueNumber, lang, projectId }),
    [session, pmOrg, issueNumber, lang, projectId],
  );

  const mine = Boolean(
    header?.assignees.some((a) => a.toLowerCase() === username.toLowerCase()),
  );
  const launchCtx = useMemo(
    () =>
      demo
        ? (demo.launch?.ctx ?? null)
        : issue && board && session
          ? buildSolverLaunchContext({
              username: session.username,
              lang,
              pmOrg,
              contentOrg,
              board,
              issue,
              stepId: header?.step?.id,
              stepName: header?.step?.name,
            })
          : null,
    [demo, issue, board, session, lang, pmOrg, contentOrg, header],
  );
  const solver = demo
    ? demo.launch?.app
    : mine && launchCtx
      ? (header?.solver ?? scriptureSolverFor(catalog, launchCtx.resource))
      : undefined;
  const solverBlock = solver && launchCtx ? solverLaunchBlockReason(solver, launchCtx) : null;
  const editorApp =
    solver && isScriptureSolver(solver)
      ? solver
      : (demo || mine) && launchCtx
        ? scriptureSolverFor(catalog, launchCtx.resource)
        : undefined;

  const openLaunch = useCallback(
    (app: SolverApp, ctx: SolverLaunchContext) => {
      try {
        openSolverApp(app, ctx);
        announce(tNow("cv.openingApp").replace("{app}", app.name).replace("{ref}", `${ctx.book} ${ctx.ref}`));
      } catch (err) {
        announce(explainError(err));
      }
    },
    [announce],
  );

  const openEditorAt = useMemo(
    () =>
      editorApp && launchCtx
        ? (range: { chapter: number; from: number; to: number }) => openLaunch(editorApp, launchForRange(launchCtx, range))
        : undefined,
    [editorApp, launchCtx, openLaunch],
  );

  const runDecision = useCallback(
    async (item: ThreadItem, optionId: string, event: ChatEvent = item.event!) => {
      const definition = resolveChatEvent(event).definition;
      const remainingDecisions = pendingDecisions.filter((id) => id !== event.decision?.id);
      const items = demo
        ? ((await demo.decide?.(optionId, item)) ?? [])
        : await definition!.run!(optionId, event, { ...decisionEnv, remainingDecisions });
      let doc = readPending();
      for (const row of items) doc = pushLocal(doc, issueNumber, { ...row, key: `local:${row.key}`, reconcileKey: row.key });
      writePending(doc);
      refreshLocal();
      announce(tNow("cv.decisionSaved"));
    },
    [demo, pendingDecisions, decisionEnv, readPending, writePending, refreshLocal, issueNumber, announce],
  );

  const renderDecision = useCallback(
    (item: ThreadItem, resolved: ResolvedChatEvent) => {
      const status = statuses.get(item.key);
      const at = status?.resolution ? resolutionAt.get(status.resolution) : undefined;
      const canRun = demo ? Boolean(demo.decide) : Boolean(resolved.definition?.run && session);
      return (
        <DecisionCard
          item={item}
          resolved={resolved}
          time={timeOfDay(item.createdAt)}
          status={status}
          resolutionTime={at ? clock(at, new Date()) : undefined}
          viewer={viewer}
          env={decisionEnv}
          demoPrepared={demo && item.event?.decision ? demo.prepared?.[item.event.decision.id] : undefined}
          onRun={canRun ? (optionId, event) => runDecision(item, optionId, event) : undefined}
          onOpenEditor={openEditorAt}
        />
      );
    },
    [statuses, resolutionAt, demo, session, viewer, decisionEnv, runDecision, openEditorAt],
  );

  const pmRepo = useMemo(() => ({ owner: pmOrg || "demo-pm-sandbox", repo: PM_REPO_NAME }), [pmOrg]);

  const deliver = useCallback(
    async (item: ThreadItem) => {
      try {
        const comment =
          demo || !session
            ? await new Promise<{ id: number; body: string; created_at: string; user: { login: string } }>(
                (resolve) =>
                  window.setTimeout(
                    () =>
                      resolve({
                        id: Date.now(),
                        body: item.text,
                        created_at: new Date().toISOString(),
                        user: { login: username || "tú" },
                      }),
                    700,
                  ),
              )
            : await postThreadReply(session, pmOrg, issueNumber, item.text);
        const real = commentToItem(comment, "issue", pmRepo);
        writePending(updateLocal(readPending(), issueNumber, item.key, { pending: undefined, reconcileKey: real.key }));
        setSources((prev) =>
          prev.map((s) => (s.kind === "issue" ? { ...s, items: [...s.items, real] } : s)),
        );
      } catch {
        writePending(updateLocal(readPending(), issueNumber, item.key, { pending: "error" }));
      }
      refreshLocal();
    },
    [demo, session, pmOrg, issueNumber, username, pmRepo, readPending, writePending, refreshLocal],
  );

  const send = useCallback(
    (text: string) => {
      const body = sanitizeMentions(text.trim(), participants);
      if (!body) return;
      const item: ThreadItem = {
        key: `local:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        source: "local",
        id: 0,
        createdAt: new Date().toISOString(),
        author: username,
        kind: "humano",
        text: body,
        pending: "enviando",
      };
      writePending(pushLocal(readPending(), issueNumber, item));
      refreshLocal();
      void deliver(item);
      requestAnimationFrame(() => logRef.current?.lastElementChild?.scrollIntoView({ block: "end" }));
    },
    [participants, username, issueNumber, readPending, writePending, refreshLocal, deliver],
  );

  const retrySend = useCallback(
    (item: ThreadItem) => {
      writePending(updateLocal(readPending(), issueNumber, item.key, { pending: "enviando" }));
      refreshLocal();
      void deliver({ ...item, pending: "enviando" });
    },
    [issueNumber, readPending, writePending, refreshLocal, deliver],
  );

  const discard = useCallback(
    (item: ThreadItem) => {
      writePending(removeLocal(readPending(), issueNumber, item.key));
      refreshLocal();
    },
    [issueNumber, readPending, writePending, refreshLocal],
  );

  const firstUnreadKey = useMemo(() => {
    const snap = readSnapshot.current;
    if (!snap || demo) return "";
    const read = snap.threads[String(issueNumber)];
    const me = username.toLowerCase();
    const hit = visible.find((item) => {
      if (!item.id || item.author.toLowerCase() === me) return false;
      const source = item.source === "issue" ? "pm" : item.source === "pr" ? "pr" : null;
      return source ? item.id > (read?.[source] ?? 0) : false;
    });
    return snap.seeded && hit ? hit.key : "";
  }, [visible, issueNumber, username, demo]);

  useEffect(() => {
    if (load.status !== "ready") return;
    const log = logRef.current;
    if (!log) return;
    const target = firstUnreadKey ? log.querySelector(`[data-key="${CSS.escape(firstUnreadKey)}"]`) : null;
    if (target) target.scrollIntoView({ block: "center" });
    else log.lastElementChild?.scrollIntoView({ block: "end" });
  }, [load.status, firstUnreadKey]);

  const retry = useCallback(async () => {
    if (!session || !issue) return;
    setRetrying(true);
    try {
      setSources(await retryThreadSources(session, pmOrg, issue, sources));
    } finally {
      setRetrying(false);
    }
  }, [session, pmOrg, issue, sources]);

  const now = new Date();
  const failed = sources.filter((s) => s.status === "error");
  const title = header?.title || issue?.title || `Subtarea #${issueNumber}`;
  const doorUrl = issue?.html_url || door43IssueUrl(session, pmOrg, issueNumber);
  const subline = [
    header?.taskLabel ? localizeName(header.taskLabel, language) : "",
    header?.step ? t("cv.step").replace("{name}", localizeName(header.step.name, language)) : "",
    header?.assignees.length ? header.assignees.map((a) => `@${a}`).join(", ") : "",
  ].filter(Boolean);

  const showAside = siblings.length > 1;

  return (
    <div className={showAside ? "chat-layout chat-layout--split" : "chat-layout"}>
      {showAside ? (
        <nav className="chat-aside" aria-label={t("cv.myConversations")}>
          {siblings.map((row) => (
            <button
              key={row.number}
              type="button"
              className="chat-aside__row"
              aria-current={row.number === issueNumber ? "page" : undefined}
              onClick={() => onOpenThread(row.number)}
            >
              {hasUnread(cursor, row.number) && row.number !== issueNumber ? (
                <span className="hub-queue-item__dot" role="img" aria-label={t("cv.unreadAria")} />
              ) : null}
              <span className="chat-aside__label">{row.title}</span>
            </button>
          ))}
        </nav>
      ) : null}

      <div className="chat-main">
        <header className="chat-header">
          <div className="chat-header__row">
            <button type="button" className="chat-back" onClick={onBack} aria-label={t("cv.backToMy")}>
              <ArrowLeft aria-hidden className="size-4" />
              <span className="chat-back__label">{t("nav.myTasks")}</span>
            </button>
            {/* The name and what it belongs to, one block beside the way back: the same short header the tools have. */}
            <div className="chat-header__name">
              <h1 className="chat-header__title">{title}</h1>
              {subline.length ? <p className="chat-header__sub">{subline.join(" · ")}</p> : null}
            </div>
            <div className="chat-header__actions">
              {solver && launchCtx ? (
                solver.kind === "url" || solver.openMode === "external" ? (
                  solverBlock ? null : (
                    <a
                      className="btn chat-header__solver"
                      data-size="sm"
                      data-variant="default"
                      href={resolveSolverLaunchUrl(solver, launchCtx)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`${solver.name} · ${launchCtx.book} ${launchCtx.ref}`}
                    >
                      {loc(solverActionLabel(solver))}
                    </a>
                  )
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    className="chat-header__solver"
                    disabled={Boolean(solverBlock)}
                    title={`${solver.name} · ${launchCtx.book} ${launchCtx.ref}`}
                    onClick={() => openLaunch(solver, launchCtx)}
                  >
                    {loc(solverActionLabel(solver))}
                  </Button>
                )
              ) : null}
              {load.status === "ready" || load.status === "error" ? (
                <div className="chat-more">
                  <button
                    type="button"
                    className="chat-icon-btn"
                    aria-label={t("cv.moreOptions")}
                    aria-expanded={moreOpen}
                    onClick={() => setMoreOpen((v) => !v)}
                  >
                    <MoreHorizontal aria-hidden className="size-4" />
                  </button>
                  {moreOpen ? (
                    <div className="chat-more__menu" role="menu">
                      {!demo ? (
                        <a role="menuitem" href={doorUrl} target="_blank" rel="noreferrer" onClick={() => setMoreOpen(false)}>
                          {t("cv.openDoor43n").replace("{n}", String(issueNumber))}
                        </a>
                      ) : null}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          void navigator.clipboard?.writeText(window.location.href);
                          announce(t("cv.linkCopied"));
                          setMoreOpen(false);
                        }}
                      >
                        {t("cv.copyLink")}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          {solverBlock ? <p className="chat-header__sub">{loc(solverBlock)}</p> : null}
          {demo ? (
            <p className="chat-header__sub">{demo.notice || t("cv.demoNotice")}</p>
          ) : null}
          {demo?.toolbar ?? null}
        </header>

        {load.status === "loading" ? (
          <div className="chat-log" aria-busy="true" aria-label={t("cv.loadingAria")}>
            <div className="chat-skeleton chat-skeleton--other" />
            <div className="chat-skeleton chat-skeleton--mine" />
            <div className="chat-skeleton chat-skeleton--other" />
          </div>
        ) : null}

        {load.status === "missing" ? (
          <div className="chat-state">
            <p className="chat-state__title">{t("cv.missingTitle").replace("{n}", String(issueNumber)).replace("{org}", pmOrg)}</p>
            <p className="chat-state__body">{t("cv.missingBody")}</p>
            <Button type="button" variant="outline" onClick={onBack}>
              {t("cv.backToMy")}
            </Button>
          </div>
        ) : null}

        {load.status === "forbidden" ? (
          <div className="chat-state">
            <p className="chat-state__title">{t("cv.forbiddenTitle")}</p>
            <p className="chat-state__body">{t("cv.forbiddenBody")}</p>
            <Button type="button" variant="outline" onClick={onBack}>
              {t("cv.backToMy")}
            </Button>
          </div>
        ) : null}

        {load.status === "error" ? (
          <div className="chat-state">
            <p className="chat-state__title">{t("cv.errorTitle")}</p>
            <p className="chat-state__body">{load.message}</p>
            <div className="chat-state__actions">
              <Button type="button" onClick={() => setReloadTick((n) => n + 1)}>
                {t("cv.retry")}
              </Button>
              <a className="btn" data-size="default" data-variant="outline" href={doorUrl} target="_blank" rel="noreferrer">
                {t("cv.openDoor43")}
              </a>
            </div>
          </div>
        ) : null}

        {load.status === "ready" ? (
          <div ref={logRef} className="chat-log" role="log" aria-live="polite" aria-label={t("cv.messagesAria")}>
            {!visible.length && !failed.length ? (
              <div className="chat-state chat-state--inline">
                <p className="chat-state__title">{t("cv.noMessagesTitle")}</p>
                <p className="chat-state__body">{t("cv.noMessagesBody")}</p>
              </div>
            ) : null}
            {visible.map((item, index) => (
              <TimelineRow
                key={item.key}
                item={item}
                prev={visible[index - 1]}
                me={username}
                day={
                  item.createdAt && dayKey(item.createdAt) !== dayKey(visible[index - 1]?.createdAt ?? "")
                    ? dayLabel(item.createdAt, now)
                    : ""
                }
                showNewDivider={item.key === firstUnreadKey}
                onRetry={() => retrySend(item)}
                onDiscard={() => discard(item)}
                renderDecision={renderDecision}
              />
            ))}
            {failed.map((source) => (
              <p key={source.kind} className="chat-system chat-system--error">
                {t("cv.failedLoad").replace("{what}", t(SOURCE_LABEL[source.kind] ?? "cv.srcOther"))} ·{" "}
                <button type="button" className="chat-link" disabled={retrying} onClick={() => void retry()}>
                  {retrying ? t("cv.retrying") : t("cv.retry")}
                </button>
              </p>
            ))}
          </div>
        ) : null}

        {load.status === "ready" || load.status === "loading" ? (
          <Composer
            draftKey={
              !demo && session && pmOrg
                ? `tas-chat-draft:${session.host.replace(/^https?:\/\//, "")}:${session.username.toLowerCase()}:${pmOrg.toLowerCase()}:${issueNumber}`
                : `tas-chat-draft:demo:${issueNumber}`
            }
            ready={load.status === "ready"}
            participants={participants}
            cites={cites}
            onSend={send}
          />
        ) : null}
      </div>
    </div>
  );
}

function readDraft(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(key: string, value: string): void {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* best-effort */
  }
}

const MAX_COMPOSER_LINES = 6;

function Composer({
  draftKey,
  ready,
  participants,
  cites,
  onSend,
}: {
  draftKey: string;
  ready: boolean;
  participants: string[];
  cites: CiteTarget[];
  onSend: (text: string) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState(() => readDraft(draftKey));
  const [caret, setCaret] = useState(0);
  const [citeOpen, setCiteOpen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const coarse = useMemo(
    () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches,
    [],
  );

  useEffect(() => writeDraft(draftKey, draft), [draftKey, draft]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const max = line * MAX_COMPOSER_LINES + 16;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [draft]);

  const mention = activeMention(draft, caret);
  const suggestions = mention
    ? participants.filter((p) => p.toLowerCase().startsWith(mention.query.toLowerCase())).slice(0, 5)
    : [];

  function submit() {
    if (!ready || !draft.trim()) return;
    onSend(draft);
    setDraft("");
    setCiteOpen(false);
  }

  function pickMention(login: string) {
    if (!mention) return;
    const next = `${draft.slice(0, mention.start)}@${login} ${draft.slice(caret)}`;
    setDraft(next);
    const pos = mention.start + login.length + 2;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  }

  function pickCite(target: CiteTarget) {
    setDraft((prev) => insertQuote(prev, quoteVerse(target.ref, target.text)));
    setCiteOpen(false);
    requestAnimationFrame(() => ref.current?.focus());
  }

  return (
    <div className="chat-composer">
      {suggestions.length ? (
        <div className="chat-composer__menu" role="listbox" aria-label={t("cv.mention")}>
          {suggestions.map((login) => (
            <button key={login} type="button" role="option" aria-selected="false" onClick={() => pickMention(login)}>
              @{login}
            </button>
          ))}
        </div>
      ) : null}
      {citeOpen && cites.length ? (
        <div className="chat-composer__menu" role="listbox" aria-label={t("cv.quote")}>
          {cites.map((target) => (
            <button key={target.id} type="button" role="option" aria-selected="false" onClick={() => pickCite(target)}>
              <strong>{target.ref}</strong> <span className="chat-composer__cite-text">{target.text}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="chat-composer__row">
        <div className="chat-composer__field">
          <textarea
            ref={ref}
            className="chat-composer__input"
            rows={1}
            placeholder={t("cv.placeholder")}
            aria-label={t("cv.messageAria")}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setCaret(e.target.selectionStart ?? e.target.value.length);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !coarse && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (suggestions.length) pickMention(suggestions[0]!);
                else submit();
              }
            }}
          />
          {cites.length ? (
            <button
              type="button"
              className="chat-composer__cite"
              aria-expanded={citeOpen}
              aria-label={t("cv.quote")}
              title={t("cv.quoteTitle")}
              onClick={() => setCiteOpen((v) => !v)}
            >
              <TextQuote aria-hidden className="size-4" />
              <span className="chat-composer__cite-label">{t("cv.quote")}</span>
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="chat-composer__send"
          aria-label={t("cv.send")}
          title={t("cv.send")}
          disabled={!ready || !draft.trim()}
          onClick={submit}
        >
          <SendHorizontal aria-hidden className="size-5" />
        </button>
      </div>
      {!ready ? <p className="chat-composer__hint">{t("cv.loadingHint")}</p> : null}
    </div>
  );
}

function TimelineRow({
  item,
  prev,
  me,
  day,
  showNewDivider,
  onRetry,
  onDiscard,
  renderDecision,
}: {
  item: ThreadItem;
  prev?: ThreadItem;
  me: string;
  /** Day label when this row starts a new day ("Hoy", "Ayer", "12 de septiembre"). */
  day: string;
  showNewDivider: boolean;
  onRetry: () => void;
  onDiscard: () => void;
  renderDecision: (item: ThreadItem, resolved: ResolvedChatEvent) => ReactNode;
}) {
  const t = useT();
  const language = useUiLanguage();
  const breaks = Boolean(day) || showNewDivider;
  const dividers = (
    <>
      {day ? (
        <div className="chat-day" role="separator">
          <span>{day}</span>
        </div>
      ) : null}
      {showNewDivider ? (
        <div className="chat-new-divider" role="separator">
          <span>{t("cv.newDivider")}</span>
        </div>
      ) : null}
    </>
  );

  if (item.kind !== "humano" && item.event) {
    const resolved = resolveChatEvent(item.event);
    if (resolved.render === "decision") {
      return (
        <>
          {dividers}
          {renderDecision(item, resolved)}
        </>
      );
    }
    const who = item.author && item.author.toLowerCase() === me.toLowerCase() ? t("cv.you") : item.author;
    const title = localizeThread(resolved.title, language);
    const label =
      item.count && item.count > 1 ? t("cv.nTimes").replace("{title}", title).replace("{n}", String(item.count)) : title;
    return (
      <>
        {dividers}
        <p
          className="chat-system"
          data-key={item.key}
          data-run={!breaks && isSystemLine(prev) ? "cont" : undefined}
        >
          <span>{label}</span>
          {who ? <span className="chat-system__who"> · {who}</span> : null}
          {item.createdAt ? (
            <>
              {" · "}
              <time dateTime={item.createdAt} title={fullStamp(item.createdAt)}>
                {timeOfDay(item.createdAt)}
              </time>
            </>
          ) : null}
        </p>
      </>
    );
  }

  const mine = item.author.toLowerCase() === me.toLowerCase() && Boolean(me);
  const sameAuthor = !breaks && prev?.kind === "humano" && prev.author === item.author;
  return (
    <>
      {dividers}
      <div
        className={mine ? "chat-msg chat-msg--mine" : "chat-msg"}
        data-key={item.key}
        data-pending={item.pending ?? undefined}
        data-group={sameAuthor ? "cont" : "first"}
      >
        {!mine ? (
          <span className="chat-avatar" aria-hidden data-hidden={sameAuthor ? "true" : "false"}>
            {initials(item.author)}
          </span>
        ) : null}
        <div className="chat-msg__col">
          <div className="chat-bubble">
            {!mine && !sameAuthor ? <span className="chat-msg__author">{item.author}</span> : null}
            <div className="chat-bubble__body">
              <div className="chat-bubble__text">
                <MessageText text={item.text} />
              </div>
              <span className="chat-bubble__meta">
                {item.pending === "enviando" ? t("cv.sending") : null}
                {item.pending === "error" ? <span className="chat-msg__error">{t("cv.notSent")}</span> : null}
                {item.createdAt && !item.pending ? (
                  <time dateTime={item.createdAt} title={fullStamp(item.createdAt)}>
                    {timeOfDay(item.createdAt)}
                  </time>
                ) : null}
              </span>
            </div>
          </div>
          {item.pending === "error" ? (
            <span className="chat-msg__meta">
              <button type="button" className="chat-link chat-msg__action" onClick={onRetry}>
                {t("cv.retry")}
              </button>
              <button type="button" className="chat-link chat-msg__action" onClick={onDiscard}>
                {t("cv.discard")}
              </button>
            </span>
          ) : null}
        </div>
      </div>
    </>
  );
}

/** Minimal markdown: `>` quotes, **bold**, links. Never raw HTML. */
function MessageText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*>/.test(l))) {
          return (
            <blockquote key={i} className="chat-quote">
              {lines.map((l, j) => (
                <span key={j} className="block">
                  <Inline text={l.replace(/^\s*>\s?/, "")} />
                </span>
              ))}
            </blockquote>
          );
        }
        return (
          <p key={i} className="chat-bubble__p">
            {lines.map((l, j) => (
              <span key={j} className="block">
                <Inline text={l} />
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}

function Inline({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) parts.push(<strong key={m.index}>{m[1]}</strong>);
    else
      parts.push(
        <a key={m.index} href={m[3]} target="_blank" rel="noreferrer" className="chat-link">
          {m[2]}
        </a>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
