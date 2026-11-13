import type { DcsIssue } from "@ip-lms/dcs-client";
import { BOOKS } from "./books";
import { chaptersOf } from "./bookChapters";
import { chaptersDoneElsewhere, type BookDoneElsewhere } from "./doneElsewhere";
import { issueTaskId } from "./myTasks";
import type { AssignmentsDoc } from "./types";
import { countedWork, issueFraction } from "./workProgress";
import { parseWorkOrderMarker } from "./workOrder";

/**
 * How far a whole book is: every task of its process, chapter by chapter, counting what was done before Taller (the
 * record of `doneElsewhere.ts`, and the subtareas brought closed from translationCore) beside the subtareas worked here.
 *
 * Each task of the book is worth the same, and within a task each chapter is worth the same. A chapter is done when
 * the record says so; otherwise it is the mean of its subtareas (as `workProgress.ts` counts each one). A chapter is
 * never counted twice. A task whose work is filed in some chapters only (articles) is measured by those chapters:
 * a chapter without its subtareas is not work left to do, once the task has any subtareas at all. Without subtareas
 * and without the record, every chapter of the task is still to do.
 *
 * This measures the book, not the subtareas: «Avance» of a project counts its subtareas, each worth the same.
 */

export type TaskStanding = {
  taskId: string;
  phaseId: string;
  /** Between 0 and 1. */
  fraction: number;
  /** The part done before Taller: in the record, or brought closed from elsewhere. */
  before: number;
  /** The chapters it is measured by. */
  chapters: number;
};

export type PhaseStanding = { phaseId: string; fraction: number; before: number; tasks: TaskStanding[] };

export type BookStanding = {
  book: string;
  fraction: number;
  before: number;
  /** Whether anything of it was laid out in Taller (it has subtareas). */
  started: boolean;
  phases: PhaseStanding[];
};

type Plan = Pick<AssignmentsDoc, "teams" | "phases">;

/** The chapter a subtarea works on: its label `…/cap:N`, or the chapter of its first portion (`EPH-03-02`). */
export function issueChapter(issue: DcsIssue): number {
  for (const label of issue.labels ?? []) {
    const match = /\/cap:(\d+)$/.exec(label.name);
    if (match) return Number(match[1]);
  }
  const portion = parseWorkOrderMarker(issue.body ?? undefined)?.portionIds[0] ?? "";
  const match = /^[A-Z0-9]+-(\d+)-/i.exec(portion);
  return match ? Number(match[1]) : 0;
}

const mean = (values: number[]): number => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

export function bookStanding(params: {
  book: string;
  plan: Plan;
  /** Every subtarea of the book's project in Taller (open and closed); none for a book never brought here. */
  issues: DcsIssue[];
  elsewhere?: BookDoneElsewhere;
  /** Only the tasks of these org teams (whoever coordinates them); every task when absent. */
  teams?: string[];
  /** The book's chapters; from `bookChapters.ts` when absent. */
  chapters?: number;
}): BookStanding {
  const { book, plan, issues, elsewhere } = params;
  const chapters = params.chapters ?? chaptersOf(book);
  const teams = params.teams?.map((name) => name.trim().toLowerCase());
  const tasks = plan.teams.filter((task) => !teams || teams.includes((task.orgTeamName ?? "").trim().toLowerCase()));

  // Each subtarea, by task and chapter: how far it is, and whether its work was brought from elsewhere.
  const cells = new Map<string, Map<number, { fraction: number; before: number }[]>>();
  let started = false;
  for (const { issue, fraction, before } of countedWork(issues, plan)) {
    started = true;
    const chapter = issueChapter(issue);
    if (chapter < 1 || chapter > chapters) continue;
    const taskId = issueTaskId(issue);
    const byChapter = cells.get(taskId) ?? new Map();
    cells.set(taskId, byChapter);
    byChapter.set(chapter, [...(byChapter.get(chapter) ?? []), { fraction, before }]);
  }

  const taskRows: TaskStanding[] = tasks.map((task) => {
    const recorded = chaptersDoneElsewhere(elsewhere, task.id, chapters);
    const laid = cells.get(task.id);
    const values: number[] = [];
    const before: number[] = [];
    for (let chapter = 1; chapter <= chapters; chapter++) {
      if (recorded.has(chapter)) {
        values.push(1);
        before.push(1);
        continue;
      }
      const here = laid?.get(chapter);
      if (here?.length) {
        values.push(mean(here.map((row) => row.fraction)));
        before.push(here.reduce((sum, row) => sum + row.before, 0) / here.length);
      } else if (!laid) {
        values.push(0);
        before.push(0);
      }
    }
    return { taskId: task.id, phaseId: task.phaseId, fraction: mean(values), before: mean(before), chapters: values.length };
  });

  const phases: PhaseStanding[] = [...plan.phases]
    .sort((a, b) => a.order - b.order)
    .map((phase) => {
      const rows = taskRows.filter((row) => row.phaseId === phase.id);
      return { phaseId: phase.id, tasks: rows, fraction: mean(rows.map((row) => row.fraction)), before: mean(rows.map((row) => row.before)) };
    })
    .filter((phase) => phase.tasks.length);
  return { book: book.toUpperCase(), started, phases, fraction: mean(taskRows.map((row) => row.fraction)), before: mean(taskRows.map((row) => row.before)) };
}

/**
 * The tasks of a book that has no project in Taller, as its process lays them out, each with the org team it has in
 * the projects of the space (the newest that names one): the team that would do it is the one that coordinates it.
 */
export function planWithTeams<P extends Plan>(process: P, boards: Plan[]): P {
  const teamOf = new Map<string, string>();
  for (const board of boards) {
    for (const task of board.teams) if (task.orgTeamName && !teamOf.has(task.id)) teamOf.set(task.id, task.orgTeamName);
  }
  return { ...process, teams: process.teams.map((task) => (task.orgTeamName || !teamOf.has(task.id) ? task : { ...task, orgTeamName: teamOf.get(task.id) })) };
}

const canon = (book: string): number => {
  const at = BOOKS.findIndex((row) => row.code === book.toUpperCase());
  return at < 0 ? BOOKS.length : at;
};

/**
 * The books in the order they are read: the ones worked in Taller (in the order of «Proyectos», then the rest), the
 * ones still to be brought, the ones set aside, and the finished ones last. Within a group, in the order of the Bible.
 */
export function orderBooks<T extends { book: string; fraction: number; started: boolean }>(rows: T[], priority: { projectOrder: string[]; paused: string[] }): T[] {
  const order = priority.projectOrder.map((id) => id.toUpperCase());
  const paused = new Set(priority.paused.map((id) => id.toUpperCase()));
  const group = (row: T): number => (row.fraction >= 1 ? 3 : paused.has(row.book.toUpperCase()) ? 2 : row.started ? 0 : 1);
  const place = (row: T): number => {
    const at = order.indexOf(row.book.toUpperCase());
    return group(row) === 0 && at >= 0 ? at : order.length + canon(row.book);
  };
  return [...rows].sort((a, b) => group(a) - group(b) || place(a) - place(b));
}

/** A book of the space, as the panels show it. */
export type SpaceBook = {
  book: string;
  /** Its project in Taller, when it has one. */
  projectId?: string;
  title?: string;
  plan: Plan;
  /** The subtareas of its project that count here (of the teams asked for). */
  issues: DcsIssue[];
  elsewhere?: BookDoneElsewhere;
  paused: boolean;
  standing: BookStanding;
};

/**
 * Every book of a space: the ones with a project in Taller, and the ones the record of work done elsewhere names.
 * A book without a project is measured by the tasks of its process (`process`). With `teams`, only those teams' tasks
 * count, and a book where they have none is left out.
 */
export function spaceBooks(params: {
  projects: { projectId: string; title?: string; board: Plan & Pick<AssignmentsDoc, "book" | "books" | "kind">; issues: DcsIssue[] }[];
  doneElsewhere: { books: Record<string, BookDoneElsewhere> };
  /** The process a book without a project is laid out by; such books are left out without it. */
  process?: Plan;
  teams?: string[];
  priority: { projectOrder: string[]; paused: string[] };
}): SpaceBook[] {
  const { projects, doneElsewhere, process, teams, priority } = params;
  const paused = new Set(priority.paused.map((id) => id.toUpperCase()));
  const mine = teams?.map((name) => name.trim().toLowerCase());
  const ofTeams = (plan: Plan, issues: DcsIssue[]) => {
    if (!mine) return issues;
    const tasks = new Set(plan.teams.filter((task) => mine.includes((task.orgTeamName ?? "").trim().toLowerCase())).map((task) => task.id));
    return issues.filter((issue) => tasks.has(issueTaskId(issue)));
  };
  const out: SpaceBook[] = [];
  const seen = new Set<string>();
  for (const project of projects) {
    // A project of one book; a project of several (thematic) is not a book, and is left to «Proyectos».
    const book = (project.board.books?.length === 1 ? project.board.books[0]! : project.board.book || project.projectId).toUpperCase();
    if ((project.board.books?.length ?? 1) > 1 || !chaptersOf(book) || seen.has(book)) continue;
    seen.add(book);
    const elsewhere = doneElsewhere.books[book];
    const issues = ofTeams(project.board, project.issues);
    out.push({ book, projectId: project.projectId, title: project.title, plan: project.board, issues, elsewhere, paused: paused.has(project.projectId.toUpperCase()) || paused.has(book), standing: { ...bookStanding({ book, plan: project.board, issues, elsewhere, teams }), started: project.issues.some((issue) => issueFraction(issue, project.board) !== null) } });
  }
  if (process) {
    const plan = planWithTeams(process, projects.map((project) => project.board));
    for (const [book, elsewhere] of Object.entries(doneElsewhere.books)) {
      if (seen.has(book) || !chaptersOf(book)) continue;
      seen.add(book);
      out.push({ book, plan, issues: [], elsewhere, paused: paused.has(book), standing: bookStanding({ book, plan, issues: [], elsewhere, teams }) });
    }
  }
  const shown = out.filter((row) => row.standing.phases.length);
  return orderBooks(
    shown.map((row) => ({ ...row, fraction: row.standing.fraction, started: row.standing.started })),
    { projectOrder: priority.projectOrder, paused: [...paused] },
  ).map(({ fraction: _f, started: _s, ...row }) => row);
}
