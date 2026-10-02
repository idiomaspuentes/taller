import { PM_REPO_NAME } from "./domain/types";
import { BrandMark } from "./components/BrandMark";
import { appTitle } from "./brand";
import { tallerConfig, workspaceOfOrg, type Workspace } from "./config";
import { useUiLanguage } from "./i18n/language";
import { tNow, useT } from "./i18n/messages";
import { contextWith, initialWorkspace, saveWorkspaceId } from "./workspace";
import { setActiveScope } from "./domain/scope";
import { forcedHost } from "./serverChoice";
import { Welcome } from "./components/Welcome";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DcsOrg } from "@ip-lms/dcs-client";
import { defaultContentOrg, normalizeProjectId, projectDisplayName } from "./domain/books";
import { normalizeLangCode, type LanguageOption } from "./domain/languages";
import { mergeOrgs, orgSlug } from "./domain/orgs";
import { loadDoor43Languages } from "./dcs/languages";
import { applyWorkflowToBoard } from "./domain/workflows";
import { localized, shippedWorkflows } from "./domain/processes";
import { loadLocalWorkflows } from "./domain/store";
import type { WorkflowTemplate } from "./domain/types";
import { HandoffUnitsPanel } from "./components/HandoffUnitsPanel";
import { ChecklistView } from "./components/ChecklistView";
import { EndorsementView } from "./components/EndorsementView";
import { PublishUnitView } from "./components/PublishUnitView";
import { GlossaryView } from "./components/GlossaryView";
import type { AssignmentsDoc, InventoryDoc, ProjectIndexEntry } from "./domain/types";
import {
  emptyAssignments,
  isInventoryDoc,
  loadContext,
  loadLocalAssignments,
  loadLocalProjectsIndex,
  mergeInventories,
  normalizeAssignmentsDoc,
  normalizeInventory,
  persistSessionInventory,
  resolveProjectMeta,
  restoreSessionInventory,
  saveContext,
  saveLocalAssignments,
  upsertLocalProjectIndex,
} from "./domain/store";
import {
  enrichSessionRoles,
  loadSession,
  sessionNeedsReauth,
  signOut,
  type GtSession,
} from "./dcs/auth";
import { DEFAULT_HOST } from "./dcs/config";
import { installSessionExpiryGuard } from "./dcs/sessionExpiry";
import {
  fetchOrg,
  allowPmOrgTeamToEdit,
  listPmProjects,
  listUserOrgs,
  loadAssignmentsFromDcs,
  loadInventoryFromDcs,
  loadTeamsFromDcs,
  saveProjectsIndexToDcs,
} from "./dcs/persist";
import { loadPmConfig, pullIssues } from "./dcs/issues";
import { useConversationActivity } from "./useConversationActivity";
import { generateInventory } from "./worker/client";
import { draftBook, loadNextBookHint, loadTeamOptions, setTaskTeams, startBook, type StartStage, type StartedBook } from "./dcs/startBook";
import { SignInModal } from "./components/SignIn";
import { SetupGate } from "./components/SetupGate";
import { WorkspaceDialog } from "./components/WorkspaceDialog";
import { BookStepView } from "./components/BookStepView";
import { AdvanceView } from "./components/AdvanceView";
import { AfinacionView } from "./components/AfinacionView";
import { AlineacionView } from "./components/AlineacionView";
import { TeamTodayView } from "./components/TeamTodayView";
import { itemsFor, BottomNav, type BottomNavId } from "./components/BottomNav";
import { MyTasksView } from "./components/MyTasksView";
import { ConflictSandboxView } from "./components/ConflictSandboxView";
import { ConversationView } from "./components/ConversationView";
import { DEMO_CITES, demoDecisions, demoIssue, demoThreadSources } from "./domain/conversationFixture";
import "./conversationTypes";
import type { DcsIssue } from "@ip-lms/dcs-client";
import { TeamBoardView } from "./components/TeamBoardView";
import { OrgView } from "./components/OrgView";
import { ScriptureEditorView } from "./components/ScriptureEditorView";
import { HelpsEditorView } from "./components/HelpsEditorView";
import { FamiliarizeView } from "./components/FamiliarizeView";
import { SolverLabView } from "./components/SolverLabView";
import { PortionReviewView } from "./components/PortionReviewView";
import { TemplatesView } from "./components/TemplatesView";
import { DraftProjectView } from "./components/DraftProjectView";
import { clearProjectDraft, loadProjectDraft, saveProjectDraft } from "./domain/draftProject";
import { ProjectsView, type CreateProjectInput } from "./components/ProjectsView";
import { AppNav } from "./components/AppNav";
import { PushPrompt } from "./components/PushPrompt";
import { useMentions } from "./useMentions";
import { Onboarding } from "./components/Onboarding";
import { ProfileView } from "./components/ProfileView";
import { useOnboarding } from "./onboarding";
import { clearNotices } from "./clearNotices";
import { QaAdminDialog } from "./components/QaAdminDialog";
import { canShowQaAdmin, isProductionHost } from "./domain/qaAdmin";
import { UserMenu } from "./components/UserMenu";
import { resolveResourceRepo } from "./domain/roles";
import { StepNav, stepEnabled, type StepId } from "./components/StepNav";
import { ProjectPlanView } from "./components/ProjectPlanView";
import { ProjectWorkView } from "./components/ProjectWorkView";
import { landingRoute, useHashRoute } from "./router";
import { decodeSolverLaunchContext } from "./domain/solverLaunch";
import { isLabLaunch } from "./domain/solverLab";
import {
  effectiveCanManage as computeEffectiveCanManage,
  loadViewMode,
  saveViewMode,
  type ViewMode,
} from "./viewMode";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { explainError } from "./dcs/userError";

/** Pages that keep the phone's bottom bar: the daily places and the personal ones. */
const BOTTOM_NAV_ROUTES: string[] = ["avisos", "mis-tareas", "perfil", "hoy", "proyectos", "organizacion", "plantillas", "glosario"];

const SETUP_DONE_KEY = "gt-context-confirmed";

function readSetupDone(): boolean {
  try {
    return localStorage.getItem(SETUP_DONE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSetupDone(): void {
  try {
    localStorage.setItem(SETUP_DONE_KEY, "1");
  } catch {
    /* quota */
  }
}

/**
 * Where a project opens: on how it is going once it has subtareas, on the subtareas it would lay out when the book
 * was read and none exists yet, and on its process while there is no reading of the book to lay anything out with.
 */
function landingStep(hasTasks: boolean, hasInventory: boolean, issues: number, severalBooks: boolean): StepId {
  if (!hasTasks) return "tareas";
  // A book is read from its subtareas screen; a project of several books has a screen to read each.
  if (!hasInventory) return severalBooks ? "inventario" : "subtareas";
  return issues > 0 ? "avance" : "subtareas";
}

export function App() {
  const t = useT();
  const uiLanguage = useUiLanguage();
  // The team space this browser works in. Its language and organizations are fixed by taller.config.ts and
  // laid over anything saved, so a space never picks up another's organization.
  const savedRaw = loadContext();
  // A person who signed in before spaces existed is placed by the organization they were using.
  const [workspace, setWorkspace] = useState<Workspace | undefined>(
    () => initialWorkspace(tallerConfig) ?? (savedRaw?.pmOrg ? workspaceOfOrg(tallerConfig, savedRaw.pmOrg) : undefined),
  );
  const saved = savedRaw && workspace ? contextWith(savedRaw, workspace) : savedRaw;
  // Set before anything reads or writes: the space decides every label, milestone and path.
  setActiveScope(workspace?.scope);
  const { route, navigate } = useHashRoute();
  const [host, setHost] = useState(forcedHost() ?? saved?.host ?? DEFAULT_HOST);
  const [lang, setLang] = useState(workspace?.lang ?? (saved?.lang || "es-419"));
  const [contentOrg, setContentOrg] = useState(workspace?.contentOrg ?? (saved?.contentOrg || defaultContentOrg("es-419")));
  const [pmOrg, setPmOrg] = useState(workspace?.pmOrg ?? (saved?.pmOrg || ""));
  const [book, setBook] = useState(saved?.book || "NEH");
  const [session, setSession] = useState<GtSession | null>(() => {
    const loaded = loadSession();
    if (!loaded) return null;
    if (sessionNeedsReauth(loaded)) return null;
    return loaded;
  });
  const [needsReauth, setNeedsReauth] = useState(() => sessionNeedsReauth(loadSession()));
  const [sessionExpired, setSessionExpired] = useState(false);
  /** Bumped on re-sign-in after expiry so solver views re-read the stored session. */
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const [orgs, setOrgs] = useState<DcsOrg[]>([]);
  const [extraOrgs, setExtraOrgs] = useState<DcsOrg[]>([]);
  const knownOrgs = useMemo(() => mergeOrgs(orgs, extraOrgs), [orgs, extraOrgs]);
  const [remoteBooks, setRemoteBooks] = useState<string[]>([]);
  const [projects, setProjects] = useState<ProjectIndexEntry[]>(() =>
    loadLocalProjectsIndex(saved?.lang || "es-419"),
  );
  const [inventory, setInventory] = useState<InventoryDoc | null>(() => restoreSessionInventory());
  const [inventariarBook, setInventariarBook] = useState(
    () => saved?.book || "NEH",
  );
  const [board, setBoard] = useState<AssignmentsDoc>(() =>
    loadLocalAssignments(
      saved?.lang || "es-419",
      saved?.book || "NEH",
      saved?.contentOrg || defaultContentOrg("es-419"),
      saved?.pmOrg || "",
    ),
  );
  const [setupDone, setSetupDone] = useState(
    () => readSetupDone() || Boolean(restoreSessionInventory()) || Boolean(workspace),
  );
  const [generating, setGenerating] = useState(false);
  const [jobMessage, setJobMessage] = useState("");
  const [live, setLive] = useState("");
  const [signInOpen, setSignInOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(() => loadViewMode());
  const [hydrating, setHydrating] = useState(false);
  const [catalogLangs, setCatalogLangs] = useState<LanguageOption[]>([]);

  const activity = useConversationActivity(session, pmOrg);
  const mentions = useMentions(session, pmOrg);
  const onboarding = useOnboarding(session);
  // Mentions of issues the plan already tracks are counted there; only the others add to the badge.
  const attentionTotal =
    activity.unreadCount + mentions.rows.filter((m) => !activity.issues.includes(m.issue)).length;

  // Unread count on the installed app icon and in the tab title (best effort).
  useEffect(() => {
    const count = session ? attentionTotal : 0;
    document.title = count > 0 ? `(${count}) ${appTitle(uiLanguage)}` : appTitle(uiLanguage);
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (count > 0) void nav.setAppBadge?.(count)?.catch(() => {});
    else void nav.clearAppBadge?.()?.catch(() => {});
  }, [session, attentionTotal, uiLanguage]);
  // A notice on the phone goes away once its subtarea (or the list it leads to) is open in the app.
  const openedIssue = route.name === "conversacion" ? route.issue : 0;
  useEffect(() => {
    if (openedIssue) void clearNotices([`subtarea-${openedIssue}`]);
  }, [openedIssue]);
  useEffect(() => {
    if (route.name === "avisos" || route.name === "mis-tareas") void clearNotices(["asignaciones", "resumen"]);
  }, [route.name]);
  const [mineIssues, setMineIssues] = useState<DcsIssue[]>([]);
  const { setExtraIssues } = activity;
  const onMineIssues = useCallback(
    (issues: DcsIssue[]) => {
      setMineIssues(issues);
      setExtraIssues(issues);
    },
    [setExtraIssues],
  );
  const conversationDemo = useMemo(
    () =>
      import.meta.env.DEV && route.name === "conversacion" && route.demo
        ? {
            issue: demoIssue(route.issue, session?.username ?? ""),
            sources: demoThreadSources(route.issue, session?.username ?? ""),
            cites: DEMO_CITES,
            ...demoDecisions(route.issue, session?.username ?? ""),
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [route.name === "conversacion" ? `${route.issue}:${route.demo}` : "", session?.username],
  );
  const announce = useCallback((msg: string) => setLive(msg), []);
  /** Real DCS capability — role-toggle visibility and never elevated by preview. */
  const canManage = Boolean(session?.canManage);
  /** UI gates / nav / landing — demoted when admin previews trabajador. */
  // Seeing the app «as a person of the team» is for testing (development or a test server), not a choice for people.
  const canPreview = canManage && (Boolean(import.meta.env.DEV) || Boolean(session && !isProductionHost(session.host)));
  const roleView: ViewMode = canPreview ? viewMode : "gestor";
  const effectiveCanManage = computeEffectiveCanManage(canManage, roleView);
  const showQaAdmin = canShowQaAdmin({ host: session?.host, canManage, viewMode: roleView });
  const myTasksActive =
    route.name === "mis-tareas" || route.name === "conversacion" || route.name === "conflicto-prueba" || route.name === "equipo";
  const [qaAdminOpen, setQaAdminOpen] = useState(false);
  const [draft, setDraft] = useState<AssignmentsDoc | null>(() => loadProjectDraft(lang, contentOrg, pmOrg));
  // A draft that was created stays on screen (its summary) until the person leaves; elsewhere it is gone.
  useEffect(() => {
    if (route.name !== "proyecto-nuevo" && draft && !loadProjectDraft(lang, contentOrg, pmOrg)) setDraft(null);
    if (route.name === "proyecto-nuevo" && !draft) navigate({ name: "proyectos" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.name]);
  const projectStep: StepId | null = route.name === "proyecto" ? route.step : null;

  function setViewModeAndPersist(mode: ViewMode) {
    setViewMode(mode);
    saveViewMode(mode);
    if (mode === "trabajador") {
      if (
        route.name === "hoy" ||
        route.name === "proyectos" ||
        route.name === "proyecto" ||
        route.name === "organizacion" ||
        route.name === "plantillas"
      ) {
        navigate({ name: "mis-tareas" });
      }
    } else if (route.name === "mis-tareas" || route.name === "avisos" || route.name === "home") {
      navigate({ name: "hoy" });
    }
  }

  useEffect(
    () =>
      installSessionExpiryGuard({
        getSessionToken: () => loadSession()?.token,
        onExpired: () => {
          signOut();
          setSession(null);
          setWorkspaceOpen(false);
          setSessionExpired(true);
          setSignInOpen(true);
        },
      }),
    [],
  );

  useEffect(() => {
    if (!live) return;
    const id = window.setTimeout(() => setLive(""), 4500);
    return () => window.clearTimeout(id);
  }, [live]);

  useEffect(() => {
    saveContext({ lang, contentOrg, pmOrg, book, host });
  }, [lang, contentOrg, pmOrg, book, host]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  // Enrich roles when session / org change
  useEffect(() => {
    if (!session?.token || !pmOrg) return;
    let cancelled = false;
    void (async () => {
      try {
        const config = await loadPmConfig(session, pmOrg);
        const enriched = await enrichSessionRoles(session, pmOrg, config.managerTeam);
        if (!cancelled) {
          setSession((prev) =>
            prev && prev.token === enriched.token
              ? {
                  ...prev,
                  teams: enriched.teams,
                  isOwner: enriched.isOwner,
                  canManage: enriched.canManage,
                }
              : prev,
          );
        }
      } catch {
        /* keep prior session */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run on token/org
  }, [session?.token, pmOrg]);

  // Landing redirect
  useEffect(() => {
    if (!setupDone) return;
    if (route.name === "home") {
      navigate(landingRoute(effectiveCanManage));
    }
  }, [setupDone, route.name, effectiveCanManage, navigate]);

  // Kick managers out of manager-only routes while previewing trabajador.
  useEffect(() => {
    if (!canManage || roleView !== "trabajador") return;
    if (route.name === "hoy" || route.name === "proyectos" || route.name === "proyecto") {
      navigate({ name: "mis-tareas" });
    }
  }, [canManage, roleView, route.name, navigate]);

  // Sync workspace project id from route (`projectId` may be a book code today).
  useEffect(() => {
    if (route.name !== "proyecto") return;
    if (route.projectId === book) return;
    const code = normalizeProjectId(route.projectId);
    setBook(code);
    setInventariarBook(code);
    const cached = restoreSessionInventory();
    if (cached && cached.book === code) {
      const normalized = normalizeInventory(cached);
      setInventory(normalized);
      setBoard(loadLocalAssignments(lang, code, contentOrg, pmOrg));
    } else {
      setInventory(null);
      const nextBoard = loadLocalAssignments(lang, code, contentOrg, pmOrg);
      setBoard(nextBoard);
      setInventariarBook(nextBoard.books[0] || code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.name === "proyecto" ? route.projectId : ""]);

  useEffect(() => {
    if (!session) {
      setOrgs([]);
      return;
    }
    void listUserOrgs(session)
      .then((list) => {
        setOrgs(list);
        if (!pmOrg && !workspace && list.length) setPmOrg(orgSlug(list[0]));
      })
      .catch(() => setOrgs([]));
  }, [session, pmOrg, workspace]);

  useEffect(() => {
    setExtraOrgs([]);
  }, [host]);

  useEffect(() => {
    const slugs = [contentOrg, pmOrg].map((value) => value.trim()).filter(Boolean);
    const pending = slugs.filter(
      (slug) => !knownOrgs.some((org) => orgSlug(org) === slug),
    );
    if (!pending.length) return;
    let cancelled = false;
    void Promise.all(
      pending.map((slug) =>
        fetchOrg(host, slug, session?.token).catch(() => null),
      ),
    ).then((rows) => {
      if (cancelled) return;
      const found = rows.filter((row): row is DcsOrg => Boolean(row));
      if (found.length) setExtraOrgs((prev) => mergeOrgs(prev, found));
    });
    return () => {
      cancelled = true;
    };
  }, [host, session?.token, contentOrg, pmOrg, knownOrgs]);

  useEffect(() => {
    let cancelled = false;
    void loadDoor43Languages(host)
      .then((list) => {
        if (!cancelled) setCatalogLangs(list);
      })
      .catch(() => {
        if (!cancelled) setCatalogLangs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [host]);

  useEffect(() => {
    setProjects(loadLocalProjectsIndex(lang));
  }, [lang]);

  useEffect(() => {
    if (!session || !pmOrg || !lang) {
      setRemoteBooks([]);
      return;
    }
    let cancelled = false;
    void listPmProjects(session, pmOrg, lang).then((entries) => {
      if (cancelled) return;
      setRemoteBooks(entries.map((e) => e.projectId));
      if (entries.length) {
        setProjects((prev) => {
          const byId = new Map(prev.map((p) => [p.projectId, p]));
          for (const e of entries) byId.set(e.projectId, e);
          const next = [...byId.values()].sort((a, b) => a.title.localeCompare(b.title, "es"));
          return next;
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [session, pmOrg, lang]);

  function goToStep(id: StepId) {
    if (!stepEnabled(id, setupDone, Boolean(inventory))) return;
    navigate({ name: "proyecto", projectId: normalizeProjectId(book), step: id });
  }

  function confirmSetup() {
    writeSetupDone();
    setSetupDone(true);
    navigate(landingRoute(Boolean(session?.canManage) && loadViewMode() === "gestor"));
  }

  function applyInventory(doc: InventoryDoc, land: StepId = "asignar") {
    const normalized = normalizeInventory({
      ...doc,
      lang: doc.lang || lang,
      contentOrg: doc.contentOrg || contentOrg,
    });
    setInventory(normalized);
    persistSessionInventory(normalized);
    const projectId = normalizeProjectId(book);
    const nextBoard = loadLocalAssignments(lang, projectId, contentOrg, pmOrg);
    const meta = resolveProjectMeta({
      projectId,
      title: nextBoard.title,
      kind: nextBoard.kind,
      books: nextBoard.books.length ? nextBoard.books : [normalized.book],
    });
    setBoard({
      ...nextBoard,
      projectId: meta.projectId,
      book: meta.book,
      title: meta.title,
      kind: meta.kind,
      books: meta.books,
      lang,
      contentOrg,
      pmOrg,
    });
    upsertLocalProjectIndex(lang, {
      projectId: meta.projectId,
      title: meta.title,
      kind: meta.kind,
      books: meta.books,
    });
    setProjects(loadLocalProjectsIndex(lang));
    if (!setupDone) {
      writeSetupDone();
      setSetupDone(true);
    }
    navigate({ name: "proyecto", projectId: meta.projectId, step: land });
    announce(
      tNow("app.inventory").replace("{p}", String(normalized.portions.length)).replace("{a}", String(normalized.articles.length)),
    );
  }

  function updateBoard(next: AssignmentsDoc) {
    const id = normalizeProjectId(next.projectId || book);
    const meta = resolveProjectMeta({
      projectId: next.projectId || id,
      book: next.book || id,
      title: next.title,
      kind: next.kind,
      books: next.books,
    });
    const doc = {
      ...next,
      projectId: meta.projectId,
      book: meta.book,
      title: meta.title,
      kind: meta.kind,
      books: meta.books,
      lang,
      contentOrg,
      pmOrg,
    };
    setBoard(doc);
    saveLocalAssignments(doc);
    upsertLocalProjectIndex(lang, {
      projectId: meta.projectId,
      title: meta.title,
      kind: meta.kind,
      books: meta.books,
    });
    setProjects(loadLocalProjectsIndex(lang));
    return doc;
  }

  /**
   * Load plan JSON + inventory from DCS, then overlay person/state from issues.
   * Issues stay SoT for assignees; assignments.json stays SoT for phases/tasks.
   */
  const hydrateProjectFromDcs = useCallback(
    async (
      projectId: string,
    ): Promise<{
      board: AssignmentsDoc;
      inventory: InventoryDoc | null;
      issueCount: number;
      found: boolean;
    } | null> => {
      if (!session || !pmOrg) return null;
      const code = normalizeProjectId(projectId);
      const asg = await loadAssignmentsFromDcs(session, pmOrg, lang, code, contentOrg);
      const teamsDoc = await loadTeamsFromDcs(session, pmOrg, lang);
      const local = loadLocalAssignments(lang, code, contentOrg, pmOrg);
      const books =
        asg?.books?.length
          ? asg.books
          : local.books?.length
            ? local.books
            : [code];
      const invDocs: InventoryDoc[] = [];
      for (const bookCode of books) {
        const inv = await loadInventoryFromDcs(session, pmOrg, lang, bookCode);
        if (inv) invDocs.push(inv);
      }
      const mergedInv = mergeInventories(invDocs, code);
      if (!asg && !teamsDoc && !mergedInv) {
        return { board: local, inventory: null, issueCount: 0, found: false };
      }

      const base = asg ?? emptyAssignments(code, lang, contentOrg, pmOrg);
      let merged = normalizeAssignmentsDoc(
        {
          ...base,
          people: asg?.people?.length ? asg.people : teamsDoc?.people ?? base.people,
          phases: asg?.phases?.length ? asg.phases : base.phases,
          teams: asg?.teams?.length ? asg.teams : teamsDoc?.teams ?? base.teams,
          assignments: asg?.assignments ?? [],
        },
        { book: code, lang, contentOrg, pmOrg },
      );

      let issueCount = 0;
      try {
        const pulled = await pullIssues({
          session,
          org: pmOrg,
          book: code,
          board: merged,
        });
        issueCount = pulled.issues.length;
        merged = { ...merged, assignments: pulled.assignments };
        if (issueCount > 0 && !merged.settings?.lastPublish) {
          merged = {
            ...merged,
            settings: {
              ...merged.settings,
              lastPublish: {
                at: new Date().toISOString(),
                created: 0,
                updated: issueCount,
              },
            },
          };
        }
      } catch {
        /* issues optional — plan JSON still loads */
      }

      return {
        board: merged,
        inventory: mergedInv,
        issueCount,
        found: true,
      };
    },
    [session, pmOrg, lang, contentOrg],
  );

  // When opening a project with a session, hydrate plan + subtareas (edit, don’t recreate).
  useEffect(() => {
    if (route.name !== "proyecto") return;
    if (!session || !pmOrg) return;
    const code = normalizeProjectId(route.projectId);
    let cancelled = false;
    setHydrating(true);
    void (async () => {
      try {
        const result = await hydrateProjectFromDcs(code);
        if (cancelled || !result) return;
        if (result.inventory) {
          const normalized = normalizeInventory({
            ...result.inventory,
            lang: result.inventory.lang || lang,
            contentOrg: result.inventory.contentOrg || contentOrg,
          });
          setInventory(normalized);
          persistSessionInventory(normalized);
        }
        if (result.found) {
          updateBoard(result.board);
          setBook(code);
          const land: StepId = landingStep(result.board.teams.length > 0, Boolean(result.inventory), result.issueCount, (result.board.books?.length ?? 1) > 1);
          if (route.step === "inventario" && land !== "inventario") {
            navigate({ name: "proyecto", projectId: code, step: land });
          }
          announce(
            result.issueCount > 0
              ? tNow("app.planLoaded").replace("{n}", String(result.issueCount))
              : tNow("app.planLoadedFrom").replace("{org}", pmOrg).replace("{repo}", PM_REPO_NAME),
          );
        }
      } catch (err) {
        if (!cancelled) announce(explainError(err));
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
      setHydrating(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.name === "proyecto" ? route.projectId : "", session?.token, pmOrg, lang, hydrateProjectFromDcs]);

  /** Merge one book's inventory into the board (multi) or replace (single). */
  function ingestBookInventory(doc: InventoryDoc, land: StepId = "inventario") {
    const targetBook = inventariarBook || board.books[0] || book;
    const normalized = normalizeInventory({
      ...doc,
      book: doc.book || targetBook,
      lang: doc.lang || lang,
      contentOrg: doc.contentOrg || contentOrg,
      portions: doc.portions.map((p) => ({
        ...p,
        book: p.book || targetBook,
      })),
    });
    if (board.books.length > 1) {
      const others = (inventory?.portions || []).filter(
        (p) => (p.book || inventory?.book || "").toUpperCase() !== targetBook.toUpperCase(),
      );
      const merged = mergeInventories(
        [
          {
            book: board.projectId || book,
            lang,
            contentOrg,
            portions: others,
            articles: (inventory?.articles || []).filter(
              (a) => !normalized.articles.some((n) => n.id === a.id),
            ),
            preguntas_sin_asignar: 0,
          },
          normalized,
        ].filter((d) => d.portions.length || d.articles.length),
        board.projectId || book,
      );
      if (merged) {
        applyInventory(merged, land);
        return;
      }
    }
    applyInventory(normalized, land);
  }

  async function generate() {
    const targetBook = inventariarBook || board.books[0] || book;
    setGenerating(true);
    setJobMessage("Descargando…");
    try {
      const result = await generateInventory(
        { book: targetBook, lang, contentOrg },
        setJobMessage,
      );
      ingestBookInventory(
        result,
        board.books.length > 1 || !result.articles.length ? "inventario" : "asignar",
      );
      setJobMessage("Listo.");
    } catch (err) {
      setJobMessage("");
      announce(explainError(err));
    } finally {
      setGenerating(false);
    }
  }

  function onLoadFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed: unknown = JSON.parse(String(reader.result));
        if (!isInventoryDoc(parsed)) throw new Error(tNow("app.badInventory"));
        ingestBookInventory(normalizeInventory(parsed), "inventario");
      } catch (err) {
        announce(explainError(err));
      }
    };
    reader.readAsText(file);
  }

  async function openFromDcs() {
    if (!session || !pmOrg) {
      announce(tNow("app.signInPickOrg"));
      return;
    }
    setHydrating(true);
    try {
      const result = await hydrateProjectFromDcs(book);
      if (!result || !result.found) {
        announce(tNow("app.noSavedData"));
        return;
      }
      if (result.inventory) {
        const normalized = normalizeInventory({
          ...result.inventory,
          lang: result.inventory.lang || lang,
          contentOrg: result.inventory.contentOrg || contentOrg,
        });
        setInventory(normalized);
        persistSessionInventory(normalized);
      }
      updateBoard(result.board);
      const land: StepId = landingStep(result.board.teams.length > 0, Boolean(result.inventory), result.issueCount, (result.board.books?.length ?? 1) > 1);
      navigate({ name: "proyecto", projectId: normalizeProjectId(book), step: land });
      announce(
        result.issueCount > 0
          ? tNow("app.loaded").replace("{n}", String(result.issueCount))
          : tNow("app.loadedFrom").replace("{org}", pmOrg).replace("{repo}", PM_REPO_NAME),
      );
      setWorkspaceOpen(false);
    } catch (err) {
      announce(explainError(err));
    } finally {
      setHydrating(false);
    }
  }

  function onBookChange(next: string) {
    const code = normalizeProjectId(next);
    setBook(code);
    setInventariarBook(code);
    const cached = restoreSessionInventory();
    if (cached && (cached.book === code || cached.book === book)) {
      applyInventory(cached, projectStep === "asignar" ? "asignar" : "inventario");
      return;
    }
    setInventory(null);
    const nextBoard = loadLocalAssignments(lang, code, contentOrg, pmOrg);
    setBoard(nextBoard);
    setInventariarBook(nextBoard.books[0] || code);
  }

  /** Templates a project can start from: the organization's own first, then the ones shipped with the app. */
  function projectTemplates(): WorkflowTemplate[] {
    const own = loadLocalWorkflows().workflows;
    const ids = new Set(own.map((workflow) => workflow.id));
    return [...own, ...shippedWorkflows().filter((workflow) => !ids.has(workflow.id))];
  }

  function onCreateProject(input: CreateProjectInput) {
    const meta = resolveProjectMeta(input);
    // People take the work themselves (nobody is handed a whole chapter); whoever coordinates can turn it off.
    const base = { ...emptyAssignments(meta.projectId, lang, contentOrg, pmOrg), title: meta.title, kind: meta.kind, books: meta.books, settings: { allowSelfAssign: true } };
    // The project starts as a copy of its template: its phases, tasks and steps, and the version it was copied at.
    const template = projectTemplates().find((workflow) => workflow.id === input.workflowId);
    const doc = template ? applyWorkflowToBoard(base, template) : base;
    saveLocalAssignments(doc);
    upsertLocalProjectIndex(lang, {
      projectId: meta.projectId,
      title: meta.title,
      kind: meta.kind,
      books: meta.books,
    });
    setProjects(loadLocalProjectsIndex(lang));
    setBook(meta.projectId);
    setInventariarBook(meta.books[0] || meta.projectId);
    setBoard(doc);
    setInventory(null);
    navigate({ name: "proyecto", projectId: meta.projectId, step: "inventario" });
    announce(tNow("app.projectCreated").replace("{title}", meta.title));
    if (session && pmOrg) {
      void saveProjectsIndexToDcs(session, pmOrg, lang, loadLocalProjectsIndex(lang)).catch(() => {
        /* optional index sync */
      });
    }
  }

  /** A project that now exists in Door43 becomes the one in hand. */
  function adoptProject(started: StartedBook) {
    const { board: doc, inventory: found } = started;
    saveLocalAssignments(doc);
    upsertLocalProjectIndex(lang, { projectId: doc.projectId, title: doc.title, kind: doc.kind, books: doc.books });
    setProjects(loadLocalProjectsIndex(lang));
    setBook(doc.projectId);
    setInventariarBook(doc.projectId);
    setBoard(doc);
    setInventory(found);
    persistSessionInventory(found);
    if (session && pmOrg) {
      void saveProjectsIndexToDcs(session, pmOrg, lang, loadLocalProjectsIndex(lang)).catch(() => {
        /* optional index sync */
      });
    }
  }

  /** «Ajustar antes de crear»: the project as a draft on this device; nothing is written until it is created. */
  async function onAdjustBook(input: { book: string; workflowId: string }) {
    if (!session || !pmOrg) throw new Error(tNow("app.signInPickOrg"));
    const template = projectTemplates().find((workflow) => workflow.id === input.workflowId);
    const doc = await draftBook({ session, pmOrg, lang, contentOrg, book: input.book, template, earlierProjects: [...projects].reverse().map((project) => project.projectId) });
    saveProjectDraft(doc);
    setDraft(doc);
    navigate({ name: "proyecto-nuevo" });
  }

  /** «Empezar un libro»: everything from the process to the subtareas, then the project is the one in hand. */
  async function onStartBook(input: { book: string; workflowId: string }, onStage: (stage: StartStage, detail?: string) => void) {
    const template = projectTemplates().find((workflow) => workflow.id === input.workflowId);
    if (!session || !pmOrg || !template) throw new Error(tNow("app.signInPickOrg"));
    const started = await startBook({
      session,
      pmOrg,
      lang,
      contentOrg,
      book: input.book,
      template,
      earlierProjects: [...projects].reverse().map((project) => project.projectId),
      onStage,
    });
    const { board: doc, inventory: found } = started;
    saveLocalAssignments(doc);
    upsertLocalProjectIndex(lang, { projectId: doc.projectId, title: doc.title, kind: doc.kind, books: doc.books });
    setProjects(loadLocalProjectsIndex(lang));
    setBook(doc.projectId);
    setInventariarBook(doc.projectId);
    setBoard(doc);
    setInventory(found);
    persistSessionInventory(found);
    void saveProjectsIndexToDcs(session, pmOrg, lang, loadLocalProjectsIndex(lang)).catch(() => {
      /* optional index sync */
    });
    return started;
  }

  function onLangChange(next: string) {
    const code = normalizeLangCode(next);
    setLang(code);
    setContentOrg(defaultContentOrg(code));
    setBoard(loadLocalAssignments(code, book, defaultContentOrg(code), pmOrg));
  }

  const hasInventory = Boolean(inventory);

  const sessionExpiredAlert =
    sessionExpired && !session ? (
      <Alert className="mb-3" variant="destructive">
        <AlertDescription className="flex flex-wrap items-center gap-2">
          {t("signIn.expired")}
          <Button type="button" size="sm" onClick={() => setSignInOpen(true)}>
            {t("header.signIn")}
          </Button>
        </AlertDescription>
      </Alert>
    ) : null;

  /**
   * Work in another workspace. Before sign-in nothing is loaded, so the choice is just remembered; once signed in
   * the page reloads so nothing of the previous space (tasks, plans, caches in memory) can carry over.
   */
  function chooseWorkspace(next: Workspace) {
    if (workspace?.id === next.id) return;
    const reload = Boolean(session) && Boolean(workspace);
    saveWorkspaceId(next.id);
    saveContext({ lang: next.lang, contentOrg: next.contentOrg, pmOrg: next.pmOrg, book, host });
    if (reload) {
      window.location.hash = "#/mis-tareas";
      window.location.reload();
      return;
    }
    setActiveScope(next.scope);
    setWorkspace(next);
    setLang(next.lang);
    setContentOrg(next.contentOrg);
    setPmOrg(next.pmOrg);
    setProjects(loadLocalProjectsIndex(next.lang));
    setBoard(loadLocalAssignments(next.lang, book, next.contentOrg, next.pmOrg));
    setSetupDone(true);
  }

  const signInModal = (
    <SignInModal
      open={signInOpen}
      onClose={() => setSignInOpen(false)}
      host={host}
      onHostChange={setHost}
      session={session}
      needsReauth={needsReauth}
      sessionExpired={sessionExpired}
      onSignOut={() => {
        signOut();
        setSession(null);
      }}
      onSession={(s) => {
        if (sessionExpired) setSessionEpoch((n) => n + 1);
        setNeedsReauth(false);
        setSessionExpired(false);
        setSession(s);
      }}
    />
  );

  if (
    route.name === "solver-scripture" ||
    route.name === "solver-helps" ||
    route.name === "solver-familiarize" ||
    route.name === "solver-afinar" ||
    route.name === "solver-checklist" ||
    route.name === "solver-aval" ||
    route.name === "solver-publicar" ||
    route.name === "solver-review"
  ) {
    const onSolverClose = () => {
      const ctxEncoded =
        "ctx" in route ? route.ctx : "";
      const launched = ctxEncoded ? decodeSolverLaunchContext(ctxEncoded) : null;
      if (launched && isLabLaunch(launched)) {
        navigate({ name: "solver-lab" });
        return;
      }
      // A tool opened in its own window goes away with it; one opened in place goes back to the tasks. Closing the
      // window in the second case left the person with nothing on screen.
      if (window.opener) {
        window.close();
        return;
      }
      navigate({ name: "mis-tareas" });
    };
    return (
      <div className="app-shell app-shell--solver">
        <div className="sr-only" aria-live="polite">
          {live}
        </div>
        {sessionExpiredAlert}
        {route.name === "solver-scripture" ? (
          <ScriptureEditorView
            key={sessionEpoch}
            ctxEncoded={route.ctx}
            announce={announce}
            onClose={onSolverClose}
          />
        ) : route.name === "solver-helps" ? (
          <HelpsEditorView
            key={sessionEpoch}
            ctxEncoded={route.ctx}
            announce={announce}
            onClose={onSolverClose}
          />
        ) : route.name === "solver-publicar" ? (
          <PublishUnitView
            key={`${sessionEpoch}-${route.mode}`}
            ctxEncoded={route.ctx}
            mode={route.mode === "publicar" ? "publicar" : "comprobar"}
            aligned={route.aligned.split(",").filter(Boolean)}
            needsEndorsement={route.endorsed !== "no"}
            articles={(route.articles ?? "").split(",").filter(Boolean)}
            announce={announce}
            onClose={onSolverClose}
          />
        ) : route.name === "solver-aval" ? (
          <EndorsementView key={`${sessionEpoch}-${route.mode}`} ctxEncoded={route.ctx} mode={route.mode === "decision" ? "decision" : "reporte"} announce={announce} onClose={onSolverClose} />
        ) : route.name === "solver-checklist" ? (
          <ChecklistView
            key={`${sessionEpoch}-${route.items}-${route.text}-${route.only ?? ""}`}
            ctxEncoded={route.ctx}
            onlyLinked={route.only === "linked"}
            kind={route.items === "preguntas" || route.items === "palabras" ? route.items : "notas"}
            texts={route.text.split(",").filter((x): x is "tpl" | "tps" => x === "tpl" || x === "tps")}
            announce={announce}
            onClose={onSolverClose}
          />
        ) : route.name === "solver-afinar" && route.step === "alineacion" ? (
          <AlineacionView
            key={`${sessionEpoch}-alineacion`}
            ctxEncoded={route.ctx}
            mode={route.mode === "revisar" ? "revisar" : "alinear"}
            shared={route.mode === "ambos"}
            announce={announce}
            onClose={onSolverClose}
          />
        ) : route.name === "solver-afinar" ? (
          <AfinacionView key={`${sessionEpoch}-${route.step}`} ctxEncoded={route.ctx} step={route.step === "palabras" ? "palabras" : "notas"} announce={announce} onClose={onSolverClose} />
        ) : route.name === "solver-familiarize" ? (
          <FamiliarizeView key={sessionEpoch} ctxEncoded={route.ctx} onClose={onSolverClose} />
        ) : (
          <PortionReviewView
            key={sessionEpoch}
            ctxEncoded={route.ctx}
            mode={route.mode}
            announce={announce}
            onClose={onSolverClose}
          />
        )}
        {signInModal}
      </div>
    );
  }

  // First screen for someone who is signed out: what Taller is, which team space, and the way in.
  // Someone already signed in but not yet in any space (their saved organization matches none) is asked to choose.
  const needsSpace = Boolean(session) && !workspace && tallerConfig.workspaces.length > 0;
  if ((!session || needsSpace) && tallerConfig.workspaces.length > 0 && route.name !== "solver-lab" && route.name !== "conflicto-prueba") {
    return (
      <>
        <Welcome
          initialWorkspaceId={workspace?.id}
          signedIn={Boolean(session)}
          onEnter={(chosen) => {
            chooseWorkspace(chosen);
            if (!session) setSignInOpen(true);
          }}
        />
        {signInModal}
      </>
    );
  }

  if (!setupDone && route.name !== "solver-lab" && route.name !== "conflicto-prueba") {
    return (
      <div className="app-shell">
        <header className="app-header">
          <div className="app-header__bar">
            <div className="app-header__brand">
              <BrandMark />
            </div>
          </div>
        </header>
        <main className="app-main app-main--setup">
          <div className="sr-only" aria-live="polite">
            {live}
          </div>
          {live ? (
            <Alert className="mb-3">
              <AlertDescription>{live}</AlertDescription>
            </Alert>
          ) : null}
          {sessionExpiredAlert}
          <SetupGate
            lang={lang}
            contentOrg={contentOrg}
            languages={catalogLangs}
            orgs={knownOrgs}
            onLangChange={onLangChange}
            onContentOrgChange={setContentOrg}
            onContinue={confirmSetup}
          />
        </main>
        {signInModal}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__bar">
          <div className="app-header__brand">
            <BrandMark />
          </div>

          <AppNav
            links={
              effectiveCanManage
                ? [
                    {
                      id: "hoy",
                      label: t("nav.teamToday"),
                      active: route.name === "hoy",
                      onSelect: () => navigate({ name: "hoy" }),
                    },
                    {
                      id: "mis-tareas",
                      label: t("nav.myTasks"),
                      active: myTasksActive,
                      onSelect: () => navigate({ name: "mis-tareas" }),
                    },
                    {
                      id: "avisos",
                      label: t("nav.alerts"),
                      active: route.name === "avisos",
                      onSelect: () => navigate({ name: "avisos" }),
                    },
                    {
                      id: "proyectos",
                      label: t("nav.projects"),
                      active: route.name === "proyectos" || route.name === "proyecto" || route.name === "proyecto-nuevo",
                      onSelect: () => navigate({ name: "proyectos" }),
                    },
                    {
                      id: "glosario",
                      label: t("nav.glossary"),
                      active: route.name === "glosario",
                      onSelect: () => navigate({ name: "glosario" }),
                    },
                  ]
                : [
                    {
                      id: "mis-tareas",
                      label: t("nav.myTasks"),
                      active: myTasksActive,
                      onSelect: () => navigate({ name: "mis-tareas" }),
                    },
                    {
                      id: "avisos",
                      label: t("nav.alerts"),
                      active: route.name === "avisos",
                      onSelect: () => navigate({ name: "avisos" }),
                    },
                    {
                      id: "glosario",
                      label: t("nav.glossary"),
                      active: route.name === "glosario",
                      onSelect: () => navigate({ name: "glosario" }),
                    },
                  ]
            }
            attentionCount={attentionTotal}
            attentionLinkId="avisos"
          />

          {session ? (
            <UserMenu
              session={session}
              coordinator={effectiveCanManage}
              workspaces={workspace ? tallerConfig.workspaces : []}
              workspaceId={workspace?.id}
              onChooseWorkspace={chooseWorkspace}
              onOpenProfile={() => navigate({ name: "perfil" })}
              onOpenOrganization={() => navigate({ name: "organizacion" })}
              onOpenTemplates={() => navigate({ name: "plantillas" })}
              onOpenFromDoor43={effectiveCanManage ? () => void openFromDcs() : undefined}
              onOpenSessionSettings={workspace ? undefined : () => setWorkspaceOpen(true)}
              preview={canPreview ? { on: viewMode === "trabajador", toggle: () => setViewModeAndPersist(viewMode === "trabajador" ? "gestor" : "trabajador") } : undefined}
              onOpenQaAdmin={showQaAdmin ? () => setQaAdminOpen(true) : undefined}
              onOpenLab={import.meta.env.DEV ? () => navigate({ name: "solver-lab" }) : undefined}
              onSignOut={() => {
                signOut();
                setSession(null);
              }}
            />
          ) : (
            <button type="button" className="app-workspace" onClick={() => setSignInOpen(true)}>
              {t("header.signIn")}
            </button>
          )}
        </div>

          {route.name === "proyecto" && effectiveCanManage ? (
            <div className="app-header__project">
              <button
                type="button"
                className="app-header__back"
                onClick={() => navigate({ name: "proyectos" })}
                title={t("header.backToProjects")}
              >
                <span aria-hidden>←</span>
                <span className="app-header__back-label">
                  {projectDisplayName(route.projectId, uiLanguage)}
                </span>
              </button>
              <StepNav
                view={route.step}
                setupDone={setupDone}
                hasInventory={hasInventory}
                severalBooks={(board.books?.length ?? 1) > 1}
                onChange={goToStep}
              />
            </div>
          ) : null}
      </header>

      <main
        className={
          route.name === "conversacion" || route.name === "conflicto-prueba" ? "app-main app-main--chat" : "app-main"
        }
      >
        <div className="sr-only" aria-live="polite">
          {live}
        </div>
        {route.name === "mis-tareas" && session && onboarding.visible ? (
          <Onboarding session={session} onHide={onboarding.hide} />
        ) : null}
        {route.name !== "conversacion" && route.name !== "conflicto-prueba" && !(route.name === "mis-tareas" && onboarding.visible) ? (
          <PushPrompt session={session} />
        ) : null}
        {hydrating && route.name === "proyecto" ? (
          <Alert className="mb-3">
            <AlertDescription>{t("app.loadingProject")}</AlertDescription>
          </Alert>
        ) : null}
        {live ? (
          <Alert className="mb-3">
            <AlertDescription>{live}</AlertDescription>
          </Alert>
        ) : null}

        {sessionExpiredAlert}

        {needsReauth ? (
          <Alert className="mb-3" variant="destructive">
            <AlertDescription className="flex flex-wrap items-center gap-2">
              {t("app.needsReauth")}
              <Button type="button" size="sm" onClick={() => setSignInOpen(true)}>
                {t("app.signInAgain")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {route.name === "hoy" && session && effectiveCanManage ? (
          <TeamTodayView
            session={session}
            pmOrg={pmOrg}
            lang={lang}
            contentOrg={contentOrg}
            announce={announce}
            onOpenThread={(issue) => navigate({ name: "conversacion", issue })}
          />
        ) : null}
        {(route.name === "mis-tareas" || route.name === "avisos") && session ? (
          <MyTasksView
            mode={route.name === "mis-tareas" ? "lista" : route.name}
            session={session}
            pmOrg={pmOrg}
            lang={lang}
            contentOrg={contentOrg}
            announce={announce}
            cursor={activity.cursor}
            onMineIssues={onMineIssues}
            onAudience={activity.setAudience}
            onRefreshActivity={activity.refresh}
            decisionIssues={activity.decisionIssues}
            onMarkSeen={activity.markSeen}
            onOpenThread={(issue) => navigate({ name: "conversacion", issue })}
            mentions={mentions.rows}
            onMentionRead={mentions.markRead}
            canManage={effectiveCanManage}
          />
        ) : null}
        {route.name === "conversacion" ? (
          <ConversationView
            session={session}
            pmOrg={pmOrg}
            lang={lang}
            contentOrg={contentOrg}
            issueNumber={route.issue}
            canManage={effectiveCanManage}
            cursor={activity.cursor}
            demo={conversationDemo}
            siblings={mineIssues}
            onMarkRead={activity.markRead}
            onMarkSeen={activity.markSeen}
            onBack={() => navigate({ name: "mis-tareas" })}
            onOpenThread={(issue) => navigate({ name: "conversacion", issue })}
            onSignIn={() => setSignInOpen(true)}
            announce={announce}
          />
        ) : null}
        {route.name === "conflicto-prueba" ? (
          <ConflictSandboxView
            session={session}
            lang={lang}
            canManage={effectiveCanManage}
            cursor={activity.cursor}
            onBack={() => navigate({ name: "mis-tareas" })}
            onSignIn={() => setSignInOpen(true)}
            announce={announce}
          />
        ) : null}
        {(route.name === "mis-tareas" || route.name === "avisos") && !session ? (
          <Alert>
            <AlertDescription>
              {t("app.signInForTasks")}{" "}
              <Button type="button" size="sm" variant="link" className="px-1" onClick={() => setSignInOpen(true)}>
                {t("cv.enter")}
              </Button>{" "}
              {import.meta.env.DEV ? (
                <>
                  ·{" "}
                  <a className="chat-link" href="#/mis-tareas/prueba">
                    Probar un conflicto
                  </a>
                </>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {route.name === "proyectos" && effectiveCanManage ? (
          <ProjectsView
            lang={lang}
            languages={catalogLangs}
            projects={projects}
            currentProjectId={book}
            canManage={effectiveCanManage}
            onOpenProject={(code) => {
              onBookChange(code);
              navigate({ name: "proyecto", projectId: code, step: "inventario" });
            }}
            templates={projectTemplates().map((workflow) => ({
              id: workflow.id,
              name: localized(workflow.name, workflow.names, uiLanguage),
              description: workflow.descriptions?.[uiLanguage] ?? workflow.description,
              phases: workflow.phases.length,
              tasks: workflow.tasks.length,
            }))}
            onCreateProject={onCreateProject}
            onStartBook={session && pmOrg ? onStartBook : undefined}
            onAdjustBook={session && pmOrg ? onAdjustBook : undefined}
            draft={
              draft
                ? {
                    projectId: draft.projectId,
                    onContinue: () => navigate({ name: "proyecto-nuevo" }),
                    onDiscard: () => {
                      clearProjectDraft(lang);
                      setDraft(null);
                    },
                  }
                : undefined
            }
            phaseTeams={
              session && pmOrg
                ? {
                    loadTeams: () => loadTeamOptions({ session, pmOrg, lang }),
                    onAllowEdit: canManage ? async (team) => void (await allowPmOrgTeamToEdit(session, { ...team, units_map: team.unitsMap })) : undefined,
                    onSave: async (doc, choice) => {
                      const saved = await setTaskTeams({ session, pmOrg, board: doc, choice });
                      saveLocalAssignments(saved.board);
                      if (saved.board.projectId === board.projectId) setBoard(saved.board);
                      return saved;
                    },
                  }
                : undefined
            }
            pendingTeams={board.workflowId && projects.some((project) => project.projectId === board.projectId) ? { board, onSaved: () => undefined } : undefined}
            onOpenStep={(code, step) => {
              onBookChange(code);
              navigate({ name: "proyecto", projectId: code, step });
            }}
            onGoToTasks={() => navigate({ name: "mis-tareas" })}
            loadNextBookHint={
              session && pmOrg
                ? () => loadNextBookHint({ session, pmOrg, lang, contentOrg, projects: projects.filter((project) => project.kind === "book").map((project) => project.projectId) })
                : undefined
            }
          />
        ) : null}

        {route.name === "proyecto-nuevo" && session && effectiveCanManage && draft ? (
          <DraftProjectView
            key={draft.projectId}
            session={session}
            pmOrg={pmOrg}
            draft={draft}
            processName={(() => {
              const workflow = projectTemplates().find((row) => row.id === draft.workflowId);
              return workflow ? localized(workflow.name, workflow.names, uiLanguage) : undefined;
            })()}
            onDraft={(next) => {
              saveProjectDraft(next);
              setDraft(next);
            }}
            onDiscard={() => {
              clearProjectDraft(lang);
              setDraft(null);
              navigate({ name: "proyectos" });
            }}
            onLeave={() => navigate({ name: "proyectos" })}
            onCreated={(started) => {
              clearProjectDraft(lang);
              adoptProject(started);
            }}
            onOpenProject={(code) => {
              setDraft(null);
              onBookChange(code);
              navigate({ name: "proyecto", projectId: code, step: "avance" });
            }}
            onGoToTasks={() => {
              setDraft(null);
              navigate({ name: "mis-tareas" });
            }}
            announce={announce}
          />
        ) : null}

        {route.name === "perfil" && session ? (
          <ProfileView
            session={session}
            pmOrg={pmOrg}
            workspaceName={workspace ? workspace.name[uiLanguage] : ""}
            onSignOut={() => {
              signOut();
              setSession(null);
              navigate({ name: "mis-tareas" });
            }}
          />
        ) : null}

        {route.name === "glosario" && session ? (
          <GlossaryView
            key={`${sessionEpoch}-${route.book ?? ""}-${route.chapter ?? 0}-${route.from ?? 0}`}
            session={session}
            owner={contentOrg}
            lang={lang}
            pmOrg={pmOrg}
            canManage={effectiveCanManage}
            passage={route.book && route.chapter ? { book: route.book, chapter: route.chapter, from: route.from ?? 1, to: route.to ?? 200 } : undefined}
            announce={announce}
            onClose={() => window.history.back()}
          />
        ) : null}

        {route.name === "organizacion" && session ? (
          <OrgView
            session={session}
            pmOrg={pmOrg}
            canManage={effectiveCanManage}
            announce={announce}
            onOpenTeam={(name) => navigate({ name: "equipo", orgTeam: name })}
          />
        ) : null}

        {route.name === "plantillas" && session ? (
          <TemplatesView
            session={session}
            pmOrg={pmOrg}
            lang={lang}
            canManage={effectiveCanManage}
            announce={announce}
            focusWorkflowId={route.workflowId}
            onSelectWorkflow={(id) =>
              navigate({ name: "plantillas", workflowId: id })
            }
          />
        ) : null}

        {route.name === "equipo" && session ? (
          <TeamBoardView
            session={session}
            pmOrg={pmOrg}
            orgTeam={route.orgTeam}
            lang={lang}
            contentOrg={contentOrg}
            announce={announce}
          />
        ) : null}

        {route.name === "proyecto" && !effectiveCanManage ? (
          <Alert>
            <AlertDescription>
              {t("app.managersOnly")}
              {canManage ? t("app.switchToManager") : ""}
            </AlertDescription>
          </Alert>
        ) : null}

        {route.name === "proyecto" && effectiveCanManage && route.step === "inventario" ? (
          <BookStepView
            book={book}
            projectBooks={board.books?.length ? board.books : [book]}
            inventariarBook={inventariarBook}
            onInventariarBookChange={setInventariarBook}
            inventory={inventory}
            jobMessage={jobMessage}
            generating={generating}
            remoteBooks={remoteBooks}
            onBookChange={(code) => {
              onBookChange(code);
              navigate({ name: "proyecto", projectId: code, step: "inventario" });
            }}
            onGenerate={() => void generate()}
            onLoadFile={onLoadFile}
            onContinue={() => goToStep("tareas")}
          />
        ) : null}
        {route.name === "proyecto" && effectiveCanManage && route.step === "inventario" && inventory ? (
          <HandoffUnitsPanel
            portions={inventory.portions}
            units={board.settings?.handoffUnits}
            onChange={(units) => {
              const { handoffUnits: _previous, ...rest } = board.settings ?? {};
              updateBoard({ ...board, settings: units.length ? { ...rest, handoffUnits: units } : rest });
              announce(t("ho.changed"));
            }}
          />
        ) : null}

        {route.name === "proyecto" && effectiveCanManage && route.step === "tareas" && session && pmOrg ? (
          <ProjectPlanView key={board.projectId} session={session} pmOrg={pmOrg} board={board} inventory={inventory} onSaved={updateBoard} announce={announce} />
        ) : null}
        {route.name === "proyecto" && effectiveCanManage && route.step === "subtareas" && session && pmOrg ? (
          <ProjectWorkView
            key={board.projectId}
            session={session}
            pmOrg={pmOrg}
            board={board}
            inventory={inventory}
            onSaved={updateBoard}
            onInventory={(next) => {
              const normalized = normalizeInventory({ ...next, lang: next.lang || lang, contentOrg: next.contentOrg || contentOrg });
              setInventory(normalized);
              persistSessionInventory(normalized);
            }}
            onOpenThread={(issue) => navigate({ name: "conversacion", issue })}
            announce={announce}
          />
        ) : null}

        {route.name === "proyecto" && effectiveCanManage && route.step === "avance" ? (
          <AdvanceView
            section="tareas"
            board={board}
            inventory={inventory}
            onChange={updateBoard}
            session={session}
            pmOrg={pmOrg}
            announce={announce}
            onGoTareas={() => goToStep("tareas")}
          />
        ) : null}

        {route.name === "proyecto" && effectiveCanManage && route.step === "publicar" ? (
          <AdvanceView
            section="version"
            board={board}
            inventory={inventory}
            onChange={updateBoard}
            session={session}
            pmOrg={pmOrg}
            announce={announce}
            onGoTareas={() => goToStep("tareas")}
          />
        ) : null}

        {route.name === "solver-lab" ? (
          <SolverLabView
            username={session?.username ?? ""}
            lang={lang}
            languages={catalogLangs}
            announce={announce}
          />
        ) : null}
      </main>

      {session ? (
        <WorkspaceDialog
          open={workspaceOpen}
          onClose={() => setWorkspaceOpen(false)}
          lang={lang}
          contentOrg={contentOrg}
          languages={catalogLangs}
          pmOrg={pmOrg}
          orgs={orgs}
          knownOrgs={knownOrgs}
          session={session}
          onLangChange={onLangChange}
          onContentOrgChange={setContentOrg}
          onPmOrgChange={workspace ? () => undefined : setPmOrg}
          onSignOut={() => {
            signOut();
            setSession(null);
            setWorkspaceOpen(false);
          }}
          onOpenFromDcs={() => void openFromDcs()}
          workspaces={workspace ? tallerConfig.workspaces : undefined}
          workspaceId={workspace?.id}
          onWorkspaceChange={chooseWorkspace}
          onOpenProfile={() => {
            setWorkspaceOpen(false);
            navigate({ name: "perfil" });
          }}
        />
      ) : null}

      {session && showQaAdmin ? (
        <QaAdminDialog
          open={qaAdminOpen}
          onOpenChange={setQaAdminOpen}
          session={session}
          defaultOwner={contentOrg}
          defaultRepo={resolveResourceRepo("tpl", lang) ?? ""}
          defaultBook={book}
          defaultPmOrg={pmOrg}
        />
      ) : null}

      {session && BOTTOM_NAV_ROUTES.includes(route.name) ? (
        <BottomNav
          active={(itemsFor(effectiveCanManage) as string[]).includes(route.name) ? (route.name as BottomNavId) : null}
          attentionCount={attentionTotal}
          coordinator={effectiveCanManage}
          onSelect={(id) => navigate({ name: id })}
        />
      ) : null}

      {signInModal}
    </div>
  );
}
