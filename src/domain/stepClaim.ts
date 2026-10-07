import type { ProjectTask, TaskStep } from "./types";
import { taskHasOwnDraft } from "./branchNames";
import {
  getStepRuntime,
  isStepDone,
  markStepDone,
  type TaskProgressMarker,
  withStepRuntime,
} from "./taskProgress";

export function stepClaimMode(step: TaskStep): "none" | "exclusive" | "pool" {
  return step.claimMode === "exclusive" || step.claimMode === "pool"
    ? step.claimMode
    : "none";
}

export function stepMinAssignees(step: TaskStep): number {
  if (stepClaimMode(step) !== "pool") return 1;
  const n = Number(step.minAssignees);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 2;
}

export function stepMaxAssignees(step: TaskStep): number {
  if (stepClaimMode(step) !== "pool") return 1;
  const min = stepMinAssignees(step);
  const n = Number(step.maxAssignees);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : min;
}

/** Compact label for one step: «Uno», «Pares», «Varios 2», «Grupal». */
export function formatStepClaimLabel(step: TaskStep): string | null {
  const mode = stepClaimMode(step);
  if (mode === "exclusive") {
    return step.includeAuthorInApproval ? "Pares" : "Uno";
  }
  if (mode === "pool") {
    const min = stepMinAssignees(step);
    return min === 2 ? "Grupal" : `Varios ${min}`;
  }
  return null;
}

/**
 * Compact claim mix for a task list: «3 pasos · Uno · Varios 2».
 * Dedupes labels; empty when no claim-policy steps.
 */
export function formatTaskClaimSummary(steps: TaskStep[] | undefined): string {
  if (!steps?.length) return "";
  const seen = new Set<string>();
  const bits: string[] = [];
  for (const step of steps) {
    const label = formatStepClaimLabel(step);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    bits.push(label);
  }
  return bits.join(" · ");
}

/** Previous steps in list order must all be done. */
export function isStepUnlocked(
  steps: TaskStep[],
  progress: TaskProgressMarker,
  stepId: string,
): boolean {
  const idx = steps.findIndex((s) => s.id === stepId);
  if (idx < 0) return false;
  for (let i = 0; i < idx; i++) {
    if (!isStepDone(progress, steps[i].id)) return false;
  }
  return true;
}

/** Logins who sat as assignees on any excluded prior step. */
export function excludedLoginsFromPriorSteps(
  progress: TaskProgressMarker,
  excludePriorStepIds: string[] | undefined,
  issueAssigneeFallback?: string,
): Set<string> {
  const out = new Set<string>();
  const fb = issueAssigneeFallback?.trim().toLowerCase();
  for (const id of excludePriorStepIds ?? []) {
    const runtime = getStepRuntime(progress, id);
    for (const login of runtime.assignees) {
      out.add(login.toLowerCase());
    }
    // Draft steps with claimMode none may only have doneStepIds (no seating).
    if (!runtime.assignees.length && isStepDone(progress, id) && fb) {
      out.add(fb);
    }
  }
  return out;
}

/**
 * Author for includeAuthorInApproval: first assignee of the first excludePrior
 * step, else optional issue-assignee fallback (draft steps with claimMode none).
 */
export function resolveStepAuthor(
  progress: TaskProgressMarker,
  step: TaskStep,
  fallbackLogin?: string,
): string | undefined {
  const prior = step.excludePriorStepIds?.[0];
  if (prior) {
    const seated = getStepRuntime(progress, prior).assignees[0];
    if (seated) return seated;
  }
  const fb = fallbackLogin?.trim();
  return fb || undefined;
}

export function isEligibleForStep(
  login: string,
  task: ProjectTask | undefined,
  progress: TaskProgressMarker,
  step: TaskStep,
  issueAssigneeFallback?: string,
): boolean {
  const user = login.trim();
  if (!user) return false;
  const lower = user.toLowerCase();
  if (
    excludedLoginsFromPriorSteps(
      progress,
      step.excludePriorStepIds,
      issueAssigneeFallback,
    ).has(lower)
  ) {
    return false;
  }
  if (step.excludeIssueAssignee) {
    const assignee = issueAssigneeFallback?.trim().toLowerCase();
    if (assignee && assignee === lower) return false;
  }
  // Team membership is enforced at the call site when team logins are known.
  void task;
  return true;
}

export function canClaimStep(
  login: string,
  steps: TaskStep[],
  progress: TaskProgressMarker,
  step: TaskStep,
  teamLogins?: Set<string> | string[],
  issueAssigneeFallback?: string,
): boolean {
  const mode = stepClaimMode(step);
  if (mode === "none") return false;
  if (!isStepUnlocked(steps, progress, step.id)) return false;
  if (isStepDone(progress, step.id)) return false;
  if (
    !isEligibleForStep(login, undefined, progress, step, issueAssigneeFallback)
  ) {
    return false;
  }

  if (teamLogins) {
    const set =
      teamLogins instanceof Set
        ? teamLogins
        : new Set(teamLogins.map((s) => s.toLowerCase()));
    if (set.size && !set.has(login.trim().toLowerCase())) return false;
  }

  const runtime = getStepRuntime(progress, step.id);
  const lower = login.trim().toLowerCase();
  if (runtime.assignees.some((a) => a.toLowerCase() === lower)) return false;

  if (mode === "exclusive") return runtime.assignees.length === 0;
  return runtime.assignees.length < stepMaxAssignees(step);
}

export function claimStep(
  progress: TaskProgressMarker,
  step: TaskStep,
  login: string,
): TaskProgressMarker {
  const user = login.trim();
  if (!user) return progress;
  const runtime = getStepRuntime(progress, step.id);
  if (runtime.assignees.some((a) => a.toLowerCase() === user.toLowerCase())) {
    return progress;
  }
  const mode = stepClaimMode(step);
  if (mode === "exclusive" && runtime.assignees.length > 0) return progress;
  if (mode === "pool" && runtime.assignees.length >= stepMaxAssignees(step)) {
    return progress;
  }
  return withStepRuntime(progress, step.id, {
    ...runtime,
    assignees: [...runtime.assignees, user],
  });
}

export function releaseStep(
  progress: TaskProgressMarker,
  stepId: string,
  login: string,
): TaskProgressMarker {
  const runtime = getStepRuntime(progress, stepId);
  const lower = login.trim().toLowerCase();
  return withStepRuntime(progress, stepId, {
    assignees: runtime.assignees.filter((a) => a.toLowerCase() !== lower),
    approvals: runtime.approvals.filter((a) => a.toLowerCase() !== lower),
  });
}

/**
 * A step that closes item by item (by consensus, or by a checklist) is completed by its tool, when every item is
 * settled (see `reviewRound.ts` and `checklist.ts`): completing it from the list would close it with items open.
 */
export function closesInItsTool(step: TaskStep): boolean {
  return (step.closing === "consensus" || step.closing === "checklist" || step.closing === "automatic") && Boolean(step.solverAppId);
}

/**
 * Whether the tool that closed the last step of a subtarea may deliver it there and then: every step is done and
 * the task works on the shared draft, so there is nothing to land. A task with a draft of its own lands verses
 * when it is delivered, which is done from the list, where it is asked first.
 */
export function deliverableFromTool(params: { teams: ProjectTask[]; taskId: string; progress: TaskProgressMarker; closed: boolean }): boolean {
  if (params.closed) return false;
  if (taskHasOwnDraft(params.teams, params.taskId)) return false;
  const task = params.teams.find((team) => team.id === params.taskId);
  if (!task?.steps?.length) return false;
  return task.steps.every((step) => isStepDone(params.progress, step.id));
}

/**
 * In a round that closes by consensus: this person has answered everything, and it is the others' turn. Their
 * card read «0 %» and offered «Revisar» again, as if they had not begun.
 */
export function answeredRound(login: string, progress: TaskProgressMarker, step: TaskStep): boolean {
  const user = login.trim().toLowerCase();
  if (!user || step.closing !== "consensus" || isStepDone(progress, step.id)) return false;
  return getStepRuntime(progress, step.id).approvals.some((a) => a.toLowerCase() === user);
}

export function canApproveStep(
  login: string,
  progress: TaskProgressMarker,
  step: TaskStep,
  fallbackAuthor?: string,
): boolean {
  if (stepClaimMode(step) === "none") return false;
  if (closesInItsTool(step)) return false;
  if (isStepDone(progress, step.id)) return false;
  const user = login.trim().toLowerCase();
  if (!user) return false;
  const runtime = getStepRuntime(progress, step.id);
  if (runtime.approvals.some((a) => a.toLowerCase() === user)) return false;
  if (runtime.assignees.some((a) => a.toLowerCase() === user)) return true;
  if (step.includeAuthorInApproval) {
    const author = resolveStepAuthor(progress, step, fallbackAuthor)?.toLowerCase();
    if (author && author === user) return true;
  }
  return false;
}

export function isStepComplete(
  progress: TaskProgressMarker,
  step: TaskStep,
  fallbackAuthor?: string,
): boolean {
  if (isStepDone(progress, step.id)) return true;
  const mode = stepClaimMode(step);
  if (mode === "none") return false;
  if (closesInItsTool(step)) return false;

  const runtime = getStepRuntime(progress, step.id);
  const approvals = new Set(runtime.approvals.map((a) => a.toLowerCase()));

  if (mode === "exclusive") {
    if (!runtime.assignees.length) return false;
    const claimer = runtime.assignees[0]?.toLowerCase();
    if (!claimer || !approvals.has(claimer)) return false;
    if (step.includeAuthorInApproval) {
      const author = resolveStepAuthor(
        progress,
        step,
        fallbackAuthor,
      )?.toLowerCase();
      if (!author || !approvals.has(author)) return false;
    }
    return true;
  }

  // pool
  const min = stepMinAssignees(step);
  const seatedApprovals = runtime.assignees.filter((a) =>
    approvals.has(a.toLowerCase()),
  );
  // Consensus without items (an agreement of the team): everybody who sat down must agree, not just the minimum.
  if (step.closing === "consensus") return runtime.assignees.length >= min && seatedApprovals.length === runtime.assignees.length;
  return seatedApprovals.length >= min;
}

export function approveStep(
  progress: TaskProgressMarker,
  step: TaskStep,
  login: string,
  fallbackAuthor?: string,
): TaskProgressMarker {
  const user = login.trim();
  if (!user || !canApproveStep(user, progress, step, fallbackAuthor)) {
    return progress;
  }
  const runtime = getStepRuntime(progress, step.id);
  let next = withStepRuntime(progress, step.id, {
    ...runtime,
    approvals: [...runtime.approvals, user],
  });
  if (isStepComplete(next, step, fallbackAuthor)) {
    next = markStepDone(next, step.id);
  }
  return next;
}

/** How the agreement on a step stands: who sat down for it, who of them agreed, and whether that is everybody. */
export type AgreementStanding = { seated: string[]; agreed: string[]; missing: string[]; needed: number; complete: boolean };

export function agreementStanding(progress: TaskProgressMarker, step: TaskStep): AgreementStanding {
  const runtime = getStepRuntime(progress, step.id);
  const said = new Set(runtime.approvals.map((a) => a.toLowerCase()));
  const agreed = runtime.assignees.filter((a) => said.has(a.toLowerCase()));
  const needed = stepMinAssignees(step);
  return { seated: runtime.assignees, agreed, missing: runtime.assignees.filter((a) => !said.has(a.toLowerCase())), needed, complete: runtime.assignees.length >= needed && agreed.length === runtime.assignees.length };
}

/**
 * The team's agreement on a step, given in the tool of the step. The list does not offer to approve a step that
 * has a tool (`canApproveStep`), and `approveStep` goes by the list: with a tool on the step, an agreement given
 * there was not kept, and nothing could close the step. Whoever may sit down for the step and has not is seated,
 * their agreement is kept, and the step closes when everybody seated has agreed and they are enough.
 * `settled` is what only the tool knows: that nothing in it is left to resolve. `mine: false` gives no agreement:
 * it only closes a step that was waiting for the last thing to be resolved.
 */
export function agreeInTool(params: { progress: TaskProgressMarker; steps: TaskStep[]; step: TaskStep; login: string; settled: boolean; mine?: boolean; author?: string }): TaskProgressMarker {
  const { steps, step } = params;
  let next = params.progress;
  if (step.closing !== "consensus" || isStepDone(next, step.id) || !isStepUnlocked(steps, next, step.id)) return next;
  const user = params.login.trim();
  if (user && params.mine !== false) {
    if (canClaimStep(user, steps, next, step, undefined, params.author)) next = claimStep(next, step, user);
    const runtime = getStepRuntime(next, step.id);
    const has = (list: string[]) => list.some((a) => a.toLowerCase() === user.toLowerCase());
    if (has(runtime.assignees) && !has(runtime.approvals)) next = withStepRuntime(next, step.id, { ...runtime, approvals: [...runtime.approvals, user] });
  }
  if (params.settled && agreementStanding(next, step).complete) next = markStepDone(next, step.id);
  return next;
}

/** The step whose work a review looks at (the draft): the first step it excludes, else the one right before it. */
export function reviewedStepId(steps: TaskStep[], step: TaskStep): string | undefined {
  const named = step.excludePriorStepIds?.[0];
  if (named && steps.some((row) => row.id === named)) return named;
  const at = steps.findIndex((row) => row.id === step.id);
  return at > 0 ? steps[at - 1]!.id : undefined;
}

/** Whoever sits on a review that is open may send the work back, once it was handed in. */
export function canAskForChanges(login: string, steps: TaskStep[], progress: TaskProgressMarker, step: TaskStep): boolean {
  const user = login.trim().toLowerCase();
  if (!user || stepClaimMode(step) === "none" || closesInItsTool(step) || isStepDone(progress, step.id)) return false;
  const reviewed = reviewedStepId(steps, step);
  if (!reviewed || !isStepDone(progress, reviewed)) return false;
  return getStepRuntime(progress, step.id).assignees.some((seat) => seat.toLowerCase() === user);
}

/**
 * A reviewer asks for changes: the work goes back to its author (their step is open again, so it is theirs to do
 * in their list), and the approvals given so far no longer count, since what they approved is going to change.
 * The reviewers keep their seats: when the author hands the work in again, the review is theirs to finish.
 */
export function askForChanges(progress: TaskProgressMarker, steps: TaskStep[], step: TaskStep, login: string): TaskProgressMarker {
  if (!canAskForChanges(login, steps, progress, step)) return progress;
  const reviewed = reviewedStepId(steps, step)!;
  const reopened = { ...progress, doneStepIds: progress.doneStepIds.filter((id) => id !== reviewed) };
  return withStepRuntime(reopened, step.id, { ...getStepRuntime(progress, step.id), approvals: [], returnedBy: login.trim() });
}

/**
 * The author may take the work back while its review is open. What a reviewer says about a paragraph is usually
 * answered by correcting the paragraph, and the only way to it was a button the reviewer has: the author read the
 * comment and could do nothing about it but answer. Nobody but the author, and not once the review is finished.
 */
export function canTakeBack(login: string, steps: TaskStep[], progress: TaskProgressMarker, step: TaskStep, author: string | undefined): boolean {
  const user = login.trim().toLowerCase();
  if (!user || (author ?? "").trim().toLowerCase() !== user) return false;
  if (stepClaimMode(step) === "none" || closesInItsTool(step) || isStepDone(progress, step.id)) return false;
  const reviewed = reviewedStepId(steps, step);
  return Boolean(reviewed && isStepDone(progress, reviewed));
}

/**
 * The author takes the work back to correct it: as when a reviewer asks for changes, their step is open again, the
 * approvals given no longer count (what was approved is going to change) and the reviewers keep their seats.
 */
export function takeBack(progress: TaskProgressMarker, steps: TaskStep[], step: TaskStep, login: string, author: string | undefined): TaskProgressMarker {
  if (!canTakeBack(login, steps, progress, step, author)) return progress;
  const reviewed = reviewedStepId(steps, step)!;
  const reopened = { ...progress, doneStepIds: progress.doneStepIds.filter((id) => id !== reviewed) };
  return withStepRuntime(reopened, step.id, { ...getStepRuntime(progress, step.id), approvals: [], returnedBy: login.trim() });
}

/** The work is back with its author because the author took it, not because a reviewer asked: nobody «asked for changes». */
export function takenBackByAuthor(steps: TaskStep[], progress: TaskProgressMarker, step: TaskStep, author: string | undefined): boolean {
  const by = getStepRuntime(progress, step.id).returnedBy?.toLowerCase();
  return Boolean(by && by === (author ?? "").trim().toLowerCase() && changesPending(steps, progress, step));
}

/** A review whose work was sent back and not handed in again yet: somebody sits on it, and it is locked. */
export function changesPending(steps: TaskStep[], progress: TaskProgressMarker, step: TaskStep): boolean {
  if (isStepDone(progress, step.id) || !getStepRuntime(progress, step.id).assignees.length) return false;
  const reviewed = reviewedStepId(steps, step);
  if (!reviewed || isStepDone(progress, reviewed)) return false;
  // Work nobody ever took was not sent back: somebody only sat on the review early (or the process changed under
  // the subtarea). Saying «changes were requested» there named nobody and sent people looking for a request.
  const work = steps.find((row) => row.id === reviewed);
  return !work || stepClaimMode(work) === "none" || getStepRuntime(progress, reviewed).assignees.length > 0;
}

/**
 * A review whose work was sent back and has been handed in again: it is for whoever reviews to look at it once
 * more. The card of a reviewer read the same before and after («Revisar»), and nothing said the draft had come back.
 */
export function handedInAgain(steps: TaskStep[], progress: TaskProgressMarker, step: TaskStep): boolean {
  if (isStepDone(progress, step.id) || !getStepRuntime(progress, step.id).returnedBy) return false;
  const reviewed = reviewedStepId(steps, step);
  return Boolean(reviewed && isStepDone(progress, reviewed));
}

/** Whether this step should appear as a claimable card for the user. */
export function isStepClaimableForUser(
  login: string,
  steps: TaskStep[],
  progress: TaskProgressMarker,
  step: TaskStep,
  teamLogins?: Set<string> | string[],
  issueAssigneeFallback?: string,
): boolean {
  return canClaimStep(
    login,
    steps,
    progress,
    step,
    teamLogins,
    issueAssigneeFallback,
  );
}

/** Seated users (or author) who can still act on an in-progress claim step. */
export function isStepActor(
  login: string,
  progress: TaskProgressMarker,
  step: TaskStep,
  fallbackAuthor?: string,
): boolean {
  const user = login.trim().toLowerCase();
  if (!user || stepClaimMode(step) === "none") return false;
  const runtime = getStepRuntime(progress, step.id);
  if (runtime.assignees.some((a) => a.toLowerCase() === user)) return true;
  if (step.includeAuthorInApproval) {
    const author = resolveStepAuthor(
      progress,
      step,
      fallbackAuthor,
    )?.toLowerCase();
    return Boolean(author && author === user);
  }
  return false;
}
