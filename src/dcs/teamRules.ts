import { createOrUpdateContents, getContents, getRawContent } from "@ip-lms/dcs-client";
import { uid } from "../domain/assignment";
import { isCoordinatorOf, teamKey } from "../domain/levels";
import { addRule, emptyTeamRules, normalizeTeamRules, pendingRules, reviewRule, teamRulesPath, type TeamRule, type TeamRulesDoc } from "../domain/teamRules";
import { PM_REPO_NAME } from "../domain/types";
import { isWriteRace, raceDelay } from "./afinacionStore";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import { loadPmConfig } from "./issues";

/** The rules a team gave itself (see `domain/teamRules`), kept in the plan repository of its workspace. */

export async function loadTeamRules(session: GtSession, org: string, team: string): Promise<TeamRulesDoc> {
  try {
    const raw = await getRawContent(dcsConfig(session.host), org, PM_REPO_NAME, teamRulesPath(team), { token: session.token });
    return normalizeTeamRules(JSON.parse(raw), team);
  } catch {
    return emptyTeamRules(team);
  }
}

/**
 * Read the file, change it and write it back. Two people of a team may add a rule in the same minute: the write
 * that arrives second reads again and applies its change on top, so neither rule is lost.
 */
async function change(session: GtSession, org: string, team: string, apply: (doc: TeamRulesDoc) => TeamRulesDoc, message: string): Promise<TeamRulesDoc> {
  const config = dcsConfig(session.host);
  const path = teamRulesPath(team);
  for (let attempt = 1; ; attempt++) {
    let sha: string | undefined;
    let doc = emptyTeamRules(team);
    try {
      const existing = await getContents(config, org, PM_REPO_NAME, path, { token: session.token });
      if (!Array.isArray(existing) && existing.sha) {
        sha = existing.sha;
        doc = await loadTeamRules(session, org, team);
      }
    } catch {
      /* no file yet */
    }
    const next = apply(doc);
    if (next === doc) return doc;
    try {
      await createOrUpdateContents(config, org, PM_REPO_NAME, path, { content: `${JSON.stringify(next, null, 2)}\n`, message, sha, token: session.token });
      return next;
    } catch (err) {
      if (!isWriteRace(err) || attempt === 4) throw err;
      await raceDelay(attempt);
    }
  }
}

export async function addTeamRule(session: GtSession, org: string, team: string, text: string): Promise<TeamRulesDoc> {
  const book = await loadPmConfig(session, org).catch(() => undefined);
  const coordinator = isCoordinatorOf(book, team, session.username);
  return change(session, org, team, (doc) => addRule(doc, { id: uid().slice(0, 8), text, by: session.username, at: new Date().toISOString(), coordinator }), `Regla del equipo ${teamKey(team)}`);
}

export async function reviewTeamRule(session: GtSession, org: string, team: string, id: string, answer: { keep: true; text?: string } | { keep: false }): Promise<TeamRulesDoc> {
  return change(session, org, team, (doc) => reviewRule(doc, id, session.username, answer), `Regla del equipo ${teamKey(team)} revisada`);
}

export type PendingTeamRule = { team: string; rule: TeamRule };

/** What waits for this person as a coordinator: the rules added to the teams they coordinate, not yet looked at. */
export async function pendingTeamRules(session: GtSession, org: string): Promise<PendingTeamRule[]> {
  const book = await loadPmConfig(session, org).catch(() => undefined);
  const me = session.username.trim().toLowerCase();
  const teams = Object.entries(book?.coordinators ?? {})
    .filter(([, who]) => who.includes(me))
    .map(([team]) => team);
  const docs = await Promise.all(teams.map((team) => loadTeamRules(session, org, team)));
  return docs.flatMap((doc, i) => pendingRules(doc).map((rule) => ({ team: teams[i]!, rule })));
}
