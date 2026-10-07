import type { SourceStamp } from "./sourceVersions";

export const TASK_PROGRESS_SCHEMA_V1 = "gateway-task-progress-1" as const;
export const TASK_PROGRESS_SCHEMA = "gateway-task-progress-2" as const;

export type StepRuntime = {
  assignees: string[];
  approvals: string[];
  /**
   * A review whose work went back to its author: who sent it there (a reviewer who asked for changes, or the author,
   * who took it back to correct it). Read only while the work is back; it is not cleared when handed in again.
   */
  returnedBy?: string;
  /**
   * Closed: by whom and when. A step was only ever «done» or not: nothing said who had closed it or on what day,
   * so neither a person's work nor the pace of a book could be read from the plan. Forgotten when the step goes
   * back to its author.
   */
  done?: StepDone;
  /** The sources the step was done against, as they were when it was closed (see `sourceVersions`). */
  sources?: SourceStamp[];
  /**
   * How far the step is, as its tool counts it: verses written, notes translated, items agreed. Said by the tool
   * while the step is open, so the card of the subtarea and the project can show how far the work is without
   * opening it (see `workProgress`).
   */
  work?: StepWork;
};

export type StepDone = { by: string; at: string };
export type StepWork = { done: number; total: number };

export type TaskProgressMarker = {
  schema: typeof TASK_PROGRESS_SCHEMA | typeof TASK_PROGRESS_SCHEMA_V1;
  doneStepIds: string[];
  /** Per-step seating and approvals (v2). */
  steps?: Record<string, StepRuntime>;
};

const MARKER_RE = /<!--\s*gateway-task-progress\s+(\{[\s\S]*?\})\s*-->/;

function normalizeLoginList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

function normalizeStepRuntimes(raw: unknown): Record<string, StepRuntime> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, StepRuntime> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = String(key).trim();
    if (!id || !value || typeof value !== "object") continue;
    const row = value as { assignees?: unknown; approvals?: unknown; returnedBy?: unknown; done?: unknown; sources?: unknown; work?: unknown };
    const returnedBy = typeof row.returnedBy === "string" ? row.returnedBy.trim() : "";
    out[id] = {
      assignees: normalizeLoginList(row.assignees),
      approvals: normalizeLoginList(row.approvals),
      ...(returnedBy ? { returnedBy } : {}),
      ...kept({ done: row.done, sources: row.sources, work: row.work }),
    };
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeDone(raw: unknown): StepDone | undefined {
  const row = raw as Partial<StepDone> | null;
  if (!row || typeof row !== "object" || typeof row.at !== "string" || !row.at.trim()) return undefined;
  return { by: typeof row.by === "string" ? row.by.trim() : "", at: row.at.trim() };
}

function normalizeSources(raw: unknown): SourceStamp[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: SourceStamp[] = [];
  for (const item of raw as Partial<SourceStamp>[]) {
    if (!item || typeof item !== "object") continue;
    const [kind, repo, path, sha] = [item.kind, item.repo, item.path, item.sha].map((x) => (typeof x === "string" ? x.trim() : ""));
    if (!kind || !repo || !path || !sha) continue;
    const release = typeof item.release === "string" ? item.release.trim() : "";
    out.push({ kind: kind as SourceStamp["kind"], repo: repo!, path: path!, sha: sha!, ...(release ? { release, released: item.released !== false } : {}) });
  }
  return out.length ? out : undefined;
}

function normalizeWork(raw: unknown): StepWork | undefined {
  const row = raw as Partial<StepWork> | null;
  if (!row || typeof row !== "object") return undefined;
  const total = Math.floor(Number(row.total));
  const done = Math.floor(Number(row.done));
  if (!(total > 0) || !Number.isFinite(done)) return undefined;
  return { done: Math.min(total, Math.max(0, done)), total };
}

/** What is kept of a step besides its seats, as it is read or about to be written: only what is well formed. */
function kept(row: { done?: unknown; sources?: unknown; work?: unknown }): Pick<StepRuntime, "done" | "sources" | "work"> {
  const done = normalizeDone(row.done);
  const sources = normalizeSources(row.sources);
  const work = normalizeWork(row.work);
  return { ...(done ? { done } : {}), ...(sources ? { sources } : {}), ...(work ? { work } : {}) };
}

export function emptyTaskProgress(): TaskProgressMarker {
  return { schema: TASK_PROGRESS_SCHEMA, doneStepIds: [], steps: undefined };
}

export function parseTaskProgressMarker(body: string | undefined): TaskProgressMarker {
  if (!body) return emptyTaskProgress();
  const match = body.match(MARKER_RE);
  if (!match) return emptyTaskProgress();
  try {
    const parsed = JSON.parse(match[1]) as Partial<TaskProgressMarker> & {
      schema?: string;
    };
    const ids = normalizeLoginList(parsed.doneStepIds);
    const steps = normalizeStepRuntimes(parsed.steps);
    return {
      schema: TASK_PROGRESS_SCHEMA,
      doneStepIds: ids,
      steps,
    };
  } catch {
    return emptyTaskProgress();
  }
}

export function encodeTaskProgressMarker(marker: TaskProgressMarker): string {
  const steps = normalizeStepRuntimes(marker.steps);
  const body: TaskProgressMarker = {
    schema: TASK_PROGRESS_SCHEMA,
    doneStepIds: [...new Set(marker.doneStepIds.filter(Boolean))],
    ...(steps ? { steps } : {}),
  };
  return `<!-- gateway-task-progress ${JSON.stringify(body)} -->`;
}

/** Insert or replace the progress marker in an issue body. */
export function upsertTaskProgressInBody(
  body: string | undefined,
  markerOrIds: TaskProgressMarker | string[],
): string {
  const marker = Array.isArray(markerOrIds)
    ? {
        schema: TASK_PROGRESS_SCHEMA,
        doneStepIds: markerOrIds,
        steps: undefined as TaskProgressMarker["steps"],
      }
    : markerOrIds;
  const encoded = encodeTaskProgressMarker(marker);
  const current = body ?? "";
  if (MARKER_RE.test(current)) {
    return current.replace(MARKER_RE, encoded);
  }
  const trimmed = current.replace(/\s*$/, "");
  return trimmed ? `${trimmed}\n\n${encoded}\n` : `${encoded}\n`;
}

export function getStepRuntime(
  marker: TaskProgressMarker,
  stepId: string,
): StepRuntime {
  return marker.steps?.[stepId] ?? { assignees: [], approvals: [] };
}

export function withStepRuntime(
  marker: TaskProgressMarker,
  stepId: string,
  runtime: StepRuntime,
): TaskProgressMarker {
  return {
    schema: TASK_PROGRESS_SCHEMA,
    doneStepIds: marker.doneStepIds,
    steps: {
      ...(marker.steps ?? {}),
      [stepId]: {
        assignees: normalizeLoginList(runtime.assignees),
        approvals: normalizeLoginList(runtime.approvals),
        ...(runtime.returnedBy?.trim() ? { returnedBy: runtime.returnedBy.trim() } : {}),
        // Who sits on a step changes without touching when it was closed, against what, or how far it is: those
        // are carried over.
        ...kept({ done: runtime.done ?? marker.steps?.[stepId]?.done, sources: runtime.sources ?? marker.steps?.[stepId]?.sources, work: runtime.work ?? marker.steps?.[stepId]?.work }),
      },
    },
  };
}

/**
 * A marker about to be saved over another, with what the saving itself says: a step that became done is closed by
 * `by` at `at`; a step that is no longer done (its work went back to its author) forgets who closed it and against
 * which sources. `closed`: the steps that became done, for whoever notes their sources next.
 */
export function stampDoneSteps(before: TaskProgressMarker, after: TaskProgressMarker, by: string, at: string): { marker: TaskProgressMarker; closed: string[] } {
  const was = new Set(before.doneStepIds);
  const is = new Set(after.doneStepIds);
  const closed = after.doneStepIds.filter((id) => !was.has(id));
  const reopened = before.doneStepIds.filter((id) => !is.has(id));
  if (!closed.length && !reopened.length) return { marker: after, closed };
  const steps: Record<string, StepRuntime> = { ...(after.steps ?? {}) };
  for (const id of closed) steps[id] = { ...(steps[id] ?? { assignees: [], approvals: [] }), done: { by: by.trim(), at }, sources: undefined };
  for (const id of reopened) if (steps[id]) steps[id] = { ...steps[id]!, done: undefined, sources: undefined };
  return { marker: { schema: TASK_PROGRESS_SCHEMA, doneStepIds: after.doneStepIds, steps }, closed };
}

/** The sources a closed step was done against, noted on it. */
export function withStepSources(marker: TaskProgressMarker, stepId: string, sources: SourceStamp[]): TaskProgressMarker {
  const runtime = marker.steps?.[stepId];
  if (!runtime || !sources.length) return marker;
  return { ...marker, steps: { ...marker.steps, [stepId]: { ...runtime, sources } } };
}

/**
 * How far an open step is, noted on it. The same marker comes back when there is nothing to say: the step is
 * closed, the count is not one, it is what the subtarea already has, or it is «nothing yet» of a step that never
 * said anything (so nothing is written for nothing: opening a tool to look does not move its subtarea).
 */
export function withStepWork(marker: TaskProgressMarker, stepId: string, work: StepWork): TaskProgressMarker {
  const next = normalizeWork(work);
  if (!stepId || !next || marker.doneStepIds.includes(stepId)) return marker;
  const runtime = marker.steps?.[stepId] ?? { assignees: [], approvals: [] };
  if (runtime.work ? runtime.work.done === next.done && runtime.work.total === next.total : next.done === 0) return marker;
  return { schema: TASK_PROGRESS_SCHEMA, doneStepIds: marker.doneStepIds, steps: { ...(marker.steps ?? {}), [stepId]: { ...runtime, work: next } } };
}

/**
 * A person marked as done with their part of a step, or no longer. In a round that everybody answers (a step that
 * closes by consensus) it says who has answered everything; the step stays open for the others.
 */
export function withStepApproval(marker: TaskProgressMarker, stepId: string, login: string, on: boolean): TaskProgressMarker {
  const user = login.trim().toLowerCase();
  if (!stepId || !user || marker.doneStepIds.includes(stepId)) return marker;
  const runtime = getStepRuntime(marker, stepId);
  if (runtime.approvals.some((a) => a.toLowerCase() === user) === on) return marker;
  return withStepRuntime(marker, stepId, { ...runtime, approvals: on ? [...runtime.approvals, login.trim()] : runtime.approvals.filter((a) => a.toLowerCase() !== user) });
}

export function isStepDone(marker: TaskProgressMarker, stepId: string): boolean {
  return marker.doneStepIds.includes(stepId);
}

export function toggleStepDone(
  marker: TaskProgressMarker,
  stepId: string,
): TaskProgressMarker {
  const set = new Set(marker.doneStepIds);
  if (set.has(stepId)) set.delete(stepId);
  else set.add(stepId);
  return {
    schema: TASK_PROGRESS_SCHEMA,
    doneStepIds: [...set],
    steps: marker.steps,
  };
}

export function markStepDone(
  marker: TaskProgressMarker,
  stepId: string,
): TaskProgressMarker {
  if (marker.doneStepIds.includes(stepId)) return marker;
  return {
    schema: TASK_PROGRESS_SCHEMA,
    doneStepIds: [...marker.doneStepIds, stepId],
    steps: marker.steps,
  };
}

export function allStepsDone(
  stepIds: string[],
  marker: TaskProgressMarker,
): boolean {
  if (!stepIds.length) return true;
  return stepIds.every((id) => marker.doneStepIds.includes(id));
}
