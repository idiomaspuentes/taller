/**
 * Saving a project that already exists after its plan or its subtareas changed: the teams that changed get their
 * people, the project is written, and its subtareas are brought in line with it (new ones created, the ones the plan
 * no longer has closed). Whoever already took a subtarea keeps it.
 */
import { useCallback, useEffect, useState } from "react";
import type { DcsIssue } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { listProjectIssues, publishWorkOrders } from "./issues";
import { listPmOrgTeams, saveProjectToDcs, teamCanEdit } from "./persist";
import { placeTaskTeams } from "./startBook";
import { issueTaskId } from "../domain/myTasks";
import type { TeamOption } from "../domain/startBook";
import type { AssignmentsDoc, InventoryDoc } from "../domain/types";
import { parseWorkOrderMarker, publishableWorkOrders, workIdentity, type WorkOrder } from "../domain/workOrder";

export type SavedProject = { board: AssignmentsDoc; created: number; closed: number; warnings: string[]; published: boolean };

/** Whether the subtareas a project lays out differ between two versions of it (which ones, or how they are titled). */
export function workChanged(before: AssignmentsDoc, after: AssignmentsDoc, inventory: InventoryDoc): boolean {
  const sign = (board: AssignmentsDoc) =>
    publishableWorkOrders(board, inventory)
      .map((order) => `${order.key}\u0000${order.label}`)
      .sort()
      .join("\u0001");
  return sign(before) !== sign(after);
}

export async function saveProjectChanges(params: {
  session: GtSession;
  pmOrg: string;
  before: AssignmentsDoc;
  after: AssignmentsDoc;
  /** Absent: the project is saved, and its subtareas are left as they are. */
  inventory: InventoryDoc | null;
  /** Bring the subtareas in line even if the plan did not change them: something the plan has is missing in Door43. */
  relay?: boolean;
  onProgress?: (done: number, total: number) => void;
}): Promise<SavedProject> {
  const { session, pmOrg, before, inventory } = params;
  let board = params.after;
  const warnings: string[] = [];

  const was = new Map(before.teams.map((task) => [task.id, task.orgTeamName ?? ""]));
  const moved = board.teams.filter((task) => task.orgTeamName && (was.get(task.id) !== task.orgTeamName || !task.memberIds.length));
  if (moved.length) {
    const teams = await listPmOrgTeams(session, pmOrg);
    const choice: Record<string, TeamOption> = {};
    for (const task of moved) {
      const team = teams.find((row) => (task.orgTeamId ? row.id === task.orgTeamId : row.name === task.orgTeamName));
      if (team) choice[task.id] = { id: team.id, name: team.name, description: team.description, canEdit: teamCanEdit(team), unitsMap: team.units_map, repos: [], allRepos: false };
    }
    const placed = await placeTaskTeams({ session, pmOrg, board, choice });
    board = placed.board;
    warnings.push(...placed.warnings);
  }

  await saveProjectToDcs({ session, org: pmOrg, lang: board.lang, book: board.projectId, assignments: board, inventory: null });
  if (!inventory || !(params.relay || workChanged(before, board, inventory))) return { board, created: 0, closed: 0, warnings, published: false };

  const result = await publishWorkOrders({ session, org: pmOrg, board, inventory, keepAssignees: true, onProgress: (p) => params.onProgress?.(p.done, p.total) });
  board = { ...board, settings: { ...board.settings, lastPublish: { at: new Date().toISOString(), created: result.created, updated: result.updated } } };
  await saveProjectToDcs({ session, org: pmOrg, lang: board.lang, book: board.projectId, assignments: board, inventory: null });
  return { board, created: result.created, closed: result.closed, warnings, published: true };
}

/** The subtareas a project has in Door43, with how many each task has and which one answers to a work order. */
export function useProjectWork(session: GtSession | null, pmOrg: string, projectId: string) {
  const [issues, setIssues] = useState<DcsIssue[] | null>(null);
  const reload = useCallback(async () => {
    if (!session || !pmOrg || !projectId) return;
    try {
      setIssues((await listProjectIssues(session, pmOrg, projectId)).issues);
    } catch {
      setIssues([]);
    }
  }, [session, pmOrg, projectId]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const byTask = new Map<string, number>();
  const byKey = new Map<string, DcsIssue>();
  const byIdentity = new Map<string, DcsIssue>();
  for (const issue of issues ?? []) {
    const marker = parseWorkOrderMarker(issue.body);
    if (!marker) continue;
    const taskId = issueTaskId(issue);
    byTask.set(taskId, (byTask.get(taskId) ?? 0) + 1);
    byKey.set(marker.key, issue);
    const identity = workIdentity(marker.teamId, marker.itemIds);
    if (identity && !byIdentity.has(identity)) byIdentity.set(identity, issue);
  }
  return {
    loaded: issues !== null,
    total: issues?.length ?? 0,
    workOf: (taskId: string) => byTask.get(taskId) ?? 0,
    issueOf: (order: Pick<WorkOrder, "key" | "teamId" | "itemIds">) => byKey.get(order.key) ?? byIdentity.get(workIdentity(order.teamId, order.itemIds) ?? ""),
    reload,
  };
}
