/**
 * What a person writes down while studying a passage: something they found out, or something to keep in mind when
 * the passage is worked on later. A note is the person's own, or shared with the team. Each person's notes live in
 * their own file of the project (so two people never write over each other); the shared ones of everybody are read
 * together. The pure part is here; `dcs/studyNotes.ts` reads and writes.
 */
import { normalizeProjectId } from "./books";
import { scopeFolder } from "./scope";

export type StudyNoteKind = "found" | "remember";

export type StudyNote = {
  id: string;
  /** Who wrote it (Door43 login). */
  by: string;
  book: string;
  chapter: number;
  /** The verse it is about; absent = the chapter, or the book, in general. */
  verse?: number;
  /** The last verse, when it is about a passage and not one verse. */
  to?: number;
  kind: StudyNoteKind;
  /**
   * The resource it is about (the text, the notes, the questions…) and what the process calls it. A note is of the
   * resource it was written while working on; absent = of the passage in general (a task of several resources).
   */
  resource?: string;
  resourceName?: string;
  /** The task it was written in («Traducir TPL», «Afinar TPL»): where it comes from, for whoever reads it later. */
  task?: string;
  /**
   * The help this is a message about (the id of a translation note, a question or a term in its file): left by a
   * team whose work is not that help, for the team that will work on it.
   */
  about?: string;
  text: string;
  /** Shown to the whole team. A note that is not shared is only shown to its author. */
  shared: boolean;
  /** ISO time it was written. */
  at: string;
};

export const STUDY_NOTES_SCHEMA = "taller-study-notes-1";

const folder = (lang: string, projectId: string) => `${scopeFolder()}${lang.trim().toLowerCase()}/${normalizeProjectId(projectId)}/apuntes`;

export function studyNotesFolder(lang: string, projectId: string): string {
  return folder(lang, projectId);
}

export function studyNotesPath(lang: string, projectId: string, username: string): string {
  return `${folder(lang, projectId)}/${username.trim().toLowerCase()}.json`;
}

export function normalizeStudyNotes(raw: unknown, owner: string): StudyNote[] {
  const rows = raw && typeof raw === "object" && Array.isArray((raw as { notes?: unknown }).notes) ? ((raw as { notes: unknown[] }).notes ?? []) : [];
  const out: StudyNote[] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<StudyNote>;
    const id = String(row.id ?? "").trim();
    const text = String(row.text ?? "").trim();
    const book = String(row.book ?? "").trim().toUpperCase();
    const chapter = Number(row.chapter);
    if (!id || !text || !book || !(chapter >= 0) || out.some((have) => have.id === id)) continue;
    const verse = Number(row.verse);
    const to = Number(row.to);
    out.push({
      id,
      // A file is its owner's: whatever it says, its notes are theirs.
      by: owner,
      book,
      chapter: Math.floor(chapter),
      ...(Number.isInteger(verse) && verse > 0 ? { verse, ...(Number.isInteger(to) && to > verse ? { to } : {}) } : {}),
      kind: row.kind === "remember" ? "remember" : "found",
      ...(String(row.resource ?? "").trim() ? { resource: String(row.resource).trim().toLowerCase() } : {}),
      ...(String(row.resourceName ?? "").trim() ? { resourceName: String(row.resourceName).trim() } : {}),
      ...(String(row.task ?? "").trim() ? { task: String(row.task).trim() } : {}),
      ...(String(row.about ?? "").trim() ? { about: String(row.about).trim() } : {}),
      text,
      shared: row.shared === true,
      at: String(row.at ?? ""),
    });
  }
  return out;
}

/** The notes a person may see: all of their own, and the shared ones of everybody else. */
export function visibleStudyNotes(all: StudyNote[], me: string): StudyNote[] {
  const mine = me.trim().toLowerCase();
  return all.filter((note) => note.shared || note.by.toLowerCase() === mine);
}

/**
 * The notes that matter when working on a passage, the closest first: the ones about its verses, then the ones about
 * its chapter in general, then the ones about the book. Notes of other chapters are left out.
 */
export function studyNotesFor(notes: StudyNote[], where: { book: string; chapter: number; from?: number; to?: number }): StudyNote[] {
  const book = where.book.toUpperCase();
  // A note about a passage matters wherever its verses and the ones in hand overlap.
  const inPassage = (note: StudyNote) => note.chapter === where.chapter && note.verse !== undefined && (where.from === undefined || (note.verse <= (where.to ?? where.from) && (note.to ?? note.verse) >= where.from));
  const rank = (note: StudyNote) => (inPassage(note) ? 0 : note.chapter === where.chapter && note.verse === undefined ? 1 : note.chapter === 0 ? 2 : 3);
  return notes
    .filter((note) => note.book === book && (note.chapter === where.chapter || note.chapter === 0))
    .filter((note) => note.verse === undefined || where.from === undefined || inPassage(note))
    .sort((a, b) => rank(a) - rank(b) || (a.verse ?? 0) - (b.verse ?? 0) || a.at.localeCompare(b.at));
}

/**
 * The notes of a passage as whoever works on one resource needs them: first the ones of that resource and the ones
 * of no resource in particular, then, apart, the ones written about the other resources of the same passage.
 * Working on no resource in particular (a task of several), every note is «own».
 */
export function notesByResource(notes: StudyNote[], resource: string | undefined): { own: StudyNote[]; others: StudyNote[] } {
  const mine = (resource ?? "").trim().toLowerCase();
  if (!mine) return { own: notes, others: [] };
  return { own: notes.filter((note) => !note.resource || note.resource === mine), others: notes.filter((note) => note.resource && note.resource !== mine) };
}

/**
 * What a message about a key term names: the term, not one of its uses, since what is said about its article or its
 * translation holds wherever it appears.
 */
export function termMessageKey(kind: string, slug: string): string {
  return `tw:${kind.trim().toLowerCase()}/${slug.trim().toLowerCase()}`;
}

/** The shared messages left about one help of a book, oldest first: what a later team finds when it gets to it. */
export function messagesAbout(notes: StudyNote[], book: string, about: string): StudyNote[] {
  const code = book.toUpperCase();
  return notes.filter((note) => note.shared && note.about === about && note.book === code).sort((a, b) => a.at.localeCompare(b.at));
}

