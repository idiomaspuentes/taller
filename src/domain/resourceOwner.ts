import type { AssignmentsDoc, ProjectTask } from "./types";

/**
 * The task that last worked on a resource before this one: whoever maintains it now. A later phase that finds a
 * problem in a resource it may not change sends it there.
 */
export function ownerTaskOf(resource: string, board: AssignmentsDoc | null | undefined, task: ProjectTask | null | undefined): ProjectTask | undefined {
  if (!board || !task) return undefined;
  const order = new Map(board.phases.map((phase) => [phase.id, phase.order]));
  const mine = order.get(task.phaseId) ?? 0;
  return board.teams
    .filter((other) => other.id !== task.id && (order.get(other.phaseId) ?? 0) < mine && other.rules.some((rule) => rule.resource === resource))
    .sort((a, b) => (order.get(b.phaseId) ?? 0) - (order.get(a.phaseId) ?? 0))[0];
}
