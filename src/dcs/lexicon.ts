import type { LexiconRepo, Workspace } from "../config/types";
import { normalizeLexiconFile, type LexiconFile, type StrongPart } from "../domain/lexicon";
import { readRaw } from "./afinacionLoad";
import type { GtSession } from "./auth";

/**
 * Where a workspace reads its lexicons: what its configuration says, or, with nothing said, the repositories
 * named after its language in its own organization (`es-419_ugl`, `es-419_uhl`).
 */
export function lexiconRepos(workspace: Pick<Workspace, "lang" | "contentOrg" | "lexicons"> | undefined, kind: StrongPart["kind"]): LexiconRepo[] {
  if (!workspace) return [];
  const configured = workspace.lexicons?.[kind];
  if (configured?.length) return configured;
  return [{ owner: workspace.contentOrg, repo: `${workspace.lang}_${kind === "greek" ? "ugl" : "uhl"}` }];
}

// An entry does not change while the app is open, and a verse asks for the same word again and again.
const cache = new Map<string, Promise<LexiconFile | null>>();

async function readEntry(session: GtSession, repo: LexiconRepo, number: number): Promise<LexiconFile | null> {
  const raw = await readRaw(session, repo.owner, repo.repo, `${repo.path ?? "content"}/${number}.json`);
  if (!raw) return null;
  try {
    return normalizeLexiconFile(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** The entry of a Strong's number: from the first repository that has it. `null` when none does, or offline. */
export function loadLexiconEntry(session: GtSession, repos: LexiconRepo[], number: number): Promise<LexiconFile | null> {
  const key = `${session.host}|${repos.map((r) => `${r.owner}/${r.repo}/${r.path ?? ""}`).join(",")}|${number}`;
  const known = cache.get(key);
  if (known) return known;
  const loading = (async () => {
    for (const repo of repos) {
      const file = await readEntry(session, repo, number);
      if (file) return file;
    }
    return null;
  })();
  cache.set(key, loading);
  // A failure is not remembered: the next tap tries again.
  void loading.then((file) => {
    if (!file) cache.delete(key);
  });
  return loading;
}
