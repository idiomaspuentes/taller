import { useState, type ReactNode } from "react";
import { useT, type MessageKey } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";
import { draftReadOrder } from "../domain/branchNames";
import { localized } from "../domain/processes";
import type { AssignmentsDoc } from "../domain/types";

/**
 * What a draft of a resource is called: by the phase of the task that translates it («Borrador de la fase 1:
 * Traducción»), read from the plan; just «Borrador» when the plan does not say.
 */
export function draftLabelOf(board: AssignmentsDoc | null | undefined, resource: string, t: (key: MessageKey) => string, language: string): string {
  const task = board?.teams.find((row) => row.id === draftReadOrder(board.teams, resource)[0]);
  const at = board?.phases.findIndex((phase) => phase.id === task?.phaseId) ?? -1;
  const phase = at >= 0 ? board!.phases[at] : undefined;
  return phase ? t("hv.draftOfPhase").replace("{n}", String(at + 1)).replace("{phase}", localized(phase.name, phase.names, language)) : t("hv.draft");
}

/** The name of a language in the interface's language («Español», «Inglés»), or its code when it has none. */
function languageName(code: string, ui: string): string {
  try {
    const name = new Intl.DisplayNames([ui], { type: "language" }).of(code.split("-")[0]!);
    return name ? name.charAt(0).toLocaleUpperCase(ui) + name.slice(1) : code;
  } catch {
    return code;
  }
}

type Props = {
  /** The team's version (a translated note, an article), and whether it is still a draft. */
  team?: { text: string; draft: boolean } | null;
  /** The same help in the source language. */
  source: string;
  teamLang: string;
  sourceLang: string;
  /** What a draft is called here: «Borrador de la fase 1: Traducción», or just «Borrador». */
  draftLabel: string;
  /** How the text reads, in its language. */
  children: (text: string, lang: string) => ReactNode;
};

/**
 * A help as the team has it and as the source has it, one at a time, switched as the reference text is: the
 * team's version first, said to be a draft while it is one, so that whoever reads it knows it may still change
 * and can say what to improve (18 October). The switch is always there, the team's language first, and says when
 * the team has no version yet: hidden then, the help seemed to have none in Spanish by design (19 October). It
 * opens in the team's language every time, not in the one chosen last.
 */
export function HelpVersions({ team, source, teamLang, sourceLang, draftLabel, children }: Props) {
  const t = useT();
  const ui = useUiLanguage();
  const [choice, setChoice] = useState<"team" | "source">("team");
  // A team version that is the source unchanged is no version of its own.
  const usable = Boolean(team?.text.trim()) && team!.text.trim() !== source.trim();
  const twoLanguages = teamLang.split("-")[0]!.toLowerCase() !== sourceLang.split("-")[0]!.toLowerCase();
  const showTeam = (usable && choice === "team") || !source.trim();
  if (!twoLanguages) return <div className="hv">{usable ? children(team!.text, teamLang) : children(source, sourceLang)}</div>;
  return (
    <div className="hv">
      <div className="hv__bar">
        {source.trim() ? (
          <div className="af-ref__texts" role="tablist" aria-label={t("hv.versions")}>
            <button type="button" role="tab" aria-selected={choice === "team"} onClick={() => setChoice("team")}>
              {languageName(teamLang, ui)}
            </button>
            <button type="button" role="tab" aria-selected={choice === "source"} onClick={() => setChoice("source")}>
              {languageName(sourceLang, ui)}
            </button>
          </div>
        ) : null}
        {showTeam && usable && team!.draft ? <span className="hv__draft">{draftLabel}</span> : null}
      </div>
      {choice === "team" && !usable && source.trim() ? (
        <p className="af-subhead hv__none">{t("hv.noneYet").replace("{lang}", languageName(teamLang, ui).toLocaleLowerCase(ui))}</p>
      ) : showTeam && usable ? (
        children(team!.text, teamLang)
      ) : (
        children(source, sourceLang)
      )}
    </div>
  );
}
