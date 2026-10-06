import { waitBlocks, waitReason } from "./waits";
import type { DcsIssue } from "@ip-lms/dcs-client";
import type { GtSession } from "../dcs/auth";
import { isIssueAssignedTo, isIssueUnassigned, issueIsInProgress } from "../dcs/issues";
import { attentionRank, rowActivity, type RowActivity } from "./attention";
import { audienceOf } from "./audience";
import { BOOKS } from "./books";
import { isDecisionIssue } from "./decisionAccess";
import type { LevelSource } from "./levels";
import { canClaimIssue, issueProjectId, issueTaskId, listStepClaimOffers, type MyTasksProjectBucket } from "./myTasks";
import type { ReadCursorDoc } from "./readCursor";
import { canApproveStep, canClaimStep, isStepActor, stepClaimMode } from "./stepClaim";
import { withOnceSteps } from "./stepOnce";
import { allStepsDone, getStepRuntime, parseTaskProgressMarker } from "./taskProgress";
import type { ProjectTask, TaskStep } from "./types";

/**
 * «Mis tareas» as a person who is not at ease with computers needs it: one flat list of cards, grouped by what
 * there is to do, each card with ONE action that says what will happen. Pure: no Door43 calls, no React.
 * See docs/PLAN_MIS_TAREAS.md.
 */

export type BoardGroup = "decide" | "doing" | "todo" | "reviews" | "free" | "later" | "waiting" | "done";

/** The order the groups are shown in; the first ones are open, the rest folded. */
export const GROUP_ORDER: BoardGroup[] = ["decide", "doing", "todo", "reviews", "free", "later", "waiting", "done"];
export const OPEN_GROUPS: BoardGroup[] = ["decide", "doing", "todo", "reviews"];

export type CardAction =
  /** Take it if free (or start it if mine) and open the tool of its next step. */
  | { kind: "begin"; step?: TaskStep }
  /** Open the tool of the next step that is mine to do (or the task's tool when it has no steps). */
  | { kind: "continue"; step?: TaskStep }
  /** Everything is done: hand the work over (closes the subtarea). Asks first. */
  | { kind: "deliver" }
  | { kind: "vote" }
  /** A review step others started: take a seat in it. */
  | { kind: "claimStep"; step: TaskStep }
  /** A review step I am seated in: approve it. */
  | { kind: "approveStep"; step: TaskStep }
  /** Nothing to press; `why` says what the card is waiting for. */
  | { kind: "none"; why: "hold" | "othersReview" | "assigneeDelivers" | "done" | "noTool" };

export type BoardCard = {
  issue: DcsIssue;
  bucket?: MyTasksProjectBucket;
  task?: ProjectTask;
  group: BoardGroup;
  action: CardAction;
  /** Started (marked in progress): the main button says «Seguir» instead of «Empezar». */
  started: boolean;
  /** The task's own name (not translated here). */
  taskName: string;
  /** Book code and the place inside it as written in the subtarea title: `NEH`, `2` or `1:1–8`. */
  book: string;
  place: string;
  stepsDone: number;
  stepsTotal: number;
  /** The first step not done yet. */
  nextStep?: TaskStep;
  /** Why it cannot start (as the domain writes it, in Spanish; translated when shown). */
  holdText?: string;
  activity: RowActivity;
  /** Mine to deliver (assigned to me), so «Entregar» can be offered in the card's menu. */
  canDeliver: boolean;
  /** `issue` carries once-per-chapter steps I did elsewhere that are not saved in this subtarea yet. */
  onceApplied: boolean;
  /** Mine, and the project lets people give work back. */
  canRelease: boolean;
};

export type BoardInput = {
  session: Pick<GtSession, "username" | "teams" | "canManage">;
  pmOrg: string;
  projects: MyTasksProjectBucket[];
  /** Closed subtareas with a verse conflict to decide (they need a vote). */
  decisionIssues: DcsIssue[];
  /** My subtareas closed lately. */
  closedIssues: DcsIssue[];
  cursor: ReadCursorDoc;
  myLevel?: LevelSource;
};

export type Board = Record<BoardGroup, BoardCard[]>;

function taskOf(issue: DcsIssue, bucket?: MyTasksProjectBucket): ProjectTask | undefined {
  const id = issueTaskId(issue);
  return id && bucket ? bucket.board.teams.find((t) => t.id === id) : undefined;
}

/** `NEH 1:1–8 · TPL` → place `1:1–8`; `NEH 2 · Traducir TPL 1` → `2`. */
export function placeOf(issue: DcsIssue): { book: string; place: string } {
  const title = (issue.title ?? "").trim();
  const head = title.split(" · ")[0] ?? "";
  const match = /^([1-3]?[A-Z]{2,3})\s+(.+)$/.exec(head);
  if (match) return { book: match[1]!, place: match[2]!.trim() };
  return { book: issueProjectId(issue).toUpperCase(), place: "" };
}

function assigneeOf(issue: DcsIssue): string | undefined {
  return issue.assignee?.login || issue.assignees?.[0]?.login || undefined;
}

/** What the next pending step asks of me, for a subtarea that is mine (assigned or seated in a step). */
function stepAction(login: string, steps: TaskStep[], issue: DcsIssue, mine: boolean): { action: CardAction; next?: TaskStep } {
  const progress = parseTaskProgressMarker(issue.body ?? "");
  const assignee = assigneeOf(issue);
  if (allStepsDone(steps.map((s) => s.id), progress)) {
    return { action: mine ? { kind: "deliver" } : { kind: "none", why: "assigneeDelivers" } };
  }
  const next = steps.find((s) => !progress.doneStepIds.includes(s.id))!;
  const mode = stepClaimMode(next);
  if (mode === "none") return { action: mine ? { kind: "continue", step: next } : { kind: "none", why: "assigneeDelivers" }, next };
  // The author of the text is part of a pair review, but there is nothing to confirm until someone takes it.
  const seats = getStepRuntime(progress, next.id).assignees;
  if (!seats.length && !canClaimStep(login, steps, progress, next, undefined, assignee)) return { action: { kind: "none", why: "othersReview" }, next };
  if (isStepActor(login, progress, next, assignee)) {
    // Seated: my part is to do it (open its tool) and, in a review, approve it.
    if (canApproveStep(login, progress, next, assignee) && !next.solverAppId) return { action: { kind: "approveStep", step: next }, next };
    return { action: { kind: "continue", step: next }, next };
  }
  if (canClaimStep(login, steps, progress, next, undefined, assignee)) return { action: { kind: "claimStep", step: next }, next };
  return { action: { kind: "none", why: "othersReview" }, next };
}

/**
 * The step that follows in a subtarea of mine, when it is mine alone to do and can be done right away (the draft,
 * after studying the passage). `undefined`: what follows is a step people join (a review, where the author's part
 * comes after somebody else's and is offered on the card), or there is nothing left but to hand the work in.
 */
export function nextStepOfMine(login: string, steps: TaskStep[], issue: DcsIssue): TaskStep | undefined {
  if (!steps.length || !isIssueAssignedTo(issue, login)) return undefined;
  const { action } = stepAction(login, steps, issue, true);
  return action.kind === "continue" && action.step && stepClaimMode(action.step) === "none" ? action.step : undefined;
}

export function buildBoard(input: BoardInput): Board {
  const { session, pmOrg, projects, cursor, myLevel } = input;
  const login = session.username;
  const board: Board = { decide: [], doing: [], todo: [], reviews: [], free: [], later: [], waiting: [], done: [] };
  const seen = new Set<number>();
  const onceApplied = new Set<number>();

  const card = (issue: DcsIssue, bucket: MyTasksProjectBucket | undefined, group: BoardGroup, action: CardAction, extra: Partial<BoardCard> = {}): BoardCard => {
    const task = taskOf(issue, bucket);
    const steps = task?.steps ?? [];
    const progress = parseTaskProgressMarker(issue.body ?? "");
    const { book, place } = placeOf(issue);
    const mineAssigned = isIssueAssignedTo(issue, login);
    return {
      issue,
      bucket,
      task,
      group,
      action,
      started: issueIsInProgress(issue),
      taskName: task?.name ?? "",
      book,
      place,
      stepsDone: steps.filter((s) => progress.doneStepIds.includes(s.id)).length,
      stepsTotal: steps.length,
      nextStep: steps.find((s) => !progress.doneStepIds.includes(s.id)),
      activity: rowActivity(cursor, issue.number, { decision: group === "decide" }),
      // A subtarea with steps is delivered once they are all done. The menu offered it at any moment, so its author
      // could hand the work in with its review open: the reviewer's part of the agreement counted for nothing.
      canDeliver: mineAssigned && group !== "done" && (steps.length ? allStepsDone(steps.map((s) => s.id), progress) : issueIsInProgress(issue)),
      canRelease: mineAssigned && group !== "done" && Boolean(bucket?.browseProject || session.canManage),
      onceApplied: onceApplied.has(issue.number),
      ...extra,
    };
  };

  // Decisions: closed subtareas with a verse to decide, and team decisions of my teams.
  for (const issue of input.decisionIssues) {
    if (seen.has(issue.number)) continue;
    seen.add(issue.number);
    const bucket = projects.find((p) => p.projectId.toUpperCase() === issueProjectId(issue).toUpperCase());
    board.decide.push(card(issue, bucket, "decide", { kind: "vote" }));
  }

  for (const bucket of projects) {
    for (const raw of bucket.issues) {
      if (seen.has(raw.number) || (raw.state ?? "open").toLowerCase() === "closed") continue;
      const task = taskOf(raw, bucket);
      const steps = task?.steps ?? [];
      // Steps done once per chapter (reading it) that I already did in another subtarea count as done in this one.
      const once = isIssueAssignedTo(raw, login) || isIssueUnassigned(raw) ? withOnceSteps(login, raw, steps, bucket.issues, (other) => taskOf(other, bucket)) : { issue: raw, changed: false };
      const issue = once.issue;
      if (once.changed) onceApplied.add(issue.number);
      const audience = audienceOf({ issue, project: bucket, session, pmOrg, myLevel });
      const seated = steps.some((s) => (s.claimMode === "exclusive" || s.claimMode === "pool") && isStepActor(login, parseTaskProgressMarker(issue.body ?? ""), s, assigneeOf(issue)));
      const mine = audience.relation === "mine";
      if (audience.relation === "other" && !seated) continue;

      seen.add(issue.number);
      if (isDecisionIssue(issue)) {
        board.decide.push(card(issue, bucket, "decide", { kind: "vote" }));
        continue;
      }
      if (audience.hold) {
        board.waiting.push(card(issue, bucket, "waiting", { kind: "none", why: "hold" }, { holdText: audience.hold.text }));
        continue;
      }
      if (audience.relation === "free") {
        const can = canClaimIssue(session as GtSession, pmOrg, issue, bucket.board, myLevel);
        const progress = parseTaskProgressMarker(issue.body ?? "");
        const next = steps.find((s) => !progress.doneStepIds.includes(s.id));
        const tookPart = steps.some((s) => getStepRuntime(progress, s.id).assignees.some((a) => a.toLowerCase() === login.toLowerCase()));
        if (steps.length && !next) {
          // Every step is done and the subtarea belongs to the team: whoever took part delivers it.
          if (tookPart) board.doing.push(card(issue, bucket, "doing", { kind: "deliver" }, { canDeliver: true }));
          continue;
        }
        if (next && stepClaimMode(next) !== "none") {
          // A step of the whole team: people join the step, and the subtarea stays with the team. Nobody takes it whole.
          if (isStepActor(login, progress, next, assigneeOf(issue))) board.doing.push(card(issue, bucket, "doing", { kind: "continue", step: next }));
          else if (can && canClaimStep(login, steps, progress, next, undefined, assigneeOf(issue))) board.reviews.push(card(issue, bucket, "reviews", { kind: "claimStep", step: next }));
          continue;
        }
        board.free.push(card(issue, bucket, "free", can ? { kind: "begin", step: next } : { kind: "none", why: "hold" }));
        continue;
      }
      // Mine (assigned) or seated in one of its steps.
      if (steps.length) {
        const { action } = stepAction(login, steps, issue, mine);
        // My own task is under way only once I started it; a task of someone else is, as soon as I sit in one of its steps.
        const group: BoardGroup = issueIsInProgress(issue) || (seated && !mine) ? "doing" : "todo";
        const shown = group === "todo" && action.kind === "continue" ? { kind: "begin" as const, step: action.step } : action;
        board[group].push(card(issue, bucket, group, shown));
      } else {
        const started = issueIsInProgress(issue);
        board[started ? "doing" : "todo"].push(card(issue, bucket, started ? "doing" : "todo", started ? { kind: "continue" } : { kind: "begin" }));
      }
    }
  }

  // Review steps of my teams that I can take or approve, on subtareas that are not mine.
  for (const offer of listStepClaimOffers(session as GtSession, pmOrg, projects)) {
    if (seen.has(offer.issue.number)) continue;
    seen.add(offer.issue.number);
    const bucket = projects.find((p) => p.projectId === offer.projectId);
    // A step cannot be joined on a subtarea that still waits for other work: it is listed as waiting, with what it
    // waits for. (A task with no team reaches here without having been looked at above.)
    const blocks = bucket?.openIssues ? waitBlocks(offer.issue, bucket.board, bucket.openIssues, bucket.sourceIssues) : [];
    if (bucket && blocks.length) {
      board.waiting.push(card(offer.issue, bucket, "waiting", { kind: "none", why: "hold" }, { holdText: waitReason(blocks, bucket.board) }));
      continue;
    }
    board.reviews.push(card(offer.issue, bucket, "reviews", offer.action === "claim" ? { kind: "claimStep", step: offer.step } : { kind: "approveStep", step: offer.step }));
  }

  for (const issue of input.closedIssues) {
    if (seen.has(issue.number)) continue;
    seen.add(issue.number);
    const bucket = projects.find((p) => p.projectId.toUpperCase() === issueProjectId(issue).toUpperCase());
    board.done.push(card(issue, bucket, "done", { kind: "none", why: "done" }));
  }

  oneBookAtATime(board, projects);

  for (const group of GROUP_ORDER) {
    if (group === "done") board.done.sort((a, b) => Date.parse(b.issue.closed_at ?? b.issue.updated_at ?? "") - Date.parse(a.issue.closed_at ?? a.issue.updated_at ?? ""));
    else if (group === "free" || group === "later" || group === "waiting") board[group].sort(byPlace);
    else board[group].sort((a, b) => attentionRank(a.activity, b.activity));
  }
  return board;
}

/** Chapter and verse a subtarea starts at, from its place (`1:3–4`, `2`); what is not of a passage comes after them all. */
function startOf(place: string): [number, number] {
  const at = /^(\d+)(?::(\d+))?/.exec(place.trim());
  return at ? [Number(at[1]), Number(at[2] ?? 0)] : [Number.MAX_SAFE_INTEGER, 0];
}

/**
 * Work nobody has taken (and work that waits) is listed from the beginning of the book: by passage, and the tasks of
 * one passage in the order the plan lists them; the articles, which are of no passage, after the passages. Sorted by its latest
 * activity, as the rest is, work nobody had touched came out in the order it was created in, backwards: the first
 * passage of a book was the last of 49 cards, and nothing said where to start. Something said about one of them
 * to this person still comes first.
 */
function byPlace(a: BoardCard, b: BoardCard): number {
  if (a.activity.needsAttention !== b.activity.needsAttention) return a.activity.needsAttention ? -1 : 1;
  const bookAt = (card: BoardCard) => {
    const at = BOOKS.findIndex((row) => row.code === card.book.toUpperCase());
    return at < 0 ? BOOKS.length : at;
  };
  const taskAt = (card: BoardCard) => {
    const at = card.bucket && card.task ? card.bucket.board.teams.findIndex((task) => task.id === card.task!.id) : -1;
    return at < 0 ? Number.MAX_SAFE_INTEGER : at;
  };
  const [chapterA, verseA] = startOf(a.place);
  const [chapterB, verseB] = startOf(b.place);
  return bookAt(a) - bookAt(b) || chapterA - chapterB || verseA - verseB || taskAt(a) - taskAt(b) || a.issue.number - b.issue.number;
}

/** When a project was started, to tell which of two books came first. Unknown = no order can be told. */
const startedAt = (bucket: MyTasksProjectBucket): number => Date.parse(bucket.board.workflowAppliedAt ?? bucket.board.exported_at ?? "");

/**
 * A team works one book at a time, but the books overlap by phase: the next book exists before the team finishes
 * the one in hand. Free work of a task is offered for the earliest book that still has open work of that task; the
 * same task in later books waits under «Del siguiente libro», and moves up by itself when the earlier book is done.
 */
function oneBookAtATime(board: Board, projects: MyTasksProjectBucket[]): void {
  const current = new Map<string, MyTasksProjectBucket>();
  for (const bucket of projects) {
    const at = startedAt(bucket);
    if (Number.isNaN(at)) continue;
    const open = bucket.openIssues ?? bucket.issues;
    for (const taskId of new Set(open.map((issue) => issueTaskId(issue)).filter(Boolean))) {
      const before = current.get(taskId);
      if (!before || at < startedAt(before)) current.set(taskId, bucket);
    }
  }
  const stay: BoardCard[] = [];
  for (const row of board.free) {
    const first = row.task && row.bucket ? current.get(row.task.id) : undefined;
    const later = Boolean(first) && first !== row.bucket && !Number.isNaN(startedAt(row.bucket!)) && startedAt(row.bucket!) > startedAt(first!);
    if (later) board.later.push({ ...row, group: "later" });
    else stay.push(row);
  }
  board.free = stay;
}

/** The one card that is «what to do now»: a decision, then work in progress, then work to start, then a review. */
export function nextCard(board: Board): BoardCard | undefined {
  return board.decide[0] ?? board.doing.find((c) => c.action.kind !== "none") ?? board.todo[0] ?? board.reviews[0] ?? board.free[0];
}

export const boardCount = (board: Board): number => GROUP_ORDER.reduce((n, g) => n + (g === "done" ? 0 : board[g].length), 0);
