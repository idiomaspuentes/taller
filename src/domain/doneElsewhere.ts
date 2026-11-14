import { scopeFolder } from "./scope";

/**
 * The work of a space done before Taller: a book published years ago (Titus), or a book brought in the middle
 * (Ephesians), whose finished tasks are nobody's work to do here. Subtareas are for the work done from now on in
 * Taller, so this work is not laid out as subtareas: it is listed here, one record per space in the plan repository
 * (`es-419/fuera-de-taller.json`), and the panels read it beside the real subtareas (`bookStanding.ts`).
 *
 * Per book: where the work was done, when, and for each task of the process (the ids of the process package) the
 * chapters done, or `"todo"`, or how much of each chapter (`{ "3": 0.875 }`: 35 of its 40 notes checked in
 * translationCore). A book whose every task was done says `"tasks": "todo"`.
 *
 * ```json
 * { "schema": "taller-fuera-1", "process": "<id del proceso>",
 *   "books": { "TIT": { "from": "publicado", "at": "2026-08-11", "tasks": "todo" },
 *              "EPH": { "from": "translationCore", "tasks": { "tpl": "todo", "tps": [1, 2, 3] } } } }
 * ```
 */

export const DONE_ELSEWHERE_SCHEMA = "taller-fuera-1";

/** `from` of a book that was published before Taller: it is said «Publicado» rather than «Terminado». */
export const PUBLISHED_FROM = "publicado";

/** The chapters of a task done elsewhere: every one, these, or how much of each one (0 to 1, by chapter). */
export type ChaptersDone = "todo" | number[] | Record<number, number>;

export type BookDoneElsewhere = {
  /** Where the work was done: «publicado», «translationCore», «hoja de cálculo»… Shown as it is written. */
  from: string;
  /** When it was published, or brought. */
  at?: string;
  /** Every task of the book, or the chapters of each task. */
  tasks: "todo" | Record<string, ChaptersDone>;
};

export type DoneElsewhereDoc = {
  schema: typeof DONE_ELSEWHERE_SCHEMA;
  /** The process whose tasks the ids name (a workflow id of a process package); the first shipped one when absent. */
  process?: string;
  books: Record<string, BookDoneElsewhere>;
  updated_at?: string;
};

export function emptyDoneElsewhere(): DoneElsewhereDoc {
  return { schema: DONE_ELSEWHERE_SCHEMA, books: {} };
}

/** Where the record of a space lives in the plan repository: beside its index of projects. */
export function doneElsewherePath(lang: string): string {
  return `${scopeFolder()}${lang.trim().toLowerCase()}/fuera-de-taller.json`;
}

function chaptersDone(raw: unknown): ChaptersDone | null {
  if (raw === "todo") return "todo";
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const shares: Record<number, number> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const chapter = Number(key);
      if (!Number.isInteger(chapter) || chapter < 1 || typeof value !== "number" || !(value > 0)) continue;
      shares[chapter] = Math.min(1, value);
    }
    return Object.keys(shares).length ? shares : null;
  }
  if (!Array.isArray(raw)) return null;
  const chapters = [...new Set(raw.filter((value): value is number => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
  return chapters.length ? chapters : null;
}

function bookDone(raw: unknown): BookDoneElsewhere | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { from?: unknown; at?: unknown; tasks?: unknown };
  const from = typeof row.from === "string" ? row.from.trim() : "";
  let tasks: BookDoneElsewhere["tasks"] | null = null;
  if (row.tasks === "todo") tasks = "todo";
  else if (row.tasks && typeof row.tasks === "object" && !Array.isArray(row.tasks)) {
    const out: Record<string, ChaptersDone> = {};
    for (const [taskId, value] of Object.entries(row.tasks as Record<string, unknown>)) {
      const chapters = chaptersDone(value);
      if (taskId.trim() && chapters) out[taskId.trim()] = chapters;
    }
    if (Object.keys(out).length) tasks = out;
  }
  if (!tasks) return null;
  return { from, ...(typeof row.at === "string" && row.at.trim() ? { at: row.at.trim() } : {}), tasks };
}

/** The record as it is read: unknown books and tasks without chapters are left out; another format is not read. */
export function normalizeDoneElsewhere(raw: unknown): DoneElsewhereDoc {
  const doc = emptyDoneElsewhere();
  if (!raw || typeof raw !== "object") return doc;
  const row = raw as { schema?: unknown; process?: unknown; books?: unknown; updated_at?: unknown };
  if (row.schema !== DONE_ELSEWHERE_SCHEMA) return doc;
  if (typeof row.process === "string" && row.process.trim()) doc.process = row.process.trim();
  if (typeof row.updated_at === "string") doc.updated_at = row.updated_at;
  if (row.books && typeof row.books === "object" && !Array.isArray(row.books)) {
    for (const [code, value] of Object.entries(row.books as Record<string, unknown>)) {
      const book = code.trim().toUpperCase();
      const done = bookDone(value);
      if (book && done) doc.books[book] = done;
    }
  }
  return doc;
}

/** How much of each chapter of a task was done elsewhere (1 for a whole one), among the chapters the book has. */
export function chaptersDoneElsewhere(entry: BookDoneElsewhere | undefined, taskId: string, chapters: number): Map<number, number> {
  const all = Array.from({ length: Math.max(0, chapters) }, (_, i) => i + 1);
  if (!entry) return new Map();
  const done = entry.tasks === "todo" ? "todo" : entry.tasks[taskId];
  if (!done) return new Map();
  if (done === "todo") return new Map(all.map((chapter) => [chapter, 1]));
  if (Array.isArray(done)) return new Map(done.filter((chapter) => chapter <= chapters).map((chapter) => [chapter, 1]));
  return new Map(Object.entries(done).map(([chapter, share]) => [Number(chapter), share] as [number, number]).filter(([chapter]) => chapter <= chapters).sort((a, b) => a[0] - b[0]));
}
