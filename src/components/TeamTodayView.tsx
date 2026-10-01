import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { GtSession } from "../dcs/auth";
import { commentOnIssue, loadPmConfig, reassignIssue } from "../dcs/issues";
import { remindDecisionVoters } from "../dcs/alignmentDecisionStore";
import { loadTeamToday, type TodayProject } from "../dcs/teamToday";
import { classifyToday, type TodayGroup, type TodayRow } from "../domain/teamToday";
import { useDecisionReminders } from "../useDecisionReminders";
import { useT, type MessageKey } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";
import { localizeName, localizeToday } from "../domain/templateNames";
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

const GROUPS: { id: TodayGroup; title: MessageKey; empty: MessageKey }[] = [
  { id: "decisions", title: "td.gDecisions", empty: "td.eDecisions" },
  { id: "stuck", title: "td.gStuck", empty: "td.eStuck" },
  { id: "waiting", title: "td.gWaiting", empty: "td.eWaiting" },
  { id: "running", title: "td.gRunning", empty: "td.eRunning" },
  { id: "free", title: "td.gFree", empty: "td.eFree" },
  { id: "done", title: "td.gDone", empty: "td.eDone" },
];

function shortTitle(row: TodayRow): string {
  return row.issue.title.replace(/^[A-Z0-9]{3}\s+/i, "").trim() || row.issue.title;
}

/**
 * Equipo hoy: how the work stands, for whoever coordinates. Stuck work first,
 * each row with what can be done about it from the same place.
 */
export function TeamTodayView({ session, pmOrg, lang, contentOrg, announce, onOpenThread }: Props) {
  const t = useT();
  const language = useUiLanguage();
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
      await commentOnIssue(session, pmOrg, row.issue.number, t("td.pingText").replace("{who}", row.assignee));
      setReminded((prev) => new Set(prev).add(row.issue.number));
      announce(t("td.didRemind").replace("{who}", row.assignee));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function remindVoters(row: TodayRow) {
    try {
      const who = await remindDecisionVoters({ session, pmOrg, issue: row.issue.number, team: row.candidates });
      setReminded((prev) => new Set(prev).add(row.issue.number));
      announce(who.length ? t("td.didRemindMany").replace("{who}", who.map((w) => `@${w}`).join(", ")) : t("td.allVoted"));
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
      announce(t("td.didAssign").replace("{who}", pick));
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
          <h1 className="hub-title">{t("td.title")}</h1>
          <p className="hub-lede">{t("td.lede")}</p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void reload()}>
          {busy ? t("td.refreshing") : t("td.refresh")}
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {!pmOrg ? <p className="hub-hint">{t("td.pickOrg")}</p> : null}
      {busy && !loaded ? <p className="hub-hint">{t("td.loading")}</p> : null}

      {loaded && !projects.length && !error ? (
        <div className="hub-empty-panel">
          <span className="hub-empty-panel__kicker">{t("td.title")}</span>
          <h2 className="hub-empty-panel__title">{t("td.emptyTitle")}</h2>
          <p className="hub-empty-panel__body">{t("td.emptyBody")}</p>
        </div>
      ) : null}

      {loaded && projects.length ? (
        <div className="today-summary" role="list" aria-label={t("td.summary")}>
          {GROUPS.map((group) => (
            <div key={group.id} role="listitem" className="today-summary__item" data-group={group.id}>
              <span className="today-summary__count">{rows[group.id].length}</span>
              <span className="today-summary__label">{t(group.title)}</span>
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
                  <span className="today-group__title">{t(group.title)}</span>
                  <span className="today-group__count">{list.length}</span>
                </button>
                {isOpen ? (
                  list.length ? (
                    <ul className="today-list">
                      {list.map((row) => (
                        <li key={row.issue.number} className="today-row">
                          <div className="today-row__main">
                            <button type="button" className="today-row__title" onClick={() => onOpenThread(row.issue.number)}>
                              {localizeName(shortTitle(row), language)}
                              <ChevronRight aria-hidden />
                            </button>
                            <p className="today-row__meta">
                              {[multiProject ? row.project : "", localizeName(row.phaseName, language), row.assignee ? `@${row.assignee}` : t("td.noPerson")]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                            <p className="today-row__reason">{localizeToday(row.reason, language)}</p>
                          </div>
                          {row.group === "decisions" ? (
                            <Button type="button" size="sm" variant="outline" disabled={reminded.has(row.issue.number)} onClick={() => void remindVoters(row)}>
                              {reminded.has(row.issue.number) ? t("td.reminded") : t("td.remindVoters")}
                            </Button>
                          ) : null}
                          {session.canManage && row.group !== "done" && row.group !== "waiting" && row.group !== "decisions" && row.candidates.length ? (
                            assigning === row.issue.number ? (
                              <div className="today-assign">
                                <label className="sr-only" htmlFor={`assign-${row.issue.number}`}>
                                  {t("td.person")}
                                </label>
                                <select id={`assign-${row.issue.number}`} value={pick} onChange={(e) => setPick(e.target.value)}>
                                  <option value="">{t("td.choosePerson")}</option>
                                  {row.candidates.map((login) => (
                                    <option key={login} value={login}>
                                      @{login}
                                    </option>
                                  ))}
                                </select>
                                <Button type="button" size="sm" disabled={!pick || busy} onClick={() => void assign(row)}>
                                  {t("td.assign")}
                                </Button>
                                <Button type="button" size="sm" variant="ghost" onClick={() => setAssigning(null)}>
                                  {t("td.cancel")}
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
                                {row.assignee ? t("td.reassign") : t("td.assign")}
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
                              {reminded.has(row.issue.number) ? t("td.reminded") : t("td.remind")}
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="today-group__empty">{t(group.empty)}</p>
                  )
                ) : null}
              </section>
            );
          })
        : null}
    </div>
  );
}
