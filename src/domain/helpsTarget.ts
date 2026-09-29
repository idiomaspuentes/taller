import type { PmConfig } from "./roles";
import { DEFAULT_PM_CONFIG, resolveResourceRepo } from "./roles";
import type { SolverLaunchContext } from "./solverLaunch";

export type HelpsResource = "notas" | "preguntas" | "academia" | "palabras";

export type HelpsTarget = {
  owner: string;
  repo: string;
  resource: HelpsResource;
  kind: "tsv" | "markdown";
  /** TSV book file (`tn_TIT.tsv`); omitted for TW/TA articles. */
  filepath?: string;
  book: string;
};

const HELPS_RESOURCES: HelpsResource[] = [
  "notas",
  "preguntas",
  "academia",
  "palabras",
];

export function isHelpsResource(value: string): value is HelpsResource {
  return (HELPS_RESOURCES as string[]).includes(value);
}

export function helpsTsvFilename(
  resource: "notas" | "preguntas",
  book: string,
): string {
  const code = book.trim().toUpperCase();
  return resource === "notas" ? `tn_${code}.tsv` : `tq_${code}.tsv`;
}

export function resolveHelpsTarget(
  ctx: SolverLaunchContext,
  pmConfig: PmConfig = DEFAULT_PM_CONFIG,
): HelpsTarget | { error: string } {
  const book = (ctx.book || ctx.projectId || "").toUpperCase();
  if (!book) return { error: "Falta el código de libro en el contexto." };
  const resource = (ctx.resource || "").toLowerCase();
  if (!isHelpsResource(resource)) {
    return {
      error: `«${resource || "—"}» no es una ayuda (notas, preguntas, palabras o academia).`,
    };
  }
  const owner = (ctx.contentOrg || "").trim();
  if (!owner) return { error: "Falta contentOrg en el contexto." };
  const repo = resolveResourceRepo(resource, ctx.lang, pmConfig);
  if (!repo) {
    return {
      error: `No hay repo configurado para «${resource}». Añade resourceRepos.${resource} en config.json.`,
    };
  }
  const kind = resource === "notas" || resource === "preguntas" ? "tsv" : "markdown";
  return {
    owner,
    repo,
    resource,
    kind,
    filepath:
      resource === "notas" || resource === "preguntas"
        ? helpsTsvFilename(resource, book)
        : undefined,
    book,
  };
}

export function helpsMarkdownPath(
  resource: "academia" | "palabras",
  article: { id?: string; path?: string },
): string {
  let path = (article.path || article.id || "").trim().replace(/^\/+|\/+$/g, "");
  if (path.toLowerCase().endsWith(".md")) path = path.slice(0, -3);
  if (!path) return "";
  if (resource === "academia") {
    if (/(^|\/)(01|title|sub-title|subtitle)$/i.test(path)) return `${path}.md`;
    return `${path}/01.md`;
  }
  return `${path}.md`;
}
