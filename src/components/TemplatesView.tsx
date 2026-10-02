import { useCallback, useEffect, useMemo, useState } from "react";
import { tallerConfig } from "../../taller.config";
import { Copy, Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { GtSession } from "../dcs/auth";
import { loadSolversCatalog } from "../dcs/issues";
import { loadWorkflowsFromDcs, saveWorkflowsToDcs } from "../dcs/persist";
import { loadTeamOptions, type TeamOptions } from "../dcs/startBook";
import { explainError } from "../dcs/userError";
import { uid } from "../domain/assignment";
import { DEFAULT_MAX_CHAPTER_VERSES } from "../domain/handoff";
import { planOfWorkflow, workflowWithPlan } from "../domain/plan";
import { localized, shippedWorkflows } from "../domain/processes";
import { DEFAULT_SOLVERS_CATALOG, type SolverApp } from "../domain/solvers";
import { loadLocalWorkflows, mergeWorkflowCatalogs, normalizeWorkflowTemplate, saveLocalWorkflows } from "../domain/store";
import { PM_REPO_NAME, WORKFLOWS_SCHEMA, type WorkflowTemplate, type WorkflowsCatalog } from "../domain/types";
import { workflowProblems } from "../domain/workflowCheck";
import { emptyWorkflow } from "../domain/workflows";
import { useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";
import { PlanEditor } from "./PlanEditor";
import { PlanFrame } from "./PlanFrame";

type Props = {
  session: GtSession;
  pmOrg: string;
  lang: string;
  canManage: boolean;
  announce: (msg: string) => void;
  /** The template in the address: one of the organization's, one shipped with the app, or `nueva`. */
  focusWorkflowId?: string;
  onSelectWorkflow: (id: string | undefined) => void;
};

export const NEW_TEMPLATE = "nueva";

/**
 * «Plantillas»: the processes the organization starts its projects from. A template is edited with the same editor
 * as a project (`PlanEditor`); the ones shipped with the app are read here and copied to be changed.
 */
export function TemplatesView({ session, pmOrg, lang, canManage, announce, focusWorkflowId, onSelectWorkflow }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const [catalog, setCatalog] = useState<WorkflowsCatalog>(() => loadLocalWorkflows());
  const [tools, setTools] = useState<SolverApp[]>(DEFAULT_SOLVERS_CATALOG.solvers);
  const [teams, setTeams] = useState<TeamOptions | null>(null);
  const [draft, setDraft] = useState<WorkflowTemplate | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [descOpen, setDescOpen] = useState(false);
  const shipped = useMemo(() => shippedWorkflows(), []);
  const ownIds = new Set(catalog.workflows.map((workflow) => workflow.id));
  const isShipped = Boolean(draft && !ownIds.has(draft.id) && shipped.some((workflow) => workflow.id === draft.id));
  const readOnly = !canManage || isShipped;

  const reload = useCallback(async () => {
    if (!pmOrg) return;
    setBusy(true);
    setError("");
    try {
      const remote = await loadWorkflowsFromDcs(session, pmOrg);
      const merged = remote ? mergeWorkflowCatalogs(loadLocalWorkflows(), remote) : loadLocalWorkflows();
      setCatalog(merged);
      saveLocalWorkflows(merged);
      setTools((await loadSolversCatalog(session, pmOrg)).solvers);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }, [session, pmOrg]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!pmOrg) return;
    let alive = true;
    loadTeamOptions({ session, pmOrg, lang })
      .then((rows) => alive && setTeams(rows))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [session, pmOrg, lang]);

  // The address says which template is open. One being changed is not swapped for the saved one under the person.
  useEffect(() => {
    if (!focusWorkflowId) {
      if (!dirty) setDraft(null);
      return;
    }
    if (draft?.id === focusWorkflowId || (focusWorkflowId === NEW_TEMPLATE && draft && dirty)) return;
    if (focusWorkflowId === NEW_TEMPLATE) {
      setDraft(emptyWorkflow(t("wf.flowN").replace("{n}", String(catalog.workflows.length + 1))));
      setDirty(true);
      return;
    }
    const hit = catalog.workflows.find((workflow) => workflow.id === focusWorkflowId) ?? shipped.find((workflow) => workflow.id === focusWorkflowId);
    if (hit) {
      setDraft(structuredClone(hit));
      setDirty(false);
      setDescOpen(Boolean(hit.description?.trim()));
    }
    // `draft`, `dirty` and `t` are read, not followed: this runs when the address or the catalog changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusWorkflowId, catalog.workflows, shipped]);

  function leave() {
    if (dirty && !window.confirm(t("wf.discard"))) return;
    setDraft(null);
    setDirty(false);
    onSelectWorkflow(undefined);
  }

  function change(next: WorkflowTemplate) {
    setDraft(next);
    setDirty(true);
  }

  /** An own copy of a template (shipped or not), to change freely. */
  function copy(base: WorkflowTemplate) {
    const name = t("pe.copyOf").replace("{name}", localized(base.name, base.names, language));
    setDraft({ ...structuredClone(base), id: uid(), name, names: undefined, version: undefined });
    setDirty(true);
    setDescOpen(Boolean(base.description?.trim()));
    onSelectWorkflow(NEW_TEMPLATE);
  }

  const problems = useMemo(() => (draft && !readOnly ? workflowProblems(draft, { tools, languages: tallerConfig.uiLanguages }) : []), [draft, readOnly, tools]);

  async function save() {
    if (!draft || readOnly) return;
    const normalized = normalizeWorkflowTemplate({ ...draft, version: (draft.version ?? 0) + 1 });
    if (!normalized) {
      setError(t("tp.needName"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next: WorkflowsCatalog = {
        schema: WORKFLOWS_SCHEMA,
        workflows: catalog.workflows.some((workflow) => workflow.id === normalized.id) ? catalog.workflows.map((workflow) => (workflow.id === normalized.id ? normalized : workflow)) : [...catalog.workflows, normalized],
      };
      saveLocalWorkflows(next);
      if (pmOrg) await saveWorkflowsToDcs(session, pmOrg, next);
      setCatalog(next);
      setDraft(structuredClone(normalized));
      setDirty(false);
      onSelectWorkflow(normalized.id);
      announce(pmOrg ? t("tv.workflowSavedOrg").replace("{name}", normalized.name).replace("{org}", pmOrg).replace("{repo}", PM_REPO_NAME) : t("tv.savedLocal").replace("{name}", normalized.name));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("wf.confirmDelete"))) return;
    setBusy(true);
    setError("");
    try {
      const next: WorkflowsCatalog = { schema: WORKFLOWS_SCHEMA, workflows: catalog.workflows.filter((workflow) => workflow.id !== id) };
      saveLocalWorkflows(next);
      if (pmOrg) await saveWorkflowsToDcs(session, pmOrg, next);
      setCatalog(next);
      setDraft(null);
      setDirty(false);
      onSelectWorkflow(undefined);
      announce(t("wf.deleted"));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  const summary = (workflow: WorkflowTemplate) =>
    `${t(workflow.phases.length === 1 ? "wf.phasesOne" : "wf.phasesMany").replace("{n}", String(workflow.phases.length))} · ${t(workflow.tasks.length === 1 ? "tv.tasksOne" : "tv.tasksMany").replace("{n}", String(workflow.tasks.length))}`;

  if (draft) {
    const saved = ownIds.has(draft.id);
    return (
      <PlanFrame
        back={{ label: t("wf.title"), onClick: leave }}
        kind={isShipped ? t("tp.shippedKind") : t("tp.kind")}
        status={dirty ? { text: t("wf.unsaved"), tone: "warn" } : isShipped ? { text: t("tp.readOnly") } : undefined}
        title={
          readOnly ? (
            <h1 className="pf-name">{localized(draft.name, draft.names, language)}</h1>
          ) : (
            <input className="pe-title pf-name" value={draft.name} aria-label={t("wf.nameAria")} onChange={(e) => change({ ...draft, name: e.target.value })} />
          )
        }
        actions={
          <>
            {canManage ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => copy(draft)} disabled={busy}>
                <Copy size={14} aria-hidden /> {t(isShipped ? "tp.copyToChange" : "pe.duplicate")}
              </Button>
            ) : null}
            {!readOnly && saved ? (
              <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => void remove(draft.id)} disabled={busy}>
                <Trash2 size={14} aria-hidden /> {t("wf.deleteTpl")}
              </Button>
            ) : null}
            {!readOnly ? (
              <Button type="button" onClick={() => void save()} disabled={busy || !dirty || problems.length > 0}>
                {busy ? t("wf.saving") : t("tp.save")}
              </Button>
            ) : null}
          </>
        }
        problems={problems}
        problemsTitle={t("tp.problems")}
      >
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {readOnly ? (
          draft.description ? <p className="pf-lede">{draft.descriptions?.[language] ?? draft.description}</p> : null
        ) : descOpen ? (
          <textarea className="af-textarea pf-desc" rows={2} value={draft.description ?? ""} placeholder={t("tp.descPlaceholder")} aria-label={t("pe.description")} onChange={(e) => change({ ...draft, description: e.target.value || undefined })} />
        ) : (
          <button type="button" className="pe-link" onClick={() => setDescOpen(true)}>
            {t("wf.addDescMenu")}
          </button>
        )}
        <label className="tp-limit">
          {t("wp.limitA")}{" "}
          <input
            className="af-input pe-num"
            type="number"
            min={1}
            value={draft.maxChapterVerses ?? DEFAULT_MAX_CHAPTER_VERSES}
            disabled={readOnly}
            aria-label={t("wp.limitAria")}
            onChange={(e) => {
              const value = Math.floor(Number(e.target.value));
              if (value >= 1) change({ ...draft, maxChapterVerses: value });
            }}
          />{" "}
          {t("wp.limitB")}
        </label>
        <PlanEditor plan={planOfWorkflow(draft)} onChange={(plan) => change(workflowWithPlan(draft, plan))} tools={tools} resourceNames={draft.resourceNames} teams={pmOrg ? teams : undefined} readOnly={readOnly} />
      </PlanFrame>
    );
  }

  return (
    <div className="hub">
      <div className="hub-header">
        <div>
          <h1 className="hub-title">{t("wf.title")}</h1>
          <p className="hub-lede">{t("tp.lede")}</p>
        </div>
        {canManage ? (
          <Button type="button" onClick={() => onSelectWorkflow(NEW_TEMPLATE)} disabled={busy}>
            <Plus size={16} aria-hidden /> {t("tp.new")}
          </Button>
        ) : null}
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {catalog.workflows.length ? (
        <section className="tp-group" aria-labelledby="tp-own">
          <h2 id="tp-own" className="tp-group__title">
            {t("tp.own")}
          </h2>
          <ul className="tp-list">
            {catalog.workflows.map((workflow) => (
              <li key={workflow.id}>
                <button type="button" className="tp-card" onClick={() => onSelectWorkflow(workflow.id)}>
                  <span className="tp-card__name">{localized(workflow.name, workflow.names, language)}</span>
                  <span className="tp-card__meta">{summary(workflow)}</span>
                  {workflow.description ? <span className="tp-card__desc">{workflow.description}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="tp-group" aria-labelledby="tp-shipped">
        <h2 id="tp-shipped" className="tp-group__title">
          {t("tp.shipped")}
        </h2>
        <ul className="tp-list">
          {shipped.map((workflow) => (
            <li key={workflow.id}>
              <button type="button" className="tp-card" onClick={() => onSelectWorkflow(workflow.id)}>
                <span className="tp-card__name">{localized(workflow.name, workflow.names, language)}</span>
                <span className="tp-card__meta">{summary(workflow)}</span>
                {workflow.description ? <span className="tp-card__desc">{workflow.descriptions?.[language] ?? workflow.description}</span> : null}
              </button>
            </li>
          ))}
        </ul>
        <p className="pe-hint">{t("tp.shippedHint")}</p>
      </section>
    </div>
  );
}
