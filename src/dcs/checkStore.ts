import { isWriteRace, raceDelay } from "./afinacionStore";
import { DcsApiError, createOrUpdateContents, getContents, getRawContent, type ContentsResponse } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import type { CheckAnswer } from "../domain/checklist";

/**
 * Where the answers of a checklist are kept: one JSON file per person, on a branch of its own in the content
 * repository (people can write there; nothing is added to the published branch). The branch is created from the
 * default one the first time somebody answers.
 */
export const CHECKS_BRANCH = "taller-checks";

export type CheckTarget = { owner: string; repo: string; defaultBranch?: string };

const dirOf = (key: string): string => `checklists/${key}`;
const fileOf = (key: string, login: string): string => `${dirOf(key)}/${login.trim().toLowerCase()}.json`;

const isNotFound = (err: unknown): boolean => err instanceof DcsApiError && err.status === 404;

/**
 * Writes to the same file go one after another. Answering several questions in a row would otherwise send two
 * writes at once: both find the file missing (or at the same version) and Door43 refuses the second.
 */
const turns = new Map<string, Promise<unknown>>();
function inTurn<T>(file: string, job: () => Promise<T>): Promise<T> {
  const next = (turns.get(file) ?? Promise.resolve()).catch(() => undefined).then(job);
  turns.set(file, next);
  return next;
}
const ATTEMPTS = 4;

function decode(content: string): string {
  const binary = atob(content.replace(/\s+/g, ""));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

function parse(text: string): CheckAnswer[] {
  try {
    const rows = JSON.parse(text) as unknown;
    return Array.isArray(rows) ? (rows as CheckAnswer[]).filter((row) => row && typeof row.itemId === "string" && typeof row.questionId === "string") : [];
  } catch {
    return [];
  }
}

/** Everybody's answers of one checklist. An empty list when nobody has answered (or the branch does not exist). */
export async function loadCheckAnswers(session: GtSession, target: CheckTarget, key: string): Promise<CheckAnswer[]> {
  const config = dcsConfig(session.host);
  let entries: ContentsResponse[] = [];
  try {
    const listing = await getContents(config, target.owner, target.repo, dirOf(key), { ref: CHECKS_BRANCH, token: session.token });
    entries = Array.isArray(listing) ? listing : [];
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
  const files = await Promise.all(
    entries
      .filter((entry) => entry.type === "file" && entry.name.endsWith(".json"))
      .map((entry) => getRawContent(config, target.owner, target.repo, entry.path, { ref: CHECKS_BRANCH, token: session.token }).then(parse).catch(() => [] as CheckAnswer[])),
  );
  return files.flat();
}

/** Add answers to the signed-in person's own file. Retries once when the file moved meanwhile. */
export function appendCheckAnswers(session: GtSession, target: CheckTarget, key: string, answers: CheckAnswer[]): Promise<void> {
  const filepath = fileOf(key, session.username);
  const file = `${target.owner}/${target.repo}/${filepath}`;
  // Answers given while a write is on its way wait together and go in the next one: a person answering four
  // questions in a row makes one or two writes, not four.
  const batch = waiting.get(file) ?? { answers: [], done: [] };
  waiting.set(file, batch);
  batch.answers.push(...answers);
  return new Promise<void>((resolve, reject) => {
    batch.done.push({ resolve, reject });
    void inTurn(file, async () => {
      const mine = waiting.get(file);
      if (!mine?.answers.length) return;
      waiting.delete(file);
      try {
        await appendNow(session, target, key, filepath, mine.answers);
        for (const waiter of mine.done) waiter.resolve();
      } catch (err) {
        for (const waiter of mine.done) waiter.reject(err);
      }
    });
  });
}

const waiting = new Map<string, { answers: CheckAnswer[]; done: { resolve: () => void; reject: (err: unknown) => void }[] }>();

async function appendNow(session: GtSession, target: CheckTarget, key: string, filepath: string, answers: CheckAnswer[]): Promise<void> {
  const config = dcsConfig(session.host);
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let existing: { text: string; sha: string } | null = null;
    let branchExists = true;
    try {
      const hit = await getContents(config, target.owner, target.repo, filepath, { ref: CHECKS_BRANCH, token: session.token });
      if (!Array.isArray(hit) && hit.content !== undefined) existing = { text: decode(hit.content), sha: hit.sha };
    } catch (err) {
      if (!isNotFound(err)) throw err;
      // The file is missing: either nobody of this person answered yet, or the branch itself does not exist.
      try {
        await getContents(config, target.owner, target.repo, "", { ref: CHECKS_BRANCH, token: session.token });
      } catch (inner) {
        if (isNotFound(inner)) branchExists = false;
        else throw inner;
      }
    }
    const content = `${JSON.stringify([...(existing ? parse(existing.text) : []), ...answers], null, 2)}\n`;
    try {
      await createOrUpdateContents(config, target.owner, target.repo, filepath, {
        content,
        message: `Taller: lista de comprobación ${key}`,
        sha: existing?.sha,
        ...(branchExists ? { branch: CHECKS_BRANCH } : { branch: target.defaultBranch, new_branch: CHECKS_BRANCH }),
        token: session.token,
      });
      return;
    } catch (err) {
      if (!isWriteRace(err) || attempt === ATTEMPTS) throw err;
      await raceDelay(attempt);
    }
  }
}

/** One whole document per person (a report), kept beside the checklists. */
export async function loadPersonDocs<T>(session: GtSession, target: CheckTarget, key: string): Promise<{ login: string; doc: T }[]> {
  const config = dcsConfig(session.host);
  let entries: ContentsResponse[] = [];
  try {
    const listing = await getContents(config, target.owner, target.repo, dirOf(key), { ref: CHECKS_BRANCH, token: session.token });
    entries = Array.isArray(listing) ? listing : [];
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
  const docs = await Promise.all(
    entries
      .filter((entry) => entry.type === "file" && entry.name.endsWith(".json"))
      .map(async (entry) => {
        try {
          const text = await getRawContent(config, target.owner, target.repo, entry.path, { ref: CHECKS_BRANCH, token: session.token });
          return { login: entry.name.replace(/\.json$/, ""), doc: JSON.parse(text) as T };
        } catch {
          return null;
        }
      }),
  );
  return docs.filter((row): row is { login: string; doc: T } => row !== null);
}

/** Replace the signed-in person's own document. Retries once when the file moved meanwhile. */
export function savePersonDoc<T>(session: GtSession, target: CheckTarget, key: string, doc: T): Promise<void> {
  const filepath = fileOf(key, session.username);
  return inTurn(`${target.owner}/${target.repo}/${filepath}`, () => saveDocNow(session, target, key, filepath, doc));
}

async function saveDocNow<T>(session: GtSession, target: CheckTarget, key: string, filepath: string, doc: T): Promise<void> {
  const config = dcsConfig(session.host);
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let sha: string | undefined;
    let branchExists = true;
    try {
      const hit = await getContents(config, target.owner, target.repo, filepath, { ref: CHECKS_BRANCH, token: session.token });
      if (!Array.isArray(hit)) sha = hit.sha;
    } catch (err) {
      if (!isNotFound(err)) throw err;
      try {
        await getContents(config, target.owner, target.repo, "", { ref: CHECKS_BRANCH, token: session.token });
      } catch (inner) {
        if (isNotFound(inner)) branchExists = false;
        else throw inner;
      }
    }
    try {
      await createOrUpdateContents(config, target.owner, target.repo, filepath, {
        content: `${JSON.stringify(doc, null, 2)}\n`,
        message: `Taller: reporte ${key}`,
        sha,
        ...(branchExists ? { branch: CHECKS_BRANCH } : { branch: target.defaultBranch, new_branch: CHECKS_BRANCH }),
        token: session.token,
      });
      return;
    } catch (err) {
      if (!isWriteRace(err) || attempt === ATTEMPTS) throw err;
      await raceDelay(attempt);
    }
  }
}
