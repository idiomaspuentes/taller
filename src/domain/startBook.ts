import type { AssignmentsDoc, InventoryDoc, ProjectTask } from "./types";

/**
 * Starting a book is one action: the process is applied, the book is read and divided, and the work is laid out.
 * What a team repeats for every book must not be asked again; this file holds what makes that possible and what
 * the person is told afterwards. It knows no process: it reads the project's own phases, tasks and waits.
 */

/**
 * The teams of the new project, taken from the last project made with the same process. A task that already says
 * who does it (the template named its team) is left alone; people are never copied onto a task that has them.
 */
export function inheritTeams(board: AssignmentsDoc, previous: AssignmentsDoc | null | undefined): AssignmentsDoc {
  if (!previous || !previous.workflowId || previous.workflowId !== board.workflowId) return board;
  const before = new Map(previous.teams.map((task) => [task.id, task]));
  let changed = false;
  const teams = board.teams.map((task): ProjectTask => {
    const old = before.get(task.id);
    if (!old || task.orgTeamName || task.orgTeamId || task.memberIds.length) return task;
    if (!old.orgTeamName && !old.orgTeamId && !old.memberIds.length) return task;
    changed = true;
    return { ...task, orgTeamId: old.orgTeamId, orgTeamName: old.orgTeamName, memberIds: [...old.memberIds] };
  });
  if (!changed) return board;
  const known = new Set(board.people.map((person) => person.id));
  return { ...board, teams, people: [...board.people, ...previous.people.filter((person) => !known.has(person.id))] };
}

/** Tasks of the new project nobody is set to do: the one thing left to arrange after starting. */
export function tasksWithoutTeam(board: AssignmentsDoc): ProjectTask[] {
  return board.teams.filter((task) => !task.orgTeamName && !task.orgTeamId && !task.memberIds.length);
}

export type PhaseStart = {
  id: string;
  name: string;
  /** Can be worked on from the first day: none of its tasks waits for other work. */
  ready: boolean;
  /** Names of the phases it waits for, in order. */
  waitsFor: string[];
};

/** Each phase of the project as it stands on day one: ready, or waiting for which phases. */
export function phasesAtStart(board: Pick<AssignmentsDoc, "phases" | "teams">): PhaseStart[] {
  const phaseOf = new Map(board.teams.map((task) => [task.id, task.phaseId]));
  const nameOf = new Map(board.phases.map((phase) => [phase.id, phase.name]));
  return [...board.phases]
    .sort((a, b) => a.order - b.order)
    .map((phase) => {
      const awaited = new Set<string>();
      let source = false;
      for (const task of board.teams.filter((t) => t.phaseId === phase.id)) {
        for (const rule of task.waitsFor ?? []) {
          if (rule.source) source = true;
          else {
            const id = rule.phaseId ?? phaseOf.get(rule.taskId ?? "");
            if (id && id !== phase.id) awaited.add(id);
          }
        }
      }
      const names = board.phases.filter((p) => awaited.has(p.id)).sort((a, b) => a.order - b.order).map((p) => nameOf.get(p.id) ?? p.id);
      return { id: phase.id, name: phase.name, ready: !awaited.size && !source, waitsFor: names };
    });
}

export type StartNotice = "no-notes" | "no-questions" | "no-second-text";

/** What the book was found to lack in its source. Said in a line; it never stops the start. */
export function startNotices(inventory: Pick<InventoryDoc, "portions">): StartNotice[] {
  const sum = (pick: (p: InventoryDoc["portions"][number]) => number) => inventory.portions.reduce((n, p) => n + pick(p), 0);
  const out: StartNotice[] = [];
  if (sum((p) => p.notas) === 0) out.push("no-notes");
  if (sum((p) => p.preguntas) === 0) out.push("no-questions");
  if (sum((p) => p.tps) === 0) out.push("no-second-text");
  return out;
}

/** The size of the book as the person thinks of it. */
export function bookSize(inventory: Pick<InventoryDoc, "portions">): { chapters: number; portions: number } {
  return { chapters: new Set(inventory.portions.map((p) => p.chapter)).size, portions: inventory.portions.length };
}
