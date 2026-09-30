import { useCallback, useEffect, useMemo, useState } from "react";
import type { StepId } from "./components/StepNav";
import { normalizeProjectId } from "./domain/books";

export type AppRoute =
  | { name: "home" }
  /** Home of a worker: the one thing to do next. */
  | { name: "ahora" }
  /** Decisions, unread comments and new tasks. */
  | { name: "avisos" }
  /** «Equipo hoy»: how the work stands, for whoever coordinates. */
  | { name: "hoy" }
  | { name: "mis-tareas" }
  /** One subtarea as a conversation. `demo` = local fixture (dev only, no DCS). */
  | { name: "conversacion"; issue: number; demo?: boolean }
  /** Fictional verse conflict, in memory only (`#/mis-tareas/prueba`). */
  | { name: "conflicto-prueba" }
  | { name: "equipo"; orgTeam: string }
  | { name: "proyectos" }
  /**
   * `projectId` is the project slug: today usually a book code (`NEH`),
   * later may be thematic / multi-book (`pentateuco-r1`). Not always a book.
   */
  | { name: "proyecto"; projectId: string; step: StepId; taskId?: string }
  | { name: "organizacion" }
  /** Org workflow templates (fases + tareas + checklists). */
  | { name: "plantillas"; workflowId?: string }
  /** Scripture USFM editor opened from Resolver (`ctx` in hash query). */
  | { name: "solver-scripture"; ctx: string }
  | { name: "solver-helps"; ctx: string }
  | { name: "solver-familiarize"; ctx: string }
  | { name: "solver-review"; ctx: string; mode: "pair" | "group" }
  /** Afinación review step (`notas`, later `palabras`, `alineacion`). */
  | { name: "solver-afinar"; ctx: string; step: string }
  /** Sandbox: launch solvers without Entregar / issues. `#/lab` or `#/solver-lab`. */
  | { name: "solver-lab" };

const PROJECT_STEPS: StepId[] = ["inventario", "tareas", "asignar", "entregar", "avance", "publicar"];

/** Map legacy URL segments → current step ids. */
export function normalizeProjectStep(raw: string | undefined): StepId {
  if (!raw) return "tareas";
  if (raw === "equipos") return "tareas";
  // Old step name conflated “project = book”; inventory is the step, not the id.
  if (raw === "libro") return "inventario";
  return PROJECT_STEPS.includes(raw as StepId) ? (raw as StepId) : "tareas";
}

export function parseHash(hash: string): AppRoute {
  const rawFull = hash.replace(/^#/, "").replace(/^\//, "");
  const qIndex = rawFull.indexOf("?");
  const raw = qIndex >= 0 ? rawFull.slice(0, qIndex) : rawFull;
  const query = qIndex >= 0 ? rawFull.slice(qIndex + 1) : "";
  const params = new URLSearchParams(query);
  const parts = raw.split("/").filter(Boolean).map(decodeURIComponent);

  if (!parts.length) return { name: "home" };
  if (parts[0] === "mis-tareas") {
    if (parts[1] === "prueba") return { name: "conflicto-prueba" };
    const issue = Number(parts[1]);
    if (parts[1] && Number.isInteger(issue) && issue > 0) {
      return params.get("demo") === "1"
        ? { name: "conversacion", issue, demo: true }
        : { name: "conversacion", issue };
    }
    return { name: "mis-tareas" };
  }
  if (parts[0] === "ahora") return { name: "ahora" };
  if (parts[0] === "avisos") return { name: "avisos" };
  if (parts[0] === "hoy") return { name: "hoy" };
  if (parts[0] === "organizacion") return { name: "organizacion" };
  if (parts[0] === "plantillas") {
    return { name: "plantillas", workflowId: parts[1] || undefined };
  }
  if (parts[0] === "lab" || (parts[0] === "solver" && parts[1] === "lab")) {
    return { name: "solver-lab" };
  }
  if (parts[0] === "solver" && parts[1] === "scripture") {
    const ctx = params.get("ctx") || "";
    return { name: "solver-scripture", ctx };
  }
  if (parts[0] === "solver" && parts[1] === "helps") {
    return { name: "solver-helps", ctx: params.get("ctx") || "" };
  }
  if (parts[0] === "solver" && parts[1] === "familiarize") {
    return { name: "solver-familiarize", ctx: params.get("ctx") || "" };
  }
  if (parts[0] === "solver" && parts[1] === "review") {
    const mode = params.get("mode") === "group" ? "group" : "pair";
    return { name: "solver-review", ctx: params.get("ctx") || "", mode };
  }
  if (parts[0] === "solver" && parts[1] === "afinar") {
    return { name: "solver-afinar", ctx: params.get("ctx") || "", step: params.get("step") || "notas" };
  }
  if (parts[0] === "proyectos") {
    if (parts.length === 1) return { name: "proyectos" };
    const projectId = normalizeProjectId(parts[1]);
    // #/proyectos/:projectId/tareas/:taskId
    if (parts[2] === "tareas" && parts[3]) {
      return {
        name: "proyecto",
        projectId,
        step: "tareas",
        taskId: parts[3],
      };
    }
    // #/proyectos/:projectId or #/proyectos/:projectId/:step
    const step = normalizeProjectStep(parts[2]);
    return { name: "proyecto", projectId, step };
  }
  if (parts[0] === "equipo" && parts[1]) {
    return { name: "equipo", orgTeam: parts[1] };
  }
  return { name: "home" };
}

export function routeToHash(route: AppRoute): string {
  switch (route.name) {
    case "home":
      return "#/";
    case "ahora":
      return "#/ahora";
    case "avisos":
      return "#/avisos";
    case "hoy":
      return "#/hoy";
    case "mis-tareas":
      return "#/mis-tareas";
    case "conversacion":
      return `#/mis-tareas/${route.issue}${route.demo ? "?demo=1" : ""}`;
    case "conflicto-prueba":
      return "#/mis-tareas/prueba";
    case "organizacion":
      return "#/organizacion";
    case "plantillas":
      return route.workflowId
        ? `#/plantillas/${encodeURIComponent(route.workflowId)}`
        : "#/plantillas";
    case "proyectos":
      return "#/proyectos";
    case "proyecto": {
      const base = `#/proyectos/${encodeURIComponent(route.projectId)}/${route.step}`;
      if (route.step === "tareas" && route.taskId) {
        return `${base}/${encodeURIComponent(route.taskId)}`;
      }
      return base;
    }
    case "equipo":
      return `#/equipo/${encodeURIComponent(route.orgTeam)}`;
    case "solver-scripture":
      return `#/solver/scripture?ctx=${encodeURIComponent(route.ctx)}`;
    case "solver-helps":
      return `#/solver/helps?ctx=${encodeURIComponent(route.ctx)}`;
    case "solver-familiarize":
      return `#/solver/familiarize?ctx=${encodeURIComponent(route.ctx)}`;
    case "solver-afinar":
      return `#/solver/afinar?step=${encodeURIComponent(route.step)}&ctx=${encodeURIComponent(route.ctx)}`;
    case "solver-review":
      return `#/solver/review?mode=${route.mode}&ctx=${encodeURIComponent(route.ctx)}`;
    case "solver-lab":
      return "#/lab";
  }
}

function rewriteLegacyProjectHash(): string | null {
  const raw = window.location.hash.replace(/^#/, "").replace(/^\//, "");
  const parts = raw.split("/").filter(Boolean);
  if (parts[0] !== "proyectos" || !parts[1]) return null;
  const projectId = normalizeProjectId(decodeURIComponent(parts[1]));
  // …/equipos → …/tareas
  if (parts[2] === "equipos") {
    return routeToHash({
      name: "proyecto",
      projectId,
      step: "tareas",
      taskId: parts[3] ? decodeURIComponent(parts[3]) : undefined,
    });
  }
  // …/libro → …/inventario
  if (parts[2] === "libro") {
    return routeToHash({
      name: "proyecto",
      projectId,
      step: "inventario",
    });
  }
  return null;
}

export function useHashRoute(): {
  route: AppRoute;
  navigate: (route: AppRoute) => void;
} {
  const [route, setRoute] = useState<AppRoute>(() =>
    parseHash(typeof window !== "undefined" ? window.location.hash : ""),
  );

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const next = rewriteLegacyProjectHash();
    if (!next || window.location.hash === next) return;
    window.history.replaceState(null, "", next);
    setRoute(parseHash(next));
  }, [route]);

  const navigate = useCallback((next: AppRoute) => {
    const hash = routeToHash(next);
    if (window.location.hash !== hash) {
      window.location.hash = hash;
    } else {
      setRoute(next);
    }
  }, []);

  return useMemo(() => ({ route, navigate }), [route, navigate]);
}

export function landingRoute(canManage: boolean): AppRoute {
  return canManage ? { name: "hoy" } : { name: "ahora" };
}
