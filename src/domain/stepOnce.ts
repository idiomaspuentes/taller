import type { DcsIssue } from "@ip-lms/dcs-client";
import { chapterFromIssue } from "./solverLaunch";
import { getStepRuntime, isStepDone, markStepDone, parseTaskProgressMarker, upsertTaskProgressInBody, withStepRuntime } from "./taskProgress";
import type { ProjectTask, TaskStep } from "./types";

/**
 * A step with `scope: "chapter-once"` is done once per person and chapter (reading the chapter before working on it):
 * whoever did it in one subtarea of a chapter does not repeat it in the others of that chapter.
 */

type TaskOf = (issue: DcsIssue) => Pick<ProjectTask, "steps"> | undefined;

/** Did `login` already do this step in another subtarea of the same chapter? */
export function didOnceElsewhere(login: string, step: TaskStep, issue: DcsIssue, issues: DcsIssue[], taskOf: TaskOf): boolean {
  if (step.scope !== "chapter-once") return false;
  const me = login.trim().toLowerCase();
  const chapter = chapterFromIssue(issue);
  if (!me || !chapter) return false;
  return issues.some((other) => {
    if (other.number === issue.number || chapterFromIssue(other) !== chapter) return false;
    const same = taskOf(other)?.steps?.find((s) => s.id === step.id && s.scope === "chapter-once");
    if (!same) return false;
    const progress = parseTaskProgressMarker(other.body ?? "");
    return isStepDone(progress, same.id) && getStepRuntime(progress, same.id).assignees.some((a) => a.toLowerCase() === me);
  });
}

/**
 * The subtarea as `login` should see it: the once-per-chapter steps they already did elsewhere count as done here
 * (and they are seated on them, so later steps can exclude whoever did them). `changed` says whether anything was
 * added, so the caller can save it when the person starts working.
 */
export function withOnceSteps(login: string, issue: DcsIssue, steps: TaskStep[], issues: DcsIssue[], taskOf: TaskOf): { issue: DcsIssue; changed: boolean } {
  let progress = parseTaskProgressMarker(issue.body ?? "");
  let changed = false;
  for (const step of steps) {
    if (isStepDone(progress, step.id)) continue;
    // Only leading steps: one that waits for an earlier step is not skipped ahead of it.
    if (!didOnceElsewhere(login, step, issue, issues, taskOf)) break;
    const runtime = getStepRuntime(progress, step.id);
    progress = markStepDone(withStepRuntime(progress, step.id, { ...runtime, assignees: runtime.assignees.length ? runtime.assignees : [login] }), step.id);
    changed = true;
  }
  return changed ? { issue: { ...issue, body: upsertTaskProgressInBody(issue.body, progress) }, changed } : { issue, changed };
}
