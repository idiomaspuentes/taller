import type { Plan, PlanIssue } from "../domain/plan";
import { planIssues } from "../domain/plan";
import { localizeName } from "../domain/templateNames";
import type { UiLanguage } from "../config/types";
import type { MessageKey } from "../i18n/messages";

/** What stands in the way of saving a plan, in the language of the screen. */
export function planProblems(plan: Plan, t: (key: MessageKey) => string, language: UiLanguage): string[] {
  const text = (issue: PlanIssue) => {
    const raw = t(`pi.${issue.kind}` as MessageKey);
    if ("task" in issue) return raw.replace("{task}", localizeName(issue.task, language) || "…");
    if ("phase" in issue) return raw.replace("{phase}", localizeName(issue.phase, language) || "…");
    return raw;
  };
  return [...new Set(planIssues(plan).map(text))];
}
