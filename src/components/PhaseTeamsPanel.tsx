import { useEffect, useState } from "react";
import type { DcsTeam } from "@ip-lms/dcs-client";
import { Button } from "@/components/ui/button";
import { phasesWithoutTeam } from "../domain/startBook";
import { localizeName } from "../domain/templateNames";
import type { AssignmentsDoc } from "../domain/types";
import { useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";

type Props = {
  board: AssignmentsDoc;
  loadTeams: () => Promise<DcsTeam[]>;
  /** Gives every task of each phase that has nobody the chosen team; returns the project as it was saved. */
  onSave: (board: AssignmentsDoc, choice: Record<string, DcsTeam>) => Promise<{ board: AssignmentsDoc; warnings: string[] }>;
  onSaved: (board: AssignmentsDoc) => void;
};

/**
 * Who does each phase: one team per phase, in one place. A process usually has a team per phase, so whoever starts
 * a book should not have to open every task to say it. A task that needs a different team is changed in the project.
 */
export function PhaseTeamsPanel({ board, loadTeams, onSave, onSaved }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const phases = phasesWithoutTeam(board);
  const [teams, setTeams] = useState<DcsTeam[] | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    loadTeams()
      .then((rows) => alive && setTeams(rows))
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
    // Loaded once: the teams of the organization do not change while this is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!phases.length && !warnings.length) return null;

  async function save() {
    const picked: Record<string, DcsTeam> = {};
    for (const phase of phases) {
      const team = teams?.find((row) => String(row.id) === choice[phase.id]);
      if (team) picked[phase.id] = team;
    }
    if (!Object.keys(picked).length) return;
    setBusy(true);
    setError("");
    try {
      const result = await onSave(board, picked);
      setWarnings(result.warnings);
      onSaved(result.board);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const tasks = phases.reduce((sum, phase) => sum + phase.tasks.length, 0);
  return (
    <div className="af-stale sb-teams">
      {phases.length ? (
        <>
          <p style={{ margin: 0 }}>{t("sb.noTeams").replace("{n}", String(tasks))}</p>
          {phases.map((phase) => (
            <label key={phase.id} className="sb-teams__row">
              <span>{localizeName(phase.name, language)}</span>
              <select className="af-input" value={choice[phase.id] ?? ""} disabled={busy || !teams} onChange={(e) => setChoice((prev) => ({ ...prev, [phase.id]: e.target.value }))}>
                <option value="">{teams ? t("sb.pickTeam") : t("sb.loadingTeams")}</option>
                {(teams ?? []).map((team) => (
                  <option key={team.id} value={String(team.id)}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <Button type="button" size="sm" disabled={busy || !phases.some((phase) => choice[phase.id])} onClick={() => void save()}>
            {busy ? t("sb.savingTeams") : t("sb.saveTeams")}
          </Button>
        </>
      ) : (
        <p style={{ margin: 0 }}>{t("sb.teamsSaved")}</p>
      )}
      {warnings.map((warning) => (
        <p key={warning} style={{ margin: 0 }}>{warning}</p>
      ))}
      {error ? <p role="alert" style={{ margin: 0 }}>{error}</p> : null}
    </div>
  );
}
