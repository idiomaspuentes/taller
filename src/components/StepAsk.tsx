import { addTeamRule, loadTeamRules } from "../dcs/teamRules";
import { activeRules, type TeamRulesDoc } from "../domain/teamRules";
import { useEffect, useState } from "react";
import type { GtSession } from "../dcs/auth";
import { rememberedBoard } from "../dcs/notices";
import { loadAssignmentsFromDcs } from "../dcs/persist";
import type { SolverLaunchContext } from "../domain/solverLaunch";
import { localizeName } from "../domain/templateNames";
import type { TaskStep } from "../domain/types";
import { useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";

/**
 * What a step asks, where the person does it: the process's description of the step and its checks, a short list of
 * things to look at before handing the step in. The ticks are the person's own, kept on their device for that
 * subtarea; they remind, they do not close the step.
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

/** `scope` tells one subtarea's ticks from another's: its number and its step. */
export function StepAskBody({ step, scope }: { step: TaskStep; scope: string }) {
  const language = useUiLanguage();
  const [ticks, setTicks] = useState<string[]>(() => loadTicks(scope));
  useEffect(() => setTicks(loadTicks(scope)), [scope]);
  const description = step.descriptions?.[language] ?? step.description;
  const checks = step.checks ?? [];
  const toggle = (id: string) => {
    const next = ticks.includes(id) ? ticks.filter((x) => x !== id) : [...ticks, id];
    setTicks(next);
    try {
      localStorage.setItem(key(scope), JSON.stringify(next));
    } catch {
      /* blocked storage: the ticks last as long as the screen */
    }
  };
  return (
    <>
      {description ? <p>{description}</p> : null}
      {checks.length ? (
        <ul className="step-ask__checks">
          {checks.map((check) => (
            <li key={check.id}>
              <label>
                <input type="checkbox" checked={ticks.includes(check.id)} onChange={() => toggle(check.id)} />
                <span>{check.texts?.[language] ?? check.text}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

export function stepAsks(step: TaskStep | undefined, language: string): boolean {
  return Boolean(step && ((step.descriptions?.[language] ?? step.description) || step.checks?.length));
}

/** Inside a tool: the step comes from the launch (which subtarea, which step) and the plan of its project. */
export function StepAsk({ session, ctx }: { session: GtSession | null | undefined; ctx: SolverLaunchContext | null | undefined }) {
  const t = useT();
  const language = useUiLanguage();
  const [step, setStep] = useState<TaskStep | undefined>(undefined);
  /** The team that does this step: its rules show here, and a new one is added to them. */
  const [team, setTeam] = useState("");
  const [rules, setRules] = useState<TeamRulesDoc | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const { pmOrg, projectId, taskId, stepId, lang, contentOrg } = ctx ?? {};
  useEffect(() => {
    setStep(undefined);
    setTeam("");
    setRules(null);
    if (!session || !pmOrg || !projectId || !taskId || !stepId) return;
    let cancelled = false;
    type Board = { teams: { id: string; orgTeamName?: string; steps?: TaskStep[] }[] } | null | undefined;
    const place = (board: Board): boolean => {
      const task = board?.teams.find((row) => row.id === taskId);
      const found = task?.steps?.find((row) => row.id === stepId);
      if (!found || cancelled) return false;
      setStep(found);
      setTeam(task?.orgTeamName ?? "");
      if (task?.orgTeamName) void loadTeamRules(session, pmOrg, task.orgTeamName).then((doc) => !cancelled && setRules(doc));
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
  const mine = rules ? activeRules(rules) : [];
  if (!step || !ctx || (!stepAsks(step, language) && !team)) return null;
  const scope = `${ctx.issueNumber ?? ctx.taskId}:${step.id}`;
  const add = async () => {
    if (!session || !pmOrg || !team || !draft.trim()) return;
    setSaving(true);
    setFailed(false);
    try {
      setRules(await addTeamRule(session, pmOrg, team, draft));
      setDraft("");
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <details className="step-ask">
      <summary>{t("tb.howStep").replace("{step}", step.names?.[language] ?? localizeName(step.name, language))}</summary>
      <StepAskBody step={step} scope={scope} />
      {team ? (
        <section className="step-ask__team" aria-label={t("sa.teamRules")}>
          <p className="step-ask__title">{t("sa.teamRules")}</p>
          {mine.length ? <StepAskBody step={{ ...step, description: undefined, descriptions: undefined, checks: mine.map((rule) => ({ id: `team-${rule.id}`, text: rule.by ? `${rule.text} · @${rule.by}` : rule.text })) }} scope={scope} /> : null}
          {/* Whoever finds something worth checking writes it where they found it: it counts for the team at once. */}
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
          {failed ? <p className="af-stale">{t("sa.ruleError")}</p> : null}
        </section>
      ) : null}
    </details>
  );
}
