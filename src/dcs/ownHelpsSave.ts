import { DcsApiError } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { prepareOwnBranch, saveTextOnPortionBranch } from "./portionPr";
import { readRepoFile, writeRefusedStatus } from "./repoFile";
import { applyHelpsTsvEdits, tsvFieldsForItem, type HelpsDraftItem } from "../domain/helpsDraft";
import { articleAsWritten } from "../domain/helpMarkup";
import { composeOnBranch, type BranchFile, type Composed } from "../domain/helpsAutosave";
import { tNow } from "../i18n/messages";

/** A file of helps as the editor read or wrote it. `ref`: the branch its `sha` is of. */
export type HelpsFile = { text: string; sha?: string; ref?: string };

/** The person's draft in Door43 changed since the editor read it: nothing was written over it. */
export class HelpsConflictError extends Error {
  constructor() {
    super(tNow("he.conflict"));
    this.name = "HelpsConflictError";
  }
}

export type OwnHelpsSave = {
  session: GtSession;
  /** Where the helps are: a book's TSV of notes or questions (`filepath`), or the files of articles. */
  target: { owner: string; repo: string; kind: "tsv" | "markdown"; filepath?: string; resource: string };
  /** The subtarea the draft is of: names its work branch and the group's draft it is cut from. */
  task: { book: string; resource: string; taskId: string; phaseSlug: string; username: string; issueNumber: number };
  items: HelpsDraftItem[];
  /** What the editor last read or wrote of each file. */
  files: Record<string, HelpsFile>;
  /** The branch the editor reads and writes. */
  branch: string;
  /** The commit message: of the passage (no item), or of one article file. */
  message: (item?: HelpsDraftItem) => string;
  /** The helps of the editor's passage in a TSV of the book. */
  passage: (text: string) => HelpsDraftItem[];
  /** Each file as it is written, so a save that fails half way still knows what it wrote. */
  onWritten?: (filepath: string, file: HelpsFile, message: string, commitSha?: string) => void;
  /** The own branch was made again from the group's draft: what was saved on it is gone. Said before writing. */
  onRestored?: () => void;
};

/**
 * Writes the person's helps on their own draft, never without the sha read on that same branch. The branch is made
 * sure of once, at the start. A file whose sha the editor does not have from that branch (it read the main branch,
 * the file did not exist, the branch was made again) is read there first, and written over what is there
 * (`composeOnBranch`). A sha Door43 refuses is read again once; a second refusal is an error.
 *
 * Returns where it wrote, every file as it is now, and whether the branch was made again.
 */
export async function saveOwnHelps(p: OwnHelpsSave): Promise<{ branch: string; files: Record<string, HelpsFile>; restored: boolean }> {
  const { session, target, task } = p;
  if (!task.book) throw new Error(tNow("he.noBook"));
  const tsv = target.kind === "tsv" && target.filepath ? target.filepath : "";
  const paths = tsv ? [tsv] : [...new Set(p.items.map((item) => item.filepath))];

  let branch = "";
  let restored = false;
  for (const filepath of paths) {
    const prepared = await prepareOwnBranch({
      session,
      owner: target.owner,
      repo: target.repo,
      filepath,
      branch: p.branch,
      book: task.book,
      resource: task.resource,
      taskId: task.taskId,
      phaseSlug: task.phaseSlug,
      username: task.username,
      issueNumber: task.issueNumber,
    });
    if (branch && prepared.branch !== branch) {
      throw new Error(`«${branch}» / «${prepared.branch}»: ${tNow("he.twoBranches")}`);
    }
    branch = prepared.branch;
    // Cut just now while the editor holds a sha of it: it was deleted since, and is lost as when it is restored.
    restored ||= prepared.restored || (prepared.created && Object.values(p.files).some((file) => file.ref === prepared.branch));
  }
  if (restored) p.onRestored?.();

  const files = { ...p.files };
  /** Whether the editor has the file's sha from this very branch, still worth writing with. */
  const knownHere = (filepath: string) => !restored && Boolean(files[filepath]?.sha) && files[filepath]?.ref === branch;

  const readHere = async (filepath: string): Promise<BranchFile | null> => {
    try {
      const read = await readRepoFile({ session, owner: target.owner, repo: target.repo, filepath, branch });
      return { text: read.text, sha: read.sha };
    } catch (err) {
      if (err instanceof DcsApiError && err.status === 404) return null;
      throw err;
    }
  };

  /**
   * Reads the file on the branch and says what to write over it. After the branch was made again it is not
   * compared: it was just cut from the group's draft and nobody else writes on it.
   */
  const onBranch = async (filepath: string, build: (here: BranchFile | null, base: string) => Composed) => {
    const here = await readHere(filepath);
    const base = restored && here ? here.text : (files[filepath]?.text ?? "");
    return { here, composed: build(here, base) };
  };

  const put = async (filepath: string, c: { content: string; sha?: string; mustCreate?: true }, message: string) => {
    const saved = await saveTextOnPortionBranch({
      session,
      owner: target.owner,
      repo: target.repo,
      filepath,
      content: c.content,
      message,
      branch,
      sha: c.sha,
      prepared: { branch },
      mustCreate: c.mustCreate,
    });
    files[filepath] = { text: c.content, sha: saved.sha, ref: branch };
    p.onWritten?.(filepath, files[filepath]!, message, saved.commitSha);
  };

  /** Writes one file; `direct` is what to write when its sha from this branch is known, `build` otherwise. */
  const writeFile = async (
    filepath: string,
    message: string,
    build: (here: BranchFile | null, base: string) => Composed,
    direct: () => { content: string; sha?: string } | null,
    skipBlankNew = false,
  ) => {
    let fromBranch = !knownHere(filepath);
    for (let attempt = 0; ; attempt++) {
      let c: { content: string; sha?: string; mustCreate?: true };
      if (fromBranch) {
        const { here, composed } = await onBranch(filepath, build);
        if ("conflict" in composed) throw new HelpsConflictError();
        // Nothing written in a file that does not exist yet: it is not made empty.
        if (!here && skipBlankNew && !composed.content.trim()) return;
        // The branch says it already.
        if (here && composed.content === here.text) {
          files[filepath] = { text: here.text, sha: here.sha, ref: branch };
          return;
        }
        c = composed;
      } else {
        const d = direct();
        if (!d) return;
        c = d;
      }
      try {
        await put(filepath, c, message);
        return;
      } catch (err) {
        const status = writeRefusedStatus(err);
        if (status !== 409 && status !== 422) throw err;
        // A file to create that appeared meanwhile is somebody else's: not written over.
        if (c.mustCreate) throw new HelpsConflictError();
        if (attempt > 0) throw err;
        fromBranch = true;
      }
    }
  };

  if (tsv) {
    const fields = target.resource === "preguntas" ? "preguntas" : "notas";
    const edits = p.items.map((item) => ({ id: item.id, fields: tsvFieldsForItem(fields, item) }));
    await writeFile(
      tsv,
      p.message(),
      (here, base) => composeOnBranch({ kind: "tsv", onBranch: here, base, edits, passage: p.passage }),
      () => ({ content: applyHelpsTsvEdits(files[tsv]?.text ?? "", edits), sha: files[tsv]?.sha }),
    );
  } else {
    for (const item of p.items) {
      await writeFile(
        item.filepath,
        p.message(item),
        (here, base) => composeOnBranch({ kind: "markdown", onBranch: here, base, text: item.text }),
        () => {
          const remote = files[item.filepath]?.text ?? "";
          // On the lines the file has: a line that says what it said is written as it was.
          const content = articleAsWritten(remote, item.text);
          return content === remote ? null : { content, sha: files[item.filepath]?.sha };
        },
        true,
      );
    }
  }
  return { branch, files, restored };
}
