import { useCallback, useEffect, useMemo, useState } from "react";
import type { DcsTeam } from "@ip-lms/dcs-client";
import type { GtSession } from "../dcs/auth";
import {
  addPmOrgTeamMember,
  createPmOrgTeam,
  listPmOrgMembers,
  listPmOrgTeamMembers,
  listPmOrgTeams,
  removePmOrgTeamMember,
} from "../dcs/persist";
import type { Person } from "../domain/types";
import {
  DEFAULT_PM_CONFIG,
  displayOrgTeamName,
  isPmOrgTeamName,
  mirroredOrgTeamName,
} from "../domain/roles";
import { loadPmConfig } from "../dcs/issues";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Props = {
  session: GtSession;
  pmOrg: string;
  canManage: boolean;
  announce: (msg: string) => void;
  onOpenTeam: (orgTeamName: string) => void;
};

export function OrgView({ session, pmOrg, canManage, announce, onOpenTeam }: Props) {
  const [teams, setTeams] = useState<DcsTeam[]>([]);
  const [members, setMembers] = useState<Person[]>([]);
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
      const [orgTeams, orgMembers, pmConfig] = await Promise.all([
        listPmOrgTeams(session, pmOrg),
        canManage ? listPmOrgMembers(session, pmOrg) : Promise.resolve([] as Person[]),
        loadPmConfig(session, pmOrg),
      ]);
      setTeamPrefix(pmConfig.teamPrefix);
      const tas = orgTeams.filter((t) => isPmOrgTeamName(t.name, pmConfig.teamPrefix));
      // Workers only keep TAS (system) teams; extra DCS org teams stay manager-only.
      setTeams(canManage ? orgTeams : tas);
      setMembers(orgMembers);
      void refreshCounts(tas);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
    () => teams.filter((t) => isPmOrgTeamName(t.name, teamPrefix)),
    [teams, teamPrefix],
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
      const team = await createPmOrgTeam(session, pmOrg, name);
      setNewTeamName("");
      announce(`Equipo «${friendlyName(team.name)}» creado`);
      await reload();
      setSelectedTeamId(team.id);
      setCreateOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
        `@${username} añadido a «${friendlyName(selectedTeam?.name ?? String(selectedTeamId))}»`,
      );
      setPersonQuery("");
      if (list.length > 0) setAddOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActingUser(null);
    }
  }

  async function removeMember(username: string) {
    if (selectedTeamId == null || !username) return;
    setActingUser(username);
    setError("");
    try {
      await removePmOrgTeamMember(session, selectedTeamId, username);
      const list = await listPmOrgTeamMembers(session, selectedTeamId);
      setTeamMembers(list);
      setMemberCounts((prev) => ({ ...prev, [selectedTeamId]: list.length }));
      announce(`@${username} quitado del equipo`);
      if (canManage && list.length === 0) setAddOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActingUser(null);
    }
  }

  const createForm = canManage ? (
    <div className="hub-panel">
      <h2 className="text-sm font-semibold text-foreground">Nuevo equipo</h2>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="new-org-team">Nombre</Label>
          <Input
            id="new-org-team"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            placeholder="p. ej. Traductores, Revisores"
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
            Crear
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
              Cancelar
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
          <h1 className="hub-title">Organización</h1>
          <p className="hub-lede">
            Equipos de trabajo en {pmOrg || "—"}.
            {canManage
              ? " Créalos aquí; en el proyecto solo los asignas a tareas."
              : " Solo lectura."}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !pmOrg}
          onClick={() => void reload()}
        >
          {busy ? "Cargando…" : "Actualizar"}
        </Button>
      </div>

      <div className="grid gap-1.5">
        <button
          type="button"
          className="w-fit text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setHelpOpen((v) => !v)}
        >
          {helpOpen ? "Ocultar ayuda" : "¿Cómo funciona?"}
        </button>
        {helpOpen ? (
          <p className="hub-hint">
            Abre un equipo para ver quién está dentro. Añade personas de la organización con un
            clic. En Fases y tareas vinculas el equipo a cada tarea.
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
            + Nuevo equipo
          </Button>
        </div>
      ) : null}

      {createOpen ? createForm : null}

      {!pmOrg ? (
        <div className="hub-empty-panel">
          <p className="hub-empty-panel__kicker">Espacio de trabajo</p>
          <h2 className="hub-empty-panel__title">Falta la organización</h2>
          <p className="hub-empty-panel__body">
            Elige una organización PM en el espacio de trabajo para ver y crear equipos.
          </p>
        </div>
      ) : !loaded ? (
        <div className="hub-empty">Cargando equipos…</div>
      ) : !visibleTeams.length ? (
        <div className="hub-empty-panel">
          <p className="hub-empty-panel__kicker">Equipos</p>
          <h2 className="hub-empty-panel__title">
            {showAllOrgTeams ? "No hay equipos en la org" : "Aún no hay equipos"}
          </h2>
          <p className="hub-empty-panel__body">
            {canManage && !showAllOrgTeams
              ? "Crea el primero con un nombre claro (Traductores, Revisores…). Luego añade personas y asígnalo a las tareas del proyecto."
              : showAllOrgTeams
                ? "Esta organización no tiene equipos todavía."
                : "Pide a un gestor que cree el equipo en Organización."}
          </p>
          {canManage && teams.length > tasTeams.length && !showAllOrgTeams ? (
            <div className="hub-empty-panel__actions">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowAllOrgTeams(true)}
              >
                Ver otros equipos de la org ({teams.length - tasTeams.length})
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {showAllOrgTeams ? "Todos los equipos" : "Equipos"}
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
                  ? `Solo equipos de TAS (${tasTeams.length})`
                  : `Incluir otros de la org (${teams.length - tasTeams.length})`}
              </button>
            ) : null}
          </div>

          <div className="hub-board" role="list">
            {visibleTeams.map((team) => {
              const label = friendlyName(team.name);
              const isTas = isPmOrgTeamName(team.name, teamPrefix);
              const expanded = selectedTeamId === team.id;
              const count = memberCounts[team.id];
              const countLabel =
                count == null
                  ? null
                  : count === 1
                    ? "1 miembro"
                    : `${count} miembros`;
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
                        {countLabel ? (
                          <span className="text-xs text-muted-foreground">{countLabel}</span>
                        ) : showAllOrgTeams && !isTas ? (
                          <span className="text-xs text-muted-foreground">Otro equipo de la org</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Abrir</span>
                        )}
                      </span>
                    </span>
                  </button>

                  {expanded ? (
                    <div className="hub-team__body">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Personas
                        </h3>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => onOpenTeam(team.name)}
                        >
                          Ver tablero
                        </Button>
                      </div>

                      {membersLoading ? (
                        <p className="text-sm text-muted-foreground">Cargando personas…</p>
                      ) : (
                        <ul className="hub-team__people">
                          {teamMembers.map((m) => (
                            <li key={m.id} className="hub-team__person">
                              <span className="hub-team__person-main">
                                <span className="hub-team__person-name">{m.name}</span>
                                <span className="hub-team__person-id">@{m.id}</span>
                              </span>
                              {canManage ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  disabled={actingUser === m.id}
                                  onClick={() => void removeMember(m.id)}
                                >
                                  {actingUser === m.id ? "…" : "Quitar"}
                                </Button>
                              ) : null}
                            </li>
                          ))}
                          {!teamMembers.length ? (
                            <li className="text-sm text-muted-foreground">
                              Nadie en este equipo todavía.
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
                              + Añadir persona
                            </button>
                          ) : (
                            <div className="grid gap-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <Label htmlFor={`org-person-q-${team.id}`}>
                                  Buscar en la organización
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
                                    Cerrar
                                  </button>
                                ) : null}
                              </div>
                              <Input
                                id={`org-person-q-${team.id}`}
                                value={personQuery}
                                onChange={(e) => setPersonQuery(e.target.value)}
                                placeholder="Nombre o usuario…"
                                autoFocus
                              />
                              {!available.length ? (
                                <p className="text-xs text-muted-foreground">
                                  Todas las personas de la org ya están en este equipo.
                                </p>
                              ) : !filteredAvailable.length ? (
                                <p className="text-xs text-muted-foreground">
                                  Ninguna coincidencia.
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
                                          {actingUser === m.id ? "Añadiendo…" : "Añadir"}
                                        </span>
                                      </button>
                                    </li>
                                  ))}
                                  {filteredAvailable.length > 12 ? (
                                    <li className="px-1 text-xs text-muted-foreground">
                                      Afina la búsqueda para ver más ({filteredAvailable.length - 12}{" "}
                                      ocultas).
                                    </li>
                                  ) : null}
                                </ul>
                              )}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
