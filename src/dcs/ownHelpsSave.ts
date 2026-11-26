import type { GtSession } from "./auth";
import { saveTextOnPortionBranch } from "./portionPr";
import { applyHelpsTsvEdits, tsvFieldsForItem, type HelpsDraftItem } from "../domain/helpsDraft";
import { articleAsWritten } from "../domain/helpMarkup";

/** A file of helps as the editor read or wrote it. `ref`: the branch its `sha` is of. */
export type HelpsFile = { text: string; sha?: string; ref?: string };

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
};

/** Writes the person's helps on their own draft. Returns where, and every file as it is now. */
export async function saveOwnHelps(p: OwnHelpsSave): Promise<{ branch: string; files: Record<string, HelpsFile>; restored: boolean }> {
  const { session, target, task } = p;
  const files = { ...p.files };
  const write = async (filepath: string, content: string, sha: string | undefined, message: string) => {
    const saved = await saveTextOnPortionBranch({
      session,
      owner: target.owner,
      repo: target.repo,
      filepath,
      content,
      message,
      branch: p.branch,
      sha,
      book: task.book,
      resource: task.resource,
      taskId: task.taskId,
      phaseSlug: task.phaseSlug,
      username: task.username,
      issueNumber: task.issueNumber,
    });
    files[filepath] = { text: content, sha: saved.sha, ref: saved.branch };
    p.onWritten?.(filepath, files[filepath]!, message, saved.commitSha);
  };
  if (target.kind === "tsv" && target.filepath) {
    const fields = target.resource === "preguntas" ? "preguntas" : "notas";
    const content = applyHelpsTsvEdits(files[target.filepath]?.text ?? "", p.items.map((item) => ({ id: item.id, fields: tsvFieldsForItem(fields, item) })));
    await write(target.filepath, content, files[target.filepath]?.sha, p.message());
  } else {
    for (const item of p.items) {
      const remote = files[item.filepath]?.text ?? "";
      // On the lines the file has: a line that says what it said is written as it was.
      const content = articleAsWritten(remote, item.text);
      // Nothing changed; or nothing was written in a file that does not exist yet, which is not to be made empty.
      if (content === remote && (files[item.filepath]?.sha || !content.trim())) continue;
      await write(item.filepath, content, files[item.filepath]?.sha, p.message(item));
    }
  }
  return { branch: p.branch, files, restored: false };
}
