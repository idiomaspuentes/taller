import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { GtSession } from "../dcs/auth";
import { loadSolversCatalog } from "../dcs/issues";
import { loadWorkflowsFromDcs, saveWorkflowsToDcs } from "../dcs/persist";
import { saveProjectChanges, useProjectWork, workChanged } from "../dcs/projectPlan";
import { loadTeamOptions, type TeamOptions } from "../dcs/startBook";
import { explainError } from "../dcs/userError";
import { boardWithPlan, planImpact, planOfBoard } from "../domain/plan";
import { localized, shippedWorkflows } from "../domain/processes";
import { DEFAULT_SOLVERS_CATALOG, type SolverApp } from "../domain/solvers";
import { DEFAULT_SOURCE_PACKAGE, resolveSourcePackage, sourcePackageFor, sourcePackageLang } from "../domain/sourcePackage";
import { loadLocalWorkflows, mergeWorkflowCatalogs, normalizeWorkflowTemplate, saveLocalWorkflows } from "../domain/store";
import { localizeName } from "../domain/templateNames";
import { WORKFLOWS_SCHEMA, type AssignmentsDoc, type InventoryDoc } from "../domain/types";
import { boardToWorkflowTemplate, upgradeBoardToWorkflow, workflowUpdateFor } from "../domain/workflows";
import { useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";
import { PlanEditor } from "./PlanEditor";
import { planProblems } from "./planIssueText";

type Props = {
  session: GtSession;
  pmOrg: string;
  board: AssignmentsDoc;
  inventory: InventoryDoc | null;
  /** The project as it was saved: the app takes it as the one in hand. */
  onSaved: (board: AssignmentsDoc) => void;
  announce: (msg: string) => void;
};

/**
 * «Proceso» of a project under way: the same editor as a template or a draft, on a copy. Nothing changes for the
 * team until «Guardar cambios», which says first what the change does to the work that already exists.
 */
export function ProjectPlanView({ session, pmOrg, board, inventory, onSaved, announce }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const [edited, setEditedDoc] = useState<AssignmentsDoc>(board);
  const [dirty, setDirty] = useState(false);
  /** A change made here: kept apart from the project in hand until it is saved. */
  const setEdited = (next: AssignmentsDoc) => {
    setEditedDoc(next);
    setDirty(true);
  };
  const reset = (next: AssignmentsDoc) => {
    setEditedDoc(next);
    setDirty(false);
  };
  const [tools, setTools] = useState<SolverApp[]>(DEFAULT_SOLVERS_CATALOG.solvers);
  const [teams, setTeams] = useState<TeamOptions | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [naming, setNaming] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const work = useProjectWork(session, pmOrg, board.projectId);

  // Another project, or the same one read again from Door43 while nothing was being changed here.
  // The project in hand changed (another one was opened, or this one was read again): what is shown follows it,
  // unless something is being changed here.
  useEffect(() => {
    if (!dirty) setEditedDoc(board);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);

  useEffect(() => {
    let alive = true;
    loadSolversCatalog(session, pmOrg)
      .then((catalog) => alive && setTools(catalog.solvers))
      .catch(() => undefined);
    loadTeamOptions({ session, pmOrg, lang: board.lang })
      .then((rows) => alive && setTeams(rows))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [session, pmOrg, board.lang]);

  const templates = useMemo(() => [...loadLocalWorkflows().workflows, ...shippedWorkflows()], []);
  const process = templates.find((workflow) => workflow.id === board.workflowId);
  const update = workflowUpdateFor(edited, templates);
  const problems = useMemo(() => (dirty ? planProblems(planOfBoard(edited), t, language) : []), [dirty, edited, t, language]);
  const impact = useMemo(() => planImpact(planOfBoard(board), planOfBoard(edited)), [board, edited]);
  const closing = impact.removedTasks.reduce((sum, task) => sum + work.workOf(task.id), 0);
  const relays = inventory && dirty ? workChanged(board, edited, inventory) : false;
  const name = (row: { name: string; names?: Partial<Record<string, string>> }) => localizeName(row.names?.[language] ?? row.name, language);

  async function save() {
    if (problems.length) return;
    setBusy(t("wf.saving"));
    setError("");
    try {
      const saved = await saveProjectChanges({ session, pmOrg, before: board, after: edited, inventory, onProgress: (done, total) => setBusy(`${t("pp.updatingWork")} · ${done} / ${total}`) });
      reset(saved.board);
      onSaved(saved.board);
      void work.reload();
      const parts = [t("pp.saved"), saved.created ? t(saved.created === 1 ? "pp.createdOne" : "pp.createdMany").replace("{n}", String(saved.created)) : "", saved.closed ? t(saved.closed === 1 ? "pp.closedOne" : "pp.closedMany").replace("{n}", String(saved.closed)) : "", ...saved.warnings];
      announce(parts.filter(Boolean).join(" "));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy("");
    }
  }

  async function saveAsTemplate() {
    const title = (naming ?? "").trim();
    if (!title) return;
    setBusy(t("wf.saving"));
    setError("");
    try {
      const made = normalizeWorkflowTemplate({ ...boardToWorkflowTemplate(edited, { name: title }), version: 1 });
      if (!made) throw new Error(t("tp.needName"));
      const remote = await loadWorkflowsFromDcs(session, pmOrg);
      const catalog = remote ? mergeWorkflowCatalogs(loadLocalWorkflows(), remote) : loadLocalWorkflows();
      const next = { schema: WORKFLOWS_SCHEMA, workflows: [...catalog.workflows, made] };
      saveLocalWorkflows(next);
      await saveWorkflowsToDcs(session, pmOrg, next);
      setNaming(null);
      announce(t("dp.templateSaved").replace("{name}", title));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy("");
    }
  }

  const pkg = resolveSourcePackage(edited.settings);
  const setSource = (owner: string, lang: string) => {
    const isDefault = owner === DEFAULT_SOURCE_PACKAGE.owner && lang === sourcePackageLang(DEFAULT_SOURCE_PACKAGE);
    setEdited({ ...edited, settings: { ...edited.settings, sourcePackage: isDefault ? undefined : sourcePackageFor(owner, lang) } });
  };

  return (
    <div className="pf">
      <div className="hub-header">
        <div>
          <h1 className="hub-title">{t("pp.title")}</h1>
          <p className="hub-lede">{process ? t("pp.ledeFrom").replace("{process}", localized(process.name, process.names, language)) : t("pp.lede")}</p>
        </div>
        <Button type="button" size="sm" variant="ghost" disabled={Boolean(busy) || !edited.teams.length} onClick={() => setNaming(naming === null ? edited.title || edited.projectId : null)}>
          {t("tv.saveAsTemplate")}
        </Button>
      </div>

      {update ? (
        <div className="af-stale" role="status">
          <p style={{ margin: 0 }}>{t("tv.processUpdate").replace("{name}", localized(update.name, update.names, language)).replace("{v}", String(update.version))}</p>
          <Button type="button" size="sm" className="mt-2" onClick={() => setEdited(upgradeBoardToWorkflow(edited, update).board)}>
            {t("pp.bringUpdate")}
          </Button>
        </div>
      ) : null}

      {naming !== null ? (
        <form
          className="hub-panel dp-template"
          onSubmit={(e) => {
            e.preventDefault();
            void saveAsTemplate();
          }}
        >
          <label className="pe-label" htmlFor="pp-template-name">
            {t("dp.templateName")}
          </label>
          <input id="pp-template-name" className="af-input" value={naming} autoFocus onChange={(e) => setNaming(e.target.value)} />
          <p className="pe-hint">{t("dp.templateHint")}</p>
          <div className="pf-footer__actions">
            <Button type="button" size="sm" variant="ghost" onClick={() => setNaming(null)}>
              {t("pj.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={Boolean(busy) || !naming.trim()}>
              {t("tp.save")}
            </Button>
          </div>
        </form>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {problems.length ? (
        <div className="pf-problems" role="alert">
          <p>{t("pp.problems")}</p>
          <ul>
            {problems.slice(0, 6).map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <PlanEditor
        plan={planOfBoard(edited)}
        onChange={(plan) => setEdited(boardWithPlan(edited, plan))}
        tools={tools}
        resourceNames={edited.settings?.resourceNames}
        teams={teams}
        readOnly={Boolean(busy)}
        book={inventory ? { code: (edited.books?.[0] || edited.book).toUpperCase(), portions: inventory.portions.map((portion) => ({ id: portion.id || portion.ref, ref: portion.ref, chapter: portion.chapter })) } : undefined}
        workOf={work.workOf}
      />

      <div className="hub-panel">
        <button type="button" className="pe-more" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}>
          {t("tv.projectSettings")}
        </button>
        {settingsOpen ? (
          <div className="grid gap-3">
            <label className="pe-check">
              <input type="checkbox" checked={Boolean(edited.settings?.allowSelfAssign)} onChange={(e) => setEdited({ ...edited, settings: { ...edited.settings, allowSelfAssign: e.target.checked } })} />
              <span>
                {t("tv.allowSelf")}
                <small className="pe-hint">{t("tv.allowSelfHelp")}</small>
              </span>
            </label>
            <div className="pe-field">
              <span className="pe-label">{t("tv.refResources")}</span>
              <small className="pe-hint">{t("tv.refHelp")}</small>
              <div className="pp-source">
                <label>
                  <span className="pe-hint">{t("nav.organization")}</span>
                  <input className="af-input" value={pkg.owner} onChange={(e) => setSource(e.target.value, sourcePackageLang(pkg))} />
                </label>
                <label>
                  <span className="pe-hint">{t("tv.language")}</span>
                  <input className="af-input" value={sourcePackageLang(pkg)} onChange={(e) => setSource(pkg.owner, e.target.value)} />
                </label>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {dirty ? (
        <div className="pf-footer">
          <div className="pp-impact">
            <p>
              <b>{busy || t("pp.unsaved")}</b>
            </p>
            {!busy && impact.removedTasks.length ? (
              <p>
                {t(closing ? "pp.removes" : "pp.removesNoWork")
                  .replace("{tasks}", impact.removedTasks.map(name).join(", "))
                  .replace("{n}", String(closing))}
              </p>
            ) : null}
            {!busy && impact.changedSteps.some((task) => work.workOf(task.id)) ? (
              <p>
                {t("pp.changesSteps").replace(
                  "{tasks}",
                  impact.changedSteps
                    .filter((task) => work.workOf(task.id))
                    .map(name)
                    .join(", "),
                )}
              </p>
            ) : null}
            {!busy && relays ? <p>{t("pp.relays")}</p> : null}
          </div>
          <div className="pf-footer__actions">
            <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => reset(board)}>
              {t("pp.discard")}
            </Button>
            <Button type="button" disabled={Boolean(busy) || problems.length > 0} onClick={() => void save()}>
              {t("pp.save")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
