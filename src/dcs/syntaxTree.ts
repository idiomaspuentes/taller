import type { GtSession } from "./auth";
import { originalWordsOf, type OriginalWord } from "./afinacionLoad";
import { loadSourceChapter } from "./sourceTexts";
import { originalTextRef } from "../domain/sourcePackage";
import { normalizeTreeFile, type TreeFile } from "../domain/syntaxTree";

const files = new Map<string, Promise<TreeFile | null>>();

/**
 * How the sentences of a book are put together, served with the app. Read once for the book, the first time a
 * sentence of it is opened. `null` when it cannot be read; it is asked again the next time.
 */
export function loadTrees(book: string): Promise<TreeFile | null> {
  const code = book.trim().toUpperCase();
  if (!/^[1-3A-Z][A-Z]{2}$/.test(code)) return Promise.resolve(null);
  const known = files.get(code);
  if (known) return known;
  const loading = fetch(`${import.meta.env.BASE_URL}trees/${code}.json`)
    .then((answer) => (answer.ok ? answer.json() : null))
    .then(normalizeTreeFile)
    // Offline, or the page of the app answered in place of a file that is not there.
    .catch(() => null);
  files.set(code, loading);
  void loading.then((file) => {
    if (!file) files.delete(code);
  });
  return loading;
}

/** The words of a chapter of the original as the app's text tags them, by `"chapter:verse"`, in their order. */
export async function loadOriginalWords(session: GtSession, book: string, chapter: number): Promise<Record<string, OriginalWord[]>> {
  const usfm = await loadSourceChapter(session, originalTextRef(book), chapter).catch(() => null);
  return originalWordsOf(usfm);
}
