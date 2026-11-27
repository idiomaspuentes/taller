import type { DcsIssue } from "@ip-lms/dcs-client";
import { changesPending, handedInAgain, stepClaimMode, takenBackByAuthor } from "./stepClaim";
import { getStepRuntime, parseTaskProgressMarker, type TaskProgressMarker } from "./taskProgress";
import type { BoardCard } from "./myTasksBoard";
import type { TaskStep } from "./types";

/**
 * What a card of «Mis tareas» is about, said once: which of the situations of the design it is in, and whose move it
 * is. The card was read in three places (its button, its line, its bar) that did not always agree, and «Revisar»
 * meant four different things (24 November). Pure; no process is named here. See
 * docs/superpowers/specs/2026-11-24-tarjetas-claras-design.md.
 */

/** Whose move it is: the person's, somebody else's, the team's to take, or nothing to do now. */
export type BoardSection = "mine" | "waiting" | "take" | "more";
/** The parts of «Más», each with its subtitle. */
export type MorePart = "held" | "later" | "paused" | "done";

/**
 * The groups «Mis tareas» shows, by the kind of work each card asks of the person (team report and Abel's
 * decision, 26–27 November 2026, #79): their own work under way, somebody else's work that needs them (a review),
 * what the team does together (a reading, a decision), and what is free to take. What waits for others, is held,
 * paused, of the next book or done is not shown: the person needs to do nothing about it.
 */
export type TaskGroup = "progress" | "intervene" | "group" | "free";
export const TASK_GROUPS: readonly TaskGroup[] = ["progress", "intervene", "group", "free"];

export type CardState =
  | "free"
  | "nextBook"
  | "held"
  | "toStart"
  | "ownStep"
  | "finishStep"
  | "noReviewer"
  | "beingReviewed"
  | "changesAsked"
  | "correcting"
  | "yourAgreement"
  | "toDeliver"
  | "done"
  | "withdrawn"
  | "reviewOffered"
  | "reviewing"
  | "askedChanges"
  | "authorCorrecting"
  | "correctedLook"
  | "authorDelivers"
  | "groupNotYet"
  | "groupOffered"
  | "group"
  | "answered"
  | "approved"
  | "groupToDeliver"
  | "decide"
  | "proposals"
  | "paused"
  | "othersApprove"
  | "othersTurn"
  | "cannotTake";

export type CardSituation = {
  state: CardState;
  section: BoardSection;
  morePart?: MorePart;
  /** It came back to the person: changes asked of them, their agreement or their delivery missing, a correction asked. */
  returned: boolean;
  /** The people the card's line names (without «@»). */
  who?: string[];
};

type Input = Omit<BoardCard, "situation">;

const same = (a: string | undefined, b: string | undefined) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

function authorOf(issue: DcsIssue): string | undefined {
  return issue.assignee?.login || issue.assignees?.[0]?.login || undefined;
}

/**
 * Reviewing somebody's draft, or a step people do together. A step taken on a subtarea with an author, and not one
 * the group agrees on, is a review of that author's work; any other (a reading, a round of tuning, a list the team
 * checks, which no one person has) is the group's. Its words never say «lectura»: the process may call it otherwise.
 */
function isGroupStep(step: TaskStep, author: string | undefined): boolean {
  return step.closing === "consensus" || !author;
}

function seatsOf(progress: TaskProgressMarker, step: TaskStep): string[] {
  return getStepRuntime(progress, step.id).assignees;
}

function situation(state: CardState, section: BoardSection, extra: Partial<CardSituation> = {}): CardSituation {
  return { state, section, returned: false, ...extra };
}

const more = (state: CardState, part: MorePart): CardSituation => situation(state, "more", { morePart: part });

function decide(card: Input, login: string): CardSituation {
  const { action, group, issue } = card;
  const steps = card.task?.steps ?? [];
  const progress = parseTaskProgressMarker(issue.body ?? "");
  const author = authorOf(issue);
  const isAuthor = same(author, login);
  const by = (who: string | undefined) => (who ? [who] : []);

  if (group === "done") return more(card.stepsDone < card.stepsTotal ? "withdrawn" : "done", "done");
  if (group === "paused") return more("paused", "paused");
  if (group === "later") return more("nextBook", "later");
  if (group === "decide") return situation("decide", "mine");
  if (action.kind === "proposals") return situation("proposals", "mine");
  if (action.kind === "none" && action.why === "hold" && group === "waiting") return more(card.waitsFirstPassage ? "groupNotYet" : "held", "held");
  if (action.kind === "none" && action.why === "othersAnswer") return situation(action.step.solverAppId ? "answered" : "approved", "waiting");

  // Sent back to its author. Before «assigneeDelivers»: that is what the reviewer's action says while they wait.
  const sentBack = steps.find((step) => changesPending(steps, progress, step));
  if (sentBack) {
    const own = takenBackByAuthor(steps, progress, sentBack, author);
    if (isAuthor) return own ? situation("correcting", "mine") : situation("changesAsked", "mine", { returned: true });
    return situation(own ? "authorCorrecting" : "askedChanges", "waiting", { who: by(author) });
  }

  if (action.kind === "deliver") {
    const last = steps.at(-1);
    return situation(last && isGroupStep(last, author) && stepClaimMode(last) !== "none" ? "groupToDeliver" : "toDeliver", "mine", { returned: true });
  }

  if (!isAuthor) {
    const again = steps.find((step) => handedInAgain(steps, progress, step));
    if (again) {
      const seat = getStepRuntime(progress, again.id);
      if (seat.assignees.some((who) => same(who, login)) && !seat.approvals.some((who) => same(who, login))) return situation("correctedLook", "mine", { who: by(author) });
    }
  }

  // The author's own draft under review: whether it waits for a reviewer, is being reviewed, or waits for their word.
  const reviewStep = "step" in action ? action.step : undefined;
  if (isAuthor && reviewStep && (action.kind === "begin" || action.kind === "continue" || action.kind === "approveStep") && stepClaimMode(reviewStep) !== "none" && reviewStep.includeAuthorInApproval) {
    const runtime = getStepRuntime(progress, reviewStep.id);
    const others = runtime.approvals.filter((who) => !same(who, login));
    if (others.length && others.length === runtime.approvals.length) return situation("yourAgreement", "mine", { returned: true, who: others });
    const reviewers = runtime.assignees.filter((who) => !same(who, login));
    return reviewers.length ? situation("beingReviewed", "waiting", { who: reviewers }) : situation("noReviewer", "waiting");
  }

  if (action.kind === "none" && action.why === "othersReview") {
    const next = card.nextStep;
    const reviewers = next ? seatsOf(progress, next).filter((who) => !same(who, login)) : [];
    // «Su borrador» only to its author: whoever sat in an earlier step of somebody else's work waits on others too.
    if (!isAuthor) return situation("othersTurn", "waiting", reviewers.length ? { who: reviewers } : {});
    return reviewers.length ? situation("beingReviewed", "waiting", { who: reviewers }) : situation("noReviewer", "waiting");
  }
  if (action.kind === "none" && action.why === "assigneeDelivers") return situation("authorDelivers", "waiting", { who: by(author) });

  // Somebody else's work, approved by the person, that waits for others' approval (the author's word, the rest of a
  // pastoral review): it is not their move. Its action still opens the review, to change it. Not a round the group
  // answers: there, once every answer is in, whoever is seated closes it.
  const taken = action.kind === "begin" || action.kind === "continue" || action.kind === "approveStep" ? action.step : undefined;
  if (!isAuthor && taken && stepClaimMode(taken) !== "none" && (taken.closing ?? "approval") === "approval") {
    const runtime = getStepRuntime(progress, taken.id);
    if (runtime.approvals.some((who) => same(who, login))) {
      const authorMissing = Boolean(author && taken.includeAuthorInApproval && !runtime.approvals.some((who) => same(who, author)));
      return situation("othersApprove", "waiting", authorMissing ? { who: by(author) } : {});
    }
  }

  if (action.kind === "claimStep") {
    return isGroupStep(action.step, author) ? situation("groupOffered", "take") : situation("reviewOffered", "take", { who: by(author) });
  }
  if (action.kind === "approveStep") {
    if (action.step.closing === "self") return situation("finishStep", "mine");
    return isGroupStep(action.step, author) ? situation("group", "mine") : situation("reviewing", "mine", { who: by(author) });
  }
  if ((action.kind === "begin" || action.kind === "continue") && action.step && stepClaimMode(action.step) !== "none" && !isAuthor) {
    return isGroupStep(action.step, author) ? situation("group", "mine") : situation("reviewing", "mine", { who: by(author) });
  }
  if (action.kind === "begin") return group === "free" ? situation("free", "take") : situation("toStart", "mine");
  if (action.kind === "continue") return situation("ownStep", "mine");
  // Free work this person cannot take (the project does not let people take work, or they only listen): whoever
  // coordinates gives it. In «Para tomar», which opens by itself, it was a list of cards with nothing to press.
  if (action.kind === "none" && action.why === "hold" && group === "free") return more("cannotTake", "held");
  if (action.kind === "vote") return situation("decide", "mine");
  return more("held", "held");
}

/** The situation of a card, for the person who looks at the board (`login`). */
export function cardSituation(card: Input, login: string): CardSituation {
  const found = decide(card, login);
  // A correction asked of the person comes back to them like changes asked do.
  if (found.section === "mine" && (card.askedBack || card.redoOf)) return { ...found, returned: true };
  return found;
}
