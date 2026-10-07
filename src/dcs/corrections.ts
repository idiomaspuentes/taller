import type { DcsIssue } from "@ip-lms/dcs-client";
import { correctionRows, portionOfAsk, type CorrectionAsk } from "../domain/corrections";
import { extraItemId, extraWorkOrders } from "../domain/extraWork";
import type { AssignmentsDoc, ProjectTask } from "../domain/types";
import type { GtSession } from "./auth";
import { publishWorkOrders } from "./issues";
import { loadInventoryFromDcs, saveProjectToDcs } from "./persist";

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
}): Promise<DcsIssue[]> {
  const { session, pmOrg } = params;
  const projectId = params.board.projectId || params.board.book;
  const inventory = await loadInventoryFromDcs(session, pmOrg, params.board.lang, projectId);
  if (!inventory) throw new Error("No se pudo leer el inventario del proyecto para crear las correcciones.");
  const unit = inventory.portions.filter((portion) => params.portionIds?.includes(portion.id));
  const { settings, added } = correctionRows(params.board, params.from, params.asks, (ask) => portionOfAsk(ask, unit) ?? params.portionIds?.[0]);
  if (!added.length) return [];
  const board: AssignmentsDoc = { ...params.board, settings };
  await saveProjectToDcs({ session, org: pmOrg, lang: board.lang, book: projectId, assignments: board, inventory: null });
  const wanted = new Set(added.map((row) => extraItemId(row.id)));
  const orders = extraWorkOrders(board, inventory).filter((order) => order.itemIds.some((id) => wanted.has(id)));
  const result = await publishWorkOrders({ session, org: pmOrg, board, inventory, orders, retireOrphans: false, keepAssignees: true });
  return result.issues;
}
