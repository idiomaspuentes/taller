/**
 * The mark a phase leaves on a book: when the last subtarea of a phase closes, the group draft of each resource
 * the phase worked on gets the tag `fase/<book>/<phase>` (`fase/jud/traduccion`). It says how the text stood when
 * the phase ended: where the next phase started from, what a publication is compared with, where to go back to.
 *
 * Phases overlap chapter by chapter (refining chapter 1 writes on the draft while chapter 2 is still translated),
 * so the mark is of the whole book, set once every subtarea of the phase is closed. What one subtarea changed is
 * read from its own archive tag, not from here.
 */
import type { DcsIssue } from "@ip-lms/dcs-client";
import { branchNames, draftTaskId } from "./branchNames";
import { issueTaskId } from "./myTasks";
import { ensurePhaseSlug } from "./phaseSlug";
import type { AssignmentsDoc } from "./types";
import { parseWorkOrderMarker } from "./workOrder";

const word = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** `fase/jud/traduccion`. */
export function phaseTagName(book: string, phaseSlug: string): string {
  return `${branchNames().phase}/${word(book) || "book"}/${word(phaseSlug) || "fase"}`;
}

export function isPhaseTagName(name: string): boolean {
  const parts = name.trim().split("/");
  return parts.length === 3 && parts[0] === branchNames().phase && parts.slice(1).every((part) => /^[a-z0-9][a-z0-9-]*$/.test(part));
}

const bookOf = (issue: DcsIssue) => (parseWorkOrderMarker(issue.body)?.book ?? "").trim().toUpperCase();

export type ClosedPhase = {
  book: string;
  phaseId: string;
  tag: string;
  /** For each resource the phase worked on, the task whose group draft holds its text. */
  drafts: { resource: string; taskId: string }[];
};

/**
 * The phase that `closed` just ended for its book, or null when subtareas of that phase and book are still open.
 * `issues` are the project's, as they were read (the one being closed may still say open in them).
 */
export function phaseClosedBy(board: Pick<AssignmentsDoc, "teams" | "phases">, issues: DcsIssue[], closed: DcsIssue): ClosedPhase | null {
  const task = board.teams.find((row) => row.id === issueTaskId(closed));
  const phase = board.phases.find((row) => row.id === task?.phaseId);
  const book = bookOf(closed);
  if (!task || !phase || !book) return null;
  const tasks = board.teams.filter((row) => row.phaseId === phase.id);
  const ofPhase = new Set(tasks.map((row) => row.id));
  const pending = issues.some(
    (issue) => issue.number !== closed.number && issue.state !== "closed" && ofPhase.has(issueTaskId(issue)) && bookOf(issue) === book,
  );
  if (pending) return null;
  const drafts: ClosedPhase["drafts"] = [];
  for (const row of tasks) {
    for (const rule of row.rules) {
      const taskId = draftTaskId(board.teams, rule.resource);
      if (taskId && !drafts.some((draft) => draft.resource === rule.resource)) drafts.push({ resource: rule.resource, taskId });
    }
  }
  return { book, phaseId: phase.id, tag: phaseTagName(book, ensurePhaseSlug(phase)), drafts };
}
