import type { DcsIssue } from "@ip-lms/dcs-client";
import { correctionAsked, correctionRows, portionOfAsk, type CorrectionAsk } from "../domain/corrections";
import { extraItemId, extraWorkOrders } from "../domain/extraWork";
import type { AssignmentsDoc, ProjectSettings, ProjectTask } from "../domain/types";
import { parseWorkOrderMarker } from "../domain/workOrder";
import type { GtSession } from "./auth";
import { listProjectIssues, publishWorkOrders } from "./issues";
import { loadAssignmentsFromDcs, loadInventoryFromDcs, saveProjectToDcs } from "./persist";

/**
 * The plan as it is now, and not as the screen that asks read it on opening. A second correction asked from the
 * same screen was added to a plan that did not have the first, and saving it took the first out: its subtarea
 * stayed, to be retired the next time the plan was published.
 */
async function planNow(session: GtSession, pmOrg: string, inHand: AssignmentsDoc): Promise<AssignmentsDoc> {
  return (await loadAssignmentsFromDcs(session, pmOrg, inHand.lang, inHand.projectId || inHand.book, inHand.contentOrg ?? "")) ?? inHand;
}

/**
 * What a committee did not endorse goes back as work: one subtarea of correction for each concern, in the task that
 * maintains what the concern is about (the text goes back to whoever refined it, a help to whoever harmonized it).
 * The plan keeps them as subtareas added by hand, so they are published like any other and survive a later
 * publication of the plan. Returns the subtareas created.
 */
export async function createCorrections(params: {
  session: GtSession;
  pmOrg: string;
  board: AssignmentsDoc;
  /** The task that asks (the committee's): corrections go to the tasks before it. */
  from: ProjectTask;
  asks: CorrectionAsk[];
  /** The passages the unit covers, so the tools of the correcting task open on the one each concern is about. */
  portionIds?: string[];
  /** The subtarea of the committee: each correction says there what came of it. */
  askedIn?: number;
}): Promise<{ issues: DcsIssue[]; settings: ProjectSettings }> {
  const { session, pmOrg } = params;
  const projectId = params.board.projectId || params.board.book;
  const inventory = await loadInventoryFromDcs(session, pmOrg, params.board.lang, projectId);
  if (!inventory) throw new Error("No se pudo leer el inventario del proyecto para crear las correcciones.");
  const unit = inventory.portions.filter((portion) => params.portionIds?.includes(portion.id));
  const current = await planNow(session, pmOrg, params.board);
  const { settings, added } = correctionRows(current, params.from, params.asks, (ask) => portionOfAsk(ask, unit) ?? params.portionIds?.[0], params.askedIn);
  if (!added.length) return { issues: [], settings };
  const board: AssignmentsDoc = { ...current, settings };
  await saveProjectToDcs({ session, org: pmOrg, lang: board.lang, book: projectId, assignments: board, inventory: null });
  const wanted = new Set(added.map((row) => extraItemId(row.id)));
  const orders = extraWorkOrders(board, inventory).filter((order) => order.itemIds.some((id) => wanted.has(id)));
  const result = await publishWorkOrders({ session, org: pmOrg, board, inventory, orders, retireOrphans: false, keepAssignees: true });
  return { issues: result.issues, settings };
}

/**
 * The subtarea of a correction that was already asked (the same words, of the same task), open or closed. For
 * whoever asks it again because nothing told them it had been: somebody else asked it a moment ago, or the row that
 * says so could not be saved.
 */
export async function correctionSubtask(params: { session: GtSession; pmOrg: string; board: AssignmentsDoc; from: ProjectTask; ask: CorrectionAsk }): Promise<DcsIssue | null> {
  const { session, pmOrg } = params;
  const row = correctionAsked(await planNow(session, pmOrg, params.board), params.from, params.ask);
  if (!row) return null;
  const { issues } = await listProjectIssues(session, pmOrg, params.board.projectId || params.board.book);
  return issues.find((issue) => parseWorkOrderMarker(issue.body)?.itemIds.includes(extraItemId(row.id))) ?? null;
}
