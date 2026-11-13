import type { DcsIssue } from "@ip-lms/dcs-client";
import type { AssignmentsDoc, HandoffUnit, ProjectTask, WaitRule, WaitScope } from "./types";
import { unitIdOfWork } from "./handoff";
import { WAIT_SCOPE_LABEL, isWaitScope, normalizeWaitRules } from "./waitRules";

export { WAIT_SCOPE_LABEL, isWaitScope, normalizeWaitRules };
import { chapterFromIssue } from "./solverLaunch";
import { issueTaskId } from "./myTasks";
import { parseWorkOrderMarker } from "./workOrder";
import { getStepRuntime, isStepDone, parseTaskProgressMarker } from "./taskProgress";
import { stepClaimMode, stepMaxAssignees } from "./stepClaim";

/**
 * «Esperas»: a task that cannot start until other work is closed.
 *
 * A rule names what is waited for (one task or a whole phase) and how much of
 * it: the same portion, the same chapter, or all of it. Only OPEN subtareas
 * block, so closing the last blocking one is what enables the waiting one.
 * The rules live in the plan and in workflow templates; nothing FCR-specific
 * is in this file.
 */

/**
 * Drop rules whose target no longer exists, or that point at the task itself. A task may wait for its own earlier
 * chapters: that is how a team whose work is one task (Traducir TPL) takes one chapter at a time.
 */
export function pruneWaitRules(task: ProjectTask, board: Pick<AssignmentsDoc, "teams" | "phases">): WaitRule[] | undefined {
  const taskIds = new Set(board.teams.map((t) => t.id));
  const phaseIds = new Set(board.phases.map((p) => p.id));
  const kept = (task.waitsFor ?? []).filter((rule) =>
    // A wait on the source project names a task this project does not have: it always stays.
    rule.source ? Boolean(rule.taskId) : rule.taskId ? taskIds.has(rule.taskId) && (rule.taskId !== task.id || rule.scope === "before") : Boolean(rule.phaseId && phaseIds.has(rule.phaseId)),
  );
  return kept.length ? kept : undefined;
}

/** Would adding `rule` to `task` make tasks wait on each other in a loop? */
export function waitWouldLoop(board: Pick<AssignmentsDoc, "teams">, taskId: string, rule: WaitRule): boolean {
  // What waits for earlier chapters only waits for work it is never itself part of: a phase may wait for its own
  // earlier chapters.
  if (rule.scope === "before") return false;
  const byId = new Map(board.teams.map((t) => [t.id, t]));
  const targets = (r: WaitRule): string[] =>
    r.source ? [] : r.taskId ? [r.taskId] : board.teams.filter((t) => t.phaseId === r.phaseId).map((t) => t.id);
  const stack = targets(rule);
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of byId.get(id)?.waitsFor ?? []) stack.push(...targets(next));
  }
  return false;
}

function portionIdsOf(issue: DcsIssue): string[] {
  return parseWorkOrderMarker(issue.body)?.portionIds ?? [];
}

function sameScope(scope: WaitScope, waiting: DcsIssue, blocker: DcsIssue, units?: HandoffUnit[]): boolean {
  if (scope === "all") return true;
  const chapterA = chapterFromIssue(waiting);
  const chapterB = chapterFromIssue(blocker);
  // One chapter at a time: only what is left of an earlier chapter holds. Work of no chapter (an article) holds
  // nothing, and is held by nothing.
  if (scope === "before") return Boolean(chapterA && chapterB && chapterB < chapterA);
  // «El capítulo» is the unit of handoff: a chapter split into stretches waits stretch by stretch.
  if (scope === "chapter" && units?.length && chapterA && chapterA === chapterB) {
    const a = portionIdsOf(waiting);
    const b = portionIdsOf(blocker);
    if (a.length && b.length) return unitIdOfWork(units, a, chapterA) === unitIdOfWork(units, b, chapterB);
  }
  if (scope === "portion") {
    const a = portionIdsOf(waiting);
    const b = portionIdsOf(blocker);
    if (a.length && b.length) {
      const set = new Set(a);
      return b.some((id) => set.has(id));
    }
    // No portion recorded on one side: the chapter is the closest match.
  }
  // Without a chapter on either side we cannot narrow it, so the wait applies.
  if (!chapterA || !chapterB) return true;
  return chapterA === chapterB;
}

export type WaitBlock = {
  rule: WaitRule;
  /** Open subtareas that still hold this one back. Empty for a wait on the source project that has not started there. */
  issues: DcsIssue[];
};

/**
 * A wait on the source project: free only when that project has the task for the same chapter and closed it.
 * `sourceIssues` are all its subtareas, open and closed; `undefined` = they could not be read, so it still waits.
 */
function sourceHolds(rule: WaitRule, issue: DcsIssue, sourceIssues: DcsIssue[] | undefined): DcsIssue[] | null {
  if (!sourceIssues) return [];
  // Passages are numbered by each project: across projects only the chapter can be compared.
  const scope: WaitScope = rule.scope === "all" ? "all" : "chapter";
  const theirs = sourceIssues.filter((other) => issueTaskId(other) === rule.taskId && sameScope(scope, issue, other));
  if (!theirs.length) return [];
  const open = theirs.filter((other) => other.state !== "closed");
  return open.length ? open : null;
}

/**
 * Whether somebody could still join an open subtarea: its step in course has a place free (nobody took it, or it
 * takes more people than it has). Without steps, whether nobody took it.
 */
export function hasPlaceFree(issue: DcsIssue, task: Pick<ProjectTask, "steps"> | undefined): boolean {
  const progress = parseTaskProgressMarker(issue.body ?? "");
  const taken = Boolean(issue.assignee?.login || issue.assignees?.some((a) => a?.login));
  const step = (task?.steps ?? []).find((s) => !isStepDone(progress, s.id));
  if (!step) return !taken;
  const seated = getStepRuntime(progress, step.id).assignees.length;
  const mode = stepClaimMode(step);
  if (mode === "pool") return seated < stepMaxAssignees(step);
  if (mode === "exclusive") return seated === 0;
  return !taken;
}

type Board = Pick<AssignmentsDoc, "teams"> & Partial<Pick<AssignmentsDoc, "settings">>;
/** Whether each open subtarea holds the later chapters, worked out once per list of open subtareas. */
const holdsMemo = new WeakMap<object, WeakMap<DcsIssue[], Map<number, boolean>>>();

/**
 * Whether an open subtarea of an earlier chapter still holds the later ones back: it does while somebody could take
 * it now, with nothing holding it and a place free. One that is full (taken by the one person it takes, or with all
 * its places), or itself waiting, holds nobody: whoever is free goes on with the next chapter, and nobody is left
 * without work (Abel, 17 October).
 */
function holdsLaterChapters(other: DcsIssue, board: Board, openIssues: DcsIssue[], sourceIssues: DcsIssue[] | undefined, seen: Set<number>): boolean {
  let byList = holdsMemo.get(board);
  if (!byList) holdsMemo.set(board, (byList = new WeakMap()));
  let memo = byList.get(openIssues);
  if (!memo) byList.set(openIssues, (memo = new Map()));
  const known = memo.get(other.number);
  if (known !== undefined) return known;
  if (seen.has(other.number)) return true;
  const task = board.teams.find((t) => t.id === issueTaskId(other));
  const holds = hasPlaceFree(other, task) && waitBlocksIn(other, board, openIssues, sourceIssues, new Set([...seen, other.number])).length === 0;
  memo.set(other.number, holds);
  return holds;
}

/**
 * What holds `issue` back. `openIssues` are the OPEN subtareas of the project.
 * Empty when nothing is pending, or when the task has no rules.
 */
export function waitBlocks(
  issue: DcsIssue,
  board: Board,
  openIssues: DcsIssue[],
  /** Every subtarea of the source project, for the rules that wait on it (see `WaitRule.source`). */
  sourceIssues?: DcsIssue[],
): WaitBlock[] {
  return waitBlocksIn(issue, board, openIssues, sourceIssues, new Set([issue.number]));
}

function waitBlocksIn(issue: DcsIssue, board: Board, openIssues: DcsIssue[], sourceIssues: DcsIssue[] | undefined, seen: Set<number>): WaitBlock[] {
  const taskId = issueTaskId(issue);
  const task = taskId ? board.teams.find((t) => t.id === taskId) : undefined;
  if (!task?.waitsFor?.length) return [];
  const blocks: WaitBlock[] = [];
  // Partial rules hold the task only while none of them has anything closed.
  const partial: WaitBlock[] = [];
  let someArrived = false;
  const mine = portionIdsOf(issue);
  for (const rule of task.waitsFor) {
    if (rule.open) continue;
    if (rule.source) {
      const held = sourceHolds(rule, issue, sourceIssues);
      if (held) blocks.push({ rule, issues: held });
      continue;
    }
    const targetIds = new Set(
      rule.taskId ? [rule.taskId] : board.teams.filter((t) => t.phaseId === rule.phaseId).map((t) => t.id),
    );
    const holding = openIssues.filter(
      (other) =>
        other.number !== issue.number &&
        other.state !== "closed" &&
        targetIds.has(issueTaskId(other)) &&
        sameScope(rule.scope, issue, other, board.settings?.handoffUnits) &&
        // An earlier chapter holds only with work somebody could take now (see `holdsLaterChapters`).
        (rule.scope !== "before" || holdsLaterChapters(other, board, openIssues, sourceIssues, seen)),
    );
    if (rule.partial) {
      // Only open subtareas are known here: a passage of this task that no open one covers is one that was closed.
      // (Subtareas are published together, so a task with none open in this stretch has closed them all.)
      const stillOpen = new Set(holding.flatMap(portionIdsOf));
      if (!holding.length || mine.some((id) => !stillOpen.has(id))) someArrived = true;
      else partial.push({ rule, issues: holding });
      continue;
    }
    if (holding.length) blocks.push({ rule, issues: holding });
  }
  if (!someArrived) blocks.push(...partial);
  return blocks;
}

export function isWaiting(issue: DcsIssue, board: Pick<AssignmentsDoc, "teams">, openIssues: DcsIssue[] | undefined): boolean {
  return openIssues ? waitBlocks(issue, board, openIssues).length > 0 : false;
}

/** «Espera a Traducir TPL de Ana», in words the team reads. */
export function waitReason(
  blocks: WaitBlock[],
  board: Pick<AssignmentsDoc, "teams" | "phases">,
): string {
  if (!blocks.length) return "";
  const first = blocks[0]!;
  if (first.rule.source) return `Espera a que el proyecto fuente lo publique${blocks.length > 1 ? ` y ${blocks.length - 1} más` : ""}`;
  const name = first.rule.taskId
    ? board.teams.find((t) => t.id === first.rule.taskId)?.name || "otra tarea"
    : board.phases.find((p) => p.id === first.rule.phaseId)?.name || "otra fase";
  const owner = first.issues.length === 1 ? first.issues[0]!.assignee?.login || first.issues[0]!.assignees?.[0]?.login : undefined;
  const more = blocks.length > 1 ? ` y ${blocks.length - 1} más` : "";
  if (first.rule.scope === "before") {
    // The chapter to finish first, not who is in it: «Espera al capítulo 1 de «Afinación»».
    const chapter = Math.min(...first.issues.map((issue) => chapterFromIssue(issue)).filter((c) => c > 0));
    if (Number.isFinite(chapter)) return `Espera al capítulo ${chapter} de «${name}»${more}`;
  }
  return owner ? `Espera a «${name}» de @${owner}${more}` : `Espera a «${name}»${more}`;
}

/**
 * Open subtareas that were waiting on `closed` and have nothing else holding
 * them now. `openBefore` includes `closed`; the result is what it enabled.
 */
export function newlyEnabled(
  closed: DcsIssue,
  board: Pick<AssignmentsDoc, "teams">,
  openBefore: DcsIssue[],
): DcsIssue[] {
  const stillOpen = openBefore.filter((issue) => issue.number !== closed.number);
  return stillOpen.filter(
    (issue) =>
      waitBlocks(issue, board, openBefore).some((block) => block.issues.some((h) => h.number === closed.number)) &&
      waitBlocks(issue, board, stillOpen).length === 0,
  );
}
