import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { GtSession } from "../dcs/auth";
import { useHeatmaps } from "../dcs/activity";
import { commentOnIssue, loadPmConfig, reassignIssue } from "../dcs/issues";
import { remindDecisionVoters } from "../dcs/alignmentDecisionStore";
import { loadTeamToday, type TodayProject } from "../dcs/teamToday";
import { mergePeople, peopleWork, type HeatSlot } from "../domain/activity";
import { whileOpen } from "../domain/commentPlace";
import { endDateText, paceNumber, paceOf, PACE_WEEKS } from "../domain/pace";
import { classifyToday, type TodayGroup, type TodayRow } from "../domain/teamToday";
import { projectTally } from "../domain/workProgress";
import { useDecisionReminders } from "../useDecisionReminders";
import { useT, type MessageKey } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";
import { localizeName, localizeToday } from "../domain/templateNames";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { LevelBook } from "../domain/levels";
import { Button } from "@/components/ui/button";
import { explainError } from "../dcs/userError";
import { ActivityCalendar, ActivityStrip, useWorkLine, WORK_WEEKS } from "./ActivityCalendar";
import { WorkLine } from "./ProgressBar";

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

/** One person: what they did these weeks in a line, and their calendar when it is asked for. */
function PersonRow({ login, slots, plan, open, onToggle }: { login: string; slots: HeatSlot[] | null | undefined; plan: string; open: boolean; onToggle: () => void }) {
  const line = useWorkLine(slots);
  return (
    <li className="today-person">
      <button type="button" className="today-person__head" aria-expanded={open} onClick={onToggle}>
        <span className="today-person__name">
          @{login}
          <ChevronRight aria-hidden />
        </span>
        <span className="today-person__line">{line}</span>
        <span className="today-person__line">{plan}</span>
        <ActivityStrip slots={slots} />
      </button>
      {open && slots ? <ActivityCalendar slots={slots} summed={false} /> : null}
    </li>
  );
}

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
  const [levels, setLevels] = useState<LevelBook>({ levels: {} });
  const [assigning, setAssigning] = useState<number | null>(null);
  const [pick, setPick] = useState("");
  const [open, setOpen] = useState<Set<TodayGroup>>(new Set(["decisions", "stuck", "waiting", "running"]));
  const [person, setPerson] = useState("");
  const [peopleOpen, setPeopleOpen] = useState(false);

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
      setLevels(config ?? { levels: {} });
    } catch (err) {
      setError(explainError(err));
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

  // How far each project is and at what pace, and what each person did these weeks: read from the same subtareas.
  const standing = useMemo(() => {
    const now = new Date();
    return projects.map((project) => ({ id: project.projectId, title: project.title, tally: projectTally(project.issues, project.board), pace: paceOf(project.issues, project.board, now) }));
  }, [projects]);
  const people = useMemo(() => {
    const since = new Date(Date.now() - WORK_WEEKS * 7 * 86_400_000);
    return mergePeople(projects.map((project) => peopleWork(project.issues, project.board, since)));
  }, [projects]);
  // Asked of Door43 only when the list is opened: one small answer per person.
  const heat = useHeatmaps(session, peopleOpen ? people.map((row) => row.login) : []);

  async function remind(row: TodayRow) {
    if (!row.assignee) return;
    try {
      await commentOnIssue(session, pmOrg, row.issue.number, whileOpen(t("td.pingText").replace("{who}", row.assignee)));
      setReminded((prev) => new Set(prev).add(row.issue.number));
      announce(t("td.didRemind").replace("{who}", row.assignee));
    } catch (err) {
      setError(explainError(err));
    }
  }

  async function remindVoters(row: TodayRow) {
    try {
      const who = await remindDecisionVoters({ session, pmOrg, issue: row.issue.number, team: row.candidates });
      setReminded((prev) => new Set(prev).add(row.issue.number));
      announce(who.length ? t("td.didRemindMany").replace("{who}", who.map((w) => `@${w}`).join(", ")) : t("td.allVoted"));
    } catch (err) {
      setError(explainError(err));
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
      setError(explainError(err));
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
            <div key={group.id} role="listitem" className="today-summary__item" data-group={group.id} data-empty={rows[group.id].length === 0}>
              <span className="today-summary__count">{rows[group.id].length}</span>
              <span className="today-summary__label">{t(group.title)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {loaded && standing.some((row) => row.tally.total) ? (
        <section className="today-group" aria-labelledby="today-projects">
          <div className="today-group__head">
            <h2 id="today-projects" className="today-group__title">
              {t("td.projects")}
            </h2>
          </div>
          <ul className="today-list">
            {standing
              .filter((row) => row.tally.total)
              .map((row) => (
                <li key={row.id} className="today-project">
                  <strong>{row.title}</strong>
                  <WorkLine tally={row.tally} />
                  <p className="today-row__reason">
                    {row.pace.left <= 0
                      ? t("pc.allDone")
                      : row.pace.perWeek > 0
                        ? t("pc.pace").replace("{weeks}", String(PACE_WEEKS)).replace("{n}", paceNumber(row.pace.perWeek, language))
                        : t("pc.none").replace("{weeks}", String(PACE_WEEKS))}
                    {row.pace.endsAt ? ` ${t("pc.ends").replace("{date}", endDateText(row.pace.endsAt, language))}` : ""}
                  </p>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      {loaded && people.length ? (
        <section className="today-group">
          {/* Folded like the groups under it: what needs attention today stays within reach. */}
          <button type="button" className="today-group__head" aria-expanded={peopleOpen} onClick={() => setPeopleOpen((prev) => !prev)}>
            <span className="today-group__title">{t("td.people")}</span>
            <span className="today-group__count">{people.length}</span>
          </button>
          {peopleOpen ? (
            <>
              <p className="today-group__empty">{t("td.peopleLede").replace("{weeks}", String(WORK_WEEKS))}</p>
              <ul className="today-list">
                {people.map((row) => (
                  <PersonRow
                    key={row.login}
                    login={row.login}
                    slots={heat[row.login.toLowerCase()]}
                    plan={t("ac.plan").replace("{steps}", String(row.steps)).replace("{finished}", String(row.finished)).replace("{inHand}", String(row.inHand))}
                    open={person === row.login}
                    onToggle={() => setPerson((prev) => (prev === row.login ? "" : row.login))}
                  />
                ))}
              </ul>
            </>
          ) : null}
        </section>
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
