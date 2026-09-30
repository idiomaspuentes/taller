import {
  DcsApiError,
  createOrUpdateContents,
  decodeBase64,
  getContents,
  getRawContent,
  type ContentsResponse,
} from "@ip-lms/dcs-client";
import type { CheckingDecisionsFile } from "@usfm-tools/types";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import { applyVerseEditsKeepingAlignment } from "../domain/alignmentKeep";
import { parsePreferredTerms, serializePreferredTerms, withPreferredTerm, type PreferredTerms } from "../domain/afinacionWords";
import { decisionsFilePath, type ReviewDecision } from "../domain/reviewRound";

/**
 * Reading and writing the checking data of a Afinación in the text repository
 * (enhanced project model): one decisions file per person, so two people
 * never write the same file, and the group draft itself for corrections.
 */

export type RepoTarget = { owner: string; repo: string; branch: string };

const DECISIONS_DIR = "checkings/decisions";

function isNotFound(err: unknown): boolean {
  return err instanceof DcsApiError && err.status === 404;
}

export function isShaConflict(err: unknown): boolean {
  return err instanceof DcsApiError && (err.status === 409 || err.status === 422);
}

export async function readRepoFile(
  session: GtSession,
  target: RepoTarget,
  filepath: string,
): Promise<{ text: string; sha: string } | null> {
  try {
    const hit = await getContents(dcsConfig(session.host), target.owner, target.repo, filepath, {
      ref: target.branch,
      token: session.token,
    });
    if (Array.isArray(hit) || hit.content === undefined) return null;
    return { text: decodeBase64(hit.content), sha: hit.sha };
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

function parseDecisionsFile(text: string, book: string): CheckingDecisionsFile | null {
  try {
    const parsed = JSON.parse(text) as Partial<CheckingDecisionsFile>;
    if (!parsed || !Array.isArray(parsed.decisions)) return null;
    return { book: String(parsed.book ?? book), decisions: parsed.decisions };
  } catch {
    return null;
  }
}

/** Every person's decisions file of the book, read as they are on the branch. */
export async function loadDecisionFiles(
  session: GtSession,
  target: RepoTarget,
  book: string,
): Promise<CheckingDecisionsFile[]> {
  const code = book.trim().toUpperCase();
  let entries: ContentsResponse[] = [];
  try {
    const listing = await getContents(dcsConfig(session.host), target.owner, target.repo, DECISIONS_DIR, {
      ref: target.branch,
      token: session.token,
    });
    entries = Array.isArray(listing) ? listing : [];
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
  const mine = entries.filter((e) => e.type === "file" && e.name.startsWith(`${code}.`) && e.name.endsWith(".decisions.json"));
  const files = await Promise.all(
    mine.map(async (entry) => {
      try {
        const text = await getRawContent(dcsConfig(session.host), target.owner, target.repo, entry.path, {
          ref: target.branch,
          token: session.token,
        });
        return parseDecisionsFile(text, code);
      } catch {
        return null;
      }
    }),
  );
  return files.filter((f): f is CheckingDecisionsFile => f !== null);
}

/** Add one answer to the signed-in person's own file. Retries once if the file moved meanwhile. */
export async function appendMyDecision(
  session: GtSession,
  target: RepoTarget,
  book: string,
  decision: ReviewDecision,
): Promise<void> {
  const filepath = decisionsFilePath(book, session.username);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const existing = await readRepoFile(session, target, filepath);
    const file = (existing && parseDecisionsFile(existing.text, book)) || { book: book.toUpperCase(), decisions: [] };
    file.decisions = [...file.decisions, decision];
    try {
      await createOrUpdateContents(dcsConfig(session.host), target.owner, target.repo, filepath, {
        content: `${JSON.stringify(file, null, 2)}\n`,
        message: `TAS: respuesta de revisión ${book.toUpperCase()} · ${decision.itemId}`,
        sha: existing?.sha,
        branch: target.branch,
        token: session.token,
      });
      return;
    } catch (err) {
      if (!isShaConflict(err) || attempt === 2) throw err;
    }
  }
}

export type CorrectionResult = { clearedVerses: number[]; reducedVerses: number[]; usfm: string };

/**
 * Anyone on the team may correct the text at any time. The verse is written
 * on the group draft; the word alignment of the words that did not change
 * is kept, and whatever depended on the old text turns stale by itself
 * (answers carry the fingerprint of the text they reviewed).
 */
export async function saveCorrection(params: {
  session: GtSession;
  target: RepoTarget;
  filepath: string;
  chapter: number;
  verse: number;
  text: string;
  reason: string;
  book: string;
}): Promise<CorrectionResult> {
  const { session, target, filepath } = params;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const current = await readRepoFile(session, target, filepath);
    if (!current) throw new Error("No se encontró el borrador grupal de este libro.");
    const kept = applyVerseEditsKeepingAlignment(current.text, params.chapter, [
      { verse: params.verse, text: params.text },
    ]);
    if (kept.usfm === current.text) return { clearedVerses: [], reducedVerses: [], usfm: current.text };
    const why = params.reason.trim();
    try {
      await createOrUpdateContents(dcsConfig(session.host), target.owner, target.repo, filepath, {
        content: kept.usfm,
        message: `TAS: corrección ${params.book.toUpperCase()} ${params.chapter}:${params.verse}${why ? ` · ${why}` : ""}`,
        sha: current.sha,
        branch: target.branch,
        token: session.token,
      });
      return { clearedVerses: kept.clearedVerses, reducedVerses: kept.reducedVerses, usfm: kept.usfm };
    } catch (err) {
      if (!isShaConflict(err) || attempt === 3) throw err;
    }
  }
  throw new Error("El borrador grupal cambió mientras se guardaba. Inténtalo de nuevo.");
}

const PREFERRED_TERMS_PATH = "checkings/preferred-terms.json";

/** The translation of each key term the team chose to keep across the book. */
export async function loadPreferredTerms(session: GtSession, target: RepoTarget): Promise<PreferredTerms> {
  const file = await readRepoFile(session, target, PREFERRED_TERMS_PATH);
  return file ? parsePreferredTerms(file.text) : {};
}

/** Choose (or, with an empty text, clear) the preferred translation of a term. Reads again and retries if the file moved. */
export async function savePreferredTerm(params: {
  session: GtSession;
  target: RepoTarget;
  slug: string;
  text: string;
}): Promise<PreferredTerms> {
  const { session, target } = params;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const existing = await readRepoFile(session, target, PREFERRED_TERMS_PATH);
    const next = withPreferredTerm(existing ? parsePreferredTerms(existing.text) : {}, params.slug, params.text, session.username, new Date().toISOString());
    try {
      await createOrUpdateContents(dcsConfig(session.host), target.owner, target.repo, PREFERRED_TERMS_PATH, {
        content: serializePreferredTerms(next),
        message: `TAS: traducción preferida · ${params.slug}`,
        sha: existing?.sha,
        branch: target.branch,
        token: session.token,
      });
      return next;
    } catch (err) {
      if (!isShaConflict(err) || attempt === 3) throw err;
    }
  }
  throw new Error("La lista de traducciones preferidas cambió mientras se guardaba. Inténtalo de nuevo.");
}
