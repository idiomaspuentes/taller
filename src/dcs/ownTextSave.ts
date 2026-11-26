/**
 * Saving the passage of the editor of the text (TPL, TPS) on the person's own branch, out of the component so the
 * tests run it without a screen.
 */
import { tryReadExistingBookUsfm } from "./bookBootstrap";
import { saveUsfmOnPortionBranch } from "./portionPr";
import { writeRefusedStatus } from "./repoFile";

export type TextSave = Parameters<typeof saveUsfmOnPortionBranch>[0] & {
  /** The book's text as the editor loaded it (or last wrote it) on `branch`. */
  loaded: string;
};

export type TextSaved = Awaited<ReturnType<typeof saveUsfmOnPortionBranch>>;

/**
 * Whether Door43 refused the write because the sha sent is not the file's (409, or 422 for a create). Asked through
 * the wrapping `writeRepoFile` gives its errors: `isShaConflict` only knew a bare `DcsApiError`, so this retry never
 * happened (#90).
 */
export function shaRefused(err: unknown): boolean {
  const status = writeRefusedStatus(err);
  return status === 409 || status === 422;
}

/**
 * Writes the book's text on the person's branch. Door43 may say the file is not the one this save meant to replace.
 * When what is on the branch is still the text that was loaded here, only the sha in hand was wrong: nothing of
 * anybody's is lost by saving over it, so it is saved, once, with the sha read there. Anything else is a real
 * conflict and is thrown.
 */
export async function saveOwnText(p: TextSave): Promise<TextSaved> {
  try {
    return await saveUsfmOnPortionBranch(p);
  } catch (err) {
    if (!shaRefused(err)) throw err;
    const now = await tryReadExistingBookUsfm({ session: p.session, owner: p.owner, repo: p.repo, filepath: p.filepath, branches: [p.branch] }).catch(() => null);
    if (!now?.sha || now.sha === p.sha || now.text !== p.loaded) throw err;
    const saved = await saveUsfmOnPortionBranch({ ...p, sha: now.sha });
    return { ...saved, sha: saved.sha ?? now.sha };
  }
}
