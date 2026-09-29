import type { ProjectTask, ScopeKey } from "./types";
import { SCOPE_KEYS } from "./types";
import { parsePmFacetValue } from "./roles";
import { parseWorkOrderMarker } from "./workOrder";

export const SOLVERS_SCHEMA = "gateway-solvers-1";

export const FAMILIARIZE_SOLVER_ID = "fcr-familiarize";

/** In-app hash route vs absolute external site. */
export type SolverKind = "app" | "url";

/** Both open a new browsing context; `external` is a third-party site. */
export type SolverOpenMode = "tab" | "external";

/**
 * TranslationCore Study chapter reader.
 * Path shape is fixed; only `{lang}`, `{book}`, `{chapter}` vary.
 * `{lang}` defaults to English source — workspace GL codes (es-419) are not a study-site field.
 */
export const TC_STUDY = {
  origin: "https://study.translationcore.com",
  defaultLang: "en",
} as const;

/** `tit 2` → `…/chapter/tit%202` after placeholder substitution + encode. */
export const TC_STUDY_LAUNCH_URL =
  `${TC_STUDY.origin}/read/{lang}/bible/chapter/{book}%20{chapter}` as const;

/** Registered mini-app that can resolve a ProjectTask’s subtareas. */
export type SolverApp = {
  id: string;
  name: string;
  description?: string;
  /**
   * URL template. Absolute `https://…` or same-origin path `/solver-stub.html#ctx={context}`.
   * Placeholders: `{context}` (base64url JSON), plus flat `{lang}`, `{book}`, `{chapter}`, `{ref}`, …
   */
  launchUrl: string;
  /** When set, only show this app for tasks whose rules touch these resources. */
  resources?: ScopeKey[];
  /** Defaults from the URL: `https://…` → `url`, same-origin `/…` → `app`. */
  kind: SolverKind;
  openMode: SolverOpenMode;
  /** Overrides `{lang}` for `kind: "url"` templates. Default: {@link TC_STUDY.defaultLang}. */
  lang?: string;
};

export type SolversCatalog = {
  schema: typeof SOLVERS_SCHEMA;
  solvers: SolverApp[];
};

export const EMPTY_SOLVERS_CATALOG: SolversCatalog = {
  schema: SOLVERS_SCHEMA,
  solvers: [],
};

/**
 * Shipped defaults used when `{pmOrg}/gateway-tasks/solvers.json` is missing.
 * Familiarize is `kind: "url"` (TranslationCore Study). TPL/TPS and helps stay in-app.
 */
export const DEFAULT_SOLVERS_CATALOG: SolversCatalog = {
  schema: SOLVERS_SCHEMA,
  solvers: [
    {
      id: FAMILIARIZE_SOLVER_ID,
      name: "Familiarizar",
      description: "Lee el capítulo en TranslationCore Study. Solo lectura.",
      kind: "url",
      launchUrl: TC_STUDY_LAUNCH_URL,
      lang: TC_STUDY.defaultLang,
      openMode: "external",
    },
    {
      id: "tpl-translate",
      name: "Borrador TPL",
      description: "Editor USFM con un borrador por subtarea → repo GLT.",
      launchUrl: "/#/solver/scripture?ctx={context}",
      resources: ["tpl"],
      kind: "app",
      openMode: "tab",
    },
    {
      id: "tps-translate",
      name: "Borrador TPS",
      description: "Editor USFM con un borrador por subtarea → repo GST.",
      launchUrl: "/#/solver/scripture?ctx={context}",
      resources: ["tps"],
      kind: "app",
      openMode: "tab",
    },
    {
      id: "fcr-pair-review",
      name: "Revisión en pares",
      description: "Cambios del borrador de esta subtarea. Aprobar en Mis tareas.",
      launchUrl: "/#/solver/review?mode=pair&ctx={context}",
      kind: "app",
      openMode: "tab",
    },
    {
      id: "fcr-group-review",
      name: "Revisión grupal",
      description: "Mismos cambios; cupo de reseñas. Aprobar en Mis tareas.",
      launchUrl: "/#/solver/review?mode=group&ctx={context}",
      kind: "app",
      openMode: "tab",
    },
    {
      id: "helps-review",
      name: "Ayudas (TN / TQ / TW / TA)",
      description: "Borrador de ayudas, uno por subtarea.",
      launchUrl: "/#/solver/helps?ctx={context}",
      resources: ["notas", "preguntas", "palabras", "academia"],
      kind: "app",
      openMode: "tab",
    },
    {
      id: "solver-demo",
      name: "Demostración genérica",
      description: "Cualquier recurso — muestra el payload de lanzamiento.",
      launchUrl: "/solver-stub.html#ctx={context}",
      kind: "app",
      openMode: "tab",
    },
  ],
};

function isScopeKey(value: string): value is ScopeKey {
  return (SCOPE_KEYS as string[]).includes(value);
}

function isAllowedLaunchUrl(url: string): boolean {
  if (/^https?:\/\//i.test(url)) return true;
  // Same-origin stub / app path.
  if (url.startsWith("/")) return true;
  return false;
}

function inferSolverKind(url: string, explicit?: string): SolverKind {
  if (explicit === "url" || explicit === "app") return explicit;
  return /^https?:\/\//i.test(url) ? "url" : "app";
}

function inferOpenMode(kind: SolverKind, explicit?: string): SolverOpenMode {
  if (explicit === "external" || explicit === "tab") return explicit;
  return kind === "url" ? "external" : "tab";
}

export function isUrlSolver(app: SolverApp): boolean {
  return app.kind === "url" || app.openMode === "external";
}

export function isFamiliarizeSolver(app: SolverApp): boolean {
  return app.id === FAMILIARIZE_SOLVER_ID;
}

/** Queue action: Estudiar for familiarize, Resolver for in-app tools. */
export function solverActionLabel(app: SolverApp): string {
  return isFamiliarizeSolver(app) ? "Estudiar" : "Resolver";
}

export function normalizeSolversCatalog(raw: unknown): SolversCatalog {
  const row = raw && typeof raw === "object" ? (raw as { solvers?: unknown }) : {};
  const list = Array.isArray(row.solvers) ? row.solvers : [];
  const solvers: SolverApp[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const app = item as Partial<SolverApp>;
    const id = String(app.id ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    const name = String(app.name ?? "").trim();
    const launchUrl = String(app.launchUrl ?? "").trim();
    if (!id || !name || !launchUrl || seen.has(id)) continue;
    if (!isAllowedLaunchUrl(launchUrl)) continue;
    seen.add(id);
    const resources = Array.isArray(app.resources)
      ? app.resources.map(String).filter(isScopeKey)
      : undefined;
    const rowApp = item as Partial<SolverApp> & { open?: string };
    const kind = inferSolverKind(launchUrl, rowApp.kind);
    const lang = String(rowApp.lang ?? "").trim() || undefined;
    solvers.push({
      id,
      name,
      description: String(app.description ?? "").trim() || undefined,
      launchUrl,
      resources: resources?.length ? resources : undefined,
      kind,
      openMode: inferOpenMode(kind, rowApp.open ?? rowApp.openMode),
      lang,
    });
  }
  return { schema: SOLVERS_SCHEMA, solvers };
}

export function findSolverApp(
  catalog: SolversCatalog,
  solverAppId: string | undefined | null,
): SolverApp | undefined {
  const id = String(solverAppId ?? "").trim();
  if (!id) return undefined;
  return catalog.solvers.find((s) => s.id === id);
}

export function isScriptureSolver(app: SolverApp): boolean {
  return app.launchUrl.includes("/solver/scripture");
}

/** Scripture editor of the catalog for a TPL / TPS resource. */
export function scriptureSolverFor(catalog: SolversCatalog, resource: string): SolverApp | undefined {
  const key = resource.trim().toLowerCase();
  const editors = catalog.solvers.filter(isScriptureSolver);
  return editors.find((app) => app.resources?.includes(key as ScopeKey)) ?? (key ? undefined : editors[0]);
}

/**
 * Prefer the task’s bound `solverAppId`; otherwise first catalog app that
 * matches the subtarea’s resource (e.g. TPL → Traducir TPL).
 */
export function resolveSolverForIssue(
  catalog: SolversCatalog,
  board: { teams: ProjectTask[] },
  issue: {
    labels?: { name: string }[] | null;
    body?: string;
  },
): SolverApp | undefined {
  if (!catalog.solvers.length) return undefined;
  const marker = parseWorkOrderMarker(issue.body);
  const taskId =
    (issue.labels ?? []).map((l) => parsePmFacetValue(l.name, "tarea")).find(Boolean) ||
    marker?.teamId ||
    "";
  const task = taskId ? board.teams.find((t) => t.id === taskId) : undefined;
  const bound = findSolverApp(catalog, task?.solverAppId);
  if (bound) return bound;

  const resource =
    marker?.resource ||
    (issue.labels ?? []).map((l) => parsePmFacetValue(l.name, "recurso")).find(Boolean) ||
    "";
  if (resource && resource !== "bundle" && isScopeKey(resource)) {
    const matched = solversForTaskResources(catalog, [resource]);
    const specific = matched.find((a) => a.resources?.includes(resource));
    if (specific) return specific;
    if (matched[0]) return matched[0];
  }
  return findSolverApp(catalog, "solver-demo") ?? catalog.solvers[0];
}

/** Apps eligible for a task given its resource scope. */
export function solversForTaskResources(
  catalog: SolversCatalog,
  taskResources: ScopeKey[],
): SolverApp[] {
  if (!taskResources.length) return catalog.solvers;
  const set = new Set(taskResources);
  return catalog.solvers.filter((app) => {
    if (!app.resources?.length) return true;
    return app.resources.some((r) => set.has(r));
  });
}
