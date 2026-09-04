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
};

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
  if (!fetched.found || !fetched.files.length) {
    const evidence: Record<string, unknown> = {
      empty: true,
      english_distinct: [],
      english_occurrences: 0,
      spanish_markers: false,
      files: [],
    };
    if (parent) evidence.parent = parent;
    return { ref: fetched.ref, status: STATUS_MISSING, fetched, evidence };
  }
  const enFiles = english && english.found ? english.files : [];
  const fileEvidence = fetched.files.map(([path, text]) => analyzeFile(text, path, englishFor(path, enFiles)));
  const decision = decideArticle(fileEvidence);
  return { ref: fetched.ref, status: decision.status, fetched, evidence: decisionEvidence(decision) };
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
