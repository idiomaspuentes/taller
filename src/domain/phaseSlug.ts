import type { Phase } from "./types";

/** Last-resort git prefix when the board has no phase at all. */
export const DEFAULT_PHASE_SLUG = "phase-default";

export function slugifyPhase(value: string | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  return (
    raw
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
  );
}

/**
 * Stable git slug for a board/template phase.
 * Prefer the persisted `slug`; otherwise derive from name, then id.
 */
export function ensurePhaseSlug(
  phase: Pick<Phase, "id" | "name"> & { slug?: string } | undefined,
): string {
  const explicit = slugifyPhase(phase?.slug);
  if (explicit) return explicit;
  const fromName = slugifyPhase(phase?.name);
  if (fromName) return fromName;
  const fromId = slugifyPhase(phase?.id);
  if (fromId) return fromId;
  return DEFAULT_PHASE_SLUG;
}

export function makePhase(params: {
  id?: string;
  name: string;
  slug?: string;
  description?: string;
  order: number;
}): Phase {
  const order = Number.isFinite(params.order) ? params.order : 0;
  const id = params.id?.trim() || (order === 0 ? "phase-default" : `phase-${order}`);
  const name = params.name.trim() || `Fase ${order + 1}`;
  return {
    id,
    name,
    slug: ensurePhaseSlug({ id, name, slug: params.slug }),
    description: params.description?.trim() || undefined,
    order,
  };
}

export function resolveBoardPhase(
  board: { phases?: Phase[] },
  phaseId: string | undefined,
): Phase | undefined {
  const phases = board.phases ?? [];
  if (phaseId) {
    const hit = phases.find((p) => p.id === phaseId);
    if (hit) return hit;
  }
  return phases[0];
}

/**
 * Subtarea → taskId → task.phaseId → that phase's slug.
 * No phase: first board phase, else `phase-default`.
 */
export function resolveTaskPhaseSlug(
  board: { phases?: Phase[]; teams?: { id: string; phaseId: string }[] },
  taskId: string | undefined,
): string {
  const task = taskId
    ? (board.teams ?? []).find((t) => t.id === taskId)
    : undefined;
  const phase = resolveBoardPhase(board, task?.phaseId);
  return ensurePhaseSlug(phase);
}

export function resolveTaskPhaseName(
  board: { phases?: Phase[]; teams?: { id: string; phaseId: string }[] },
  taskId: string | undefined,
): string {
  const task = taskId
    ? (board.teams ?? []).find((t) => t.id === taskId)
    : undefined;
  const phase = resolveBoardPhase(board, task?.phaseId);
  return phase?.name?.trim() || "";
}
