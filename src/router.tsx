import { useCallback, useEffect, useMemo, useState } from "react";
import type { StepId } from "./components/StepNav";
import { normalizeProjectId } from "./domain/books";

export type AppRoute =
  | { name: "home" }
  /** Home of a worker: the one thing to do next. */
  /** Decisions, unread comments and new tasks. */
  | { name: "avisos" }
  /** «Equipo hoy»: how the work stands, for whoever coordinates. */
  | { name: "hoy" }
  | { name: "mis-tareas" }
  /** The person's Door43 profile, read-only (editing happens in Door43). */
  | { name: "perfil" }
  /** One subtarea as a conversation. `demo` = local fixture (dev only, no DCS). */
  | { name: "conversacion"; issue: number; demo?: boolean }
  /** Fictional verse conflict, in memory only (`#/mis-tareas/prueba`). */
  | { name: "conflicto-prueba" }
  | { name: "equipo"; orgTeam: string }
  | { name: "proyectos" }
  /** A project being prepared, before it is created (`DraftProjectView`). */
  | { name: "proyecto-nuevo" }
  /**
   * `projectId` is the project slug: today usually a book code (`NEH`),
   * later may be thematic / multi-book (`pentateuco-r1`). Not always a book.
   */
  | { name: "proyecto"; projectId: string; step: StepId; taskId?: string }
  | { name: "organizacion" }
  /** Org workflow templates (fases + tareas + checklists). */
  | { name: "plantillas"; workflowId?: string }
  /** The glossary of translation decisions; with a passage, it opens on the entries of that passage. */
  | { name: "glosario"; book?: string; chapter?: number; from?: number; to?: number }
  /** Scripture USFM editor opened from Resolver (`ctx` in hash query). */
  | { name: "solver-scripture"; ctx: string }
  | { name: "solver-helps"; ctx: string }
  | { name: "solver-familiarize"; ctx: string }
  | { name: "solver-review"; ctx: string; mode: "pair" | "group" }
  | { name: "solver-lectura"; ctx: string }
  /** Afinación review step (`notas`, later `palabras`, `alineacion`). */
  | { name: "solver-afinar"; ctx: string; step: string; mode?: string }
  /** A step that closes by a checklist: `items` is what it goes over, `text` the text(s) it is checked against. */
  | { name: "solver-checklist"; ctx: string; items: string; text: string; only?: string }
  /** A committee endorses a unit: `reporte` (a member's report) or `decision`. */
  | { name: "solver-aval"; ctx: string; mode: string }
  /** Publishing one unit: `comprobar` (the checks) or `publicar`. `aligned`: texts that must be aligned. */
  | { name: "solver-publicar"; ctx: string; mode: string; aligned: string; endorsed?: string; articles?: string }
  /** Sandbox: launch solvers without Entregar / issues. `#/lab` or `#/solver-lab`. */
  | { name: "solver-lab" };

const PROJECT_STEPS: StepId[] = ["avance", "tareas", "subtareas", "publicar", "inventario", "asignar", "entregar"];

/** Map legacy URL segments → current step ids. */
export function normalizeProjectStep(raw: string | undefined): StepId {
  if (!raw) return "tareas";
  if (raw === "equipos") return "tareas";
  // Old step name conflated “project = book”; inventory is the step, not the id.
  if (raw === "libro") return "inventario";
  // Handing work out and writing the subtareas are done from the subtareas screen now.
  if (raw === "asignar" || raw === "entregar") return "subtareas";
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
  // «Ahora» became the first card of «Mis tareas»: old links and installed shortcuts still land there.
  if (parts[0] === "ahora") return { name: "mis-tareas" };
  if (parts[0] === "avisos") return { name: "avisos" };
  if (parts[0] === "glosario") {
    const chapter = Number(params.get("c"));
    const book = (params.get("libro") || "").toUpperCase();
    if (!book || !Number.isInteger(chapter) || chapter <= 0) return { name: "glosario" };
    return { name: "glosario", book, chapter, from: Number(params.get("de")) || 1, to: Number(params.get("a")) || 200 };
  }
  if (parts[0] === "hoy") return { name: "hoy" };
  if (parts[0] === "perfil") return { name: "perfil" };
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
  if (parts[0] === "solver" && parts[1] === "publicar") {
    return { name: "solver-publicar", ctx: params.get("ctx") || "", mode: params.get("mode") || "comprobar", aligned: params.get("aligned") || "", endorsed: params.get("endorsed") || undefined, articles: params.get("articles") || undefined };
  }
  if (parts[0] === "solver" && parts[1] === "lectura") {
    return { name: "solver-lectura", ctx: params.get("ctx") || "" };
  }
  if (parts[0] === "solver" && parts[1] === "aval") {
    return { name: "solver-aval", ctx: params.get("ctx") || "", mode: params.get("mode") || "reporte" };
  }
  if (parts[0] === "solver" && parts[1] === "checklist") {
    return { name: "solver-checklist", ctx: params.get("ctx") || "", items: params.get("items") || "notas", text: params.get("text") || "tpl", only: params.get("only") || undefined };
  }
  if (parts[0] === "solver" && parts[1] === "afinar") {
    const mode = params.get("mode") || undefined;
    return { name: "solver-afinar", ctx: params.get("ctx") || "", step: params.get("step") || "notas", ...(mode ? { mode } : {}) };
  }
  if (parts[0] === "proyectos") {
    if (parts.length === 1) return { name: "proyectos" };
    if (parts[1] === "nuevo") return { name: "proyecto-nuevo" };
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
    case "perfil":
      return "#/perfil";
    case "organizacion":
      return "#/organizacion";
    case "plantillas":
      return route.workflowId
        ? `#/plantillas/${encodeURIComponent(route.workflowId)}`
        : "#/plantillas";
    case "proyectos":
      return "#/proyectos";
    case "proyecto-nuevo":
      return "#/proyectos/nuevo";
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
      return `#/solver/afinar?step=${encodeURIComponent(route.step)}${route.mode ? `&mode=${encodeURIComponent(route.mode)}` : ""}&ctx=${encodeURIComponent(route.ctx)}`;
    case "glosario":
      return route.book && route.chapter ? `#/glosario?libro=${encodeURIComponent(route.book)}&c=${route.chapter}&de=${route.from ?? 1}&a=${route.to ?? 200}` : "#/glosario";
    case "solver-publicar":
      return `#/solver/publicar?mode=${encodeURIComponent(route.mode)}&aligned=${encodeURIComponent(route.aligned)}${route.endorsed ? `&endorsed=${encodeURIComponent(route.endorsed)}` : ""}${route.articles ? `&articles=${encodeURIComponent(route.articles)}` : ""}&ctx=${encodeURIComponent(route.ctx)}`;
    case "solver-aval":
      return `#/solver/aval?mode=${encodeURIComponent(route.mode)}&ctx=${encodeURIComponent(route.ctx)}`;
    case "solver-checklist":
      return `#/solver/checklist?items=${encodeURIComponent(route.items)}&text=${encodeURIComponent(route.text)}${route.only ? `&only=${encodeURIComponent(route.only)}` : ""}&ctx=${encodeURIComponent(route.ctx)}`;
    case "solver-review":
      return `#/solver/review?mode=${route.mode}&ctx=${encodeURIComponent(route.ctx)}`;
    case "solver-lectura":
      return `#/solver/lectura?ctx=${encodeURIComponent(route.ctx)}`;
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
  return canManage ? { name: "hoy" } : { name: "mis-tareas" };
}
