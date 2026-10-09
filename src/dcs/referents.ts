import { normalizeReferentFile, type ReferentFile } from "../domain/referents";

async function readJson(name: string): Promise<unknown> {
  try {
    const answer = await fetch(`${import.meta.env.BASE_URL}referents/${name}.json`);
    return answer.ok ? await answer.json() : null;
  } catch {
    // Offline, or the page of the app answered in place of a file that is not there.
    return null;
  }
}

const files = new Map<string, Promise<ReferentFile | null>>();

/**
 * Who the words of a book refer to, served with the app. Read once for the book, the first time a word of it is
 * opened. `null` when it cannot be read; it is asked again the next time.
 */
export function loadReferents(book: string): Promise<ReferentFile | null> {
  const code = book.trim().toUpperCase();
  if (!/^[1-3A-Z][A-Z]{2}$/.test(code)) return Promise.resolve(null);
  const known = files.get(code);
  if (known) return known;
  const loading = readJson(code).then(normalizeReferentFile);
  files.set(code, loading);
  void loading.then((file) => {
    if (!file) files.delete(code);
  });
  return loading;
}
