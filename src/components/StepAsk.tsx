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
  const { pmOrg, projectId, taskId, stepId, lang, contentOrg } = ctx ?? {};
  useEffect(() => {
    setStep(undefined);
    if (!session || !pmOrg || !projectId || !taskId || !stepId) return;
    let cancelled = false;
    const find = (board: { teams: { id: string; steps?: TaskStep[] }[] } | null | undefined) => board?.teams.find((task) => task.id === taskId)?.steps?.find((row) => row.id === stepId);
    const known = find(rememberedBoard(session, pmOrg, projectId));
    if (known) setStep(known);
    else
      void loadAssignmentsFromDcs(session, pmOrg, lang ?? "", projectId, contentOrg ?? "")
        .then((board) => !cancelled && setStep(find(board)))
        .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session?.token, pmOrg, projectId, taskId, stepId, lang, contentOrg]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!step || !ctx || !stepAsks(step, language)) return null;
  return (
    <details className="step-ask">
      <summary>{t("tb.howStep").replace("{step}", step.names?.[language] ?? localizeName(step.name, language))}</summary>
      <StepAskBody step={step} scope={`${ctx.issueNumber ?? ctx.taskId}:${step.id}`} />
    </details>
  );
}
