import { useEffect, useMemo, useRef, useState } from "react";
import { tallerConfig } from "../../taller.config";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { GtSession } from "../dcs/auth";
import { loadSolversCatalog } from "../dcs/issues";
import { loadWorkflowsFromDcs, saveWorkflowsToDcs } from "../dcs/persist";
import { createProject, loadTeamOptions, readBook, type StartStage, type StartedBook, type TeamOptions } from "../dcs/startBook";
import { explainError } from "../dcs/userError";
import { bookLabel } from "../domain/books";
import { portionsMatchStarts } from "../domain/extraWork";
import { boardWithPlan, planOfBoard } from "../domain/plan";
import { DEFAULT_SOLVERS_CATALOG, type SolverApp } from "../domain/solvers";
import { phasesAtStart, tasksWithoutTeam } from "../domain/startBook";
import { loadLocalWorkflows, mergeWorkflowCatalogs, normalizeWorkflowTemplate, saveLocalWorkflows } from "../domain/store";
import { localizeName } from "../domain/templateNames";
import { WORKFLOWS_SCHEMA, type AssignmentsDoc, type InventoryDoc } from "../domain/types";
import { workflowProblems } from "../domain/workflowCheck";
import { boardToWorkflowTemplate } from "../domain/workflows";
import { useUiLanguage } from "../i18n/language";
import { useT, type MessageKey } from "../i18n/messages";
import { PlanEditor } from "./PlanEditor";
import { PlanFrame } from "./PlanFrame";
import { WorkPreview } from "./WorkPreview";

type Props = {
  session: GtSession;
  pmOrg: string;
  draft: AssignmentsDoc;
  /** The name of the process the draft started from, when it started from one. */
  processName?: string;
  onDraft: (next: AssignmentsDoc) => void;
  onDiscard: () => void;
  onLeave: () => void;
  /** The project now exists: the app takes it as the one in hand. */
  onCreated: (started: StartedBook) => void;
  onOpenProject: (projectId: string) => void;
  onGoToTasks: () => void;
  announce: (msg: string) => void;
};

type Step = "plan" | "work";
const STAGES: StartStage[] = ["reading", "saving", "tasks"];
const STAGE_KEY: Record<StartStage, MessageKey> = { process: "sb.stageProcess", reading: "sb.stageReading", saving: "sb.stageSaving", tasks: "sb.stageTasks" };

/**
 * A project before it exists. Whoever prepares it adjusts the process the template gave (or builds one from nothing),
 * looks at the subtareas that will be laid out, cuts the book their way, adds work by hand, and only then creates
 * it. Nothing is written to Door43 until «Crear proyecto».
 */
export function DraftProjectView({ session, pmOrg, draft, processName, onDraft, onDiscard, onLeave, onCreated, onOpenProject, onGoToTasks, announce }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const book = draft.projectId;
  const name = bookLabel(book, language);
  const [step, setStep] = useState<Step>("plan");
  const [tools, setTools] = useState<SolverApp[]>(DEFAULT_SOLVERS_CATALOG.solvers);
  const [teams, setTeams] = useState<TeamOptions | null>(null);
  const [inventory, setInventory] = useState<InventoryDoc | null>(null);
  const [reading, setReading] = useState("");
  const [error, setError] = useState("");
  const [stage, setStage] = useState<{ at: StartStage; detail?: string } | null>(null);
  const [done, setDone] = useState<StartedBook | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const readFor = useRef("");

  useEffect(() => {
    let alive = true;
    loadSolversCatalog(session, pmOrg)
      .then((catalog) => alive && setTools(catalog.solvers))
      .catch(() => undefined);
    loadTeamOptions({ session, pmOrg, lang: draft.lang })
      .then((rows) => alive && setTeams(rows))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [session, pmOrg, draft.lang]);

  /** Read the book with the cuts the draft asks for; a reading in hand that already has them is kept. */
  async function read(settings: AssignmentsDoc["settings"]): Promise<InventoryDoc | null> {
    const wanted = JSON.stringify(settings?.portionStarts ?? {});
    if (inventory && readFor.current === wanted && portionsMatchStarts(settings, inventory)) return inventory;
    setError("");
    setReading(t("sb.stageReading"));
    try {
      const next = await readBook({ book, lang: draft.lang, contentOrg: draft.contentOrg, settings }, (message) => setReading(message));
      readFor.current = wanted;
      setInventory(next);
      return next;
    } catch (err) {
      setError(explainError(err));
      return null;
    } finally {
      setReading("");
    }
  }

  function go(next: Step) {
    setStep(next);
    if (next === "work") void read(draft.settings);
  }

  const problems = useMemo(() => {
    const asTemplate = boardToWorkflowTemplate(draft, { id: draft.workflowId ?? "draft", name: draft.title || name });
    return workflowProblems(asTemplate, { tools, languages: tallerConfig.uiLanguages });
  }, [draft, name, tools]);
  const loose = tasksWithoutTeam(draft);

  async function create() {
    if (problems.length) return;
    setError("");
    setStage({ at: "reading" });
    try {
      const ready = await read(draft.settings);
      if (!ready) return;
      const started = await createProject({ session, pmOrg, board: draft, inventory: ready, onStage: (at, detail) => setStage({ at, detail: at === "tasks" ? detail : undefined }) });
      setDone(started);
      onCreated(started);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setStage(null);
    }
  }

  async function saveAsTemplate() {
    const title = (naming ?? "").trim();
    if (!title) return;
    setSavingTemplate(true);
    setError("");
    try {
      const made = normalizeWorkflowTemplate({ ...boardToWorkflowTemplate(draft, { name: title }), version: 1 });
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
      setSavingTemplate(false);
    }
  }

  if (done) {
    const left = tasksWithoutTeam(done.board).length;
    return (
      <PlanFrame kind={t("dp.kindDone")} status={{ text: t("dp.created"), tone: "ok" }} title={<h1 className="pf-name">{t("sb.doneTitle").replace("{book}", name)}</h1>}>
        <div className="hub-panel sb">
          <p className="text-sm text-muted-foreground">{t(done.created === 1 ? "dp.createdOne" : "dp.createdMany").replace("{n}", String(done.created))}</p>
          <ul className="sb-phases" aria-label={t("sb.phasesAria")}>
            {phasesAtStart(done.board).map((phase) => (
              <li key={phase.id} data-ready={phase.ready ? "true" : "false"}>
                <span>{localizeName(phase.name, language)}</span>
                <span>{phase.ready ? t("sb.ready") : phase.waitsFor.length ? t("sb.waitsFor").replace("{what}", phase.waitsFor.map((n) => localizeName(n, language)).join(", ")) : t("sb.waits")}</span>
              </li>
            ))}
          </ul>
          {left ? <p className="af-stale">{t("dp.stillNoTeam").replace("{n}", String(left))}</p> : null}
          {(done.warnings ?? []).map((warning) => (
            <p key={warning} className="af-stale">
              {warning}
            </p>
          ))}
          <div className="grid gap-2">
            <Button type="button" size="lg" onClick={onGoToTasks}>
              {t("sb.goToTasks")}
            </Button>
            <Button type="button" size="lg" variant="outline" onClick={() => onOpenProject(done.board.projectId)}>
              {t("dp.openProject")}
            </Button>
          </div>
        </div>
      </PlanFrame>
    );
  }

  const busy = Boolean(stage) || Boolean(reading);
  return (
    <PlanFrame
      back={{ label: t("nav.projects"), onClick: onLeave }}
      kind={t("dp.kind")}
      status={{ text: t("dp.notCreated"), tone: "warn" }}
      title={<h1 className="pf-name">{name}</h1>}
      actions={
        <>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={busy}
            onClick={() => {
              if (window.confirm(t("dp.confirmDiscard"))) onDiscard();
            }}
          >
            {t("dp.discard")}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy || !draft.teams.length} onClick={() => setNaming(naming === null ? `${processName ?? name} (${name})` : null)}>
            {t("tv.saveAsTemplate")}
          </Button>
        </>
      }
      steps={
        <ol className="pf-steps">
          <li>
            <button type="button" aria-current={step === "plan" ? "step" : undefined} disabled={Boolean(stage)} onClick={() => go("plan")}>
              <b>1</b> {t("dp.stepPlan")}
            </button>
          </li>
          <li>
            <button type="button" aria-current={step === "work" ? "step" : undefined} disabled={Boolean(stage) || !draft.teams.length} onClick={() => go("work")}>
              <b>2</b> {t("dp.stepWork")}
            </button>
          </li>
        </ol>
      }
      problems={problems}
      problemsTitle={t("dp.problems")}
      footer={
        stage ? (
          <ol className="sb-stages dp-stages" aria-live="polite">
            {STAGES.map((id) => {
              const at = STAGES.indexOf(stage.at);
              const mine = STAGES.indexOf(id);
              return (
                <li key={id} data-state={mine < at ? "done" : mine === at ? "now" : "next"}>
                  {t(STAGE_KEY[id])}
                  {mine === at && stage.detail ? ` · ${stage.detail}` : ""}
                </li>
              );
            })}
          </ol>
        ) : (
          <>
            <p>{loose.length ? t("dp.footNoTeam").replace("{n}", String(loose.length)) : t("dp.footReady")}</p>
            <div className="pf-footer__actions">
              {step === "plan" ? (
                <Button type="button" variant="outline" disabled={busy || !draft.teams.length} onClick={() => go("work")}>
                  {t("dp.seeWork")}
                </Button>
              ) : null}
              <Button type="button" disabled={busy || problems.length > 0 || !draft.teams.length} onClick={() => void create()}>
                {t("dp.create")}
              </Button>
            </div>
          </>
        )
      }
    >
      {processName ? <p className="pf-lede">{t("dp.from").replace("{process}", processName)}</p> : <p className="pf-lede">{t("dp.fromNothing")}</p>}
      {naming !== null ? (
        <form
          className="hub-panel dp-template"
          onSubmit={(e) => {
            e.preventDefault();
            void saveAsTemplate();
          }}
        >
          <label className="pe-label" htmlFor="dp-template-name">
            {t("dp.templateName")}
          </label>
          <input id="dp-template-name" className="af-input" value={naming} autoFocus onChange={(e) => setNaming(e.target.value)} />
          <p className="pe-hint">{t("dp.templateHint")}</p>
          <div className="pf-footer__actions">
            <Button type="button" size="sm" variant="ghost" onClick={() => setNaming(null)}>
              {t("pj.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={savingTemplate || !naming.trim()}>
              {savingTemplate ? t("wf.saving") : t("tp.save")}
            </Button>
          </div>
        </form>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {step === "plan" ? (
        <PlanEditor plan={planOfBoard(draft)} onChange={(plan) => onDraft(boardWithPlan(draft, plan))} tools={tools} resourceNames={draft.settings?.resourceNames} teams={teams} readOnly={Boolean(stage)} />
      ) : reading ? (
        <div className="hub-panel dp-reading" role="status">
          <span className="dp-spinner" aria-hidden />
          <p>{reading}</p>
        </div>
      ) : inventory ? (
        <WorkPreview
          board={draft}
          inventory={inventory}
          busy={busy}
          onSettings={(settings) => onDraft({ ...draft, settings })}
          onPortionStarts={(settings) => {
            onDraft({ ...draft, settings });
            void read(settings);
          }}
        />
      ) : (
        <div className="hub-panel">
          <p className="pe-hint">{t("dp.readFailed")}</p>
          <Button type="button" variant="outline" className="justify-self-start" onClick={() => void read(draft.settings)}>
            {t("dp.readAgain")}
          </Button>
        </div>
      )}
    </PlanFrame>
  );
}
