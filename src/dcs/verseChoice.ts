/**
 * Write path of the `verse-conflict` decision (plan §7.2–7.4). Reuses the
 * Cerrar engine: `patchTrunkByVerse` (current trunk as ancestor, scope =
 * range) inside `mergeIntoTrunkWithRetry`. The guard runs when the card is
 * painted (`prepareVerseChoice`) and again on every write attempt.
 * Never merges the PR, never creates refs, never writes the stored text.
 */
import { createIssueComment } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import { clearIssueConflict } from "./issues";
import { getArchiveSha, readGitBlob } from "./pulls";
import { BootstrapError, readRepoFile, writeRepoFile } from "./repoFile";
import {
  buildVerseChoicePosts,
  computeChoicePatch,
  displacedText,
  keptText,
  rangeText,
  sourceBlockReason,
  trunkChoiceCommitMessage,
  verseChoiceIssues,
  type ConflictPrepared,
} from "../domain/conflictChoice";
import { clearPrincipalPassMarks } from "./principalPass";
import { commentToItem, type ThreadItem } from "../domain/conversation";
import { archiveRefName } from "../domain/portionPr";
import { mergeIntoTrunkWithRetry } from "../domain/trunkMerge";
import { PM_REPO_NAME } from "../domain/types";
import { rangeLabel, type VerseConflictData, type VerseConflictOptionId } from "../domain/verseConflictEvent";

function status(err: unknown): number | undefined {
  const value = (err as { status?: unknown } | null)?.status;
  return typeof value === "number" ? value : undefined;
}

function trunkRef(session: GtSession, data: VerseConflictData) {
  return { session, owner: data.pr.owner, repo: data.pr.repo, filepath: data.usfmPath };
}

export async function prepareVerseChoice(session: GtSession, data: VerseConflictData): Promise<ConflictPrepared> {
  let trunkText: string | null = null;
  let trunkError: string | undefined;
  try {
    const file = await readRepoFile({ ...trunkRef(session, data), branch: data.bookRef });
    trunkText = rangeText(file.text, data.range);
  } catch (err) {
    trunkError =
      status(err) === 404
        ? "No se encontró el borrador grupal. No se puede decidir desde aquí."
        : "No se pudo leer el borrador grupal. Vuelve a abrir la conversación.";
  }
  let sourceReason = sourceBlockReason(data);
  if (!sourceReason && data.range.kept === "tronco") {
    const tip = await getArchiveSha(
      dcsConfig(session.host),
      data.pr.owner,
      data.pr.repo,
      archiveRefName(data.book.toLowerCase(), data.conflictIssue),
      session.token,
    ).catch(() => null);
    if (!tip) sourceReason = `Falta el archivo del trabajo de #${data.conflictIssue}. Vuelve a pulsar Cerrar para crearlo.`;
  }
  return { trunkText, ...(trunkError ? { trunkError } : {}), sourceReason };
}

async function readArchive(session: GtSession, data: VerseConflictData, issue: number) {
  const ref = archiveRefName(data.book.toLowerCase(), issue);
  const tip = await getArchiveSha(dcsConfig(session.host), data.pr.owner, data.pr.repo, ref, session.token);
  if (!tip) return null;
  const file = await readRepoFile({ ...trunkRef(session, data), branch: tip });
  return { text: file.text, label: `${ref} @ ${tip}` };
}

/** Real USFM holding the displaced text: trunk blob before Cerrar, else the archived work. */
export async function resolveChoiceSource(
  session: GtSession,
  data: VerseConflictData,
): Promise<{ text: string; label: string }> {
  if (data.range.kept === "ultimo") {
    if (data.trunkSha) {
      try {
        const text = await readGitBlob(dcsConfig(session.host), data.pr.owner, data.pr.repo, data.trunkSha, session.token);
        return { text, label: `blob:${data.trunkSha}` };
      } catch {
        /* fall back to the other subtarea's archive */
      }
    }
    const archived = data.otherIssue ? await readArchive(session, data, data.otherIssue) : null;
    if (archived) return archived;
    throw new Error("No se encontró de dónde recuperar la otra versión. No se escribió nada.");
  }
  const own = await readArchive(session, data, data.conflictIssue);
  if (own) return own;
  throw new Error(`Falta el archivo del trabajo de #${data.conflictIssue}. Vuelve a pulsar Cerrar para crearlo.`);
}

export async function writeTrunkVerseChoice(params: {
  session: GtSession;
  data: VerseConflictData;
  source: { text: string; label: string };
  message: string;
}): Promise<{ wrote: boolean; commit?: string }> {
  const { session, data, source } = params;
  let commit: string | undefined;
  const { wrote } = await mergeIntoTrunkWithRetry(
    {
      read: () => readRepoFile({ ...trunkRef(session, data), branch: data.bookRef }),
      write: async (content, sha) => {
        const saved = await writeRepoFile({
          ...trunkRef(session, data),
          branch: data.bookRef,
          content,
          sha,
          message: params.message,
          step: "trunk-merge",
        });
        commit = saved.commitSha;
      },
      isShaConflict: (err) => err instanceof BootstrapError && (err.status === 409 || err.status === 422),
    },
    (trunk) => {
      if (rangeText(trunk, data.range) !== keptText(data).replace(/\s+/g, " ").trim()) {
        throw new Error(`El versículo ${rangeLabel(data.range)} cambió después del conflicto. No se escribió nada.`);
      }
      const patch = computeChoicePatch({
        trunk,
        source: source.text,
        range: data.range,
        expectedSourceText: displacedText(data),
      });
      if (!patch.ok) throw new Error(patch.reason);
      return { usfm: patch.usfm, conflicts: [], warnings: [] };
    },
  );
  return { wrote, ...(commit ? { commit } : {}) };
}

/** Run one option; posts `verse-choice` on both PM issues. Returns this thread's items. */
export async function runVerseChoice(params: {
  session: GtSession;
  pmOrg: string;
  data: VerseConflictData;
  decisionId: string;
  option: VerseConflictOptionId;
  threadIssue: number;
  /** Other undecided decisions in this thread; none → the conflict label goes. */
  remainingDecisions: string[];
  /** Project language + id; with them, pass marks of the touched subtareas are cleared. */
  lang?: string;
  projectId?: string;
}): Promise<ThreadItem[]> {
  const { session, pmOrg, data, option } = params;
  const by = session.username;
  let wrote = false;
  let commit: string | undefined;
  if (option === "desplazado") {
    const source = await resolveChoiceSource(session, data);
    ({ wrote, commit } = await writeTrunkVerseChoice({
      session,
      data,
      source,
      message: trunkChoiceCommitMessage({ data, option, by, source: source.label }),
    }));
  } else {
    const prepared = await prepareVerseChoice(session, data);
    if (prepared.trunkText === null) throw new Error(prepared.trunkError || "No se pudo leer el borrador grupal.");
    if (prepared.trunkText !== keptText(data).replace(/\s+/g, " ").trim()) {
      throw new Error(`El versículo ${rangeLabel(data.range)} cambió después del conflicto.`);
    }
  }
  const config = dcsConfig(session.host);
  const items: ThreadItem[] = [];
  const posts = buildVerseChoicePosts({ data, decisionId: params.decisionId, option, by, wrote, commit });
  for (const post of posts) {
    const comment = await createIssueComment(config, pmOrg, PM_REPO_NAME, post.issue, post.body, session.token);
    if (post.issue === params.threadIssue) items.push(commentToItem(comment, "issue", { owner: pmOrg, repo: PM_REPO_NAME }));
  }
  if (params.lang && params.projectId) {
    await clearPrincipalPassMarks({
      session,
      pmOrg,
      lang: params.lang,
      projectId: params.projectId,
      issues: verseChoiceIssues(data),
    }).catch(() => undefined);
  }
  if (!params.remainingDecisions.length) {
    for (const post of posts) await clearIssueConflict(session, pmOrg, post.issue).catch(() => undefined);
  }
  return items;
}
