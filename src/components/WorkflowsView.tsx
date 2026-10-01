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
  TaskStep,
  TaskTemplate,
  WorkflowTemplate,
  WorkflowsCatalog,
} from "../domain/types";
import { SCOPE_KEYS, SCOPE_LABEL, WORKFLOWS_SCHEMA } from "../domain/types";
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
import { fcrWorkflowTemplate } from "../domain/fcrTemplate";
import { ensurePhaseSlug, makePhase, slugifyPhase } from "../domain/phaseSlug";
import { StepClaimPolicyPanel } from "./StepClaimPolicyPanel";
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
  const [catalog, setCatalog] = useState<WorkflowsCatalog>(() => loadLocalWorkflows());
  const [solvers, setSolvers] = useState<SolversCatalog>(DEFAULT_SOLVERS_CATALOG);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkflowTemplate | null>(null);
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
  const [stepMenuId, setStepMenuId] = useState<string | null>(null);
  const [stepSolverId, setStepSolverId] = useState<string | null>(null);
  const [claimPolicyStepId, setClaimPolicyStepId] = useState<string | null>(null);

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
      setError(err instanceof Error ? err.message : String(err));
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
      const ok = window.confirm("Hay cambios sin guardar. ¿Descartarlos?");
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
    setStepMenuId(null);
    setStepSolverId(null);
    setEditingName(Boolean(opts?.rename));
    onSelectWorkflow?.(wf.id);
    requestAnimationFrame(() => {
      document.querySelector(".app-main")?.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function createNew() {
    const wf = emptyWorkflow(`Flujo ${catalog.workflows.length + 1}`);
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
    announce(`Plantilla «${wf.name}» creada (guarda para publicarla).`);
  }

  /** A new template that starts from the FCR base (same flow, own copy to adjust). */
  function createFromFcr() {
    const base = fcrWorkflowTemplate();
    const wf = { ...base, id: uid(), name: `${base.name} ${catalog.workflows.length + 1}` };
    setCatalog((prev) => {
      const next = { schema: WORKFLOWS_SCHEMA, workflows: [...prev.workflows, wf] };
      saveLocalWorkflows(next);
      return next;
    });
    openWorkflow(wf, { rename: true });
    setDirty(true);
    setDescOpen(false);
    announce(`Plantilla «${wf.name}» creada desde el FCR (guarda para publicarla).`);
  }

  function commitRenameWorkflow() {
    setEditingName(false);
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) updateDraft({ name: "Sin nombre" });
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
      name: "Nueva tarea",
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

  function updateStep(taskId: string, stepId: string, patch: Partial<TaskStep>) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tasks: prev.tasks.map((t) => {
          if (t.id !== taskId) return t;
          const steps = (t.steps ?? []).map((s) =>
            s.id === stepId ? { ...s, ...patch } : s,
          );
          return { ...t, steps };
        }),
      };
    });
    setDirty(true);
  }

  function addStep(taskId: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tasks: prev.tasks.map((t) => {
          if (t.id !== taskId) return t;
          const nextIndex = (t.steps?.length ?? 0) + 1;
          const step: TaskStep = { id: uid(), name: `Paso ${nextIndex}` };
          return { ...t, steps: [...(t.steps ?? []), step] };
        }),
      };
    });
    setStepMenuId(null);
    setStepSolverId(null);
    setDirty(true);
  }

  function removeStep(taskId: string, stepId: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tasks: prev.tasks.map((t) =>
          t.id === taskId
            ? { ...t, steps: (t.steps ?? []).filter((s) => s.id !== stepId) }
            : t,
        ),
      };
    });
    setDirty(true);
  }

  function moveStep(taskId: string, stepId: string, dir: -1 | 1) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tasks: prev.tasks.map((t) => {
          if (t.id !== taskId) return t;
          const steps = [...(t.steps ?? [])];
          const i = steps.findIndex((s) => s.id === stepId);
          const j = i + dir;
          if (i < 0 || j < 0 || j >= steps.length) return t;
          [steps[i], steps[j]] = [steps[j], steps[i]];
          return { ...t, steps };
        }),
      };
    });
    setDirty(true);
  }

  async function save() {
    if (!draft || !canManage) return;
    const normalized = normalizeWorkflowTemplate(draft);
    if (!normalized) {
      setError("La plantilla necesita un nombre y al menos una tarea con recursos.");
      return;
    }
    if (!normalized.tasks.length) {
      setError("Añade al menos una tarea a la plantilla.");
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
          ? `Plantilla «${normalized.name}» guardada en ${pmOrg}/${PM_REPO_NAME}.`
          : `Plantilla «${normalized.name}» guardada en este dispositivo.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeWorkflow(id: string) {
    if (!canManage) return;
    if (!window.confirm("¿Eliminar esta plantilla de flujo?")) return;
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
      announce("Plantilla eliminada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
    ? `${draft.phases.length} fase${draft.phases.length === 1 ? "" : "s"} · ${draft.tasks.length} tarea${draft.tasks.length === 1 ? "" : "s"}`
    : "";

  return (
    <div className={cn("hub", draft && "hub--editing-workflow")}>
      <div className="hub-header">
        <div>
          <h1 className={cn("hub-title", draft && "hub-title--quiet")}>Plantillas de flujo</h1>
          {listHelpOpen ? (
            <p className="hub-lede">
              Copia al proyecto al aplicar; no es un enlace en vivo.
            </p>
          ) : null}
        </div>
        <div className="phases-header-actions">
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setListHelpOpen((v) => !v)}
          >
            {listHelpOpen ? "Ocultar ayuda" : "¿Cómo funciona?"}
          </button>
          {canManage ? (
            <Button
              type="button"
              size="sm"
              variant={draft || catalog.workflows.length ? "ghost" : "default"}
              onClick={createNew}
              disabled={busy}
            >
              + Nueva plantilla
            </Button>
          ) : null}
          {canManage ? (
            <Button type="button" size="sm" variant="ghost" onClick={createFromFcr} disabled={busy}>
              + Desde el FCR
            </Button>
          ) : null}
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
            Aún no hay plantillas.{" "}
            {canManage ? (
              <button type="button" className="underline underline-offset-2" onClick={createNew}>
                Crear la primera
              </button>
            ) : (
              "Pide a un gestor que cree una."
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
                    aria-label="Nombre de la plantilla"
                    autoFocus
                  />
                ) : canManage ? (
                  <button
                    type="button"
                    className="workflows-identity__title"
                    onClick={() => setEditingName(true)}
                    title="Clic para renombrar"
                  >
                    {draft.name}
                  </button>
                ) : (
                  <h2 className="workflows-identity__title">{draft.name}</h2>
                )}
                <span className="workflows-identity__status">{draftSummary}</span>
                {dirty ? (
                  <span className="workflows-identity__status">sin guardar</span>
                ) : null}
              </div>

              {catalog.workflows.length > 1 ? (
                <Select value={draft.id} onValueChange={switchWorkflow}>
                  <SelectTrigger
                    className="workflows-identity__switcher"
                    aria-label="Cambiar plantilla"
                  >
                    Cambiar
                  </SelectTrigger>
                  <SelectContent>
                    {catalog.workflows.map((wf) => {
                      const shown = draft.id === wf.id ? draft : wf;
                      return (
                        <SelectItem key={wf.id} value={wf.id}>
                          {shown.name}
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
                    aria-label="Más acciones de la plantilla"
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
                        Renombrar
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
                        {draft.description?.trim() ? "Editar descripción" : "Añadir descripción"}
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
                        Eliminar plantilla
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {descOpen || draft.description?.trim() ? (
              <div className="workflows-identity__desc grid gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="wf-desc">Descripción</Label>
                  {canManage ? (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        updateDraft({ description: undefined });
                        setDescOpen(false);
                      }}
                    >
                      Quitar
                    </button>
                  ) : null}
                </div>
                <textarea
                  id="wf-desc"
                  className="min-h-[2.5rem] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={draft.description ?? ""}
                  disabled={!canManage}
                  onChange={(e) => updateDraft({ description: e.target.value })}
                  placeholder="Opcional — visible al aplicar en un proyecto"
                />
              </div>
            ) : canManage ? (
              <button
                type="button"
                className="workflows-identity__desc-add"
                onClick={() => setDescOpen(true)}
              >
                + Añadir descripción
              </button>
            ) : null}
          </div>

          <div className="workflows-board-head">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Fases y tareas
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
                  + Fase / tarea
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
                      Fase
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
                      Tarea
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
                            aria-label="Renombrar fase"
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
                            aria-label="Identificador corto de la fase"
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
                          title="Clic para renombrar la fase"
                        >
                          {phase.name}
                        </button>
                      ) : (
                        <span className="phases-section__title">{phase.name}</span>
                      )}
                      <span className="phases-section__count">
                        {phaseTasks.length} tarea{phaseTasks.length === 1 ? "" : "s"}
                      </span>
                      {editingPhaseId === phase.id ? null : (
                        <span className="phases-section__slug" title="Identificador corto de la fase">
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
                          aria-label={`Más acciones · ${phase.name}`}
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
                              Añadir tarea
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="phases-menu__item phases-menu__item--danger"
                              disabled={draft.phases.length <= 1}
                              onClick={() => removePhase(phase.id)}
                            >
                              Eliminar fase
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {phaseTasks.map((task) => {
                    const resources = task.rules.map((r) => SCOPE_LABEL[r.resource]).join(" · ");
                    const solver = solvers.solvers.find((s) => s.id === task.solverAppId);
                    const stepCount = task.steps?.length ?? 0;
                    const isEditing = taskEditId === task.id;
                    const taskResources = isEditing
                      ? SCOPE_KEYS.filter((k) => task.rules.some((r) => r.resource === k))
                      : [];
                    const availableResources = SCOPE_KEYS.filter((k) => !taskResources.includes(k));
                    const showSteps = stepCount > 0;
                    const claimSummary = formatTaskClaimSummary(task.steps);
                    const summaryParts = [
                      resources || "Sin recursos",
                      stepCount
                        ? `${stepCount} paso${stepCount === 1 ? "" : "s"}${claimSummary ? ` · ${claimSummary}` : ""}`
                        : null,
                      !showSteps && solver ? solver.name : null,
                    ].filter(Boolean);
                    const showTaskSolver = !showSteps && (solverPickerOpen || Boolean(task.solverAppId));

                    function toggleTaskEdit() {
                      const next = isEditing ? null : task.id;
                      setTaskEditId(next);
                      setResourceMenuOpen(false);
                      setStepMenuId(null);
                      setStepSolverId(null);
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
                                  aria-label="Nombre de la tarea"
                                />
                              ) : (
                                <span className="phases-task__title">{task.name}</span>
                              )}
                              <button
                                type="button"
                                className="phases-task__collapse"
                                aria-expanded
                                aria-label="Cerrar editor"
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
                              {task.name}
                              <ChevronDown className="phases-task__chevron" aria-hidden />
                            </span>
                            <span className="phases-task__summary">{summaryParts.join(" · ")}</span>
                          </button>
                        )}

                        {isEditing ? (
                          <div className="phases-task__editor">
                            <section className="wf-editor-block">
                              <header className="wf-editor-block__head">
                                <h3 className="wf-editor-block__title">Recursos</h3>
                                <p className="wf-editor-block__hint">
                                  Qué material cubre esta tarea.
                                </p>
                              </header>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {taskResources.map((key) => (
                                  <Badge key={key} variant="secondary" className="gap-1 pr-1">
                                    {SCOPE_LABEL[key]}
                                    {canManage ? (
                                      <button
                                        type="button"
                                        className="rounded-sm px-1 text-muted-foreground hover:text-foreground"
                                        aria-label={`Quitar ${SCOPE_LABEL[key]}`}
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
                                        setStepMenuId(null);
                                      }}
                                    >
                                      + Recurso
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
                                            {SCOPE_LABEL[key]}
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
                                  <h3 className="wf-editor-block__title">Resolución</h3>
                                  <p className="wf-editor-block__hint">
                                    Opcional si la tarea no tiene checklist.
                                  </p>
                                </header>
                                {showTaskSolver ? (
                                  <div className="grid gap-1.5">
                                    <div className="flex items-center justify-between gap-2">
                                      <Label>Herramienta</Label>
                                      {canManage ? (
                                        <button
                                          type="button"
                                          className="text-xs text-muted-foreground hover:text-foreground"
                                          onClick={() => {
                                            updateTask(task.id, { solverAppId: undefined });
                                            setSolverPickerOpen(false);
                                          }}
                                        >
                                          Quitar
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
                                        <SelectValue placeholder="Elige herramienta" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="none">Ninguna</SelectItem>
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
                                    + Herramienta para resolver
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
                              <WaitsEditor
                                board={{ teams: draft.tasks as unknown as ProjectTask[], phases: draft.phases }}
                                taskId={task.id}
                                value={task.waitsFor ?? []}
                                onChange={(next) => updateTask(task.id, { waitsFor: next.length ? next : undefined })}
                              />
                            </section>

                            <section className="wf-editor-block">
                              <header className="wf-editor-block__head">
                                <h3 className="wf-editor-block__title">Checklist</h3>
                                <p className="wf-editor-block__hint">
                                  Pasos que el trabajador marca al completar.
                                </p>
                              </header>

                              {showSteps ? (
                                <ol className="wf-steps">
                                  {(task.steps ?? []).map((step, idx) => {
                                    const stepSolver = solvers.solvers.find(
                                      (s) => s.id === step.solverAppId,
                                    );
                                    const stepMenuOpen = stepMenuId === step.id;
                                    const editingStepSolver = stepSolverId === step.id;
                                    return (
                                      <li key={step.id} className="wf-step">
                                        <div className="wf-step__lead">
                                          <span className="wf-step__index" aria-hidden>
                                            {idx + 1}
                                          </span>
                                          {canManage && (task.steps?.length ?? 0) > 1 ? (
                                            <div className="wf-step__reorder">
                                              <button
                                                type="button"
                                                className="wf-step__reorder-btn"
                                                disabled={idx === 0}
                                                aria-label={`Subir paso ${idx + 1}`}
                                                onClick={() => moveStep(task.id, step.id, -1)}
                                              >
                                                ↑
                                              </button>
                                              <button
                                                type="button"
                                                className="wf-step__reorder-btn"
                                                disabled={idx >= (task.steps?.length ?? 0) - 1}
                                                aria-label={`Bajar paso ${idx + 1}`}
                                                onClick={() => moveStep(task.id, step.id, 1)}
                                              >
                                                ↓
                                              </button>
                                            </div>
                                          ) : null}
                                        </div>
                                        <div className="wf-step__body">
                                          <Input
                                            value={step.name}
                                            disabled={!canManage}
                                            onChange={(e) =>
                                              updateStep(task.id, step.id, {
                                                name: e.target.value,
                                              })
                                            }
                                            className="wf-step__name"
                                            aria-label={`Paso ${idx + 1}`}
                                            placeholder={`Paso ${idx + 1}`}
                                          />
                                          <div className="wf-step__tool">
                                            {editingStepSolver ? (
                                              <Select
                                                value={step.solverAppId || "none"}
                                                disabled={!canManage}
                                                onValueChange={(v) => {
                                                  updateStep(task.id, step.id, {
                                                    solverAppId:
                                                      v === "none" ? undefined : v,
                                                  });
                                                  setStepSolverId(null);
                                                }}
                                              >
                                                <SelectTrigger className="h-8 w-full max-w-[14rem]">
                                                  <SelectValue placeholder="Herramienta" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  <SelectItem value="none">
                                                    Sin herramienta
                                                  </SelectItem>
                                                  {solvers.solvers.map((app) => (
                                                    <SelectItem key={app.id} value={app.id}>
                                                      {app.name}
                                                    </SelectItem>
                                                  ))}
                                                </SelectContent>
                                              </Select>
                                            ) : step.solverAppId ? (
                                              <button
                                                type="button"
                                                className="wf-step__tool-chip"
                                                disabled={!canManage}
                                                onClick={() => {
                                                  setStepSolverId(step.id);
                                                  setStepMenuId(null);
                                                }}
                                              >
                                                {stepSolver?.name ?? "Herramienta"}
                                              </button>
                                            ) : canManage ? (
                                              <button
                                                type="button"
                                                className="wf-step__tool-add"
                                                onClick={() => {
                                                  setStepSolverId(step.id);
                                                  setStepMenuId(null);
                                                }}
                                              >
                                                + Herramienta
                                              </button>
                                            ) : null}
                                          </div>

                                          <StepClaimPolicyPanel
                                            step={step}
                                            steps={task.steps ?? []}
                                            stepIndex={idx}
                                            expanded={claimPolicyStepId === step.id}
                                            onExpandedChange={(open) => {
                                              setClaimPolicyStepId(open ? step.id : null);
                                              if (open) setStepMenuId(null);
                                            }}
                                            onChange={(next) =>
                                              updateStep(task.id, step.id, next)
                                            }
                                            canManage={canManage}
                                          />
                                        </div>
                                        {canManage ? (
                                          <div className="phases-section__tools wf-step__more">
                                            <Button
                                              type="button"
                                              size="sm"
                                              variant="ghost"
                                              aria-expanded={stepMenuOpen}
                                              aria-label={`Más acciones · paso ${idx + 1}`}
                                              onClick={() => {
                                                setStepMenuId(stepMenuOpen ? null : step.id);
                                                setResourceMenuOpen(false);
                                                setStepSolverId(null);
                                              }}
                                            >
                                              ⋯
                                            </Button>
                                            {stepMenuOpen ? (
                                              <div
                                                className="phases-menu phases-menu--end"
                                                role="menu"
                                              >
                                                <button
                                                  type="button"
                                                  role="menuitem"
                                                  className="phases-menu__item"
                                                  onClick={() => {
                                                    setStepMenuId(null);
                                                    setStepSolverId(step.id);
                                                  }}
                                                >
                                                  {step.solverAppId
                                                    ? "Cambiar herramienta"
                                                    : "Añadir herramienta"}
                                                </button>
                                                {step.solverAppId ? (
                                                  <button
                                                    type="button"
                                                    role="menuitem"
                                                    className="phases-menu__item"
                                                    onClick={() => {
                                                      setStepMenuId(null);
                                                      updateStep(task.id, step.id, {
                                                        solverAppId: undefined,
                                                      });
                                                    }}
                                                  >
                                                    Quitar herramienta
                                                  </button>
                                                ) : null}
                                                <button
                                                  type="button"
                                                  role="menuitem"
                                                  className="phases-menu__item phases-menu__item--danger"
                                                  onClick={() => {
                                                    setStepMenuId(null);
                                                    removeStep(task.id, step.id);
                                                  }}
                                                >
                                                  Quitar paso
                                                </button>
                                              </div>
                                            ) : null}
                                          </div>
                                        ) : null}
                                      </li>
                                    );
                                  })}
                                </ol>
                              ) : (
                                <p className="wf-editor-block__empty">
                                  Sin checklist: el trabajador solo cierra la subtarea.
                                </p>
                              )}

                              {canManage ? (
                                <button
                                  type="button"
                                  className="wf-add-step"
                                  onClick={() => addStep(task.id)}
                                >
                                  + Añadir paso
                                </button>
                              ) : null}
                            </section>

                            <div className="wf-editor-footer">
                              {canManage ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => removeTask(task.id)}
                                >
                                  Quitar tarea
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
                                  setStepMenuId(null);
                                  setStepSolverId(null);
                                  setSolverPickerOpen(false);
                                }}
                              >
                                Listo
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}

                  {!phaseTasks.length ? (
                    <p className="text-sm text-muted-foreground px-1">
                      Sin tareas en esta fase.
                      {canManage ? (
                        <>
                          {" "}
                          <button
                            type="button"
                            className="underline-offset-2 hover:underline"
                            onClick={() => addTask(phase.id)}
                          >
                            Añadir tarea
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
              <p className="text-sm text-muted-foreground">Cambios sin guardar en esta plantilla.</p>
              <Button type="button" disabled={busy} onClick={() => void save()}>
                {busy ? "Guardando…" : "Guardar"}
              </Button>
            </div>
          ) : null}
        </>
      ) : catalog.workflows.length ? (
        <div className="hub-panel">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Elige una plantilla
          </h2>
          <div className="workflows-picker">
            {catalog.workflows.map((wf) => (
              <button
                key={wf.id}
                type="button"
                className="workflows-picker__item"
                onClick={() => openWorkflow(wf)}
              >
                <span className="workflows-picker__name">{wf.name}</span>
                <span className="workflows-picker__meta">
                  {wf.tasks.length} tarea{wf.tasks.length === 1 ? "" : "s"}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
