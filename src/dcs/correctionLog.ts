import { createOrUpdateContents, getContents, getRawContent, type ContentsResponse } from "@ip-lms/dcs-client";
import { CORRECTIONS_DIR, correctionsFilePath, mergeCorrectionFiles, normalizeCorrection, parseCorrectionsFile, serializeCorrectionsFile, type Correction, type CorrectionsFile } from "../domain/correctionLog";
import { isWriteRace, raceDelay, readRepoFile, type RepoTarget } from "./afinacionStore";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";

/**
 * The record of corrections of a book (see `domain/correctionLog`), beside the team's answers in the text repository:
 * one file per person, so two people never write the same one.
 */

const keyOf = (session: GtSession, target: RepoTarget, book: string) => `${session.host}|${target.owner}/${target.repo}@${target.branch}:${book.trim().toUpperCase()}`.toLowerCase();

const read = new Map<string, Promise<Correction[]>>();
const listeners = new Set<() => void>();

/** Told when a correction is saved from this device, so a list on screen shows it without asking Door43 again. */
export function onCorrectionSaved(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

async function readAll(session: GtSession, target: RepoTarget, book: string): Promise<Correction[]> {
  const code = book.trim().toUpperCase();
  let entries: ContentsResponse[] = [];
  try {
    const listing = await getContents(dcsConfig(session.host), target.owner, target.repo, CORRECTIONS_DIR, { ref: target.branch, token: session.token });
    entries = Array.isArray(listing) ? listing : [];
  } catch {
    // No folder yet: nobody has corrected anything of this text.
    return [];
  }
  const files = await Promise.all(
    entries
      .filter((entry) => entry.type === "file" && entry.name.startsWith(`${code}.`) && entry.name.endsWith(".corrections.json"))
      .map((entry) =>
        getRawContent(dcsConfig(session.host), target.owner, target.repo, entry.path, { ref: target.branch, token: session.token })
          .then((text) => parseCorrectionsFile(text, code))
          .catch(() => null),
      ),
  );
  return mergeCorrectionFiles(files.filter((file): file is CorrectionsFile => file !== null));
}

/** Everyone's corrections of a book, in the order they were made. Asked once per visit. */
export function loadCorrections(session: GtSession, target: RepoTarget, book: string): Promise<Correction[]> {
  const key = keyOf(session, target, book);
  let found = read.get(key);
  if (!found) {
    found = readAll(session, target, book);
    found.catch(() => read.delete(key));
    read.set(key, found);
  }
  return found;
}

/** Writes to a person's file go one after another: two corrections in a row must not race each other. */
const turns = new Map<string, Promise<unknown>>();

/**
 * Adds a correction to the signed-in person's own file. The text is already corrected when this is called: a record
 * that cannot be written is tried again, and given up on without undoing the correction.
 */
export function appendMyCorrection(session: GtSession, target: RepoTarget, book: string, correction: Omit<Correction, "by" | "at">): Promise<void> {
  const row = normalizeCorrection({ ...correction, by: session.username, at: new Date().toISOString() });
  if (!row) return Promise.resolve();
  const filepath = correctionsFilePath(book, session.username);
  const turn = `${target.owner}/${target.repo}@${target.branch}:${filepath}`;
  const next = (turns.get(turn) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      for (let attempt = 1; attempt <= 4; attempt++) {
        const existing = await readRepoFile(session, target, filepath);
        const file = (existing && parseCorrectionsFile(existing.text, book)) || { book: book.trim().toUpperCase(), corrections: [] };
        try {
          await createOrUpdateContents(dcsConfig(session.host), target.owner, target.repo, filepath, {
            content: serializeCorrectionsFile({ ...file, corrections: [...file.corrections, row] }),
            message: `TAS: registro de corrección ${book.trim().toUpperCase()} ${row.chapter}:${row.verse}`,
            sha: existing?.sha,
            branch: target.branch,
            token: session.token,
          });
          break;
        } catch (err) {
          if (!isWriteRace(err) || attempt === 4) throw err;
          await raceDelay(attempt);
        }
      }
      // What is on screen learns of it without reading Door43 again.
      const key = keyOf(session, target, book);
      const had = read.get(key);
      if (had) read.set(key, had.then((list) => [...list, row]));
      listeners.forEach((fn) => fn());
    });
  turns.set(turn, next);
  return next;
}
