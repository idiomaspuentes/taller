import type { DcsIssue } from "@ip-lms/dcs-client";
import { phaseClosedBy } from "../domain/phaseMarks";
import { groupDraftBranchNames } from "../domain/portionPr";
import { resolveResourceRepo } from "../domain/roles";
import { SCOPE_KEYS, type AssignmentsDoc, type ScopeKey } from "../domain/types";
import { issueProjectId } from "../domain/myTasks";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import { listProjectIssues, loadPmConfig } from "./issues";
import { ensurePhaseTag, getBranchSha } from "./pulls";

/**
 * After a subtarea closes: when it was the last one of its phase for its book, tag the group draft of each resource
 * of that phase with `fase/<book>/<phase>`. A phase that is opened again and closed again moves its tag. Returns the
 * repositories tagged (none when the phase is still open). It is a mark, not part of the delivery: whoever calls it
 * lets a failure pass.
 */
export async function markPhaseIfClosed(params: {
  session: GtSession;
  pmOrg: string;
  lang: string;
  contentOrg: string;
  board: AssignmentsDoc;
  issue: DcsIssue;
}): Promise<{ tag: string; repos: string[] } | null> {
  const { session, pmOrg, lang, board, issue } = params;
  const owner = (params.contentOrg || board.contentOrg || "").trim();
  const projectId = issueProjectId(issue) || board.projectId || board.book;
  if (!owner || !projectId) return null;
  const { issues } = await listProjectIssues(session, pmOrg, projectId);
  const phase = phaseClosedBy(board, issues, issue);
  if (!phase) return null;
  const pmConfig = await loadPmConfig(session, pmOrg);
  const config = dcsConfig(session.host);
  const repos: string[] = [];
  for (const draft of phase.drafts) {
    const resource = draft.resource.toLowerCase();
    if (!(SCOPE_KEYS as string[]).includes(resource)) continue;
    const repo = resolveResourceRepo(resource as ScopeKey, lang, pmConfig);
    if (!repo || repos.includes(`${owner}/${repo}`)) continue;
    try {
      let tip: string | null = null;
      for (const branch of groupDraftBranchNames(phase.book, draft.taskId)) {
        tip = await getBranchSha(config, owner, repo, branch, session.token);
        if (tip) break;
      }
      // A resource nobody has worked on in this book has no draft: nothing to mark.
      if (!tip) continue;
      await ensurePhaseTag(config, owner, repo, phase.tag, tip, session.token);
      repos.push(`${owner}/${repo}`);
    } catch {
      /* one repository without its mark does not stop the others */
    }
  }
  return { tag: phase.tag, repos };
}
