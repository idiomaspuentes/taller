import type { GtSession } from "./auth";
import { originalWordsOf, type OriginalWord } from "./afinacionLoad";
import { loadSourceChapter, type SourceFile } from "./sourceTexts";
import { normalizeParallelFile, versesOfRef, type ParallelFile, type ParallelRef } from "../domain/parallels";
import { englishScriptureKindRef } from "../domain/referenceResources";
import { originalTextRef } from "../domain/sourcePackage";
import { tryParseUsj, verseTextsFromUsj, type VerseTextMap } from "../domain/usfmAst";
import { bookUsfmName } from "../prep/discover";

const asset = (name: string) => `${import.meta.env.BASE_URL}parallels/${name}.json`;

async function readJson(name: string): Promise<unknown> {
  try {
    const answer = await fetch(asset(name));
    return answer.ok ? await answer.json() : null;
  } catch {
    // Offline, or the page of the app answered in place of a file that is not there.
    return null;
  }
}

let index: Promise<Set<string>> | undefined;
const files = new Map<string, Promise<ParallelFile | null>>();

/** The parallel passages of a book, served with the app. `null` for a book that has none, or offline. */
export function loadParallels(book: string): Promise<ParallelFile | null> {
  const code = book.trim().toUpperCase();
  const known = files.get(code);
  if (known) return known;
  index ??= readJson("index").then((raw) => new Set(((raw as { books?: unknown } | null)?.books as string[] | undefined) ?? []));
  const loading = index.then((books) => (books.has(code) ? readJson(code).then(normalizeParallelFile) : null));
  files.set(code, loading);
  // What could not be read is asked again the next time.
  void loading.then((file) => {
    if (file) return;
    files.delete(code);
    void index?.then((books) => (books.size ? undefined : (index = undefined)));
  });
  return loading;
}

/** A text of the verses of a reference: its chapter, to be shown in its lines, and the verses as plain text. */
export type ParallelText = { usfm: string; verses: VerseTextMap };

export type ParallelTexts = {
  original: (ParallelText & { words: Record<string, OriginalWord[]> }) | null;
  ult: ParallelText | null;
  team: ParallelText | null;
};

async function readText(session: GtSession, file: SourceFile, ref: ParallelRef): Promise<ParallelText | null> {
  const usfm = await loadSourceChapter(session, file, ref.chapter).catch(() => null);
  if (!usfm?.trim()) return null;
  const numbers = versesOfRef(ref);
  const usj = tryParseUsj(usfm);
  const verses = (usj ? verseTextsFromUsj(usj, { chapter: ref.chapter, from: numbers[0]!, to: numbers[numbers.length - 1]! }) : null) ?? {};
  return numbers.some((verse) => verses[verse]?.trim()) ? { usfm, verses } : null;
}

/**
 * What is read of a parallel passage: the original, the ULT, and the team's own text when it has that book.
 * Each one that cannot be read is `null`; the others are still shown.
 */
export async function loadParallelTexts(session: GtSession, ref: ParallelRef, team?: { owner: string; repo: string }): Promise<ParallelTexts> {
  const [original, ult, own] = await Promise.all([
    readText(session, originalTextRef(ref.book), ref),
    readText(session, englishScriptureKindRef("ult", ref.book), ref),
    team ? readText(session, { ...team, filepath: bookUsfmName(ref.book) }, ref) : Promise.resolve(null),
  ]);
  return { original: original ? { ...original, words: originalWordsOf(original.usfm) } : null, ult, team: own };
}
