import { parseTaskProgressMarker } from "./taskProgress";
import type { AssignmentsDoc, InventoryDoc, ProjectTask } from "./types";
import { processOf } from "./walkthrough";

/**
 * Starting a book is one action: the process is applied, the book is read and divided, and the work is laid out.
 * What a team repeats for every book must not be asked again; this file holds what makes that possible and what
 * the person is told afterwards. It knows no process: it reads the project's own phases, tasks and waits.
 */

/**
 * The teams of the new project, taken from the last project made with the same process. A task that already says
 * who does it (the template named its team) is left alone; people are never copied onto a task that has them.
 * A walkthrough of a process is that process: its tasks are done by the teams that do them in a real book.
 */
export function inheritTeams(board: AssignmentsDoc, previous: AssignmentsDoc | null | undefined): AssignmentsDoc {
  if (!previous || !previous.workflowId || processOf(previous.workflowId) !== processOf(board.workflowId)) return board;
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

/**
 * The project with every task kept to some chapters of its book. A walkthrough is done on one chapter: on a whole
 * book it would lay out every subtarea of every task at once.
 */
export function limitedToChapters(board: AssignmentsDoc, book: string, chapters: number[] | undefined): AssignmentsDoc {
  const only = [...new Set((chapters ?? []).map((n) => Math.floor(Number(n))).filter((n) => n > 0))].sort((a, b) => a - b);
  if (!only.length) return board;
  return { ...board, teams: board.teams.map((task): ProjectTask => (task.general ? task : { ...task, scriptureScope: { mode: "chapters", book, chapters: only } })) };
}

/** Tasks of the new project nobody is set to do: the one thing left to arrange after starting. */
export function tasksWithoutTeam(board: AssignmentsDoc): ProjectTask[] {
  return board.teams.filter((task) => !task.orgTeamName && !task.orgTeamId && !task.memberIds.length);
}

export type PhaseWithoutTeam = { id: string; name: string; tasks: ProjectTask[] };

/** The phases that still have tasks nobody is set to do, in order, each with those tasks. */
export function phasesWithoutTeam(board: Pick<AssignmentsDoc, "phases" | "teams">): PhaseWithoutTeam[] {
  const loose = tasksWithoutTeam(board as AssignmentsDoc);
  return [...board.phases]
    .sort((a, b) => a.order - b.order)
    .map((phase) => ({ id: phase.id, name: phase.name, tasks: loose.filter((task) => task.phaseId === phase.id) }))
    .filter((phase) => phase.tasks.length);
}

export type PhaseTeam = {
  id: string;
  name: string;
  tasks: ProjectTask[];
  /** The team every task of the phase has; absent when none has one, or when they differ. */
  orgTeamId?: number;
  orgTeamName?: string;
  /** Its tasks do not all have the same team: some task was given its own. */
  mixed: boolean;
};

/** Every phase that has tasks, in order, with the team that does it today. */
export function phaseTeams(board: Pick<AssignmentsDoc, "phases" | "teams">): PhaseTeam[] {
  return [...board.phases]
    .sort((a, b) => a.order - b.order)
    .map((phase): PhaseTeam => {
      const tasks = board.teams.filter((task) => task.phaseId === phase.id);
      const names = new Set(tasks.map((task) => task.orgTeamName ?? ""));
      const one = names.size === 1 && tasks[0]?.orgTeamName ? tasks[0] : undefined;
      return { id: phase.id, name: phase.name, tasks, orgTeamId: one?.orgTeamId, orgTeamName: one?.orgTeamName, mixed: names.size > 1 };
    })
    .filter((phase) => phase.tasks.length);
}

/** A team of the organization as the chooser needs it: what it may do and on which repositories. */
export type TeamOption = {
  id: number;
  name: string;
  description?: string;
  /** May write to the repositories it has (not only read them). */
  canEdit: boolean;
  /** What it may do per unit, as the server keeps it: kept so that allowing it to edit changes nothing else. */
  unitsMap?: Record<string, string>;
  /** Repositories the team was given; ignored when it has all of the organization's. */
  repos: string[];
  allRepos: boolean;
  /** A team the organization has for something else (its owners, teams of other tools): listed last, apart. */
  foreign?: boolean;
};

/**
 * The teams of a list in the order a person looks for them: the working teams, those that can already edit what
 * the tasks write first; then the rest of the organization's. The team just made for a phase came after «admins»,
 * «Owners», «translators» and «br_translator», which may edit everything and do none of this work.
 */
export function teamGroups(teams: TeamOption[], needed: string[]): { ready: TeamOption[]; rest: TeamOption[]; foreign: TeamOption[] } {
  const own = teams.filter((team) => !team.foreign);
  const ready = own.filter((team) => teamAccess(team, needed).state === "edits");
  return { ready, rest: own.filter((team) => !ready.includes(team)), foreign: teams.filter((team) => team.foreign) };
}

export type TeamAccess = {
  /** `edits`: can already write everything; `will-get`: may write, but lacks repositories; `read-only`: may not write. */
  state: "edits" | "will-get" | "read-only";
  missing: string[];
};

/** Whether a team can edit the repositories a task (or a phase) writes to, and which ones it still lacks. */
export function teamAccess(team: Pick<TeamOption, "canEdit" | "repos" | "allRepos">, needed: string[]): TeamAccess {
  const has = new Set(team.repos.map((repo) => repo.toLowerCase()));
  const missing = team.allRepos ? [] : needed.filter((repo) => !has.has(repo.toLowerCase()));
  if (!team.canEdit) return { state: "read-only", missing };
  return { state: missing.length ? "will-get" : "edits", missing };
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

export type NextBookHint = { projectId: string; phase: string; done: number; total: number };

/** A subtarea the plan withdrew: closed with steps of its task left undone. A delivered one has them all done. */
export function wasWithdrawn(issue: { state?: string; body?: string | null }, steps: { id: string }[] | undefined): boolean {
  if ((issue.state ?? "").toLowerCase() !== "closed" || !steps?.length) return false;
  const done = parseTaskProgressMarker(issue.body ?? "").doneStepIds;
  return steps.some((step) => !done.includes(step.id));
}

/** From how much of the first phase is closed it is time to have the next book ready. */
export const NEXT_BOOK_AT = 0.7;

/**
 * Books overlap by phase: the team of the first phase must find the next book waiting when it finishes this one.
 * Given the newest book and all its subtareas (as task ids and whether each is closed), says whether its first
 * phase is far enough along that the next book should be started now.
 */
export function nextBookHint(board: Pick<AssignmentsDoc, "projectId" | "phases" | "teams"> & Partial<Pick<AssignmentsDoc, "settings">>, work: { taskId: string; closed: boolean }[]): NextBookHint | null {
  const first = [...board.phases].sort((a, b) => a.order - b.order)[0];
  if (!first) return null;
  const tasks = new Set(board.teams.filter((task) => task.phaseId === first.id).map((task) => task.id));
  const mine = work.filter((row) => tasks.has(row.taskId));
  const done = mine.filter((row) => row.closed).length;
  // The process may say when; a project made before it did uses the usual mark.
  if (!mine.length || done / mine.length < (board.settings?.nextBookAt ?? NEXT_BOOK_AT)) return null;
  return { projectId: board.projectId, phase: first.name, done, total: mine.length };
}

/**
 * Did closing this one subtarea take the first phase past the point where the next book should be started? True
 * only for the delivery that crosses it, so whoever coordinates is told once and not at every delivery after it.
 */
export function reachesNextBook(board: Pick<AssignmentsDoc, "projectId" | "phases" | "teams"> & Partial<Pick<AssignmentsDoc, "settings">>, work: { taskId: string; closed: boolean; number: number }[], closedNumber: number): NextBookHint | null {
  const after = nextBookHint(board, work.map((row) => (row.number === closedNumber ? { ...row, closed: true } : row)));
  const before = nextBookHint(board, work.map((row) => (row.number === closedNumber ? { ...row, closed: false } : row)));
  return after && !before ? after : null;
}

/** Who is told: the coordinators of the teams of the first phase. */
export function firstPhaseTeams(board: Pick<AssignmentsDoc, "phases" | "teams">): string[] {
  const first = [...board.phases].sort((a, b) => a.order - b.order)[0];
  return [...new Set(board.teams.filter((task) => task.phaseId === first?.id).map((task) => task.orgTeamName ?? "").filter(Boolean))];
}
