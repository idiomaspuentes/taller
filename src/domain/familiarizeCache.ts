/**
 * Local-first “ya vi este artículo” cache.
 * Keyed by user + lang; identities are resource + article id / path.
 * V1 is browser-only (no DCS sync).
 */

export function familiarizeContentId(parts: {
  resource: string;
  articleId?: string;
  path?: string;
}): string {
  const resource = parts.resource.trim().toLowerCase();
  const ident = (parts.path || parts.articleId || "").trim().toLowerCase();
  return `${resource}:${ident}`;
}

function storeKey(username: string, lang: string): string {
  return `tas-familiarize:${username.trim().toLowerCase()}:${lang.trim().toLowerCase()}`;
}

function readIds(username: string, lang: string): string[] {
  if (!username || !lang || typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(storeKey(username, lang));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { ids?: unknown };
    if (!Array.isArray(parsed.ids)) return [];
    return parsed.ids.map((id) => String(id).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function writeIds(username: string, lang: string, ids: string[]): void {
  if (!username || !lang || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      storeKey(username, lang),
      JSON.stringify({ ids, updatedAt: Date.now() }),
    );
  } catch {
    /* quota / private mode */
  }
}

export function loadFamiliarizeSeen(username: string, lang: string): Set<string> {
  return new Set(readIds(username, lang));
}

export function isFamiliarizeSeen(
  username: string,
  lang: string,
  contentId: string,
): boolean {
  const id = contentId.trim().toLowerCase();
  if (!id) return false;
  return loadFamiliarizeSeen(username, lang).has(id);
}

export function markFamiliarizeSeen(
  username: string,
  lang: string,
  contentId: string,
): Set<string> {
  const id = contentId.trim().toLowerCase();
  const next = loadFamiliarizeSeen(username, lang);
  if (id) next.add(id);
  writeIds(username, lang, [...next]);
  return next;
}

export function unmarkFamiliarizeSeen(
  username: string,
  lang: string,
  contentId: string,
): Set<string> {
  const id = contentId.trim().toLowerCase();
  const next = loadFamiliarizeSeen(username, lang);
  next.delete(id);
  writeIds(username, lang, [...next]);
  return next;
}
