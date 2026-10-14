import type { GtSession } from "./auth";
import { loadArticleInfo, loadChapterTexts, type OriginalWord } from "./afinacionLoad";
import { loadAssignmentsFromDcs } from "./persist";
import { loadBookNotes, type BookNote } from "./proposalList";
import { loadOriginalWords } from "./syntaxTree";
import { articlePathOf } from "../domain/afinacionNotes";
import type { SolverLaunchContext } from "../domain/solverLaunch";
import { resolveSourcePackage } from "../domain/sourcePackage";

/**
 * What a reason can cite of a verse, to be put in it by a touch: the words of the original, the verse in the
 * literal and the simple English, the notes of the verse and the Academy articles those notes point to. A reason
 * that names them was written by copying words from other screens, or not at all.
 */
export type VerseSources = {
  original: OriginalWord[];
  texts: { id: "ult" | "ust"; label: string; text: string }[];
  notes: BookNote[];
  articles: { path: string; title: string }[];
};

type BookTexts = { texts: Awaited<ReturnType<typeof loadChapterTexts>>; notes: Map<string, BookNote>; pkg: ReturnType<typeof resolveSourcePackage> };

// A book is read once while the app is open: a person writes several reasons in the same chapter.
const books = new Map<string, Promise<BookTexts>>();
const chapters = new Map<string, Promise<Record<string, OriginalWord[]>>>();
const articleTitles = new Map<string, string>();

function bookOf(session: GtSession, ctx: SolverLaunchContext): Promise<BookTexts> {
  const book = (ctx.book || ctx.projectId || "").toUpperCase();
  const key = `${session.host}|${ctx.pmOrg}|${ctx.projectId}|${book}`;
  if (!books.has(key)) {
    const loading = (async () => {
      const board = await loadAssignmentsFromDcs(session, ctx.pmOrg, ctx.lang, ctx.projectId || book, ctx.contentOrg).catch(() => null);
      const pkg = resolveSourcePackage(board?.settings);
      // Only the English texts: the team's own is the one being changed, in view where the reason is written.
      const [texts, notes] = await Promise.all([
        loadChapterTexts({ session, book, pkg, draft: { owner: "", repo: "", branch: "", filepath: "" }, draftLabel: "" }).catch(() => []),
        board ? loadBookNotes(session, ctx, board).catch(() => new Map<string, BookNote>()) : Promise.resolve(new Map<string, BookNote>()),
      ]);
      return { texts, notes, pkg };
    })();
    loading.catch(() => books.delete(key));
    books.set(key, loading);
  }
  return books.get(key)!;
}

export async function loadVerseSources(session: GtSession, ctx: SolverLaunchContext, chapter: number, verse: number): Promise<VerseSources> {
  const book = (ctx.book || ctx.projectId || "").toUpperCase();
  const chapterKey = `${session.host}|${book}|${chapter}`;
  if (!chapters.has(chapterKey)) chapters.set(chapterKey, loadOriginalWords(session, book, chapter).catch(() => ({})));
  const [read, words] = await Promise.all([bookOf(session, ctx), chapters.get(chapterKey)!]);
  const key = `${chapter}:${verse}`;
  const notes = [...read.notes.values()].filter((note) => {
    const at = /^(\d+):(\d+)(?:[-–](\d+))?/.exec(note.ref);
    return at ? Number(at[1]) === chapter && Number(at[2]) <= verse && verse <= Number(at[3] ?? at[2]) : false;
  });
  const paths = [...new Set(notes.map((note) => articlePathOf(note.supportRef)).filter(Boolean))];
  const unknown = paths.filter((path) => !articleTitles.has(path));
  if (unknown.length) {
    const found = await loadArticleInfo(session, ctx, read.pkg, unknown).catch(() => ({}) as Record<string, { title: string }>);
    for (const path of unknown) articleTitles.set(path, found[path]?.title ?? "");
  }
  return {
    original: words[key] ?? [],
    texts: read.texts.filter((row): row is typeof row & { id: "ult" | "ust" } => row.id === "ult" || row.id === "ust").flatMap((row) => (row.book[key] ? [{ id: row.id, label: row.label, text: row.book[key]! }] : [])),
    notes,
    articles: paths.map((path) => ({ path, title: articleTitles.get(path) || path })),
  };
}
