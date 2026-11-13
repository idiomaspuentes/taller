import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { GtSession } from "../dcs/auth";
import { useHeatmaps } from "../dcs/activity";
import { commentOnIssue, loadPmConfig, reassignIssue } from "../dcs/issues";
import { remindDecisionVoters } from "../dcs/alignmentDecisionStore";
import { loadDoneElsewhere, loadTeamToday, type TodayProject } from "../dcs/teamToday";
import { mergePeople, peopleWork, type HeatSlot } from "../domain/activity";
import { whileOpen } from "../domain/commentPlace";
import { spaceBooks } from "../domain/bookStanding";
import type { DoneElsewhereDoc } from "../domain/doneElsewhere";
import { issueTaskId } from "../domain/myTasks";
import { processPlan } from "../domain/processes";
import { displayOrgTeamName } from "../domain/roles";
import { classifyToday, type TodayGroup, type TodayRow } from "../domain/teamToday";
import { intakeRepos, listSuggestions } from "../dcs/outsideSuggestions";
import { useDecisionReminders } from "../useDecisionReminders";
import { useT, type MessageKey } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";
import { localizeName, localizeToday } from "../domain/templateNames";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { LevelBook } from "../domain/levels";
import { Button } from "@/components/ui/button";
import { explainError } from "../dcs/userError";
import { ActivityCalendar, ActivityStrip, useWorkLine, WORK_WEEKS } from "./ActivityCalendar";
import { BooksPanel } from "./BooksPanel";
import { LoadingState } from "./LoadingState";
import { PersonPhoto } from "./PersonPhoto";

type Props = {
  session: GtSession;
  pmOrg: string;
  lang: string;
  contentOrg: string;
  announce: (msg: string) => void;
  onOpenThread: (issue: number) => void;
  /** Opens the suggestions to the text that came from outside. */
  onOpenSuggestions?: () => void;
  /**
   * The org teams this person coordinates, for whoever coordinates without managing: they see the work of these teams
   * only. Absent for whoever manages, who sees everything.
   */
  teams?: string[];
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
          <PersonPhoto login={login} size="sm" />
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
export function TeamTodayView({ session, pmOrg, lang, contentOrg, announce, onOpenThread, onOpenSuggestions, teams }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const [projects, setProjects] = useState<TodayProject[]>([]);
  useDecisionReminders(session, pmOrg, projects);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [reminded, setReminded] = useState<Set<number>>(new Set());
  const [levels, setLevels] = useState<LevelBook>({ levels: {} });
  // The order of the projects and those set aside, and the record of what was done before Taller (null: not read).
  const [priority, setPriority] = useState<{ projectOrder: string[]; paused: string[] }>({ projectOrder: [], paused: [] });
  const [elsewhere, setElsewhere] = useState<DoneElsewhereDoc | null>(null);
  const [assigning, setAssigning] = useState<number | null>(null);
  const [pick, setPick] = useState("");
  const [open, setOpen] = useState<Set<TodayGroup>>(new Set(["decisions", "stuck", "waiting", "running"]));
  const [person, setPerson] = useState("");
  const [peopleOpen, setPeopleOpen] = useState(false);
  // What came from outside: how many suggestions wait, and whether the texts can receive them at all.
  const [outside, setOutside] = useState<{ waiting: number; ready: boolean } | null>(null);
  useEffect(() => {
    if (!pmOrg || !onOpenSuggestions) return;
    let alive = true;
    void (async () => {
      const repos = await intakeRepos({ session, pmOrg, lang, contentOrg });
      const rows = await listSuggestions(session, repos.filter((repo) => repo.ready));
      if (alive) setOutside({ waiting: rows.length, ready: repos.length > 0 && repos.every((repo) => repo.ready) });
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [session, pmOrg, lang, contentOrg, onOpenSuggestions]);

  const reload = useCallback(async () => {
    if (!pmOrg) return;
    setBusy(true);
    setError("");
    try {
      const [loadedProjects, config, record] = await Promise.all([
        loadTeamToday({ session, pmOrg, lang, contentOrg }),
        loadPmConfig(session, pmOrg).catch(() => null),
        loadDoneElsewhere(session, pmOrg, lang),
      ]);
      setProjects(loadedProjects);
      setLevels(config ?? { levels: {} });
      setPriority({ projectOrder: config?.projectOrder ?? [], paused: config?.paused ?? [] });
      setElsewhere(record);
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

  // Whoever coordinates sees the subtareas of the tasks of their teams; whoever manages, all of them.
  const teamKey = (teams ?? []).map((name) => name.trim().toLowerCase()).sort().join("|");
  const shown = useMemo(() => {
    if (!teams) return projects;
    const mine = teamKey.split("|");
    return projects.map((project) => {
      const tasks = new Set(project.board.teams.filter((task) => mine.includes((task.orgTeamName ?? "").trim().toLowerCase())).map((task) => task.id));
      return { ...project, issues: project.issues.filter((issue) => tasks.has(issueTaskId(issue))) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, teamKey]);

  const rows = useMemo(() => {
    const merged: Record<TodayGroup, Array<TodayRow & { project: string }>> = {
      decisions: [], stuck: [], running: [], free: [], waiting: [], done: [],
    };
    const now = new Date();
    for (const project of shown) {
      const grouped = classifyToday({ issues: project.issues, board: project.board, now, levels });
      for (const group of GROUPS) {
        for (const row of grouped[group.id]) merged[group.id].push({ ...row, project: project.title });
      }
    }
    return merged;
  }, [shown, levels]);

  // Every book of the space and how far it is, with what was done before Taller. A book without a project is laid out
  // by the process the record names.
  const books = useMemo(() => {
    const process = processPlan(elsewhere?.process, { lang, contentOrg, pmOrg });
    return spaceBooks({ projects, doneElsewhere: elsewhere ?? { books: {} }, process, teams: teams ? teamKey.split("|") : undefined, priority });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, elsewhere, teamKey, priority, lang, contentOrg, pmOrg]);
  const people = useMemo(() => {
    const since = new Date(Date.now() - WORK_WEEKS * 7 * 86_400_000);
    return mergePeople(shown.map((project) => peopleWork(project.issues, project.board, since)));
  }, [shown]);
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
  const teamNames = (teams ?? []).map((name) => displayOrgTeamName(name)).join(", ");

  return (
    <div className="hub">
      <div className="hub-header">
        <div>
          <h1 className="hub-title">{t("td.title")}</h1>
          <p className="hub-lede">{teams ? t("td.ledeTeams").replace("{teams}", teamNames) : t("td.lede")}</p>
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
      {outside && onOpenSuggestions ? (
        <p className="today-outside" data-waiting={outside.waiting > 0 || undefined}>
          <span>{outside.waiting ? t(outside.waiting === 1 ? "sg.waitingOne" : "sg.waiting").replace("{n}", String(outside.waiting)) : outside.ready ? t("sg.noneShort") : t("sg.notReadyShort")}</span>
          <button type="button" className="chat-link" onClick={onOpenSuggestions}>
            {outside.waiting ? t("sg.review") : outside.ready ? t("sg.see") : t("sg.setUp")}
          </button>
        </p>
      ) : null}
      {busy && !loaded ? <LoadingState shape="list" label={t("td.loading")} /> : null}

      {loaded && !projects.length && !books.length && !error ? (
        <div className="hub-empty-panel">
          <span className="hub-empty-panel__kicker">{t("td.title")}</span>
          <h2 className="hub-empty-panel__title">{t("td.emptyTitle")}</h2>
          <p className="hub-empty-panel__body">{t("td.emptyBody")}</p>
        </div>
      ) : null}

      {loaded ? <BooksPanel books={books} recordMissing={elsewhere === null} /> : null}

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
                              {[multiProject ? row.project : "", localizeName(row.phaseName, language), row.assignee ? `@${row.assignee}` : row.seated?.length ? row.seated.map((login) => `@${login}`).join(", ") : t("td.noPerson")]
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
