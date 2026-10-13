import { editIssue } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import { listProjectIssues } from "./issues";
import { parseTaskProgressMarker, upsertTaskProgressInBody } from "../domain/taskProgress";
import { PM_REPO_NAME, type AssignmentsDoc, type InventoryDoc } from "../domain/types";
import { parseWorkOrderMarker } from "../domain/workOrder";

/**
 * A team that comes to this app in the middle of a book did part of it somewhere else. Its project is laid out
 * whole, as for any book, and the subtareas of what was already done are closed with every step done, so that the
 * book shows where the team really is and what waits for that work can start.
 *
 * Closed here without the notices of a delivery: nobody delivered anything today, and a book brought this way
 * closes hundreds of subtareas at once.
 */

export type Portion = InventoryDoc["portions"][number];

export type DeliveredElsewhere = { closed: number; alreadyClosed: number; left: number; byTask: Record<string, { closed: number; left: number }> };

export async function closeDeliveredElsewhere(params: {
  session: GtSession;
  org: string;
  board: AssignmentsDoc;
  inventory: InventoryDoc;
  /** Whether the work of a task on a portion was done before coming here. A subtarea of several portions needs them all. */
  delivered: (taskId: string, portion: Portion) => boolean;
  /** Count only. */
  dryRun?: boolean;
  onProgress?: (done: number, total: number) => void;
}): Promise<DeliveredElsewhere> {
  const { session, org, board, inventory } = params;
  const portions = new Map(inventory.portions.map((portion) => [portion.id, portion]));
  const { issues } = await listProjectIssues(session, org, board.projectId);
  const out: DeliveredElsewhere = { closed: 0, alreadyClosed: 0, left: 0, byTask: {} };
  const todo: { number: number; body: string }[] = [];
  for (const issue of issues) {
    const order = parseWorkOrderMarker(issue.body ?? "");
    const task = order && board.teams.find((row) => row.id === order.teamId);
    if (!order || !task) continue;
    const row = (out.byTask[task.id] ??= { closed: 0, left: 0 });
    const mine = order.portionIds.map((id) => portions.get(id));
    const done = mine.length > 0 && mine.every((portion) => portion && params.delivered(task.id, portion));
    if (!done) {
      if ((issue.state ?? "").toLowerCase() !== "closed") {
        row.left++;
        out.left++;
      }
      continue;
    }
    if ((issue.state ?? "").toLowerCase() === "closed") {
      out.alreadyClosed++;
      continue;
    }
    row.closed++;
    out.closed++;
    // Every step done: a subtarea closed with steps left is read as withdrawn from the plan, not as delivered.
    const steps = (task.steps ?? []).map((step) => step.id);
    const had = parseTaskProgressMarker(issue.body ?? "");
    todo.push({ number: issue.number, body: upsertTaskProgressInBody(issue.body ?? "", { ...had, doneStepIds: [...new Set([...had.doneStepIds, ...steps])] }) });
  }
  if (params.dryRun) return out;
  const config = dcsConfig(session.host);
  let at = 0;
  for (let i = 0; i < todo.length; i += 6) {
    await Promise.all(todo.slice(i, i + 6).map((row) => editIssue(config, org, PM_REPO_NAME, row.number, { token: session.token, body: row.body, state: "closed" })));
    at = Math.min(todo.length, i + 6);
    params.onProgress?.(at, todo.length);
  }
  return out;
}
