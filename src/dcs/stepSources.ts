import type { DcsIssue } from "@ip-lms/dcs-client";
import { issueTaskId } from "../domain/myTasks";
import { projectFromMilestone } from "../domain/scope";
import { DEFAULT_SOLVERS_CATALOG, findSolverApp } from "../domain/solvers";
import { resolveSourcePackage } from "../domain/sourcePackage";
import { sourceFilesFor, sourceKindsFor, type SourceStamp } from "../domain/sourceVersions";
import { withStepSources, type TaskProgressMarker } from "../domain/taskProgress";
import { parseWorkOrderMarker } from "../domain/workOrder";
import type { GtSession } from "./auth";
import { rememberedBoard } from "./notices";
import { stampSources } from "./sourceVersions";

/** A step is closed all the same when Door43 is slow to say what its sources are: it waits this long and no more. */
const WAIT_MS = 4000;

/**
 * The steps that are being closed, each with the version of the sources its work was done against (see
 * `domain/sourceVersions`). What a step is done against is said by its subtarea (its book, its articles, the
 * resource it works on) and by the tool that does it, when that reads more than the text being translated.
 *
 * It never fails and never holds a step back: without the plan in hand, or without an answer in time, the step is
 * closed with no sources noted, which says nothing rather than something false.
 */
export async function withSourcesNoted(session: GtSession, org: string, issue: DcsIssue, marker: TaskProgressMarker, closed: string[]): Promise<TaskProgressMarker> {
  try {
    const projectId = projectFromMilestone(issue.milestone?.title);
    const board = projectId ? rememberedBoard(session, org, projectId) : undefined;
    const order = parseWorkOrderMarker(issue.body ?? undefined);
    const task = board?.teams.find((row) => row.id === (order?.teamId || issueTaskId(issue)));
    if (!board || !order || !task) return marker;
    const resources = order.resource === "bundle" ? task.rules.map((rule) => String(rule.resource)) : [order.resource];
    const articles = order.itemIds.filter((id) => id.startsWith("articulo:")).map((id) => id.slice("articulo:".length));
    let next = marker;
    for (const stepId of closed) {
      const step = task.steps?.find((row) => row.id === stepId);
      const declared = findSolverApp(DEFAULT_SOLVERS_CATALOG, step?.solverAppId)?.sources;
      const kinds = [...new Set(resources.flatMap((resource) => sourceKindsFor(resource, declared)))];
      const files = sourceFilesFor({ kinds, pkg: resolveSourcePackage(board.settings), book: order.book, articles });
      if (!files.length) continue;
      const stamps = await Promise.race([stampSources(session, files), new Promise<SourceStamp[]>((resolve) => setTimeout(() => resolve([]), WAIT_MS))]);
      next = withStepSources(next, stepId, stamps);
    }
    return next;
  } catch {
    return marker;
  }
}
