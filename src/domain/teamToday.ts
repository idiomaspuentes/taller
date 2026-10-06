import type { DcsIssue } from "@ip-lms/dcs-client";
import { isIssueUnassigned } from "../dcs/issues";
import { meetsTeamLevel, type LevelBook, type PersonLevel } from "./levels";
import { DECISION_DAYS } from "./alignmentDecision";
import { isDecisionIssue } from "./decisionAccess";
import { issueTaskId } from "./myTasks";
import { parseTaskProgressMarker } from "./taskProgress";
import type { AssignmentsDoc, ProjectTask } from "./types";
import { waitBlocks, waitReason } from "./waits";

/**
 * «Equipo hoy»: where the work of a project stands, for whoever coordinates.
 * Pure: takes every subtarea of the project (open and closed) and the plan.
 */

export type TodayGroup = "decisions" | "stuck" | "running" | "free" | "waiting" | "done";

export type TodayRow = {
  issue: DcsIssue;
  group: TodayGroup;
  taskName: string;
  phaseName: string;
  assignee?: string;
  /** Whole days since the last movement (or since it was created / closed). */
  days: number;
  /** Short line saying why it is in this group. */
  reason: string;
  /** People of the task's team who could take it over (empty when the task has no team members). */
  candidates: string[];
};

export type TodayThresholds = {
  /** A free subtarea nobody took for this many days is stuck. */
  freeDays: number;
  /** A taken subtarea with no movement for this many days is stuck. */
  quietDays: number;
  /** Closed within this many days counts as «terminada». */
  doneDays: number;
};

export const DEFAULT_THRESHOLDS: TodayThresholds = { freeDays: 3, quietDays: 5, doneDays: 7 };

const DAY_MS = 86_400_000;

function daysSince(iso: string | undefined, now: Date): number {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Math.floor((now.getTime() - at) / DAY_MS));
}

export function daysText(days: number): string {
  if (days <= 0) return "hoy";
  return days === 1 ? "hace 1 día" : `hace ${days} días`;
}

function assigneeOf(issue: DcsIssue): string | undefined {
  return issue.assignee?.login || issue.assignees?.[0]?.login || undefined;
}

/**
 * Who the coordinator can hand a subtarea to: the people of the task's team,
 * at the level the task asks for (people without a recorded level are not filtered),
 * leaving out whoever has it now.
 */
export function assignCandidates(
  task: Pick<ProjectTask, "memberIds" | "minLevel" | "orgTeamName"> | undefined,
  /** Levels of the people, or the organization's book: the level that counts is the one in the task's team. */
  levels: Record<string, PersonLevel> | LevelBook | undefined,
  current?: string,
): string[] {
  const now = current?.trim().toLowerCase();
  return (task?.memberIds ?? [])
    .filter((login) => login.trim().toLowerCase() !== now)
    .filter((login) => meetsTeamLevel(levels, task?.orgTeamName, login, task?.minLevel))
    .sort((a, b) => a.localeCompare(b, "es"));
}

export function classifyToday(params: {
  issues: DcsIssue[];
  board: Pick<AssignmentsDoc, "teams" | "phases">;
  now: Date;
  /** Levels of the people (see `levels.ts`), to offer only those who can take the task. */
  levels?: Record<string, PersonLevel> | LevelBook;
  thresholds?: Partial<TodayThresholds>;
}): Record<TodayGroup, TodayRow[]> {
  const { issues, board, now } = params;
  const limits = { ...DEFAULT_THRESHOLDS, ...params.thresholds };
  const open = issues.filter((issue) => issue.state !== "closed");
  const out: Record<TodayGroup, TodayRow[]> = { decisions: [], stuck: [], running: [], free: [], waiting: [], done: [] };

  for (const issue of issues) {
    const taskId = issueTaskId(issue);
    const task = taskId ? board.teams.find((t) => t.id === taskId) : undefined;
    const base = {
      issue,
      taskName: task?.name ?? "",
      phaseName: task ? board.phases.find((p) => p.id === task.phaseId)?.name ?? "" : "",
      assignee: assigneeOf(issue),
      candidates: assignCandidates(task, params.levels, assigneeOf(issue)),
    };
    if (issue.state === "closed") {
      const days = daysSince(issue.closed_at, now);
      // Closed with steps left undone: the plan withdrew it, nobody finished it. Counted as finished, a project whose
      // portions were cut anew said «90 terminadas esta semana» with one subtarea delivered.
      const marker = parseTaskProgressMarker(issue.body ?? undefined);
      const withdrawn = (task?.steps ?? []).some((step) => !marker.doneStepIds.includes(step.id));
      if (issue.closed_at && days <= limits.doneDays && !withdrawn) {
        out.done.push({ ...base, group: "done", days, reason: `Cerrada ${daysText(days)}` });
      }
      continue;
    }
    // A decision of the team is not work to take: the team votes on it before a deadline.
    if (isDecisionIssue(issue)) {
      const days = daysSince(issue.created_at, now);
      const left = DECISION_DAYS - days;
      out.decisions.push({
        ...base,
        group: "decisions",
        days,
        reason: left > 0 ? `Se decide antes de ${left === 1 ? "mañana" : `${left} días`}` : left === 0 ? "El plazo vence hoy" : `El plazo venció ${daysText(-left)}: decide quien coordina`,
      });
      continue;
    }
    const blocks = waitBlocks(issue, board, open);
    if (blocks.length) {
      out.waiting.push({
        ...base,
        group: "waiting",
        days: daysSince(issue.created_at, now),
        reason: waitReason(blocks, board),
      });
      continue;
    }
    if (isIssueUnassigned(issue)) {
      const days = daysSince(issue.created_at, now);
      if (days >= limits.freeDays) {
        out.stuck.push({ ...base, group: "stuck", days, reason: `Nadie la ha tomado en ${days} días` });
      } else {
        out.free.push({ ...base, group: "free", days, reason: "Libre para el equipo" });
      }
      continue;
    }
    const days = daysSince(issue.updated_at, now);
    if (days >= limits.quietDays) {
      out.stuck.push({ ...base, group: "stuck", days, reason: `Sin movimiento ${daysText(days)}` });
    } else {
      out.running.push({ ...base, group: "running", days, reason: `Último movimiento ${daysText(days)}` });
    }
  }

  out.decisions.sort((a, b) => b.days - a.days);
  out.stuck.sort((a, b) => b.days - a.days);
  out.waiting.sort((a, b) => b.days - a.days);
  out.running.sort((a, b) => a.days - b.days);
  out.done.sort((a, b) => a.days - b.days);
  return out;
}
