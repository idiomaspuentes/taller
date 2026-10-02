import type { GtSession } from "./auth";
import { publishWorkOrders } from "./issues";
import { loadAssignmentsFromDcs, saveProjectToDcs } from "./persist";
import { bookName, normalizeProjectId } from "../domain/books";
import { inheritTeams } from "../domain/startBook";
import { emptyAssignments } from "../domain/store";
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
