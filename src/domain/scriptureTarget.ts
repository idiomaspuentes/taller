import type { ScopeKey } from "./types";
import type { PmConfig } from "./roles";
import { DEFAULT_PM_CONFIG, resolveResourceRepo } from "./roles";
import { bookUsfmName } from "../prep/discover";
import type { SolverLaunchContext } from "./solverLaunch";

export type ScriptureTarget = {
  owner: string;
  repo: string;
  filepath: string;
  resource: ScopeKey | string;
  book: string;
};

/** Default Door43-style names when config.json has no resourceRepos. */
export function defaultScriptureRepo(resource: string, lang: string): string | undefined {
  const base = lang.trim().toLowerCase().replace(/_gl$/, "") || "es-419";
  if (resource === "tpl") return `${base}_glt`;
  if (resource === "tps") return `${base}_gst`;
  return undefined;
}

export function resolveScriptureTarget(
  ctx: SolverLaunchContext,
  pmConfig: PmConfig = DEFAULT_PM_CONFIG,
): ScriptureTarget | { error: string } {
  const book = (ctx.book || ctx.projectId || "").toUpperCase();
  if (!book) return { error: "Falta el código de libro en el contexto." };
  const resource = (ctx.resource || "tpl").toLowerCase();
  const owner = (ctx.contentOrg || "").trim();
  if (!owner) return { error: "Falta contentOrg en el contexto." };

  const fromConfig = resolveResourceRepo(resource as ScopeKey, ctx.lang, pmConfig);
  const repo = fromConfig || defaultScriptureRepo(resource, ctx.lang);
  if (!repo) {
    return {
      error: `No hay repo configurado para «${resource}». Añade resourceRepos.${resource} en config.json (p. ej. "{lang}_glt").`,
    };
  }
  return {
    owner,
    repo,
    filepath: bookUsfmName(book),
    resource,
    book,
  };
}
