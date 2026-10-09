import type { TaskStep, WorkflowTemplate } from "./types";

/**
 * A walkthrough of a process: its phases, tasks, steps and tools as they are, laid out so that one person can try
 * every step of it on a test server, on a chapter of a book that is already done.
 *
 * A process chains its tasks (a task waits for others, across its phases), and to reach its last step everything
 * before it has to be finished. On a book that is done every step already has what it works on, so the waits are
 * the one thing in the way: in the walkthrough they hold nothing (`WaitRule.open`). They are still said: what a
 * task waits for is what its tools read, and with the rules left out no tool knew whose draft to open. And a step
 * several people take is closed by one of them.
 *
 * It is made from the process each time, never written by hand: a copy kept beside the process stopped following
 * it (steps that the process had since renamed or joined).
 *
 * What it does not change: a step another person must do (a review of somebody's work by somebody else) still asks
 * for another person. Door43 does not let anybody approve their own request.
 */

const MARK = "--walkthrough";

export const walkthroughId = (workflowId: string): string => `${workflowId}${MARK}`;

export const isWalkthroughId = (workflowId: string | undefined): boolean => Boolean(workflowId?.endsWith(MARK));

/** The process a project follows, whether it was started from the process itself or from a walkthrough of it. */
export const processOf = (workflowId: string | undefined): string => (workflowId && isWalkthroughId(workflowId) ? workflowId.slice(0, -MARK.length) : (workflowId ?? ""));

/**
 * A step several people take, with one seat: whoever they are and whatever they did before in the subtarea, and
 * with nobody else's agreement asked for. `minIndependent` is said as 0, not left out: the tools that close a step
 * by agreement ask for independent people of their own when a step does not say.
 */
function aloneStep(step: TaskStep): TaskStep {
  if (step.claimMode !== "pool") return step;
  const { minAgree: _agree, excludePriorStepIds: _prior, excludeIssueAssignee: _assignee, ...rest } = step;
  return { ...rest, minAssignees: 1, maxAssignees: Math.max(1, step.maxAssignees ?? 1), minIndependent: 0 };
}

export function walkthroughOf(workflow: WorkflowTemplate, words: { name: string; description?: string }): WorkflowTemplate {
  const { names: _names, descriptions: _descriptions, ...rest } = workflow;
  return {
    ...rest,
    id: walkthroughId(workflow.id),
    name: words.name,
    description: words.description,
    tasks: workflow.tasks.map((task) => ({
      ...task,
      // A wait on another project's work is not ours to open: it is left out.
      ...(task.waitsFor ? { waitsFor: task.waitsFor.filter((rule) => !rule.source).map((rule) => ({ ...rule, open: true })) } : {}),
      ...(task.steps ? { steps: task.steps.map(aloneStep) } : {}),
    })),
  };
}
