/**
 * When the helps editor saves by itself. It writes on the person's own draft a moment after the last key, as the
 * editor of the text does; on the team's draft (`shared`) a save changes everybody's text, and stays a button.
 *
 * And what it writes: never a file without the sha read on the same branch (`composeOnBranch`).
 */
import { articleAsWritten } from "./helpMarkup";
import { applyHelpsTsvEdits, type HelpsDraftItem, type HelpsRowEdit } from "./helpsDraft";

export type AutosaveState = {
  shared: boolean;
  hasSession: boolean;
  dirty: boolean;
  saving: boolean;
  finishing: boolean;
  openingPr: boolean;
  busy: boolean;
  hasItems: boolean;
  /** «¿Entregar con piezas sin traducir?» is open. */
  confirming: boolean;
  /** `labWriteDecision(ctx).mode === "blocked"`, or nothing says where to write: nothing can be saved. */
  blocked: boolean;
  /** The last save failed and nothing was typed since, nor did the connection come back. */
  failedSinceEdit: boolean;
};

/** As the editor of the text: long enough not to write on every word, short enough that little waits on the device. */
export const AUTOSAVE_DELAY_MS = 3500;

/**
 * Whether a save is due once the last key has waited `AUTOSAVE_DELAY_MS`. After a failure it is not: trying again
 * every few seconds would knock on Door43 for as long as the network is down. A key, the connection coming back or
 * «Reintentar» try again.
 */
export function autosaveDue(s: AutosaveState): boolean {
  return (
    !s.shared &&
    s.hasSession &&
    s.dirty &&
    !s.saving &&
    !s.finishing &&
    !s.openingPr &&
    !s.busy &&
    s.hasItems &&
    !s.confirming &&
    !s.blocked &&
    !s.failedSinceEdit
  );
}

/** A file as it was read on the person's own branch: with the sha Door43 compares a write with. */
export type BranchFile = { text: string; sha?: string };

export type Composed = { content: string; sha?: string; mustCreate?: true } | { conflict: true };

/** What each help of the passage says (its text and, for a question, its answer), under its name. */
function passageStamps(items: HelpsDraftItem[]): Map<string, string> {
  return new Map(items.map((item) => [item.id, JSON.stringify([item.text, item.secondary ?? ""])]));
}

function samePassage(a: HelpsDraftItem[], b: HelpsDraftItem[]): boolean {
  const left = passageStamps(a);
  const right = passageStamps(b);
  return left.size === right.size && [...left].every(([id, stamp]) => right.get(id) === stamp);
}

/**
 * What to write of a file on the person's own branch, from what is there now (`onBranch`, read on that branch;
 * `null` when it has no such file) and what this editor last read or wrote of it (`base`).
 *
 * - Not there: created, and only created; a file that appears meanwhile is refused.
 * - A book's TSV of notes or questions: the person's rows go over the file as the branch has it, so the rows of
 *   other passages stay as they are there. Only when this passage's rows say there what they said to the editor:
 *   otherwise somebody else wrote them, and that is a conflict.
 * - An article: written over the branch's text when it is the one the editor had; otherwise, a conflict.
 */
export function composeOnBranch(
  p:
    | { kind: "tsv"; onBranch: BranchFile | null; base: string; edits: HelpsRowEdit[]; passage: (text: string) => HelpsDraftItem[] }
    | { kind: "markdown"; onBranch: BranchFile | null; base: string; text: string },
): Composed {
  if (p.kind === "tsv") {
    if (!p.onBranch) return { content: applyHelpsTsvEdits(p.base, p.edits), mustCreate: true };
    if (!samePassage(p.passage(p.onBranch.text), p.passage(p.base))) return { conflict: true };
    return { content: applyHelpsTsvEdits(p.onBranch.text, p.edits), sha: p.onBranch.sha };
  }
  if (!p.onBranch) return { content: articleAsWritten(p.base, p.text), mustCreate: true };
  if (p.onBranch.text !== p.base) return { conflict: true };
  return { content: articleAsWritten(p.onBranch.text, p.text), sha: p.onBranch.sha };
}

/** An article that cannot be read opens blank only when it does not exist; any other failure stops the opening. */
export function blankOnlyWhenMissing(err: unknown): boolean {
  return (err as { status?: unknown } | null)?.status === 404;
}
