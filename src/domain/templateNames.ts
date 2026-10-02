/**
 * The names of the shipped workflow template (phases, tasks, steps) are stored in the plan as written in Spanish, and
 * subtarea titles repeat them. To show them in another interface language we translate the exact factory names
 * when they are displayed; the stored data is never changed, and a name someone edited is left as they wrote it.
 */
import type { UiLanguage } from "../config";
import glossary from "../i18n/locales/glossary.pt.json";
import { processGlossary } from "./processes";

/**
 * Stored name → Portuguese. The names of a process come from its package (`processes/*.json`): the names its
 * templates declare and its glossary of older names. The app's own few («Sin fase») stay in the interface glossary.
 */
const PT: [string, string][] = [...Object.entries(glossary.templates), ...processGlossary("pt")];

// Longest first, so "Revisar la alineación" is not cut by "Alinear" and the like.
const ORDERED = [...PT].sort((a, b) => b[0].length - a[0].length);

export function localizeName(text: string, language: UiLanguage): string {
  if (language !== "pt" || !text) return text;
  let out = text;
  for (const [es, pt] of ORDERED) if (out.includes(es)) out = out.split(es).join(pt);
  return out;
}

const LEVELS_PT: Record<string, string> = glossary.levels;

/**
 * The reason a subtarea cannot start yet (built in Spanish by the domain): shown in the interface language.
 * Anything that does not match a known sentence is returned as it is.
 */
export function localizeHold(text: string, language: UiLanguage): string {
  if (language !== "pt" || !text) return text;
  const wait = /^Espera a «(.*?)»(?: de (@\S+))?(?: y (\d+) más)?$/.exec(text);
  if (wait) {
    const [, name, owner, more] = wait;
    return `Aguarda «${localizeName(name ?? "", language)}»${owner ? ` de ${owner}` : ""}${more ? ` e mais ${more}` : ""}`;
  }
  const level = /^Pide nivel (.+)$/.exec(text);
  if (level) return `Exige nível ${LEVELS_PT[level[1]!] ?? level[1]}`;
  if (text === "Solo observas") return "Você só observa";
  return localizeName(text, language);
}

/** «hoy» / «hace N días» as the domain writes them, in Portuguese. */
function daysPt(text: string): string {
  if (text === "hoy") return "hoje";
  if (text === "hace 1 día") return "há 1 dia";
  const m = /^hace (\d+) días$/.exec(text);
  return m ? `há ${m[1]} dias` : text;
}

/**
 * The reason a row of «Equipo hoy» is where it is (built in Spanish by `classifyToday`): shown in the interface
 * language. Anything that does not match a known sentence goes through `localizeHold`, which handles waits.
 */
export function localizeToday(text: string, language: UiLanguage): string {
  if (language !== "pt" || !text) return text;
  const days = "(hoy|hace \\d+ días?)";
  let m = new RegExp(`^Cerrada ${days}$`).exec(text);
  if (m) return `Fechada ${daysPt(m[1]!)}`;
  m = /^Se decide antes de (mañana|\d+ días)$/.exec(text);
  if (m) return `Decide-se antes de ${m[1] === "mañana" ? "amanhã" : m[1]!.replace(" días", " dias")}`;
  if (text === "El plazo vence hoy") return "O prazo vence hoje";
  m = new RegExp(`^El plazo venció ${days}: decide quien coordina$`).exec(text);
  if (m) return `O prazo venceu ${daysPt(m[1]!)}: decide quem coordena`;
  m = /^Nadie la ha tomado en (\d+) días$/.exec(text);
  if (m) return `Ninguém pegou há ${m[1]} dias`;
  if (text === "Libre para el equipo") return "Livre para a equipe";
  m = new RegExp(`^Sin movimiento ${days}$`).exec(text);
  if (m) return `Sem movimento ${daysPt(m[1]!)}`;
  m = new RegExp(`^Último movimiento ${days}$`).exec(text);
  if (m) return `Último movimento ${daysPt(m[1]!)}`;
  return localizeHold(text, language);
}
