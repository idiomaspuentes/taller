import type { DcsTeam } from "@ip-lms/dcs-client";
import type { ScopeKey } from "./types";
import { normalizeCoordinators, normalizeLevels, normalizeTeamLevels, type PersonLevel } from "./levels";
import { defaultTaRepo, defaultTwRepo } from "./books";
import { PM_REPO_NAME } from "./types";

/**
 * Project-management namespace id.
 * Used as the root DCS label on every platform issue (`pm`) and as the
 * prefix for facet labels (`pm/recurso:tpl`) and mirrored org teams (`pm-…`).
 */
export const DEFAULT_PM_NAMESPACE = "pm";

/** Config stored at `{pmOrg}/gateway-tasks/config.json`. */
export type PmConfig = {
  /**
   * Stable id for this product's DCS objects (labels, mirrored teams).
   * Default: `pm` (project-management). Change only if one org hosts
   * multiple PM products that must not collide.
   */
  namespaceId: string;
  /** Org team whose members can manage projects. Default: `managers`. */
  managerTeam: string;
  /** Prefix when mirroring app teams to org teams. Default: `{namespaceId}-`. */
  teamPrefix: string;
  /**
   * Map ScopeKey → destination repo name template.
   * Known defaults: academia → `{lang}_ta`, palabras → `{lang}_tw`,
   * tpl → `{lang}_glt`, tps → `{lang}_gst`, notas → `{lang}_tn`,
   * preguntas → `{lang}_tq`.
   */
  resourceRepos: Partial<Record<ScopeKey, string>>;
  /** General level of each person (lowercase login), from before levels were per team. Missing = not filtered. */
  levels: Record<string, PersonLevel>;
  /** Level of each person in each team (lowercase team name → login). See `LevelBook` in `levels.ts`. */
  teamLevels: Record<string, Record<string, PersonLevel>>;
  /** Coordinators of each team (lowercase team name → logins). */
  coordinators: Record<string, string[]>;
};

export const DEFAULT_PM_CONFIG: PmConfig = {
  namespaceId: DEFAULT_PM_NAMESPACE,
  managerTeam: "managers",
  teamPrefix: `${DEFAULT_PM_NAMESPACE}-`,
  resourceRepos: {},
  levels: {},
  teamLevels: {},
  coordinators: {},
};

export function normalizePmConfig(raw: unknown): PmConfig {
  const row = raw && typeof raw === "object" ? (raw as Partial<PmConfig>) : {};
  const namespaceId =
    typeof row.namespaceId === "string" && /^[a-z][a-z0-9_-]{0,31}$/i.test(row.namespaceId.trim())
      ? row.namespaceId.trim().toLowerCase()
      : DEFAULT_PM_CONFIG.namespaceId;
  const managerTeam =
    typeof row.managerTeam === "string" && row.managerTeam.trim()
      ? row.managerTeam.trim()
      : DEFAULT_PM_CONFIG.managerTeam;
  // Explicit empty string is allowed (disable prefix); missing → `{ns}-`.
  const teamPrefix =
    typeof row.teamPrefix === "string"
      ? row.teamPrefix
      : `${namespaceId}-`;
  const resourceRepos: Partial<Record<ScopeKey, string>> = {};
  if (row.resourceRepos && typeof row.resourceRepos === "object") {
    for (const [key, value] of Object.entries(row.resourceRepos)) {
      if (typeof value === "string" && value.trim()) {
        resourceRepos[key as ScopeKey] = value.trim();
      }
    }
  }
  return {
    namespaceId,
    managerTeam,
    teamPrefix,
    resourceRepos,
    levels: normalizeLevels(row.levels),
    teamLevels: normalizeTeamLevels(row.teamLevels),
    coordinators: normalizeCoordinators(row.coordinators),
  };
}

/** Root label applied to every platform issue — primary search filter. */
export function pmRootLabel(namespaceId: string = DEFAULT_PM_NAMESPACE): string {
  return namespaceId;
}

/**
 * Facet label under the namespace, e.g. `pm/recurso:tpl`, `pm/equipo:alpha`,
 * `pm/tarea:{taskId}`, `pm/cap:1`, `pm/libro:NEH`, `pm/estado:en-curso`.
 */
export function pmFacetLabel(
  facet: "recurso" | "equipo" | "tarea" | "cap" | "libro" | "estado",
  value: string | number,
  namespaceId: string = DEFAULT_PM_NAMESPACE,
): string {
  const clean = String(value).trim().replace(/\s+/g, "-");
  return `${namespaceId}/${facet}:${clean}`;
}

export function isPmRootLabel(
  name: string,
  namespaceId: string = DEFAULT_PM_NAMESPACE,
): boolean {
  return name === namespaceId;
}

export function isPmFacetLabel(
  name: string,
  namespaceId: string = DEFAULT_PM_NAMESPACE,
): boolean {
  return name.startsWith(`${namespaceId}/`);
}

export function isPmLabel(
  name: string,
  namespaceId: string = DEFAULT_PM_NAMESPACE,
): boolean {
  return isPmRootLabel(name, namespaceId) || isPmFacetLabel(name, namespaceId);
}

/** Extract value from `pm/equipo:alpha` → `alpha`. */
export function parsePmFacetValue(
  name: string,
  facet: "recurso" | "equipo" | "tarea" | "cap" | "libro" | "estado",
  namespaceId: string = DEFAULT_PM_NAMESPACE,
): string | null {
  const prefix = `${namespaceId}/${facet}:`;
  if (!name.startsWith(prefix)) return null;
  return name.slice(prefix.length) || null;
}

/** True when the user is an org Owner (DCS permission) or a member of `managers`. */
export function canManageOrg(
  teams: DcsTeam[],
  org: string,
  managerTeam: string = DEFAULT_PM_CONFIG.managerTeam,
): boolean {
  return teams.some((team) => {
    if (team.organization?.name !== org) return false;
    if (team.permission === "owner") return true;
    return team.name === managerTeam;
  });
}

export function isOrgOwner(teams: DcsTeam[], org: string): boolean {
  return teams.some(
    (team) => team.organization?.name === org && team.permission === "owner",
  );
}

/**
 * Whether two readings of a person's teams say the same: the same teams, of the same organizations, with the same
 * permission. The teams are read again while the app is open, and nothing should be redrawn when nothing changed.
 */
export function sameTeams(a: DcsTeam[] | undefined, b: DcsTeam[] | undefined): boolean {
  const said = (teams: DcsTeam[] | undefined) =>
    (teams ?? []).map((team) => `${team.organization?.name ?? ""}/${team.name}/${team.permission}`).sort().join("\n");
  return said(a) === said(b);
}

export function memberOfOrgTeam(teams: DcsTeam[], org: string, teamName: string): boolean {
  return teams.some(
    (team) => team.organization?.name === org && team.name === teamName,
  );
}

/** Slug for mirroring app team names into DCS org team names. */
export function slugTeamName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "equipo";
}

export function mirroredOrgTeamName(appTeamName: string, teamPrefix: string): string {
  return `${teamPrefix}${slugTeamName(appTeamName)}`;
}

export function isPmOrgTeamName(
  name: string,
  teamPrefix: string = DEFAULT_PM_CONFIG.teamPrefix,
): boolean {
  if (!teamPrefix) return true;
  return name.startsWith(teamPrefix);
}

/**
 * Whether a team of the organization is one the app works with: the app created it (its name carries the prefix),
 * or the team settings name it (it has levels, a coordinator, or it is the team of whoever runs the projects).
 * The organization has other teams of its own («Owners», «translators»); belonging to one of them does not make it
 * a team of the app.
 */
export function isAppTeam(
  name: string,
  config: { teamPrefix?: string; managerTeam?: string; teamLevels?: Record<string, unknown>; coordinators?: Record<string, unknown> } = {},
): boolean {
  if (isPmOrgTeamName(name, config.teamPrefix ?? DEFAULT_PM_CONFIG.teamPrefix)) return true;
  const key = name.trim().toLowerCase();
  const named = (book: Record<string, unknown> | undefined) => Object.keys(book ?? {}).some((team) => team.trim().toLowerCase() === key);
  return key === (config.managerTeam ?? "").trim().toLowerCase() || named(config.teamLevels) || named(config.coordinators);
}

/** Where a team is used: how many tasks have it, and in which projects (`""` = the tasks a new project starts with). */
export type TeamUse = { tasks: number; projects: string[] };

/**
 * Which teams have work: every task that names a team, in the tasks a new project starts with and in each project.
 * A team nobody gave a task to is safe to rename or remove; one that is used is not.
 */
export function teamUsage(sources: { projectId: string; tasks: { orgTeamName?: string }[] }[]): Map<string, TeamUse> {
  const use = new Map<string, TeamUse>();
  for (const source of sources) {
    for (const task of source.tasks) {
      const key = (task.orgTeamName ?? "").trim().toLowerCase();
      if (!key) continue;
      const row = use.get(key) ?? { tasks: 0, projects: [] };
      row.tasks += 1;
      if (!row.projects.includes(source.projectId)) row.projects.push(source.projectId);
      use.set(key, row);
    }
  }
  return use;
}

/**
 * The name a team is shown with. Door43 only keeps letters, digits and hyphens in a team's name, so the name the
 * person typed («Revisión de notas») is kept in its description; it is used when it still matches the team's name.
 */
export function orgTeamLabel(
  team: { name: string; description?: string },
  teamPrefix: string = DEFAULT_PM_CONFIG.teamPrefix,
): string {
  const typed = team.description?.trim();
  const bare = displayOrgTeamName(team.name, teamPrefix);
  return typed && slugTeamName(typed) === slugTeamName(bare) ? typed : bare;
}

/** Human label for an org team — strips the internal DCS prefix (`pm-…`). */
export function displayOrgTeamName(
  name: string,
  teamPrefix: string = DEFAULT_PM_CONFIG.teamPrefix,
): string {
  const raw = name.trim();
  if (teamPrefix && raw.startsWith(teamPrefix)) {
    return raw.slice(teamPrefix.length) || raw;
  }
  return raw;
}

/**
 * Resolve destination repo for a resource.
 * Academia/Palabras fall back to `{lang}_ta` / `{lang}_tw`.
 * Other resources need an explicit entry in `resourceRepos`.
 */
export function resolveResourceRepo(
  resource: ScopeKey,
  lang: string,
  config: PmConfig = DEFAULT_PM_CONFIG,
): string | undefined {
  const configured = config.resourceRepos[resource];
  if (configured) {
    return configured
      .replaceAll("{lang}", lang.trim().toLowerCase().replace(/_gl$/, ""))
      .replaceAll("{lang_gl}", lang.trim().toLowerCase().endsWith("_gl")
        ? lang.trim().toLowerCase()
        : `${lang.trim().toLowerCase()}_gl`);
  }
  if (resource === "academia") return defaultTaRepo(lang);
  if (resource === "palabras") return defaultTwRepo(lang);
  // Door43-style destination names when config.json omits the key.
  const base = lang.trim().toLowerCase().replace(/_gl$/, "") || "es-419";
  if (resource === "tpl") return `${base}_glt`;
  if (resource === "tps") return `${base}_gst`;
  if (resource === "notas") return `${base}_tn`;
  if (resource === "preguntas") return `${base}_tq`;
  return undefined;
}

/** Unique content repos a task needs write access to, plus the PM repo. */
export function reposForTask(
  task: { scope: ScopeKey[]; rules?: { resource: ScopeKey }[] },
  lang: string,
  config: PmConfig = DEFAULT_PM_CONFIG,
): string[] {
  const scope =
    task.scope?.length
      ? task.scope
      : (task.rules ?? []).map((r) => r.resource);
  return reposForTeam(scope, lang, config);
}

/** @deprecated Prefer {@link reposForTask}. */
export function reposForTeam(
  scope: ScopeKey[],
  lang: string,
  config: PmConfig = DEFAULT_PM_CONFIG,
): string[] {
  const repos = new Set<string>([PM_REPO_NAME]);
  for (const resource of scope) {
    const repo = resolveResourceRepo(resource, lang, config);
    if (repo) repos.add(repo);
  }
  return [...repos];
}

export type TeamRepoEligibility = {
  ok: boolean;
  required: string[];
  present: string[];
  missing: string[];
};

/**
 * A DCS org team may be assigned to a project task only if it already has
 * every repository the task's resources need.
 */
export function teamHasReposForTask(
  teamRepoNames: string[],
  task: { scope: ScopeKey[]; rules?: { resource: ScopeKey }[] },
  lang: string,
  config: PmConfig = DEFAULT_PM_CONFIG,
): TeamRepoEligibility {
  const required = reposForTask(task, lang, config);
  const presentSet = new Set(teamRepoNames.map((n) => n.toLowerCase()));
  const missing = required.filter((r) => !presentSet.has(r.toLowerCase()));
  return {
    ok: missing.length === 0,
    required,
    present: teamRepoNames,
    missing,
  };
}
