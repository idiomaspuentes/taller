import type { DcsIssue } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { listProjectIssues, publishWorkOrders } from "./issues";
import { loadAssignmentsFromDcs, loadInventoryFromDcs, saveProjectToDcs } from "./persist";
import { portionKey } from "../domain/chapters";
import { extraItemId, extraWorkOrders } from "../domain/extraWork";
import { tasksToRedoAfter } from "../domain/processes";
import { mayProposeFrom, phaseHolding, portionOfVerse, redoRows, workStateOf, type TextCorrected } from "../domain/redoAfterCorrection";
import { issueTaskId } from "../domain/myTasks";
import { waitBlocks } from "../domain/waits";
import type { AssignmentsDoc } from "../domain/types";

export type RedoAsked = {
  /** The subtareas created, one for each task that had delivered its work on the corrected verses. */
  issues: DcsIssue[];
  /** The tasks they are of, by name, in the order of the plan. */
  asked: string[];
  /** The names of the tasks still at work on those verses: nothing was created for them. */
  open: string[];
};

/** What is said where the correction was decided: what has to be looked at again, and what is still under way. */
export function redoSaid(ref: string, asked: RedoAsked, say: (key: "redo.asked" | "redo.open") => string): string {
  const numbers = asked.issues.map((issue) => `#${issue.number}`).join(", ");
  return [
    asked.asked.length ? say("redo.asked").replace("{ref}", ref).replace("{tasks}", asked.asked.join(", ")).replace("{issues}", numbers) : "",
    asked.open.length ? say("redo.open").replace("{ref}", ref).replace("{tasks}", asked.open.join(", ")) : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * A text was corrected: every task the process names for it, that had already delivered its work on those verses,
 * gets a subtarea to look at them again (see `domain/redoAfterCorrection.ts`). The plan is read as it is now, and
 * the subtareas are published as the corrections of a committee are, so they survive a later publication of it.
 *
 * It is called once the correction is in the draft, and never undoes it: whoever calls it catches what it throws.
 */
export async function askRedoAfterCorrection(params: { session: GtSession; pmOrg: string; lang: string; projectId: string; contentOrg: string; corrected: TextCorrected }): Promise<RedoAsked> {
  const { session, pmOrg, lang, projectId, corrected } = params;
  const taskIds = tasksToRedoAfter(corrected.resource);
  if (!taskIds.length) return { issues: [], asked: [], open: [] };
  const [current, inventory, listed] = await Promise.all([loadAssignmentsFromDcs(session, pmOrg, lang, projectId, params.contentOrg), loadInventoryFromDcs(session, pmOrg, lang, projectId), listProjectIssues(session, pmOrg, projectId)]);
  if (!current || !inventory) throw new Error("No se pudo leer el plan del proyecto para pedir que se revise de nuevo.");
  const portionId = portionOfVerse(inventory.portions.map((portion) => ({ id: portionKey(portion), chapter: portion.chapter, verses: portion.verses })), corrected);
  const plan = redoRows(current, taskIds, corrected, portionId, (taskId) => workStateOf(taskId, listed.issues, current.settings, corrected, portionId));
  const named = (taskId: string) => current.teams.find((task) => task.id === taskId)?.name ?? taskId;
  const open = plan.open.map(named);
  if (!plan.added.length) return { issues: [], asked: [], open };
  const board: AssignmentsDoc = { ...current, settings: plan.settings };
  await saveProjectToDcs({ session, org: pmOrg, lang: board.lang, book: projectId, assignments: board, inventory: null });
  const wanted = new Set(plan.added.map((row) => extraItemId(row.id)));
  const orders = extraWorkOrders(board, inventory).filter((order) => order.itemIds.some((id) => wanted.has(id)));
  const result = await publishWorkOrders({ session, org: pmOrg, board, inventory, orders, retireOrphans: false, keepAssignees: true });
  return { issues: result.issues, asked: plan.added.map((row) => named(row.taskId)), open };
}

/**
 * The phase that holds a verse of a text, when the task that wants to propose a change to it is of a phase before
 * that one; `""` when it may propose. A task has begun its work on the verse when it delivered it, or has it open
 * and waits for nothing. What cannot be read holds nobody back: the rule is a courtesy between phases, and a
 * proposal is still decided by the team.
 */
export async function heldByLaterPhase(params: { session: GtSession; pmOrg: string; lang: string; projectId: string; contentOrg: string; fromTaskId: string; resource: string; chapter: number; verse: number }): Promise<string> {
  const { session, pmOrg, lang, projectId } = params;
  const taskIds = tasksToRedoAfter(params.resource);
  if (!taskIds.length || !lang || !projectId) return "";
  try {
    const [board, inventory, listed] = await Promise.all([loadAssignmentsFromDcs(session, pmOrg, lang, projectId, params.contentOrg), loadInventoryFromDcs(session, pmOrg, lang, projectId), listProjectIssues(session, pmOrg, projectId)]);
    if (!board || !inventory) return "";
    const corrected: TextCorrected = { resource: params.resource, chapter: params.chapter, from: params.verse, to: params.verse };
    const portionId = portionOfVerse(inventory.portions.map((portion) => ({ id: portionKey(portion), chapter: portion.chapter, verses: portion.verses })), corrected);
    const open = listed.issues.filter((issue) => (issue.state ?? "open").toLowerCase() !== "closed");
    const begun = (taskId: string) => {
      const state = workStateOf(taskId, listed.issues, board.settings, corrected, portionId);
      if (state !== "open") return state === "closed";
      // Open, and with nothing left to wait for: it is being worked on, or may be at any moment.
      return open.some((issue) => issueTaskId(issue) === taskId && workStateOf(taskId, [issue], board.settings, corrected, portionId) === "open" && waitBlocks(issue, board, open).length === 0);
    };
    const holding = phaseHolding(board, taskIds, begun);
    return mayProposeFrom(board, params.fromTaskId, holding) ? "" : (holding?.name ?? "");
  } catch {
    return "";
  }
}
