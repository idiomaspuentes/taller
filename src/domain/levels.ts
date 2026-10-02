import glossary from "../i18n/locales/glossary.pt.json";
/**
 * Person levels for a function (from the FCR qualification rubric):
 * oyente (shown as «Observador», the name the FCR guide uses; the stored id stays) observes, aprendiz works with a person beside them, practicante works
 * alone and is reviewed, persona habilitada carries the function and counts
 * for the minimums. The level lives in the org config, next to the teams.
 */
export type PersonLevel = "oyente" | "aprendiz" | "practicante" | "habilitada";

export const LEVEL_ORDER: PersonLevel[] = ["oyente", "aprendiz", "practicante", "habilitada"];

export const LEVEL_LABEL: Record<PersonLevel, string> = {
  oyente: "Observador",
  aprendiz: "Aprendiz",
  practicante: "Practicante",
  habilitada: "Persona habilitada",
};

const LEVEL_LABEL_PT: Record<PersonLevel, string> = glossary.levelNames as Record<PersonLevel, string>;

/** Level name for the screen, in the interface language. */
export function levelLabel(level: PersonLevel, language: "es" | "pt"): string {
  return (language === "pt" ? LEVEL_LABEL_PT : LEVEL_LABEL)[level];
}

export function isLevel(value: unknown): value is PersonLevel {
  return typeof value === "string" && (LEVEL_ORDER as string[]).includes(value);
}

/** `{ login: level }`, logins lowercased; anything malformed is dropped. */
export function normalizeLevels(raw: unknown): Record<string, PersonLevel> {
  const out: Record<string, PersonLevel> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [login, level] of Object.entries(raw as Record<string, unknown>)) {
    const key = login.trim().toLowerCase();
    if (key && isLevel(level)) out[key] = level;
  }
  return out;
}

export function levelOf(levels: Record<string, PersonLevel> | undefined, login: string): PersonLevel | undefined {
  return levels?.[login.trim().toLowerCase()];
}

/**
 * Levels are per team: each team has its own ladder, and being enabled in one says nothing about another. A person
 * who joins a team starts with no level there, or with the one its coordinator gives them.
 *
 * - `teamLevels[team][login]`: the level of a person in that team.
 * - `levels[login]`: the general level, from before levels were per team. It applies only in a team that has not
 *   recorded any level of its own yet, so nothing changes for an organization until a team starts using its own.
 * - `coordinators[team]`: who confirms a final decision and sets levels in that team.
 */
export type LevelBook = {
  levels: Record<string, PersonLevel>;
  teamLevels?: Record<string, Record<string, PersonLevel>>;
  coordinators?: Record<string, string[]>;
};

/** A level already resolved, or the book to look it up in. */
export type LevelSource = PersonLevel | LevelBook | undefined;

/** Teams are matched by name, without regard to case or outer spaces. */
export function teamKey(teamName: string | undefined | null): string {
  return String(teamName ?? "").trim().toLowerCase();
}

function isBook(source: unknown): source is LevelBook {
  return Boolean(source) && typeof source === "object" && typeof (source as LevelBook).levels === "object";
}

/** `{ login: level }` for the people of one team. */
export function levelsForTeam(source: LevelBook | Record<string, PersonLevel> | undefined, teamName: string | undefined): Record<string, PersonLevel> {
  if (!source) return {};
  if (!isBook(source)) return source;
  const own = source.teamLevels?.[teamKey(teamName)];
  return own && Object.keys(own).length ? own : source.levels;
}

/** The level of `login` for work of `teamName`. */
export function resolveLevel(source: LevelSource, teamName: string | undefined, login: string): PersonLevel | undefined {
  if (!source) return undefined;
  if (typeof source === "string") return source;
  return levelOf(levelsForTeam(source, teamName), login);
}

/**
 * Can `login` take work of `teamName` that asks for `min`?
 * Like `meetsLevel`, except in a team that keeps its own levels: there a person with no level has not started on
 * that ladder yet, so they can take only work that asks for no level.
 */
export function meetsTeamLevel(source: LevelSource | Record<string, PersonLevel>, teamName: string | undefined, login: string, min: PersonLevel | undefined): boolean {
  if (!source || typeof source === "string") return meetsLevel(source as PersonLevel | undefined, min);
  const level = levelOf(levelsForTeam(source, teamName), login);
  const ownLadder = isBook(source) && Object.keys(source.teamLevels?.[teamKey(teamName)] ?? {}).length > 0;
  if (!level && ownLadder) return !min;
  return meetsLevel(level, min);
}

export function coordinatorsOf(book: Pick<LevelBook, "coordinators"> | undefined, teamName: string | undefined): string[] {
  return book?.coordinators?.[teamKey(teamName)] ?? [];
}

export function isCoordinatorOf(book: Pick<LevelBook, "coordinators"> | undefined, teamName: string | undefined, login: string): boolean {
  const me = login.trim().toLowerCase();
  return Boolean(me) && coordinatorsOf(book, teamName).includes(me);
}

/** Team keys this person coordinates. */
export function coordinatedTeams(book: Pick<LevelBook, "coordinators"> | undefined, login: string): string[] {
  const me = login.trim().toLowerCase();
  return Object.entries(book?.coordinators ?? {}).filter(([, logins]) => logins.includes(me)).map(([team]) => team);
}

/**
 * Who confirms the final decision of a team: its coordinators, or a persona habilitada of that team.
 */
export function canConfirmForTeam(book: LevelBook | undefined, teamName: string | undefined, login: string): boolean {
  return isCoordinatorOf(book, teamName, login) || resolveLevel(book, teamName, login) === "habilitada";
}

export function normalizeTeamLevels(raw: unknown): Record<string, Record<string, PersonLevel>> {
  const out: Record<string, Record<string, PersonLevel>> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [team, levels] of Object.entries(raw as Record<string, unknown>)) {
    const key = teamKey(team);
    const clean = normalizeLevels(levels);
    if (key && Object.keys(clean).length) out[key] = clean;
  }
  return out;
}

export function normalizeCoordinators(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [team, logins] of Object.entries(raw as Record<string, unknown>)) {
    const key = teamKey(team);
    const clean = Array.isArray(logins) ? [...new Set(logins.map((login) => String(login).trim().toLowerCase()).filter(Boolean))] : [];
    if (key && clean.length) out[key] = clean;
  }
  return out;
}

/** The book with one person's level in one team set (or removed, with `""`). */
export function withTeamLevel<T extends LevelBook>(book: T, teamName: string, login: string, level: PersonLevel | ""): T & { teamLevels: Record<string, Record<string, PersonLevel>> } {
  const team = teamKey(teamName);
  const person = login.trim().toLowerCase();
  // A team's first own level starts from the general ones, so nobody in it loses a level by that edit.
  const current = book.teamLevels?.[team] ?? {};
  const next = { ...(Object.keys(current).length ? current : book.levels) };
  if (level) next[person] = level;
  else delete next[person];
  const teamLevels = { ...(book.teamLevels ?? {}), [team]: next };
  if (!Object.keys(next).length) delete teamLevels[team];
  return { ...book, teamLevels };
}

/** The book with a person added to or removed from a team's coordinators. */
export function withCoordinator<T extends LevelBook>(book: T, teamName: string, login: string, on: boolean): T & { coordinators: Record<string, string[]> } {
  const team = teamKey(teamName);
  const person = login.trim().toLowerCase();
  const rest = coordinatorsOf(book, team).filter((other) => other !== person);
  const coordinators = { ...(book.coordinators ?? {}), [team]: on ? [...rest, person] : rest };
  if (!coordinators[team]!.length) delete coordinators[team];
  return { ...book, coordinators };
}

/**
 * Can this person take work that asks for `min`?
 * - No recorded level: not filtered (levels are opt-in; nothing breaks before they are set).
 * - Oyente: never receives work.
 * - Otherwise the level must reach the minimum; no minimum means anyone above oyente.
 */
export function meetsLevel(level: PersonLevel | undefined, min: PersonLevel | undefined): boolean {
  if (!level) return true;
  if (level === "oyente") return false;
  if (!min) return true;
  return LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf(min);
}

/** Only personas habilitadas count toward a team's minimum of people. */
export function countsForMinimum(level: PersonLevel | undefined): boolean {
  return level === "habilitada";
}

export function levelRequirementText(min: PersonLevel): string {
  return `Pide nivel ${LEVEL_LABEL[min].toLowerCase()}`;
}
