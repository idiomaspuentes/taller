import { getRawContent } from "@ip-lms/dcs-client";
import type { AlignmentMap } from "@usfm-tools/types";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import { tryParseUsjWithAlignments } from "../domain/usfmAst";

/** A text whose alignment with the original is read: a book file in a repository, on a branch or its default one. */
export type AlignedTextRef = { owner: string; repo: string; filepath: string; branch?: string; label: string };

const books = new Map<string, Promise<AlignmentMap | null>>();

/**
 * The alignment of a whole book with the original, read once per text and kept while the app is open: a sentence
 * of the diagram and the next one are of the same book. `null` when the file cannot be read; it is asked again.
 */
export function loadBookAlignments(session: GtSession, ref: AlignedTextRef): Promise<AlignmentMap | null> {
  const key = `${session.host}|${ref.owner}/${ref.repo}@${ref.branch ?? ""}/${ref.filepath}`;
  const known = books.get(key);
  if (known) return known;
  const loading = getRawContent(dcsConfig(session.host), ref.owner, ref.repo, ref.filepath, { token: session.token, ...(ref.branch ? { ref: ref.branch } : {}) })
    .then((raw) => (raw ? (tryParseUsjWithAlignments(raw)?.alignments ?? null) : null))
    .catch(() => null);
  books.set(key, loading);
  void loading.then((map) => {
    if (!map) books.delete(key);
  });
  return loading;
}
