import { useEffect, useState } from "react";
import type { DcsTeam } from "@ip-lms/dcs-client";
import { Button } from "@/components/ui/button";
import { explainError } from "../dcs/userError";
import { orgTeamLabel } from "../domain/roles";
import { phaseTeams, phasesWithoutTeam } from "../domain/startBook";
import { localizeName } from "../domain/templateNames";
import type { AssignmentsDoc } from "../domain/types";
import { useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";

type Props = {
  board: AssignmentsDoc;
  /**
   * `missing` asks only for the phases that still have tasks without a team (right after starting a book) and goes
   * away when there are none; `all` shows every phase with its team, to change who does one.
   */
  mode?: "missing" | "all";
  loadTeams: () => Promise<DcsTeam[]>;
  /** Gives the tasks of each phase the chosen team; returns the project as it was saved. */
  onSave: (board: AssignmentsDoc, choice: Record<string, DcsTeam>, replace: boolean) => Promise<{ board: AssignmentsDoc; warnings: string[] }>;
  onSaved: (board: AssignmentsDoc) => void;
};

/**
 * Who does each phase: one team per phase, in one place. A process usually has a team per phase, so whoever starts
 * a book should not have to open every task to say it. A task that needs a different team is changed in the project.
 */
export function PhaseTeamsPanel({ board, mode = "missing", loadTeams, onSave, onSaved }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const all = mode === "all";
  const phases = all ? phaseTeams(board) : phasesWithoutTeam(board).map((phase) => ({ ...phase, orgTeamId: undefined, orgTeamName: undefined, mixed: false }));
  const [teams, setTeams] = useState<DcsTeam[] | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    loadTeams()
      .then((rows) => alive && setTeams(rows))
      .catch((err) => alive && setError(explainError(err)));
    return () => {
      alive = false;
    };
    // Loaded once: the teams of the organization do not change while this is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!all && !phases.length && !warnings.length && !saved) return null;

  /** The team a phase has today, as the value of its list: by id, or by name for a project that only kept the name. */
  const current = (phase: (typeof phases)[number]) => {
    const team = teams?.find((row) => (phase.orgTeamId !== undefined ? row.id === phase.orgTeamId : phase.orgTeamName !== undefined && row.name === phase.orgTeamName));
    return team ? String(team.id) : "";
  };
  const changed = phases.filter((phase) => choice[phase.id] !== undefined && choice[phase.id] !== "" && choice[phase.id] !== current(phase));

  async function save() {
    const picked: Record<string, DcsTeam> = {};
    for (const phase of changed) {
      const team = teams?.find((row) => String(row.id) === choice[phase.id]);
      if (team) picked[phase.id] = team;
    }
    if (!Object.keys(picked).length) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const result = await onSave(board, picked, all);
      setWarnings(result.warnings);
      setSaved(true);
      setChoice({});
      onSaved(result.board);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  const tasks = phases.reduce((sum, phase) => sum + phase.tasks.length, 0);
  const asking = all || phases.length > 0;
  return (
    <div className={all ? "hub-panel sb-teams" : asking || warnings.length ? "af-stale sb-teams" : "sb-teams sb-teams--done"} role={all ? undefined : "status"}>
      {asking ? (
        <>
          {all ? (
            <div>
              <h2 className="sb-teams__title">{t("sb.teamsTitle")}</h2>
              <p className="text-sm text-muted-foreground" style={{ margin: 0 }}>{t("sb.teamsLede")}</p>
            </div>
          ) : (
            <p style={{ margin: 0 }}>{t("sb.noTeams").replace("{n}", String(tasks))}</p>
          )}
          {phases.map((phase) => (
            <label key={phase.id} className="sb-teams__row">
              <span>{localizeName(phase.name, language)}</span>
              <select className="af-input" value={choice[phase.id] ?? current(phase)} disabled={busy || !teams} onChange={(e) => setChoice((prev) => ({ ...prev, [phase.id]: e.target.value }))}>
                <option value="">{!teams ? t("sb.loadingTeams") : phase.mixed ? t("sb.mixedTeams") : t("sb.pickTeam")}</option>
                {(teams ?? []).map((team) => (
                  <option key={team.id} value={String(team.id)}>
                    {orgTeamLabel(team)}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <Button type="button" size="sm" disabled={busy || !changed.length} onClick={() => void save()}>
            {busy ? t("sb.savingTeams") : t("sb.saveTeams")}
          </Button>
        </>
      ) : null}
      {saved && (all || !phases.length) ? <p className={all ? "sb-teams--done" : undefined} style={{ margin: 0 }}>{t(all ? "sb.teamsChanged" : "sb.teamsSaved")}</p> : null}
      {warnings.map((warning) => (
        <p key={warning} className={all ? "af-stale" : undefined} style={{ margin: 0 }}>{warning}</p>
      ))}
      {error ? <p role="alert" className="text-destructive" style={{ margin: 0 }}>{error}</p> : null}
    </div>
  );
}
