import type { DcsIssue } from "@ip-lms/dcs-client";
import { isDecisionIssue } from "./decisionAccess";
import { extraWorkOf } from "./extraWork";
import type { ProjectSettings } from "./types";
import { parseWorkOrderMarker } from "./workOrder";

/**
 * A correction that is a list of changes to the text: a chapter's worth of proposals, each a decision of the team
 * with its own votes, opened from one subtarea. 248 changes to Ezra, each a card among the team's work, buried what
 * else they had to do; one card per chapter keeps them together, and the subtarea opens on its list.
 */

const isOpen = (issue: Pick<DcsIssue, "state">) => (issue.state ?? "open").toLowerCase() !== "closed";

/** Whether a subtarea is a list of proposals: a correction added by hand that says so. */
export function isProposalList(settings: ProjectSettings | undefined, issue: Pick<DcsIssue, "body">): boolean {
  return Boolean(extraWorkOf(settings, parseWorkOrderMarker(issue.body ?? "")?.itemIds)?.proposals);
}

/** The subtareas of a project that are lists of proposals, by number. */
export function proposalListNumbers(issues: DcsIssue[], settings: ProjectSettings | undefined): Set<number> {
  return new Set(issues.filter((issue) => isProposalList(settings, issue)).map((issue) => issue.number));
}

/** The subtarea a decision was opened from, when its marker says so. */
export function decisionParent(issue: Pick<DcsIssue, "body">): number | undefined {
  return isDecisionIssue(issue) ? parseWorkOrderMarker(issue.body ?? "")?.parentIssue : undefined;
}

/**
 * A decision that is one of the proposals of a list: it is read there, and not as a card or a notice of its own.
 * Its marker says so, so that what only has the subtareas at hand (the notices) can tell it too.
 */
export function inProposalList(issue: Pick<DcsIssue, "body">): boolean {
  const marker = isDecisionIssue(issue) ? parseWorkOrderMarker(issue.body ?? "") : null;
  return Boolean(marker?.parentIssue && marker.listed);
}

/** The verse a decision is about, from its title («EZR 3:3 · Decidir: …»). */
export function decisionPlace(issue: Pick<DcsIssue, "title">): { chapter: number; verse: number } | undefined {
  const at = /^\S+\s+(\d+):(\d+)/.exec(issue.title ?? "");
  return at ? { chapter: Number(at[1]), verse: Number(at[2]) } : undefined;
}

/** The proposals of a list, in the order of the text. */
export function proposalsOfList(issues: DcsIssue[], list: number): DcsIssue[] {
  const order = (issue: DcsIssue) => {
    const place = decisionPlace(issue);
    return place ? place.chapter * 1000 + place.verse : 0;
  };
  return issues.filter((issue) => decisionParent(issue) === list).sort((a, b) => order(a) - order(b) || a.number - b.number);
}

/** How many proposals of a list are still to be decided, and how many it has. */
export function proposalCount(issues: DcsIssue[], list: number): { open: number; total: number } {
  const rows = proposalsOfList(issues, list);
  return { open: rows.filter(isOpen).length, total: rows.length };
}

/**
 * Where to start reading a list: the first proposal still open that this person has not voted on, then the first
 * still open, then the first.
 */
export function firstToRead(rows: Pick<DcsIssue, "state" | "number">[], voted: (issue: number) => boolean): number {
  const open = rows.findIndex((row) => isOpen(row) && !voted(row.number));
  if (open >= 0) return open;
  const any = rows.findIndex(isOpen);
  return any >= 0 ? any : 0;
}

/** How far the clock of this device and Door43's may be apart: one's own comment does not read as new. */
const CLOCK_SLACK_MS = 60_000;

/**
 * Whether a proposal was talked about since this person last read it here. The poll of notices follows only the
 * person's own subtareas, not every proposal of a list, so the proposal says it: Door43 sets the time a comment,
 * a vote or an edit last touched it. One never read says nothing; it is read in its turn.
 */
export function talkMoved(row: Pick<DcsIssue, "updated_at">, read: { at: string } | undefined): boolean {
  if (!read?.at || !row.updated_at) return false;
  return Date.parse(row.updated_at) - Date.parse(read.at) > CLOCK_SLACK_MS;
}

// ---------------------------------------------------------------- the proposals of a verse, as one

/** One change to a verse: the words as they are, the words proposed, and why. */
export type TextChange = { before: string; after: string; cause?: string; why?: string; notes?: string };

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * A verse with its changes made. They go as one proposal: two proposals of one verse are two wordings of the whole
 * verse, and the first one accepted made the other expire. A change whose words the verse no longer has is left
 * out, and said.
 */
export function withChanges(verse: string, changes: TextChange[]): { text: string; missing: TextChange[] } {
  let text = oneLine(verse);
  const missing: TextChange[] = [];
  for (const change of changes) {
    const before = oneLine(change.before);
    const at = before ? text.indexOf(before) : -1;
    if (at < 0) {
      missing.push(change);
      continue;
    }
    text = `${text.slice(0, at)}${oneLine(change.after)}${text.slice(at + before.length)}`;
  }
  return { text, missing };
}

/**
 * The changes a proposal says, read back from what `changesNote` wrote, to show each apart: its words, its cause, why,
 * its notes. `null` for a note written otherwise (by a person, from a tool): it is shown as it was written.
 */
export function readChangesNote(note: string): TextChange[] | null {
  const blocks = note.replace(/\r/g, "").trim().split(/\n\s*\n/);
  const out: TextChange[] = [];
  for (const block of blocks) {
    const [head, ...lines] = block.split("\n");
    const pair = /^(?:\d+\.\s+)?«(.*)» → «(.*)»$/.exec((head ?? "").trim());
    if (!pair) return null;
    const change: TextChange = { before: pair[1]!, after: pair[2]! };
    for (const line of lines) {
      const field = /^(Causa|Por qué|Notas):\s*(.*)$/.exec(line.trim());
      if (!field) {
        // A reason of more than one line goes on.
        if (change.why !== undefined) change.why += `\n${line}`;
        else return null;
        continue;
      }
      if (field[1] === "Causa") change.cause = field[2]!.replace(/\.$/, "");
      else if (field[1] === "Por qué") change.why = field[2]!;
      else change.notes = field[2]!;
    }
    out.push(change);
  }
  return out.length ? out : null;
}

/** What the proposal of a verse says: each change, why, and the notes it is about. */
export function changesNote(changes: TextChange[]): string {
  return changes
    .map((change, index) => {
      const head = `${changes.length > 1 ? `${index + 1}. ` : ""}«${oneLine(change.before)}» → «${oneLine(change.after)}»`;
      return [head, change.cause ? `Causa: ${change.cause}.` : "", change.why ? `Por qué: ${change.why.trim()}` : "", change.notes ? `Notas: ${change.notes}` : ""].filter(Boolean).join("\n");
    })
    .join("\n\n");
}
