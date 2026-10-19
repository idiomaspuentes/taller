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

/** The version of a help last chosen on this device: a convenience, so nothing is lost if it cannot be kept. */
const KEPT = "taller-help-version";
function readKept(): "team" | "source" {
  try {
    return localStorage.getItem(KEPT) === "source" ? "source" : "team";
  } catch {
    return "team";
  }
}
function keep(choice: "team" | "source") {
  try {
    localStorage.setItem(KEPT, choice);
  } catch {
    /* a private window keeps nothing: the team's version is shown first, as the first time */
  }
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
 * and can say what to improve (18 October). Only the source when the team has none, or has the source unchanged.
 */
export function HelpVersions({ team, source, teamLang, sourceLang, draftLabel, children }: Props) {
  const t = useT();
  const ui = useUiLanguage();
  const [choice, setChoice] = useState(readKept);
  const usable = Boolean(team?.text.trim()) && team!.text.trim() !== source.trim();
  const showTeam = usable && (choice === "team" || !source.trim());
  const choose = (next: "team" | "source") => {
    setChoice(next);
    keep(next);
  };
  return (
    <div className="hv">
      {usable ? (
        <div className="hv__bar">
          {source.trim() ? (
            <div className="af-ref__texts" role="tablist" aria-label={t("hv.versions")}>
              <button type="button" role="tab" aria-selected={showTeam} onClick={() => choose("team")}>
                {languageName(teamLang, ui)}
              </button>
              <button type="button" role="tab" aria-selected={!showTeam} onClick={() => choose("source")}>
                {languageName(sourceLang, ui)}
              </button>
            </div>
          ) : null}
          {showTeam && team!.draft ? <span className="hv__draft">{draftLabel}</span> : null}
        </div>
      ) : null}
      {showTeam ? children(team!.text, teamLang) : children(source, sourceLang)}
    </div>
  );
}
