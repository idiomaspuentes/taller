import { projectFromMilestone } from "./scope";
import type { DcsIssue } from "@ip-lms/dcs-client";
import { usfmStudyBookId } from "./books";
import { resolveTaskPhaseName, resolveTaskPhaseSlug } from "./phaseSlug";
import type { AssignmentsDoc, ScopeKey } from "./types";
import { parseWorkOrderMarker } from "./workOrder";
import { isUrlSolver, URL_TOOL_DEFAULT_LANG, type SolverApp } from "./solvers";
import { parsePmFacetValue } from "./roles";

export const SOLVER_LAUNCH_SCHEMA = "gateway-solver-launch-1";

export type SolverLaunchContext = {
  schema: typeof SOLVER_LAUNCH_SCHEMA;
  lang: string;
  pmOrg: string;
  contentOrg: string;
  projectId: string;
  taskId: string;
  taskName: string;
  book: string;
  chapter: number;
  resource: string;
  /** What the project's process calls that resource, when it gives it a name of its own. */
  resourceName?: string;
  /** Board phase that owns this task (UI grouping only; not used in new git refs). */
  phaseSlug: string;
  /** Display name of that phase (solver labels). */
  phaseName?: string;
  ref: string;
  portionIds: string[];
  itemIds: string[];
  workOrderKey: string;
  issueNumber: number;
  issueUrl: string;
  username: string;
  /** When opening a checklist-step resolver. */
  stepId?: string;
  stepName?: string;
  /** A place of the work to open the tool on (the name a comment is filed under: a verse, «figs-metaphor ¶5»). */
  focus?: string;
  /**
   * Sandbox launch from Laboratorio — no subtarea, issue, or work-order.
   * Editors must not bootstrap PRs or create book branches unless write is opted in.
   */
  lab?: boolean;
  /** Opt-in: allow DCS writes / book-branch create from the lab. */
  labAllowWrite?: boolean;
  /** User confirmed writing to a production-looking org (`es-419_gl`, `{lang}_gl`). */
  labUnsafeWrite?: boolean;
};

/** Prefer `pm/cap`, then title (`TIT 2:1` / `TIT 2`), then issue body `Capítulo: **2**`. */
export function chapterFromIssue(issue: {
  labels?: { name: string }[] | null;
  title?: string;
  body?: string;
}): number {
  for (const label of issue.labels ?? []) {
    const value = parsePmFacetValue(label.name, "cap");
    if (value) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  const title = issue.title ?? "";
  const fromVerseRef = title.match(/\b(\d{1,3}):\d/);
  if (fromVerseRef) return Number(fromVerseRef[1]);
  const fromBookChapter = title.match(/^[A-Z0-9]{3}\s+(\d{1,3})\b/i);
  if (fromBookChapter) return Number(fromBookChapter[1]);
  const fromBody = (issue.body ?? "").match(/Capítulo:\s*\*\*(\d{1,3})\*\*/i);
  if (fromBody) {
    const n = Number(fromBody[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

/** Leading USFM token in titles like `TIT 2:1–8 · TPL`. */
export function bookCodeFromIssueTitle(title: string): string {
  const match = title.match(/^([A-Z0-9]{3})\b/i);
  return match ? match[1].toUpperCase() : "";
}

/** `NEH 1:1–8 · TPL` → `1:1–8`. */
export function refFromIssueTitle(title: string): string {
  const stripped = title.replace(/^[A-Z0-9]{3}\s+/i, "").trim();
  const beforeDot = stripped.split("·")[0]?.trim() ?? stripped;
  return beforeDot || title;
}

function encodeBase64Url(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function encodeSolverLaunchContext(ctx: SolverLaunchContext): string {
  return encodeBase64Url(JSON.stringify(ctx));
}

export function decodeSolverLaunchContext(encoded: string): SolverLaunchContext | null {
  try {
    let b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<SolverLaunchContext>;
    if (parsed.schema !== SOLVER_LAUNCH_SCHEMA) return null;
    return {
      schema: SOLVER_LAUNCH_SCHEMA,
      lang: String(parsed.lang ?? ""),
      pmOrg: String(parsed.pmOrg ?? ""),
      contentOrg: String(parsed.contentOrg ?? ""),
      projectId: String(parsed.projectId ?? ""),
      taskId: String(parsed.taskId ?? ""),
      taskName: String(parsed.taskName ?? ""),
      book: String(parsed.book ?? ""),
      chapter: Number(parsed.chapter) || 0,
      resource: String(parsed.resource ?? ""),
      resourceName: String(parsed.resourceName ?? "").trim() || undefined,
      phaseSlug: String(parsed.phaseSlug ?? "").trim(),
      phaseName: String(parsed.phaseName ?? "").trim() || undefined,
      ref: String(parsed.ref ?? ""),
      portionIds: Array.isArray(parsed.portionIds) ? parsed.portionIds.map(String) : [],
      itemIds: Array.isArray(parsed.itemIds) ? parsed.itemIds.map(String) : [],
      workOrderKey: String(parsed.workOrderKey ?? ""),
      issueNumber: Number(parsed.issueNumber) || 0,
      issueUrl: String(parsed.issueUrl ?? ""),
      username: String(parsed.username ?? ""),
      stepId: String(parsed.stepId ?? "").trim() || undefined,
      stepName: String(parsed.stepName ?? "").trim() || undefined,
      focus: String(parsed.focus ?? "").trim() || undefined,
      lab: parsed.lab ? true : undefined,
      labAllowWrite: parsed.labAllowWrite ? true : undefined,
      labUnsafeWrite: parsed.labUnsafeWrite ? true : undefined,
    };
  } catch {
    return null;
  }
}

export function buildSolverLaunchContext(params: {
  username: string;
  lang: string;
  pmOrg: string;
  contentOrg: string;
  board: AssignmentsDoc;
  issue: DcsIssue;
  stepId?: string;
  stepName?: string;
}): SolverLaunchContext | null {
  const marker = parseWorkOrderMarker(params.issue.body);
  const taskId =
    marker?.teamId ||
    (params.issue.labels ?? [])
      .map((l) => parsePmFacetValue(l.name, "tarea"))
      .find(Boolean) ||
    "";
  if (!taskId) return null;
  const task = params.board.teams.find((t) => t.id === taskId);
  const book =
    marker?.book ||
    bookCodeFromIssueTitle(params.issue.title) ||
    projectFromMilestone(params.issue.milestone?.title) ||
    params.board.projectId ||
    params.board.book ||
    "";
  const resource =
    marker?.resource ||
    (params.issue.labels ?? [])
      .map((l) => parsePmFacetValue(l.name, "recurso"))
      .find(Boolean) ||
    "";
  return {
    schema: SOLVER_LAUNCH_SCHEMA,
    lang: params.lang,
    pmOrg: params.pmOrg,
    contentOrg: params.contentOrg,
    projectId: params.board.projectId || params.board.book || book,
    taskId,
    taskName: task?.name || taskId,
    book,
    chapter: chapterFromIssue(params.issue),
    resource,
    resourceName: params.board.settings?.resourceNames?.[resource as ScopeKey]?.name,
    phaseSlug: resolveTaskPhaseSlug(params.board, taskId),
    phaseName: resolveTaskPhaseName(params.board, taskId) || undefined,
    ref: refFromIssueTitle(params.issue.title),
    portionIds: marker?.portionIds ?? [],
    itemIds: marker?.itemIds ?? [],
    workOrderKey: marker?.key ?? "",
    issueNumber: params.issue.number,
    issueUrl: params.issue.html_url || "",
    username: params.username,
    stepId: params.stepId?.trim() || undefined,
    stepName: params.stepName?.trim() || undefined,
  };
}

/**
 * Why this solver must not launch (missing chapter/book for a URL template).
 * Spanish, for queue tooltips and `openSolverApp` errors.
 */
export function solverLaunchBlockReason(
  app: SolverApp,
  ctx: SolverLaunchContext,
): string | null {
  if (app.launchUrl.includes("{chapter}") && !(ctx.chapter > 0)) {
    return "Falta el capítulo para abrir el estudio.";
  }
  if (app.launchUrl.includes("{book}")) {
    if (isUrlSolver(app)) {
      if (!usfmStudyBookId(ctx.book)) {
        return "Falta el libro para abrir el estudio.";
      }
    } else if (!ctx.book.trim()) {
      return "Falta el libro para abrir el estudio.";
    }
  }
  return null;
}

function launchPlaceholders(
  app: SolverApp,
  ctx: SolverLaunchContext,
): Record<string, string> {
  const encoded = encodeSolverLaunchContext(ctx);
  const book = isUrlSolver(app)
    ? (usfmStudyBookId(ctx.book) ?? ctx.book.trim().toLowerCase())
    : ctx.book;
  const lang = isUrlSolver(app)
    ? (app.lang?.trim() || URL_TOOL_DEFAULT_LANG)
    : ctx.lang;
  return {
    context: encoded,
    lang,
    book,
    ref: ctx.ref,
    resource: ctx.resource,
    phaseSlug: ctx.phaseSlug,
    phaseName: ctx.phaseName ?? "",
    projectId: ctx.projectId,
    taskId: ctx.taskId,
    taskName: ctx.taskName,
    chapter: String(ctx.chapter),
    issueNumber: String(ctx.issueNumber),
    issueUrl: ctx.issueUrl,
    username: ctx.username,
    pmOrg: ctx.pmOrg,
    contentOrg: ctx.contentOrg,
    workOrderKey: ctx.workOrderKey,
    stepId: ctx.stepId ?? "",
    stepName: ctx.stepName ?? "",
  };
}

/**
 * Substitute `{placeholders}` in the catalog launchUrl.
 * `{context}` is the base64url JSON (not URI-encoded); other fields are URI-encoded.
 * Same-origin paths (`/solver-stub.html…`) are resolved against `window.location.origin`.
 * Returns `""` when the template cannot be filled (missing chapter/book).
 */
export function resolveSolverLaunchUrl(
  app: SolverApp,
  ctx: SolverLaunchContext,
): string {
  if (solverLaunchBlockReason(app, ctx)) return "";
  const flat = launchPlaceholders(app, ctx);
  let url = app.launchUrl.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = flat[key];
    if (value == null) return "";
    if (key === "context") return value;
    return encodeURIComponent(value);
  });
  // What the tool needs to know about the step it is opened for, as the process declared it.
  const extra = ctx.stepId ? app.stepParams?.[ctx.stepId] : undefined;
  if (extra) {
    const query = Object.entries(extra).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
    url += `${url.includes("?") ? "&" : "?"}${query}`;
  }
  if (url.startsWith("/") && typeof window !== "undefined" && window.location?.origin) {
    url = `${window.location.origin}${url}`;
  }
  return url;
}

/**
 * Opens the tool. Tools of this app open in the SAME tab (a person on a phone must not lose the app in another
 * tab); outside tools, or an explicit `newTab`, open another one.
 */
export function openSolverApp(app: SolverApp, ctx: SolverLaunchContext, opts: { newTab?: boolean } = {}): Window | null {
  const reason = solverLaunchBlockReason(app, ctx);
  if (reason) throw new Error(reason);
  const url = resolveSolverLaunchUrl(app, ctx);
  const sameOrigin = typeof window !== "undefined" && url.startsWith(window.location.origin);
  if (sameOrigin && !opts.newTab && app.openMode !== "external") {
    window.location.assign(url);
    return window;
  }
  return window.open(url, "_blank", "noopener,noreferrer");
}
