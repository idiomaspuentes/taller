/**
 * isomorphic-git workspace merge with verse-order resolution on top.
 * Transport proof only: Cerrar stays on the Contents API + `mergeUsfmByVerse`
 * and must not import this module. Git's worktree file is never read back.
 */

import git from "isomorphic-git";
import type { RefRange } from "./usfmEdit";
import { mergeUsfmByVerse, type UsfmVerseMergeResult } from "./usfmVerseMerge";

export type GitFsClient = Parameters<typeof git.init>[0]["fs"];

export type MergeUsfmBranchesParams = {
  fs: GitFsClient;
  dir: string;
  filepath: string;
  baseUsfm: string;
  oursUsfm: string;
  theirsUsfm: string;
  oursBranch?: string;
  theirsBranch?: string;
  author?: { name: string; email: string };
  /** Portion of the incoming side (`theirs`), as at Cerrar. */
  scope?: RefRange;
};

const DEFAULT_AUTHOR = { name: "TAS", email: "tas@localhost" };

function worktreePath(dir: string, filepath: string): string {
  return `${dir.replace(/[\\/]+$/, "")}/${filepath}`.replace(/\\/g, "/");
}

async function writeWorktreeFile(
  fs: GitFsClient,
  dir: string,
  filepath: string,
  content: string,
): Promise<void> {
  const full = worktreePath(dir, filepath);
  const parent = full.split("/").slice(0, -1).join("/");
  const promised = fs as {
    promises?: {
      mkdir: (path: string, opts?: { recursive: boolean }) => Promise<void>;
      writeFile: (path: string, data: string, enc?: string) => Promise<void>;
    };
  };
  if (!promised.promises?.mkdir || !promised.promises.writeFile) {
    throw new Error("usfmGitMerge necesita fs.promises.mkdir y writeFile.");
  }
  await promised.promises.mkdir(parent, { recursive: true });
  await promised.promises.writeFile(full, content, "utf8");
}

async function commitIfChanged(
  fs: GitFsClient,
  dir: string,
  filepath: string,
  content: string,
  message: string,
  author: { name: string; email: string },
): Promise<void> {
  await writeWorktreeFile(fs, dir, filepath, content);
  await git.add({ fs, dir, filepath });
  const status = await git.status({ fs, dir, filepath });
  if (status === "unmodified") return;
  await git.commit({ fs, dir, message, author });
}

/**
 * Three-way git merge of one USFM file (to see whether Git's line merge
 * collides), then the same three-way verse merge as Cerrar: ours = trunk,
 * theirs = incoming, base = ancestor.
 */
export async function mergeUsfmBranchesWithGit(
  params: MergeUsfmBranchesParams,
): Promise<UsfmVerseMergeResult & { gitLineConflict: boolean }> {
  const {
    fs,
    dir,
    filepath,
    baseUsfm,
    oursUsfm,
    theirsUsfm,
    oursBranch = "ours",
    theirsBranch = "theirs",
    author = DEFAULT_AUTHOR,
  } = params;

  await git.init({ fs, dir, defaultBranch: "main" });
  await commitIfChanged(fs, dir, filepath, baseUsfm, "book base", author);
  await git.branch({ fs, dir, ref: oursBranch });
  await git.checkout({ fs, dir, ref: oursBranch });
  await commitIfChanged(fs, dir, filepath, oursUsfm, "ours verses", author);
  await git.checkout({ fs, dir, ref: "main" });
  await git.branch({ fs, dir, ref: theirsBranch });
  await git.checkout({ fs, dir, ref: theirsBranch });
  await commitIfChanged(fs, dir, filepath, theirsUsfm, "theirs verses", author);
  await git.checkout({ fs, dir, ref: oursBranch });

  let gitLineConflict = false;
  try {
    await git.merge({
      fs,
      dir,
      ours: oursBranch,
      theirs: theirsBranch,
      author,
      message: "merge verses",
      abortOnConflict: false,
    });
  } catch {
    gitLineConflict = true;
  }

  const semantic = mergeUsfmByVerse(oursUsfm, [theirsUsfm], {
    ancestor: baseUsfm,
    scope: params.scope,
  });
  return { ...semantic, gitLineConflict };
}
