/**
 * Person levels for a function (from the FCR qualification rubric):
 * oyente observes, aprendiz works with a person beside them, practicante works
 * alone and is reviewed, persona habilitada carries the function and counts
 * for the minimums. The level lives in the org config, next to the teams.
 */
export type PersonLevel = "oyente" | "aprendiz" | "practicante" | "habilitada";

export const LEVEL_ORDER: PersonLevel[] = ["oyente", "aprendiz", "practicante", "habilitada"];

export const LEVEL_LABEL: Record<PersonLevel, string> = {
  oyente: "Oyente",
  aprendiz: "Aprendiz",
  practicante: "Practicante",
  habilitada: "Persona habilitada",
};

const LEVEL_LABEL_PT: Record<PersonLevel, string> = {
  oyente: "Ouvinte",
  aprendiz: "Aprendiz",
  practicante: "Praticante",
  habilitada: "Pessoa habilitada",
};

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
