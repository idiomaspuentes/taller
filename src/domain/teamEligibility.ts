import type { DcsTeam } from "@ip-lms/dcs-client";
import { listTeamRepos } from "@ip-lms/dcs-client";
import type { ProjectTask, ScopeKey } from "./types";
import {
  teamHasReposForTask,
  type PmConfig,
  type TeamRepoEligibility,
} from "./roles";
import { dcsConfig } from "../dcs/config";
import type { GtSession } from "../dcs/auth";
import { loadPmConfig } from "../dcs/issues";

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

export type { TeamRepoEligibility, ScopeKey };
