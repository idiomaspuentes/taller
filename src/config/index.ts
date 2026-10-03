import { tallerConfig } from "../../taller.config";
import { SCOPE_PATTERN } from "../domain/scope";
import type { TallerConfig, Workspace } from "./types";

export { tallerConfig };
export type { LexiconRepo, TallerConfig, UiLanguage, Workspace } from "./types";

/** Problems in a config, in plain words; empty when it is usable. Checked by tests and at startup. */
export function configProblems(config: TallerConfig): string[] {
  const problems: string[] = [];
  if (config.uiLanguages.length === 0) problems.push("uiLanguages está vacío.");
  if (!config.uiLanguages.includes(config.defaultUiLanguage)) problems.push("defaultUiLanguage no está en uiLanguages.");
  if (!/^[A-Za-z0-9._-]+$/.test(config.pmRepo)) problems.push(`pmRepo "${config.pmRepo}" no es un nombre de repositorio válido (letras, números, punto, guion y guion bajo).`);
  if (config.workspaces.length === 0) problems.push("Hace falta al menos un espacio de trabajo en workspaces.");
  const ids = new Set<string>();
  for (const w of config.workspaces) {
    if (!w.id.trim()) problems.push("Un espacio no tiene id.");
    if (ids.has(w.id)) problems.push(`El id de espacio "${w.id}" está repetido.`);
    ids.add(w.id);
    if (!w.lang.trim() || !w.contentOrg.trim() || !w.pmOrg.trim()) problems.push(`El espacio "${w.id}" necesita lang, contentOrg y pmOrg.`);
    if (w.scope !== undefined && !SCOPE_PATTERN.test(w.scope)) problems.push(`El scope "${w.scope}" del espacio "${w.id}" solo puede tener minúsculas, números y guiones.`);
    if (!config.uiLanguages.includes(w.uiLanguage)) problems.push(`El espacio "${w.id}" usa un idioma de interfaz que no está en uiLanguages.`);
    for (const lang of config.uiLanguages) if (!w.name[lang]?.trim()) problems.push(`El espacio "${w.id}" no tiene nombre en "${lang}".`);
  }
  // Spaces may share an organization, but only if their scopes tell them apart: otherwise they would share tasks.
  const shared = new Map<string, Workspace[]>();
  for (const w of config.workspaces) {
    const key = `${w.pmOrg.toLowerCase()}`;
    shared.set(key, [...(shared.get(key) ?? []), w]);
  }
  for (const [org, spaces] of shared) {
    if (spaces.length < 2) continue;
    const unscoped = spaces.filter((w) => !w.scope);
    if (unscoped.length > 1) problems.push(`Los espacios ${unscoped.map((w) => `"${w.id}"`).join(", ")} comparten la organización ${org} sin scope: sus tareas se mezclarían. Dale un scope distinto a cada uno (como mucho uno puede no tenerlo).`);
    const scopes = spaces.map((w) => w.scope).filter(Boolean) as string[];
    if (new Set(scopes.map((s) => s.toLowerCase())).size !== scopes.length) problems.push(`Hay espacios en la organización ${org} con el mismo scope.`);
  }
  for (const lang of config.uiLanguages) {
    const copy = config.welcome[lang];
    if (!copy) problems.push(`Falta el texto de bienvenida en "${lang}".`);
    else if (![copy.title, copy.subtitle, copy.workspacePrompt, copy.enter, copy.trust, ...copy.points].every((t) => t.trim())) problems.push(`El texto de bienvenida en "${lang}" tiene campos vacíos.`);
    if (!config.brand.name[lang]?.trim()) problems.push(`Falta el nombre de la marca en "${lang}".`);
  }
  if (!config.brand.short.trim()) problems.push("Falta brand.short (el nombre corto de la organización, como «Id»).");
  return problems;
}

export function workspaceById(config: TallerConfig, id: string | null | undefined): Workspace | undefined {
  return config.workspaces.find((w) => w.id === id);
}

/** The workspace that owns a project-management organization, if any. */
export function workspaceOfOrg(config: TallerConfig, pmOrg: string): Workspace | undefined {
  return config.workspaces.find((w) => w.pmOrg.toLowerCase() === pmOrg.toLowerCase());
}

if (import.meta.env?.DEV) {
  const problems = configProblems(tallerConfig);
  if (problems.length) console.error(`taller.config.ts tiene problemas:\n- ${problems.join("\n- ")}`);
}
