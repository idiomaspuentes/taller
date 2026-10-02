import {
  createIssueComment,
  DcsApiError,
  editIssue,
  getIssue,
  listIssueComments,
  type DcsIssue,
} from "@ip-lms/dcs-client";
import type { AssignmentsDoc, ScopeKey } from "../domain/types";
import { PM_REPO_NAME, SCOPE_KEYS } from "../domain/types";
import {
  archiveRefName,
  bookBranchName,
  bookCodeFromWorkHead,
  bookTrunkFromWorkHead,
  translatorLoginFromHead,
  trunkMergeCommitMessage,
  parsePortionPrMarker,
  portionPrApprovalReviewBody,
  portionPrBranchName,
  portionPrHeadMatchesWork,
  pullReviewNeedsSubmit,
  isOwnedWorkBranch,
  removePortionPrFromBody,
  upsertPortionPrInBody,
  type PortionMergeStatus,
  type PortionPrMarker,
} from "../domain/portionPr";
import type { VerseConflict } from "../domain/usfmVerseMerge";
import { patchTrunkByVerse } from "../domain/usfmTrunkPatch";
import { mergeIntoTrunkWithRetry } from "../domain/trunkMerge";
import {
  formatVerseConflictsComment,
  parseVerseConflictsComment,
  type VerseConflictsPayload,
} from "../domain/verseConflicts";
import { parseRefRange } from "../domain/usfmEdit";
import { resolveTaskPhaseSlug } from "../domain/phaseSlug";
import {
  buildSolverLaunchContext,
  refFromIssueTitle,
} from "../domain/solverLaunch";
import { resolveResourceRepo } from "../domain/roles";
import { bookUsfmName } from "../prep/discover";
import { dcsConfig } from "./config";
import type { GtSession } from "./auth";
import { loadPmConfig } from "./issues";
import { ensureBookUsfm, ensureTaskBranchFromBook, resolveBookBranchName } from "./bookBootstrap";
import { BootstrapError, readRepoFile, writeRepoFile } from "./repoFile";
import {
  branchExists,
  closePull,
  createPull,
  createPullReview,
  ensureArchiveRef,
  ensureBranchFrom,
  ensureBranchFromDefault,
  getBranchSha,
  getDefaultBranch,
  getPull,
  getPullByBranches,
  listPullFiles,
  mergePull,
  submitPullReview,
  type DcsPull,
  type DcsPullFile,
  type DcsPullReview,
} from "./pulls";

export type EnsurePortionPrParams = {
  session: GtSession;
  pmOrg: string;
  lang: string;
  contentOrg: string;
  board: AssignmentsDoc;
  issue: DcsIssue;
};

function markerFromPull(
  pull: DcsPull,
  owner: string,
  repo: string,
  issueNumber: number,
  fallbackHead: string,
  fallbackBase: string,
): PortionPrMarker {
  return {
    schema: "gateway-portion-pr-1",
    owner,
    repo,
    number: pull.number,
    htmlUrl: pull.html_url || "",
    head: pull.head?.ref || fallbackHead,
    base: pull.base?.ref || fallbackBase,
    issueNumber,
  };
}

async function writeMarkerOnIssue(
  session: GtSession,
  pmOrg: string,
  issue: DcsIssue,
  marker: PortionPrMarker,
): Promise<DcsIssue> {
  const body = upsertPortionPrInBody(issue.body, marker);
  if (body === (issue.body ?? "")) return issue;
  return editIssue(dcsConfig(session.host), pmOrg, PM_REPO_NAME, issue.number, {
    token: session.token,
    body,
  });
}

/**
 * Idempotent: reuse the issue marker, or the open PR for this branch pair,
 * otherwise create one PR for this subtarea and stamp the issue.
 */
async function unlinkPortionPrMarker(
  session: GtSession,
  pmOrg: string,
  issue: DcsIssue,
): Promise<DcsIssue> {
  const body = removePortionPrFromBody(issue.body);
  if (body === (issue.body ?? "")) return issue;
  return editIssue(dcsConfig(session.host), pmOrg, PM_REPO_NAME, issue.number, {
    token: session.token,
    body,
  });
}

export async function ensurePortionPr(
  params: EnsurePortionPrParams,
): Promise<{ marker: PortionPrMarker; issue: DcsIssue; created: boolean }> {
  const { session, pmOrg, lang, contentOrg, board } = params;
  let issue = params.issue;
  const existing = parsePortionPrMarker(issue.body);

  const ctx = buildSolverLaunchContext({
    username: session.username,
    lang,
    pmOrg,
    contentOrg,
    board,
    issue,
  });
  if (!ctx) {
    throw new Error("No se pudo armar el contexto de la subtarea para abrir la revisión.");
  }
  const pmConfig = await loadPmConfig(session, pmOrg);
  const owner = (contentOrg || ctx.contentOrg || "").trim();
  if (!owner) {
    throw new Error("Falta la organización de contenido para abrir la revisión de la subtarea.");
  }
  const resource = (ctx.resource || "").toLowerCase();
  if (!(SCOPE_KEYS as string[]).includes(resource)) {
    throw new Error(`Recurso «${resource || "—"}» no tiene repo de contenido.`);
  }
  const repo = resolveResourceRepo(resource as ScopeKey, lang, pmConfig);
  if (!repo) {
    throw new Error(
      `No hay repo configurado para «${resource}». Añade resourceRepos.${resource} en config.json.`,
    );
  }

  const config = dcsConfig(session.host);
  const book = ctx.book || ctx.projectId;
  const taskId = ctx.taskId;
  const phaseSlug = ctx.phaseSlug || resolveTaskPhaseSlug(board, ctx.taskId);
  const filepath = bookUsfmName(book);
  const resolved = await resolveBookBranchName({
    session, owner, repo, book, taskId, phaseSlug, filepath,
  });
  const bookBranch = resolved.bookBranch;
  // The work branch belongs to whoever has the subtarea, not to whoever asks: a reviewer who takes a step, or a
  // coordinator who delivers, must land on the author's review instead of opening one of their own.
  const author = issue.assignee?.login || issue.assignees?.[0]?.login || ctx.username || session.username;
  const head = portionPrBranchName({
    book,
    username: author,
    taskId,
    issueNumber: issue.number,
  });
  if (resource === "tpl" || resource === "tps") {
    await ensureBookUsfm({
      session,
      owner,
      repo,
      filepath,
      book,
      resource,
      taskId,
      phaseSlug,
    });
  } else {
    const defaultBranch = await getDefaultBranch(config, owner, repo, session.token);
    await ensureBranchFrom(config, owner, repo, bookBranch, session.token, defaultBranch);
  }
  const task = await ensureTaskBranchFromBook({
    session,
    owner,
    repo,
    book,
    resource,
    taskId,
    phaseSlug,
    filepath,
    taskBranch: head,
    username: author,
    issueNumber: issue.number,
  });
  const workHead = task.workBranch;
  const base = bookBranch;
  const owned = {
    book,
    username: author,
    taskId,
    issueNumber: issue.number,
  };

  if (existing) {
    const live = await portionPrMarkerIsLive(session, existing, workHead, owned);
    if (live) {
      return { marker: existing, issue, created: false };
    }
    issue = await unlinkPortionPrMarker(session, pmOrg, issue);
  }

  const found = await getPullByBranches(
    config,
    owner,
    repo,
    base,
    workHead,
    session.token,
  );
  let created = false;
  let pull = found;
  if (!pull) {
    pull = await createPull(config, owner, repo, {
      title: `${ctx.book} ${ctx.ref} · ${ctx.taskName || ctx.taskId} (#${issue.number})`,
      body: [
        `Subtarea PM: ${issue.html_url || `#${issue.number}`}`,
        "",
        `- Proyecto: **${ctx.projectId}**`,
        `- Tarea: **${ctx.taskName || ctx.taskId}**`,
        `- Recurso: **${ctx.resource || "—"}**`,
        `- Porción: **${ctx.ref}**`,
        "",
        "Un PR por subtarea. Se fusiona al **Cerrar** (Entrega), no al terminar pares.",
      ].join("\n"),
      head: workHead,
      base,
      token: session.token,
    });
    created = true;
  }

  const marker = markerFromPull(pull, owner, repo, issue.number, workHead, base);
  const nextIssue = await writeMarkerOnIssue(session, pmOrg, issue, marker);
  return { marker, issue: nextIssue, created };
}

export async function loadLinkedPull(
  session: GtSession,
  marker: PortionPrMarker,
): Promise<DcsPull> {
  return getPull(
    dcsConfig(session.host),
    marker.owner,
    marker.repo,
    marker.number,
    session.token,
  );
}

export async function loadLinkedPullFiles(
  session: GtSession,
  marker: PortionPrMarker,
): Promise<DcsPullFile[]> {
  return listPullFiles(
    dcsConfig(session.host),
    marker.owner,
    marker.repo,
    marker.number,
    session.token,
  );
}

export async function commentOnPortionPr(
  session: GtSession,
  marker: PortionPrMarker,
  body: string,
): Promise<void> {
  await createIssueComment(
    dcsConfig(session.host),
    marker.owner,
    marker.repo,
    marker.number,
    body,
    session.token,
  );
}

/**
 * Official Gitea PR review (APPROVED) for a claim-step Aprobar.
 * Creates the review, then submits if Gitea left it PENDING.
 */
export async function submitPortionPrApproval(
  session: GtSession,
  marker: PortionPrMarker,
  params: { stepName: string; issueNumber: number },
): Promise<DcsPullReview> {
  const pull = await loadLinkedPull(session, marker);
  const config = dcsConfig(session.host);
  const body = portionPrApprovalReviewBody(params);
  // Door43 refuses an approval of one's own pull request (422). When a step also asks for the author's agreement,
  // it is left on the review as a comment; the approval that counts for the step is the one kept in the subtarea.
  const own = (pull.user?.login || "").toLowerCase() === session.username.toLowerCase();
  const event = own ? "COMMENT" : "APPROVED";
  let review = await createPullReview(
    config,
    marker.owner,
    marker.repo,
    marker.number,
    session.token,
    { body, event },
  );
  if (pullReviewNeedsSubmit(review.state) && review.id) {
    review = await submitPullReview(
      config,
      marker.owner,
      marker.repo,
      marker.number,
      review.id,
      session.token,
      { body, event },
    );
  }
  return review;
}

function isNotFound(err: unknown): boolean {
  if (err instanceof DcsApiError) return err.status === 404;
  if (err instanceof BootstrapError) return err.status === 404;
  return false;
}

async function readOrNull(
  params: Parameters<typeof readRepoFile>[0],
): Promise<{ text: string; sha?: string } | null> {
  try {
    return await readRepoFile(params);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** Latest `tas:verse-conflicts` payload this issue left on its PR, or null. */
export async function loadPortionPrConflicts(
  session: GtSession,
  marker: PortionPrMarker,
  issueNumber: number,
): Promise<VerseConflictsPayload | null> {
  const comments = await listIssueComments(
    dcsConfig(session.host),
    marker.owner,
    marker.repo,
    marker.number,
    session.token,
  );
  for (let i = comments.length - 1; i >= 0; i--) {
    const payload = parseVerseConflictsComment(comments[i]!.body);
    if (payload && (!payload.issue || payload.issue === issueNumber)) return payload;
  }
  return null;
}

/**
 * Land the subtarea on the book trunk at Cerrar.
 * USFM: three-way verse merge limited to the issue portion, patched into the
 * trunk (only changed slots) with the Contents API (SHA retry, one parent).
 * The work tip is pinned on `archivo/{libro}/{issue}` before the PR closes;
 * if that ref cannot be written, Cerrar fails so the issue stays open.
 * Re-running on a PR that a previous Cerrar already closed re-validates the
 * trunk (writes only what is missing). Non-USFM (TSV helps): `mergePull`.
 */
export async function mergePortionPrIfOpen(
  session: GtSession,
  issue: DcsIssue,
): Promise<{ status: PortionMergeStatus; conflicts: VerseConflict[]; pullUrl?: string }> {
  const marker = parsePortionPrMarker(issue.body);
  if (!marker) return { status: "none", conflicts: [] };
  const pull = await loadLinkedPull(session, marker);
  const pullUrl = pull.html_url || marker.htmlUrl || undefined;
  if (pull.merged) return { status: "already", conflicts: [], pullUrl };
  const pullClosed = (pull.state ?? "").toLowerCase() === "closed";
  const config = dcsConfig(session.host);
  const files = await loadLinkedPullFiles(session, marker).catch(() => [] as DcsPullFile[]);
  const listedUsfm = files.find((row) => /\.usfm$/i.test(row.filename || ""))?.filename;
  const usfmPath =
    listedUsfm || bookUsfmName((bookCodeFromWorkHead(marker.head) || "").toUpperCase());
  const repoRef = { session, owner: marker.owner, repo: marker.repo, filepath: usfmPath };
  let workSha = "";
  const readHead = async () => {
    if (!usfmPath || !/\.usfm$/i.test(usfmPath)) return null;
    const tip = await getBranchSha(config, marker.owner, marker.repo, marker.head, session.token);
    if (!tip) return null;
    const file = await readOrNull({ ...repoRef, branch: tip });
    if (file) workSha = tip;
    return file;
  };
  const translator = translatorLoginFromHead(marker.head, [
    ...(issue.assignees ?? []).map((u) => u.login),
    issue.assignee?.login,
    session.username,
  ]);
  const draft =
    translator && translator.toLowerCase() !== session.username.toLowerCase()
      ? `el borrador de @${translator}`
      : "tu borrador";
  const headFile = await readHead();

  if (!headFile && pullClosed) {
    if (listedUsfm) {
      throw new Error(
        `La revisión de #${issue.number} está cerrada y ${draft} ya no tiene ${listedUsfm}. No se puede comprobar que los versículos estén en el borrador grupal. No se cerró.`,
      );
    }
    return { status: "closed", conflicts: [], pullUrl };
  }

  if (!headFile) {
    try {
      await mergePull(
        config,
        marker.owner,
        marker.repo,
        marker.number,
        session.token,
        `TAS entrega #${issue.number}`,
      );
    } catch (err) {
      throw new Error(
        `No se pudo guardar la subtarea en el borrador grupal: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return { status: "merged", conflicts: [], pullUrl };
  }

  const bookRef =
    marker.base ||
    bookTrunkFromWorkHead(marker.head) ||
    bookBranchName(usfmPath.replace(/^\d+-/, "").replace(/\.usfm$/i, ""));
  const ref = refFromIssueTitle(issue.title);
  const scope = parseRefRange(ref);
  if (!scope) {
    throw new Error(
      `No se pudo leer el rango de versículos del título («${ref}»). Corrige el título de la subtarea (p. ej. «1:1–8») y vuelve a pulsar Cerrar. No se cerró.`,
    );
  }
  if (!pull.merge_base) {
    throw new Error(
      `Door43 no devolvió el punto de partida de ${draft}. Sin él no se pueden guardar los versículos en el borrador grupal sin pisar el trabajo de otras personas. No se cerró.`,
    );
  }
  const ancestor = (await readOrNull({ ...repoRef, branch: pull.merge_base }))?.text ?? "";

  let trunkSha: string | undefined;
  const previous = await loadPortionPrConflicts(session, marker, issue.number).catch(() => null);
  let postedConflicts = previous ? JSON.stringify(previous.conflicts) : "";
  const postConflicts = async (conflicts: VerseConflict[]) => {
    const key = JSON.stringify(conflicts);
    if (!conflicts.length || key === postedConflicts) return;
    await commentOnPortionPr(
      session,
      marker,
      formatVerseConflictsComment({
        issueNumber: issue.number,
        bookRef,
        trunkSha,
        book: bookCodeFromWorkHead(marker.head).toUpperCase(),
        conflicts,
      }),
    );
    postedConflicts = key;
  };

  const book = bookCodeFromWorkHead(marker.head) || usfmPath.replace(/^\d+-/, "").replace(/\.usfm$/i, "");
  const archiveRef = archiveRefName(book, issue.number);
  const verses = scope.to > scope.from
    ? `${scope.chapter}:${scope.from}–${scope.to}`
    : `${scope.chapter}:${scope.from}`;
  let attempt = 0;
  const { wrote, result } = await mergeIntoTrunkWithRetry(
    {
      read: async () => {
        const file = await readRepoFile({ ...repoRef, branch: bookRef });
        trunkSha = file.sha;
        return file;
      },
      beforeWrite: (merged) => postConflicts(merged.conflicts),
      write: async (content, sha) => {
        await writeRepoFile({
          ...repoRef,
          branch: bookRef,
          content,
          sha,
          step: "trunk-merge",
          message: trunkMergeCommitMessage({
            issueNumber: issue.number,
            verses,
            translator,
            pullNumber: marker.number,
            workBranch: marker.head,
            workSha,
            archiveRef,
          }),
        });
      },
      isShaConflict: (err) =>
        err instanceof BootstrapError && (err.status === 409 || err.status === 422),
    },
    async (trunkText) => {
      const head = attempt++ === 0 ? headFile : await readHead();
      if (!head) {
        throw new Error(`${draft[0]!.toUpperCase()}${draft.slice(1)} ya no tiene ${usfmPath}. No se cerró.`);
      }
      return patchTrunkByVerse(trunkText, [head.text], { ancestor, scope });
    },
  );
  if (!wrote) await postConflicts(result.conflicts);

  try {
    await ensureArchiveRef(config, marker.owner, marker.repo, archiveRef, workSha, session.token);
  } catch (err) {
    throw new Error(
      `No se pudo guardar una copia de ${draft} en ${marker.owner}/${marker.repo} (${
        err instanceof Error ? err.message : String(err)
      }). Sin ella, esa versión se perdería al borrar el borrador. No se cerró.`,
    );
  }

  if (wrote || !pullClosed) {
    await createIssueComment(
      config,
      marker.owner,
      marker.repo,
      marker.number,
      wrote
        ? `Versículos ${verses} de #${issue.number} fusionados en «${bookRef}» (solo los versículos que cambiaron). El PR se cierra sin fusión Git; los commits de «${marker.head}» (${workSha}) quedan en la ref «${archiveRef}».`
        : `Versículos ${verses} de #${issue.number} ya estaban en «${bookRef}»: sin cambios en el tronco. El PR se cierra sin fusión Git; los commits de «${marker.head}» (${workSha}) quedan en la ref «${archiveRef}».`,
      session.token,
    );
  }
  if (!pullClosed) {
    await closePull(config, marker.owner, marker.repo, marker.number, session.token);
  }
  return { status: "verses", conflicts: result.conflicts, pullUrl };
}

export async function getPmIssue(
  session: GtSession,
  pmOrg: string,
  issueNumber: number,
): Promise<DcsIssue> {
  return getIssue(
    dcsConfig(session.host),
    pmOrg,
    PM_REPO_NAME,
    issueNumber,
    session.token,
  );
}

async function portionPrMarkerIsLive(
  session: GtSession,
  marker: PortionPrMarker,
  workBranch: string,
  owned: { book: string; username: string; taskId: string; issueNumber: number },
): Promise<boolean> {
  if (!portionPrHeadMatchesWork(marker.head, workBranch, owned)) return false;
  const config = dcsConfig(session.host);
  const headExists = await branchExists(
    config,
    marker.owner,
    marker.repo,
    marker.head,
    session.token,
  ).catch(() => false);
  if (!headExists) return false;
  try {
    const pull = await getPull(config, marker.owner, marker.repo, marker.number, session.token);
    const pullHead = pull.head?.ref || marker.head;
    return portionPrHeadMatchesWork(pullHead, workBranch, owned);
  } catch {
    return false;
  }
}

/**
 * Ver PR only when the stored PR head still exists and matches this
 * subtarea's current work branch (or a remapped `w/` leftover).
 * Drops the issue marker when the PR is gone or orphaned.
 */
export async function resolveVisiblePortionPr(params: {
  session: GtSession;
  pmOrg: string;
  issue: DcsIssue;
  workBranch: string;
  username?: string;
  book?: string;
  taskId?: string;
}): Promise<{ marker: PortionPrMarker | null; issue: DcsIssue; dropped: boolean }> {
  const { session, pmOrg, workBranch } = params;
  let { issue } = params;
  const marker = parsePortionPrMarker(issue.body);
  if (!marker) return { marker: null, issue, dropped: false };
  const owned = {
    book: params.book || bookCodeFromWorkHead(marker.head) || "book",
    username: params.username || session.username,
    taskId: params.taskId || "",
    issueNumber: issue.number,
  };
  const live = await portionPrMarkerIsLive(session, marker, workBranch, owned);
  if (live) return { marker, issue, dropped: false };
  try {
    issue = await unlinkPortionPrMarker(session, pmOrg, issue);
    return { marker: null, issue, dropped: true };
  } catch {
    return { marker: null, issue, dropped: true };
  }
}

/**
 * Close this subtarea's open PR (legacy or remapped `w/` head) and
 * always drop the issue marker so Ver PR cannot keep an antique URL.
 */
export async function closeOwnedPortionPrIfSafe(params: {
  session: GtSession;
  pmOrg: string;
  issueNumber: number;
  owner: string;
  repo: string;
  workBranch: string;
  bookBranch?: string;
  username?: string;
  book?: string;
  taskId?: string;
}): Promise<{ closed: boolean; unlinked: boolean }> {
  const { session, pmOrg, issueNumber, owner, repo, workBranch } = params;
  const config = dcsConfig(session.host);
  let issue: DcsIssue;
  try {
    issue = await getPmIssue(session, pmOrg, issueNumber);
  } catch {
    return { closed: false, unlinked: false };
  }

  const marker = parsePortionPrMarker(issue.body);
  const ownedParams =
    params.book && params.taskId
      ? {
          book: params.book,
          username: params.username || session.username,
          taskId: params.taskId,
          issueNumber,
        }
      : null;
  const headIsOurs = (head: string | undefined) => {
    const name = (head || "").trim();
    if (!name) return false;
    if (name === workBranch) return true;
    if (ownedParams && isOwnedWorkBranch(name, ownedParams)) return true;
    return ownedParams ? portionPrHeadMatchesWork(name, workBranch, ownedParams) : false;
  };
  let pull: DcsPull | null = null;
  const pullOwner = marker?.owner || owner;
  const pullRepo = marker?.repo || repo;
  if (marker) {
    try {
      pull = await getPull(config, pullOwner, pullRepo, marker.number, session.token);
    } catch {
      pull = null;
    }
  }
  if (!pull && params.bookBranch) {
    pull = await getPullByBranches(
      config,
      owner,
      repo,
      params.bookBranch,
      workBranch,
      session.token,
    ).catch(() => null);
    if (pull && !headIsOurs(pull.head?.ref)) pull = null;
  }

  let closed = false;
  const canClose =
    pull
    && !pull.merged
    && (pull.state ?? "").toLowerCase() === "open"
    && (headIsOurs(pull.head?.ref) || Boolean(marker));
  if (canClose && pull) {
    try {
      await closePull(config, pullOwner, pullRepo, pull.number, session.token);
      closed = true;
    } catch (err) {
      const status = err instanceof DcsApiError ? err.status : undefined;
      throw new BootstrapError(
        err instanceof Error ? err.message : String(err),
        "pr-close",
        status,
        err,
      );
    }
  }

  if (!marker) return { closed, unlinked: false };

  try {
    const next = await unlinkPortionPrMarker(session, pmOrg, issue);
    const unlinked = next.body !== issue.body;
    return { closed, unlinked };
  } catch (err) {
    const status = err instanceof DcsApiError ? err.status : undefined;
    throw new BootstrapError(
      err instanceof Error ? err.message : String(err),
      "pr-close",
      status,
      err,
    );
  }
}

/** Write a text file onto the subtarea branch (creates the branch if needed). */
export async function saveTextOnPortionBranch(params: {
  session: GtSession;
  owner: string;
  repo: string;
  filepath: string;
  content: string;
  message: string;
  branch: string;
  sha?: string;
  book?: string;
  resource?: string;
  taskId?: string;
  phaseSlug?: string;
  username?: string;
  issueNumber?: number;
}): Promise<{ sha?: string; commitSha?: string; branch: string }> {
  return saveUsfmOnPortionBranch(params);
}

/** Write USFM onto the subtarea branch (creates the branch from the book base). */
export async function saveUsfmOnPortionBranch(params: {
  session: GtSession;
  owner: string;
  repo: string;
  filepath: string;
  content: string;
  message: string;
  branch: string;
  sha?: string;
  book?: string;
  resource?: string;
  taskId?: string;
  phaseSlug?: string;
  username?: string;
  issueNumber?: number;
}): Promise<{ sha?: string; commitSha?: string; branch: string }> {
  let branch = params.branch;
  if (params.book) {
    const task = await ensureTaskBranchFromBook({
      session: params.session,
      owner: params.owner,
      repo: params.repo,
      book: params.book,
      resource: params.resource,
      taskId: params.taskId,
      phaseSlug: params.phaseSlug,
      filepath: params.filepath,
      taskBranch: params.branch,
      username: params.username,
      issueNumber: params.issueNumber,
    });
    branch = task.workBranch;
  } else {
    const config = dcsConfig(params.session.host);
    await ensureBranchFromDefault(
      config,
      params.owner,
      params.repo,
      params.branch,
      params.session.token,
    );
  }
  const saved = await writeRepoFile({
    session: params.session,
    owner: params.owner,
    repo: params.repo,
    filepath: params.filepath,
    branch,
    content: params.content,
    message: params.message,
    sha: params.sha,
  });
  return { sha: saved.sha, commitSha: saved.commitSha, branch };
}
