/**
 * DCS side of «Pasar al borrador principal» (gestor only). Reads the task's
 * borrador grupal and the repo default branch, splices only the task's
 * verses (`passIntoPrincipal`) and writes one Contents API commit. Never
 * merges a PR, never creates refs, never touches releases.
 */
import { createOrUpdateContents, DcsApiError, type DcsIssue } from "@ip-lms/dcs-client";
import { PM_REPO_NAME, type AssignmentsDoc, type PrincipalPassMark, type ScopeKey } from "../domain/types";
import { canManageOrg, resolveResourceRepo } from "../domain/roles";
import { resolveTaskPhaseSlug } from "../domain/phaseSlug";
import { buildPrIndex, contentReposOf, mapCommentToIssue, type RepoRef } from "../domain/notificationMap";
import {
  clearStoredPrincipalPasses,
  dropPrincipalPassesFor,
  isScriptureIssue,
  isVerseDecisionComment,
  issuesOfTask,
  passTaskIntoPrincipal,
  previewPrincipalReview,
  principalPassCommitMessage,
  principalPassGate,
  rangeLabel,
  type PassDecisionComment,
  type PrincipalPassGate,
  type PrincipalPassIo,
  type PrincipalPassJob,
  type PrincipalPassRun,
  type PrincipalReviewPreview,
} from "../domain/principalPass";
import { assignmentsPath, editLocalProjectSettings } from "../domain/store";
import { bookUsfmName } from "../prep/discover";
import type { GtSession } from "./auth";
import { listRepoComments } from "./comments";
import { dcsConfig } from "./config";
import { listProjectIssues, loadPmConfig } from "./issues";
import { resolveBookBranchName } from "./bookBootstrap";
import { getBranchSha, getDefaultBranch } from "./pulls";
import { BootstrapError, readRepoFile, writeRepoFile } from "./repoFile";

function status(err: unknown): number | undefined {
  const value = (err as { status?: unknown } | null)?.status;
  return typeof value === "number" ? value : undefined;
}

export async function loadPrincipalPassGate(params: {
  session: GtSession;
  pmOrg: string;
  projectId: string;
  book: string;
  taskId: string;
}): Promise<PrincipalPassGate> {
  const { issues, namespaceId } = await listProjectIssues(params.session, params.pmOrg, params.projectId);
  return principalPassGate({ issues, taskId: params.taskId, book: params.book, namespaceId });
}

export type PrincipalPassSummary = Pick<PrincipalPassRun, "written" | "already" | "replaced">;

type PassParams = {
  session: GtSession;
  pmOrg: string;
  lang: string;
  contentOrg: string;
  board: AssignmentsDoc;
  taskId: string;
};

/**
 * Review task only, read-only: which verses the pass would replace in the
 * borrador principal. Shown in the confirm dialog before anything is written.
 */
export async function loadPrincipalReviewPreview(params: PassParams): Promise<PrincipalReviewPreview[]> {
  const { jobs } = await buildPassJobs(params);
  return previewPrincipalReview(jobs);
}

/**
 * Resolves only after every target was written or already agreed; the
 * returned `mark` is what the caller saves in project settings.
 *
 * `confirmedReplace`: for a review task, the preview rows the gestor
 * confirmed. Ignored for a normal task (a differing verse aborts).
 */
export async function runPrincipalPass(
  params: PassParams & { confirmedReplace?: PrincipalReviewPreview[] },
): Promise<PrincipalPassRun> {
  const { session, pmOrg, board, taskId } = params;
  const { jobs, issues, namespaceId, task } = await buildPassJobs(params);
  if (task?.reviewsPrincipal) {
    for (const job of jobs) {
      job.confirmedReplace = params.confirmedReplace?.find((row) => row.resource === job.target.resource)?.replaced ?? [];
    }
  }
  const scripture = issuesOfTask({ issues, taskId, book: board.book, namespaceId }).filter(isScriptureIssue);
  return passTaskIntoPrincipal(jobs, {
    taskId,
    book: board.book,
    by: session.username,
    issues,
    namespaceId,
    loadDecisions: (since) => listDecisionComments({ session, pmOrg, scripture, since }),
  });
}

async function buildPassJobs(params: PassParams): Promise<{
  jobs: PrincipalPassJob[];
  issues: DcsIssue[];
  namespaceId: string;
  task: AssignmentsDoc["teams"][number] | undefined;
}> {
  const { session, pmOrg, lang, board, taskId } = params;
  const pmConfig = await loadPmConfig(session, pmOrg);
  if (!canManageOrg(session.teams ?? [], pmOrg, pmConfig.managerTeam)) {
    throw new Error("Solo un gestor puede pasar textos al borrador principal.");
  }
  const owner = (params.contentOrg || board.contentOrg || "").trim();
  if (!owner) throw new Error("Falta la organización de contenido del proyecto.");
  const task = board.teams.find((t) => t.id === taskId);
  const projectId = board.projectId || board.book;
  const { issues, namespaceId } = await listProjectIssues(session, pmOrg, projectId);
  const gate = principalPassGate({ issues, taskId, book: board.book, namespaceId });
  if (gate.blockReason) throw new Error(gate.blockReason);

  const config = dcsConfig(session.host);
  const phaseSlug = resolveTaskPhaseSlug(board, taskId);
  const jobs: PrincipalPassJob[] = [];

  for (const target of gate.targets) {
    const repo = resolveResourceRepo(target.resource as ScopeKey, lang, pmConfig);
    if (!repo) throw new Error(`No hay repositorio configurado para «${target.resource}».`);
    const filepath = bookUsfmName(target.book);
    const { bookBranch } = await resolveBookBranchName({
      session, owner, repo, book: target.book, taskId, phaseSlug, filepath,
    });
    const grupalSha = await getBranchSha(config, owner, repo, bookBranch, session.token);
    if (!grupalSha) {
      throw new Error(`No se encontró el borrador grupal de esta tarea en ${owner}/${repo}. No se cambió nada.`);
    }
    const principalBranch = await getDefaultBranch(config, owner, repo, session.token);
    const ref = { session, owner, repo, filepath };
    const label = `${target.book} ${target.ranges.map(rangeLabel).join(", ")}`;
    let commit: string | undefined;

    const io: PrincipalPassIo = {
      readPrincipal: async () => {
        try {
          const file = await readRepoFile({ ...ref, branch: principalBranch });
          return { text: file.text, sha: file.sha, serverAt: file.lastCommitAt };
        } catch (err) {
          if (status(err) === 404) {
            throw new Error(`El borrador principal no tiene «${filepath}». No se cambió nada.`);
          }
          throw err;
        }
      },
      readGrupal: async () => (await readRepoFile({ ...ref, branch: grupalSha })).text,
      write: async (content, sha) => {
        const saved = await writeRepoFile({
          ...ref,
          branch: principalBranch,
          content,
          sha,
          step: "principal-pass",
          message: principalPassCommitMessage({
            book: target.book,
            resource: target.resource,
            taskName: task?.name ?? "",
            taskId,
            verses: target.ranges,
            by: session.username,
            issues: target.issues,
            grupalRef: bookBranch,
            grupalSha,
          }),
        });
        commit = saved.commitSha;
        return { serverAt: saved.commitAt };
      },
      isShaConflict: (err) => err instanceof BootstrapError && (err.status === 409 || err.status === 422),
    };
    jobs.push({ io, target, label, lastCommit: () => commit });
  }
  return { jobs, issues, namespaceId, task };
}

const DECISION_PAGES = 20;
const DECISION_PAGE_SIZE = 50;

/**
 * Verse-decision comments written since the oldest pass mark, on the PM
 * issues and on the PRs of the marked tasks' scripture subtareas. Read-only.
 * Throws when a repo cannot be read or the list may be cut short, so the
 * release gate never passes on partial data.
 */
export async function loadPassDecisionComments(params: {
  session: GtSession;
  pmOrg: string;
  issues: DcsIssue[];
  namespaceId?: string;
  marks: PrincipalPassMark[] | undefined;
}): Promise<PassDecisionComment[]> {
  const { session, pmOrg, issues } = params;
  const marks = params.marks ?? [];
  if (!marks.length) return [];
  const times = marks.map((m) => (m.serverAt ? Date.parse(m.serverAt) : NaN)).filter(Number.isFinite);
  if (!times.length) return [];
  const since = new Date(Math.min(...times)).toISOString();
  const scripture = marks.flatMap((m) =>
    issuesOfTask({ issues, taskId: m.taskId, book: m.book, namespaceId: params.namespaceId }).filter(isScriptureIssue),
  );
  return listDecisionComments({ session, pmOrg, scripture, since });
}

/** Verse-decision comments on these scripture subtareas (PM issues and their PRs) since `since`. */
async function listDecisionComments(params: {
  session: GtSession;
  pmOrg: string;
  scripture: DcsIssue[];
  since: string;
}): Promise<PassDecisionComment[]> {
  const { session, pmOrg, scripture, since } = params;
  const prIndex = buildPrIndex(scripture);
  const repos: RepoRef[] = [{ owner: pmOrg, repo: PM_REPO_NAME }, ...contentReposOf(scripture)];
  const out: PassDecisionComment[] = [];
  for (const ref of repos) {
    let rows;
    try {
      rows = await listRepoComments(session, ref.owner, ref.repo, { since, maxPages: DECISION_PAGES });
    } catch (err) {
      throw new Error(
        `No se pudieron leer las conversaciones de las subtareas: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (rows.length >= DECISION_PAGES * DECISION_PAGE_SIZE) {
      throw new Error("Hay demasiados comentarios nuevos en las subtareas para comprobarlos. Inténtalo más tarde.");
    }
    for (const row of rows) {
      if (!isVerseDecisionComment(row.body)) continue;
      const hit = mapCommentToIssue(row, ref, { pmOrg, prIndex });
      if (hit) out.push({ issue: hit.issue, createdAt: row.created_at, body: row.body });
    }
  }
  return out;
}

/**
 * After a verse conflict or a verse choice: drop the pass marks of the
 * touched subtareas from the stored plan and from this browser's copy, so
 * the list is not stale until the next board visit. Best effort: the
 * release gate re-checks the comments anyway.
 */
export async function clearPrincipalPassMarks(params: {
  session: GtSession;
  pmOrg: string;
  lang: string;
  projectId: string;
  issues: number[];
  taskIds?: string[];
}): Promise<boolean> {
  const { session, pmOrg, lang, projectId } = params;
  if (!lang || !projectId) return false;
  const touched = { issues: params.issues, taskIds: params.taskIds };
  editLocalProjectSettings(lang, projectId, (settings) => dropPrincipalPassesFor(settings, touched));
  const ref = { session, owner: pmOrg, repo: PM_REPO_NAME, filepath: assignmentsPath(lang, projectId) };
  return clearStoredPrincipalPasses(
    {
      read: async () => {
        try {
          return await readRepoFile(ref);
        } catch (err) {
          if (status(err) === 404) return null;
          throw err;
        }
      },
      write: async (text, sha) => {
        await createOrUpdateContents(dcsConfig(session.host), pmOrg, PM_REPO_NAME, ref.filepath, {
          content: text,
          message: `Quitar paso al borrador principal (${projectId})`,
          sha,
          token: session.token,
        });
      },
      isShaConflict: (err) => err instanceof DcsApiError && (err.status === 409 || err.status === 422),
    },
    touched,
  );
}

/** Friendly toast text; no internal names. */
export function principalPassToast(summary: PrincipalPassSummary): string {
  if (summary.written.length) {
    const also = summary.already.length ? ` (${summary.already.join("; ")} ya estaba)` : "";
    const review = summary.replaced?.length
      ? ` La revisión reemplazó ${summary.replaced.join("; ")}.`
      : "";
    return `Listo: ${summary.written.join("; ")} ya está en el borrador principal${also}.${review}`;
  }
  return `${summary.already.join("; ")} ya estaba en el borrador principal. No hizo falta cambiar nada.`;
}
