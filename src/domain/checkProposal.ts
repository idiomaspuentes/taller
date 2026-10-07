import type { CheckAnswer } from "./checklist";
import type { CorrectionAsk } from "./corrections";
import { scopeKey } from "./scope";

/**
 * A change proposed while checking: a «no» is settled by saying what should change, with the new version written
 * out or with a comment, and nothing changes until the team agrees. A team checked its helps by answering «no»
 * and then changing them in another screen, at once; its agreement came afterwards, over a line of what was said
 * to have changed, with neither the old words nor the new ones in sight. And it could say nothing of an article.
 *
 * A proposal about something the team maintains is applied when enough of the team agrees. One about something
 * another team maintains (a text, from a team that checks helps against it) goes to that team as a correction, as
 * what a committee does not endorse does. Nothing here knows which resources those are.
 *
 * Proposals live with the answers of the checklist, one file per person that is only added to: a proposal is the
 * answer that settles a «no», and what others say of it are rows that name it.
 */

export type ProposalPayload = {
  id: string;
  /** What it would change, as the project names its resources. */
  resource: string;
  /** Which part of a help with more than one (`Question`, `Response`): the column it is written in. */
  field?: string;
  /** The file of an article, when that is what would change. */
  path?: string;
  /** The row of the help, when that is what would change. */
  rowId?: string;
  /** Where in the passage («1:3»). */
  where: string;
  /** The words as they were when it was proposed. */
  before?: string;
  /** The new version. Without one the proposal is a comment: what should change, said in `note`. */
  after?: string;
  /** The proposal this one answers with another version. */
  replaces?: string;
};

/** A row somebody adds about a proposal: `itemId` is the id of the proposal. */
export const PROPOSAL_SAYS = "@acuerdo";
/** The row that says a proposal was carried out: applied to the team's help, or sent to the team that maintains it. */
export const PROPOSAL_DONE = "@hecha";
/** The question a proposal answers when it is about no question of the step: something seen in passing. */
export const PROPOSAL_FREE = "@propuesta";
/**
 * A row by which somebody says they would rather leave things as they are. There was no way to be against a
 * proposal but to write another one: a team that did not want a change could not say so, and the proposal stayed
 * to be resolved, with the step it kept open, until its author took it back.
 */
export const PROPOSAL_KEEPS = "@dejar";

export type ProposalState = "open" | "agreed" | "applied" | "sent" | "withdrawn" | "replaced" | "rejected";

export type ProposalView = {
  proposal: ProposalPayload;
  itemId: string;
  questionId: string;
  by: string;
  at: string;
  /** Why: the question it failed, or what the person wrote. */
  reason: string;
  /** Who is for it, its author first. */
  inFavour: string[];
  /** Who would rather leave things as they are. */
  against: string[];
  state: ProposalState;
  /** The subtarea it became, when it was sent to another team. */
  sentAs?: string;
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The answer that settles a «no» with a proposal. */
export function proposalAnswer(params: { itemId: string; questionId: string; by: string; at: string; reason: string; proposal: ProposalPayload; textHash?: string }): CheckAnswer {
  return { itemId: params.itemId, questionId: params.questionId, value: "no", outcome: "proposal", note: params.reason.trim(), proposal: params.proposal, by: params.by, at: params.at, ...(params.textHash ? { textHash: params.textHash } : {}) };
}

/** What a person says of a proposal: for it, or (its author) taking it back. */
export function proposalSaying(proposalId: string, by: string, at: string, agree: boolean): CheckAnswer {
  return { itemId: proposalId, questionId: PROPOSAL_SAYS, value: agree ? "yes" : "no", by, at };
}

/** What a person says of leaving things as they are instead of a proposal: that they would, or no longer. */
export function proposalKeeping(proposalId: string, by: string, at: string, keep: boolean): CheckAnswer {
  return { itemId: proposalId, questionId: PROPOSAL_KEEPS, value: keep ? "yes" : "no", by, at };
}

/** The row that says a proposal was carried out, and as what (the subtarea it became, when it went to another team). */
export function proposalDone(proposalId: string, by: string, at: string, sentAs?: string): CheckAnswer {
  return { itemId: proposalId, questionId: PROPOSAL_DONE, value: "yes", by, at, ...(sentAs ? { note: sentAs } : {}) };
}

/**
 * The proposals among some answers, and how each stands. `needed`: how many people have to be for one, its author
 * among them, for it to be agreed; as many who would rather leave things as they are, and it is not accepted.
 * `ours`: whether the team maintains what a proposal would change; one it does not is «sent» once carried out,
 * not «applied».
 */
export function proposalsOf(answers: CheckAnswer[], needed: number, ours: (resource: string) => boolean = () => true): ProposalView[] {
  const byTime = [...answers].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const made = byTime.filter((row) => row.outcome === "proposal" && row.proposal?.id);
  const replaced = new Set(made.flatMap((row) => (row.proposal!.replaces ? [row.proposal!.replaces] : [])));
  return made.map((row) => {
    const proposal = row.proposal!;
    // The last thing each person said of it: for it, for leaving things as they are, or neither any more.
    const said = new Map<string, { by: string; stand: "for" | "against" | "none" }>();
    let withdrawn = false;
    for (const other of byTime) {
      if (other.itemId !== proposal.id || (other.questionId !== PROPOSAL_SAYS && other.questionId !== PROPOSAL_KEEPS)) continue;
      const yes = other.value === "yes";
      // Its author is for it while it stands: what they can say is that they take it back.
      if (same(other.by, row.by)) {
        if (other.questionId === PROPOSAL_SAYS) withdrawn = !yes;
        continue;
      }
      said.set(other.by.trim().toLowerCase(), { by: other.by, stand: !yes ? "none" : other.questionId === PROPOSAL_SAYS ? "for" : "against" });
    }
    const standing = (stand: "for" | "against") => [...said.values()].filter((line) => line.stand === stand).map((line) => line.by);
    const inFavour = [row.by, ...standing("for")];
    const against = standing("against");
    const done = byTime.filter((other) => other.questionId === PROPOSAL_DONE && other.itemId === proposal.id).pop();
    const state: ProposalState = withdrawn
      ? "withdrawn"
      : replaced.has(proposal.id)
        ? "replaced"
        : done
          ? ours(proposal.resource)
            ? "applied"
            : "sent"
          : against.length >= Math.max(1, needed)
            ? "rejected"
            : inFavour.length >= Math.max(1, needed)
              ? "agreed"
              : "open";
    return { proposal, itemId: row.itemId, questionId: row.questionId, by: row.by, at: row.at, reason: row.note ?? "", inFavour: withdrawn ? [] : inFavour, against: withdrawn ? [] : against, state, ...(done?.note ? { sentAs: done.note } : {}) };
  });
}

/**
 * The answers that count for the checklist itself: a proposal its author took back no longer settles its «no», so
 * what was answered before it (or nothing) is what stands, and the help is to be checked again.
 */
export function withoutWithdrawn(answers: CheckAnswer[]): CheckAnswer[] {
  const gone = new Set(proposalsOf(answers, 1).filter((view) => view.state === "withdrawn").map((view) => view.proposal.id));
  return gone.size ? answers.filter((row) => !(row.outcome === "proposal" && row.proposal && gone.has(row.proposal.id))) : answers;
}

/** Whether nothing is left to settle: every proposal was carried out, taken back, answered with another or not accepted. */
export function proposalsSettled(views: ProposalView[]): boolean {
  return views.every((view) => view.state === "applied" || view.state === "sent" || view.state === "withdrawn" || view.state === "replaced" || view.state === "rejected");
}

// ---------------------------------------------------------------- a new version and the words it was written from

/** The words alone: the line ends and spaces a file is kept with (a note keeps its line ends as «\n») make no other version. */
const wording = (text: string) => text.replace(/\\n/g, " ").replace(/\s+/g, " ").trim();

/**
 * A help as it reads, without the marks it is written with: a link as its words, bold without its asterisks, the
 * «\n» a note keeps its line ends as, a line end. For showing a version where a person reads it (a note with a
 * link took three lines more written out than read); two versions are told apart by what is written, not by this.
 */
export function readable(text: string): string {
  return text
    .replace(/\\n/g, "\n")
    .replace(/\[\[[^\]]*\]\]/g, "")
    // «(ver: )»: what is left of a pointer to an article once its link is gone.
    .replace(/\s*\([^()\n]{0,20}:\s*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/[ \t]*\n\s*/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Whether two versions say the same, whatever spaces and line ends they are kept with. */
export function sameWording(a: string, b: string): boolean {
  return wording(a) === wording(b);
}

/**
 * How a new version stands against the help as it is now. A new version is the whole of the words, written over
 * the ones it was proposed from; the lists of a task go over the same notes and each knows only its own proposals,
 * so two of them (or two people in one) can each propose a whole note starting from the same words, and the second
 * one applied took out what the first had put in.
 *
 * `fits`: the help still says what the proposal was written from, and can be written over. `done`: it already
 * says what is proposed (it was applied and saying so failed, or two people applied it at once), and there is
 * nothing to write. `changed`: it says something else, and writing the proposal would take that out. A proposal
 * that does not say what it was written from cannot be told, and fits.
 */
export type ProposalFit = "fits" | "done" | "changed";

export function proposalFit(proposal: Pick<ProposalPayload, "before" | "after">, current: string): ProposalFit {
  // Asked first: a proposal that only parts a paragraph in two says the same as what it was written from.
  if (proposal.before === undefined || sameWording(current, proposal.before)) return "fits";
  return proposal.after !== undefined && sameWording(current, proposal.after) ? "done" : "changed";
}

/**
 * The help a proposal would change: the row of the notes or questions, or the file of an article. Empty when it is
 * about no help of its own (a verse of a text, something that is missing).
 */
export function proposalHelp(proposal: ProposalPayload): string {
  const part = proposal.rowId || proposal.path;
  return part ? `${proposal.resource}:${part}` : "";
}

/** The words of that help a proposal would write over: of a row, one of its columns. */
export function proposalWords(proposal: ProposalPayload): string {
  const help = proposalHelp(proposal);
  return help && proposal.rowId ? `${help}:${proposal.field ?? "Note"}` : help;
}

/**
 * The proposals still to be resolved that are about a help another of them is about too, each with how many others
 * there are: the team reads them together before agreeing on one. One carried out, taken back or answered with
 * another version is no longer to be chosen among.
 */
export function sharedHelp(views: ProposalView[]): Map<string, number> {
  const live = views.filter((view) => (view.state === "open" || view.state === "agreed") && proposalHelp(view.proposal));
  const count = new Map<string, number>();
  for (const view of live) count.set(proposalHelp(view.proposal), (count.get(proposalHelp(view.proposal)) ?? 0) + 1);
  const others = new Map<string, number>();
  for (const view of live) {
    const rest = count.get(proposalHelp(view.proposal))! - 1;
    if (rest) others.set(view.proposal.id, rest);
  }
  return others;
}

/**
 * What each help says after the proposals already applied to it, by `proposalWords`. A trial writes nothing: there
 * this is how a help is taken to read, so the next proposal for it is met as it would be in the project.
 */
export function appliedWords(views: ProposalView[]): Record<string, string> {
  const words: Record<string, string> = {};
  for (const view of [...views].sort((a, b) => a.at.localeCompare(b.at))) {
    if (view.state === "applied" && view.proposal.after !== undefined && proposalWords(view.proposal)) words[proposalWords(view.proposal)] = view.proposal.after;
  }
  return words;
}

/**
 * Proposals in the order they are read in: by place, those about one help together (where the first of them
 * came), each help's in the order they were made. By time alone, two versions of a note stood apart with what was
 * proposed for the other notes of the verse between them.
 */
export function byPlaceAndHelp<T extends ProposalView>(views: T[]): T[] {
  const place = (where: string) => {
    const [chapter, verse] = where.split(":").map(Number);
    return (chapter || 0) * 1000 + (verse || 0);
  };
  const first = new Map<string, string>();
  const group = (view: T) => proposalHelp(view.proposal) || view.proposal.id;
  for (const view of views) if (!first.has(group(view)) || view.at < first.get(group(view))!) first.set(group(view), view.at);
  return [...views].sort((a, b) => place(a.proposal.where) - place(b.proposal.where) || first.get(group(a))!.localeCompare(first.get(group(b))!) || group(a).localeCompare(group(b)) || a.at.localeCompare(b.at));
}

const ASK_MAX = 600;

/**
 * A proposal as it is asked of the team that maintains what it would change: why, and the new version when there
 * is one.
 */
export function proposalAsk(view: ProposalView): CorrectionAsk {
  const after = (view.proposal.after ?? "").replace(/\s+/g, " ").trim();
  const reason = view.reason.replace(/\s+/g, " ").trim();
  const text = [reason, after ? `→ «${after}»` : ""].filter(Boolean).join(" ");
  return { about: view.proposal.resource, where: view.proposal.where, text: text.length > ASK_MAX ? `${text.slice(0, ASK_MAX - 1).trimEnd()}…` : text, by: view.by };
}

// ---------------------------------------------------------------- the old words beside the new

export type DiffPiece = { text: string; kind: "same" | "gone" | "new" };

/** More words than this on each side and the two versions are shown whole, one after the other. */
const DIFF_CELLS = 2_000_000;

/**
 * What changed between two versions, word by word, for reading them as one text: the words taken out, the words
 * put in, and those that stayed. Spaces go with the word before them.
 */
export function wordDiff(before: string, after: string): DiffPiece[] {
  const a = before.match(/\S+\s*/g) ?? [];
  const b = after.match(/\S+\s*/g) ?? [];
  const word = (piece: string) => piece.trim();
  let start = 0;
  while (start < a.length && start < b.length && word(a[start]!) === word(b[start]!)) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && word(a[endA - 1]!) === word(b[endB - 1]!)) {
    endA--;
    endB--;
  }
  const out: DiffPiece[] = [];
  const push = (text: string, kind: DiffPiece["kind"]) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else if (text) out.push({ text, kind });
  };
  push(b.slice(0, start).join(""), "same");
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length * midB.length > DIFF_CELLS) {
    push(midA.join(""), "gone");
    push(midB.join(""), "new");
  } else {
    // The longest run of words the two middles share, kept in order.
    const rows = midA.length + 1;
    const cols = midB.length + 1;
    const table = new Uint32Array(rows * cols);
    for (let i = midA.length - 1; i >= 0; i--) {
      for (let j = midB.length - 1; j >= 0; j--) {
        table[i * cols + j] = word(midA[i]!) === word(midB[j]!) ? table[(i + 1) * cols + j + 1]! + 1 : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < midA.length && j < midB.length) {
      if (word(midA[i]!) === word(midB[j]!)) {
        push(midB[j]!, "same");
        i++;
        j++;
      } else if (table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!) push(midA[i++]!, "gone");
      else push(midB[j++]!, "new");
    }
    while (i < midA.length) push(midA[i++]!, "gone");
    while (j < midB.length) push(midB[j++]!, "new");
  }
  push(b.slice(endB).join(""), "same");
  // Words taken out at the end of a stretch keep the space that parted them from what follows.
  return out.map((piece, index) => (piece.kind === "gone" && out[index + 1]?.kind === "new" && !/\s$/.test(piece.text) ? { ...piece, text: `${piece.text} ` } : piece));
}

/**
 * The same, for reading in a line or two: the long stretches nothing changed in are cut to a few words at each
 * end, so what was taken out and put in is what is read. A note of nine lines with three words changed showed its
 * first two lines, where nothing had changed.
 */
export function diffExcerpt(pieces: DiffPiece[], keep = 6): DiffPiece[] {
  if (pieces.every((piece) => piece.kind === "same")) return pieces;
  return pieces.map((piece, index) => {
    if (piece.kind !== "same") return piece;
    const words = piece.text.match(/\S+\s*/g) ?? [];
    const first = index === 0;
    const last = index === pieces.length - 1;
    if (first) return words.length > keep ? { ...piece, text: `… ${words.slice(-keep).join("")}` } : piece;
    if (last) return words.length > keep ? { ...piece, text: `${words.slice(0, keep).join("").trimEnd()} …` } : piece;
    return words.length > keep * 2 + 1 ? { ...piece, text: `${words.slice(0, keep).join("").trimEnd()} … ${words.slice(-keep).join("")}` } : piece;
  });
}

// ---------------------------------------------------------------- a checklist opened to try

/**
 * Where the answers of a checklist opened to try are kept: in this tab, and nowhere else. A trial of one step is
 * followed by a trial of the agreement on what it proposed, so they have to outlast the screen; they never reach
 * the project.
 */
export function trialChecksKey(storeKey: string): string {
  return `gt-trial-checks:${scopeKey()}${storeKey}`;
}

export function loadTrialChecks(storeKey: string): CheckAnswer[] {
  try {
    const rows = JSON.parse(sessionStorage.getItem(trialChecksKey(storeKey)) ?? "[]") as unknown;
    return Array.isArray(rows) ? (rows as CheckAnswer[]) : [];
  } catch {
    return [];
  }
}

export function saveTrialChecks(storeKey: string, answers: CheckAnswer[]): void {
  try {
    sessionStorage.setItem(trialChecksKey(storeKey), JSON.stringify(answers));
  } catch {
    /* a private window: the trial lasts as long as its screen */
  }
}
