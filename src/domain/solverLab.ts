import type { HelpsDraftItem } from "./helpsDraft";
import type { HelpsTarget } from "./helpsTarget";
import {
  SOLVER_LAUNCH_SCHEMA,
  type SolverLaunchContext,
} from "./solverLaunch";
import { isUrlSolver, type SolverApp } from "./solvers";
import { portionRange } from "./usfmEdit";

/** Lab / missing-task launches — never require Entregar or a PM issue. */
export function isLabLaunch(
  ctx: Pick<SolverLaunchContext, "lab" | "taskId" | "issueNumber">,
): boolean {
  return Boolean(ctx.lab) || (!String(ctx.taskId ?? "").trim() && !(Number(ctx.issueNumber) > 0));
}

/** `1:10–11` (en dash), matching subtarea titles. */
export function formatLaunchRef(chapter: number, from: number, to: number): string {
  const cap = Math.max(0, Math.floor(chapter));
  const a = Math.max(1, Math.floor(from));
  const b = Math.max(a, Math.floor(to));
  return a === b ? `${cap}:${a}` : `${cap}:${a}–${b}`;
}

/** Same launch, narrowed to one verse range (editor link on a conflict card). */
export function launchForRange(
  ctx: SolverLaunchContext,
  range: { chapter: number; from: number; to: number },
): SolverLaunchContext {
  return { ...ctx, chapter: range.chapter, ref: formatLaunchRef(range.chapter, range.from, range.to) };
}

/**
 * Default GL orgs (`es-419_gl`, `{lang}_gl`) stay gated from lab writes.
 * Slugs that clearly say test / sandbox / lab / local are treated as safe.
 */
export function isProtectedContentOrg(org: string): boolean {
  const slug = org.trim().toLowerCase();
  if (!slug) return false;
  if (/(^|[._-])(test|sandbox|lab|local)([._-]|$)/i.test(slug)) return false;
  if (slug === "es-419_gl") return true;
  return /_gl$/.test(slug);
}

export type LabWriteDecision =
  | { mode: "local"; reason: string }
  | { mode: "dcs" }
  | { mode: "blocked"; reason: string };

export function labWriteDecision(ctx: SolverLaunchContext): LabWriteDecision {
  if (!isLabLaunch(ctx)) return { mode: "dcs" };
  if (!ctx.labAllowWrite) {
    return {
      mode: "local",
      reason:
        "Laboratorio: el borrador queda en este navegador. No se escribe en Door43.",
    };
  }
  const org = ctx.contentOrg.trim();
  if (!org) {
    return {
      mode: "blocked",
      reason: "Para escribir en DCS indica una organización de prueba (no uses es-419_gl).",
    };
  }
  if (isProtectedContentOrg(org) && !ctx.labUnsafeWrite) {
    return {
      mode: "blocked",
      reason: `«${org}» parece de producción. Usa una org de prueba o confirma escritura insegura.`,
    };
  }
  return { mode: "dcs" };
}

/** localStorage slot that works when `issueNumber` is 0. */
export function launchDraftSlot(ctx: SolverLaunchContext): {
  pmOrg: string;
  issueNumber: number;
} {
  if (isLabLaunch(ctx)) {
    const id = [ctx.lang, ctx.book, ctx.ref, ctx.resource, ctx.contentOrg || "local"]
      .map((part) => part.trim().toLowerCase() || "x")
      .join(":");
    return { pmOrg: `lab:${id}`, issueNumber: 1 };
  }
  return { pmOrg: ctx.pmOrg, issueNumber: ctx.issueNumber };
}

export function solverNeedsRealIssue(app: SolverApp): boolean {
  return app.id === "fcr-pair-review" || app.id === "fcr-group-review";
}

export function defaultResourceForSolver(app: SolverApp): string {
  if (app.resources?.length === 1) return app.resources[0];
  if (app.id === "helps-review") return "notas";
  if (app.id === "tps-translate") return "tps";
  if (app.id === "tpl-translate") return "tpl";
  return app.resources?.[0] || "tpl";
}

export function buildLabSolverLaunchContext(params: {
  username?: string;
  lang: string;
  book: string;
  chapter: number;
  verseFrom: number;
  verseTo: number;
  resource: string;
  contentOrg?: string;
  pmOrg?: string;
  allowWrite?: boolean;
  unsafeWrite?: boolean;
}): SolverLaunchContext {
  const book = params.book.trim().toUpperCase();
  const chapter = Math.max(0, Math.floor(Number(params.chapter) || 0));
  const from = Math.max(1, Math.floor(Number(params.verseFrom) || 1));
  const to = Math.max(from, Math.floor(Number(params.verseTo) || from));
  const ref = formatLaunchRef(chapter, from, to);
  return {
    schema: SOLVER_LAUNCH_SCHEMA,
    lang: params.lang.trim(),
    pmOrg: (params.pmOrg ?? "").trim(),
    contentOrg: (params.contentOrg ?? "").trim(),
    projectId: book,
    taskId: "",
    taskName: "Laboratorio",
    book,
    chapter,
    resource: params.resource.trim().toLowerCase(),
    phaseSlug: "lab",
    phaseName: "Laboratorio",
    ref,
    portionIds: [],
    itemIds: [],
    workOrderKey: "",
    issueNumber: 0,
    issueUrl: "",
    username: (params.username ?? "").trim(),
    lab: true,
    labAllowWrite: params.allowWrite || undefined,
    labUnsafeWrite: params.unsafeWrite || undefined,
  };
}

export function labPlaceholderHelpsItems(
  ctx: SolverLaunchContext,
  target: HelpsTarget,
): HelpsDraftItem[] {
  if (target.kind === "markdown") {
    return [
      {
        id: "lab-article",
        label: ctx.ref || "Artículo",
        meta: "laboratorio (sin inventario)",
        text: "",
        filepath: "",
        kind: "markdown",
      },
    ];
  }
  const range = portionRange(ctx.ref, ctx.chapter);
  if (!range) {
    return [
      {
        id: "lab-1",
        label: ctx.ref || "Porción",
        meta: "laboratorio",
        text: "",
        secondary: target.resource === "preguntas" ? "" : undefined,
        secondaryLabel: target.resource === "preguntas" ? "Respuesta" : undefined,
        filepath: target.filepath || "",
        kind: "tsv",
      },
    ];
  }
  const items: HelpsDraftItem[] = [];
  for (let verse = range.from; verse <= range.to; verse++) {
    items.push({
      id: `${range.chapter}:${verse}`,
      label: `${ctx.book} ${range.chapter}:${verse}`,
      meta: "laboratorio",
      text: "",
      secondary: target.resource === "preguntas" ? "" : undefined,
      secondaryLabel: target.resource === "preguntas" ? "Respuesta" : undefined,
      filepath: target.filepath || "",
      kind: "tsv",
    });
  }
  return items;
}

/** Open in-app hash routes in this tab; TC Study / stub in a new tab. */
export function openLabSolver(app: SolverApp, url: string): void {
  if (isUrlSolver(app)) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin === window.location.origin && parsed.hash) {
      window.location.hash = parsed.hash;
      return;
    }
  } catch {
    /* fall through */
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
