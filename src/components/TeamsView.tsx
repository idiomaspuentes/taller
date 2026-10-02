import { PM_REPO_NAME } from "../domain/types";
import { useEffect, useMemo, useState } from "react";
import type { DcsOrg } from "@ip-lms/dcs-client";
import type {
  ArticleFilter,
  AssignmentGrain,
  AssignmentsDoc,
  BundleGrain,
  DistributePolicy,
  DistributeUnit,
  InventoryDoc,
  Person,
  ScopeKey,
  ScopeRule,
  ScriptureScope,
  Team,
  TeamPreset,
  Phase,
  TaskStep,
  WaitRule,
  WorkflowsCatalog,
} from "../domain/types";
import {
  DISTRIBUTE_POLICY_HELP,
  DISTRIBUTE_POLICY_LABEL,
  DISTRIBUTE_UNIT_HELP,
  DISTRIBUTE_UNIT_LABEL,
  articleFilterLabel,
  articleFilterHelp,
  assignableCountLabel,
  bundleGrainForDistributeUnit,
  citesArticlesFromPortions,
  displayResourceGrain,
  filtersForResource,
  grainChoiceLabel,
  grainHelp,
  grainsForResource,
  isArticleResource,
  isScriptureResource,
  resourceShowsFilter,
  resourceShowsGrain,
  scriptureIntro,
  stayInChapterHelp,
  SCOPE_KEYS,
  WORKFLOWS_SCHEMA,
} from "../domain/types";
import { ensurePhaseSlug, makePhase, slugifyPhase } from "../domain/phaseSlug";
import {
  articlesInGrain,
  overlappingTeams,
  resolveDistributePolicy,
  resolveDistributeUnit,
  ruleItemCount,
  scopeFromRules,
  scopeRuleLabel,
  tasksInScope,
  teamRules,
  uid,
  type ScriptureScopeContext,
} from "../domain/assignment";
import { displayRef, groupPortionsByChapter, portionKey } from "../domain/chapters";
import { parseReviewRef } from "../domain/reviewTask";
import {
  loadLocalWorkflows,
  loadTeamPresets,
  mergePeople,
  mergeTeamPresets,
  mergeWorkflowCatalogs,
  saveLocalWorkflows,
  saveTeamPresets,
} from "../domain/store";
import { formatTaskClaimSummary } from "../domain/stepClaim";
import { applyWorkflowToBoard, boardToWorkflowTemplate, upgradeBoardToWorkflow, workflowUpdateFor } from "../domain/workflows";
import { shippedWorkflows } from "../domain/processes";
import { scopeLabel } from "../domain/resourceNames";
import { filterTeamsEligibleForTask } from "../domain/teamEligibility";
import { orgOptionLabel, orgSlug } from "../domain/orgs";
import { DEFAULT_SOURCE_PACKAGE, resolveSourcePackage, sourcePackageFor, sourcePackageLang } from "../domain/sourcePackage";
import { displayOrgTeamName, isPmOrgTeamName, type TeamRepoEligibility } from "../domain/roles";
import type { GtSession } from "../dcs/auth";
import {
  listPmOrgMembers,
  listPmOrgTeams,
  listPmOrgTeamMembers,
  loadTeamPresetsFromDcs,
  loadWorkflowsFromDcs,
  saveTeamPresetsToDcs,
  saveWorkflowsToDcs,
  type DcsTeam,
} from "../dcs/persist";
import { assignOrgTeamToTask, loadPmConfig, loadSolversCatalog } from "../dcs/issues";
import { pruneWaitRules } from "../domain/waits";
import { WaitsEditor } from "./WaitsEditor";
import { MinLevelField } from "./MinLevelField";
import type { PersonLevel } from "../domain/levels";
import {
  DEFAULT_SOLVERS_CATALOG,
  solversForTaskResources,
  type SolversCatalog,
} from "../domain/solvers";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ChoiceGroup } from "@/components/ui/choice-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ChevronDown, X } from "lucide-react";
import { StepsEditor } from "./StepsEditor";
import { EveryUnitField } from "./EveryUnitField";
import { tNow, useT } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";
import { localizeName } from "../domain/templateNames";
import { PhaseTeamsPanel } from "./PhaseTeamsPanel";
import { setPhaseTeams } from "../dcs/startBook";
import { localizeScope } from "../domain/scopeNames";
import { bookLabel } from "../domain/books";
import { explainError } from "../dcs/userError";

type Props = {
  board: AssignmentsDoc;
  inventory: InventoryDoc | null;
  onChange: (next: AssignmentsDoc) => void;
  session: GtSession | null;
  pmOrg: string;
  orgs: DcsOrg[];
  onPmOrgChange: (org: string) => void;
  announce: (msg: string) => void;
  /** Deep-link: open editor for this task id (`#/proyectos/:libro/tareas/:taskId`). */
  focusTaskId?: string;
  onFocusTaskConsumed?: () => void;
  /** Keep the hash in sync when opening a task from the list. */
  onEditTask?: (taskId: string) => void;
  /** Open org Plantillas screen. */
  onOpenPlantillas?: () => void;
};

type ResourceDraft = {
  articleFilter: ArticleFilter;
  grain: AssignmentGrain;
  stayInChapter: boolean;
  includeDuplicates: boolean;
  itemIds: string;
};

type ScopeDraft = Partial<Record<ScopeKey, ResourceDraft>>;
type EditorStep = "identidad" | "alcance" | "personas";
type Packaging = "separate" | "together";

const EDITOR_STEPS: { id: EditorStep; label: "tv.stepIdentity" | "tv.stepScope" | "tv.stepPeople" }[] = [
  { id: "identidad", label: "tv.stepIdentity" },
  { id: "alcance", label: "tv.stepScope" },
  { id: "personas", label: "tv.stepPeople" },
];

function defaultGrainFor(resource: ScopeKey): AssignmentGrain {
  if (isScriptureResource(resource)) return "item";
  return isArticleResource(resource) ? "portionRefs" : "item";
}


function defaultDraft(resource: ScopeKey): ResourceDraft {
  const grain = defaultGrainFor(resource);
  const portionRefs = citesArticlesFromPortions(grain) || grain === "portionRefs";
  return {
    articleFilter: resource === "academia" && portionRefs ? "all" : "pending",
    grain,
    stayInChapter: grain === "portionRefs",
    includeDuplicates: isArticleResource(resource) && grain === "portionRefs",
    itemIds: "",
  };
}

function parseIds(value: string): string[] {
  return value
    .split(/[\s,;]+/)
    .map((id) => id.trim())
    .filter(Boolean);
}

function draftFromTeam(team: Team): {
  draft: ScopeDraft;
  chapter: string;
  portionIds: string[];
  packaging: Packaging;
  distributeUnit: DistributeUnit;
  distributePolicy: DistributePolicy;
} {
  const draft: ScopeDraft = {};
  let chapter = "";
  let portionIds: string[] = [];
  for (const rule of teamRules(team)) {
    const grain = displayResourceGrain(rule.grain ?? team.grain ?? defaultGrainFor(rule.resource));
    draft[rule.resource] = {
      articleFilter: rule.articleFilter,
      grain,
      stayInChapter:
        typeof rule.stayInChapter === "boolean"
          ? rule.stayInChapter
          : grain === "portionRefs" ||
            team.grain === "chapter" ||
            team.grain === "portionsInChapter",
      includeDuplicates:
        typeof rule.includeDuplicates === "boolean"
          ? rule.includeDuplicates
          : isArticleResource(rule.resource) &&
            (grain === "portionRefs" ||
              team.grain === "chapter" ||
              team.grain === "portionsInChapter"),
      itemIds: (
        rule.itemIds ??
        (rule.resource === "notas" || rule.resource === "preguntas" ? team.grainItemIds : undefined) ??
        []
      ).join(" "),
    };
    if (!chapter && rule.chapter) chapter = String(rule.chapter);
    if (!portionIds.length && rule.portionIds?.length) portionIds = [...rule.portionIds];
  }
  if (team.bundle?.chapter) chapter = String(team.bundle.chapter);
  else if (team.grainChapter) chapter = String(team.grainChapter);
  if (team.bundle?.portionIds?.length) portionIds = [...team.bundle.portionIds];
  else if (team.grainPortionIds?.length) portionIds = [...team.grainPortionIds];

  return {
    draft,
    chapter,
    portionIds,
    packaging: team.bundle?.enabled ? "together" : "separate",
    distributeUnit: resolveDistributeUnit(team),
    distributePolicy: resolveDistributePolicy(team),
  };
}

function resourceNeedsGeo(row: ResourceDraft): boolean {
  return row.grain === "portionRefs" || row.stayInChapter || row.grain === "portion";
}

function rulesFromDraft(
  draft: ScopeDraft,
  opts: {
    packaging: Packaging;
    sharedChapter: string;
    sharedPortionIds: string[];
  },
): ScopeRule[] {
  const bundleOn = opts.packaging === "together";
  const chapterNum = Number(opts.sharedChapter);
  return SCOPE_KEYS.filter((key) => draft[key] != null).map((resource) => {
    const row = draft[resource] as ResourceDraft;
    const ids = parseIds(row.itemIds);
    const useGeo = bundleOn || resourceNeedsGeo(row);
    return {
      resource,
      articleFilter: row.articleFilter,
      grain: row.grain,
      stayInChapter: row.stayInChapter,
      includeDuplicates: isArticleResource(resource) ? row.includeDuplicates : undefined,
      chapter: useGeo && chapterNum > 0 ? chapterNum : undefined,
      portionIds: useGeo && opts.sharedPortionIds.length ? [...opts.sharedPortionIds] : undefined,
      itemIds: ids.length ? ids : undefined,
    };
  });
}

function peopleById(people: Person[]): Map<string, Person> {
  return new Map(people.map((row) => [row.id, row]));
}

export function TeamsView({
  board,
  inventory,
  onChange,
  session,
  pmOrg,
  orgs,
  onPmOrgChange,
  announce,
  focusTaskId,
  onFocusTaskConsumed,
  onEditTask,
  onOpenPlantillas,
}: Props) {
  const t = useT();
  const language = useUiLanguage();
  const loc = (text: string) => localizeScope(text, language);
  /** What this project's process calls a resource. */
  const resName = (resource: string) => scopeLabel(resource, board.settings?.resourceNames, language, loc);
  const [personName, setPersonName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [description, setDescription] = useState("");
  const [draftPhaseId, setDraftPhaseId] = useState(
    () => board.phases[0]?.id ?? "phase-default",
  );
  const [draft, setDraft] = useState<ScopeDraft>({});
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);
  const [editingPhaseName, setEditingPhaseName] = useState("");
  const [editingPhaseSlug, setEditingPhaseSlug] = useState("");
  const [newPhaseOpen, setNewPhaseOpen] = useState(false);
  const [newPhaseName, setNewPhaseName] = useState("");
  const [newPhaseSlug, setNewPhaseSlug] = useState("");
  const [newPhaseSlugTouched, setNewPhaseSlugTouched] = useState(false);
  const [taskPhaseCreateOpen, setTaskPhaseCreateOpen] = useState(false);
  const [taskPhaseCreateName, setTaskPhaseCreateName] = useState("");
  const [draftSolverAppId, setDraftSolverAppId] = useState("");
  const [solverPickerOpen, setSolverPickerOpen] = useState(false);
  const [draftSteps, setDraftSteps] = useState<TaskStep[]>([]);
  const [draftReviewsPrincipal, setDraftReviewsPrincipal] = useState(false);
  const [draftWaits, setDraftWaits] = useState<WaitRule[]>([]);
  const [draftMinLevel, setDraftMinLevel] = useState<PersonLevel | undefined>(undefined);
  const [draftEveryUnit, setDraftEveryUnit] = useState(false);
  const [draftReviewRef, setDraftReviewRef] = useState("");
  const [workflowsCatalog, setWorkflowsCatalog] = useState<WorkflowsCatalog>(() =>
    loadLocalWorkflows(),
  );
  // A project made from a process that has a newer version now: the shipped ones first, then the organization's.
  const processUpdate = workflowUpdateFor(board, [...shippedWorkflows(), ...workflowsCatalog.workflows]);
  const [applyWorkflowId, setApplyWorkflowId] = useState("");
  const [applyBusy, setApplyBusy] = useState(false);
  const [solversCatalog, setSolversCatalog] =
    useState<SolversCatalog>(DEFAULT_SOLVERS_CATALOG);
  const [listHelpOpen, setListHelpOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [phaseMenuId, setPhaseMenuId] = useState<string | null>(null);
  const [taskMenuId, setTaskMenuId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(() => board.teams.length === 0);
  const [editorStep, setEditorStep] = useState<EditorStep>("identidad");
  const [descOpen, setDescOpen] = useState(false);
  const [addManualOpen, setAddManualOpen] = useState(false);
  const [scopeHelpOpen, setScopeHelpOpen] = useState(false);
  const [openResource, setOpenResource] = useState<ScopeKey | null>(null);
  const [presets, setPresets] = useState<TeamPreset[]>(() => loadTeamPresets());
  const [packaging, setPackaging] = useState<Packaging>("separate");
  const [distributeUnit, setDistributeUnit] = useState<DistributeUnit>("portion");
  const [distributePolicy, setDistributePolicy] = useState<DistributePolicy>("contiguous");
  const [sharedChapter, setSharedChapter] = useState("");
  const [sharedPortionIds, setSharedPortionIds] = useState<string[]>([]);
  const [scriptureMode, setScriptureMode] = useState<ScriptureScope["mode"]>("project");
  const [scopeBooks, setScopeBooks] = useState<string[]>([]);
  const [scopeBook, setScopeBook] = useState("");
  const [scopeChaptersText, setScopeChaptersText] = useState("");
  const [scopePortionIds, setScopePortionIds] = useState<string[]>([]);
  const [roster, setRoster] = useState<Person[]>([]);
  const [rosterError, setRosterError] = useState("");
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterQuery, setRosterQuery] = useState("");
  const [orgTeams, setOrgTeams] = useState<DcsTeam[]>([]);
  const [orgTeamsError, setOrgTeamsError] = useState("");
  const [orgTeamFilter, setOrgTeamFilter] = useState<string>("all");
  const [orgTeamMemberIds, setOrgTeamMemberIds] = useState<Set<string> | null>(null);
  const [orgTeamMembersLoading, setOrgTeamMembersLoading] = useState(false);
  /** Org team CRUD lives in Organización — here we only filter the roster / assign. */
  const [assignTask, setAssignTask] = useState<Team | null>(null);
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignBusyId, setAssignBusyId] = useState<number | null>(null);
  const [assignEligible, setAssignEligible] = useState<DcsTeam[]>([]);
  const [assignIneligible, setAssignIneligible] = useState<
    Array<{ team: DcsTeam; eligibility: TeamRepoEligibility }>
  >([]);
  const [assignError, setAssignError] = useState("");
  const [teamPrefix, setTeamPrefix] = useState("pm-");

  useEffect(() => {
    if (!session || !pmOrg) {
      setRosterLoading(false);
      setRoster([]);
      setOrgTeams([]);
      setOrgTeamFilter("all");
      setOrgTeamMemberIds(null);
      setSolversCatalog(DEFAULT_SOLVERS_CATALOG);
      if (!session) setRosterError("");
      setOrgTeamsError("");
      return;
    }
    let cancelled = false;
    setRosterLoading(true);
    setRosterError("");
    setOrgTeamsError("");
    void Promise.all([
      listPmOrgMembers(session, pmOrg),
      listPmOrgTeams(session, pmOrg),
      loadSolversCatalog(session, pmOrg),
    ])
      .then(([people, teams, solvers]) => {
        if (cancelled) return;
        setRoster(people);
        setOrgTeams(teams);
        setSolversCatalog(solvers);
      })
      .catch(() => {
        if (cancelled) return;
        setRosterError(tNow("tv.rosterError").replace("{org}", pmOrg));
        setOrgTeamsError(tNow("tv.orgTeamsError").replace("{org}", pmOrg));
      })
      .finally(() => {
        if (!cancelled) setRosterLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, pmOrg]);

  useEffect(() => {
    if (!session || !pmOrg || orgTeamFilter === "all") {
      setOrgTeamMemberIds(null);
      setOrgTeamMembersLoading(false);
      return;
    }
    const teamId = Number(orgTeamFilter);
    if (!Number.isFinite(teamId) || teamId <= 0) {
      setOrgTeamMemberIds(null);
      return;
    }
    let cancelled = false;
    setOrgTeamMembersLoading(true);
    void listPmOrgTeamMembers(session, teamId)
      .then((people) => {
        if (cancelled) return;
        setOrgTeamMemberIds(new Set(people.map((p) => p.id)));
      })
      .catch(() => {
        if (cancelled) return;
        setOrgTeamMemberIds(new Set());
        setOrgTeamsError(tNow("tv.membersError"));
      })
      .finally(() => {
        if (!cancelled) setOrgTeamMembersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, pmOrg, orgTeamFilter]);

  useEffect(() => {
    if (!session || !pmOrg) return;
    let cancelled = false;
    void loadTeamPresetsFromDcs(session, pmOrg).then((remote) => {
      if (cancelled || !remote) return;
      setPresets((prev) => {
        const merged = mergeTeamPresets(prev, remote);
        saveTeamPresets(merged);
        return merged;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [session, pmOrg]);

  useEffect(() => {
    if (!session || !pmOrg) {
      setWorkflowsCatalog(loadLocalWorkflows());
      return;
    }
    let cancelled = false;
    void loadWorkflowsFromDcs(session, pmOrg).then((remote) => {
      if (cancelled) return;
      const local = loadLocalWorkflows();
      const merged = remote ? mergeWorkflowCatalogs(local, remote) : local;
      saveLocalWorkflows(merged);
      setWorkflowsCatalog(merged);
      if (!applyWorkflowId && merged.workflows[0]) {
        setApplyWorkflowId(merged.workflows[0].id);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [session, pmOrg]);

  const rosterMap = useMemo(() => peopleById(roster), [roster]);

  const eligibleSolvers = useMemo(() => {
    const resources = SCOPE_KEYS.filter((k) => draft[k] != null);
    const list = solversForTaskResources(
      solversCatalog,
      resources.length ? resources : [],
    );
    // Keep the currently selected app visible even if filter would hide it.
    if (draftSolverAppId && !list.some((a) => a.id === draftSolverAppId)) {
      const current = solversCatalog.solvers.find((a) => a.id === draftSolverAppId);
      if (current) return [current, ...list];
    }
    return list;
  }, [solversCatalog, draft, draftSolverAppId]);

  const localMap = useMemo(() => peopleById(board.people), [board.people]);

  const selectable = useMemo(() => {
    const merged = mergePeople(board.people, roster);
    const q = rosterQuery.trim().toLocaleLowerCase("es");
    return merged.filter((p) => {
      if (orgTeamMemberIds && !orgTeamMemberIds.has(p.id)) return false;
      if (!q) return true;
      return (
        p.name.toLocaleLowerCase("es").includes(q) || p.id.toLocaleLowerCase("es").includes(q)
      );
    });
  }, [board.people, roster, rosterQuery, orgTeamMemberIds]);

  const addedResources = SCOPE_KEYS.filter((key) => draft[key] != null);
  const availableResources = SCOPE_KEYS.filter((key) => draft[key] == null);
  const canBundle = addedResources.length >= 2;

  useEffect(() => {
    if (!canBundle && packaging !== "separate") {
      setPackaging("separate");
    }
  }, [canBundle, packaging]);

  const projectBooks = board.books?.length ? board.books : [board.book];
  const scopeCtx: ScriptureScopeContext = {
    projectBooks,
    fallbackBook: projectBooks[0] || board.book,
    handoffUnits: board.settings?.handoffUnits,
  };

  function buildScriptureScope(): ScriptureScope | undefined {
    if (scriptureMode === "project") return { mode: "project" };
    if (scriptureMode === "books") {
      const books = scopeBooks.length ? scopeBooks : projectBooks;
      return books.length ? { mode: "books", books } : { mode: "project" };
    }
    const book = scopeBook || projectBooks[0] || board.book;
    if (scriptureMode === "chapters") {
      const chapters = scopeChaptersText
        .split(/[\s,;]+/)
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n > 0);
      return chapters.length ? { mode: "chapters", book, chapters } : { mode: "project" };
    }
    return scopePortionIds.length
      ? { mode: "portions", book, portionIds: [...scopePortionIds] }
      : { mode: "project" };
  }

  const effectivePackaging: Packaging = canBundle ? packaging : "separate";
  const bundleOn = effectivePackaging === "together";
  const bundleGrain: BundleGrain = bundleGrainForDistributeUnit(distributeUnit);
  const rules = rulesFromDraft(draft, {
    packaging: effectivePackaging,
    sharedChapter,
    sharedPortionIds,
  });
  const chapterNum = Number(sharedChapter);
  const draftScriptureScope = buildScriptureScope();
  const draftTeam: Team = {
    id: editingId || "draft",
    name: teamName || "borrador",
    description,
    phaseId: board.phases[0]?.id ?? "phase-default",
    memberIds,
    rules,
    scope: scopeFromRules(rules),
    scriptureScope: draftScriptureScope,
    distributeUnit,
    distributePolicy,
    bundle: bundleOn
      ? {
          enabled: true,
          grain: bundleGrain,
          chapter: chapterNum > 0 ? chapterNum : undefined,
          portionIds: sharedPortionIds.length ? sharedPortionIds : undefined,
        }
      : { enabled: false, grain: bundleGrain },
  };
  const draftNotes = inventory ? tasksInScope(draftTeam, inventory.portions, scopeCtx).length : 0;
  const draftCited = inventory
    ? articlesInGrain(draftTeam, inventory.portions, inventory.articles, scopeCtx)
    : [];
  const draftCitedRepeat = draftCited.filter((row) => !row.firstSeenInBook).length;
  const inventoryChapters = inventory ? groupPortionsByChapter(inventory.portions) : [];
  const showSharedAmbit =
    bundleOn || addedResources.some((key) => resourceNeedsGeo(draft[key] as ResourceDraft));
  const geoPortions =
    inventory && chapterNum > 0
      ? inventory.portions.filter((portion) => portion.chapter === chapterNum)
      : [];
  const multiBook = projectBooks.length > 1;
  const showScripturePicker = multiBook || board.kind === "thematic" || scriptureMode !== "project";
  const scopeBookPortions =
    inventory && (scopeBook || projectBooks[0])
      ? inventory.portions.filter((p) => {
          const code = (p.book || projectBooks[0] || "").toUpperCase();
          const want = (scopeBook || projectBooks[0] || "").toUpperCase();
          return !p.book || code === want;
        })
      : [];

  function addPerson() {
    const name = personName.trim();
    if (!name) return;
    if (board.people.some((p) => p.name.toLocaleLowerCase("es") === name.toLocaleLowerCase("es"))) {
      return;
    }
    const person: Person = { id: uid(), name };
    onChange({ ...board, people: [...board.people, person] });
    setPersonName("");
    setMemberIds((prev) => [...prev, person.id]);
  }

  function removePerson(id: string) {
    onChange({
      ...board,
      people: board.people.filter((p) => p.id !== id),
      teams: board.teams.map((t) => ({
        ...t,
        memberIds: t.memberIds.filter((m) => m !== id),
      })),
      assignments: board.assignments.filter((a) => a.personId !== id),
    });
    setMemberIds((prev) => prev.filter((m) => m !== id));
  }

  function toggleMember(person: Person) {
    setMemberIds((prev) =>
      prev.includes(person.id) ? prev.filter((m) => m !== person.id) : [...prev, person.id],
    );
  }

  function selectAllFiltered() {
    setMemberIds((prev) => {
      const next = new Set(prev);
      for (const p of selectable) next.add(p.id);
      return [...next];
    });
  }

  async function refreshOrgTeams() {
    if (!session || !pmOrg) return;
    try {
      const teams = await listPmOrgTeams(session, pmOrg);
      setOrgTeams(teams);
      setOrgTeamsError("");
    } catch {
      setOrgTeamsError(t("tv.orgTeamsError").replace("{org}", pmOrg));
    }
  }

  function toggleResource(resource: ScopeKey) {
    setDraft((prev) => {
      if (prev[resource] != null) {
        const next = { ...prev };
        delete next[resource];
        if (openResource === resource) setOpenResource(null);
        return next;
      }
      setOpenResource(resource);
      return { ...prev, [resource]: defaultDraft(resource) };
    });
  }

  function patchResource(resource: ScopeKey, patch: Partial<ResourceDraft>) {
    setDraft((prev) => {
      const current = prev[resource];
      if (!current) return prev;
      const next = { ...current, ...patch };
      if (patch.grain) {
        const portionRefs = patch.grain === "portionRefs";
        if (portionRefs) {
          next.stayInChapter = true;
          if (isArticleResource(resource)) {
            next.includeDuplicates = true;
            if (current.articleFilter === "pending") next.articleFilter = "all";
          }
        } else if (patch.grain === "item") {
          next.includeDuplicates = false;
        }
      }
      return { ...prev, [resource]: next };
    });
  }

  function resetForm() {
    setTeamName("");
    setDescription("");
    setDraftPhaseId(board.phases[0]?.id ?? "phase-default");
    setMemberIds([]);
    setDraft({});
    setEditingId(null);
    setDraftSolverAppId("");
    setSolverPickerOpen(false);
    setDraftSteps([]);
    setDraftWaits([]);
    setDraftMinLevel(undefined);
    setDraftEveryUnit(false);
    setDraftReviewsPrincipal(false);
    setDraftReviewRef("");
    setPackaging("separate");
    setDistributeUnit("portion");
    setDistributePolicy("contiguous");
    setSharedChapter("");
    setSharedPortionIds([]);
    setScriptureMode("project");
    setScopeBooks([]);
    setScopeBook("");
    setScopeChaptersText("");
    setScopePortionIds([]);
    setFormOpen(false);
    setDescOpen(false);
    setEditorStep("identidad");
    setOpenResource(null);
    if (focusTaskId) onFocusTaskConsumed?.();
  }

  function applySelectedWorkflow() {
    const wf = workflowsCatalog.workflows.find((w) => w.id === applyWorkflowId);
    if (!wf) {
      announce(t("tv.pickWorkflow"));
      return;
    }
    if (board.teams.length) {
      const ok = window.confirm(t("tv.confirmReplace"));
      if (!ok) return;
    }
    setApplyBusy(true);
    try {
      const next = applyWorkflowToBoard(board, wf);
      onChange(next);
      announce(t("tv.workflowApplied").replace("{name}", wf.name));
    } finally {
      setApplyBusy(false);
    }
  }

  async function saveBoardAsWorkflow() {
    if (!board.teams.length) {
      announce(t("tv.noTasksToSave"));
      return;
    }
    const name =
      window.prompt(t("tv.promptWorkflowName"), t("tv.flowDefault").replace("{title}", board.title || board.projectId)) ||
      "";
    if (!name.trim()) return;
    setApplyBusy(true);
    try {
      const wf = boardToWorkflowTemplate(board, { name: name.trim() });
      const next: WorkflowsCatalog = {
        schema: WORKFLOWS_SCHEMA,
        workflows: [...workflowsCatalog.workflows.filter((w) => w.id !== wf.id), wf],
      };
      saveLocalWorkflows(next);
      setWorkflowsCatalog(next);
      if (session && pmOrg) await saveWorkflowsToDcs(session, pmOrg, next);
      setApplyWorkflowId(wf.id);
      announce(
        session && pmOrg
          ? t("tv.workflowSavedOrg").replace("{name}", wf.name).replace("{org}", pmOrg).replace("{repo}", PM_REPO_NAME)
          : t("tv.savedLocal").replace("{name}", wf.name),
      );
    } catch (err) {
      announce(explainError(err));
    } finally {
      setApplyBusy(false);
    }
  }

  function applyPreset(preset: TeamPreset) {
    const next: ScopeDraft = {};
    for (const rule of preset.rules) {
      const grain = rule.grain ?? defaultGrainFor(rule.resource);
      next[rule.resource] = {
        articleFilter: rule.articleFilter,
        grain,
        stayInChapter: rule.stayInChapter ?? grain === "portionRefs",
        includeDuplicates: rule.includeDuplicates ?? false,
        itemIds: "",
      };
    }
    setDraft(next);
    setPackaging(preset.bundle?.enabled ? "together" : "separate");
    const unit = resolveDistributeUnit({
      id: "preset",
      name: preset.name,
      description: "",
      phaseId: "phase-default",
      memberIds: [],
      scope: [],
      rules: preset.rules,
      bundle: preset.bundle
        ? { enabled: Boolean(preset.bundle.enabled), grain: preset.bundle.grain }
        : undefined,
      distributeUnit: preset.distributeUnit,
      distributePolicy: preset.distributePolicy,
    });
    setDistributeUnit(unit);
    setDistributePolicy(
      resolveDistributePolicy({
        id: "preset",
        name: preset.name,
        description: "",
        phaseId: "phase-default",
        memberIds: [],
        scope: [],
        rules: preset.rules,
        distributeUnit: preset.distributeUnit ?? unit,
        distributePolicy: preset.distributePolicy,
      }),
    );
    setSharedChapter("");
    setSharedPortionIds([]);
    setTeamName(preset.name);
    setDescription(preset.description ?? "");
    setDescOpen(Boolean(preset.description?.trim()));
    setFormOpen(true);
    setEditorStep("alcance");
    setOpenResource(SCOPE_KEYS.find((k) => next[k] != null) ?? null);
  }

  async function syncPresets(next: TeamPreset[]) {
    saveTeamPresets(next);
    if (!session || !pmOrg) return;
    try {
      await saveTeamPresetsToDcs(session, pmOrg, next);
    } catch (err) {
      announce(explainError(err));
    }
  }

  function saveAsPreset() {
    const name = teamName.trim();
    const cleanRules = rulesFromDraft(draft, {
      packaging: effectivePackaging,
      sharedChapter: "",
      sharedPortionIds: [],
    }).map((rule) => ({
      ...rule,
      chapter: undefined,
      portionIds: undefined,
      itemIds: undefined,
    }));
    if (!name || !cleanRules.length) return;
    const preset: TeamPreset = {
      id: uid(),
      name,
      description: description.trim() || undefined,
      rules: cleanRules,
      bundle: { enabled: bundleOn, grain: bundleGrain },
      distributeUnit,
      distributePolicy,
    };
    const withoutSameName = presets.filter(
      (p) => p.name.toLocaleLowerCase("es") !== name.toLocaleLowerCase("es"),
    );
    const next = [...withoutSameName, preset];
    setPresets(next);
    void syncPresets(next);
    announce(
      session && pmOrg
        ? t("tv.presetSavedOrg").replace("{name}", name).replace("{org}", pmOrg)
        : t("tv.savedLocal").replace("{name}", name),
    );
  }

  function removePreset(id: string) {
    const next = presets.filter((p) => p.id !== id);
    setPresets(next);
    void syncPresets(next);
  }

  function saveTeam() {
    const name = teamName.trim();
    const cleanRules = rulesFromDraft(draft, {
      packaging: effectivePackaging,
      sharedChapter,
      sharedPortionIds,
    });
    if (!name || !cleanRules.length) return;
    const selectedPeople = memberIds
      .map((id) => rosterMap.get(id) ?? localMap.get(id))
      .filter((row): row is Person => Boolean(row));
    const people = mergePeople(board.people, selectedPeople);
    const teamFields: Omit<Team, "id"> = {
      name,
      description: description.trim(),
      phaseId:
        board.phases.some((p) => p.id === draftPhaseId)
          ? draftPhaseId
          : board.phases[0]?.id ?? "phase-default",
      memberIds: [...memberIds],
      rules: cleanRules,
      scope: scopeFromRules(cleanRules),
      scriptureScope: buildScriptureScope(),
      distributeUnit,
      distributePolicy,
      bundle: {
        enabled: bundleOn,
        grain: bundleGrain,
        chapter: bundleOn && chapterNum > 0 ? chapterNum : undefined,
        portionIds: bundleOn && sharedPortionIds.length ? [...sharedPortionIds] : undefined,
      },
      solverAppId: draftSolverAppId.trim() || undefined,
      steps: draftSteps.length
        ? draftSteps
            .map((s) => ({
              ...s,
              name: s.name.trim(),
              solverAppId: s.solverAppId?.trim() || undefined,
            }))
            .filter((s) => s.name)
        : undefined,
      waitsFor: pruneWaitRules({ id: editingId ?? "", waitsFor: draftWaits } as Team, board),
      minLevel: draftMinLevel,
      everyUnit: draftEveryUnit || undefined,
      reviewsPrincipal: draftReviewsPrincipal || undefined,
      reviewRef: draftReviewsPrincipal ? draftReviewRef.trim() || undefined : undefined,
    };
    if (editingId) {
      onChange({
        ...board,
        people,
        teams: board.teams.map((t) =>
          t.id === editingId
            ? {
                ...t,
                ...teamFields,
                reviewAssigneeId: draftReviewsPrincipal ? t.reviewAssigneeId : undefined,
                grain: undefined,
                grainChapter: undefined,
                grainPortionIds: undefined,
                grainItemIds: undefined,
              }
            : t,
        ),
      });
    } else {
      const team: Team = { id: uid(), ...teamFields };
      onChange({
        ...board,
        people,
        teams: [...board.teams, team],
        activeTeamId: board.activeTeamId || team.id,
      });
    }
    resetForm();
  }

  function startEdit(team: Team, syncUrl = true) {
    const loaded = draftFromTeam(team);
    setFormOpen(true);
    setEditingId(team.id);
    setTeamName(team.name);
    setDescription(team.description ?? "");
    setDraftPhaseId(team.phaseId || board.phases[0]?.id || "phase-default");
    setDescOpen(Boolean(team.description?.trim()));
    setMemberIds([...team.memberIds]);
    setDraftSolverAppId(team.solverAppId ?? "");
    setSolverPickerOpen(Boolean(team.solverAppId));
    setDraftSteps(team.steps?.length ? structuredClone(team.steps) : []);
    setDraftWaits(team.waitsFor?.length ? structuredClone(team.waitsFor) : []);
    setDraftMinLevel(team.minLevel);
    setDraftEveryUnit(Boolean(team.everyUnit));
    setDraftReviewsPrincipal(Boolean(team.reviewsPrincipal));
    setDraftReviewRef(team.reviewRef ?? "");
    setDraft(loaded.draft);
    setPackaging(loaded.packaging);
    setDistributeUnit(loaded.distributeUnit);
    setDistributePolicy(loaded.distributePolicy);
    setSharedChapter(loaded.chapter);
    setSharedPortionIds(loaded.portionIds);
    const ss = team.scriptureScope ?? { mode: "project" as const };
    setScriptureMode(ss.mode);
    setScopeBooks(ss.mode === "books" ? [...ss.books] : []);
    setScopeBook(
      ss.mode === "chapters" || ss.mode === "portions"
        ? ss.book
        : projectBooks[0] || board.book,
    );
    setScopeChaptersText(ss.mode === "chapters" ? ss.chapters.join(", ") : "");
    setScopePortionIds(ss.mode === "portions" ? [...ss.portionIds] : []);
    setEditorStep("identidad");
    setOpenResource(SCOPE_KEYS.find((k) => loaded.draft[k] != null) ?? null);
    if (syncUrl) onEditTask?.(team.id);
  }

  useEffect(() => {
    if (!focusTaskId) return;
    const team = board.teams.find((t) => t.id === focusTaskId);
    if (team) {
      if (editingId !== team.id) startEdit(team, false);
      return;
    }
    announce(tNow("tv.taskNotFound").replace("{id}", focusTaskId));
    onFocusTaskConsumed?.();
    // Only react to deep-link id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTaskId]);

  function removeTeam(id: string) {
    onChange({
      ...board,
      teams: board.teams.filter((t) => t.id !== id),
      activeTeamId: board.activeTeamId === id ? "" : board.activeTeamId,
      assignments: board.assignments.filter((a) => a.teamId !== id),
    });
    if (editingId === id) resetForm();
  }

  async function openAssignOrgTeam(team: Team) {
    if (!session || !pmOrg) {
      announce(t("tv.signInToAssign"));
      return;
    }
    setAssignTask(team);
    setAssignError("");
    setAssignEligible([]);
    setAssignIneligible([]);
    setAssignLoading(true);
    try {
      const config = await loadPmConfig(session, pmOrg);
      setTeamPrefix(config.teamPrefix);
      let teams = orgTeams;
      if (!teams.length) {
        teams = await listPmOrgTeams(session, pmOrg);
        setOrgTeams(teams);
      }
      const pmTeams = teams.filter((t) => isPmOrgTeamName(t.name, config.teamPrefix));
      const { eligible, ineligible } = await filterTeamsEligibleForTask({
        session,
        org: pmOrg,
        lang: board.lang,
        task: team,
        orgTeams: pmTeams,
        pmConfig: config,
      });
      setAssignEligible(eligible);
      setAssignIneligible(ineligible);
    } catch (err) {
      setAssignError(explainError(err));
    } finally {
      setAssignLoading(false);
    }
  }

  async function confirmAssignOrgTeam(orgTeam: DcsTeam, grantMissingRepos: boolean) {
    if (!session || !pmOrg || !assignTask) return;
    setAssignBusyId(orgTeam.id);
    setAssignError("");
    try {
      const { task: next, warnings, memberLogins } = await assignOrgTeamToTask({
        session,
        org: pmOrg,
        lang: board.lang,
        task: assignTask,
        orgTeam,
        grantMissingRepos,
        pullMembers: true,
      });
      const people = mergePeople(
        board.people,
        memberLogins.map((login) => ({ id: login, name: login })),
      );
      onChange({
        ...board,
        people,
        teams: board.teams.map((t) => (t.id === assignTask.id ? next : t)),
      });
      announce(
        warnings.length
          ? t("tv.teamWarn").replace("{team}", orgTeam.name).replace("{warnings}", warnings.join(" · "))
          : t("tv.taskAssigned").replace("{task}", assignTask.name).replace("{team}", orgTeam.name),
      );
      setAssignTask(null);
      await refreshOrgTeams();
    } catch (err) {
      setAssignError(explainError(err));
    } finally {
      setAssignBusyId(null);
    }
  }

  function clearOrgTeam(team: Team) {
    onChange({
      ...board,
      teams: board.teams.map((t) =>
        t.id === team.id ? { ...t, orgTeamId: undefined, orgTeamName: undefined } : t,
      ),
    });
    announce(t("tv.teamRemoved").replace("{task}", team.name));
  }

  function sortedPhases(): Phase[] {
    return [...board.phases].sort(
      (a, b) => a.order - b.order || a.name.localeCompare(b.name, "es"),
    );
  }

  function addPhase(name?: string) {
    const label = (name ?? newPhaseName).trim() || `Fase ${board.phases.length + 1}`;
    const maxOrder = board.phases.reduce((m, p) => Math.max(m, p.order), -1);
    const slugSource = name ? undefined : newPhaseSlugTouched ? newPhaseSlug : undefined;
    const phase = makePhase({
      id: `phase-${uid()}`,
      name: label,
      slug: slugSource,
      order: maxOrder + 1,
    });
    onChange({ ...board, phases: [...board.phases, phase] });
    setNewPhaseName("");
    setNewPhaseSlug("");
    setNewPhaseSlugTouched(false);
    setNewPhaseOpen(false);
    setTaskPhaseCreateName("");
    setTaskPhaseCreateOpen(false);
    setDraftPhaseId(phase.id);
    announce(t("tv.phaseCreated").replace("{name}", phase.name));
  }

  function commitTaskPhaseCreate() {
    const name = taskPhaseCreateName.trim();
    if (!name) return;
    addPhase(name);
  }

  function commitRenamePhase() {
    if (!editingPhaseId) return;
    const name = editingPhaseName.trim();
    if (!name) {
      setEditingPhaseId(null);
      return;
    }
    const current = board.phases.find((p) => p.id === editingPhaseId);
    onChange({
      ...board,
      phases: board.phases.map((p) =>
        p.id === editingPhaseId
          ? {
              ...p,
              name,
              slug:
                slugifyPhase(editingPhaseSlug) ||
                ensurePhaseSlug({ ...p, name, slug: current?.slug }),
            }
          : p,
      ),
    });
    setEditingPhaseId(null);
  }

  function movePhase(id: string, dir: -1 | 1) {
    const phases = sortedPhases();
    const i = phases.findIndex((p) => p.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= phases.length) return;
    const next = [...phases];
    const tmp = next[i];
    next[i] = next[j];
    next[j] = tmp;
    onChange({
      ...board,
      phases: next.map((p, order) => ({ ...p, order })),
    });
  }

  function removePhase(id: string) {
    if (board.phases.length <= 1) {
      announce(t("tv.keepOnePhase"));
      return;
    }
    const fallback = sortedPhases().find((p) => p.id !== id);
    if (!fallback) return;
    const moved = board.teams.filter((t) => t.phaseId === id).length;
    const releaseProfiles = board.settings?.releaseProfiles?.map((p) => ({
      ...p,
      requiredPhaseIds: p.requiredPhaseIds.filter((phaseId) => phaseId !== id),
    }));
    onChange({
      ...board,
      settings: releaseProfiles ? { ...board.settings, releaseProfiles } : board.settings,
      phases: board.phases.filter((p) => p.id !== id),
      teams: board.teams.map((t) =>
        t.phaseId === id ? { ...t, phaseId: fallback.id } : t,
      ),
    });
    if (draftPhaseId === id) setDraftPhaseId(fallback.id);
    announce(
      moved
        ? t("tv.phaseDeletedMoved").replace("{n}", String(moved)).replace("{to}", fallback.name)
        : t("tv.phaseDeleted"),
    );
  }

  function openNewInPhase(phaseId: string) {
    resetForm();
    setDraftPhaseId(phaseId);
    setFormOpen(true);
    setEditorStep("identidad");
  }

  function openNew() {
    resetForm();
    setFormOpen(true);
    setEditorStep("identidad");
  }

  const canSave = Boolean(teamName.trim() && rules.length);
  const stepIndex = EDITOR_STEPS.findIndex((s) => s.id === editorStep);

  function goNextStep() {
    if (editorStep === "identidad") setEditorStep("alcance");
    else if (editorStep === "alcance") setEditorStep("personas");
  }

  function goPrevStep() {
    if (editorStep === "personas") setEditorStep("alcance");
    else if (editorStep === "alcance") setEditorStep("identidad");
  }

  if (formOpen) {
    return (
      <div className="grid gap-3">
        <Card size="sm">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>{editingId ? t("tv.editTask") : t("tv.newTask")}</CardTitle>
              <CardDescription>{t("tv.threeSteps")}</CardDescription>
            </div>
            <div className="flex flex-wrap gap-1">
              {EDITOR_STEPS.map((step, i) => (
                <Button
                  key={step.id}
                  type="button"
                  size="sm"
                  variant={editorStep === step.id ? "default" : "outline"}
                  className="rounded-full"
                  onClick={() => setEditorStep(step.id)}
                >
                  <span className="text-[0.65rem] font-semibold opacity-70">{i + 1}</span>
                  {t(step.label)}
                </Button>
              ))}
            </div>
          </CardHeader>

          <CardContent className="grid gap-3 pb-20">
            {editorStep === "identidad" ? (
              <>
                {!editingId && presets.length ? (
                  <div className="grid gap-1.5 rounded-lg border border-dashed p-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("tv.startFromTemplate")}
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {presets.map((preset) => (
                        <div
                          key={preset.id}
                          className="inline-flex items-center gap-1 rounded-full border bg-card py-1 pl-2.5 pr-1 text-xs"
                        >
                          <button
                            type="button"
                            className="font-medium hover:underline"
                            onClick={() => applyPreset(preset)}
                            title={preset.rules.map((r) => loc(scopeRuleLabel(r, r.grain))).join(" · ")}
                          >
                            {preset.name}
                          </button>
                          <button
                            type="button"
                            aria-label={t("tv.deleteTemplateAria").replace("{name}", preset.name)}
                            className="rounded-full p-0.5 text-muted-foreground hover:text-destructive"
                            onClick={() => removePreset(preset.id)}
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="grid gap-1.5">
                  <Label htmlFor="team-name">{t("tv.name")}</Label>
                  <Input
                    id="team-name"
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    placeholder={t("tv.namePlaceholder")}
                    aria-label={t("tv.taskNameAria")}
                  />
                </div>
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="task-phase">{t("tv.phase")}</Label>
                    {!taskPhaseCreateOpen ? (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setTaskPhaseCreateOpen(true)}
                      >
                        {t("tv.newPhaseLink")}
                      </button>
                    ) : null}
                  </div>
                  {taskPhaseCreateOpen ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        id="task-phase-new"
                        value={taskPhaseCreateName}
                        onChange={(e) => setTaskPhaseCreateName(e.target.value)}
                        placeholder={t("tv.phasePlaceholder")}
                        aria-label={t("tv.newPhaseAria")}
                        className="min-w-[12rem] flex-1"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitTaskPhaseCreate();
                          }
                          if (e.key === "Escape") {
                            setTaskPhaseCreateOpen(false);
                            setTaskPhaseCreateName("");
                          }
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        disabled={!taskPhaseCreateName.trim()}
                        onClick={commitTaskPhaseCreate}
                      >
                        {t("tv.add")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setTaskPhaseCreateOpen(false);
                          setTaskPhaseCreateName("");
                        }}
                      >
                        {t("tv.cancel")}
                      </Button>
                    </div>
                  ) : (
                    <Select value={draftPhaseId} onValueChange={setDraftPhaseId}>
                      <SelectTrigger id="task-phase" className="w-full" aria-label={t("tv.phase")}>
                        <SelectValue placeholder={t("tv.pickPhase")} />
                      </SelectTrigger>
                      <SelectContent>
                        {[...board.phases]
                          .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "es"))
                          .map((phase) => (
                            <SelectItem key={phase.id} value={phase.id}>
                              {phase.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <label className="flex items-start gap-2 text-sm leading-snug">
                  <Checkbox
                    checked={draftReviewsPrincipal}
                    onCheckedChange={(checked) => setDraftReviewsPrincipal(checked === true)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">
                      {t("tv.reviewsMain")}
                    </span>
                    <span className="mt-0.5 block text-muted-foreground">
                      {t("tv.reviewsMainHelp")}
                    </span>
                  </span>
                </label>
                {draftReviewsPrincipal ? (
                  <div className="grid gap-1.5 pl-6">
                    <Label htmlFor="task-review-ref">{t("tv.reviewRefLabel")}</Label>
                    <Input
                      id="task-review-ref"
                      value={draftReviewRef}
                      placeholder={t("tv.reviewRefPlaceholder").replace(/\{b\}/g, projectBooks[0] || "NEH")}
                      list="task-review-ref-portions"
                      onChange={(e) => setDraftReviewRef(e.target.value)}
                      aria-describedby="task-review-ref-help"
                    />
                    <datalist id="task-review-ref-portions">
                      {(inventory?.portions ?? []).map((p) => (
                        <option
                          key={portionKey(p)}
                          value={displayRef((p.book || projectBooks[0] || "").toUpperCase(), p.ref)}
                        />
                      ))}
                    </datalist>
                    <p id="task-review-ref-help" className="text-xs text-muted-foreground">
                      {draftReviewRef.trim()
                        ? (() => {
                            const parsed = parseReviewRef(draftReviewRef, projectBooks);
                            if (!parsed.ok) return parsed.reason;
                            return parsed.range.to > parsed.range.from
                              ? t("tv.reviewedRange").replace("{d}", parsed.display)
                              : t("tv.reviewedOne").replace("{d}", parsed.display);
                          })()
                        : t("tv.reviewRefHelp")}
                    </p>
                  </div>
                ) : null}
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="task-solver">{t("tv.solverLabel")}</Label>
                    {solverPickerOpen || draftSolverAppId ? (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setDraftSolverAppId("");
                          setSolverPickerOpen(false);
                        }}
                      >
                        {t("tv.remove")}
                      </button>
                    ) : null}
                  </div>
                  {solverPickerOpen || draftSolverAppId ? (
                    solversCatalog.solvers.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {t("tv.noSolversA")}
                        <code className="font-mono">solvers.json</code>
                        {t("tv.noSolversB")}
                      </p>
                    ) : (
                      <Select
                        value={draftSolverAppId || "none"}
                        onValueChange={(v) => setDraftSolverAppId(v === "none" ? "" : v)}
                      >
                        <SelectTrigger id="task-solver" className="w-full" aria-label={t("tv.toolAria")}>
                          <SelectValue placeholder={t("tv.pickTool")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t("tv.none")}</SelectItem>
                          {eligibleSolvers.map((app) => (
                            <SelectItem key={app.id} value={app.id}>
                              {app.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )
                  ) : (
                    <button
                      type="button"
                      className="justify-self-start text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setSolverPickerOpen(true)}
                    >
                      {t("tv.addSolver")}
                    </button>
                  )}
                  {draftSolverAppId && eligibleSolvers.every((a) => a.id !== draftSolverAppId) ? (
                    <p className="text-xs text-muted-foreground">
                      {t("tv.toolMismatch")}
                    </p>
                  ) : null}
                </div>
                <WaitsEditor board={board} taskId={editingId} value={draftWaits} onChange={setDraftWaits} />
                <MinLevelField id="task-min-level" value={draftMinLevel} onChange={setDraftMinLevel} />
                <EveryUnitField value={draftEveryUnit} onChange={setDraftEveryUnit} />
                <div className="grid gap-2">
                  <Label>{t("tv.stepsTitle")}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t("tv.stepsHelp")}
                  </p>
                  <StepsEditor steps={draftSteps} onChange={setDraftSteps} tools={solversCatalog.solvers} />
                </div>
                {descOpen ? (
                  <div className="grid gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="team-desc">{t("tv.description")}</Label>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setDescription("");
                          setDescOpen(false);
                        }}
                      >
                        {t("tv.remove")}
                      </button>
                    </div>
                    <textarea
                      id="team-desc"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={t("tv.descPlaceholder")}
                      aria-label={t("tv.descAria")}
                      rows={2}
                      autoFocus
                      className="min-h-16 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    className="justify-self-start text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setDescOpen(true)}
                  >
                    {t("tv.addDescription")}
                  </button>
                )}
              </>
            ) : null}

            {editorStep === "alcance" ? (
              <>
                <div className="grid gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("tv.scriptureScope")}
                  </h3>
                  {!showScripturePicker && board.kind === "book" ? (
                    <div className="grid gap-2 rounded-lg border p-2">
                      <p className="text-xs text-muted-foreground">
                        {t("tv.defaultAll").replace("{book}", bookLabel(projectBooks[0] || board.book, language))}
                      </p>
                      <Select
                        value={scriptureMode}
                        onValueChange={(v) =>
                          setScriptureMode(
                            v === "chapters" || v === "portions" ? v : "project",
                          )
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="project">{t("tv.wholeBook")}</SelectItem>
                          <SelectItem value="chapters">{t("tv.chaptersDots")}</SelectItem>
                          <SelectItem value="portions">{t("tv.portionsDots")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div className="grid gap-2 rounded-lg border p-2">
                      <Select
                        value={scriptureMode}
                        onValueChange={(v) =>
                          setScriptureMode(
                            v === "books" || v === "chapters" || v === "portions"
                              ? v
                              : "project",
                          )
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="project">{t("tv.wholeProject")}</SelectItem>
                          {multiBook ? (
                            <SelectItem value="books">{t("tv.booksDots")}</SelectItem>
                          ) : null}
                          <SelectItem value="chapters">{t("tv.chaptersDots")}</SelectItem>
                          <SelectItem value="portions">{t("tv.portionsDots")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {scriptureMode === "books" ? (
                    <div className="flex flex-wrap gap-1.5">
                      {projectBooks.map((code) => (
                        <Button
                          key={code}
                          type="button"
                          size="sm"
                          variant={scopeBooks.includes(code) ? "default" : "outline"}
                          className="rounded-full"
                          onClick={() =>
                            setScopeBooks((prev) =>
                              prev.includes(code)
                                ? prev.filter((b) => b !== code)
                                : [...prev, code],
                            )
                          }
                        >
                          {code}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                  {scriptureMode === "chapters" || scriptureMode === "portions" ? (
                    <div className="grid gap-2">
                      {multiBook ? (
                        <Select value={scopeBook || projectBooks[0]} onValueChange={setScopeBook}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder={t("tv.book")} />
                          </SelectTrigger>
                          <SelectContent>
                            {projectBooks.map((code) => (
                              <SelectItem key={code} value={code}>
                                {code} — {bookLabel(code, language)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : null}
                      {scriptureMode === "chapters" ? (
                        <div className="grid gap-1.5">
                          <Label htmlFor="scope-chapters">{t("tv.chaptersLabel")}</Label>
                          <Input
                            id="scope-chapters"
                            value={scopeChaptersText}
                            onChange={(e) => setScopeChaptersText(e.target.value)}
                            placeholder="1, 2, 3"
                          />
                        </div>
                      ) : (
                        <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
                          {scopeBookPortions.map((portion) => {
                            const id = portionKey(portion);
                            const on = scopePortionIds.includes(id);
                            return (
                              <Button
                                key={id}
                                type="button"
                                size="sm"
                                variant={on ? "default" : "outline"}
                                className="rounded-full"
                                onClick={() =>
                                  setScopePortionIds((prev) =>
                                    on ? prev.filter((x) => x !== id) : [...prev, id],
                                  )
                                }
                              >
                                {portion.ref}
                              </Button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>

                <div className="grid gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("tv.resources")}
                  </h3>
                  {availableResources.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {availableResources.map((key) => (
                        <Button
                          key={key}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          onClick={() => toggleResource(key)}
                        >
                          + {resName(key)}
                        </Button>
                      ))}
                    </div>
                  ) : null}

                  <div className="grid gap-1.5">
                    {addedResources.map((key) => {
                      const row = draft[key] as ResourceDraft;
                      const isOpen = openResource === key;
                      const matchCount = inventory
                        ? ruleItemCount(
                            {
                              resource: key,
                              articleFilter: row.articleFilter,
                              grain: row.grain,
                              stayInChapter: row.stayInChapter,
                              includeDuplicates: row.includeDuplicates,
                              chapter: chapterNum > 0 ? chapterNum : undefined,
                              portionIds: sharedPortionIds.length ? sharedPortionIds : undefined,
                            },
                            inventory.portions,
                            inventory.articles,
                            draftTeam,
                            scopeCtx,
                          )
                        : null;
                      const summary = [
                        resName(key),
                        resourceShowsFilter(key)
                          ? articleFilterLabel(key, row.articleFilter, row.grain)
                          : null,
                        resourceShowsGrain(key) ? grainChoiceLabel(key, row.grain) : null,
                        matchCount != null
                          ? assignableCountLabel(key, row.grain, matchCount)
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ");

                      return (
                        <div
                          key={key}
                          className="rounded-lg border border-primary/40 bg-primary/5"
                        >
                          <div className="flex min-w-0 items-center gap-2 px-2 py-1.5">
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
                              onClick={() => setOpenResource(isOpen ? null : key)}
                              aria-expanded={isOpen}
                            >
                              <ChevronDown
                                className={cn(
                                  "size-3.5 shrink-0 text-muted-foreground transition-transform",
                                  isOpen && "rotate-180",
                                )}
                              />
                              <span className="min-w-0 truncate font-medium">{summary}</span>
                            </button>
                            <button
                              type="button"
                              aria-label={t("tv.removeRes").replace("{res}", resName(key))}
                              className="rounded-full p-0.5 text-muted-foreground hover:text-destructive"
                              onClick={() => toggleResource(key)}
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                          {isOpen ? (
                            <div className="grid gap-2 border-t border-primary/20 p-2">
                              {matchCount != null ? (
                                <p className="text-xs font-medium text-foreground">
                                  {t("tv.inQueue").replace("{count}", loc(assignableCountLabel(key, row.grain, matchCount)))}
                                </p>
                              ) : null}
                              {isScriptureResource(key) ? (
                                <p className="text-xs text-muted-foreground">
                                  {loc(scriptureIntro(key as "tpl" | "tps"))}
                                </p>
                              ) : null}

                              {resourceShowsFilter(key) ? (
                                <ChoiceGroup
                                  name={`filter-${key}`}
                                  label={t("tv.whatInclude")}
                                  value={row.articleFilter}
                                  onChange={(value) =>
                                    patchResource(key, { articleFilter: value as ArticleFilter })
                                  }
                                  options={filtersForResource(key).map((value) => ({
                                    value,
                                    label: loc(articleFilterLabel(key, value, row.grain)),
                                    description: loc(articleFilterHelp(key, value, row.grain)),
                                  }))}
                                />
                              ) : null}

                              {resourceShowsGrain(key) ? (
                                <ChoiceGroup
                                  name={`grain-${key}`}
                                  label={t("tv.howCut")}
                                  value={row.grain}
                                  onChange={(value) =>
                                    patchResource(key, { grain: value as AssignmentGrain })
                                  }
                                  options={grainsForResource(key).map((value) => ({
                                    value,
                                    label: loc(grainChoiceLabel(key, value)),
                                    description: loc(grainHelp(key, value)),
                                  }))}
                                />
                              ) : null}
                              {isArticleResource(key) && row.grain === "portionRefs" ? (
                                <div className="grid gap-1">
                                  <Label className="font-normal text-xs">
                                    <Checkbox
                                      checked={row.includeDuplicates}
                                      onCheckedChange={(checked) =>
                                        patchResource(key, {
                                          includeDuplicates: checked === true,
                                        })
                                      }
                                    />
                                    {t("tv.includeDup")}
                                  </Label>
                                  <p className="text-xs text-muted-foreground">
                                    {t("tv.dupHelp")}
                                  </p>
                                </div>
                              ) : null}
                              {key === "notas" || key === "preguntas" ? (
                                <div className="grid gap-1.5">
                                  <Label htmlFor={`rule-ids-${key}`}>{t("tv.concreteNums")}</Label>
                                  <Input
                                    id={`rule-ids-${key}`}
                                    value={row.itemIds}
                                    onChange={(e) =>
                                      patchResource(key, { itemIds: e.target.value })
                                    }
                                    placeholder={t("tv.concretePlaceholder")}
                                    aria-label={t("tv.concreteAria").replace("{res}", resName(key))}
                                  />
                                  <p className="text-xs text-muted-foreground">
                                    {t("tv.concreteHelp")}
                                  </p>
                                </div>
                              ) : null}
                              {!bundleOn &&
                              scriptureMode !== "chapters" &&
                              scriptureMode !== "portions" ? (
                                <details className="rounded-md border border-border/80 bg-surface/70 px-2 py-1.5">
                                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                                    {t("tv.distOptions")}
                                    {row.stayInChapter ? t("tv.noCrossSuffix") : ""}
                                  </summary>
                                  <div className="mt-2 grid gap-1">
                                    <Label className="font-normal text-xs">
                                      <Checkbox
                                        checked={row.stayInChapter}
                                        onCheckedChange={(checked) =>
                                          patchResource(key, {
                                            stayInChapter: checked === true,
                                          })
                                        }
                                      />
                                      {t("tv.noCross")}
                                    </Label>
                                    <p className="text-xs text-muted-foreground">
                                      {loc(stayInChapterHelp(key))}
                                    </p>
                                  </div>
                                </details>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                    {!addedResources.length ? (
                      <p className="text-sm text-muted-foreground">
                        {t("tv.addOneResource")}
                      </p>
                    ) : null}
                  </div>
                </div>

                {addedResources.length ? (
                  <div className="grid gap-3">
                    <Collapsible open={scopeHelpOpen} onOpenChange={setScopeHelpOpen}>
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {t("tv.distribution")}
                        </h3>
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          >
                            {t("tv.howItWorks")}
                            <ChevronDown
                              className={cn(
                                "size-3 transition-transform",
                                scopeHelpOpen && "rotate-180",
                              )}
                            />
                          </button>
                        </CollapsibleTrigger>
                      </div>
                      <CollapsibleContent>
                        <p className="pt-1 text-xs text-muted-foreground">
                          {t("tv.distHelp")}
                        </p>
                      </CollapsibleContent>
                    </Collapsible>

                    {canBundle ? (
                      <ChoiceGroup
                        name="packaging"
                        label={t("tv.packaging")}
                        value={packaging}
                        onChange={(v) => setPackaging(v as Packaging)}
                        options={[
                          {
                            value: "separate",
                            label: t("tv.separate"),
                            description: t("tv.separateDesc"),
                          },
                          {
                            value: "together",
                            label: t("tv.together"),
                            description: t("tv.togetherDesc"),
                          },
                        ]}
                      />
                    ) : null}

                    <ChoiceGroup
                      name="distribute-unit"
                      label={t("tv.distUnit")}
                      value={distributeUnit}
                      onChange={(v) => {
                        const next = v as DistributeUnit;
                        setDistributeUnit(next);
                        if (next === "chapter") setSharedPortionIds([]);
                      }}
                      options={[
                        {
                          value: "portion",
                          label: loc(DISTRIBUTE_UNIT_LABEL.portion),
                          description: loc(DISTRIBUTE_UNIT_HELP.portion),
                        },
                        {
                          value: "chapterRounds",
                          label: loc(DISTRIBUTE_UNIT_LABEL.chapterRounds),
                          description: loc(DISTRIBUTE_UNIT_HELP.chapterRounds),
                        },
                        {
                          value: "chapter",
                          label: loc(DISTRIBUTE_UNIT_LABEL.chapter),
                          description: loc(DISTRIBUTE_UNIT_HELP.chapter),
                        },
                      ]}
                    />

                    <ChoiceGroup
                      name="distribute-policy"
                      label={t("tv.autoAssign")}
                      value={distributePolicy}
                      onChange={(v) => setDistributePolicy(v as DistributePolicy)}
                      options={[
                        {
                          value: "contiguous",
                          label: loc(DISTRIBUTE_POLICY_LABEL.contiguous),
                          description: loc(DISTRIBUTE_POLICY_HELP.contiguous),
                        },
                        {
                          value: "manual",
                          label: loc(DISTRIBUTE_POLICY_LABEL.manual),
                          description: loc(DISTRIBUTE_POLICY_HELP.manual),
                        },
                      ]}
                    />
                  </div>
                ) : null}

                {showSharedAmbit ? (
                  <div className="grid gap-2 rounded-lg border p-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("tv.bookScope")}
                    </h3>
                    <div className="grid gap-1.5">
                      <Label htmlFor="shared-chapter">{t("tv.chapter")}</Label>
                      <Select
                        value={sharedChapter || "__none__"}
                        onValueChange={(v) => {
                          setSharedChapter(v === "__none__" ? "" : v);
                          setSharedPortionIds([]);
                        }}
                      >
                        <SelectTrigger id="shared-chapter" className="w-full" aria-label={t("tv.chapter")}>
                          <SelectValue placeholder={t("tv.pickChapter")} />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          <SelectItem value="__none__">
                            {bundleOn ? t("tv.dashChapter") : t("tv.dashWholeBook")}
                          </SelectItem>
                          {inventoryChapters.map((group) => (
                            <SelectItem key={group.chapter} value={String(group.chapter)}>
                              {t("tv.chapterN").replace("{n}", String(group.chapter)).replace("{p}", String(group.portions.length))}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {distributeUnit !== "chapter" && geoPortions.length ? (
                      <div className="grid gap-1.5">
                        <Label>{t("tv.chapterPortions")}</Label>
                        <div className="max-h-40 overflow-auto rounded-lg border p-2">
                          {geoPortions.map((portion, index) => {
                            const portionId = portionKey(portion);
                            return (
                              <Label
                                key={portionId}
                                className="flex items-center gap-2 py-1 font-normal"
                              >
                                <Checkbox
                                  checked={sharedPortionIds.includes(portionId)}
                                  onCheckedChange={() =>
                                    setSharedPortionIds((prev) =>
                                      prev.includes(portionId)
                                        ? prev.filter((id) => id !== portionId)
                                        : [...prev, portionId],
                                    )
                                  }
                                />
                                <span>
                                  {index + 1}. {portion.ref}
                                </span>
                              </Label>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {inventory && (draft.notas != null || draft.academia != null) ? (
                  <p className="text-xs text-muted-foreground">
                    {draft.notas != null
                      ? t(draftNotes === 1 ? "tv.noteOne" : "tv.noteMany").replace("{n}", String(draftNotes))
                      : null}
                    {draft.notas != null && draft.academia != null ? " · " : null}
                    {draft.academia != null
                      ? t("tv.academiaCount").replace("{n}", String(draftCited.filter((row) => row.kind === "Translation Academy").length)) +
                        (draftCitedRepeat
                          ? t(draftCitedRepeat === 1 ? "tv.citedOne" : "tv.citedMany").replace("{n}", String(draftCitedRepeat))
                          : "")
                      : null}
                  </p>
                ) : null}
              </>
            ) : null}

            {editorStep === "personas" ? (
              <>
                {session && !pmOrg ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor="personas-org">{t("tv.teamOrg")}</Label>
                    {orgs.length ? (
                      <Select
                        value={pmOrg || "__none__"}
                        onValueChange={(v) => onPmOrgChange(v === "__none__" ? "" : v)}
                      >
                        <SelectTrigger id="personas-org" className="w-full" aria-label={t("tv.teamOrg")}>
                          <SelectValue placeholder={t("tv.pickOrg")} />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          <SelectItem value="__none__">{t("tv.dashPickOrg")}</SelectItem>
                          {orgs.map((o) => {
                            const slug = orgSlug(o);
                            return (
                              <SelectItem key={o.id || slug} value={slug}>
                                {orgOptionLabel(o)}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {t("tv.pickOrgHint")}
                      </p>
                    )}
                  </div>
                ) : null}

                {session && pmOrg ? (
                  <div className="grid gap-2">
                    <p className="text-xs text-muted-foreground">
                      {t("tv.rosterOf")}
                      <strong>{pmOrg}</strong>
                      {rosterLoading
                        ? t("tv.loadingInline")
                        : roster.length
                          ? t("tv.nPeople").replace("{n}", String(roster.length))
                          : ""}
                      {orgTeams.length ? t("tv.nOrgTeams").replace("{n}", String(orgTeams.length)) : ""}
                    </p>
                    <div className="grid gap-1.5">
                      <Label htmlFor="org-team-filter">{t("tv.showOneTeam")}</Label>
                      <Select
                        value={orgTeamFilter}
                        onValueChange={(v) => {
                          setOrgTeamFilter(v);
                          setOrgTeamsError("");
                        }}
                      >
                        <SelectTrigger id="org-team-filter" className="w-full" aria-label={t("tv.orgTeamAria")}>
                          <SelectValue placeholder={t("tv.wholeOrg")} />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          <SelectItem value="all">{t("tv.wholeOrg")}</SelectItem>
                          {orgTeams.map((team) => (
                            <SelectItem key={team.id} value={String(team.id)}>
                              {displayOrgTeamName(team.name, teamPrefix)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {t("tv.manageTeamsA")}
                        <strong>{t("nav.organization")}</strong>
                        {t("tv.manageTeamsB")}
                      </p>
                    </div>
                    {orgTeamMembersLoading ? (
                      <p className="text-xs text-muted-foreground">{t("tv.loadingMembers")}</p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("tv.noSession")}
                  </p>
                )}

                {rosterError ? (
                  <Alert variant="destructive">
                    <AlertDescription>{rosterError}</AlertDescription>
                  </Alert>
                ) : null}
                {orgTeamsError ? (
                  <Alert variant="destructive">
                    <AlertDescription>{orgTeamsError}</AlertDescription>
                  </Alert>
                ) : null}

                {selectable.length > 6 || roster.length > 6 ? (
                  <Input
                    value={rosterQuery}
                    onChange={(e) => setRosterQuery(e.target.value)}
                    placeholder={t("tv.searchMember")}
                    aria-label={t("tv.searchMemberAria")}
                  />
                ) : null}

                {selectable.length ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={selectAllFiltered}
                    >
                      {t("tv.markAll")}
                    </button>
                    {memberIds.length ? (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setMemberIds([])}
                      >
                        {t("tv.unmark").replace("{n}", String(memberIds.length))}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {selectable.map((p) => (
                    <Label
                      key={p.id}
                      className={cn(
                        "rounded-full border px-2 py-1 text-xs font-normal",
                        memberIds.includes(p.id) && "border-primary bg-primary/5",
                      )}
                    >
                      <Checkbox
                        checked={memberIds.includes(p.id)}
                        onCheckedChange={() => toggleMember(p)}
                      />
                      {p.name}
                      {rosterMap.has(p.id) && p.name !== p.id ? (
                        <span className="text-muted-foreground">@{p.id}</span>
                      ) : null}
                    </Label>
                  ))}
                  {!selectable.length && !rosterLoading && !orgTeamMembersLoading ? (
                    <span className="text-sm text-muted-foreground">
                      {rosterQuery || orgTeamFilter !== "all"
                        ? t("tv.noMatch")
                        : t("tv.noPeople")}
                    </span>
                  ) : null}
                </div>

                {!session || addManualOpen ? (
                  <div className="grid gap-1.5 border-t pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="local-person">
                        {session ? t("tv.addManual") : t("tv.addManualLocal")}
                      </Label>
                      {session ? (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => setAddManualOpen(false)}
                        >
                          {t("tv.hide")}
                        </button>
                      ) : null}
                    </div>
                    <div className="flex gap-1.5">
                      <Input
                        id="local-person"
                        value={personName}
                        onChange={(e) => setPersonName(e.target.value)}
                        placeholder={t("tv.name")}
                        aria-label={t("tv.personNameAria")}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addPerson();
                          }
                        }}
                      />
                      <Button type="button" onClick={addPerson} disabled={!personName.trim()}>
                        {t("tv.add")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="justify-self-start border-t pt-3 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setAddManualOpen(true)}
                  >
                    {t("tv.addManualLink")}
                  </button>
                )}

                {board.people.filter((p) => !rosterMap.has(p.id)).length ? (
                  <div className="max-h-40 overflow-auto">
                    {board.people
                      .filter((p) => !rosterMap.has(p.id))
                      .map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between gap-2 border-b py-1.5 last:border-0"
                        >
                          <strong className="font-medium">{p.name}</strong>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removePerson(p.id)}
                          >
                            {t("tv.remove")}
                          </Button>
                        </div>
                      ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </CardContent>
        </Card>

        <div className="sticky bottom-0 z-10 -mx-3 border-t bg-card/95 px-3 py-2.5 backdrop-blur sm:-mx-4 sm:px-4">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {stepIndex > 0 ? (
                <Button type="button" variant="ghost" size="sm" onClick={goPrevStep}>
                  {t("tv.back")}
                </Button>
              ) : (
                <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
                  {t("tv.cancel")}
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {editorStep === "personas" ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={saveAsPreset}
                    disabled={!canSave}
                    title={t("tv.saveAsTaskTemplateTitle")}
                  >
                    {t("tv.saveAsTaskTemplate")}
                  </Button>
                  <Button type="button" onClick={saveTeam} disabled={!canSave}>
                    {editingId ? t("tv.saveChanges") : t("tv.createTask")}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  onClick={goNextStep}
                  disabled={editorStep === "identidad" && !teamName.trim()}
                >
                  {t("tv.next")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="hub">
      {processUpdate ? (
        <div className="af-stale" role="status">
          <p style={{ margin: 0 }}>{t("tv.processUpdate").replace("{name}", processUpdate.name).replace("{v}", String(processUpdate.version))}</p>
          <Button
            type="button"
            size="sm"
            className="mt-2"
            onClick={() => {
              const result = upgradeBoardToWorkflow(board, processUpdate);
              onChange(result.board);
              const added = [...result.phases, ...result.tasks, ...result.steps];
              announce(added.length ? t("tv.processUpdated").replace("{what}", added.join(", ")) : t("tv.processUpdatedPlain"));
            }}
          >
            {t("tv.processUpdateDo")}
          </Button>
        </div>
      ) : null}
      <div className="hub-header">
        <div>
          <h1 className="hub-title">{t("tv.phasesAndTasks")}</h1>
          {listHelpOpen ? (
            <p className="hub-lede">
              {t("tv.listLede")}
            </p>
          ) : null}
        </div>
        <div className="phases-header-actions">
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setListHelpOpen((v) => !v)}
          >
            {listHelpOpen ? t("tv.hideHelp") : t("tv.howItWorks")}
          </button>
          {onOpenPlantillas ? (
            <Button type="button" variant="outline" size="sm" onClick={onOpenPlantillas}>
              {t("nav.templates")}
            </Button>
          ) : null}
          {board.teams.length > 0 ? (
            <div className="phases-create">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-expanded={createMenuOpen}
                onClick={() => {
                  setCreateMenuOpen((v) => !v);
                  setPhaseMenuId(null);
                  setTaskMenuId(null);
                }}
              >
                {t("tv.newMenu")}
              </Button>
              {createMenuOpen ? (
                <div className="phases-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="phases-menu__item"
                    onClick={() => {
                      setCreateMenuOpen(false);
                      setNewPhaseOpen(true);
                      setNewPhaseName(`Fase ${board.phases.length + 1}`);
                    }}
                  >
                    {t("tv.menuPhase")}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="phases-menu__item"
                    onClick={() => {
                      setCreateMenuOpen(false);
                      openNew();
                    }}
                  >
                    {t("tv.menuTaskAdv")}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {session && pmOrg && board.teams.length ? (
        <PhaseTeamsPanel
          key={board.projectId}
          mode="all"
          board={board}
          loadTeams={() => listPmOrgTeams(session, pmOrg)}
          onSave={(doc, choice, replace) => setPhaseTeams({ session, pmOrg, board: doc, choice, replace })}
          onSaved={onChange}
        />
      ) : null}

      <div className="workflow-apply">
        <div className="grid min-w-[12rem] flex-1 gap-1.5">
          <Label htmlFor="apply-workflow">{t("tv.workflowTemplate")}</Label>
          <Select
            value={applyWorkflowId || "none"}
            onValueChange={(v) => setApplyWorkflowId(v === "none" ? "" : v)}
          >
            <SelectTrigger id="apply-workflow" className="w-full">
              <SelectValue placeholder={t("tv.pickTemplate")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("tv.pickTemplateDots")}</SelectItem>
              {workflowsCatalog.workflows.map((wf) => (
                <SelectItem key={wf.id} value={wf.id}>
                  {t("tv.nTasksOf").replace("{name}", wf.name).replace("{n}", String(wf.tasks.length))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={applyBusy || !applyWorkflowId}
          onClick={applySelectedWorkflow}
        >
          {board.teams.length ? t("tv.reapply") : t("tv.apply")}
        </Button>
        {board.teams.length ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={applyBusy}
            onClick={() => void saveBoardAsWorkflow()}
          >
            {t("tv.saveAsTemplate")}
          </Button>
        ) : null}
        {board.workflowId ? (
          <p className="basis-full text-xs text-muted-foreground">
            {t("tv.applied")}
            {localizeName([...shippedWorkflows(), ...workflowsCatalog.workflows].find((wf) => wf.id === board.workflowId)?.name ?? board.workflowId, language)}
            {board.workflowAppliedAt
              ? ` · ${new Date(board.workflowAppliedAt).toLocaleString(language)}`
              : ""}
          </p>
        ) : null}
        {!workflowsCatalog.workflows.length && !board.workflowId ? (
          <p className="basis-full text-xs text-muted-foreground">
            {t("tv.noTemplatesYet")}{" "}
            {onOpenPlantillas ? (
              <button type="button" className="underline" onClick={onOpenPlantillas}>
                {t("tv.createInTemplates")}
              </button>
            ) : (
              t("tv.createOneInTemplates")
            )}
          </p>
        ) : null}
      </div>

      {!board.teams.length ? (
        <Alert className="mb-3">
          <AlertDescription>
            {t("tv.noPhasesAlert")}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="hub-panel">
        <div className="grid gap-2">
          <div className="text-sm font-medium text-foreground">{t("tv.projectSettings")}</div>
          <label className="flex items-start gap-2 text-sm leading-snug">
            <Checkbox
              checked={Boolean(board.settings?.allowSelfAssign)}
              onCheckedChange={(checked) =>
                onChange({
                  ...board,
                  settings: {
                    ...board.settings,
                    allowSelfAssign: Boolean(checked),
                  },
                })
              }
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">{t("tv.allowSelf")}</span>
              <span className="mt-0.5 block text-muted-foreground">
                {t("tv.allowSelfHelp")}
              </span>
            </span>
          </label>
          <div className="grid gap-1.5 sm:grid-cols-[1fr_8rem] sm:items-end">
            <div className="sm:col-span-2">
              <div className="text-sm font-medium text-foreground">{t("tv.refResources")}</div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t("tv.refHelp")}
              </p>
            </div>
            {(() => {
              const pkg = resolveSourcePackage(board.settings);
              const update = (owner: string, lang: string) => {
                const next = sourcePackageFor(owner, lang);
                const isDefault = owner === DEFAULT_SOURCE_PACKAGE.owner && lang === sourcePackageLang(DEFAULT_SOURCE_PACKAGE);
                onChange({ ...board, settings: { ...board.settings, sourcePackage: isDefault ? undefined : next } });
              };
              return (
                <>
                  <div className="grid gap-1">
                    <Label htmlFor="source-owner">{t("nav.organization")}</Label>
                    <Input id="source-owner" value={pkg.owner} onChange={(e) => update(e.target.value, sourcePackageLang(pkg))} />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="source-lang">{t("tv.language")}</Label>
                    <Input id="source-lang" value={sourcePackageLang(pkg)} onChange={(e) => update(pkg.owner, e.target.value)} />
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {newPhaseOpen ? (
        <div className="hub-panel">
          <div className="grid gap-1.5 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
            <div className="grid gap-1">
              <Label htmlFor="new-phase-name">{t("tv.phaseLabel")}</Label>
              <Input
                id="new-phase-name"
                value={newPhaseName}
                onChange={(e) => {
                  const value = e.target.value;
                  setNewPhaseName(value);
                  if (!newPhaseSlugTouched) setNewPhaseSlug(slugifyPhase(value));
                }}
                placeholder={t("tv.phasePlaceholder")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addPhase();
                }}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="new-phase-slug">{t("tv.shortId")}</Label>
              <Input
                id="new-phase-slug"
                value={newPhaseSlug}
                onChange={(e) => {
                  setNewPhaseSlugTouched(true);
                  setNewPhaseSlug(e.target.value);
                }}
                placeholder="revision"
                className="font-mono"
                aria-label={t("tv.shortIdAria")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addPhase();
                }}
              />
            </div>
            <Button type="button" onClick={() => addPhase()}>
              {t("tv.create")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setNewPhaseOpen(false);
                setNewPhaseName("");
                setNewPhaseSlug("");
                setNewPhaseSlugTouched(false);
              }}
            >
              {t("tv.cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="phases-board">
        {sortedPhases().map((phase, phaseIndex) => {
          const phaseTasks = board.teams.filter((t) => t.phaseId === phase.id);
          const phasesSorted = sortedPhases();
          const phaseMenuOpen = phaseMenuId === phase.id;
          return (
            <section key={phase.id} className="phases-section">
              <div className="phases-section__head">
                <div className="phases-section__identity">
                  {editingPhaseId === phase.id ? (
                    <div className="phases-section__edit">
                      <Input
                        value={editingPhaseName}
                        onChange={(e) => setEditingPhaseName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRenamePhase();
                          if (e.key === "Escape") setEditingPhaseId(null);
                        }}
                        className="h-8 max-w-xs font-medium"
                        aria-label={t("tv.renamePhaseAria")}
                        autoFocus
                      />
                      <Input
                        value={editingPhaseSlug}
                        onChange={(e) => setEditingPhaseSlug(e.target.value)}
                        onBlur={commitRenamePhase}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRenamePhase();
                          if (e.key === "Escape") setEditingPhaseId(null);
                        }}
                        className="h-8 max-w-[10rem] font-mono text-xs"
                        aria-label={t("tv.shortIdAria")}
                        placeholder="revision"
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="phases-section__title"
                      onClick={() => {
                        setEditingPhaseId(phase.id);
                        setEditingPhaseName(phase.name);
                        setEditingPhaseSlug(ensurePhaseSlug(phase));
                      }}
                      title={t("tv.clickRename")}
                    >
                      {phase.name}
                    </button>
                  )}
                  <span className="phases-section__count">
                    {t(phaseTasks.length === 1 ? "tv.tasksOne" : "tv.tasksMany").replace("{n}", String(phaseTasks.length))}
                  </span>
                </div>
                <div className="phases-section__tools">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-expanded={phaseMenuOpen}
                    aria-label={t("tv.moreActions").replace("{name}", phase.name)}
                    onClick={() => {
                      setPhaseMenuId(phaseMenuOpen ? null : phase.id);
                      setCreateMenuOpen(false);
                      setTaskMenuId(null);
                    }}
                  >
                    ⋯
                  </Button>
                  {phaseMenuOpen ? (
                    <div className="phases-menu phases-menu--end" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        className="phases-menu__item"
                        disabled={phaseIndex === 0}
                        onClick={() => {
                          movePhase(phase.id, -1);
                          setPhaseMenuId(null);
                        }}
                      >
                        {t("tv.up")}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="phases-menu__item"
                        disabled={phaseIndex >= phasesSorted.length - 1}
                        onClick={() => {
                          movePhase(phase.id, 1);
                          setPhaseMenuId(null);
                        }}
                      >
                        {t("tv.down")}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="phases-menu__item"
                        onClick={() => {
                          setPhaseMenuId(null);
                          openNewInPhase(phase.id);
                        }}
                      >
                        {t("tv.addTask")}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="phases-menu__item phases-menu__item--danger"
                        disabled={board.phases.length <= 1}
                        onClick={() => {
                          setPhaseMenuId(null);
                          removePhase(phase.id);
                        }}
                      >
                        {t("tv.deletePhase")}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              {phaseTasks.map((team) => {
                const overlaps = overlappingTeams(team, board.teams);
                const members = team.memberIds
                  .map((id) => localMap.get(id))
                  .filter((row): row is Person => Boolean(row));
                const rules = teamRules(team);
                const resourceBit = rules.length
                  ? rules.map((rule) => resName(rule.resource)).join(" · ")
                  : loc("Sin recursos");
                const summary = `${resourceBit} · ${loc(DISTRIBUTE_UNIT_LABEL[resolveDistributeUnit(team)])} · ${t(members.length === 1 ? "tv.memberOne" : "tv.memberMany").replace("{n}", String(members.length))}`;
                const claimSummary = loc(formatTaskClaimSummary(team.steps));
                const taskMenuOpen = taskMenuId === team.id;
                return (
                  <div
                    key={team.id}
                    className={cn(
                      "phases-task",
                      board.activeTeamId === team.id && "phases-task--active",
                    )}
                  >
                    <div className="phases-task__main">
                      <button
                        type="button"
                        className="phases-task__title"
                        onClick={() => startEdit(team)}
                      >
                        {team.name}
                      </button>
                      <p className="phases-task__summary">{summary}</p>
                      <div className="phases-task__flags">
                        {board.activeTeamId === team.id ? (
                          <Badge variant="secondary">{t("tv.activeInAssign")}</Badge>
                        ) : null}
                        {overlaps.length ? (
                          <Badge variant="outline">{t("tv.overlap")}</Badge>
                        ) : null}
                        {team.orgTeamName ? (
                          <Badge variant="outline">
                            {displayOrgTeamName(team.orgTeamName, teamPrefix)}
                          </Badge>
                        ) : null}
                        {team.steps?.length ? (
                          <Badge variant="outline">
                            {t(team.steps.length === 1 ? "tv.stepsOne" : "tv.stepsMany").replace("{n}", String(team.steps.length))}
                            {claimSummary ? ` · ${claimSummary}` : ""}
                          </Badge>
                        ) : null}
                        {team.solverAppId ? (
                          <Badge variant="outline">{t("tv.withEditor")}</Badge>
                        ) : null}
                        {team.waitsFor?.length ? (
                          <Badge variant="outline">
                            {t(team.waitsFor.length === 1 ? "tv.waitsOne" : "tv.waitsMany").replace("{n}", String(team.waitsFor.length))}
                          </Badge>
                        ) : null}
                        {team.reviewsPrincipal ? (
                          <Badge variant="outline">{t("tv.reviewsMainBadge")}</Badge>
                        ) : null}
                      </div>
                      {overlaps.length ? (
                        <p className="phases-task__note">
                          {t("tv.sameResource")}
                          {overlaps
                            .map((p) =>
                              p.description.trim()
                                ? `${p.name} (${p.description.trim()})`
                                : p.name,
                            )
                            .join(", ")}
                          .
                        </p>
                      ) : null}
                    </div>
                    <div className="phases-task__actions">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => onChange({ ...board, activeTeamId: team.id })}
                      >
                        {t("tv.useInAssign")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => startEdit(team)}
                      >
                        {t("tv.edit")}
                      </Button>
                      <div className="phases-task__more">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-expanded={taskMenuOpen}
                          aria-label={t("tv.moreActions").replace("{name}", team.name)}
                          onClick={() => {
                            setTaskMenuId(taskMenuOpen ? null : team.id);
                            setPhaseMenuId(null);
                            setCreateMenuOpen(false);
                          }}
                        >
                          ⋯
                        </Button>
                        {taskMenuOpen ? (
                          <div className="phases-menu phases-menu--end" role="menu">
                            <button
                              type="button"
                              role="menuitem"
                              className="phases-menu__item"
                              disabled={!session || !pmOrg}
                              onClick={() => {
                                setTaskMenuId(null);
                                void openAssignOrgTeam(team);
                              }}
                            >
                              {team.orgTeamName
                                ? t("tv.teamBullet").replace("{name}", displayOrgTeamName(team.orgTeamName, teamPrefix))
                                : t("tv.assignTeam")}
                            </button>
                            {team.orgTeamId ? (
                              <button
                                type="button"
                                role="menuitem"
                                className="phases-menu__item"
                                onClick={() => {
                                  setTaskMenuId(null);
                                  clearOrgTeam(team);
                                }}
                              >
                                {t("tv.removeTeam")}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              role="menuitem"
                              className="phases-menu__item phases-menu__item--danger"
                              onClick={() => {
                                setTaskMenuId(null);
                                removeTeam(team.id);
                              }}
                            >
                              {t("tv.delete")}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}

              {!phaseTasks.length ? (
                <p className="hub-hint">
                  {t("tv.noTasksInPhase")}
                  <button
                    type="button"
                    className="font-medium text-foreground underline-offset-2 hover:underline"
                    onClick={() => openNewInPhase(phase.id)}
                  >
                    {t("tv.addOne")}
                  </button>
                </p>
              ) : null}
            </section>
          );
        })}

        {!board.teams.length && !board.phases.length ? (
          <div className="hub-empty-panel">
            <span className="hub-empty-panel__kicker">{t("tv.emptyKicker")}</span>
            <h2 className="hub-empty-panel__title">{t("tv.noPhasesTasks")}</h2>
            <p className="hub-empty-panel__body">
              {t("tv.createPhaseThen")}
            </p>
            <div className="hub-empty-panel__actions">
              <Button type="button" variant="outline" onClick={() => addPhase("Fase 1")}>
                {t("tv.newPhasePlus")}
              </Button>
              <Button type="button" onClick={openNew}>
                {t("tv.newTaskPlus")}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <Dialog open={Boolean(assignTask)} onOpenChange={(open) => !open && setAssignTask(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("tv.assignTeam")}</DialogTitle>
            <DialogDescription>
              {assignTask
                ? t("tv.assignTeamDesc").replace("{task}", assignTask.name)
                : null}
            </DialogDescription>
          </DialogHeader>
          {assignLoading ? (
            <p className="text-sm text-muted-foreground">{t("tv.checking")}</p>
          ) : null}
          {assignError ? (
            <Alert variant="destructive">
              <AlertDescription>{assignError}</AlertDescription>
            </Alert>
          ) : null}
          {!assignLoading && assignEligible.length === 0 && assignIneligible.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("tv.noOrgTeams")}
            </p>
          ) : null}
          {assignEligible.length ? (
            <div className="grid gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("tv.eligible")}
              </p>
              {assignEligible.map((team) => (
                <div
                  key={team.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
                >
                  <div>
                    <div className="font-medium">
                      {displayOrgTeamName(team.name, teamPrefix)}
                    </div>
                    {assignTask?.orgTeamId === team.id ? (
                      <Badge variant="secondary">{t("tv.current")}</Badge>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={assignBusyId != null}
                    onClick={() => void confirmAssignOrgTeam(team, false)}
                  >
                    {assignBusyId === team.id ? t("tv.assigning") : t("tv.assign")}
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          {assignIneligible.length ? (
            <div className="grid gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("tv.missingRepos")}
                {session?.canManage ? t("tv.canGrant") : ""}
              </p>
              {assignIneligible.map(({ team, eligibility }) => (
                <div key={team.id} className="rounded-md border border-dashed p-2">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <strong className="font-medium">
                      {displayOrgTeamName(team.name, teamPrefix)}
                    </strong>
                    {session?.canManage ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={assignBusyId != null}
                        onClick={() => void confirmAssignOrgTeam(team, true)}
                      >
                        {assignBusyId === team.id ? t("tv.granting") : t("tv.grantAndAssign")}
                      </Button>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("tv.missing")}{eligibility.missing.join(", ") || "—"}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setAssignTask(null)}>
              {t("tv.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
