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
};

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
    const row = value as { assignees?: unknown; approvals?: unknown; returnedBy?: unknown };
    const returnedBy = typeof row.returnedBy === "string" ? row.returnedBy.trim() : "";
    out[id] = {
      assignees: normalizeLoginList(row.assignees),
      approvals: normalizeLoginList(row.approvals),
      ...(returnedBy ? { returnedBy } : {}),
    };
  }
  return Object.keys(out).length ? out : undefined;
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
      },
    },
  };
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
