import type { DcsTeam } from "@ip-lms/dcs-client";
import { listTeamRepos } from "@ip-lms/dcs-client";
import type { AssignmentsDoc, ProjectTask, ScopeKey } from "./types";
import {
  DEFAULT_PM_CONFIG,
  teamHasReposForTask,
  type PmConfig,
  type TeamRepoEligibility,
} from "./roles";
import {
  resolveReviewCandidates,
  type OrgTeamAccess,
  type ReviewCandidatesResult,
} from "./reviewTask";
import { dcsConfig } from "../dcs/config";
import type { GtSession } from "../dcs/auth";
import { loadPmConfig } from "../dcs/issues";
import { listPmOrgTeamMembers, listPmOrgTeams } from "../dcs/persist";

/**
 * Return org teams that already have every repo required by `task`.
 * Teams missing repos are listed in `ineligible` with the gap details.
 */
export async function filterTeamsEligibleForTask(params: {
  session: GtSession;
  org: string;
  lang: string;
  task: ProjectTask;
  orgTeams: DcsTeam[];
  pmConfig?: PmConfig;
}): Promise<{
  eligible: DcsTeam[];
  ineligible: Array<{ team: DcsTeam; eligibility: TeamRepoEligibility }>;
}> {
  const { session, org, lang, task, orgTeams } = params;
  const config = params.pmConfig ?? (await loadPmConfig(session, org));
  const dcs = dcsConfig(session.host);
  const eligible: DcsTeam[] = [];
  const ineligible: Array<{ team: DcsTeam; eligibility: TeamRepoEligibility }> = [];

  for (const team of orgTeams) {
    let repoNames: string[] = [];
    try {
      const repos = await listTeamRepos(dcs, team.id, session.token, { limit: 100 });
      repoNames = repos.map((r) => r.name);
    } catch {
      ineligible.push({
        team,
        eligibility: {
          ok: false,
          required: [],
          present: [],
          missing: ["(no se pudieron listar repos del equipo)"],
        },
      });
      continue;
    }
    const eligibility = teamHasReposForTask(repoNames, task, lang, config);
    if (eligibility.ok) eligible.push(team);
    else ineligible.push({ team, eligibility });
  }

  return { eligible, ineligible };
}

/** Every org team with its repos and members, read from DCS. */
export async function readOrgTeamAccess(session: GtSession, org: string): Promise<OrgTeamAccess[]> {
  const dcs = dcsConfig(session.host);
  const teams = await listPmOrgTeams(session, org);
  return Promise.all(
    teams.map(async (team) => {
      const [repos, members] = await Promise.all([
        listTeamRepos(dcs, team.id, session.token, { limit: 100 }),
        listPmOrgTeamMembers(session, team.id),
      ]);
      return { teamName: team.name, repoNames: repos.map((r) => r.name), members };
    }),
  );
}

/** Org team access, or `null` when DCS cannot be read (the list then falls back). */
export async function tryReadOrgTeamAccess(
  session: GtSession,
  org: string,
  readAccess: (session: GtSession, org: string) => Promise<OrgTeamAccess[]> = readOrgTeamAccess,
): Promise<OrgTeamAccess[] | null> {
  try {
    return await readAccess(session, org);
  } catch {
    return null;
  }
}

/**
 * «Quién revisa»: people with write access to the review's resource. If the
 * permissions cannot be read, falls back to integrantes of tasks that cover
 * the resource instead of failing.
 */
export async function loadReviewCandidates(params: {
  session: GtSession;
  org: string;
  board: Pick<AssignmentsDoc, "people" | "teams" | "phases" | "lang">;
  task: ProjectTask;
  pmConfig?: PmConfig;
  readAccess?: (session: GtSession, org: string) => Promise<OrgTeamAccess[]>;
}): Promise<ReviewCandidatesResult> {
  const access = await tryReadOrgTeamAccess(params.session, params.org, params.readAccess);
  return resolveReviewCandidates(params.board, params.task, access, params.pmConfig ?? DEFAULT_PM_CONFIG);
}

export type { TeamRepoEligibility, ScopeKey };
