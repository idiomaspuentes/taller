import { tallerConfig } from "../../taller.config";
import type { ProjectTask, ScopeKey } from "./types";
import { SCOPE_KEYS } from "./types";
import { parsePmFacetValue } from "./roles";
import { parseWorkOrderMarker } from "./workOrder";

export const SOLVERS_SCHEMA = "gateway-solvers-1";

/** In-app hash route vs absolute external site. */
export type SolverKind = "app" | "url";

/** Both open a new browsing context; `external` is a third-party site. */
export type SolverOpenMode = "tab" | "external";

/** `{lang}` of an outside tool that does not say which one it reads in. */
export const URL_TOOL_DEFAULT_LANG = "en";

/** A tool a step can open: a screen of this app, or an outside site. Which tools exist is the process's choice. */
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
  /** Overrides `{lang}` for `kind: "url"` templates. Default: {@link URL_TOOL_DEFAULT_LANG}. */
  lang?: string;
  /** The tool works on a real subtarea (its pull request, its thread): it cannot be tried in the lab without one. */
  needsIssue?: boolean;
  /**
   * Fragments of older launch URLs of this tool. An organization's saved copy whose URL contains one is brought up
   * to the shipped URL (see `upgradeShippedTools`).
   */
  supersedes?: string[];
  /**
   * Extra URL parameters when the tool is opened for a given step: `{ "review-step-id": { "mode": "revisar" } }`.
   * It lets one screen serve two steps of a process without the screen knowing the process.
   */
  stepParams?: Record<string, Record<string, string>>;
  /**
   * What a person goes through one by one in this tool, so the load of a step can be read before anybody works
   * (see `processLoad`). Without it a step is as big as its subtarea.
   */
  walks?: ToolWalk;
  /**
   * The tool works on a unit as it is staged for validation: when a subtarea of a task that opens it can start, the
   * app puts these resources of its unit on the validation branch. `aligned`: the texts that must be aligned first.
   */
  stagesUnit?: { resources: string[]; aligned?: string[] };
};

export type WalkUnit = "verses" | "notes" | "questions" | "items";
export const WALK_UNITS: WalkUnit[] = ["verses", "notes", "questions", "items"];

export type ToolWalk = {
  /** What is counted in the book: the verses of the passage, its notes, its questions, or the items of the subtarea. */
  unit: WalkUnit;
  /** How many things there are for each one counted, when the book does not say it (key terms per verse). */
  times?: number;
  /** The count is a ceiling or an estimate. */
  approx?: boolean;
  /** What the tool calls them, when it is not the unit («términos»). */
  label?: string;
  labels?: Partial<Record<string, string>>;
};

export type SolversCatalog = {
  schema: typeof SOLVERS_SCHEMA;
  solvers: SolverApp[];
};

export const EMPTY_SOLVERS_CATALOG: SolversCatalog = {
  schema: SOLVERS_SCHEMA,
  solvers: [],
};

/** The engine's only own tool: it shows the launch payload, to try a step that has no tool yet. */
export const DEMO_SOLVER_ID = "solver-demo";
const DEMO_TOOL = {
  id: DEMO_SOLVER_ID,
  name: "Demostración genérica",
  description: "Cualquier recurso — muestra el payload de lanzamiento.",
  launchUrl: "/solver-stub.html#ctx={context}",
  kind: "app",
  openMode: "tab",
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

/** Queue action: «Estudiar» for an outside site (reading), «Abrir editor» for a tool of the app. */
export function solverActionLabel(app: SolverApp): string {
  return isUrlSolver(app) ? "Estudiar" : "Abrir editor";
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
    const stepParams: Record<string, Record<string, string>> = {};
    if (rowApp.stepParams && typeof rowApp.stepParams === "object") {
      for (const [stepId, params] of Object.entries(rowApp.stepParams)) {
        if (!params || typeof params !== "object") continue;
        const clean = Object.fromEntries(Object.entries(params).filter(([key, value]) => /^\w+$/.test(key) && typeof value === "string" && value));
        if (Object.keys(clean).length) stepParams[stepId] = clean as Record<string, string>;
      }
    }
    const rawWalk = rowApp.walks && typeof rowApp.walks === "object" ? rowApp.walks : undefined;
    const walks: ToolWalk | undefined =
      rawWalk && WALK_UNITS.includes(rawWalk.unit)
        ? {
            unit: rawWalk.unit,
            ...(Number(rawWalk.times) > 0 ? { times: Number(rawWalk.times) } : {}),
            ...(rawWalk.approx === true ? { approx: true } : {}),
            ...(String(rawWalk.label ?? "").trim() ? { label: String(rawWalk.label).trim() } : {}),
            ...(rawWalk.labels && typeof rawWalk.labels === "object" ? { labels: rawWalk.labels } : {}),
          }
        : undefined;
    const rawStage = rowApp.stagesUnit && typeof rowApp.stagesUnit === "object" ? rowApp.stagesUnit : undefined;
    const words = (raw: unknown) => (Array.isArray(raw) ? raw.map(String).map((x) => x.trim()).filter(Boolean) : []);
    const stagesUnit = rawStage && words(rawStage.resources).length ? { resources: words(rawStage.resources), ...(words(rawStage.aligned).length ? { aligned: words(rawStage.aligned) } : {}) } : undefined;
    const supersedes = Array.isArray(rowApp.supersedes) ? rowApp.supersedes.map(String).map((x) => x.trim()).filter(Boolean) : [];
    solvers.push({
      id,
      name,
      description: String(app.description ?? "").trim() || undefined,
      launchUrl,
      resources: resources?.length ? resources : undefined,
      kind,
      openMode: inferOpenMode(kind, rowApp.open ?? rowApp.openMode),
      lang,
      ...(rowApp.needsIssue === true ? { needsIssue: true } : {}),
      ...(supersedes.length ? { supersedes } : {}),
      ...(Object.keys(stepParams).length ? { stepParams } : {}),
      ...(walks ? { walks } : {}),
      ...(stagesUnit ? { stagesUnit } : {}),
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
  return findSolverApp(catalog, DEMO_SOLVER_ID) ?? catalog.solvers[0];
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

/**
 * The tools shipped with the app: those of the processes in `taller.config.ts`, plus the demo. Used when the
 * organization has not saved a catalog of its own (`solvers.json`).
 */
export const DEFAULT_SOLVERS_CATALOG: SolversCatalog = normalizeSolversCatalog({
  solvers: [...tallerConfig.processes.flatMap((process) => process.tools ?? []), DEMO_TOOL],
});

/**
 * An organization's saved catalog, brought up to date with the shipped tools, without touching what the organization
 * changed: a saved tool whose URL is one the shipped tool `supersedes` takes the shipped launch fields.
 */
export function upgradeShippedTools(catalog: SolversCatalog, shipped: SolversCatalog = DEFAULT_SOLVERS_CATALOG): SolversCatalog {
  const byId = new Map(shipped.solvers.map((tool) => [tool.id, tool]));
  let changed = false;
  const solvers = catalog.solvers.map((app) => {
    const def = byId.get(app.id);
    if (!def) return app;
    let next = app;
    if (def.supersedes?.some((old) => app.launchUrl.includes(old))) {
      next = { ...next, launchUrl: def.launchUrl, kind: def.kind, openMode: def.openMode, lang: def.lang ?? app.lang, description: def.description ?? app.description };
    }
    // Catalogs saved before a field existed take it from the shipped tool: a step the saved tool lacks, or a
    // parameter a saved step lacks. What the organization set itself is kept.
    const shippedParams = def.stepParams ?? {};
    const lacks = Object.keys(shippedParams).some(
      (stepId) => !app.stepParams?.[stepId] || Object.keys(shippedParams[stepId]!).some((key) => !(key in app.stepParams![stepId]!)),
    );
    if (lacks) {
      const merged = { ...shippedParams, ...app.stepParams };
      for (const stepId of Object.keys(shippedParams)) merged[stepId] = { ...shippedParams[stepId], ...app.stepParams?.[stepId] };
      next = { ...next, stepParams: merged };
    }
    if (def.needsIssue && app.needsIssue === undefined) next = { ...next, needsIssue: true };
    if (next === app) return app;
    changed = true;
    return next;
  });
  return changed ? { ...catalog, solvers } : catalog;
}

/** The catalog plus every shipped tool it lacks, in memory only: reading a catalog never writes it. */
export function withShippedTools(catalog: SolversCatalog, shipped: SolversCatalog = DEFAULT_SOLVERS_CATALOG): SolversCatalog {
  const have = new Set(catalog.solvers.map((tool) => tool.id));
  const extra = shipped.solvers.filter((tool) => !have.has(tool.id));
  return extra.length ? { ...catalog, solvers: [...catalog.solvers, ...extra] } : catalog;
}
