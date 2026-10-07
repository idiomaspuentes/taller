import { knownBranches, onlyExisting } from "./branchList";
import { createOrUpdateContents, DcsApiError, getRawContent } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import { isWriteRace, raceDelay, readRepoFile } from "./afinacionStore";
import { ensureBranchFrom, getDefaultBranch } from "./pulls";
import { withQuote } from "../domain/quoteFromSelection";
import { bookBranchName, bookOnlyBranchName, groupDraftBranchNames } from "../domain/portionPr";
import { draftReadOrder } from "../domain/branchNames";
import { applyHelpsTsvEdits } from "../domain/helpsDraft";
import { resolveHelpsTarget, type HelpsResource } from "../domain/helpsTarget";
import type { PmConfig } from "../domain/roles";
import type { SolverLaunchContext } from "../domain/solverLaunch";
import type { AssignmentsDoc } from "../domain/types";

/**
 * The branch that holds the team's own version of a resource: the group draft of the task that translates it (see
 * `draftReadOrder`). `null` when the team has no draft of it.
 */
export async function teamDraftBranch(params: { session: GtSession; owner: string; repo: string; book: string; teams: AssignmentsDoc["teams"]; resource: string }): Promise<string | null> {
  const { session, owner, repo } = params;
  const names = await knownBranches(dcsConfig(session.host), owner, repo, session.token);
  const candidates = [...new Set(draftReadOrder(params.teams, params.resource).flatMap((id) => groupDraftBranchNames(params.book.toUpperCase(), id)))];
  // The list could not be read: the draft of the task that translates is the one to try.
  return names ? (candidates.find((branch) => names.has(branch)) ?? null) : (candidates[0] ?? null);
}

/**
 * Corrections to rows of the team's notes or questions, by a task that works on the group draft (harmonizing,
 * validating): written straight onto that draft, over the file as it is at that moment, so a row somebody else
 * corrected meanwhile keeps what they wrote.
 */
export async function saveTeamHelpsRows(params: { session: GtSession; owner: string; repo: string; filepath: string; branch: string; edits: { id: string; fields: Record<string, string> }[]; message: string }): Promise<{ text: string; sha?: string }> {
  const { session, owner, repo, filepath, branch } = params;
  for (let attempt = 1; ; attempt++) {
    const current = await readRepoFile(session, { owner, repo, branch }, filepath);
    if (!current) throw new Error("No se encontró este archivo en las ayudas del equipo.");
    const content = applyHelpsTsvEdits(current.text, params.edits);
    if (content === current.text) return current;
    try {
      const saved = await createOrUpdateContents(dcsConfig(session.host), owner, repo, filepath, { content, message: params.message, sha: current.sha, branch, token: session.token });
      return { text: content, sha: saved.content?.sha };
    } catch (err) {
      if (!isWriteRace(err) || attempt === 3) throw err;
      await raceDelay(attempt);
    }
  }
}

/** The same for an article, which is a file of its own: written on the team's draft with the version it was read at. */
export async function saveTeamHelpsFile(params: { session: GtSession; owner: string; repo: string; filepath: string; branch: string; content: string; sha?: string; message: string }): Promise<{ sha?: string }> {
  const { session, owner, repo, filepath, branch } = params;
  const saved = await createOrUpdateContents(dcsConfig(session.host), owner, repo, filepath, { content: params.content, message: params.message, sha: params.sha, branch, token: session.token });
  return { sha: saved.content?.sha };
}

/**
 * The team's own version of a helps file (its translated notes or questions), as it stands now: the group draft
 * of the task that translates that resource (see `draftReadOrder`), or else what is already published.
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
  const branches: (string | undefined)[] = [
    ...new Set(draftReadOrder(board?.teams, kind).flatMap((id) => groupDraftBranchNames(book, id))),
    bookOnlyBranchName(book),
    undefined,
  ];
  const config = dcsConfig(session.host);
  const names = await knownBranches(config, helps.owner, helps.repo, session.token);
  for (const branch of onlyExisting(branches, names)) {
    try {
      const text = await getRawContent(config, helps.owner, helps.repo, helps.filepath, { token: session.token, ...(branch ? { ref: branch } : {}) });
      if (text.trim()) return { text, branch };
    } catch {
      /* not on this branch: try the next one */
    }
  }
  return null;
}

/**
 * Replace the quote of one note in the team's notes. It is written on the group draft of the notes work (the branch
 * is started from the published one when the team has not worked on the notes of this book yet).
 */
export async function saveNoteQuote(params: {
  session: GtSession;
  ctx: SolverLaunchContext;
  pmConfig: PmConfig;
  board: AssignmentsDoc | null;
  noteId: string;
  quote: string;
  occurrence: number;
}): Promise<void> {
  const { session, ctx, board } = params;
  const helps = resolveHelpsTarget({ ...ctx, resource: "notas" }, params.pmConfig);
  if ("error" in helps || !helps.filepath) throw new Error("error" in helps ? helps.error : "No hay archivo de notas para este libro.");
  const book = (ctx.book || ctx.projectId || "").toUpperCase();
  const config = dcsConfig(session.host);
  const own = await readTeamHelps({ session, ctx, pmConfig: params.pmConfig, board, kind: "notas" });
  let branch = own?.branch;
  if (!branch) {
    const task = (board?.teams ?? []).find((t) => t.rules.some((rule) => rule.resource === "notas"));
    if (!task) throw new Error("Este proyecto no tiene una tarea que trabaje las notas.");
    branch = bookBranchName(book, task.id);
    await ensureBranchFrom(config, helps.owner, helps.repo, branch, session.token, await getDefaultBranch(config, helps.owner, helps.repo, session.token));
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const current = await readRepoFile(session, { owner: helps.owner, repo: helps.repo, branch }, helps.filepath);
    const next = current ? withQuote(current.text, params.noteId, params.quote, params.occurrence) : null;
    if (!current || next === null) throw new Error("No se encontró esa nota en las notas del equipo.");
    try {
      await createOrUpdateContents(config, helps.owner, helps.repo, helps.filepath, { content: next, message: `Taller: cita de la nota ${params.noteId} (${book})`, sha: current.sha, branch, token: session.token });
      return;
    } catch (err) {
      if (!(err instanceof DcsApiError && (err.status === 409 || err.status === 422)) || attempt === 3) throw err;
    }
  }
}
