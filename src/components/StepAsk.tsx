import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import type { GtSession } from "../dcs/auth";
import { rememberedBoard } from "../dcs/notices";
import { loadAssignmentsFromDcs } from "../dcs/persist";
import { loadStepSource } from "../dcs/stepSource";
import { teamKey } from "../domain/levels";
import { applicableChecks, formatWhen, parseWhen, stepWideChecks } from "../domain/stepChecks";
import type { SolverLaunchContext } from "../domain/solverLaunch";
import { activeRules, ruleText } from "../domain/teamRules";
import { localizeName } from "../domain/templateNames";
import type { ProjectTask, TaskStep } from "../domain/types";
import { useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";
import { addRuleToTeam, answerTeamRule, useManagesTeamRules, useTeamRules } from "../useTeamRules";

/**
 * What a step asks, where the person does it: the process's description of the step, its checks (a short list of
 * things to look at before handing the step in) and the rules the team gave itself. The ticks are the person's own,
 * kept on their device for that subtarea; they remind, they do not close the step.
 */

const key = (scope: string) => `taller-checks:${scope}`;

function loadTicks(scope: string): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key(scope)) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

type Line = { id: string; text: string; by?: string };

function useTicks(scope: string): [string[], (id: string) => void] {
  const [ticks, setTicks] = useState<string[]>(() => loadTicks(scope));
  useEffect(() => setTicks(loadTicks(scope)), [scope]);
  const toggle = (id: string) => {
    // Read again before changing: the step's list and the team's are two lists over the same ticks.
    const now = loadTicks(scope);
    const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
    setTicks(next);
    try {
      localStorage.setItem(key(scope), JSON.stringify(next));
    } catch {
      /* blocked storage: the ticks last as long as the screen */
    }
  };
  return [ticks, toggle];
}

export function Checks({ lines, scope }: { lines: Line[]; scope: string }) {
  const [ticks, toggle] = useTicks(scope);
  if (!lines.length) return null;
  return (
    <ul className="step-ask__checks">
      {lines.map((line) => (
        <li key={line.id}>
          <label>
            <input type="checkbox" checked={ticks.includes(line.id)} onChange={() => toggle(line.id)} />
            <span>
              {line.text}
              {line.by ? <small className="step-ask__by"> · @{line.by}</small> : null}
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

/**
 * `scope` tells one subtarea's ticks from another's: its number and its step. `source` is the source of the passage
 * in hand, when the list is shown beside it: only the checks it calls for show (see `domain/stepChecks`).
 */
export function StepAskBody({ step, scope, source, byItem }: { step: TaskStep; scope: string; source?: string | null; byItem?: boolean }) {
  const language = useUiLanguage();
  const description = step.descriptions?.[language] ?? step.description;
  // Where each item shows the checks it calls for, the step asks once only for what is of every item.
  const checks = byItem ? stepWideChecks(step.checks ?? []) : applicableChecks(step.checks ?? [], source);
  return (
    <>
      {description ? <p>{description}</p> : null}
      <Checks lines={checks.map((check) => ({ id: check.id, text: check.texts?.[language] ?? check.text }))} scope={scope} />
    </>
  );
}

export function stepAsks(step: TaskStep | undefined, language: string): boolean {
  return Boolean(step && ((step.descriptions?.[language] ?? step.description) || step.checks?.length));
}

/**
 * The rules of the team that does the step, under the step's own list. Like the step's checks, a rule may say which
 * words of the source call for it: `source` is the source of the passage in hand, and with `byItem` (each item
 * shows its own) only the rules that always apply are listed here. `canAdd`: this person is of the team, so they may
 * add one; `issue` is the subtarea in hand, for the notice to whoever coordinates.
 */
export function TeamRuleChecks({ team, scope, canAdd, issue, source, byItem }: { team: string | undefined; scope: string; canAdd?: boolean; issue?: number; source?: string | null; byItem?: boolean }) {
  const t = useT();
  const language = useUiLanguage();
  const doc = useTeamRules(team);
  const manages = useManagesTeamRules(team);
  const [draft, setDraft] = useState("");
  const [when, setWhen] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const all = doc ? activeRules(doc) : [];
  const rules = byItem ? stepWideChecks(all) : applicableChecks(all, source);
  if (!team || (!rules.length && !canAdd && !manages)) return null;
  const add = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    setFailed(false);
    try {
      await addRuleToTeam(team, draft, issue, parseWhen(when));
      setDraft("");
      setWhen("");
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="step-ask__team" aria-label={t("sa.teamRules")}>
      <p className="step-ask__title">{t("sa.teamRules")}</p>
      <Checks lines={rules.map((rule) => ({ id: `team-${rule.id}`, text: ruleText(rule, language), by: rule.by }))} scope={scope} />
      {canAdd ? (
        // Whoever finds something worth checking writes it where they found it: it counts for the team at once.
        <form
          className="step-ask__add"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input className="af-input" value={draft} maxLength={240} placeholder={t("sa.addRule")} aria-label={t("sa.addRule")} disabled={saving} onChange={(e) => setDraft(e.target.value)} />
          {/* The words come up only once there is a rule to attach them to. */}
          {draft.trim() ? <input className="af-input" value={when} placeholder={t("sa.addWhen")} aria-label={t("sa.addWhen")} disabled={saving} autoCapitalize="none" spellCheck={false} onChange={(e) => setWhen(e.target.value)} /> : null}
          <button type="submit" className="btn" data-size="sm" data-variant="outline" disabled={saving || !draft.trim()}>
            {saving ? t("sa.saving") : t("sa.add")}
          </button>
        </form>
      ) : null}
      {failed ? <p className="af-stale">{t("sa.ruleError")}</p> : null}
      {/* Whoever coordinates the team or runs the project corrects and removes them on the team's own screen. */}
      {manages ? (
        <a className="step-ask__manage" href="#/organizacion">
          {t("sa.manageRules")}
        </a>
      ) : null}
    </section>
  );
}

/** Whether a person is of the team that does a task: in its Door43 team, listed in the plan, or running the project. */
export function isOfTeam(session: Pick<GtSession, "username" | "teams" | "canManage"> | null | undefined, task: Pick<ProjectTask, "orgTeamName" | "memberIds"> | undefined): boolean {
  if (!session || !task?.orgTeamName) return false;
  const me = session.username.trim().toLowerCase();
  return Boolean(session.canManage) || (task.memberIds ?? []).some((id) => id.toLowerCase() === me) || (session.teams ?? []).some((team) => teamKey(team.name) === teamKey(task.orgTeamName));
}

/** Inside a tool: the step comes from the launch (which subtarea, which step) and the plan of its project. */
export function StepAsk({ session, ctx, byItem }: { session: GtSession | null | undefined; ctx: SolverLaunchContext | null | undefined; byItem?: boolean }) {
  const t = useT();
  const language = useUiLanguage();
  const [found, setFound] = useState<{ task: ProjectTask; step: TaskStep } | null>(null);
  /** The source of the passage: undefined while it is read (every check shows), null when there is none to read. */
  const [source, setSource] = useState<string | null | undefined>(undefined);
  const { pmOrg, projectId, taskId, stepId, lang, contentOrg, resource, book, ref, chapter } = ctx ?? {};
  useEffect(() => {
    setSource(undefined);
    if (!session || !ctx) return;
    let cancelled = false;
    void loadStepSource(session, ctx).then((text) => !cancelled && setSource(text));
    return () => {
      cancelled = true;
    };
  }, [session?.token, resource, book, ref, chapter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setFound(null);
    if (!session || !pmOrg || !projectId || !taskId || !stepId) return;
    let cancelled = false;
    const place = (board: { teams: ProjectTask[] } | null | undefined): boolean => {
      const task = board?.teams.find((row) => row.id === taskId);
      const step = task?.steps?.find((row) => row.id === stepId);
      if (!task || !step || cancelled) return false;
      setFound({ task, step });
      return true;
    };
    if (!place(rememberedBoard(session, pmOrg, projectId)))
      void loadAssignmentsFromDcs(session, pmOrg, lang ?? "", projectId, contentOrg ?? "")
        .then(place)
        .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session?.token, pmOrg, projectId, taskId, stepId, lang, contentOrg]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!found || !ctx) return null;
  const { task, step } = found;
  if (!stepAsks(step, language) && !task.orgTeamName) return null;
  const scope = `${ctx.issueNumber ?? ctx.taskId}:${step.id}`;
  return (
    <details className="step-ask">
      <summary>{t("tb.howStep").replace("{step}", step.names?.[language] ?? localizeName(step.name, language))}</summary>
      <StepAskBody step={step} scope={scope} source={source} byItem={byItem} />
      <TeamRuleChecks team={task.orgTeamName} scope={scope} canAdd={isOfTeam(session, task)} issue={ctx.issueNumber} source={source} byItem={byItem} />
    </details>
  );
}

/**
 * Every rule of a team, for whoever coordinates it: correct one, remove one or add one at any time, not only while
 * it is new. The same shape as the checks of a step: a line each, saying what it asks and when it shows; touching a
 * line opens it, alone, to edit.
 */
export function TeamRulesPanel({ team, canEdit }: { team: string; canEdit: boolean }) {
  const t = useT();
  const language = useUiLanguage();
  const doc = useTeamRules(team);
  /** The rule being edited (`new` for one not yet added), with what was typed. */
  const [open, setOpen] = useState<{ id: string; text: string; when: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const rules = doc ? activeRules(doc) : [];
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setFailed(false);
    try {
      await work();
      setOpen(null);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  if (!rules.length && !canEdit) return null;
  const fields = (
    <>
      <label className="ce-field">
        <span>{t("st.checkText")}</span>
        <textarea className="af-textarea" rows={3} value={open?.text ?? ""} maxLength={240} disabled={!canEdit || busy} autoFocus={open?.id === "new"} onChange={(e) => open && setOpen({ ...open, text: e.target.value })} />
      </label>
      <label className="ce-field">
        <span>{t("st.checkWhenLabel")}</span>
        <input className="af-input" value={open?.when ?? ""} disabled={!canEdit || busy} placeholder={t("st.checkWhenExample")} autoCapitalize="none" spellCheck={false} onChange={(e) => open && setOpen({ ...open, when: e.target.value })} />
        <small>{t("st.checkWhenHint")}</small>
      </label>
    </>
  );
  return (
    <section className="team-rules" aria-label={t("sa.teamRules")}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("sa.teamRules")}</h3>
      <div className="ce">
        {rules.length ? (
          <ol className="ce-list">
            {rules.map((rule) => {
              const isOpen = open?.id === rule.id;
              return (
                <li key={rule.id} className="ce-item" data-open={isOpen ? "true" : undefined}>
                  <button type="button" className="ce-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : { id: rule.id, text: ruleText(rule, language), when: formatWhen(rule.when) })}>
                    {isOpen ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
                    <span className="ce-row__text">
                      {ruleText(rule, language)}
                      <small className="step-ask__by">
                        {rule.by ? ` · @${rule.by}` : ""}
                        {rule.reviewedBy ? "" : ` · ${t("sa.ruleNew")}`}
                      </small>
                    </span>
                    <span className="ce-row__when" data-always={rule.when?.length ? undefined : "true"}>
                      {rule.when?.length ? t("st.checkIf").replace("{words}", formatWhen(rule.when)) : t("st.checkAlways")}
                    </span>
                  </button>
                  {isOpen ? (
                    <div className="ce-edit">
                      {fields}
                      {canEdit ? (
                        <div className="ce-actions">
                          <button type="button" className="ce-remove" disabled={busy} onClick={() => void run(() => answerTeamRule(team, rule.id, { keep: false }))}>
                            <Trash2 size={16} aria-hidden /> {t("st.checkRemoveShort")}
                          </button>
                          <button type="button" className="btn ce-done" data-size="sm" disabled={busy || !open.text.trim()} onClick={() => void run(() => answerTeamRule(team, rule.id, { keep: true, text: open.text, when: parseWhen(open.when) ?? [] }))}>
                            {busy ? t("sa.saving") : t("mt.ruleSave")}
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
          <p className="pe-hint">{t("sa.noRules")}</p>
        )}
        {canEdit && open?.id === "new" ? (
          <div className="ce-list">
            <div className="ce-edit ce-edit--new">
              {fields}
              <div className="ce-actions">
                <button type="button" className="btn" data-size="sm" data-variant="ghost" disabled={busy} onClick={() => setOpen(null)}>
                  {t("pj.cancel")}
                </button>
                <button type="button" className="btn ce-done" data-size="sm" disabled={busy || !open.text.trim()} onClick={() => void run(() => addRuleToTeam(team, open.text, undefined, parseWhen(open.when)))}>
                  {busy ? t("sa.saving") : t("sa.add")}
                </button>
              </div>
            </div>
          </div>
        ) : canEdit ? (
          <button type="button" className="pe-add" onClick={() => setOpen({ id: "new", text: "", when: "" })}>
            <Plus size={14} aria-hidden /> {t("sa.addRuleShort")}
          </button>
        ) : null}
      </div>
      {failed ? <p className="af-stale">{t("sa.ruleError")}</p> : null}
    </section>
  );
}
