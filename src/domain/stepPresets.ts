import type { TaskStep } from "./types";

/** Apply “Revisión en parejas” claim policy (exclusive; prior author must approve). */
export function applyPairReviewPreset(
  step: TaskStep,
  draftStepId: string | undefined,
): TaskStep {
  return {
    ...step,
    claimMode: "exclusive",
    includeAuthorInApproval: true,
    excludeIssueAssignee: true,
    minAssignees: undefined,
    maxAssignees: undefined,
    excludePriorStepIds: draftStepId ? [draftStepId] : step.excludePriorStepIds,
  };
}

/** Apply “Revisión grupal” claim policy (pool; min/max 2; exclude draft+pair). */
export function applyGroupReviewPreset(
  step: TaskStep,
  excludeStepIds: string[],
): TaskStep {
  const ids = [...new Set(excludeStepIds.map((s) => s.trim()).filter(Boolean))];
  return {
    ...step,
    claimMode: "pool",
    minAssignees: 2,
    maxAssignees: 2,
    includeAuthorInApproval: undefined,
    excludeIssueAssignee: true,
    excludePriorStepIds: ids.length ? ids : undefined,
  };
}

export function clearStepClaimPolicy(step: TaskStep): TaskStep {
  return {
    ...step,
    claimMode: undefined,
    minAssignees: undefined,
    maxAssignees: undefined,
    excludePriorStepIds: undefined,
    excludeIssueAssignee: undefined,
    includeAuthorInApproval: undefined,
  };
}
