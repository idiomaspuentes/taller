import { getRawContent } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import { bookBranchName, bookOnlyBranchName, taskTrunkBranchName } from "../domain/portionPr";
import { resolveHelpsTarget, type HelpsResource } from "../domain/helpsTarget";
import type { PmConfig } from "../domain/roles";
import type { SolverLaunchContext } from "../domain/solverLaunch";
import type { AssignmentsDoc } from "../domain/types";

/**
 * The team's own version of a helps file (its translated notes or questions), as it stands now: the group draft
 * of the tasks that work on that resource, latest task of the process first, or else what is already published.
 * `null` when the team has none yet, so the caller can fall back to the source language.
 */
export async function readTeamHelps(params: {
  session: GtSession;
  ctx: SolverLaunchContext;
  pmConfig: PmConfig;
  board: AssignmentsDoc | null;
  kind: HelpsResource;
}): Promise<{ text: string; branch?: string } | null> {
  const { session, ctx, board, kind } = params;
  const helps = resolveHelpsTarget({ ...ctx, resource: kind }, params.pmConfig);
  if ("error" in helps || !helps.filepath) return null;
  const book = (ctx.book || ctx.projectId || "").toUpperCase();
  const tasks = (board?.teams ?? []).filter((task) => task.rules.some((rule) => rule.resource === kind)).reverse();
  const branches: (string | undefined)[] = [
    ...new Set(tasks.flatMap((task) => [bookBranchName(book, task.id), taskTrunkBranchName(book, task.id)])),
    bookOnlyBranchName(book),
    undefined,
  ];
  const config = dcsConfig(session.host);
  for (const branch of branches) {
    try {
      const text = await getRawContent(config, helps.owner, helps.repo, helps.filepath, { token: session.token, ...(branch ? { ref: branch } : {}) });
      if (text.trim()) return { text, branch };
    } catch {
      /* not on this branch: try the next one */
    }
  }
  return null;
}
