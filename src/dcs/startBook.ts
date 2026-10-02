import type { DcsTeam } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { assignOrgTeamToTask, commentOnIssue, listProjectIssues, loadPmConfig, publishWorkOrders } from "./issues";
import { loadAssignmentsFromDcs, saveProjectToDcs } from "./persist";
import { bookName, normalizeProjectId } from "../domain/books";
import { issueTaskId } from "../domain/myTasks";
import { coordinatorsOf } from "../domain/levels";
import { firstPhaseTeams, inheritTeams, nextBookHint, phaseTeams, phasesWithoutTeam, reachesNextBook, type NextBookHint } from "../domain/startBook";
import { emptyAssignments, mergePeople } from "../domain/store";
import type { AssignmentsDoc, InventoryDoc, WorkflowTemplate } from "../domain/types";
import { applyWorkflowToBoard } from "../domain/workflows";
import { generateInventory } from "../worker/client";

export type StartStage = "process" | "reading" | "saving" | "tasks";

export type StartedBook = { board: AssignmentsDoc; inventory: InventoryDoc; created: number };

/**
 * Start a book: apply the process, bring the teams of the last book done with it, read and divide the book, save
 * the project and lay out its subtareas. One action for the person; each stage is reported as it begins.
 */
export async function startBook(params: {
  session: GtSession;
  pmOrg: string;
  lang: string;
  contentOrg: string;
  book: string;
  template: WorkflowTemplate;
  /** Projects that already exist, newest first: the first one made with the same process lends its teams. */
  earlierProjects: string[];
  onStage: (stage: StartStage, detail?: string) => void;
}): Promise<StartedBook> {
  const { session, pmOrg, lang, contentOrg, template, onStage } = params;
  const book = normalizeProjectId(params.book);

  onStage("process");
  // People take the work themselves (nobody is handed a whole chapter); whoever coordinates can turn it off.
  const base: AssignmentsDoc = { ...emptyAssignments(book, lang, contentOrg, pmOrg), title: bookName(book), kind: "book", books: [book], settings: { allowSelfAssign: true } };
  let board = applyWorkflowToBoard(base, template);
  for (const id of params.earlierProjects) {
    if (normalizeProjectId(id) === book) continue;
    const earlier = await loadAssignmentsFromDcs(session, pmOrg, lang, id, contentOrg).catch(() => null);
    if (earlier && earlier.workflowId === board.workflowId && earlier.teams.some((task) => task.orgTeamName || task.orgTeamId || task.memberIds.length)) {
      board = inheritTeams(board, earlier);
      break;
    }
  }

  onStage("reading");
  const inventory = await generateInventory({ book, lang, contentOrg }, (message) => onStage("reading", message));
  if (!inventory.portions.length) throw new Error("No se encontraron porciones en el texto de origen de este libro.");

  onStage("saving");
  await saveProjectToDcs({ session, org: pmOrg, lang, book, assignments: board, inventory });

  onStage("tasks");
  const result = await publishWorkOrders({ session, org: pmOrg, board, inventory, onProgress: (p) => onStage("tasks", `${p.done} / ${p.total}`) });
  board = { ...board, settings: { ...board.settings, lastPublish: { at: new Date().toISOString(), created: result.created, updated: result.updated } } };
  await saveProjectToDcs({ session, org: pmOrg, lang, book, assignments: board, inventory });
  return { board, inventory, created: result.created };
}

/**
 * One team per phase: every task of the phase that has nobody gets the chosen team and its people, and the project
 * is saved. With `replace`, the tasks that already had a team get the chosen one too (changing who does a phase).
 * A task the team cannot take (it lacks a repository and it cannot be given) is left as it was and told.
 */
export async function setPhaseTeams(params: {
  session: GtSession;
  pmOrg: string;
  board: AssignmentsDoc;
  choice: Record<string, DcsTeam>;
  replace?: boolean;
}): Promise<{ board: AssignmentsDoc; warnings: string[] }> {
  const { session, pmOrg, choice } = params;
  const pmConfig = await loadPmConfig(session, pmOrg);
  const warnings = new Set<string>();
  let board = params.board;
  for (const phase of params.replace ? phaseTeams(board) : phasesWithoutTeam(board)) {
    const orgTeam = choice[phase.id];
    if (!orgTeam) continue;
    for (const task of phase.tasks) {
      try {
        const done = await assignOrgTeamToTask({ session, org: pmOrg, lang: board.lang, task, orgTeam, grantMissingRepos: true, pullMembers: true, pmConfig });
        for (const warning of done.warnings) warnings.add(warning);
        board = {
          ...board,
          people: mergePeople(board.people, done.memberLogins.map((login) => ({ id: login, name: login }))),
          teams: board.teams.map((row) => (row.id === task.id ? done.task : row)),
        };
      } catch (err) {
        warnings.add(err instanceof Error ? err.message : String(err));
      }
    }
  }
  if (board !== params.board) await saveProjectToDcs({ session, org: pmOrg, lang: board.lang, book: board.projectId, assignments: board, inventory: null });
  return { board, warnings: [...warnings] };
}

/**
 * Whether the next book should be started now: looks at the book started last and how far its first phase is.
 * `null` when it is not time yet, or when it cannot be told.
 */
export async function loadNextBookHint(params: { session: GtSession; pmOrg: string; lang: string; contentOrg: string; projects: string[] }): Promise<NextBookHint | null> {
  const { session, pmOrg, lang, contentOrg } = params;
  const boards = (await Promise.all(params.projects.map((id) => loadAssignmentsFromDcs(session, pmOrg, lang, id, contentOrg).catch(() => null)))).filter((board): board is AssignmentsDoc => Boolean(board?.workflowAppliedAt));
  const newest = boards.sort((a, b) => Date.parse(b.workflowAppliedAt!) - Date.parse(a.workflowAppliedAt!))[0];
  if (!newest) return null;
  const { issues } = await listProjectIssues(session, pmOrg, newest.projectId);
  return nextBookHint(newest, issues.map((issue) => ({ taskId: issueTaskId(issue), closed: issue.state === "closed" })));
}

/**
 * After a delivery: if it is the one that takes the first phase of the book past the mark, mention whoever
 * coordinates that phase in the conversation of the subtarea, so it reaches them as a notice. Best effort: a
 * delivery never fails because the notice could not be sent. Returns who was told.
 */
export async function notifyNextBook(params: { session: GtSession; pmOrg: string; board: AssignmentsDoc; issueNumber: number }): Promise<string[]> {
  const { session, pmOrg, board } = params;
  const { issues } = await listProjectIssues(session, pmOrg, board.projectId);
  const hint = reachesNextBook(board, issues.map((issue) => ({ taskId: issueTaskId(issue), closed: issue.state === "closed", number: issue.number })), params.issueNumber);
  if (!hint) return [];
  const config = await loadPmConfig(session, pmOrg);
  const who = [...new Set(firstPhaseTeams(board).flatMap((team) => coordinatorsOf(config, team)))];
  if (!who.length) return [];
  const book = bookName(board.projectId) || board.projectId;
  await commentOnIssue(session, pmOrg, params.issueNumber, `${who.map((login) => `@${login}`).join(" ")} ${hint.phase} de ${book} va en ${hint.done} de ${hint.total}. Conviene empezar ya el libro siguiente, para que el equipo lo encuentre listo al terminar este.`);
  return who;
}
