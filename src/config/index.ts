import { tallerConfig } from "../../taller.config";
import type { TallerConfig, Workspace } from "./types";

export { tallerConfig };
export type { TallerConfig, UiLanguage, Workspace } from "./types";

/** Problems in a config, in plain words; empty when it is usable. Checked by tests and at startup. */
export function configProblems(config: TallerConfig): string[] {
  const problems: string[] = [];
  if (config.uiLanguages.length === 0) problems.push("uiLanguages está vacío.");
  if (!config.uiLanguages.includes(config.defaultUiLanguage)) problems.push("defaultUiLanguage no está en uiLanguages.");
  if (config.workspaces.length === 0) problems.push("Hace falta al menos un espacio de trabajo en workspaces.");
  const ids = new Set<string>();
  const pms = new Set<string>();
  for (const w of config.workspaces) {
    if (!w.id.trim()) problems.push("Un espacio no tiene id.");
    if (ids.has(w.id)) problems.push(`El id de espacio "${w.id}" está repetido.`);
    ids.add(w.id);
    if (!w.lang.trim() || !w.contentOrg.trim() || !w.pmOrg.trim()) problems.push(`El espacio "${w.id}" necesita lang, contentOrg y pmOrg.`);
    // Two spaces on one pmOrg would share their tasks: that is exactly what must not happen.
    if (pms.has(w.pmOrg.toLowerCase())) problems.push(`El espacio "${w.id}" repite la organización ${w.pmOrg}: los espacios no deben compartirla.`);
    pms.add(w.pmOrg.toLowerCase());
    if (!config.uiLanguages.includes(w.uiLanguage)) problems.push(`El espacio "${w.id}" usa un idioma de interfaz que no está en uiLanguages.`);
    for (const lang of config.uiLanguages) if (!w.name[lang]?.trim()) problems.push(`El espacio "${w.id}" no tiene nombre en "${lang}".`);
  }
  for (const lang of config.uiLanguages) {
    const copy = config.welcome[lang];
    if (!copy) problems.push(`Falta el texto de bienvenida en "${lang}".`);
    else if (![copy.title, copy.subtitle, copy.workspacePrompt, copy.enter, copy.trust, ...copy.points].every((t) => t.trim())) problems.push(`El texto de bienvenida en "${lang}" tiene campos vacíos.`);
    if (!config.brand.name[lang]?.trim()) problems.push(`Falta el nombre de la marca en "${lang}".`);
  }
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
