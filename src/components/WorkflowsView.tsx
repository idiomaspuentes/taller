import { PM_REPO_NAME } from "../domain/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { GtSession } from "../dcs/auth";
import { loadSolversCatalog } from "../dcs/issues";
import { loadWorkflowsFromDcs, saveWorkflowsToDcs } from "../dcs/persist";
import { uid } from "../domain/assignment";
import {
  DEFAULT_SOLVERS_CATALOG,
  type SolversCatalog,
} from "../domain/solvers";
import type {
  ScopeKey,
  TaskTemplate,
  WorkflowTemplate,
  WorkflowsCatalog,
} from "../domain/types";
import { SCOPE_KEYS, WORKFLOWS_SCHEMA } from "../domain/types";
import { scopeLabel } from "../domain/resourceNames";
import type { ProjectTask } from "../domain/types";
import { WaitsEditor } from "./WaitsEditor";
import { MinLevelField } from "./MinLevelField";
import {
  loadLocalWorkflows,
  mergeWorkflowCatalogs,
  normalizeWorkflowTemplate,
  saveLocalWorkflows,
} from "../domain/store";
import { formatTaskClaimSummary } from "../domain/stepClaim";
import { emptyWorkflow } from "../domain/workflows";
import { localized, shippedWorkflows } from "../domain/processes";
import { ensurePhaseSlug, makePhase, slugifyPhase } from "../domain/phaseSlug";
import { StepsEditor } from "./StepsEditor";
import { EveryUnitField } from "./EveryUnitField";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { ChevronDown } from "lucide-react";
import { tNow, useT } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";
import { localizeName } from "../domain/templateNames";
import { localizeScope } from "../domain/scopeNames";
import { explainError } from "../dcs/userError";

type Props = {
  session: GtSession;
  pmOrg: string;
  canManage: boolean;
  announce: (msg: string) => void;
  focusWorkflowId?: string;
  onSelectWorkflow?: (id: string | undefined) => void;
};

function defaultRule(resource: ScopeKey) {
  const grain =
    resource === "tpl" || resource === "tps"
      ? ("portion" as const)
      : ("item" as const);
  return {
    resource,
    articleFilter: "pending" as const,
    grain,
  };
}

export function WorkflowsView({
  session,
  pmOrg,
  canManage,
  announce,
  focusWorkflowId,
  onSelectWorkflow,
}: Props) {
  const t = useT();
  const language = useUiLanguage();
  const loc = (text: string) => localizeScope(text, language);
  const nm = (text: string) => localizeName(text, language);
  const [catalog, setCatalog] = useState<WorkflowsCatalog>(() => loadLocalWorkflows());
  const [solvers, setSolvers] = useState<SolversCatalog>(DEFAULT_SOLVERS_CATALOG);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkflowTemplate | null>(null);
  /** What the template in hand calls a resource. */
  const resName = (resource: string) => scopeLabel(resource, draft?.resourceNames, language, loc);
  const [taskEditId, setTaskEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [listHelpOpen, setListHelpOpen] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const [solverPickerOpen, setSolverPickerOpen] = useState(false);
  const [phaseMenuId, setPhaseMenuId] = useState<string | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);
  const [editingPhaseName, setEditingPhaseName] = useState("");
  const [editingPhaseSlug, setEditingPhaseSlug] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [resourceMenuOpen, setResourceMenuOpen] = useState(false);

  const reload = useCallback(async () => {
    if (!pmOrg) {
      setCatalog(loadLocalWorkflows());
      return;
    }
    setBusy(true);
    setError("");
    try {
      const remote = await loadWorkflowsFromDcs(session, pmOrg);
      const local = loadLocalWorkflows();
      const merged = remote
        ? mergeWorkflowCatalogs(local, remote)
        : local;
      setCatalog(merged);
      saveLocalWorkflows(merged);
      const sol = await loadSolversCatalog(session, pmOrg);
      setSolvers(sol);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }, [session, pmOrg]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * Sync selection from the hash only when the URL id changes.
   * Do not depend on catalog / unstable App callbacks — that was wiping keystrokes.
   */
  useEffect(() => {
    if (!focusWorkflowId) return;
    setSelectedId((prev) => {
      if (prev === focusWorkflowId) return prev;
      setTaskEditId(null);
      setDirty(false);
      return focusWorkflowId;
    });
  }, [focusWorkflowId]);

  /** Hydrate draft from catalog when selection has no matching draft (and not mid-edit). */
  useEffect(() => {
    if (!selectedId) return;
    if (draft?.id === selectedId) return;
    if (dirty && draft) return;
    const hit = catalog.workflows.find((w) => w.id === selectedId);
    if (hit) {
      setDraft(structuredClone(hit));
      setDirty(false);
    }
  }, [selectedId, catalog.workflows, draft, dirty]);

  function openWorkflow(wf: WorkflowTemplate, opts?: { rename?: boolean }) {
    if (dirty && draft && draft.id !== wf.id) {
      const ok = window.confirm(t("wf.discard"));
      if (!ok) return;
    }
    setSelectedId(wf.id);
    setDraft(structuredClone(wf));
    setTaskEditId(null);
    setDirty(false);
    setDescOpen(Boolean(wf.description?.trim()));
    setSolverPickerOpen(false);
    setPhaseMenuId(null);
    setTemplateMenuOpen(false);
    setCreateMenuOpen(false);
    setResourceMenuOpen(false);
    setEditingName(Boolean(opts?.rename));
    onSelectWorkflow?.(wf.id);
    requestAnimationFrame(() => {
      document.querySelector(".app-main")?.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function createNew() {
    const wf = emptyWorkflow(tNow("wf.flowN").replace("{n}", String(catalog.workflows.length + 1)));
    setCatalog((prev) => {
      const next = {
        schema: WORKFLOWS_SCHEMA,
        workflows: [...prev.workflows, wf],
      };
      saveLocalWorkflows(next);
      return next;
    });
    openWorkflow(wf, { rename: true });
    setDirty(true);
    setDescOpen(false);
    announce(t("wf.created").replace("{name}", wf.name));
  }

  /** A new template that starts from one shipped with the app (same flow, own copy to adjust). */
  function createFromShipped(base: WorkflowTemplate) {
    const wf = { ...base, id: uid(), name: `${base.name} ${catalog.workflows.length + 1}`, names: undefined };
    setCatalog((prev) => {
      const next = { schema: WORKFLOWS_SCHEMA, workflows: [...prev.workflows, wf] };
      saveLocalWorkflows(next);
      return next;
    });
    openWorkflow(wf, { rename: true });
    setDirty(true);
    setDescOpen(false);
    announce(t("wf.createdShipped").replace("{name}", nm(wf.name)));
  }

  function commitRenameWorkflow() {
    setEditingName(false);
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) updateDraft({ name: t("wf.unnamed") });
  }

  function switchWorkflow(id: string) {
    if (!id || id === draft?.id) return;
    const hit = catalog.workflows.find((w) => w.id === id);
    if (hit) openWorkflow(hit);
  }

  function renamePhase(phaseId: string, name: string, slug?: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        phases: prev.phases.map((p) =>
          p.id === phaseId
            ? {
                ...p,
                name,
                slug: slugifyPhase(slug) || ensurePhaseSlug({ ...p, name }),
              }
            : p,
        ),
      };
    });
    setDirty(true);
  }

  function commitRenamePhase() {
    if (!editingPhaseId) return;
    const name = editingPhaseName.trim();
    if (name) renamePhase(editingPhaseId, name, editingPhaseSlug);
    setEditingPhaseId(null);
  }

  function removePhase(phaseId: string) {
    setDraft((prev) => {
      if (!prev || prev.phases.length <= 1) return prev;
      return {
        ...prev,
        phases: prev.phases.filter((p) => p.id !== phaseId),
        tasks: prev.tasks.filter((t) => t.phaseId !== phaseId),
      };
    });
    setDirty(true);
    setPhaseMenuId(null);
  }

  function updateDraft(patch: Partial<WorkflowTemplate>) {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  }

  function updateTask(taskId: string, patch: Partial<TaskTemplate>) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tasks: prev.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
      };
    });
    setDirty(true);
  }

  function addPhase() {
    const phaseId = uid();
    const name = `Fase ${(draft?.phases.length ?? 0) + 1}`;
    const phase = makePhase({
      id: phaseId,
      name,
      order: (draft?.phases.reduce((m, p) => Math.max(m, p.order), -1) ?? -1) + 1,
    });
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, phases: [...prev.phases, phase] };
    });
    setEditingPhaseId(phaseId);
    setEditingPhaseName(name);
    setEditingPhaseSlug(phase.slug);
    setDirty(true);
  }

  function addTask(phaseId: string) {
    const taskId = uid();
    const task: TaskTemplate = {
      id: taskId,
      name: tNow("tv.newTask"),
      phaseId,
      rules: [defaultRule("tpl")],
      distributeUnit: "portion",
      distributePolicy: "contiguous",
      steps: [],
    };
    setDraft((prev) => {
      if (!prev) return prev;
      const tasks = Array.isArray(prev.tasks) ? prev.tasks : [];
      return { ...prev, tasks: [...tasks, task] };
    });
    setTaskEditId(taskId);
    setDirty(true);
  }

  function removeTask(taskId: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, tasks: (prev.tasks ?? []).filter((t) => t.id !== taskId) };
    });
    setTaskEditId((id) => (id === taskId ? null : id));
    setDirty(true);
  }

  function setTaskResources(taskId: string, resources: ScopeKey[]) {
    const rules = resources.map(defaultRule);
    updateTask(taskId, { rules: rules.length ? rules : [defaultRule("tpl")] });
  }

  async function save() {
    if (!draft || !canManage) return;
    const normalized = normalizeWorkflowTemplate(draft);
    if (!normalized) {
      setError(t("wf.needName"));
      return;
    }
    if (!normalized.tasks.length) {
      setError(t("wf.needTask"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next: WorkflowsCatalog = {
        schema: WORKFLOWS_SCHEMA,
        workflows: catalog.workflows.some((w) => w.id === normalized.id)
          ? catalog.workflows.map((w) => (w.id === normalized.id ? normalized : w))
          : [...catalog.workflows, normalized],
      };
      saveLocalWorkflows(next);
      if (pmOrg) await saveWorkflowsToDcs(session, pmOrg, next);
      setCatalog(next);
      setDraft(structuredClone(normalized));
      setDirty(false);
      announce(
        pmOrg
          ? t("tv.workflowSavedOrg").replace("{name}", normalized.name).replace("{org}", pmOrg).replace("{repo}", PM_REPO_NAME)
          : t("tv.savedLocal").replace("{name}", normalized.name),
      );
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeWorkflow(id: string) {
    if (!canManage) return;
    if (!window.confirm(t("wf.confirmDelete"))) return;
    setBusy(true);
    try {
      const next: WorkflowsCatalog = {
        schema: WORKFLOWS_SCHEMA,
        workflows: catalog.workflows.filter((w) => w.id !== id),
      };
      saveLocalWorkflows(next);
      if (pmOrg) await saveWorkflowsToDcs(session, pmOrg, next);
      setCatalog(next);
      if (selectedId === id) {
        setSelectedId(null);
        setDraft(null);
        onSelectWorkflow?.(undefined);
      }
      announce(t("wf.deleted"));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  const sortedPhases = useMemo(
    () =>
      draft
        ? [...draft.phases].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "es"))
        : [],
    [draft],
  );

  const draftSummary = draft
    ? `${t(draft.phases.length === 1 ? "wf.phasesOne" : "wf.phasesMany").replace("{n}", String(draft.phases.length))} · ${t(draft.tasks.length === 1 ? "tv.tasksOne" : "tv.tasksMany").replace("{n}", String(draft.tasks.length))}`
    : "";

  return (
    <div className={cn("hub", draft && "hub--editing-workflow")}>
      <div className="hub-header">
        <div>
          <h1 className={cn("hub-title", draft && "hub-title--quiet")}>{t("wf.title")}</h1>
          {listHelpOpen ? (
            <p className="hub-lede">
              {t("wf.help")}
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
          {canManage ? (
            <Button
              type="button"
              size="sm"
              variant={draft || catalog.workflows.length ? "ghost" : "default"}
              onClick={createNew}
              disabled={busy}
            >
              {t("wf.newTpl")}
            </Button>
          ) : null}
          {canManage
            ? shippedWorkflows().map((base) => (
                <Button key={base.id} type="button" size="sm" variant="ghost" onClick={() => createFromShipped(base)} disabled={busy}>
                  {t("wf.fromShipped").replace("{name}", localized(base.name, base.names, language))}
                </Button>
              ))
            : null}
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!catalog.workflows.length && !draft ? (
        <Alert>
          <AlertDescription>
            {t("wf.noneYet")}
            {canManage ? (
              <button type="button" className="underline underline-offset-2" onClick={createNew}>
                {t("wf.createFirst")}
              </button>
            ) : (
              t("wf.askManager")
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      {draft ? (
        <>
          <div className="workflows-identity">
            <div className="workflows-identity__row">
              <div className="workflows-identity__title-wrap">
                {canManage && editingName ? (
                  <Input
                    value={draft.name}
                    onChange={(e) => updateDraft({ name: e.target.value })}
                    onBlur={commitRenameWorkflow}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                      }
                      if (e.key === "Escape") {
                        setEditingName(false);
                      }
                    }}
                    className="workflows-identity__title-input"
                    aria-label={t("wf.nameAria")}
                    autoFocus
                  />
                ) : canManage ? (
                  <button
                    type="button"
                    className="workflows-identity__title"
                    onClick={() => setEditingName(true)}
                    title={t("wf.clickRenameTpl")}
                  >
                    {nm(draft.name)}
                  </button>
                ) : (
                  <h2 className="workflows-identity__title">{nm(draft.name)}</h2>
                )}
                <span className="workflows-identity__status">{draftSummary}</span>
                {dirty ? (
                  <span className="workflows-identity__status">{t("wf.unsaved")}</span>
                ) : null}
              </div>

              {catalog.workflows.length > 1 ? (
                <Select value={draft.id} onValueChange={switchWorkflow}>
                  <SelectTrigger
                    className="workflows-identity__switcher"
                    aria-label={t("wf.switchAria")}
                  >
                    {t("wf.switch")}
                  </SelectTrigger>
                  <SelectContent>
                    {catalog.workflows.map((wf) => {
                      const shown = draft.id === wf.id ? draft : wf;
                      return (
                        <SelectItem key={wf.id} value={wf.id}>
                          {nm(shown.name)}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              ) : null}

              {canManage ? (
                <div className="phases-section__tools">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-expanded={templateMenuOpen}
                    aria-label={t("wf.moreTpl")}
                    onClick={() => {
                      setTemplateMenuOpen((v) => !v);
                      setCreateMenuOpen(false);
                      setPhaseMenuId(null);
                    }}
                  >
                    ⋯
                  </Button>
                  {templateMenuOpen ? (
                    <div className="phases-menu phases-menu--end" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        className="phases-menu__item"
                        onClick={() => {
                          setTemplateMenuOpen(false);
                          setEditingName(true);
                        }}
                      >
                        {t("wf.rename")}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="phases-menu__item"
                        onClick={() => {
                          setTemplateMenuOpen(false);
                          setDescOpen(true);
                        }}
                      >
                        {draft.description?.trim() ? t("wf.editDesc") : t("wf.addDescMenu")}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="phases-menu__item phases-menu__item--danger"
                        disabled={busy}
                        onClick={() => {
                          setTemplateMenuOpen(false);
                          void removeWorkflow(draft.id);
                        }}
                      >
                        {t("wf.deleteTpl")}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {descOpen || draft.description?.trim() ? (
              <div className="workflows-identity__desc grid gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="wf-desc">{t("tv.description")}</Label>
                  {canManage ? (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        updateDraft({ description: undefined });
                        setDescOpen(false);
                      }}
                    >
                      {t("tv.remove")}
                    </button>
                  ) : null}
                </div>
                <textarea
                  id="wf-desc"
                  className="min-h-[2.5rem] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={draft.description ?? ""}
                  disabled={!canManage}
                  onChange={(e) => updateDraft({ description: e.target.value })}
                  placeholder={t("wf.descPlaceholder")}
                />
              </div>
            ) : canManage ? (
              <button
                type="button"
                className="workflows-identity__desc-add"
                onClick={() => setDescOpen(true)}
              >
                {t("tv.addDescription")}
              </button>
            ) : null}
          </div>

          <div className="workflows-board-head">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("tv.phasesAndTasks")}
            </h2>
            {canManage ? (
              <div className="phases-create">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-expanded={createMenuOpen}
                  onClick={() => {
                    setCreateMenuOpen((v) => !v);
                    setPhaseMenuId(null);
                    setTemplateMenuOpen(false);
                  }}
                >
                  {t("wf.addPhaseTask")}
                </Button>
                {createMenuOpen ? (
                  <div className="phases-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      className="phases-menu__item"
                      onClick={() => {
                        setCreateMenuOpen(false);
                        addPhase();
                      }}
                    >
                      {t("tv.menuPhase")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="phases-menu__item"
                      disabled={!sortedPhases[0]}
                      onClick={() => {
                        setCreateMenuOpen(false);
                        if (sortedPhases[0]) addTask(sortedPhases[0].id);
                      }}
                    >
                      {t("wf.menuTask")}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="phases-board">
            {sortedPhases.map((phase) => {
              const phaseTasks = draft.tasks.filter((t) => t.phaseId === phase.id);
              const phaseMenuOpen = phaseMenuId === phase.id;
              return (
                <section key={phase.id} className="phases-section">
                  <div className="phases-section__head">
                    <div className="phases-section__identity">
                      {canManage && editingPhaseId === phase.id ? (
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
                      ) : canManage ? (
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
                          {nm(phase.name)}
                        </button>
                      ) : (
                        <span className="phases-section__title">{nm(phase.name)}</span>
                      )}
                      <span className="phases-section__count">
                        {t(phaseTasks.length === 1 ? "tv.tasksOne" : "tv.tasksMany").replace("{n}", String(phaseTasks.length))}
                      </span>
                      {editingPhaseId === phase.id ? null : (
                        <span className="phases-section__slug" title={t("tv.shortIdAria")}>
                          {ensurePhaseSlug(phase)}
                        </span>
                      )}
                    </div>
                    {canManage ? (
                      <div className="phases-section__tools">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-expanded={phaseMenuOpen}
                          aria-label={t("tv.moreActions").replace("{name}", nm(phase.name))}
                          onClick={() => {
                            setPhaseMenuId(phaseMenuOpen ? null : phase.id);
                            setCreateMenuOpen(false);
                            setTemplateMenuOpen(false);
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
                              onClick={() => {
                                setPhaseMenuId(null);
                                addTask(phase.id);
                              }}
                            >
                              {t("tv.addTask")}
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="phases-menu__item phases-menu__item--danger"
                              disabled={draft.phases.length <= 1}
                              onClick={() => removePhase(phase.id)}
                            >
                              {t("tv.deletePhase")}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {phaseTasks.map((task) => {
                    const resources = task.rules.map((r) => resName(r.resource)).join(" · ");
                    const solver = solvers.solvers.find((s) => s.id === task.solverAppId);
                    const stepCount = task.steps?.length ?? 0;
                    const isEditing = taskEditId === task.id;
                    const taskResources = isEditing
                      ? SCOPE_KEYS.filter((k) => task.rules.some((r) => r.resource === k))
                      : [];
                    const availableResources = SCOPE_KEYS.filter((k) => !taskResources.includes(k));
                    const showSteps = stepCount > 0;
                    const claimSummary = loc(formatTaskClaimSummary(task.steps));
                    const summaryParts = [
                      resources || loc("Sin recursos"),
                      stepCount
                        ? `${t(stepCount === 1 ? "tv.stepsOne" : "tv.stepsMany").replace("{n}", String(stepCount))}${claimSummary ? ` · ${claimSummary}` : ""}`
                        : null,
                      !showSteps && solver ? solver.name : null,
                    ].filter(Boolean);
                    const showTaskSolver = !showSteps && (solverPickerOpen || Boolean(task.solverAppId));

                    function toggleTaskEdit() {
                      const next = isEditing ? null : task.id;
                      setTaskEditId(next);
                      setResourceMenuOpen(false);
                      if (next) {
                        setSolverPickerOpen(
                          Boolean(task.solverAppId) && !(task.steps?.length),
                        );
                      } else {
                        setSolverPickerOpen(false);
                      }
                    }

                    return (
                      <div
                        key={task.id}
                        className={cn(
                          "phases-task",
                          "phases-task--expandable",
                          isEditing && "phases-task--active",
                        )}
                      >
                        {isEditing ? (
                          <div className="phases-task__main phases-task__main--editing">
                            <div className="phases-task__title-row">
                              {canManage ? (
                                <Input
                                  value={task.name}
                                  onChange={(e) => updateTask(task.id, { name: e.target.value })}
                                  className="phases-task__title-input wf-title-input"
                                  aria-label={t("tv.taskNameAria")}
                                />
                              ) : (
                                <span className="phases-task__title">{nm(task.name)}</span>
                              )}
                              <button
                                type="button"
                                className="phases-task__collapse"
                                aria-expanded
                                aria-label={t("wf.closeEditor")}
                                onClick={toggleTaskEdit}
                              >
                                <ChevronDown className="phases-task__chevron phases-task__chevron--open" />
                              </button>
                            </div>
                            <span className="phases-task__summary">{summaryParts.join(" · ")}</span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="phases-task__main"
                            aria-expanded={false}
                            onClick={toggleTaskEdit}
                          >
                            <span className="phases-task__title">
                              {nm(task.name)}
                              <ChevronDown className="phases-task__chevron" aria-hidden />
                            </span>
                            <span className="phases-task__summary">{summaryParts.join(" · ")}</span>
                          </button>
                        )}

                        {isEditing ? (
                          <div className="phases-task__editor">
                            <section className="wf-editor-block">
                              <header className="wf-editor-block__head">
                                <h3 className="wf-editor-block__title">{t("tv.resources")}</h3>
                                <p className="wf-editor-block__hint">
                                  {t("wf.resourcesHint")}
                                </p>
                              </header>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {taskResources.map((key) => (
                                  <Badge key={key} variant="secondary" className="gap-1 pr-1">
                                    {resName(key)}
                                    {canManage ? (
                                      <button
                                        type="button"
                                        className="rounded-sm px-1 text-muted-foreground hover:text-foreground"
                                        aria-label={t("tv.removeRes").replace("{res}", resName(key))}
                                        onClick={() =>
                                          setTaskResources(
                                            task.id,
                                            taskResources.filter((k) => k !== key),
                                          )
                                        }
                                      >
                                        ×
                                      </button>
                                    ) : null}
                                  </Badge>
                                ))}
                                {canManage && availableResources.length ? (
                                  <div className="phases-create">
                                    <button
                                      type="button"
                                      className="wf-chip-add"
                                      aria-expanded={resourceMenuOpen}
                                      onClick={() => {
                                        setResourceMenuOpen((v) => !v);
                                      }}
                                    >
                                      {t("wf.addResource")}
                                    </button>
                                    {resourceMenuOpen ? (
                                      <div className="phases-menu" role="menu">
                                        {availableResources.map((key) => (
                                          <button
                                            key={key}
                                            type="button"
                                            role="menuitem"
                                            className="phases-menu__item"
                                            onClick={() => {
                                              setResourceMenuOpen(false);
                                              setTaskResources(task.id, [
                                                ...taskResources,
                                                key,
                                              ]);
                                            }}
                                          >
                                            {resName(key)}
                                          </button>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            </section>

                            {!showSteps ? (
                              <section className="wf-editor-block">
                                <header className="wf-editor-block__head">
                                  <h3 className="wf-editor-block__title">{t("wf.resolution")}</h3>
                                  <p className="wf-editor-block__hint">
                                    {t("wf.resolutionHint")}
                                  </p>
                                </header>
                                {showTaskSolver ? (
                                  <div className="grid gap-1.5">
                                    <div className="flex items-center justify-between gap-2">
                                      <Label>{t("tv.toolAria")}</Label>
                                      {canManage ? (
                                        <button
                                          type="button"
                                          className="text-xs text-muted-foreground hover:text-foreground"
                                          onClick={() => {
                                            updateTask(task.id, { solverAppId: undefined });
                                            setSolverPickerOpen(false);
                                          }}
                                        >
                                          {t("tv.remove")}
                                        </button>
                                      ) : null}
                                    </div>
                                    <Select
                                      value={task.solverAppId || "none"}
                                      disabled={!canManage}
                                      onValueChange={(v) =>
                                        updateTask(task.id, {
                                          solverAppId: v === "none" ? undefined : v,
                                        })
                                      }
                                    >
                                      <SelectTrigger className="w-full">
                                        <SelectValue placeholder={t("tv.pickTool")} />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="none">{t("tv.none")}</SelectItem>
                                        {solvers.solvers.map((app) => (
                                          <SelectItem key={app.id} value={app.id}>
                                            {app.name}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                ) : canManage ? (
                                  <button
                                    type="button"
                                    className="wf-text-action"
                                    onClick={() => setSolverPickerOpen(true)}
                                  >
                                    {t("tv.addSolver")}
                                  </button>
                                ) : null}
                              </section>
                            ) : null}

                            <section className="wf-editor-block">
                              <MinLevelField
                                id={`wf-min-level-${task.id}`}
                                value={task.minLevel}
                                onChange={(next) => updateTask(task.id, { minLevel: next })}
                              />
                            </section>

                            <section className="wf-editor-block">
                              <EveryUnitField value={Boolean(task.everyUnit)} disabled={!canManage} onChange={(next) => updateTask(task.id, { everyUnit: next || undefined })} />
                            </section>

                            <section className="wf-editor-block">
                              <WaitsEditor
                                board={{ teams: draft.tasks as unknown as ProjectTask[], phases: draft.phases }}
                                taskId={task.id}
                                value={task.waitsFor ?? []}
                                onChange={(next) => updateTask(task.id, { waitsFor: next.length ? next : undefined })}
                              />
                            </section>

                            <section className="wf-editor-block">
                              <header className="wf-editor-block__head">
                                <h3 className="wf-editor-block__title">{t("wf.checklist")}</h3>
                                <p className="wf-editor-block__hint">
                                  {t("wf.checklistHint")}
                                </p>
                              </header>

                              {showSteps || canManage ? (
                                <StepsEditor
                                  steps={task.steps ?? []}
                                  onChange={(next) => updateTask(task.id, { steps: next.length ? next : undefined })}
                                  tools={solvers.solvers}
                                  canManage={canManage}
                                />
                              ) : (
                                <p className="wf-editor-block__empty">
                                  {t("wf.noChecklist")}
                                </p>
                              )}
                            </section>

                            <div className="wf-editor-footer">
                              {canManage ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => removeTask(task.id)}
                                >
                                  {t("wf.removeTask")}
                                </Button>
                              ) : (
                                <span />
                              )}
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setTaskEditId(null);
                                  setResourceMenuOpen(false);
                                  setSolverPickerOpen(false);
                                }}
                              >
                                {t("wf.done")}
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}

                  {!phaseTasks.length ? (
                    <p className="text-sm text-muted-foreground px-1">
                      {t("wf.noTasksInPhase")}
                      {canManage ? (
                        <>
                          {" "}
                          <button
                            type="button"
                            className="underline-offset-2 hover:underline"
                            onClick={() => addTask(phase.id)}
                          >
                            {t("tv.addTask")}
                          </button>
                        </>
                      ) : null}
                    </p>
                  ) : null}
                </section>
              );
            })}
          </div>

          {canManage && dirty ? (
            <div className="workflows-save-bar">
              <p className="text-sm text-muted-foreground">{t("wf.unsavedBar")}</p>
              <Button type="button" disabled={busy} onClick={() => void save()}>
                {busy ? t("wf.saving") : t("wf.save")}
              </Button>
            </div>
          ) : null}
        </>
      ) : catalog.workflows.length ? (
        <div className="hub-panel">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("wf.pick")}
          </h2>
          <div className="workflows-picker">
            {catalog.workflows.map((wf) => (
              <button
                key={wf.id}
                type="button"
                className="workflows-picker__item"
                onClick={() => openWorkflow(wf)}
              >
                <span className="workflows-picker__name">{nm(wf.name)}</span>
                <span className="workflows-picker__meta">
                  {t(wf.tasks.length === 1 ? "tv.tasksOne" : "tv.tasksMany").replace("{n}", String(wf.tasks.length))}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
