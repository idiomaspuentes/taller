import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { GtSession } from "../dcs/auth";
import { commentOnIssue, loadPmConfig, reassignIssue } from "../dcs/issues";
import { remindDecisionVoters } from "../dcs/alignmentDecisionStore";
import { loadTeamToday, type TodayProject } from "../dcs/teamToday";
import { classifyToday, type TodayGroup, type TodayRow } from "../domain/teamToday";
import { useDecisionReminders } from "../useDecisionReminders";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { PersonLevel } from "../domain/levels";
import { Button } from "@/components/ui/button";

type Props = {
  session: GtSession;
  pmOrg: string;
  lang: string;
  contentOrg: string;
  announce: (msg: string) => void;
  onOpenThread: (issue: number) => void;
};

const GROUPS: { id: TodayGroup; title: string; empty: string }[] = [
  { id: "decisions", title: "Decisiones del equipo", empty: "No hay decisiones abiertas." },
  { id: "stuck", title: "Atascadas", empty: "Nada atascado." },
  { id: "waiting", title: "Esperando", empty: "Ninguna tarea espera a otra." },
  { id: "running", title: "En marcha", empty: "Nadie está trabajando ahora." },
  { id: "free", title: "Libres para el equipo", empty: "No hay tareas libres." },
  { id: "done", title: "Terminadas esta semana", empty: "Aún no se ha cerrado nada esta semana." },
];

function shortTitle(row: TodayRow): string {
  return row.issue.title.replace(/^[A-Z0-9]{3}\s+/i, "").trim() || row.issue.title;
}

/**
 * Equipo hoy: how the work stands, for whoever coordinates. Stuck work first,
 * each row with what can be done about it from the same place.
 */
export function TeamTodayView({ session, pmOrg, lang, contentOrg, announce, onOpenThread }: Props) {
  const [projects, setProjects] = useState<TodayProject[]>([]);
  useDecisionReminders(session, pmOrg, projects);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [reminded, setReminded] = useState<Set<number>>(new Set());
  const [levels, setLevels] = useState<Record<string, PersonLevel>>({});
  const [assigning, setAssigning] = useState<number | null>(null);
  const [pick, setPick] = useState("");
  const [open, setOpen] = useState<Set<TodayGroup>>(new Set(["decisions", "stuck", "waiting", "running"]));

  const reload = useCallback(async () => {
    if (!pmOrg) return;
    setBusy(true);
    setError("");
    try {
      const [loadedProjects, config] = await Promise.all([
        loadTeamToday({ session, pmOrg, lang, contentOrg }),
        loadPmConfig(session, pmOrg).catch(() => null),
      ]);
      setProjects(loadedProjects);
      setLevels(config?.levels ?? {});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setLoaded(true);
    }
  }, [session, pmOrg, lang, contentOrg]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const rows = useMemo(() => {
    const merged: Record<TodayGroup, Array<TodayRow & { project: string }>> = {
      decisions: [], stuck: [], running: [], free: [], waiting: [], done: [],
    };
    const now = new Date();
    for (const project of projects) {
      const grouped = classifyToday({ issues: project.issues, board: project.board, now, levels });
      for (const group of GROUPS) {
        for (const row of grouped[group.id]) merged[group.id].push({ ...row, project: project.title });
      }
    }
    return merged;
  }, [projects, levels]);

  async function remind(row: TodayRow) {
    if (!row.assignee) return;
    try {
      await commentOnIssue(session, pmOrg, row.issue.number, `@${row.assignee} ¿Cómo va esta tarea? Si necesitas ayuda, escríbelo aquí.`);
      setReminded((prev) => new Set(prev).add(row.issue.number));
      announce(`Le recordaste a @${row.assignee}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function remindVoters(row: TodayRow) {
    try {
      const who = await remindDecisionVoters({ session, pmOrg, issue: row.issue.number, team: row.candidates });
      setReminded((prev) => new Set(prev).add(row.issue.number));
      announce(who.length ? `Le recordaste a ${who.map((w) => `@${w}`).join(", ")}` : "Ya votaron todas las personas habilitadas");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function assign(row: TodayRow) {
    if (!pick) return;
    setBusy(true);
    setError("");
    try {
      await reassignIssue(session, pmOrg, row.issue, pick, row.taskName || shortTitle(row));
      announce(`Asignaste la tarea a @${pick}`);
      setAssigning(null);
      setPick("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const multiProject = projects.length > 1;

  return (
    <div className="hub">
      <div className="hub-header">
        <div>
          <h1 className="hub-title">Equipo hoy</h1>
          <p className="hub-lede">Cómo va el trabajo y qué necesita tu atención.</p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void reload()}>
          {busy ? "Actualizando…" : "Actualizar"}
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {!pmOrg ? <p className="hub-hint">Elige la organización del equipo para ver el trabajo.</p> : null}
      {busy && !loaded ? <p className="hub-hint">Cargando el trabajo del equipo…</p> : null}

      {loaded && !projects.length && !error ? (
        <div className="hub-empty-panel">
          <span className="hub-empty-panel__kicker">Equipo hoy</span>
          <h2 className="hub-empty-panel__title">Aún no hay trabajo repartido</h2>
          <p className="hub-empty-panel__body">Cuando repartas las subtareas de un proyecto, aquí verás cómo avanzan.</p>
        </div>
      ) : null}

      {loaded && projects.length ? (
        <div className="today-summary" role="list" aria-label="Resumen">
          {GROUPS.map((group) => (
            <div key={group.id} role="listitem" className="today-summary__item" data-group={group.id}>
              <span className="today-summary__count">{rows[group.id].length}</span>
              <span className="today-summary__label">{group.title}</span>
            </div>
          ))}
        </div>
      ) : null}

      {loaded && projects.length
        ? GROUPS.map((group) => {
            const list = rows[group.id];
            const isOpen = open.has(group.id);
            return (
              <section key={group.id} className="today-group" data-group={group.id}>
                <button
                  type="button"
                  className="today-group__head"
                  aria-expanded={isOpen}
                  onClick={() =>
                    setOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.id)) next.delete(group.id);
                      else next.add(group.id);
                      return next;
                    })
                  }
                >
                  <span className="today-group__title">{group.title}</span>
                  <span className="today-group__count">{list.length}</span>
                </button>
                {isOpen ? (
                  list.length ? (
                    <ul className="today-list">
                      {list.map((row) => (
                        <li key={row.issue.number} className="today-row">
                          <div className="today-row__main">
                            <button type="button" className="today-row__title" onClick={() => onOpenThread(row.issue.number)}>
                              {shortTitle(row)}
                              <ChevronRight aria-hidden />
                            </button>
                            <p className="today-row__meta">
                              {[multiProject ? row.project : "", row.phaseName, row.assignee ? `@${row.assignee}` : "Sin persona"]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                            <p className="today-row__reason">{row.reason}</p>
                          </div>
                          {row.group === "decisions" ? (
                            <Button type="button" size="sm" variant="outline" disabled={reminded.has(row.issue.number)} onClick={() => void remindVoters(row)}>
                              {reminded.has(row.issue.number) ? "Recordado" : "Recordar a quien falta"}
                            </Button>
                          ) : null}
                          {session.canManage && row.group !== "done" && row.group !== "waiting" && row.group !== "decisions" && row.candidates.length ? (
                            assigning === row.issue.number ? (
                              <div className="today-assign">
                                <label className="sr-only" htmlFor={`assign-${row.issue.number}`}>
                                  Persona
                                </label>
                                <select id={`assign-${row.issue.number}`} value={pick} onChange={(e) => setPick(e.target.value)}>
                                  <option value="">Elegir persona…</option>
                                  {row.candidates.map((login) => (
                                    <option key={login} value={login}>
                                      @{login}
                                    </option>
                                  ))}
                                </select>
                                <Button type="button" size="sm" disabled={!pick || busy} onClick={() => void assign(row)}>
                                  Asignar
                                </Button>
                                <Button type="button" size="sm" variant="ghost" onClick={() => setAssigning(null)}>
                                  Cancelar
                                </Button>
                              </div>
                            ) : (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setAssigning(row.issue.number);
                                  setPick("");
                                }}
                              >
                                {row.assignee ? "Pasar a otra persona" : "Asignar"}
                              </Button>
                            )
                          ) : null}
                          {row.group === "stuck" && row.assignee ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={reminded.has(row.issue.number)}
                              onClick={() => void remind(row)}
                            >
                              {reminded.has(row.issue.number) ? "Recordado" : "Recordar"}
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="today-group__empty">{group.empty}</p>
                  )
                ) : null}
              </section>
            );
          })
        : null}
    </div>
  );
}
