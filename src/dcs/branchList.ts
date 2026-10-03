import { request, type DcsClientConfig } from "@ip-lms/dcs-client";

/**
 * The branches a repository has, read once and kept for a few seconds.
 *
 * A text can be on several branches (the group draft of a task, its trunk, the book's) and a tool that needs it asks
 * each in turn. Asked blindly that is one failed request per branch that does not exist: opening Publicar made 108
 * of them and took twenty seconds. With the list, only the branches that exist are asked.
 */
const KEEP_MS = 15_000;
const kept = new Map<string, { at: number; names: Promise<Set<string> | null> }>();
const keyOf = (config: DcsClientConfig, owner: string, repo: string) => `${config.host ?? ""}|${owner}/${repo}`.toLowerCase();

/** Pure: the branch names in what `git/refs/heads` answers. */
export function branchNamesFromRefs(refs: unknown): Set<string> {
  const out = new Set<string>();
  for (const row of Array.isArray(refs) ? refs : []) {
    const ref = String((row as { ref?: unknown })?.ref ?? "");
    if (ref.startsWith("refs/heads/")) out.add(ref.slice("refs/heads/".length));
  }
  return out;
}

/** Pure: of the branches to try, in their order, those that exist; all of them when the list could not be read. */
export function onlyExisting<T extends string | undefined>(candidates: T[], names: Set<string> | null): T[] {
  if (!names) return candidates;
  // No name (`undefined`) is the repository's default branch: always there.
  return candidates.filter((branch) => !branch || names.has(branch));
}

/** The names of the branches, or null when they cannot be listed (the caller then asks each one, as before). */
export function knownBranches(config: DcsClientConfig, owner: string, repo: string, token: string): Promise<Set<string> | null> {
  const key = keyOf(config, owner, repo);
  const hit = kept.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.names;
  const names = request<unknown>(config, { path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads`, token })
    .then((refs) => {
      const found = branchNamesFromRefs(refs);
      // An answer without a single branch is not a repository's: do not trust it.
      return found.size ? found : null;
    })
    .catch(() => null);
  kept.set(key, { at: Date.now(), names });
  return names;
}

/** A branch was just created or removed in this repository: read the list again next time. */
export function forgetBranches(config: DcsClientConfig, owner: string, repo: string): void {
  kept.delete(keyOf(config, owner, repo));
}
