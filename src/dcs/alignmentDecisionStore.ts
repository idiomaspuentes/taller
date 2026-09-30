import {
  createIssueComment,
  createOrUpdateContents,
  getContents,
  getRawContent,
  listIssueComments,
  type DcsIssue,
} from "@ip-lms/dcs-client";
import { tokenizeDocument } from "@usfm-tools/editor-core";
import type { AlignmentGroup } from "@usfm-tools/types";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import { appendMyDecision, isShaConflict, readRepoFile, type RepoTarget } from "./afinacionStore";
import { alignmentOfDraft, saveVerseAlignment, verseKey, type AlignmentSourceRef } from "./alignmentStore";
import { closeIssue, commentOnIssue, createDecisionIssue } from "./issues";
import { alignmentHash, groupsToLines } from "../domain/alignmentHash";
import {
  DECISION_DAYS,
  PROPOSALS_DIR,
  PROPOSAL_SCHEMA,
  RESULT_SCHEMA,
  deadlineFrom,
  newDecisionId,
  outcomeOf,
  parseProposalFilename,
  proposalPath,
  resultPath,
  type DecisionKind,
  type DecisionOptionId,
  type DecisionOutcome,
  type DecisionThresholds,
  type DecisionVote,
  type ProposalFile,
  type ResultFile,
} from "../domain/alignmentDecision";
import { formatChatEvent, parseChatEvent } from "../domain/chatEvent";
import {
  buildCloseEvent,
  buildDecisionEvent,
  buildVoteEvent,
  decisionId,
  decisionTitle,
  readDecisionThread,
  type DecisionEventData,
} from "../domain/chatEvents/alineacionDecision";
import { commentToItem, type ThreadItem } from "../domain/conversation";
import { PM_REPO_NAME } from "../domain/types";
import { tryParseUsj } from "../domain/usfmAst";

/**
 * A proposal or objection about the alignment of a verse, as a decision of the team.
 * The conversation and the votes live in a subtarea (issue); what must travel with the
 * text — the proposed alignment and what was decided — lives in the text repository,
 * each file written once by one person.
 */

const isNotFound = (err: unknown) => typeof err === "object" && err !== null && (err as { status?: number }).status === 404;

async function writeNewFile(session: GtSession, target: RepoTarget, path: string, content: string, message: string): Promise<boolean> {
  try {
    await createOrUpdateContents(dcsConfig(session.host), target.owner, target.repo, path, {
      content,
      message,
      branch: target.branch,
      token: session.token,
    });
    return true;
  } catch (err) {
    // Somebody wrote it first (two people closing at once): it is already there, which is fine.
    if (isShaConflict(err)) return false;
    throw err;
  }
}

/** The words of one verse of the group draft, to hash what the verse looks like now. */
export function draftWordsOf(usfm: string, chapter: number, verse: number): string[] {
  const usj = tryParseUsj(usfm);
  if (!usj) return [];
  const tokens = tokenizeDocument(usj);
  const sid = Object.keys(tokens).find((k) => {
    const m = /(\d+):(\d+)\s*$/.exec(k);
    return m && Number(m[1]) === chapter && Number(m[2]) === verse;
  });
  return sid ? tokens[sid]!.map((t) => t.surface) : [];
}

/** Hash of the alignment of a verse as it is in the group draft right now. */
export function currentVerseHash(usfm: string, book: string, chapter: number, verse: number, source: AlignmentSourceRef): string {
  const saved = alignmentOfDraft(usfm, book, source).verses[verseKey(book, chapter, verse)] ?? [];
  return alignmentHash(draftWordsOf(usfm, chapter, verse), saved);
}

export type OpenDecisionParams = {
  session: GtSession;
  pmOrg: string;
  task: { projectId: string; taskId: string; taskName: string; resource: "tpl" | "tps"; parentIssue: number };
  target: RepoTarget;
  draftFilepath: string;
  source: AlignmentSourceRef;
  book: string;
  chapter: number;
  verse: number;
  kind: DecisionKind;
  note: string;
  baseHash: string;
  /** The alignment of the verse now (for the card). */
  before: AlignmentGroup[];
  /** Proposals: the alignment wanted. */
  proposed?: AlignmentGroup[];
  /** Objections: the words of the original it is about. */
  words?: string[];
  /** Who aligned the verse (they are told, and do not count as independent). */
  aligners: string[];
  thresholds: DecisionThresholds;
  now?: Date;
};

/**
 * Sends a proposal or an objection: saves it in the text repository, records the sender's
 * own answer, opens the subtarea for the team and posts the card with the votes.
 */
export async function openAlignmentDecision(params: OpenDecisionParams): Promise<{ id: string; issue: DcsIssue; card: ThreadItem }> {
  const { session, pmOrg, target } = params;
  const now = params.now ?? new Date();
  const book = params.book.toUpperCase();
  const note = params.note.trim();
  if (!note) throw new Error("Escribe qué quieres cambiar y por qué.");
  if (params.kind === "proposal" && !params.proposed) throw new Error("Falta la alineación propuesta.");
  const id = newDecisionId(session.username, now);
  const path = proposalPath(book, params.chapter, params.verse, id);

  const data: DecisionEventData = {
    id,
    kind: params.kind,
    book,
    chapter: params.chapter,
    verse: params.verse,
    by: session.username,
    note,
    baseHash: params.baseHash,
    path,
    before: groupsToLines(params.before),
    after: params.proposed ? groupsToLines(params.proposed) : [],
    words: params.words ?? [],
    deadline: deadlineFrom(now, DECISION_DAYS),
    thresholds: params.thresholds,
    aligners: params.aligners,
    draft: { owner: target.owner, repo: target.repo, branch: target.branch, filepath: params.draftFilepath },
    source: params.source,
    parentIssue: params.task.parentIssue,
  };
  const issue = await createDecisionIssue(session, pmOrg, {
    projectId: params.task.projectId,
    taskId: params.task.taskId,
    taskName: params.task.taskName,
    resource: params.task.resource,
    book,
    chapter: params.chapter,
    verse: params.verse,
    decisionId: id,
    title: `${book} ${params.chapter}:${params.verse} · Decidir: ${params.kind === "proposal" ? "propuesta" : "objeción"} de @${session.username}`,
    text: `${decisionTitle(data)}.\n\n> ${note.replace(/\n/g, "\n> ")}\n\nEl equipo decide aquí, con comentarios y un voto por persona.`,
  });
  const file: ProposalFile = {
    schema: PROPOSAL_SCHEMA,
    id,
    kind: params.kind,
    book,
    chapter: params.chapter,
    verse: params.verse,
    by: session.username,
    createdAt: now.toISOString(),
    baseHash: params.baseHash,
    note,
    issue: issue.number,
    ...(params.kind === "proposal" ? { proposed: params.proposed } : { words: params.words ?? [] }),
  };
  await writeNewFile(session, target, path, `${JSON.stringify(file, null, 2)}\n`, `TAS: ${params.kind === "proposal" ? "propuesta" : "objeción"} ${book} ${params.chapter}:${params.verse} · ${id}`);

  // The sender's own answer: it keeps the verse from being agreed while the team decides.
  await appendMyDecision(session, target, book, {
    itemId: `al:${params.chapter}:${params.verse}`,
    ref: { start: { chapter: params.chapter, verse: params.verse } },
    sessionId: String(params.task.parentIssue || params.task.taskId),
    stageId: "afinacion",
    status: params.kind === "proposal" ? "revise" : "rejected",
    reviewer: session.username,
    timestamp: now.toISOString(),
    note,
    textHash: params.baseHash,
    proposalId: id,
  });

  const event = buildDecisionEvent(data, issue.number);
  const comment = await createIssueComment(
    dcsConfig(session.host),
    pmOrg,
    PM_REPO_NAME,
    issue.number,
    formatChatEvent(event, { visible: `${event.summary}\n\n> ${note.replace(/\n/g, "\n> ")}` }),
    session.token,
  );
  if (params.task.parentIssue) {
    await commentOnIssue(session, pmOrg, params.task.parentIssue, `Se abrió una decisión del equipo sobre ${book} ${params.chapter}:${params.verse}: #${issue.number}.`).catch(() => undefined);
  }
  return { id, issue, card: commentToItem(comment, "issue", { owner: pmOrg, repo: PM_REPO_NAME }) };
}

/** Every proposal and result saved for a book, to know what is open and what was decided. */
export async function loadProposalFiles(session: GtSession, target: RepoTarget, book: string): Promise<{ proposals: ProposalFile[]; results: ResultFile[] }> {
  const code = book.trim().toUpperCase();
  let names: { name: string; path: string }[] = [];
  try {
    const listing = await getContents(dcsConfig(session.host), target.owner, target.repo, PROPOSALS_DIR, { ref: target.branch, token: session.token });
    names = (Array.isArray(listing) ? listing : []).filter((e) => e.type === "file").map((e) => ({ name: e.name, path: e.path }));
  } catch (err) {
    if (isNotFound(err)) return { proposals: [], results: [] };
    throw err;
  }
  const proposals: ProposalFile[] = [];
  const results: ResultFile[] = [];
  await Promise.all(
    names.map(async (entry) => {
      const parts = parseProposalFilename(entry.name);
      if (!parts || parts.book !== code) return;
      try {
        const raw = JSON.parse(await getRawContent(dcsConfig(session.host), target.owner, target.repo, entry.path, { ref: target.branch, token: session.token })) as unknown;
        if (parts.part === "proposal") proposals.push(raw as ProposalFile);
        else results.push(raw as ResultFile);
      } catch {
        /* an unreadable file is skipped: it cannot settle or block anything */
      }
    }),
  );
  return { proposals, results };
}

/** The votes so far and, if it is over, the closing event, read from the decision's thread. */
export async function readDecisionVotes(session: GtSession, pmOrg: string, threadIssue: number, id: string) {
  const comments = await listIssueComments(dcsConfig(session.host), pmOrg, PM_REPO_NAME, threadIssue, session.token);
  const events = comments.flatMap((c) => {
    const event = parseChatEvent(c.body);
    return event ? [{ event, at: c.created_at ?? "" }] : [];
  });
  return readDecisionThread(events, id);
}

export async function postVote(session: GtSession, pmOrg: string, threadIssue: number, data: DecisionEventData, option: DecisionOptionId): Promise<ThreadItem> {
  const event = buildVoteEvent({ issue: threadIssue, data, by: session.username, option });
  const comment = await createIssueComment(dcsConfig(session.host), pmOrg, PM_REPO_NAME, threadIssue, formatChatEvent(event), session.token);
  return commentToItem(comment, "issue", { owner: pmOrg, repo: PM_REPO_NAME });
}

/**
 * Ends the decision. An accepted proposal is applied to the group draft only if the verse
 * is still as it was when the proposal was made; otherwise it expires. The outcome is
 * written once in the text repository and the subtarea is closed with a summary.
 */
export async function closeAlignmentDecision(params: {
  session: GtSession;
  pmOrg: string;
  threadIssue: number;
  data: DecisionEventData;
  option: DecisionOptionId;
  how: "consenso" | "coordinacion";
}): Promise<{ outcome: DecisionOutcome; items: ThreadItem[] }> {
  const { session, pmOrg, data } = params;
  const target: RepoTarget = { owner: data.draft.owner, repo: data.draft.repo, branch: data.draft.branch };
  let outcome = outcomeOf(data.kind, params.option);
  let newHash: string | undefined;

  if (outcome === "aceptada") {
    const current = await readRepoFile(session, target, data.draft.filepath);
    if (!current) throw new Error("No se encontró el borrador grupal de este libro.");
    if (currentVerseHash(current.text, data.book, data.chapter, data.verse, data.source) !== data.baseHash) {
      outcome = "caducada";
    } else {
      const proposalFile = await readRepoFile(session, target, data.path);
      const proposed = (proposalFile && (JSON.parse(proposalFile.text) as ProposalFile).proposed) || null;
      if (!proposed) throw new Error("No se pudo leer la propuesta guardada.");
      const saved = await saveVerseAlignment({
        session,
        target,
        filepath: data.draft.filepath,
        book: data.book,
        chapter: data.chapter,
        verse: data.verse,
        groups: proposed,
        source: data.source,
      });
      newHash = currentVerseHash(saved.usfm, data.book, data.chapter, data.verse, data.source);
    }
  }

  const result: ResultFile = {
    schema: RESULT_SCHEMA,
    id: data.id,
    kind: data.kind,
    book: data.book,
    chapter: data.chapter,
    verse: data.verse,
    outcome,
    by: session.username,
    how: params.how,
    at: new Date().toISOString(),
    proposer: data.by,
    baseHash: data.baseHash,
    issue: params.threadIssue,
    ...(newHash ? { newHash } : {}),
  };
  await writeNewFile(session, target, resultPath(data.book, data.chapter, data.verse, data.id), `${JSON.stringify(result, null, 2)}\n`, `TAS: decisión ${data.book} ${data.chapter}:${data.verse} · ${outcome} · ${data.id}`);

  const event = buildCloseEvent({ issue: params.threadIssue, data, outcome, how: params.how, by: session.username, aligners: data.aligners });
  const comment = await createIssueComment(dcsConfig(session.host), pmOrg, PM_REPO_NAME, params.threadIssue, formatChatEvent(event), session.token);
  await closeIssue(session, pmOrg, params.threadIssue).catch(() => undefined);
  if (data.parentIssue) {
    await commentOnIssue(session, pmOrg, data.parentIssue, `Decisión #${params.threadIssue} sobre ${data.book} ${data.chapter}:${data.verse}: ${event.summary}`).catch(() => undefined);
  }
  return { outcome, items: [commentToItem(comment, "issue", { owner: pmOrg, repo: PM_REPO_NAME })] };
}

export { decisionId };
export type { DecisionVote };
