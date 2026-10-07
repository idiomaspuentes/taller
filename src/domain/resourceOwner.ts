import { scopeLabel } from "./resourceNames";
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

/**
 * Whoever maintains a resource, as it is said to a person: the phase that works on it and the resource («Afinación
 * (TPS)»). It was the name its team has in Door43 («pm-afinadores-tps»), which is a code; and the task found is
 * only the first of that phase the resource goes back to («Desafíos TPS»).
 */
export function ownerLabel(resource: string, board: AssignmentsDoc | null | undefined, task: ProjectTask | null | undefined, language: string): string {
  const owner = ownerTaskOf(resource, board, task);
  if (!owner || !board) return "";
  const phase = board.phases.find((row) => row.id === owner.phaseId);
  const said = (name: string, names?: Partial<Record<string, string>>) => names?.[language]?.trim() || name;
  return phase ? `${said(phase.name, phase.names)} (${scopeLabel(resource, board.settings?.resourceNames, language)})` : said(owner.name, owner.names);
}
