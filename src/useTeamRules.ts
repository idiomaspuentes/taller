import { useEffect, useState } from "react";
import type { GtSession } from "./dcs/auth";
import { listPmOrgTeams } from "./dcs/persist";
import { addTeamRule, coordinatedTeams, loadTeamRules, reviewTeamRule, type PendingTeamRule } from "./dcs/teamRules";
import { displayOrgTeamName, orgTeamLabel } from "./domain/roles";
import { teamKey } from "./domain/levels";
import { pendingRules, type RuleAnswer, type TeamRulesDoc } from "./domain/teamRules";
import { PM_REPO_NAME } from "./domain/types";
import { getUiLanguage } from "./i18n/language";
import { askNotices } from "./push";

/**
 * The rules of the teams, read once and shared by every place that shows them: the card of a subtarea, the tool,
 * the team's own screen, the coordinator's notices and the badge. The app says whose session and which organization
 * (`setTeamRulesContext`); each place asks for a team's rules and is told when they change.
 */

let context: { session: GtSession; org: string } | null = null;
const docs = new Map<string, TeamRulesDoc>();
const loading = new Set<string>();
let coordinated: string[] | null = null;
let askedCoordinated = false;
/** The name each team was given by whoever created it («Traductores TPS»), by the name Door43 keeps for it. */
let labels = new Map<string, string>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((fn) => fn());

export function setTeamRulesContext(session: GtSession | null | undefined, org: string): void {
  const same = context && session && context.org === org && context.session.token === session.token && context.session.host === session.host;
  if (same) return;
  context = session && org ? { session, org } : null;
  docs.clear();
  loading.clear();
  coordinated = null;
  askedCoordinated = false;
  changed();
}

/** Forget what was read, so the next look reads again (the person asked to refresh, or came back to the app). */
export function refreshTeamRules(): void {
  docs.clear();
  loading.clear();
  coordinated = null;
  askedCoordinated = false;
  changed();
}

function ensure(team: string): void {
  const key = teamKey(team);
  if (!context || !key || docs.has(key) || loading.has(key)) return;
  const at = context;
  loading.add(key);
  void loadTeamRules(at.session, at.org, key)
    .then((doc) => {
      if (context !== at) return;
      docs.set(key, doc);
      loading.delete(key);
      changed();
    })
    .catch(() => loading.delete(key));
}

function ensureCoordinated(): void {
  if (!context || askedCoordinated) return;
  const at = context;
  askedCoordinated = true;
  void coordinatedTeams(at.session, at.org)
    .then((teams) => {
      if (context !== at) return;
      coordinated = teams;
      changed();
    })
    .catch(() => undefined);
  void listPmOrgTeams(at.session, at.org)
    .then((teams) => {
      if (context !== at) return;
      labels = new Map(teams.map((team) => [teamKey(team.name), orgTeamLabel(team)]));
      changed();
    })
    .catch(() => undefined);
}

/** How to name a team to a person: as it was typed when it was created, not as Door43 stores it. */
export function useTeamLabel(): (team: string) => string {
  useChanges();
  useEffect(() => ensureCoordinated());
  return (team) => labels.get(teamKey(team)) ?? displayOrgTeamName(team);
}

/** Whether the signed-in person may correct, remove and add rules of a team: they coordinate it or run the project. */
export function useManagesTeamRules(team: string | undefined): boolean {
  useChanges();
  useEffect(() => ensureCoordinated());
  if (!team || !context) return false;
  return Boolean(context.session.canManage) || (coordinated ?? []).includes(teamKey(team));
}

function useChanges(): void {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
}

/** The rules of one team; null while they are being read (or when there is no team). */
export function useTeamRules(team: string | undefined): TeamRulesDoc | null {
  useChanges();
  useEffect(() => {
    if (team) ensure(team);
  });
  return team ? (docs.get(teamKey(team)) ?? null) : null;
}

/** What waits for the signed-in person as a coordinator: the rules of their teams nobody who coordinates has seen. */
export function usePendingTeamRules(): PendingTeamRule[] {
  useChanges();
  useEffect(() => {
    ensureCoordinated();
    for (const team of coordinated ?? []) ensure(team);
  });
  return (coordinated ?? []).flatMap((team) => {
    const doc = docs.get(teamKey(team));
    return doc ? pendingRules(doc).map((rule) => ({ team, rule })) : [];
  });
}

/**
 * Add a rule to a team. `issue` is the subtarea where the person found it: the coordinators are told there is a
 * new rule, with the app closed too, pointing at that subtarea.
 */
export async function addRuleToTeam(team: string, text: string, issue?: number, when?: string[]): Promise<void> {
  if (!context) return;
  const { session, org } = context;
  const { doc, toTell } = await addTeamRule(session, org, teamKey(team), text, getUiLanguage(), when);
  docs.set(teamKey(team), doc);
  changed();
  if (issue && toTell.length) askNotices(session, { org, repo: PM_REPO_NAME }, [{ kind: "team-rule", issue, to: toTell }]);
}

export async function answerTeamRule(team: string, id: string, answer: RuleAnswer): Promise<void> {
  if (!context) return;
  const doc = await reviewTeamRule(context.session, context.org, teamKey(team), id, answer.keep ? { ...answer, lang: answer.lang ?? getUiLanguage() } : answer);
  docs.set(teamKey(team), doc);
  changed();
}
