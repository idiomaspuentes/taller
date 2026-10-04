import { knownBranches, onlyExisting } from "./branchList";
import { DcsApiError } from "@ip-lms/dcs-client";
import { loadEnglishScriptureKindUsfm } from "../domain/referenceResources";
import {
  bookBranchName,
  groupDraftBranchNames,
  bookOnlyBranchName,
  canonicalWorkBranchName,
  compatBookBranchNames,
  isGitRefDescendant,
  isOwnedWorkBranch,
  isSharedBookTrunk,
  legacyBookBranchName,
  legacyPhaseBookBranchName,
  ownedWorkBranchNames,
} from "../domain/portionPr";
import { isWorkWord } from "../domain/branchNames";
import {
  buildBookUsfmSkeleton,
  isValidBookUsfm,
  usfmHasFilledVerses,
  type RefRange,
} from "../domain/usfmEdit";
import { dcsConfig } from "./config";
import type { GtSession } from "./auth";
import { isSessionExpiredError } from "./sessionExpiry";
import {
  branchExists,
  deleteGitRef,
  ensureBranchFrom,
  getBranchSha,
  getDefaultBranch,
} from "./pulls";
import {
  BootstrapError,
  ensureContentRepo,
  readRepoFile,
  writeRepoFile,
} from "./repoFile";

export type EnsureBookUsfmParams = {
  session: GtSession;
  owner: string;
  repo: string;
  filepath: string;
  book: string;
  resource?: string;
  taskId?: string;
  /** Reuse-only: look up `{oldPhaseSlug}/{book}` if that ref already exists. */
  phaseSlug?: string;
  fallbackRange?: RefRange;
  /**
   * Recreate: never reuse shared leftovers (`neh`, `book/neh`, old phase
   * trunks). If parent `neh` blocks `neh/{taskId}`, use `t/neh/{taskId}`.
   */
  preferPerTaskTrunk?: boolean;
};

export type EnsureBookUsfmResult = {
  bookBranch: string;
  usfm: string;
  sha?: string;
  createdBranch: boolean;
  createdFile: boolean;
};

async function tryRead(
  session: GtSession,
  owner: string,
  repo: string,
  filepath: string,
  branch?: string,
): Promise<{ text: string; sha?: string } | null> {
  try {
    return await readRepoFile({ session, owner, repo, filepath, branch });
  } catch (err) {
    if (err instanceof DcsApiError && err.status === 404) return null;
    if (err instanceof Error && /no se encontró|no existe/i.test(err.message)) return null;
    throw err;
  }
}

export type ExistingBookUsfm = {
  text: string;
  sha?: string;
  branch?: string;
};

/**
 * Cheap GETs of an already-published book file. Tries refs in order
 * (first hit wins). Does not create repos, branches, or skeletons.
 */
export async function tryReadExistingBookUsfm(params: {
  session: GtSession;
  owner: string;
  repo: string;
  filepath: string;
  branches: Array<string | undefined>;
}): Promise<ExistingBookUsfm | null> {
  const seen = new Set<string>();
  const refs: Array<string | undefined> = [];
  for (const raw of params.branches) {
    const key = (raw ?? "").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(key || undefined);
  }
  // Only the branches the repository has are asked: the others would each be a failed request.
  const names = refs.some(Boolean) ? await knownBranches(dcsConfig(params.session.host), params.owner, params.repo, params.session.token) : null;
  const reads = await Promise.all(
    onlyExisting(refs, names).map(async (branch) => {
      try {
        const found = await tryRead(
          params.session,
          params.owner,
          params.repo,
          params.filepath,
          branch,
        );
        return found ? { ...found, branch } : null;
      } catch {
        return null;
      }
    }),
  );
  return reads.find((row) => row != null) ?? null;
}

async function loadSourceSkeleton(
  session: GtSession,
  book: string,
  resource: string | undefined,
  fallbackRange?: RefRange,
): Promise<string> {
  const primary = resource?.toLowerCase() === "tps" ? "ust" : "ult";
  const companion = primary === "ust" ? "ult" : "ust";
  const first = await loadEnglishScriptureKindUsfm(session, primary, book);
  const second = first ? null : await loadEnglishScriptureKindUsfm(session, companion, book);
  const sourceUsfm = first?.usfm || second?.usfm;
  return buildBookUsfmSkeleton({ book, sourceUsfm, fallbackRange });
}

/**
 * The group draft is `borrador/{book}/{taskId}`. A book started before that name keeps the branch it has
 * (`{book}/{taskId}`, `t/{book}/{taskId}`, `afinacion/{book}`, `armonizacion/{book}`, `book/{book}`,
 * `{oldPhaseSlug}/{book}`, or `{book}` when it holds a valid book USFM), so its work is not orphaned; none of
 * those is ever created again.
 */
export async function resolveBookBranchName(params: {
  session: GtSession;
  owner: string;
  repo: string;
  book: string;
  taskId?: string;
  phaseSlug?: string;
  filepath?: string;
  preferPerTaskTrunk?: boolean;
}): Promise<{ bookBranch: string; reusedLegacy: boolean }> {
  const preferred = bookBranchName(params.book, params.taskId);
  const bookOnly = bookOnlyBranchName(params.book);
  const oldPhase = legacyPhaseBookBranchName(params.book, params.phaseSlug);
  const perTask = groupDraftBranchNames(params.book, params.taskId);
  const candidates = params.preferPerTaskTrunk
    ? perTask
    : [
        ...perTask,
        ...compatBookBranchNames(params.book),
        legacyBookBranchName(params.book),
        oldPhase,
      ];
  const seen = new Set<string>();
  const config = dcsConfig(params.session.host);
  for (const name of candidates) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (await branchExists(config, params.owner, params.repo, name, params.session.token)) {
      return { bookBranch: name, reusedLegacy: name !== preferred };
    }
  }

  if (
    !params.preferPerTaskTrunk
    && params.filepath
    && await branchExists(config, params.owner, params.repo, bookOnly, params.session.token)
  ) {
    const onBook = await tryRead(params.session, params.owner, params.repo, params.filepath, bookOnly);
    if (onBook && isValidBookUsfm(onBook.text)) {
      return { bookBranch: bookOnly, reusedLegacy: true };
    }
  }

  return { bookBranch: preferred, reusedLegacy: false };
}

function refuseWorkRefAsTrunk(bookBranch: string, book: string, taskId?: string): void {
  const trunk = bookBranchName(book, taskId);
  if (isGitRefDescendant(bookBranch, trunk) || isWorkWord(bookBranch.split("/")[0])) {
    throw new BootstrapError(
      `«${bookBranch}» es un borrador personal, no el borrador grupal del libro «${trunk}». Primero se crea el borrador grupal y luego se parte de él.`,
      "book-branch",
      undefined,
      undefined,
      trunk,
    );
  }
}

async function createBookBranchFrom(
  session: GtSession,
  owner: string,
  repo: string,
  bookBranch: string,
  sourceBranch: string,
  book?: string,
  taskId?: string,
): Promise<{ created: boolean }> {
  if (book) refuseWorkRefAsTrunk(bookBranch, book, taskId);
  const config = dcsConfig(session.host);
  try {
    return await ensureBranchFrom(
      config,
      owner,
      repo,
      bookBranch,
      session.token,
      sourceBranch,
    );
  } catch (err) {
    if (err instanceof BootstrapError) throw err;
    const status = err instanceof DcsApiError ? err.status : undefined;
    throw new BootstrapError(
      err instanceof Error ? err.message : String(err),
      "book-branch",
      status,
      err,
      bookBranch,
    );
  }
}

async function writeOnBookBranch(params: {
  session: GtSession;
  owner: string;
  repo: string;
  filepath: string;
  bookBranch: string;
  defaultBranch: string;
  content: string;
  message: string;
  step: "file-create" | "file-copy";
  book?: string;
  taskId?: string;
}): Promise<{ sha?: string }> {
  try {
    return await writeRepoFile({
      session: params.session,
      owner: params.owner,
      repo: params.repo,
      filepath: params.filepath,
      branch: params.bookBranch,
      content: params.content,
      message: params.message,
      step: params.step,
    });
  } catch (err) {
    if (!(err instanceof BootstrapError) || err.step !== "book-branch") throw err;
    await createBookBranchFrom(
      params.session,
      params.owner,
      params.repo,
      params.bookBranch,
      params.defaultBranch,
      params.book,
      params.taskId,
    );
    try {
      return await writeRepoFile({
        session: params.session,
        owner: params.owner,
        repo: params.repo,
        filepath: params.filepath,
        branch: params.bookBranch,
        content: params.content,
        message: params.message,
        step: params.step,
      });
    } catch (retryErr) {
      if (!(retryErr instanceof BootstrapError) || retryErr.step !== "book-branch") {
        throw retryErr;
      }
      return writeRepoFile({
        session: params.session,
        owner: params.owner,
        repo: params.repo,
        filepath: params.filepath,
        branch: params.defaultBranch,
        newBranch: params.bookBranch,
        content: params.content,
        message: params.message,
        step: params.step,
      });
    }
  }
}

/**
 * Idempotent book-base branch + USFM.
 *
 * 1. Ensure the content repo (create like `gateway-tasks` if missing).
 * 2. Resolve default-branch SHA.
 * 3. Create `borrador/{book}/{taskId}` from default (or reuse the branch an older book already has).
 * 4. If USFM exists on default: copy onto the book branch.
 * 5. If missing: write a ULT-shaped skeleton on the book branch.
 * Empty repos: first commit on default, then branch — Gitea cannot create refs without a SHA.
 */
export async function ensureBookUsfm(
  params: EnsureBookUsfmParams,
): Promise<EnsureBookUsfmResult> {
  const { session, owner, repo, filepath, book, resource, taskId, phaseSlug, fallbackRange } = params;
  await ensureContentRepo(session, owner, repo);

  const config = dcsConfig(session.host);
  let defaultBranch: string;
  try {
    defaultBranch = await getDefaultBranch(config, owner, repo, session.token);
  } catch (err) {
    const status = err instanceof DcsApiError ? err.status : undefined;
    throw new BootstrapError(
      err instanceof Error ? err.message : String(err),
      "default-branch",
      status,
      err,
    );
  }

  let defaultSha = await getBranchSha(config, owner, repo, defaultBranch, session.token);
  const resolved = await resolveBookBranchName({
    session, owner, repo, book, taskId, phaseSlug, filepath,
    preferPerTaskTrunk: params.preferPerTaskTrunk,
  });
  const bookBranch = resolved.bookBranch;

  if (!defaultSha) {
    const onDefault = await tryRead(session, owner, repo, filepath, defaultBranch);
    const usfm = onDefault?.text || await loadSourceSkeleton(session, book, resource, fallbackRange);
    try {
      await writeRepoFile({
        session,
        owner,
        repo,
        filepath,
        content: usfm,
        message: `TAS: primer commit ${filepath}`,
        step: "file-create",
      });
    } catch (err) {
      if (err instanceof BootstrapError) throw err;
      const status = err instanceof DcsApiError ? err.status : undefined;
      throw new BootstrapError(
        err instanceof Error ? err.message : String(err),
        "file-create",
        status,
        err,
      );
    }
    defaultSha = await getBranchSha(config, owner, repo, defaultBranch, session.token);
    if (!defaultSha) {
      throw new BootstrapError(
        `El repositorio ${owner}/${repo} sigue vacío en «${defaultBranch}» después del primer archivo.`,
        "default-branch",
        404,
      );
    }
    const branched = await createBookBranchFrom(
      session, owner, repo, bookBranch, defaultBranch, book, taskId,
    );
    const onBook = await tryRead(session, owner, repo, filepath, bookBranch);
    return {
      bookBranch,
      usfm: onBook?.text || usfm,
      sha: onBook?.sha,
      createdBranch: branched.created,
      createdFile: true,
    };
  }

  const branched = await createBookBranchFrom(
    session, owner, repo, bookBranch, defaultBranch, book, taskId,
  );

  const onBook = await tryRead(session, owner, repo, filepath, bookBranch);
  if (onBook) {
    return {
      bookBranch,
      usfm: onBook.text,
      sha: onBook.sha,
      createdBranch: branched.created,
      createdFile: false,
    };
  }

  const onDefault = await tryRead(session, owner, repo, filepath, defaultBranch);
  if (onDefault) {
    const saved = await writeOnBookBranch({
      session,
      owner,
      repo,
      filepath,
      bookBranch,
      defaultBranch,
      content: onDefault.text,
      message: `TAS: copiar ${filepath} a ${bookBranch}`,
      step: "file-copy",
      book,
      taskId,
    });
    return {
      bookBranch,
      usfm: onDefault.text,
      sha: saved.sha,
      createdBranch: branched.created,
      createdFile: true,
    };
  }

  const usfm = await loadSourceSkeleton(session, book, resource, fallbackRange);
  const saved = await writeOnBookBranch({
    session,
    owner,
    repo,
    filepath,
    bookBranch,
    defaultBranch,
    content: usfm,
    message: `TAS: crear ${filepath} en ${bookBranch}`,
    step: "file-create",
    book,
    taskId,
  });
  return {
    bookBranch,
    usfm,
    sha: saved.sha,
    createdBranch: branched.created,
    createdFile: true,
  };
}

/**
 * The help file of a book (its notes, its questions) on the group draft of the task that translates it.
 *
 * A book the team has never worked has no such file yet, and the helps editor could not open: it read the file and
 * failed. The Scripture editor starts a new book from the source text; this does the same for a help: the first
 * person who opens the task puts the source's rows on the group draft, and every passage starts from them, so each
 * one changes only its own rows.
 */
export async function ensureHelpsFileFromSource(params: {
  session: GtSession;
  owner: string;
  repo: string;
  filepath: string;
  book: string;
  taskId?: string;
  phaseSlug?: string;
  /** Reads the file as the source package has it; null when it has none. */
  source: () => Promise<string | null>;
}): Promise<{ text: string; sha?: string; bookBranch: string; created: boolean } | null> {
  const { session, owner, repo, filepath, book, taskId, phaseSlug } = params;
  const config = dcsConfig(session.host);
  const defaultBranch = await getDefaultBranch(config, owner, repo, session.token);
  const { bookBranch } = await resolveBookBranchName({ session, owner, repo, book, taskId, phaseSlug });
  const onBook = await tryRead(session, owner, repo, filepath, bookBranch);
  if (onBook) return { ...onBook, bookBranch, created: false };
  const text = await params.source();
  if (!text?.trim()) return null;
  const saved = await writeOnBookBranch({
    session,
    owner,
    repo,
    filepath,
    bookBranch,
    defaultBranch,
    content: text,
    message: `TAS: crear ${filepath} en ${bookBranch} desde la fuente`,
    step: "file-create",
    book,
    taskId,
  });
  return { text, sha: saved.sha, bookBranch, created: true };
}

export async function ensureTaskBranchFromBook(params: {
  session: GtSession;
  owner: string;
  repo: string;
  book: string;
  taskBranch: string;
  resource?: string;
  taskId?: string;
  phaseSlug?: string;
  filepath?: string;
  username?: string;
  issueNumber?: number;
  preferPerTaskTrunk?: boolean;
}): Promise<{ bookBranch: string; workBranch: string; created: boolean }> {
  const { session, owner, repo, book, taskId, phaseSlug, filepath } = params;
  const resolved = await resolveBookBranchName({
    session, owner, repo, book, taskId, phaseSlug, filepath,
    preferPerTaskTrunk: params.preferPerTaskTrunk,
  });
  const trunk = resolved.bookBranch;
  const workParams = {
    book,
    username: params.username || session.username,
    taskId: taskId || "",
    issueNumber: params.issueNumber || 0,
  };
  const workBranch = canonicalWorkBranchName(workParams, trunk, params.taskBranch);
  const config = dcsConfig(session.host);
  const bookExists = await branchExists(config, owner, repo, trunk, session.token);
  if (!bookExists) {
    const defaultBranch = await getDefaultBranch(config, owner, repo, session.token);
    await createBookBranchFrom(session, owner, repo, trunk, defaultBranch, book, taskId);
  }
  if (workBranch === trunk || isGitRefDescendant(workBranch, trunk)) {
    throw new BootstrapError(
      `El borrador personal no puede llamarse «${workBranch}»: choca con el borrador grupal «${trunk}».`,
      "task-branch",
      500,
      undefined,
      workBranch,
    );
  }
  try {
    const result = await ensureBranchFrom(
      config,
      owner,
      repo,
      workBranch,
      session.token,
      trunk,
      { fallbackSource: () => getDefaultBranch(config, owner, repo, session.token) },
    );
    return { bookBranch: trunk, workBranch, created: result.created };
  } catch (err) {
    if (err instanceof BootstrapError) throw err;
    const status = err instanceof DcsApiError ? err.status : undefined;
    throw new BootstrapError(
      err instanceof Error ? err.message : String(err),
      "task-branch",
      status,
      err,
      workBranch,
    );
  }
}

export type RecreateTrunkReason = "missing" | "invalid" | "empty-skeleton" | "filled";

export type RecreateBookWorkspacePlan = {
  owner: string;
  repo: string;
  bookBranch: string;
  workBranch: string;
  workBranchExists: boolean;
  willDeleteWorkBranch: boolean;
  willWipeTrunkFile: boolean;
  trunkReason: RecreateTrunkReason;
};

export type RecreateBookWorkspaceParams = EnsureBookUsfmParams & {
  workBranch: string;
  username?: string;
  issueNumber?: number;
  extraWorkBranches?: string[];
  createdFileThisSession?: boolean;
  closeOwnedPr?: () => Promise<{ closed: boolean; unlinked?: boolean } | void>;
};

export type RecreateBookWorkspaceResult = EnsureBookUsfmResult & {
  workBranch: string;
  wipedTrunk: boolean;
  reusedTrunk: boolean;
  deletedWorkBranch: boolean;
  closedPr: boolean;
  unlinkedPr: boolean;
};

function trunkPolicyFromUsfm(
  usfm: string | null,
  createdFileThisSession?: boolean,
): { wipe: boolean; reason: RecreateTrunkReason } {
  if (usfm == null || !usfm.trim()) return { wipe: true, reason: "missing" };
  if (!isValidBookUsfm(usfm)) return { wipe: true, reason: "invalid" };
  if (usfmHasFilledVerses(usfm)) return { wipe: false, reason: "filled" };
  return {
    wipe: Boolean(createdFileThisSession),
    reason: "empty-skeleton",
  };
}

function resolveRecreateWorkBranch(params: RecreateBookWorkspaceParams, bookBranch: string): string {
  return canonicalWorkBranchName(
    {
      book: params.book,
      username: params.username || params.session.username,
      taskId: params.taskId || "",
      issueNumber: params.issueNumber || 0,
    },
    bookBranch,
    params.workBranch,
  );
}

function ownedWorkBranches(params: RecreateBookWorkspaceParams, bookBranch: string): string[] {
  const names = new Set<string>();
  const add = (name: string | undefined) => {
    const trimmed = name?.trim();
    if (!trimmed || trimmed === bookBranch) return;
    names.add(trimmed);
  };
  add(params.workBranch);
  for (const extra of params.extraWorkBranches ?? []) add(extra);
  if (params.issueNumber && params.book) {
    const owned = {
      book: params.book,
      username: params.username || params.session.username,
      taskId: params.taskId || "",
      issueNumber: params.issueNumber,
    };
    for (const name of ownedWorkBranchNames(owned)) add(name);
    return [...names].filter((name) => name === params.workBranch || isOwnedWorkBranch(name, owned));
  }
  return [...names];
}

async function inspectTrunkFile(
  params: RecreateBookWorkspaceParams,
  bookBranch: string,
): Promise<{ usfm: string | null; policy: { wipe: boolean; reason: RecreateTrunkReason } }> {
  const onBook = await tryRead(params.session, params.owner, params.repo, params.filepath, bookBranch);
  const usfm = onBook?.text ?? null;
  return { usfm, policy: trunkPolicyFromUsfm(usfm, params.createdFileThisSession) };
}

export async function inspectRecreateBookWorkspace(
  params: RecreateBookWorkspaceParams,
): Promise<RecreateBookWorkspacePlan> {
  const resolved = await resolveBookBranchName({
    session: params.session,
    owner: params.owner,
    repo: params.repo,
    book: params.book,
    taskId: params.taskId,
    phaseSlug: params.phaseSlug,
    filepath: params.filepath,
    preferPerTaskTrunk: true,
  });
  const config = dcsConfig(params.session.host);
  const candidates = ownedWorkBranches(params, resolved.bookBranch);
  let workBranchExists = false;
  for (const name of candidates) {
    if (await branchExists(config, params.owner, params.repo, name, params.session.token)) {
      workBranchExists = true;
      break;
    }
  }
  const { policy } = await inspectTrunkFile(params, resolved.bookBranch);
  return {
    owner: params.owner,
    repo: params.repo,
    bookBranch: resolved.bookBranch,
    workBranch: resolveRecreateWorkBranch(params, resolved.bookBranch),
    workBranchExists,
    willDeleteWorkBranch: workBranchExists,
    willWipeTrunkFile: policy.wipe,
    trunkReason: policy.reason,
  };
}

async function deleteOwnedWorkBranches(
  params: RecreateBookWorkspaceParams,
  bookBranch: string,
): Promise<boolean> {
  const config = dcsConfig(params.session.host);
  const candidates = ownedWorkBranches(params, bookBranch);
  let deleted = false;
  for (const name of candidates) {
    try {
      const result = await deleteGitRef(config, params.owner, params.repo, name, params.session.token);
      if (result.deleted) deleted = true;
    } catch (err) {
      const status = err instanceof DcsApiError ? err.status : undefined;
      throw new BootstrapError(
        err instanceof Error ? err.message : String(err),
        "work-branch-delete",
        status,
        err,
        name,
      );
    }
  }
  return deleted;
}

async function rollbackBrokenTrunk(
  params: RecreateBookWorkspaceParams,
  bookBranch: string,
): Promise<void> {
  const config = dcsConfig(params.session.host);
  let defaultBranch: string;
  try {
    defaultBranch = await getDefaultBranch(config, params.owner, params.repo, params.session.token);
  } catch (err) {
    const status = err instanceof DcsApiError ? err.status : undefined;
    throw new BootstrapError(
      err instanceof Error ? err.message : String(err),
      "default-branch",
      status,
      err,
    );
  }
  const rewriteTrunkFile = async () => {
    const usfm = await loadSourceSkeleton(params.session, params.book, params.resource, params.fallbackRange);
    await writeOnBookBranch({
      session: params.session,
      owner: params.owner,
      repo: params.repo,
      filepath: params.filepath,
      bookBranch,
      defaultBranch,
      content: usfm,
      message: `TAS: recrear ${params.filepath} en ${bookBranch}`,
      step: "file-create",
      book: params.book,
      taskId: params.taskId,
    });
  };
  if (
    bookBranch === defaultBranch
    || isSharedBookTrunk(bookBranch, params.book, params.phaseSlug)
  ) {
    await rewriteTrunkFile();
    return;
  }
  try {
    await deleteGitRef(config, params.owner, params.repo, bookBranch, params.session.token);
  } catch (err) {
    if (isSessionExpiredError(err)) throw err;
    const status = err instanceof DcsApiError ? err.status : undefined;
    if (status === 403) {
      throw new BootstrapError(
        err instanceof Error ? err.message : String(err),
        "book-branch",
        status,
        err,
        bookBranch,
      );
    }
    await rewriteTrunkFile();
  }
}

/**
 * Rollback a stuck/broken book workspace, then recreate in create-order
 * (repo → default SHA → trunk → file → work branch). Never force-pushes.
 * Does not wipe a trunk that already has filled verses from someone else.
 */
export async function recreateBookWorkspace(
  params: RecreateBookWorkspaceParams,
): Promise<RecreateBookWorkspaceResult> {
  let closedPr = false;
  let unlinkedPr = false;
  if (params.closeOwnedPr) {
    try {
      const result = await params.closeOwnedPr();
      closedPr = Boolean(result && result.closed);
      unlinkedPr = Boolean(result && result.unlinked);
    } catch (err) {
      if (err instanceof BootstrapError) throw err;
      const status = err instanceof DcsApiError ? err.status : undefined;
      throw new BootstrapError(
        err instanceof Error ? err.message : String(err),
        "pr-close",
        status,
        err,
      );
    }
  }

  const resolved = await resolveBookBranchName({
    session: params.session,
    owner: params.owner,
    repo: params.repo,
    book: params.book,
    taskId: params.taskId,
    phaseSlug: params.phaseSlug,
    filepath: params.filepath,
    preferPerTaskTrunk: true,
  });
  const bookBranch = resolved.bookBranch;
  const workBranch = resolveRecreateWorkBranch(params, bookBranch);
  const { policy } = await inspectTrunkFile(params, bookBranch);
  const deletedWorkBranch = await deleteOwnedWorkBranches(params, bookBranch);

  if (policy.wipe) {
    await rollbackBrokenTrunk(params, bookBranch);
  }

  const boot = await ensureBookUsfm({ ...params, preferPerTaskTrunk: true });
  const task = await ensureTaskBranchFromBook({
    session: params.session,
    owner: params.owner,
    repo: params.repo,
    book: params.book,
    resource: params.resource,
    taskId: params.taskId,
    phaseSlug: params.phaseSlug,
    filepath: params.filepath,
    taskBranch: workBranch,
    username: params.username,
    issueNumber: params.issueNumber,
    preferPerTaskTrunk: true,
  });

  return {
    ...boot,
    bookBranch: task.bookBranch || boot.bookBranch,
    workBranch: task.workBranch,
    wipedTrunk: policy.wipe,
    reusedTrunk: !policy.wipe,
    deletedWorkBranch,
    closedPr,
    unlinkedPr,
  };
}
