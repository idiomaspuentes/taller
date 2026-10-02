import { createOrUpdateContents } from "@ip-lms/dcs-client";
import {
  createAlignmentDocument,
  extractAlignmentDocumentFromUsfm,
  mergeAlignmentIntoUsfm,
  parseAlignmentJson,
  serializeAlignmentJson,
} from "@usfm-tools/editor-core";
import type { AlignmentDocument, AlignmentGroup } from "@usfm-tools/types";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import { readRepoFile, isShaConflict, type RepoTarget } from "./afinacionStore";
import { withoutPunctuation } from "../domain/alignmentKeep";

/**
 * Saving the alignment of one verse. The group draft carries the marks
 * (`\zaln-s … \w … \zaln-e`) and the alignment layer keeps the same links as
 * data, like the editor of the enhanced project model: the verse is lifted
 * out of the current file, replaced, and put back, so two people aligning
 * different verses never overwrite each other.
 */

export type AlignmentSourceRef = { id: string; layerDir: string };

export function alignmentLayerPath(source: AlignmentSourceRef, book: string): string {
  return `alignments/${source.layerDir}/${book.toUpperCase()}.alignment.json`;
}

export function verseKey(book: string, chapter: number, verse: number): string {
  return `${book.toUpperCase()} ${chapter}:${verse}`;
}

function withVerse(doc: AlignmentDocument, key: string, groups: AlignmentGroup[]): AlignmentDocument {
  const verses = { ...doc.verses };
  if (groups.length) verses[key] = groups;
  else delete verses[key];
  return { ...doc, updated: new Date().toISOString(), verses };
}

/** Alignment of the verses of the group draft, as saved in its marks. */
export function alignmentOfDraft(usfm: string, book: string, source: AlignmentSourceRef): AlignmentDocument {
  return extractAlignmentDocumentFromUsfm(usfm, { id: book.toUpperCase() }, { id: source.id });
}

export async function saveVerseAlignment(params: {
  session: GtSession;
  target: RepoTarget;
  /** Path of the group draft inside the repository. */
  filepath: string;
  book: string;
  chapter: number;
  verse: number;
  groups: AlignmentGroup[];
  source: AlignmentSourceRef;
}): Promise<{ usfm: string; stored: AlignmentGroup[] }> {
  const { session, target, filepath, book, source } = params;
  const key = verseKey(book, params.chapter, params.verse);
  // A linked word is the word alone: "Hacalías." is saved as "Hacalías", or the period would be written twice.
  const groups = withoutPunctuation(params.groups);
  let usfm = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const current = await readRepoFile(session, target, filepath);
    if (!current) throw new Error("No se encontró el borrador grupal de este libro.");
    const doc = withVerse(alignmentOfDraft(current.text, book, source), key, groups);
    usfm = mergeAlignmentIntoUsfm(
      // marks off first, so only the verses of the document are woven back in
      current.text,
      doc,
    );
    try {
      await createOrUpdateContents(dcsConfig(session.host), target.owner, target.repo, filepath, {
        content: usfm,
        message: `TAS: alineación ${key}`,
        sha: current.sha,
        branch: target.branch,
        token: session.token,
      });
      break;
    } catch (err) {
      if (!isShaConflict(err) || attempt === 3) throw err;
    }
  }
  // What the marks of the draft can hold is what counts as saved: words that are not next to each other but go
  // with the same original word come back as one box with its neighbours. The layer keeps that same form, and the
  // caller gets it too, so the screen and any «Terminé» mark describe what a reload will show.
  const stored = alignmentOfDraft(usfm, book, source).verses[key] ?? [];
  await saveLayerVerse({ ...params, groups: stored });
  return { usfm, stored };
}

/** Same verse in `alignments/{source}/{BOOK}.alignment.json`, merged with whatever is there now. */
async function saveLayerVerse(params: {
  session: GtSession;
  target: RepoTarget;
  book: string;
  chapter: number;
  verse: number;
  groups: AlignmentGroup[];
  source: AlignmentSourceRef;
}): Promise<void> {
  const { session, target, book, source } = params;
  const path = alignmentLayerPath(source, book);
  const key = verseKey(book, params.chapter, params.verse);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const existing = await readRepoFile(session, target, path);
    let doc: AlignmentDocument;
    try {
      doc = existing ? parseAlignmentJson(existing.text) : createAlignmentDocument({ id: book.toUpperCase() }, { id: source.id });
    } catch {
      doc = createAlignmentDocument({ id: book.toUpperCase() }, { id: source.id });
    }
    const next = withVerse(doc, key, params.groups);
    try {
      await createOrUpdateContents(dcsConfig(session.host), target.owner, target.repo, path, {
        content: serializeAlignmentJson(next),
        message: `TAS: alineación ${key}`,
        sha: existing?.sha,
        branch: target.branch,
        token: session.token,
      });
      return;
    } catch (err) {
      if (!isShaConflict(err) || attempt === 3) throw err;
    }
  }
}
