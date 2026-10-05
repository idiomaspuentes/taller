/**
 * Port of idiomas-puentes-docs/scripts/fcr_status/check.py.
 * Apply the leftover-English heuristic to fetched article files.
 */

import {
  analyzeFile,
  decideArticle,
  fileEvidenceToDict,
  twParentPath,
  STATUS_ENGLISH,
  STATUS_INCOMPLETE,
  STATUS_TRANSLATED,
  type ArticleDecision,
} from "./detect";
import { KIND_PALABRAS, type ArticleRef } from "./collect";
import type { ArticleClient, FetchedArticle } from "./dcs";

export const STATUS_MISSING = "missing";

export type ArticleStatus = {
  ref: ArticleRef;
  status: string;
  fetched: FetchedArticle;
  evidence: Record<string, unknown>;
  /** The article's title in the source language. It is the source that is translated, so that is its name here. */
  sourceTitle?: string;
};

/** The title an article gives itself: the first line of its `title.md`, or else its first heading. */
export function titleIn(files: [string, string][]): string {
  for (const [path, text] of files) {
    const name = path.replace(/\\/g, "/").split("/").pop()!.toLowerCase();
    if (name === "title.md") {
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) return line.trim();
      }
      return "";
    }
  }
  for (const [, text] of files) {
    for (const line of text.split(/\r?\n/)) {
      const stripped = line.trim();
      if (stripped.startsWith("#")) return stripped.replace(/^#+/, "").trim();
    }
  }
  return "";
}

function englishFor(path: string, enFiles: [string, string][]): string | null {
  const want = path.replace(/\\/g, "/");
  const name = want.slice(want.lastIndexOf("/") + 1).toLowerCase();
  const byName = new Map<string, string>();
  for (const [epath, etext] of enFiles) {
    const rel = epath.replace(/\\/g, "/");
    if (rel === want || rel.endsWith(`/${want}`)) return etext;
    byName.set(rel.slice(rel.lastIndexOf("/") + 1).toLowerCase(), etext);
  }
  return byName.get(name) ?? null;
}

function decisionEvidence(decision: ArticleDecision): Record<string, unknown> {
  return {
    empty: decision.empty,
    english_distinct: decision.englishDistinct,
    english_occurrences: decision.englishOccurrences,
    spanish_markers: decision.spanishMarkers,
    files: decision.files.map(fileEvidenceToDict),
  };
}

async function parentIfMissing(ref: ArticleRef, client: ArticleClient): Promise<string | null> {
  if (ref.kind !== KIND_PALABRAS) return null;
  const parent = twParentPath(ref.path || ref.articleId);
  if (!parent) return null;
  const parentRef: ArticleRef = { kind: KIND_PALABRAS, articleId: parent.slice(parent.lastIndexOf("/") + 1), path: parent };
  const parentFetched = await client.fetchArticle(parentRef);
  return parentFetched.found ? parent : null;
}

export function checkFetched(fetched: FetchedArticle, english: FetchedArticle | null = null, parent: string | null = null): ArticleStatus {
  // What is worked on is the source, so the source names it. (Ours may not even be there: an article that is new
  // in the source is not in our repository yet.)
  const sourceTitle = english && english.found ? titleIn(english.files) : "";
  const named = sourceTitle ? { sourceTitle } : {};
  if (!fetched.found || !fetched.files.length) {
    const evidence: Record<string, unknown> = {
      empty: true,
      english_distinct: [],
      english_occurrences: 0,
      spanish_markers: false,
      files: [],
    };
    if (parent) evidence.parent = parent;
    return { ref: fetched.ref, status: STATUS_MISSING, fetched, evidence, ...named };
  }
  const enFiles = english && english.found ? english.files : [];
  const fileEvidence = fetched.files.map(([path, text]) => analyzeFile(text, path, englishFor(path, enFiles)));
  const decision = decideArticle(fileEvidence);
  return { ref: fetched.ref, status: decision.status, fetched, evidence: decisionEvidence(decision), ...named };
}

export async function checkArticles(
  refs: ArticleRef[],
  client: ArticleClient,
  englishClient: ArticleClient | null = null,
): Promise<ArticleStatus[]> {
  const results: ArticleStatus[] = [];
  for (const ref of refs) {
    const fetched = await client.fetchArticle(ref);
    const english = englishClient ? await englishClient.fetchArticle(ref) : null;
    let parent: string | null = null;
    if (!fetched.found) parent = await parentIfMissing(ref, client);
    results.push(checkFetched(fetched, english, parent));
  }
  return results;
}

export { STATUS_ENGLISH, STATUS_INCOMPLETE, STATUS_TRANSLATED };
