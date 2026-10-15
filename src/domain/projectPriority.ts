/**
 * The order the projects of a space are worked in, and those set aside, as whoever manages leaves them
 * (`PmConfig.projectOrder`, `paused`). Pure: the screen asks for a change, this says how the lists end up.
 */

/** The projects as they are worked: those in the order first, as ordered; the rest after, as they came; the paused apart. */
export function orderedProjects<T extends { projectId: string }>(projects: T[], order: string[], paused: string[]): { active: T[]; paused: T[] } {
  const id = (project: T) => project.projectId.toUpperCase();
  const asideIds = new Set(paused.map((one) => one.toUpperCase()));
  const at = (project: T) => {
    const place = order.indexOf(id(project));
    return place < 0 ? Number.MAX_SAFE_INTEGER : place;
  };
  const sorted = projects.map((project, i) => ({ project, i })).sort((a, b) => at(a.project) - at(b.project) || a.i - b.i).map((row) => row.project);
  return { active: sorted.filter((project) => !asideIds.has(id(project))), paused: sorted.filter((project) => asideIds.has(id(project))) };
}

/**
 * The order after moving one project a place up (-1) or down (1) among the ones being worked. The whole order is
 * written then, every project of the space in it: one left out would fall to the end by its date, wherever it was.
 */
export function moveProject(active: string[], projectId: string, side: -1 | 1): string[] {
  const ids = active.map((one) => one.toUpperCase());
  const from = ids.indexOf(projectId.toUpperCase());
  const to = from + side;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

/** The projects set aside after pausing or resuming one. A project resumed comes back at the end of the order. */
export function withPause(state: { projectOrder: string[]; paused: string[] }, projectId: string, pause: boolean): { projectOrder: string[]; paused: string[] } {
  const id = projectId.toUpperCase();
  const paused = state.paused.filter((one) => one.toUpperCase() !== id);
  const projectOrder = state.projectOrder.filter((one) => one.toUpperCase() !== id);
  return pause ? { projectOrder, paused: [...paused, id] } : { projectOrder: [...projectOrder, id], paused };
}
