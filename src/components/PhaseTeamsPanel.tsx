import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { TeamOptions } from "../dcs/startBook";
import { explainError } from "../dcs/userError";
import { orgTeamLabel } from "../domain/roles";
import { phaseTeams, phasesWithoutTeam, teamAccess, type TeamOption } from "../domain/startBook";
import { localizeName } from "../domain/templateNames";
import type { AssignmentsDoc, ProjectTask } from "../domain/types";
import { useUiLanguage } from "../i18n/language";
import { useT } from "../i18n/messages";

type Props = {
  board: AssignmentsDoc;
  /**
   * `missing` asks only for the tasks that still have no team (right after starting a book) and goes away when
   * there are none; `all` shows every phase with its teams, to change who does what.
   */
  mode?: "missing" | "all";
  loadTeams: () => Promise<TeamOptions>;
  /** Gives each task its chosen team (by task id); returns the project as it was saved. */
  onSave: (board: AssignmentsDoc, choice: Record<string, TeamOption>) => Promise<{ board: AssignmentsDoc; warnings: string[] }>;
  onSaved: (board: AssignmentsDoc) => void;
  /** Lets a team that may only read edit the repositories it is given. Absent for who cannot manage teams. */
  onAllowEdit?: (team: TeamOption) => Promise<void>;
};

/**
 * Who does the work: one team per phase, and a team of its own for the task that needs one (the team that
 * translates the notes is not always the one that translates the text). Each list puts first the teams that can
 * already edit what the task writes, and says what a chosen team still lacks.
 */
export function PhaseTeamsPanel({ board, mode = "missing", loadTeams, onSave, onSaved, onAllowEdit }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const all = mode === "all";
  const phases = all ? phaseTeams(board) : phasesWithoutTeam(board).map((phase) => ({ ...phase, mixed: false }));
  const [options, setOptions] = useState<TeamOptions | null>(null);
  /** Team id chosen for a task, by task id; a task not in here keeps the team it has. */
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    loadTeams()
      .then((rows) => alive && setOptions(rows))
      .catch((err) => alive && setError(explainError(err)));
    return () => {
      alive = false;
    };
    // Loaded once: the teams of the organization do not change while this is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!all && !phases.length && !warnings.length && !saved) return null;

  const teams = options?.teams ?? [];
  /** The team a task has today, as the value of its list: by id, or by name for a project that only kept the name. */
  const current = (task: ProjectTask) => {
    const team = teams.find((row) => (task.orgTeamId !== undefined ? row.id === task.orgTeamId : task.orgTeamName !== undefined && row.name === task.orgTeamName));
    return team ? String(team.id) : "";
  };
  const valueOf = (task: ProjectTask) => choice[task.id] ?? current(task);
  const teamOf = (id: string) => teams.find((row) => String(row.id) === id);
  const changed = phases.flatMap((phase) => phase.tasks).filter((task) => choice[task.id] && choice[task.id] !== current(task));

  async function save() {
    const picked: Record<string, TeamOption> = {};
    for (const task of changed) {
      const team = teamOf(choice[task.id]);
      if (team) picked[task.id] = team;
    }
    if (!Object.keys(picked).length) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const result = await onSave(board, picked);
      setWarnings(result.warnings);
      setSaved(true);
      setChoice({});
      onSaved(result.board);
      // What each team can edit may have changed with what was just given.
      void loadTeams().then(setOptions).catch(() => undefined);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  async function allowEdit(list: TeamOption[]) {
    if (!onAllowEdit) return;
    setBusy(true);
    setError("");
    try {
      for (const team of list) await onAllowEdit(team);
      setOptions(await loadTeams());
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  /** The teams in a list: first the ones that can already edit everything these tasks write. */
  function list(tasks: ProjectTask[]) {
    const needed = [...new Set(tasks.flatMap((task) => options?.needs(task) ?? []))];
    const ready = teams.filter((team) => teamAccess(team, needed).state === "edits");
    const rest = teams.filter((team) => !ready.includes(team));
    const row = (team: TeamOption) => (
      <option key={team.id} value={String(team.id)}>
        {orgTeamLabel(team)}
      </option>
    );
    return (
      <>
        {ready.length ? <optgroup label={t("sb.teamsReady")}>{ready.map(row)}</optgroup> : null}
        {rest.length ? <optgroup label={t("sb.teamsOther")}>{rest.map(row)}</optgroup> : null}
      </>
    );
  }

  /** What a chosen team still lacks for these tasks, in words; nothing when it can already do them. */
  function lacks(id: string, tasks: ProjectTask[]) {
    const team = teamOf(id);
    if (!team || !options) return null;
    const access = teamAccess(team, [...new Set(tasks.flatMap((task) => options.needs(task)))]);
    // A team that may only read is told once for the whole panel, below: it is about the team, not the task.
    if (access.state !== "will-get") return null;
    return <small className="sb-teams__note">{t("sb.teamWillGet").replace("{repos}", access.missing.join(", "))}</small>;
  }

  const readOnly = [...new Set(phases.flatMap((phase) => phase.tasks).map(valueOf))]
    .map(teamOf)
    .filter((team): team is TeamOption => Boolean(team) && teamAccess(team!, []).state === "read-only");

  const count = phases.reduce((sum, phase) => sum + phase.tasks.length, 0);
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
            <p style={{ margin: 0 }}>{t("sb.noTeams").replace("{n}", String(count))}</p>
          )}
          {phases.map((phase) => {
            const values = new Set(phase.tasks.map(valueOf));
            const one = values.size === 1 ? [...values][0] : "";
            const split = values.size > 1;
            const byTask = open[phase.id] ?? split;
            return (
              <div key={phase.id} className="sb-teams__phase">
                <label className="sb-teams__row">
                  <span>{localizeName(phase.name, language)}</span>
                  <select
                    className="af-input"
                    value={one}
                    disabled={busy || !options}
                    onChange={(e) => setChoice((prev) => ({ ...prev, ...Object.fromEntries(phase.tasks.map((task) => [task.id, e.target.value])) }))}
                  >
                    <option value="">{!options ? t("sb.loadingTeams") : split ? t("sb.mixedTeams") : t("sb.pickTeam")}</option>
                    {list(phase.tasks)}
                  </select>
                </label>
                {!byTask ? lacks(one, phase.tasks) : null}
                {phase.tasks.length > 1 ? (
                  <button type="button" className="sb-teams__toggle" aria-expanded={byTask} onClick={() => setOpen((prev) => ({ ...prev, [phase.id]: !byTask }))}>
                    {byTask ? t("sb.byTaskHide") : t("sb.byTask")}
                  </button>
                ) : null}
                {byTask
                  ? phase.tasks.map((task) => (
                      <div key={task.id} className="sb-teams__task">
                        <label className="sb-teams__row">
                          <span>{localizeName(task.name, language)}</span>
                          <select className="af-input" value={valueOf(task)} disabled={busy || !options} onChange={(e) => setChoice((prev) => ({ ...prev, [task.id]: e.target.value }))}>
                            <option value="">{options ? t("sb.pickTeam") : t("sb.loadingTeams")}</option>
                            {list([task])}
                          </select>
                        </label>
                        {lacks(valueOf(task), [task])}
                      </div>
                    ))
                  : null}
              </div>
            );
          })}
          {readOnly.length ? (
            <div className="sb-teams__readonly">
              <p style={{ margin: 0 }}>{t(onAllowEdit ? "sb.teamReadOnly" : "sb.teamReadOnlyAsk").replace("{teams}", readOnly.map((team) => orgTeamLabel(team)).join(", "))}</p>
              {onAllowEdit ? (
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void allowEdit(readOnly)}>
                  {t("sb.allowEdit")}
                </Button>
              ) : null}
            </div>
          ) : null}
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
