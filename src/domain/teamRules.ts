import { scopeFolder } from "./scope";

/**
 * Rules a team gives itself as it works: things to check that somebody found while translating («cuando el inglés
 * dice "elder", aquí siempre es "anciano"»). They are the team's, not a project's: they show on every step that team
 * does and stay for its next book. Anybody of the team adds one and it counts at once; the team's coordinator finds
 * it among what waits for them, and keeps it, corrects it or removes it.
 */

export type TeamRule = {
  id: string;
  text: string;
  /** Who added it, and when. */
  by: string;
  at: string;
  /** The language it was written in; `texts` says it in the others, when somebody wrote it there. */
  lang?: string;
  texts?: Record<string, string>;
  /** The coordinator saw it and kept it. Until then it waits in their list (and counts all the same). */
  reviewedBy?: string;
  /** Removed: kept in the file so that it is known it was there. */
  removedBy?: string;
};

export type TeamRulesDoc = { schema: "taller-team-rules-1"; team: string; rules: TeamRule[] };

const slug = (team: string) => team.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");

/** Where a team's rules live in the plan repository of its workspace. */
export function teamRulesPath(team: string): string {
  return `${scopeFolder()}reglas/${slug(team)}.json`;
}

export function emptyTeamRules(team: string): TeamRulesDoc {
  return { schema: "taller-team-rules-1", team: slug(team), rules: [] };
}

export function normalizeTeamRules(raw: unknown, team: string): TeamRulesDoc {
  const rows = raw && typeof raw === "object" && Array.isArray((raw as { rules?: unknown }).rules) ? (raw as { rules: unknown[] }).rules : [];
  const rules: TeamRule[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Partial<TeamRule>;
    const id = String(r.id ?? "").trim();
    const text = String(r.text ?? "").trim();
    if (!id || !text || seen.has(id)) continue;
    seen.add(id);
    rules.push({
      id,
      text,
      by: String(r.by ?? "").trim(),
      at: String(r.at ?? ""),
      ...(r.lang ? { lang: String(r.lang) } : {}),
      ...(r.texts && typeof r.texts === "object" && Object.keys(r.texts).length ? { texts: Object.fromEntries(Object.entries(r.texts).filter(([, v]) => typeof v === "string" && v.trim())) as Record<string, string> } : {}),
      ...(r.reviewedBy ? { reviewedBy: String(r.reviewedBy) } : {}),
      ...(r.removedBy ? { removedBy: String(r.removedBy) } : {}),
    });
  }
  return { schema: "taller-team-rules-1", team: slug(team), rules };
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The rules in force: every one that was not removed, reviewed or not, in the order they were added. */
export function activeRules(doc: TeamRulesDoc): TeamRule[] {
  return doc.rules.filter((rule) => !rule.removedBy);
}

/** What waits for the coordinator: rules in force nobody who coordinates has looked at. */
export function pendingRules(doc: TeamRulesDoc): TeamRule[] {
  return activeRules(doc).filter((rule) => !rule.reviewedBy);
}

/**
 * Add a rule. One a coordinator adds needs nobody's review. The same sentence is not added twice.
 */
export function addRule(doc: TeamRulesDoc, params: { id: string; text: string; by: string; at: string; coordinator: boolean; lang?: string }): TeamRulesDoc {
  const text = clean(params.text);
  if (!text || activeRules(doc).some((rule) => same(rule.text, text))) return doc;
  return { ...doc, rules: [...doc.rules, { id: params.id, text, by: params.by, at: params.at, ...(params.lang ? { lang: params.lang } : {}), ...(params.coordinator ? { reviewedBy: params.by } : {}) }] };
}

const clean = (text: string) => text.trim().replace(/\s+/g, " ").slice(0, 240);

/** A rule as somebody reads it: in their language when it was written or said in it, else as it was written. */
export function ruleText(rule: TeamRule, language: string): string {
  return rule.texts?.[language] ?? rule.text;
}

export type RuleAnswer = { keep: true; text?: string; lang?: string } | { keep: false };

/**
 * The coordinator's answer to a rule, at any time (new or long kept): keep it, as it is or reworded, or remove it.
 * A rewording in the language it was written in corrects it; in another language it says it in that one too, and
 * the original stays.
 */
export function reviewRule(doc: TeamRulesDoc, id: string, by: string, answer: RuleAnswer): TeamRulesDoc {
  return {
    ...doc,
    rules: doc.rules.map((rule) => {
      if (rule.id !== id) return rule;
      if (!answer.keep) return { ...rule, removedBy: by };
      const text = answer.text === undefined ? "" : clean(answer.text);
      if (!text) return { ...rule, reviewedBy: by };
      const other = answer.lang && rule.lang && answer.lang !== rule.lang;
      return other ? { ...rule, texts: { ...rule.texts, [answer.lang!]: text }, reviewedBy: by } : { ...rule, text, reviewedBy: by };
    }),
  };
}
