/**
 * Scripture mini-app: verses of the subtarea's portion that a reply can
 * quote. Display only (normalized text): never written back to USFM.
 */
import type { CiteTarget } from "./conversation";
import { listVerseSpans, normalizeVerseText, parseRefRange } from "./usfmEdit";

export function scriptureCiteTargets(usfm: string, book: string, ref: string): CiteTarget[] {
  const scope = parseRefRange(ref);
  if (!scope) return [];
  const code = book.toUpperCase();
  return listVerseSpans(usfm)
    .filter((s) => s.chapter === scope.chapter && s.verseTo >= scope.from && s.verse <= scope.to)
    .map((s) => {
      const verse = s.verseTo > s.verse ? `${s.verse}-${s.verseTo}` : `${s.verse}${s.segment ?? ""}`;
      return {
        id: `${s.chapter}:${verse}`,
        ref: `${code} ${s.chapter}:${verse}`,
        text: normalizeVerseText(s.rawBody).replace(/\s+/g, " ").trim(),
      };
    })
    .filter((t) => t.text);
}
