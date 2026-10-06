import { useEffect, useRef } from "react";
import type { SolverLaunchContext } from "../domain/solverLaunch";
import { parseTaskProgressMarker, withStepWork } from "../domain/taskProgress";
import type { GtSession } from "./auth";
import { setIssueTaskProgress } from "./issues";
import { getPmIssue } from "./portionPr";

/**
 * How far an open step is, told to its subtarea by the tool it is done in. A step was either done or not: a draft
 * of forty verses looked the same with one written or thirty-nine, to its author's card and to whoever coordinates
 * (who also saw it as «sin movimiento» while its author was writing it every day).
 */

/** A count is told once it has been still this long: verse after verse is said once, not at every verse. */
const QUIET_MS = 20_000;

/** What each step was last told to have, so a tool opened again does not ask Door43 to hear the same. */
const told = new Map<string, string>();

/**
 * Notes the count on the subtarea, read again first so a seat or an approval saved meanwhile is not lost. Nothing is
 * written when the subtarea already says it, or the step is closed. Returns whether it wrote.
 */
export async function reportStepWork(params: { session: GtSession; pmOrg: string; issueNumber: number; stepId: string; done: number; total: number }): Promise<boolean> {
  const { session, pmOrg, issueNumber, stepId, done, total } = params;
  const issue = await getPmIssue(session, pmOrg, issueNumber);
  const progress = parseTaskProgressMarker(issue.body);
  const next = withStepWork(progress, stepId, { done, total });
  if (next === progress) return false;
  await setIssueTaskProgress(session, pmOrg, issue, next);
  return true;
}

type Launch = Pick<SolverLaunchContext, "pmOrg" | "issueNumber" | "stepId" | "lab">;

/**
 * For a tool: `done` of `total` is how far its step is. Told to the subtarea when it has been still for a while,
 * and on leaving the tool. A launch from the laboratory has no subtarea and tells nothing; nor does `on: false`:
 * the step is closed, or is being closed (a count told while the step is being completed could be written over
 * its completion, and open it again).
 */
export function useStepWork(session: GtSession | null | undefined, ctx: Launch | null | undefined, done: number, total: number, options: { stepId?: string; on?: boolean } = {}): void {
  const stepId = options.stepId ?? ctx?.stepId ?? "";
  const live = Boolean(session?.token && ctx?.pmOrg && ctx.issueNumber && stepId && !ctx.lab && options.on !== false && total > 0);
  const key = live ? `${ctx!.pmOrg}#${ctx!.issueNumber}:${stepId}` : "";
  const count = `${Math.max(0, Math.min(done, total))}/${total}`;

  // What there is to tell right now, for the timer and for leaving: whichever comes first tells the latest.
  const latest = useRef<() => void>(() => undefined);
  latest.current = () => {
    if (!key || !session || told.get(key) === count) return;
    told.set(key, count);
    // Not said after all: the next change, or the next visit, says it.
    void reportStepWork({ session, pmOrg: ctx!.pmOrg, issueNumber: ctx!.issueNumber, stepId, done: Math.max(0, Math.min(done, total)), total }).catch(() => told.delete(key));
  };

  useEffect(() => {
    if (!key || told.get(key) === count) return;
    const timer = setTimeout(() => latest.current(), QUIET_MS);
    return () => clearTimeout(timer);
  }, [key, count]);

  useEffect(() => () => latest.current(), []);
}
