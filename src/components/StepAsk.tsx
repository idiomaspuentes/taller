import { useEffect, useState } from "react";
import type { GtSession } from "../dcs/auth";
import { rememberedBoard } from "../dcs/notices";
import { loadAssignmentsFromDcs } from "../dcs/persist";
import { teamKey } from "../domain/levels";
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

function Checks({ lines, scope }: { lines: Line[]; scope: string }) {
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

/** `scope` tells one subtarea's ticks from another's: its number and its step. */
export function StepAskBody({ step, scope }: { step: TaskStep; scope: string }) {
  const language = useUiLanguage();
  const description = step.descriptions?.[language] ?? step.description;
  return (
    <>
      {description ? <p>{description}</p> : null}
      <Checks lines={(step.checks ?? []).map((check) => ({ id: check.id, text: check.texts?.[language] ?? check.text }))} scope={scope} />
    </>
  );
}

export function stepAsks(step: TaskStep | undefined, language: string): boolean {
  return Boolean(step && ((step.descriptions?.[language] ?? step.description) || step.checks?.length));
}

/**
 * The rules of the team that does the step, under the step's own list. `canAdd`: this person is of the team, so
 * they may add one; `issue` is the subtarea in hand, for the notice to whoever coordinates.
 */
export function TeamRuleChecks({ team, scope, canAdd, issue }: { team: string | undefined; scope: string; canAdd?: boolean; issue?: number }) {
  const t = useT();
  const language = useUiLanguage();
  const doc = useTeamRules(team);
  const manages = useManagesTeamRules(team);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const rules = doc ? activeRules(doc) : [];
  if (!team || (!rules.length && !canAdd && !manages)) return null;
  const add = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    setFailed(false);
    try {
      await addRuleToTeam(team, draft, issue);
      setDraft("");
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
export function StepAsk({ session, ctx }: { session: GtSession | null | undefined; ctx: SolverLaunchContext | null | undefined }) {
  const t = useT();
  const language = useUiLanguage();
  const [found, setFound] = useState<{ task: ProjectTask; step: TaskStep } | null>(null);
  const { pmOrg, projectId, taskId, stepId, lang, contentOrg } = ctx ?? {};
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
      <StepAskBody step={step} scope={scope} />
      <TeamRuleChecks team={task.orgTeamName} scope={scope} canAdd={isOfTeam(session, task)} issue={ctx.issueNumber} />
    </details>
  );
}

/**
 * Every rule of a team, for whoever coordinates it: correct one, remove one or add one at any time, not only while
 * it is new.
 */
export function TeamRulesPanel({ team, canEdit }: { team: string; canEdit: boolean }) {
  const t = useT();
  const language = useUiLanguage();
  const doc = useTeamRules(team);
  const [fixing, setFixing] = useState<{ id: string; text: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const rules = doc ? activeRules(doc) : [];
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setFailed(false);
    try {
      await work();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  if (!rules.length && !canEdit) return null;
  return (
    <section className="team-rules" aria-label={t("sa.teamRules")}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("sa.teamRules")}</h3>
      {rules.length ? (
        <ul>
          {rules.map((rule) => (
            <li key={rule.id}>
              {fixing?.id === rule.id ? (
                <input className="af-input" value={fixing.text} maxLength={240} autoFocus aria-label={t("mt.ruleFix")} onChange={(e) => setFixing({ id: rule.id, text: e.target.value })} />
              ) : (
                <span>
                  {ruleText(rule, language)}
                  <small className="step-ask__by">
                    {rule.by ? ` · @${rule.by}` : ""}
                    {rule.reviewedBy ? "" : ` · ${t("sa.ruleNew")}`}
                  </small>
                </span>
              )}
              {canEdit ? (
                <span className="team-rules__tools">
                  {fixing?.id === rule.id ? (
                    <button
                      type="button"
                      className="btn"
                      data-size="sm"
                      disabled={busy || !fixing.text.trim()}
                      onClick={() =>
                        void run(async () => {
                          await answerTeamRule(team, rule.id, { keep: true, text: fixing.text });
                          setFixing(null);
                        })
                      }
                    >
                      {t("mt.ruleSave")}
                    </button>
                  ) : (
                    <button type="button" className="btn" data-size="sm" data-variant="ghost" disabled={busy} onClick={() => setFixing({ id: rule.id, text: ruleText(rule, language) })}>
                      {t("mt.ruleFix")}
                    </button>
                  )}
                  <button type="button" className="btn" data-size="sm" data-variant="ghost" disabled={busy} onClick={() => void run(() => answerTeamRule(team, rule.id, { keep: false }))}>
                    {t("mt.ruleRemove")}
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="pe-hint">{t("sa.noRules")}</p>
      )}
      {canEdit ? (
        <form
          className="step-ask__add"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim())
              void run(async () => {
                await addRuleToTeam(team, draft);
                setDraft("");
              });
          }}
        >
          <input className="af-input" value={draft} maxLength={240} placeholder={t("sa.addRule")} aria-label={t("sa.addRule")} disabled={busy} onChange={(e) => setDraft(e.target.value)} />
          <button type="submit" className="btn" data-size="sm" data-variant="outline" disabled={busy || !draft.trim()}>
            {t("sa.add")}
          </button>
        </form>
      ) : null}
      {failed ? <p className="af-stale">{t("sa.ruleError")}</p> : null}
    </section>
  );
}
