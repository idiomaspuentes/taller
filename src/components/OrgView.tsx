import { listPmProjects, loadAssignmentsFromDcs, loadTeamsFromDcs } from "../dcs/persist";
import { TeamRulesPanel } from "./StepAsk";
import { ConfirmDialog } from "./ConfirmDialog";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DcsTeam } from "@ip-lms/dcs-client";
import type { GtSession } from "../dcs/auth";
import {
  addPmOrgTeamMember,
  allowPmOrgTeamToEdit,
  teamCanEdit,
  createPmOrgTeam,
  listPmOrgMembers,
  listPmOrgTeamMembers,
  listPmOrgTeams,
  removePmOrgTeamMember,
} from "../dcs/persist";
import type { Person } from "../domain/types";
import { orgTeamLabel,
  DEFAULT_PM_CONFIG,
  displayOrgTeamName,
  isAppTeam,
  isPmOrgTeamName,
  teamUsage,
  type TeamUse,
  mirroredOrgTeamName,
} from "../domain/roles";
import { loadPmConfig, savePmConfig } from "../dcs/issues";
import { LEVEL_ORDER, coordinatorsOf, isCoordinatorOf, isLevel, levelLabel, levelOf, levelsForTeam, withCoordinator, withTeamLevel, type PersonLevel } from "../domain/levels";
import type { PmConfig } from "../domain/roles";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useT } from "../i18n/messages";
import { useUiLanguage } from "../i18n/language";
import { explainError } from "../dcs/userError";

type Props = {
  session: GtSession;
  pmOrg: string;
  /** The language of the workspace's projects and their organization: with them, each team says whether it is used. */
  lang?: string;
  contentOrg?: string;
  canManage: boolean;
  announce: (msg: string) => void;
  onOpenTeam: (orgTeamName: string) => void;
};

export function OrgView({ session, pmOrg, lang, contentOrg, canManage, announce, onOpenTeam }: Props) {
  const t = useT();
  const language = useUiLanguage();
  const [teams, setTeams] = useState<DcsTeam[]>([]);
  const [members, setMembers] = useState<Person[]>([]);
  const [pmConfig, setPmConfig] = useState<PmConfig | null>(null);
  /** Which teams have tasks, once it is known: read apart, after the list is on screen. */
  const [usage, setUsage] = useState<Map<string, TeamUse> | null>(null);
  useEffect(() => {
    if (!pmOrg || !lang) return;
    let cancelled = false;
    setUsage(null);
    void (async () => {
      const [defaults, projects] = await Promise.all([loadTeamsFromDcs(session, pmOrg, lang).catch(() => null), listPmProjects(session, pmOrg, lang).catch(() => [])]);
      const boards = await Promise.all(projects.map((project) => loadAssignmentsFromDcs(session, pmOrg, lang, project.projectId, contentOrg ?? "").catch(() => null)));
      if (cancelled) return;
      setUsage(teamUsage([{ projectId: "", tasks: defaults?.teams ?? [] }, ...boards.flatMap((board) => (board ? [{ projectId: board.title || board.projectId, tasks: board.teams }] : []))]));
    })();
    return () => {
      cancelled = true;
    };
  }, [session, pmOrg, lang, contentOrg]);
  const [levelSaving, setLevelSaving] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [teamMembers, setTeamMembers] = useState<Person[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberCounts, setMemberCounts] = useState<Record<number, number>>({});
  const [newTeamName, setNewTeamName] = useState("");
  const [personQuery, setPersonQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [actingUser, setActingUser] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [teamPrefix, setTeamPrefix] = useState(DEFAULT_PM_CONFIG.teamPrefix);
  const [showAllOrgTeams, setShowAllOrgTeams] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const friendlyName = useCallback(
    (name: string) => displayOrgTeamName(name, teamPrefix),
    [teamPrefix],
  );

  const refreshCounts = useCallback(
    async (teamList: DcsTeam[]) => {
      if (!teamList.length) {
        setMemberCounts({});
        return;
      }
      const entries = await Promise.all(
        teamList.map(async (team) => {
          try {
            const list = await listPmOrgTeamMembers(session, team.id);
            return [team.id, list.length] as const;
          } catch {
            return [team.id, 0] as const;
          }
        }),
      );
      setMemberCounts((prev) => {
        const next = { ...prev };
        for (const [id, n] of entries) next[id] = n;
        return next;
      });
    },
    [session],
  );

  /** Save one person's level in one team (empty = remove it). Each team has its own ladder. */
  async function setLevel(teamName: string, login: string, level: PersonLevel | "") {
    if (!pmConfig) return;
    const key = login.trim().toLowerCase();
    setLevelSaving(key);
    try {
      const next = { ...pmConfig, ...withTeamLevel(pmConfig, teamName, login, level) };
      await savePmConfig(session, pmOrg, next);
      setPmConfig(next);
      announce(
        level
          ? t("org.nowLevel").replace("{who}", login).replace("{level}", levelLabel(level, language).toLowerCase())
          : t("org.noLevelSet").replace("{who}", login),
      );
    } catch (err) {
      setError(explainError(err));
    } finally {
      setLevelSaving(null);
    }
  }

  /** Make a person a coordinator of a team, or stop being one. Only who manages the organization decides this. */
  async function setCoordinator(team: Pick<DcsTeam, "name" | "description">, login: string, on: boolean) {
    const teamName = team.name;
    if (!pmConfig) return;
    setLevelSaving(login.trim().toLowerCase());
    try {
      const next = { ...pmConfig, ...withCoordinator(pmConfig, teamName, login, on) };
      await savePmConfig(session, pmOrg, next);
      setPmConfig(next);
      // By the name the team was given («Armonizadores»): Door43 keeps it in lower case, and it was said so.
      announce(t(on ? "org.nowCoordinator" : "org.notCoordinator").replace("{who}", login).replace("{team}", orgTeamLabel(team, teamPrefix)));
    } catch (err) {
      setError(explainError(err));
    } finally {
      setLevelSaving(null);
    }
  }

  const reload = useCallback(async () => {
    if (!pmOrg) {
      setTeams([]);
      setMembers([]);
      setMemberCounts({});
      setLoaded(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const [orgTeams, orgMembers, loadedConfig] = await Promise.all([
        listPmOrgTeams(session, pmOrg),
        canManage ? listPmOrgMembers(session, pmOrg) : Promise.resolve([] as Person[]),
        loadPmConfig(session, pmOrg),
      ]);
      setPmConfig(loadedConfig);
      setTeamPrefix(loadedConfig.teamPrefix);
      // The teams the app works with. The organization's other teams («Owners») are not listed just because the
      // person belongs to them.
      const tas = orgTeams.filter((t) => isAppTeam(t.name, loadedConfig));
      // Workers only keep TAS (system) teams; extra DCS org teams stay manager-only.
      setTeams(canManage ? orgTeams : tas);
      setMembers(orgMembers);
      void refreshCounts(tas);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
      setLoaded(true);
    }
  }, [session, pmOrg, refreshCounts, canManage]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (selectedTeamId == null) {
      setTeamMembers([]);
      setMembersLoading(false);
      setAddOpen(false);
      setPersonQuery("");
      return;
    }
    let cancelled = false;
    setMembersLoading(true);
    setPersonQuery("");
    void listPmOrgTeamMembers(session, selectedTeamId)
      .then((list) => {
        if (cancelled) return;
        setTeamMembers(list);
        setMemberCounts((prev) => ({ ...prev, [selectedTeamId]: list.length }));
        // Empty team → guide into add; otherwise keep add collapsed.
        setAddOpen(canManage && list.length === 0);
      })
      .catch(() => {
        if (cancelled) return;
        setTeamMembers([]);
        setAddOpen(canManage);
      })
      .finally(() => {
        if (!cancelled) setMembersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, selectedTeamId, canManage]);

  const selectedTeam = useMemo(
    () => teams.find((t) => t.id === selectedTeamId) ?? null,
    [teams, selectedTeamId],
  );

  const tasTeams = useMemo(
    () => teams.filter((t) => isAppTeam(t.name, pmConfig ?? { teamPrefix })),
    [teams, teamPrefix, pmConfig],
  );

  const visibleTeams = useMemo(
    () => (showAllOrgTeams ? teams : tasTeams),
    [showAllOrgTeams, teams, tasTeams],
  );

  useEffect(() => {
    if (!canManage) setShowAllOrgTeams(false);
  }, [canManage]);

  useEffect(() => {
    if (!loaded || !canManage) return;
    if (tasTeams.length === 0) setCreateOpen(true);
    else setCreateOpen(false);
  }, [loaded, canManage, tasTeams.length]);

  const available = useMemo(() => {
    const inTeam = new Set(teamMembers.map((m) => m.id.toLowerCase()));
    return members.filter((m) => !inTeam.has(m.id.toLowerCase()));
  }, [members, teamMembers]);

  const filteredAvailable = useMemo(() => {
    const q = personQuery.trim().toLowerCase();
    if (!q) return available;
    return available.filter((m) => {
      const hay = `${m.name} ${m.id}`.toLowerCase();
      return hay.includes(q);
    });
  }, [available, personQuery]);

  /** Let a team edit the repositories it is given: without it its people can only read, whatever task they get. */
  async function allowEdit(team: DcsTeam) {
    setBusy(true);
    setError("");
    try {
      await allowPmOrgTeamToEdit(session, team);
      announce(t("org.canEditNow").replace("{team}", orgTeamLabel(team, teamPrefix)));
      await reload();
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  function toggleTeam(id: number) {
    setSelectedTeamId((prev) => (prev === id ? null : id));
  }

  async function createTeam() {
    const raw = newTeamName.trim();
    if (!raw) return;
    const withoutPrefix =
      teamPrefix && raw.toLowerCase().startsWith(teamPrefix.toLowerCase())
        ? raw.slice(teamPrefix.length)
        : raw;
    const name = teamPrefix
      ? mirroredOrgTeamName(withoutPrefix, teamPrefix)
      : withoutPrefix;
    setBusy(true);
    setError("");
    try {
      const team = await createPmOrgTeam(session, pmOrg, name, withoutPrefix);
      setNewTeamName("");
      announce(t("org.teamCreated").replace("{team}", orgTeamLabel(team, teamPrefix)));
      await reload();
      setSelectedTeamId(team.id);
      setCreateOpen(false);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  async function addMember(username: string) {
    if (selectedTeamId == null || !username) return;
    setActingUser(username);
    setError("");
    try {
      await addPmOrgTeamMember(session, selectedTeamId, username);
      const list = await listPmOrgTeamMembers(session, selectedTeamId);
      setTeamMembers(list);
      setMemberCounts((prev) => ({ ...prev, [selectedTeamId]: list.length }));
      announce(
        t("org.memberAdded")
          .replace("{who}", username)
          .replace("{team}", friendlyName(selectedTeam?.name ?? String(selectedTeamId))),
      );
      setPersonQuery("");
      if (list.length > 0) setAddOpen(false);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setActingUser(null);
    }
  }

  // «Quitar» sits beside the level and «Hacer coordinador», and one touch took somebody out of the team: it is
  // asked first, by name.
  const [removing, setRemoving] = useState<{ id: string; team: string } | null>(null);

  async function removeMember(username: string) {
    if (selectedTeamId == null || !username) return;
    setActingUser(username);
    setError("");
    try {
      await removePmOrgTeamMember(session, selectedTeamId, username);
      const list = await listPmOrgTeamMembers(session, selectedTeamId);
      setTeamMembers(list);
      setMemberCounts((prev) => ({ ...prev, [selectedTeamId]: list.length }));
      announce(t("org.memberRemoved").replace("{who}", username));
      if (canManage && list.length === 0) setAddOpen(true);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setActingUser(null);
    }
  }

  const createForm = canManage ? (
    <div className="hub-panel">
      <h2 className="text-sm font-semibold text-foreground">{t("org.newTeam")}</h2>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="new-org-team">{t("org.name")}</Label>
          <Input
            id="new-org-team"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            placeholder={t("org.namePlaceholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void createTeam();
              }
            }}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={busy || !newTeamName.trim()}
            onClick={() => void createTeam()}
          >
            {t("org.create")}
          </Button>
          {tasTeams.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setCreateOpen(false);
                setNewTeamName("");
              }}
            >
              {t("org.cancel")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="hub">
      <div className="hub-header">
        <div>
          <h1 className="hub-title">{t("org.title")}</h1>
          <p className="hub-lede">
            {t("org.lede").replace("{org}", pmOrg || "—")}
            {canManage ? t("org.ledeManage") : t("org.readOnly")}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !pmOrg}
          onClick={() => void reload()}
        >
          {busy ? t("org.loading") : t("org.refresh")}
        </Button>
      </div>

      <div className="grid gap-1.5">
        <button
          type="button"
          className="w-fit text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setHelpOpen((v) => !v)}
        >
          {helpOpen ? t("org.hideHelp") : t("org.howItWorks")}
        </button>
        {helpOpen ? (
          <p className="hub-hint">
            {t("org.help")}
          </p>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {canManage && tasTeams.length > 0 && !createOpen ? (
        <div>
          <Button type="button" variant="outline" onClick={() => setCreateOpen(true)}>
            {t("org.newTeamPlus")}
          </Button>
        </div>
      ) : null}

      {createOpen ? createForm : null}

      {!pmOrg ? (
        <div className="hub-empty-panel">
          <p className="hub-empty-panel__kicker">{t("org.workspaceKicker")}</p>
          <h2 className="hub-empty-panel__title">{t("org.missingOrg")}</h2>
          <p className="hub-empty-panel__body">
            {t("org.missingOrgBody")}
          </p>
        </div>
      ) : !loaded ? (
        <div className="hub-empty">{t("org.loadingTeams")}</div>
      ) : !visibleTeams.length ? (
        <div className="hub-empty-panel">
          <p className="hub-empty-panel__kicker">{t("org.teamsKicker")}</p>
          <h2 className="hub-empty-panel__title">
            {showAllOrgTeams ? t("org.noTeamsOrg") : t("org.noTeamsYet")}
          </h2>
          <p className="hub-empty-panel__body">
            {canManage && !showAllOrgTeams
              ? t("org.createFirst")
              : showAllOrgTeams
                ? t("org.orgNoTeams")
                : t("org.askManager")}
          </p>
          {canManage && teams.length > tasTeams.length && !showAllOrgTeams ? (
            <div className="hub-empty-panel__actions">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowAllOrgTeams(true)}
              >
                {t("org.seeOthers").replace("{n}", String(teams.length - tasTeams.length))}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {showAllOrgTeams ? t("org.allTeams") : t("org.teamsKicker")}
              <span className="ml-1.5 font-medium normal-case tracking-normal text-muted-foreground/80">
                · {visibleTeams.length}
              </span>
            </h2>
            {canManage && (showAllOrgTeams || teams.length > tasTeams.length) ? (
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => setShowAllOrgTeams((v) => !v)}
              >
                {showAllOrgTeams
                  ? t("org.onlyTaller").replace("{n}", String(tasTeams.length))
                  : t("org.includeOthers").replace("{n}", String(teams.length - tasTeams.length))}
              </button>
            ) : null}
          </div>

          <div className="hub-board" role="list">
            {visibleTeams.map((team) => {
              const label = orgTeamLabel(team, teamPrefix);
              const isTas = isPmOrgTeamName(team.name, teamPrefix);
              const used = usage?.get(team.name.trim().toLowerCase());
              const expanded = selectedTeamId === team.id;
              const count = memberCounts[team.id];
              const countLabel =
                count == null
                  ? null
                  : count === 1
                    ? t("org.memberOne")
                    : t("org.memberMany").replace("{n}", String(count));
              return (
                <div
                  key={team.id}
                  className={cn("hub-team", expanded && "hub-team--open")}
                  role="listitem"
                >
                  <button
                    type="button"
                    className="hub-row"
                    data-current={expanded ? "true" : "false"}
                    aria-expanded={expanded}
                    onClick={() => toggleTeam(team.id)}
                  >
                    <span className="hub-row-strip" aria-hidden />
                    <span className="hub-row-body">
                      <span className="hub-row-title">{label}</span>
                      <span className="hub-row-meta">
                        {/* Whether any task has this team: what tells a team in use from one that can be renamed or removed. */}
                        {usage ? (
                          used ? (
                            <span className="hub-used" title={[...used.projects.filter(Boolean), ...(used.projects.includes("") ? [t("org.usedDefault")] : [])].join(" · ")}>
                              {used.tasks ? t(used.tasks === 1 ? "org.usedOne" : "org.usedMany").replace("{n}", String(used.tasks)) : t("org.usedNew")}
                            </span>
                          ) : (
                            <span className="hub-used" data-unused="true">
                              {t("org.unused")}
                            </span>
                          )
                        ) : null}
                        {countLabel ? (
                          <span className="text-xs text-muted-foreground">{countLabel}</span>
                        ) : showAllOrgTeams && !isTas ? (
                          <span className="text-xs text-muted-foreground">{t("org.otherTeam")}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">{t("org.open")}</span>
                        )}
                      </span>
                    </span>
                  </button>

                  {expanded ? (
                    <div className="hub-team__body">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {t("org.people")}
                        </h3>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => onOpenTeam(team.name)}
                        >
                          {t("org.seeBoard")}
                        </Button>
                      </div>

                      {pmConfig && !coordinatorsOf(pmConfig, team.name).length ? (
                        <p className="hub-team__note">{t("org.noCoordinator")}</p>
                      ) : null}
                      {!teamCanEdit(team) ? (
                        <div className="hub-team__readonly">
                          <span>{t(canManage ? "org.readOnly" : "org.readOnlyAsk")}</span>
                          {canManage ? (
                            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void allowEdit(team)}>
                              {t("org.allowEdit")}
                            </Button>
                          ) : null}
                        </div>
                      ) : null}

                      {membersLoading ? (
                        <p className="text-sm text-muted-foreground">{t("org.loadingPeople")}</p>
                      ) : (
                        <ul className="hub-team__people">
                          {teamMembers.map((m) => (
                            <li key={m.id} className="hub-team__person">
                              <span className="hub-team__person-main">
                                <span className="hub-team__person-name">{m.name}</span>
                                <span className="hub-team__person-id">@{m.id}</span>
                              </span>
                              {pmConfig && isCoordinatorOf(pmConfig, team.name, m.id) ? (
                                <span className="hub-team__coordinator">{t("org.coordinator")}</span>
                              ) : null}
                              {pmConfig && !(canManage || isCoordinatorOf(pmConfig, team.name, session.username)) && levelOf(levelsForTeam(pmConfig, team.name), m.id) ? (
                                <span className="hub-team__level-text">{levelLabel(levelOf(levelsForTeam(pmConfig, team.name), m.id)!, language)}</span>
                              ) : null}
                              {pmConfig && (canManage || isCoordinatorOf(pmConfig, team.name, session.username)) ? (
                                <select
                                  className="hub-team__level"
                                  aria-label={t("org.levelOf").replace("{who}", m.id)}
                                  value={levelOf(levelsForTeam(pmConfig, team.name), m.id) ?? ""}
                                  disabled={levelSaving === m.id.toLowerCase()}
                                  onChange={(e) => void setLevel(team.name, m.id, isLevel(e.target.value) ? e.target.value : "")}
                                >
                                  <option value="">{t("org.noLevel")}</option>
                                  {LEVEL_ORDER.map((level) => (
                                    <option key={level} value={level}>
                                      {levelLabel(level, language)}
                                    </option>
                                  ))}
                                </select>
                              ) : null}
                              {canManage && pmConfig ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  disabled={levelSaving === m.id.toLowerCase()}
                                  onClick={() => void setCoordinator(team, m.id, !isCoordinatorOf(pmConfig, team.name, m.id))}
                                >
                                  {isCoordinatorOf(pmConfig, team.name, m.id) ? t("org.unsetCoordinator") : t("org.setCoordinator")}
                                </Button>
                              ) : null}
                              {canManage ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  disabled={actingUser === m.id}
                                  onClick={() => setRemoving({ id: m.id, team: orgTeamLabel(team) })}
                                >
                                  {actingUser === m.id ? "…" : t("org.remove")}
                                </Button>
                              ) : null}
                            </li>
                          ))}
                          {!teamMembers.length ? (
                            <li className="text-sm text-muted-foreground">
                              {t("org.nobody")}
                            </li>
                          ) : null}
                        </ul>
                      )}

                      {canManage ? (
                        <div className="hub-team__add">
                          {!addOpen ? (
                            <button
                              type="button"
                              className="hub-team__add-toggle"
                              onClick={() => setAddOpen(true)}
                            >
                              {t("org.addPerson")}
                            </button>
                          ) : (
                            <div className="grid gap-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <Label htmlFor={`org-person-q-${team.id}`}>
                                  {t("org.searchOrg")}
                                </Label>
                                {teamMembers.length > 0 ? (
                                  <button
                                    type="button"
                                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                                    onClick={() => {
                                      setAddOpen(false);
                                      setPersonQuery("");
                                    }}
                                  >
                                    {t("org.close")}
                                  </button>
                                ) : null}
                              </div>
                              <Input
                                id={`org-person-q-${team.id}`}
                                value={personQuery}
                                onChange={(e) => setPersonQuery(e.target.value)}
                                placeholder={t("org.searchPlaceholder")}
                                autoFocus
                              />
                              {!available.length ? (
                                <p className="text-xs text-muted-foreground">
                                  {t("org.allInTeam")}
                                </p>
                              ) : !filteredAvailable.length ? (
                                <p className="text-xs text-muted-foreground">
                                  {t("org.noMatch")}
                                </p>
                              ) : (
                                <ul className="hub-team__candidates" role="listbox">
                                  {filteredAvailable.slice(0, 12).map((m) => (
                                    <li key={m.id}>
                                      <button
                                        type="button"
                                        className="hub-team__candidate"
                                        role="option"
                                        disabled={actingUser === m.id}
                                        onClick={() => void addMember(m.id)}
                                      >
                                        <span className="hub-team__person-main">
                                          <span className="hub-team__person-name">{m.name}</span>
                                          <span className="hub-team__person-id">@{m.id}</span>
                                        </span>
                                        <span className="hub-team__candidate-action">
                                          {actingUser === m.id ? t("org.adding") : t("org.add")}
                                        </span>
                                      </button>
                                    </li>
                                  ))}
                                  {filteredAvailable.length > 12 ? (
                                    <li className="px-1 text-xs text-muted-foreground">
                                      {t("org.refine").replace("{n}", String(filteredAvailable.length - 12))}
                                    </li>
                                  ) : null}
                                </ul>
                              )}
                            </div>
                          )}
                        </div>
                      ) : null}
                      <TeamRulesPanel team={team.name} canEdit={canManage || isCoordinatorOf(pmConfig ?? undefined, team.name, session.username)} />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        safe
        title={t("org.removeAskTitle").replace("{who}", removing?.id ?? "").replace("{team}", removing?.team ?? "")}
        text={t("org.removeAskText")}
        yes={t("org.removeYes")}
        onYes={() => {
          const who = removing?.id;
          setRemoving(null);
          if (who) void removeMember(who);
        }}
        onNo={() => setRemoving(null)}
      />
    </div>
  );
}
