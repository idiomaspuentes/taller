import type { ProjectTask, TaskStep } from "./types";
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

export function canApproveStep(
  login: string,
  progress: TaskProgressMarker,
  step: TaskStep,
  fallbackAuthor?: string,
): boolean {
  if (stepClaimMode(step) === "none") return false;
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
