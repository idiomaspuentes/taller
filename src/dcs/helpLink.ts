import type { GtSession } from "./auth";
import { loadSolversCatalog } from "./issues";
import { loadAssignmentsFromDcs } from "./persist";
import { getPmIssue } from "./portionPr";
import type { HelpLink } from "../domain/helpLink";
import { issueTaskId } from "../domain/myTasks";
import { buildSolverLaunchContext, resolveSolverLaunchUrl, solverLaunchBlockReason } from "../domain/solverLaunch";
import { DEFAULT_SOLVERS_CATALOG, findSolverApp, isUrlSolver, resolveSolverForIssue } from "../domain/solvers";

/**
 * Where a short link to a help leads (see `helpLink.ts`): the tool of its step, for whoever opens it, on that help.
 * The subtarea and the project are read as opening any step of it from «Mis tareas» does. Throws `missing` when the
 * subtarea, its step or the step's tool is not there.
 */
export async function resolveHelpLink(session: GtSession, link: HelpLink, space: { lang: string; contentOrg: string }): Promise<string> {
  const [issue, board, catalog] = await Promise.all([
    getPmIssue(session, link.org, link.issue),
    loadAssignmentsFromDcs(session, link.org, space.lang, link.project, space.contentOrg),
    loadSolversCatalog(session, link.org).catch(() => DEFAULT_SOLVERS_CATALOG),
  ]);
  const step = board?.teams.find((task) => task.id === issueTaskId(issue))?.steps?.find((s) => s.id === link.step);
  if (!board || !step) throw new Error("missing");
  const app = findSolverApp(catalog, step.solverAppId) ?? resolveSolverForIssue(catalog, board, issue);
  if (!app || isUrlSolver(app)) throw new Error("missing");
  const ctx = buildSolverLaunchContext({ username: session.username, lang: space.lang, pmOrg: link.org, contentOrg: space.contentOrg, board, issue, stepId: step.id, stepName: step.name });
  if (!ctx || solverLaunchBlockReason(app, ctx)) throw new Error("missing");
  const url = resolveSolverLaunchUrl(app, ctx);
  return `${url}${url.includes("?") ? "&" : "?"}item=${encodeURIComponent(link.item)}`;
}
