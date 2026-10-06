import type { GtSession } from "./auth";
import { loadSolversCatalog } from "./issues";
import { loadAssignmentsFromDcs } from "./persist";
import { getPmIssue } from "./portionPr";
import { issueTaskId } from "../domain/myTasks";
import { nextStepOfMine } from "../domain/myTasksBoard";
import { isLabLaunch } from "../domain/solverLab";
import { buildSolverLaunchContext, openSolverApp, solverLaunchBlockReason, type SolverLaunchContext } from "../domain/solverLaunch";
import { DEFAULT_SOLVERS_CATALOG, findSolverApp, isUrlSolver, resolveSolverForIssue, type SolverApp } from "../domain/solvers";
import type { TaskStep } from "../domain/types";

export type NextStepLaunch = { app: SolverApp; ctx: SolverLaunchContext; step: TaskStep };

/**
 * What to open after a step was completed from its tool: the step that follows in the same subtarea, when it is
 * this same person's to do right away and has a tool of the app. The subtarea is read again, so the step just
 * completed counts. `null`: what follows is somebody else's, or is done outside the app, or nothing follows.
 */
export async function nextStepLaunch(session: GtSession, ctx: SolverLaunchContext): Promise<NextStepLaunch | null> {
  if (!ctx.issueNumber || !ctx.stepId || !ctx.pmOrg || isLabLaunch(ctx)) return null;
  const [issue, board, catalog] = await Promise.all([
    getPmIssue(session, ctx.pmOrg, ctx.issueNumber),
    loadAssignmentsFromDcs(session, ctx.pmOrg, ctx.lang, ctx.projectId, ctx.contentOrg),
    loadSolversCatalog(session, ctx.pmOrg).catch(() => DEFAULT_SOLVERS_CATALOG),
  ]);
  if (!board) return null;
  const steps = board.teams.find((task) => task.id === issueTaskId(issue))?.steps ?? [];
  const step = nextStepOfMine(session.username, steps, issue);
  // The step the tool was opened for is not one to go on to: opening it again would never end.
  if (!step || step.id === ctx.stepId) return null;
  const app = findSolverApp(catalog, step.solverAppId) ?? resolveSolverForIssue(catalog, board, issue);
  // A tool outside the app opens in a window of its own, which a browser only lets a press do.
  if (!app || isUrlSolver(app)) return null;
  const launch = buildSolverLaunchContext({ username: session.username, lang: ctx.lang, pmOrg: ctx.pmOrg, contentOrg: ctx.contentOrg, board, issue, stepId: step.id, stepName: step.name });
  if (!launch || solverLaunchBlockReason(app, launch)) return null;
  return { app, ctx: launch, step };
}

/**
 * Where a tool goes once its step is completed: on to the next step when it is this person's (see `nextStepLaunch`),
 * and otherwise `back`, to their tasks. Going back every time left whoever had just studied a passage at the top of
 * the list, with the button to translate it on a card more than a screen down. Anything that fails here goes back:
 * the step is already saved.
 */
export async function goOnAfterStep(session: GtSession, ctx: SolverLaunchContext, back: () => void): Promise<void> {
  const next = await nextStepLaunch(session, ctx).catch(() => null);
  if (next) {
    try {
      openSolverApp(next.app, next.ctx);
      return;
    } catch {
      /* back to the tasks */
    }
  }
  back();
}
