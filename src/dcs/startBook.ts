import { listTeamRepos, type DcsTeam } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { assignOrgTeamToTask, commentOnIssue, listProjectIssues, loadPmConfig, publishWorkOrders } from "./issues";
import { dcsConfig } from "./config";
import { listPmOrgTeams, loadAssignmentsFromDcs, saveProjectToDcs, teamCanEdit } from "./persist";
import { bookName, normalizeProjectId } from "../domain/books";
import { issueTaskId } from "../domain/myTasks";
import { coordinatorsOf } from "../domain/levels";
import { firstPhaseTeams, inheritTeams, nextBookHint, reachesNextBook, wasWithdrawn, type NextBookHint, type TeamOption } from "../domain/startBook";
import { isAppTeam, reposForTask } from "../domain/roles";
import { emptyAssignments, mergePeople } from "../domain/store";
import { portionStartsOfBook } from "../domain/extraWork";
import { tNow } from "../i18n/messages";
import type { AssignmentsDoc, InventoryDoc, ProjectTask, WorkflowTemplate } from "../domain/types";
import { applyWorkflowToBoard } from "../domain/workflows";
import { generateInventory } from "../worker/client";

export type StartStage = "process" | "reading" | "saving" | "tasks";

export type StartedBook = { board: AssignmentsDoc; inventory: InventoryDoc; created: number; warnings?: string[] };

/**
 * The project of a book before anything is written: the process applied (or nothing, to build it by hand), with the
 * teams of the last book done with the same process. What a person may still adjust before creating it.
 */
export async function draftBook(params: {
  session: GtSession;
  pmOrg: string;
  lang: string;
  contentOrg: string;
  book: string;
  /** Absent: a project built by hand, with no process behind it. */
  template?: WorkflowTemplate;
  /** Projects that already exist, newest first: the first one made with the same process lends its teams. */
  earlierProjects: string[];
}): Promise<AssignmentsDoc> {
  const { session, pmOrg, lang, contentOrg, template } = params;
  const book = normalizeProjectId(params.book);
  // People take the work themselves (nobody is handed a whole chapter); whoever coordinates can turn it off.
  const base: AssignmentsDoc = { ...emptyAssignments(book, lang, contentOrg, pmOrg), title: bookName(book), kind: "book", books: [book], settings: { allowSelfAssign: true } };
  if (!template) return base;
  let board = applyWorkflowToBoard(base, template);
  for (const id of params.earlierProjects) {
    if (normalizeProjectId(id) === book) continue;
    const earlier = await loadAssignmentsFromDcs(session, pmOrg, lang, id, contentOrg).catch(() => null);
    if (earlier && earlier.workflowId === board.workflowId && earlier.teams.some((task) => task.orgTeamName || task.orgTeamId || task.memberIds.length)) {
      board = inheritTeams(board, earlier);
      break;
    }
  }
  return board;
}

/** Read a book and divide it into portions, cut where the project says when it cut any by hand. */
export async function readBook(params: { book: string; lang: string; contentOrg: string; settings?: AssignmentsDoc["settings"] }, onProgress: (message: string) => void = () => undefined): Promise<InventoryDoc> {
  const book = normalizeProjectId(params.book);
  const inventory = await generateInventory({ book, lang: params.lang, contentOrg: params.contentOrg, portionStarts: portionStartsOfBook(params.settings, book) }, onProgress);
  if (!inventory.portions.length) throw new Error(tNow("sb.noPortions"));
  return inventory;
}

/**
 * Write a project that was only a draft: the teams its tasks name get their people (and the repositories they
 * lack), the project is saved and its subtareas are laid out. Until this runs, nothing of the project is in Door43.
 */
export async function createProject(params: {
  session: GtSession;
  pmOrg: string;
  board: AssignmentsDoc;
  inventory: InventoryDoc;
  onStage: (stage: StartStage, detail?: string) => void;
}): Promise<StartedBook> {
  const { session, pmOrg, inventory, onStage } = params;
  let board = params.board;
  const book = board.projectId;
  const lang = board.lang;

  onStage("saving");
  // A task that names a team but has nobody yet (the team came with the template, or was chosen in the draft).
  const warnings: string[] = [];
  const pending = board.teams.filter((task) => (task.orgTeamId || task.orgTeamName) && !task.memberIds.length);
  if (pending.length) {
    const teams = await listPmOrgTeams(session, pmOrg);
    const choice: Record<string, TeamOption> = {};
    for (const task of pending) {
      const team = teams.find((row) => (task.orgTeamId ? row.id === task.orgTeamId : row.name === task.orgTeamName));
      if (team) choice[task.id] = { id: team.id, name: team.name, description: team.description, canEdit: teamCanEdit(team), unitsMap: team.units_map, repos: [], allRepos: false };
    }
    const placed = await placeTaskTeams({ session, pmOrg, board, choice });
    board = placed.board;
    warnings.push(...placed.warnings);
  }
  await saveProjectToDcs({ session, org: pmOrg, lang, book, assignments: board, inventory });

  onStage("tasks");
  const result = await publishWorkOrders({ session, org: pmOrg, board, inventory, onProgress: (p) => onStage("tasks", `${p.done} / ${p.total}`) });
  board = { ...board, settings: { ...board.settings, lastPublish: { at: new Date().toISOString(), created: result.created, updated: result.updated } } };
  await saveProjectToDcs({ session, org: pmOrg, lang, book, assignments: board, inventory });
  return { board, inventory, created: result.created, warnings };
}

/**
 * Start a book in one action: apply the process, bring the teams of the last book done with it, read and divide the
 * book, save the project and lay out its subtareas. Each stage is reported as it begins.
 */
export async function startBook(params: {
  session: GtSession;
  pmOrg: string;
  lang: string;
  contentOrg: string;
  book: string;
  template: WorkflowTemplate;
  earlierProjects: string[];
  onStage: (stage: StartStage, detail?: string) => void;
}): Promise<StartedBook> {
  const { session, pmOrg, lang, contentOrg, onStage } = params;
  onStage("process");
  const board = await draftBook(params);
  onStage("reading");
  const inventory = await readBook({ book: params.book, lang, contentOrg, settings: board.settings }, (message) => onStage("reading", message));
  return createProject({ session, pmOrg, board, inventory, onStage });
}

export type TeamOptions = { teams: TeamOption[]; needs: (task: Pick<ProjectTask, "scope" | "rules">) => string[] };

/** The teams of the organization with what each may edit, and which repositories a task writes to. */
export async function loadTeamOptions(params: { session: GtSession; pmOrg: string; lang: string }): Promise<TeamOptions> {
  const { session, pmOrg, lang } = params;
  const config = dcsConfig(session.host);
  const [pmConfig, rows] = await Promise.all([loadPmConfig(session, pmOrg), listPmOrgTeams(session, pmOrg)]);
  const teams = await Promise.all(
    rows.map(async (team): Promise<TeamOption> => {
      const allRepos = Boolean((team as { includes_all_repositories?: boolean }).includes_all_repositories);
      // A team that cannot be read is shown as having nothing: choosing it says what it will be given.
      const repos = allRepos ? [] : await listTeamRepos(config, team.id, session.token, { limit: 100 }).then((list) => list.map((repo) => repo.name)).catch(() => []);
      return { id: team.id, name: team.name, description: team.description, canEdit: teamCanEdit(team), unitsMap: team.units_map, repos, allRepos, ...(isAppTeam(team.name, pmConfig) ? {} : { foreign: true }) };
    }),
  );
  return { teams, needs: (task) => reposForTask(task, lang, pmConfig) };
}

/**
 * Give each task its chosen team and its people (nothing is saved). A task the team cannot take (it lacks a
 * repository and it cannot be given) is left as it was and told.
 */
export async function placeTaskTeams(params: {
  session: GtSession;
  pmOrg: string;
  board: AssignmentsDoc;
  /** The team for each task, by task id. */
  choice: Record<string, TeamOption>;
}): Promise<{ board: AssignmentsDoc; warnings: string[] }> {
  const { session, pmOrg, choice } = params;
  const pmConfig = await loadPmConfig(session, pmOrg);
  const warnings = new Set<string>();
  let board = params.board;
  for (const task of params.board.teams) {
    const picked = choice[task.id];
    if (!picked) continue;
    try {
      const orgTeam: DcsTeam = { id: picked.id, name: picked.name, description: picked.description, permission: picked.canEdit ? "write" : "read" };
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
  return { board, warnings: [...warnings] };
}

/** {@link placeTaskTeams}, and the project saved with them. */
export async function setTaskTeams(params: { session: GtSession; pmOrg: string; board: AssignmentsDoc; choice: Record<string, TeamOption> }): Promise<{ board: AssignmentsDoc; warnings: string[] }> {
  const placed = await placeTaskTeams(params);
  if (placed.board !== params.board) await saveProjectToDcs({ session: params.session, org: params.pmOrg, lang: placed.board.lang, book: placed.board.projectId, assignments: placed.board, inventory: null });
  return placed;
}

/**
 * The subtareas that are work of the book: not the ones the plan withdrew (a passage cut otherwise), which are
 * closed with steps left undone. Counted, the first phase of a book of 29 subtareas read «va en 71 de 71».
 */
function bookWork<T extends { state?: string; body?: string | null }>(board: Pick<AssignmentsDoc, "teams">, issues: T[]): T[] {
  return issues.filter((issue) => !wasWithdrawn(issue, board.teams.find((task) => task.id === issueTaskId(issue as never))?.steps));
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
  return nextBookHint(newest, bookWork(newest, issues).map((issue) => ({ taskId: issueTaskId(issue), closed: issue.state === "closed" })));
}

/**
 * After a delivery: if it is the one that takes the first phase of the book past the mark, mention whoever
 * coordinates that phase in the conversation of the subtarea, so it reaches them as a notice. Best effort: a
 * delivery never fails because the notice could not be sent. Returns who was told.
 */
export async function notifyNextBook(params: { session: GtSession; pmOrg: string; board: AssignmentsDoc; issueNumber: number }): Promise<string[]> {
  const { session, pmOrg, board } = params;
  const { issues } = await listProjectIssues(session, pmOrg, board.projectId);
  const hint = reachesNextBook(board, bookWork(board, issues).map((issue) => ({ taskId: issueTaskId(issue), closed: issue.state === "closed", number: issue.number })), params.issueNumber);
  if (!hint) return [];
  const config = await loadPmConfig(session, pmOrg);
  const who = [...new Set(firstPhaseTeams(board).flatMap((team) => coordinatorsOf(config, team)))];
  if (!who.length) return [];
  const book = bookName(board.projectId) || board.projectId;
  await commentOnIssue(session, pmOrg, params.issueNumber, `${who.map((login) => `@${login}`).join(" ")} ${hint.phase} de ${book} va en ${hint.done} de ${hint.total}. Conviene empezar ya el libro siguiente, para que el equipo lo encuentre listo al terminar este.`);
  return who;
}
