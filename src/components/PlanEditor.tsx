import { ChecksEditor } from "./ChecksEditor";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, ChevronDown, ChevronRight, Clock, Copy, Plus, Trash2, User, Users, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TeamOptions } from "../dcs/startBook";
import { uid } from "../domain/assignment";
import {
  addPhase,
  addStep,
  addTask,
  duplicateTask,
  movePhase,
  moveStep,
  moveTask,
  moveTaskToPhase,
  orderedPhases,
  patchStep,
  patchTask,
  removePhase,
  removeStep,
  removeTask,
  renamePhase,
  replaceStep,
  setTaskResources,
  stepClosing,
  stepWho,
  tasksOfPhase,
  type Plan,
  type PlanTask,
} from "../domain/plan";
import { scopeLabel } from "../domain/resourceNames";
import { displayOrgTeamName, orgTeamLabel } from "../domain/roles";
import { localizeScope } from "../domain/scopeNames";
import type { SolverApp } from "../domain/solvers";
import { teamAccess, type TeamOption } from "../domain/startBook";
import { localizeName } from "../domain/templateNames";
import { SCOPE_KEYS, filtersForResource, type ArticleFilter, type ChecklistQuestion, type Localized, type Phase, type ResourceNames, type ScopeKey, type StepCheck, type StepClosing, type TaskStep } from "../domain/types";
import { useUiLanguage } from "../i18n/language";
import { useT, type MessageKey } from "../i18n/messages";
import { MinLevelField } from "./MinLevelField";
import { StepWhoEditor } from "./StepWhoEditor";
import { WaitsEditor } from "./WaitsEditor";

export type PlanSelection = { kind: "phase"; phaseId: string } | { kind: "task"; taskId: string } | { kind: "step"; taskId: string; stepId: string } | null;

type Props = {
  plan: Plan;
  onChange: (plan: Plan) => void;
  /** The tools a task or a step may open. */
  tools: SolverApp[];
  /** What the process calls each resource. */
  resourceNames?: ResourceNames;
  /** The teams of the organization, to say who does each phase or task. Absent: the plan does not name teams here. */
  teams?: TeamOptions | null;
  /** Read only: the plan is shown, nothing can be changed. */
  readOnly?: boolean;
  /**
   * The book of a project, once it was read: a task can then be limited to some of its chapters or portions, and say
   * that it goes over text already delivered. Absent in a template, which is of no book.
   */
  book?: { code: string; portions: { id: string; ref: string; chapter: number }[] };
  /** How many subtareas each task already has, by task id: removing one of those asks first. */
  workOf?: (taskId: string) => number;
};

type Named = { name: string; names?: Localized };
const CLOSING_KEY: Record<StepClosing, MessageKey> = { self: "pe.closeSelf", approval: "pe.closeApproval", consensus: "pe.closeConsensus", checklist: "pe.closeChecklist", automatic: "pe.closeAutomatic" };
const CLOSING_HELP: Record<StepClosing, MessageKey> = { self: "st.helpSelf", approval: "pe.helpApproval", consensus: "st.helpConsensus", checklist: "st.helpChecklist", automatic: "st.helpAutomatic" };
const FILTER_KEY: Record<ArticleFilter, MessageKey> = { pending: "pe.fPending", all: "pe.fAll", translated: "pe.fTranslated", english: "pe.fEnglish", incomplete: "pe.fIncomplete", missing: "pe.fMissing" };
type StepScopeId = NonNullable<TaskStep["scope"]>;
const STEP_SCOPES: StepScopeId[] = ["subtask", "unit", "chapter-once"];
const STEP_SCOPE_KEY: Record<StepScopeId, MessageKey> = { subtask: "st.scopeSubtask", unit: "st.scopeUnit", "chapter-once": "st.scopeOnce" };

/**
 * The one editor of a process: its phases, their tasks and the steps of each, as an outline, with what is selected
 * in detail beside it. A template, a project about to be created and a project under way are edited here alike; only
 * what the host does with the result differs.
 */
export function PlanEditor({ plan, onChange, tools, resourceNames, teams, readOnly, book, workOf }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const phases = useMemo(() => orderedPhases(plan), [plan]);
  // Beside the outline there is room for a detail from the start; on a phone the outline is the first screen.
  const [sel, setSel] = useState<PlanSelection>(() => {
    const first = orderedPhases(plan)[0];
    const wide = typeof window !== "undefined" && window.matchMedia?.("(min-width: 900px)").matches;
    return first && wide ? { kind: "phase", phaseId: first.id } : null;
  });
  const [closedPhases, setClosedPhases] = useState<Set<string>>(() => new Set());
  const [openTasks, setOpenTasks] = useState<Set<string>>(() => new Set());
  const [more, setMore] = useState(false);
  const canEdit = !readOnly;

  /** The name as written for this interface language when the process gave one, else the name itself. */
  const raw = (row: Named) => row.names?.[language] ?? row.name;
  const shown = (row: Named, fallback: string) => localizeName(raw(row), language) || fallback;
  const renamed = (row: Named, value: string): Partial<Named> => (row.names?.[language] !== undefined ? { names: { ...row.names, [language]: value } } : { name: value });
  const stepName = (step: TaskStep, index: number) => shown(step, t("pe.stepN").replace("{n}", String(index + 1)));
  const resourceName = (key: ScopeKey) => scopeLabel(key, resourceNames, language, (text) => localizeScope(text, language));

  const task = sel && sel.kind !== "phase" ? plan.tasks.find((row) => row.id === sel.taskId) : undefined;
  const step = sel?.kind === "step" ? task?.steps?.find((row) => row.id === sel.stepId) : undefined;
  const phase = sel?.kind === "phase" ? plan.phases.find((row) => row.id === sel.phaseId) : task ? plan.phases.find((row) => row.id === task.phaseId) : undefined;
  // What was selected may have been removed (by this editor, or by the host putting another plan in).
  const live: PlanSelection = sel?.kind === "phase" ? (phase ? sel : null) : sel?.kind === "task" ? (task ? sel : null) : sel?.kind === "step" ? (step ? sel : task ? { kind: "task", taskId: task.id } : null) : null;

  function select(next: PlanSelection) {
    setSel(next);
    setMore(false);
    if (next?.kind === "step") setOpenTasks((prev) => new Set(prev).add(next.taskId));
  }
  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  /* ---- teams ---- */
  const teamList = teams?.teams ?? [];
  const teamOf = (row: Pick<PlanTask, "orgTeamId" | "orgTeamName">) => teamList.find((team) => (row.orgTeamId !== undefined ? team.id === row.orgTeamId : row.orgTeamName !== undefined && team.name === row.orgTeamName));
  const teamName = (row: Pick<PlanTask, "orgTeamId" | "orgTeamName">) => {
    const team = teamOf(row);
    return team ? orgTeamLabel(team) : row.orgTeamName ? displayOrgTeamName(row.orgTeamName) : "";
  };
  const needsOf = (rows: PlanTask[]) => [...new Set(rows.flatMap((row) => teams?.needs({ scope: row.rules.map((rule) => rule.resource), rules: row.rules }) ?? []))];
  /** The team all the tasks of a phase share, when they do. */
  const phaseTeam = (phaseId: string) => {
    const rows = tasksOfPhase(plan, phaseId);
    const names = new Set(rows.map((row) => row.orgTeamName ?? ""));
    return names.size === 1 && rows[0]?.orgTeamName ? rows[0] : undefined;
  };
  function setTeam(rows: PlanTask[], id: string) {
    const team = teamList.find((row) => String(row.id) === id);
    const ids = new Set(rows.map((row) => row.id));
    onChange({ ...plan, tasks: plan.tasks.map((row) => (ids.has(row.id) ? { ...row, orgTeamId: team?.id, orgTeamName: team?.name } : row)) });
  }
  function teamSelect(rows: PlanTask[], value: string, label: string, placeholder: string) {
    const needed = needsOf(rows);
    const ready = teamList.filter((team) => teamAccess(team, needed).state === "edits");
    const rest = teamList.filter((team) => !ready.includes(team));
    const option = (team: TeamOption) => (
      <option key={team.id} value={String(team.id)}>
        {orgTeamLabel(team)}
      </option>
    );
    const picked = teamList.find((team) => String(team.id) === value);
    const access = picked ? teamAccess(picked, needed) : null;
    return (
      <div className="pe-field">
        <label className="pe-label" htmlFor={`pe-team-${rows[0]?.id ?? "x"}`}>
          {label}
        </label>
        <select id={`pe-team-${rows[0]?.id ?? "x"}`} className="af-input" value={value} disabled={!canEdit || !teams} onChange={(e) => setTeam(rows, e.target.value)}>
          <option value="">{teams ? placeholder : t("sb.loadingTeams")}</option>
          {ready.length ? <optgroup label={t("sb.teamsReady")}>{ready.map(option)}</optgroup> : null}
          {rest.length ? <optgroup label={t("sb.teamsOther")}>{rest.map(option)}</optgroup> : null}
        </select>
        {access?.state === "will-get" ? <small className="pe-hint">{t("sb.teamWillGet").replace("{repos}", access.missing.join(", "))}</small> : null}
        {access?.state === "read-only" ? <small className="pe-hint pe-hint--warn">{t("pe.teamReadOnly")}</small> : null}
      </div>
    );
  }

  /* ---- outline ---- */
  const phaseName = (id: string) => {
    const row = plan.phases.find((p) => p.id === id);
    return row ? shown(row, id) : id;
  };
  function waitsLabel(rows: PlanTask[], ownPhase?: string): string {
    const names = new Set<string>();
    for (const row of rows) {
      for (const rule of row.waitsFor ?? []) {
        if (rule.source) names.add(t("pe.sourceProject"));
        else if (rule.phaseId && rule.phaseId !== ownPhase) names.add(phaseName(rule.phaseId));
        else if (rule.taskId) {
          const other = plan.tasks.find((p) => p.id === rule.taskId);
          if (!other) continue;
          if (ownPhase === undefined) names.add(shown(other, other.id));
          else if (other.phaseId !== ownPhase) names.add(phaseName(other.phaseId));
        }
      }
    }
    return [...names].join(", ");
  }

  function newPhase() {
    const made = addPhase(plan, t("pe.newPhaseName").replace("{n}", String(plan.phases.length + 1)));
    onChange(made.plan);
    select({ kind: "phase", phaseId: made.id });
  }
  function newTask(phaseId: string) {
    // Whoever does the phase does its new task too, until somebody says otherwise.
    const shared = phaseTeam(phaseId);
    const made = addTask(plan, phaseId, t("pe.newTaskName"));
    const first = made.plan.tasks.find((row) => row.id === made.id)?.steps?.[0];
    const named = first ? patchStep(made.plan, made.id, first.id, { name: t("pe.newStepName") }) : made.plan;
    onChange(shared ? patchTask(named, made.id, { orgTeamId: shared.orgTeamId, orgTeamName: shared.orgTeamName }) : named);
    select({ kind: "task", taskId: made.id });
    setOpenTasks((prev) => new Set(prev).add(made.id));
  }
  function newStep(taskId: string) {
    const made = addStep(plan, taskId, t("pe.newStepName"));
    onChange(made.plan);
    select({ kind: "step", taskId, stepId: made.id });
  }

  const outline = (
    <nav className="pe-outline" aria-label={t("pe.outlineAria")}>
      {phases.map((row) => {
        const rows = tasksOfPhase(plan, row.id);
        const open = !closedPhases.has(row.id);
        const shared = phaseTeam(row.id);
        const waits = waitsLabel(rows, row.id);
        return (
          <div key={row.id} className="pe-phase">
            <div className="pe-row pe-row--phase" data-on={live?.kind === "phase" && live.phaseId === row.id ? "true" : undefined}>
              <button type="button" className="pe-row__fold" aria-expanded={open} aria-label={t(open ? "pe.fold" : "pe.unfold").replace("{name}", shown(row, row.id))} onClick={() => setClosedPhases((prev) => toggle(prev, row.id))}>
                {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
              </button>
              <button type="button" className="pe-row__main" onClick={() => select({ kind: "phase", phaseId: row.id })}>
                <span className="pe-row__name">{shown(row, row.id)}</span>
                <span className="pe-row__meta">
                  {[t(rows.length === 1 ? "tv.tasksOne" : "tv.tasksMany").replace("{n}", String(rows.length)), shared ? teamName(shared) : "", waits ? t("pe.waitsFor").replace("{what}", waits) : ""].filter(Boolean).join(" · ")}
                </span>
              </button>
            </div>
            {open ? (
              <div className="pe-phase__body">
                {rows.map((item) => {
                  const itemOpen = openTasks.has(item.id);
                  const own = !shared && item.orgTeamName ? teamName(item) : "";
                  const itemWaits = (item.waitsFor ?? []).length;
                  return (
                    <div key={item.id} className="pe-task">
                      <div className="pe-row pe-row--task" data-on={live?.kind === "task" && live.taskId === item.id ? "true" : undefined}>
                        <button type="button" className="pe-row__fold" aria-expanded={itemOpen} aria-label={t(itemOpen ? "pe.fold" : "pe.unfold").replace("{name}", shown(item, item.id))} onClick={() => setOpenTasks((prev) => toggle(prev, item.id))}>
                          {itemOpen ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
                        </button>
                        <button type="button" className="pe-row__main" onClick={() => select({ kind: "task", taskId: item.id })}>
                          <span className="pe-row__name">{shown(item, item.id)}</span>
                          <span className="pe-row__meta">
                            {[
                              item.rules.length ? item.rules.map((rule) => resourceName(rule.resource)).join(" + ") : t("pe.general"),
                              t((item.steps?.length ?? 0) === 1 ? "pe.stepsOne" : "pe.stepsMany").replace("{n}", String(item.steps?.length ?? 0)),
                              own,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                            {itemWaits ? <Clock size={12} aria-label={t("pe.waits")} className="pe-row__icon" /> : null}
                          </span>
                        </button>
                      </div>
                      {itemOpen ? (
                        <div className="pe-task__body">
                          {(item.steps ?? []).map((s, index) => {
                            const who = stepWho(s);
                            return (
                              <button key={s.id} type="button" className="pe-row pe-row--step" data-on={live?.kind === "step" && live.stepId === s.id ? "true" : undefined} onClick={() => select({ kind: "step", taskId: item.id, stepId: s.id })}>
                                <span className="pe-row__n" aria-hidden>
                                  {index + 1}
                                </span>
                                <span className="pe-row__name">{stepName(s, index)}</span>
                                <span className="pe-row__icons" aria-hidden>
                                  {who === "several" ? <Users size={13} /> : who === "one" ? <User size={13} /> : null}
                                  {s.solverAppId ? <Wrench size={13} /> : null}
                                </span>
                              </button>
                            );
                          })}
                          {canEdit ? (
                            <button type="button" className="pe-add pe-add--step" onClick={() => newStep(item.id)}>
                              <Plus size={14} aria-hidden /> {t("pe.addStep")}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {canEdit ? (
                  <button type="button" className="pe-add pe-add--task" onClick={() => newTask(row.id)}>
                    <Plus size={14} aria-hidden /> {t("pe.addTask")}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
      {canEdit ? (
        <button type="button" className="pe-add pe-add--phase" onClick={newPhase}>
          <Plus size={14} aria-hidden /> {t("pe.addPhase")}
        </button>
      ) : null}
    </nav>
  );

  /* ---- detail: phase ---- */
  function phaseDetail(row: Phase) {
    const rows = tasksOfPhase(plan, row.id);
    const at = phases.findIndex((p) => p.id === row.id);
    const shared = phaseTeam(row.id);
    const mixed = !shared && rows.some((item) => item.orgTeamName);
    return (
      <>
        <header className="pe-detail__head">
          <p className="pe-crumb">{t("pe.phase")}</p>
          <input className="pe-title" value={raw(row)} disabled={!canEdit} aria-label={t("pe.phaseName")} onChange={(e) => onChange(row.names?.[language] !== undefined ? { ...plan, phases: plan.phases.map((p) => (p.id === row.id ? { ...p, names: { ...p.names, [language]: e.target.value } } : p)) } : renamePhase(plan, row.id, e.target.value))} />
        </header>
        {teams !== undefined && rows.length ? teamSelect(rows, shared ? String(teamOf(shared)?.id ?? "") : "", t("pe.phaseTeam"), mixed ? t("sb.mixedTeams") : t("sb.pickTeam")) : null}
        {teams !== undefined && rows.length > 1 ? <p className="pe-hint">{t("pe.phaseTeamHint")}</p> : null}
        <div className="pe-field">
          <span className="pe-label">{t("pe.tasksOfPhase")}</span>
          {rows.length ? (
            <ul className="pe-list">
              {rows.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => select({ kind: "task", taskId: item.id })}>
                    {shown(item, item.id)}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pe-hint">{t("wf.noTasksInPhase")}</p>
          )}
        </div>
        {canEdit ? (
          <div className="pe-actions">
            <Button type="button" size="sm" variant="outline" onClick={() => newTask(row.id)}>
              <Plus size={14} aria-hidden /> {t("pe.addTask")}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={at <= 0} onClick={() => onChange(movePhase(plan, row.id, -1))}>
              <ArrowUp size={14} aria-hidden /> {t("pe.before")}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={at >= phases.length - 1} onClick={() => onChange(movePhase(plan, row.id, 1))}>
              <ArrowDown size={14} aria-hidden /> {t("pe.after")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => {
                const work = rows.reduce((sum, item) => sum + (workOf?.(item.id) ?? 0), 0);
                const ask = work ? t("pe.confirmPhaseWork").replace("{n}", String(work)) : rows.length ? t("pe.confirmPhase").replace("{n}", String(rows.length)) : "";
                if (ask && !window.confirm(ask)) return;
                onChange(removePhase(plan, row.id));
                select(null);
              }}
            >
              <Trash2 size={14} aria-hidden /> {t("pe.removePhase")}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  /* ---- detail: task ---- */
  function taskDetail(row: PlanTask) {
    const patch = (next: Partial<PlanTask>) => onChange(patchTask(plan, row.id, next));
    const siblings = tasksOfPhase(plan, row.phaseId);
    const at = siblings.findIndex((item) => item.id === row.id);
    const resources = row.rules.map((rule) => rule.resource);
    const perChapter = row.distributeUnit === "chapter" || row.bundle?.grain === "chapter";
    const together = Boolean(row.bundle?.enabled);
    return (
      <>
        <header className="pe-detail__head">
          <p className="pe-crumb">
            <button type="button" onClick={() => select({ kind: "phase", phaseId: row.phaseId })}>
              {phaseName(row.phaseId)}
            </button>{" "}
            › {t("pe.task")}
          </p>
          <input className="pe-title" value={raw(row)} disabled={!canEdit} aria-label={t("pe.taskName")} onChange={(e) => patch(renamed(row, e.target.value))} />
        </header>

        <div className="pe-field">
          <span className="pe-label">{t("pe.works")}</span>
          <div className="pe-chips">
            {SCOPE_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className="pe-chip"
                aria-pressed={resources.includes(key)}
                disabled={!canEdit}
                onClick={() => onChange({ ...plan, tasks: plan.tasks.map((item) => (item.id === row.id ? setTaskResources(item, resources.includes(key) ? resources.filter((r) => r !== key) : [...resources, key], SCOPE_KEYS) : item)) })}
              >
                {resourceName(key)}
              </button>
            ))}
          </div>
          <small className="pe-hint">{resources.length ? t("pe.worksHint") : t("pe.generalHint")}</small>
        </div>
        {resources.length ? (
          <div className="pe-field">
            <span className="pe-label">{t("pe.includes")}</span>
            <div className="pe-includes">
              {row.rules.map((rule) => (
                <label key={rule.resource}>
                  <span>{resourceName(rule.resource)}</span>
                  <select className="af-input" value={rule.articleFilter} disabled={!canEdit} onChange={(e) => patch({ rules: row.rules.map((item) => (item.resource === rule.resource ? { ...item, articleFilter: e.target.value as ArticleFilter } : item)) })}>
                    {filtersForResource(rule.resource).map((id) => (
                      <option key={id} value={id}>
                        {t(FILTER_KEY[id])}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {resources.length ? (
          <div className="pe-field">
            <label className="pe-label" htmlFor="pe-divide">
              {t("pe.divide")}
            </label>
            <select
              id="pe-divide"
              className="af-input"
              value={perChapter ? "chapter" : "portion"}
              disabled={!canEdit}
              onChange={(e) =>
                patch(
                  e.target.value === "chapter"
                    ? { distributeUnit: "chapter", bundle: { enabled: true, grain: "chapter" } }
                    : { distributeUnit: "portion", bundle: together && resources.length > 1 ? { enabled: true, grain: "portion" } : undefined },
                )
              }
            >
              <option value="portion">{t("pe.dividePortion")}</option>
              <option value="chapter">{t("pe.divideChapter")}</option>
            </select>
            {resources.length > 1 && !perChapter ? (
              <label className="pe-check">
                <input type="checkbox" checked={together} disabled={!canEdit} onChange={(e) => patch({ bundle: e.target.checked ? { enabled: true, grain: "portion" } : undefined })} />
                <span>{t("pe.together")}</span>
              </label>
            ) : null}
          </div>
        ) : null}

        {teams !== undefined ? teamSelect([row], String(teamOf(row)?.id ?? ""), t("pe.taskTeam"), t("sb.pickTeam")) : null}

        <div className="pe-field">
          {canEdit ? (
            <WaitsEditor board={{ teams: plan.tasks as never, phases: plan.phases }} taskId={row.id} phaseId={row.phaseId} value={row.waitsFor ?? []} onChange={(next) => patch({ waitsFor: next.length ? next : undefined })} />
          ) : (
            <>
              <span className="pe-label">{t("wa.label")}</span>
              <p className="pe-hint">{waitsLabel([row]) || t("pe.waitsNothing")}</p>
            </>
          )}
        </div>

        <div className="pe-field">
          <span className="pe-label">{t("pe.steps")}</span>
          <ol className="pe-steps">
            {(row.steps ?? []).map((s, index) => (
              <li key={s.id}>
                <button type="button" onClick={() => select({ kind: "step", taskId: row.id, stepId: s.id })}>
                  <span className="pe-row__n" aria-hidden>
                    {index + 1}
                  </span>
                  <span>{stepName(s, index)}</span>
                  <small>{t(CLOSING_KEY[stepClosing(s)])}</small>
                </button>
              </li>
            ))}
          </ol>
          {canEdit ? (
            <button type="button" className="pe-add" onClick={() => newStep(row.id)}>
              <Plus size={14} aria-hidden /> {t("pe.addStep")}
            </button>
          ) : null}
        </div>

        <button type="button" className="pe-more" aria-expanded={more} onClick={() => setMore(!more)}>
          {more ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />} {t("pe.more")}
        </button>
        {more ? (
          <div className="pe-more__body">
            <div className="pe-field">
              <label className="pe-label" htmlFor="pe-task-phase">
                {t("pe.phase")}
              </label>
              <select id="pe-task-phase" className="af-input" value={row.phaseId} disabled={!canEdit} onChange={(e) => onChange(moveTaskToPhase(plan, row.id, e.target.value))}>
                {phases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {shown(p, p.id)}
                  </option>
                ))}
              </select>
            </div>
            {canEdit ? <MinLevelField id="pe-min-level" value={row.minLevel} onChange={(next) => patch({ minLevel: next })} /> : null}
            <small className="pe-hint">{t("ml.help")}</small>
            {resources.length ? (
              <label className="pe-check">
                <input type="checkbox" checked={Boolean(row.everyUnit)} disabled={!canEdit} onChange={(e) => patch({ everyUnit: e.target.checked ? true : undefined })} />
                <span>
                  {t("tv.everyUnit")}
                  <small className="pe-hint">{t("tv.everyUnitHelp")}</small>
                </span>
              </label>
            ) : null}
            <div className="pe-field">
              <label className="pe-label" htmlFor="pe-task-tool">
                {t("pe.taskTool")}
              </label>
              <select id="pe-task-tool" className="af-input" value={row.solverAppId ?? ""} disabled={!canEdit} onChange={(e) => patch({ solverAppId: e.target.value || undefined })}>
                <option value="">{t("tv.noTool")}</option>
                {tools.map((app) => (
                  <option key={app.id} value={app.id}>
                    {app.name}
                  </option>
                ))}
              </select>
              <small className="pe-hint">{t("pe.taskToolHint")}</small>
            </div>
            <div className="pe-field">
              <label className="pe-label" htmlFor="pe-task-desc">
                {t("pe.description")}
              </label>
              <textarea id="pe-task-desc" className="af-textarea" rows={2} value={row.description ?? ""} disabled={!canEdit} onChange={(e) => patch({ description: e.target.value || undefined })} />
            </div>
            {book ? (
              <div className="pe-field">
                <label className="pe-label" htmlFor="pe-scope-mode">
                  {t("pe.bookPart")}
                </label>
                <select
                  id="pe-scope-mode"
                  className="af-input"
                  value={row.scriptureScope?.mode === "chapters" || row.scriptureScope?.mode === "portions" ? row.scriptureScope.mode : "project"}
                  disabled={!canEdit}
                  onChange={(e) =>
                    patch({
                      scriptureScope: e.target.value === "chapters" ? { mode: "chapters", book: book.code, chapters: [] } : e.target.value === "portions" ? { mode: "portions", book: book.code, portionIds: [] } : { mode: "project" },
                    })
                  }
                >
                  <option value="project">{t("pe.bookWhole")}</option>
                  <option value="chapters">{t("pe.bookChapters")}</option>
                  <option value="portions">{t("pe.bookPortions")}</option>
                </select>
                {row.scriptureScope?.mode === "chapters" ? (
                  <div className="pe-chips">
                    {[...new Set(book.portions.map((portion) => portion.chapter))].map((chapter) => {
                      const scope = row.scriptureScope as { mode: "chapters"; book: string; chapters: number[] };
                      const on = scope.chapters.includes(chapter);
                      return (
                        <button key={chapter} type="button" className="pe-chip" aria-pressed={on} disabled={!canEdit} onClick={() => patch({ scriptureScope: { ...scope, chapters: on ? scope.chapters.filter((c) => c !== chapter) : [...scope.chapters, chapter].sort((x, y) => x - y) } })}>
                          {chapter}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {row.scriptureScope?.mode === "portions" ? (
                  <div className="pe-chips">
                    {book.portions.map((portion) => {
                      const scope = row.scriptureScope as { mode: "portions"; book: string; portionIds: string[] };
                      const on = scope.portionIds.includes(portion.id);
                      return (
                        <button key={portion.id} type="button" className="pe-chip" aria-pressed={on} disabled={!canEdit} onClick={() => patch({ scriptureScope: { ...scope, portionIds: on ? scope.portionIds.filter((id) => id !== portion.id) : [...scope.portionIds, portion.id] } })}>
                          {portion.ref.replace(/^[A-Z0-9]{3}\s+/, "").replace("-", "–")}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
            {book && resources.some((key) => key === "tpl" || key === "tps") ? (
              <label className="pe-check">
                <input type="checkbox" checked={Boolean(row.reviewsPrincipal)} disabled={!canEdit} onChange={(e) => patch({ reviewsPrincipal: e.target.checked ? true : undefined })} />
                <span>
                  {t("pe.reviews")}
                  <small className="pe-hint">{t("pe.reviewsHint")}</small>
                </span>
              </label>
            ) : null}
          </div>
        ) : null}

        {canEdit ? (
          <div className="pe-actions">
            <Button type="button" size="sm" variant="ghost" disabled={at <= 0} onClick={() => onChange(moveTask(plan, row.id, -1))}>
              <ArrowUp size={14} aria-hidden /> {t("pe.before")}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={at >= siblings.length - 1} onClick={() => onChange(moveTask(plan, row.id, 1))}>
              <ArrowDown size={14} aria-hidden /> {t("pe.after")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                const made = duplicateTask(plan, row.id, t("pe.copyOf").replace("{name}", raw(row)));
                if (!made) return;
                onChange(made.plan);
                select({ kind: "task", taskId: made.id });
              }}
            >
              <Copy size={14} aria-hidden /> {t("pe.duplicate")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => {
                const work = workOf?.(row.id) ?? 0;
                if (work && !window.confirm(t("pe.confirmTaskWork").replace("{n}", String(work)))) return;
                onChange(removeTask(plan, row.id));
                select({ kind: "phase", phaseId: row.phaseId });
              }}
            >
              <Trash2 size={14} aria-hidden /> {t("wf.removeTask")}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  /* ---- detail: step ---- */
  function stepDetail(row: PlanTask, s: TaskStep) {
    const steps = row.steps ?? [];
    const at = steps.findIndex((item) => item.id === s.id);
    const patch = (next: Partial<TaskStep>) => onChange(patchStep(plan, row.id, s.id, next));
    const closing = stepClosing(s);
    const who = stepWho(s);
    const offered: StepClosing[] = who === "owner" ? ["self", "checklist", "automatic"] : ["approval", "consensus", "checklist", "automatic"];
    const closings = offered.includes(closing) ? offered : [closing, ...offered];
    const asksQuestions = closing === "checklist" || (closing === "approval" && Boolean(s.solverAppId));
    const questions: ChecklistQuestion[] = s.checklist ?? [];
    const setQuestions = (next: ChecklistQuestion[]) => patch({ checklist: next.length ? next : undefined });
    const checks: StepCheck[] = s.checks ?? [];
    const setChecks = (next: StepCheck[]) => patch({ checks: next.length ? next : undefined });
    const nameOf = (item: TaskStep) => stepName(item, steps.indexOf(item));
    return (
      <>
        <header className="pe-detail__head">
          <p className="pe-crumb">
            <button type="button" onClick={() => select({ kind: "phase", phaseId: row.phaseId })}>
              {phaseName(row.phaseId)}
            </button>{" "}
            ›{" "}
            <button type="button" onClick={() => select({ kind: "task", taskId: row.id })}>
              {shown(row, row.id)}
            </button>{" "}
            › {t("pe.stepOf").replace("{n}", String(at + 1)).replace("{total}", String(steps.length))}
          </p>
          <input className="pe-title" value={raw(s)} disabled={!canEdit} placeholder={t("pe.stepN").replace("{n}", String(at + 1))} aria-label={t("pe.stepName")} onChange={(e) => patch(renamed(s, e.target.value))} />
        </header>

        <div className="pe-field">
          <span className="pe-label">{t("pe.who")}</span>
          <StepWhoEditor step={s} steps={steps} nameOf={nameOf} disabled={!canEdit} onChange={(next) => onChange(replaceStep(plan, row.id, next))} />
        </div>

        <div className="pe-field">
          <label className="pe-label" htmlFor="pe-closing">
            {t("pe.closing")}
          </label>
          <select id="pe-closing" className="af-input" value={closing} disabled={!canEdit} onChange={(e) => patch({ closing: e.target.value as StepClosing })}>
            {closings.map((id) => (
              <option key={id} value={id}>
                {t(CLOSING_KEY[id])}
              </option>
            ))}
          </select>
          <small className="pe-hint">{t(CLOSING_HELP[closing])}</small>
          {closing === "consensus" ? (
            <label className="pe-inline">
              <span>{t("st.rule")}</span>
              <select className="af-input pe-auto" value={s.decisionRule ?? "unanimous"} disabled={!canEdit} onChange={(e) => patch({ decisionRule: e.target.value as TaskStep["decisionRule"] })}>
                <option value="unanimous">{t("st.ruleUnanimous")}</option>
                <option value="majority">{t("st.ruleMajority")}</option>
              </select>
            </label>
          ) : null}
        </div>

        <div className="pe-field">
          <label className="pe-label" htmlFor="pe-tool">
            {t("pe.tool")}
          </label>
          <select id="pe-tool" className="af-input" value={s.solverAppId ?? ""} disabled={!canEdit} onChange={(e) => patch({ solverAppId: e.target.value || undefined })}>
            <option value="">{t("tv.noTool")}</option>
            {tools.map((app) => (
              <option key={app.id} value={app.id}>
                {app.name}
              </option>
            ))}
          </select>
        </div>

        {asksQuestions ? (
          <div className="pe-field">
            <span className="pe-label">{t("st.questions")}</span>
            <small className="pe-hint">{t("st.questionsHint")}</small>
            {questions.map((question, index) => (
              <div key={question.id} className="pe-question">
                <textarea
                  className="af-textarea"
                  rows={2}
                  value={question.texts?.[language] ?? question.text}
                  disabled={!canEdit}
                  aria-label={t("st.questionN").replace("{n}", String(index + 1))}
                  onChange={(e) => setQuestions(questions.map((q) => (q.id === question.id ? (q.texts?.[language] !== undefined ? { ...q, texts: { ...q.texts, [language]: e.target.value } } : { ...q, text: e.target.value }) : q)))}
                />
                <label className="pe-check">
                  <input type="checkbox" checked={question.per === "verse"} disabled={!canEdit} onChange={(e) => setQuestions(questions.map((q) => (q.id === question.id ? { ...q, per: e.target.checked ? "verse" : undefined } : q)))} />
                  <span>{t("st.questionPerVerse")}</span>
                </label>
                {canEdit ? (
                  <button type="button" className="pe-icon" aria-label={t("st.questionRemove").replace("{n}", String(index + 1))} onClick={() => setQuestions(questions.filter((q) => q.id !== question.id))}>
                    <Trash2 size={14} aria-hidden />
                  </button>
                ) : null}
              </div>
            ))}
            {canEdit ? (
              <button type="button" className="pe-add" onClick={() => setQuestions([...questions, { id: `q-${uid().slice(0, 6)}`, text: "" }])}>
                <Plus size={14} aria-hidden /> {t("pe.addQuestion")}
              </button>
            ) : null}
          </div>
        ) : null}

        {/* What each person looks at in their own work before handing the step in: any step may have them. */}
        <div className="pe-field">
          <span className="pe-label">{t("st.checks")}</span>
          <small className="pe-hint">{t("st.checksHint")}</small>
          <ChecksEditor checks={checks} onChange={setChecks} canEdit={canEdit} language={language} />
        </div>

        <button type="button" className="pe-more" aria-expanded={more} onClick={() => setMore(!more)}>
          {more ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />} {t("pe.more")}
        </button>
        {more ? (
          <div className="pe-more__body">
            <div className="pe-field">
              <label className="pe-label" htmlFor="pe-scope">
                {t("st.scope")}
              </label>
              <select id="pe-scope" className="af-input" value={s.scope ?? "subtask"} disabled={!canEdit} onChange={(e) => patch({ scope: e.target.value === "subtask" ? undefined : (e.target.value as StepScopeId) })}>
                {STEP_SCOPES.map((id) => (
                  <option key={id} value={id}>
                    {t(STEP_SCOPE_KEY[id])}
                  </option>
                ))}
              </select>
            </div>
            <div className="pe-field">
              <label className="pe-label" htmlFor="pe-button">
                {t("st.button")}
              </label>
              <input id="pe-button" className="af-input" value={s.actionLabels?.[language] ?? s.actionLabel ?? ""} placeholder={t("st.buttonHint")} disabled={!canEdit} onChange={(e) => patch(s.actionLabels?.[language] !== undefined ? { actionLabels: { ...s.actionLabels, [language]: e.target.value } } : { actionLabel: e.target.value || undefined })} />
            </div>
            <div className="pe-field">
              <label className="pe-label" htmlFor="pe-step-desc">
                {t("st.description")}
              </label>
              <textarea id="pe-step-desc" className="af-textarea" rows={2} value={s.descriptions?.[language] ?? s.description ?? ""} disabled={!canEdit} onChange={(e) => patch(s.descriptions?.[language] !== undefined ? { descriptions: { ...s.descriptions, [language]: e.target.value } } : { description: e.target.value || undefined })} />
            </div>
          </div>
        ) : null}

        {canEdit ? (
          <div className="pe-actions">
            <Button type="button" size="sm" variant="ghost" disabled={at <= 0} onClick={() => onChange(moveStep(plan, row.id, s.id, -1))}>
              <ArrowUp size={14} aria-hidden /> {t("pe.before")}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={at >= steps.length - 1} onClick={() => onChange(moveStep(plan, row.id, s.id, 1))}>
              <ArrowDown size={14} aria-hidden /> {t("pe.after")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => {
                onChange(removeStep(plan, row.id, s.id));
                select({ kind: "task", taskId: row.id });
              }}
            >
              <Trash2 size={14} aria-hidden /> {t("wf.removeStep")}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="pe" data-detail={live ? "open" : "closed"}>
      {outline}
      <section className="pe-detail" aria-live="polite">
        {live ? (
          <button type="button" className="pe-back" onClick={() => setSel(null)}>
            <ArrowLeft size={16} aria-hidden /> {t("pe.backToOutline")}
          </button>
        ) : null}
        {live?.kind === "phase" && phase ? phaseDetail(phase) : null}
        {live?.kind === "task" && task ? taskDetail(task) : null}
        {live?.kind === "step" && task && step ? stepDetail(task, step) : null}
        {!live ? (
          <div className="pe-empty">
            <p>{plan.phases.length ? t("pe.pickSomething") : t("pe.startWithPhase")}</p>
            {canEdit && !plan.phases.length ? (
              <Button type="button" onClick={newPhase}>
                <Plus size={14} aria-hidden /> {t("pe.addPhase")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
