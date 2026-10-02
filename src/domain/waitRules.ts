import type { WaitRule, WaitScope } from "./types";

export const WAIT_SCOPE_LABEL: Record<WaitScope, string> = {
  portion: "la misma porción",
  chapter: "el mismo capítulo",
  all: "todo el trabajo",
};

export function isWaitScope(value: unknown): value is WaitScope {
  return value === "portion" || value === "chapter" || value === "all";
}

/** Keep only well-formed rules; a rule needs exactly one target. */
export function normalizeWaitRules(raw: unknown): WaitRule[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rules: WaitRule[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const item = row as Partial<WaitRule>;
    const taskId = String(item.taskId ?? "").trim();
    const phaseId = String(item.phaseId ?? "").trim();
    if ((taskId ? 1 : 0) + (phaseId ? 1 : 0) !== 1) continue;
    const scope: WaitScope = isWaitScope(item.scope) ? item.scope : "portion";
    // A wait on the source project names one of its tasks; it has no phases of ours to point at.
    const source = item.source === true && Boolean(taskId);
    const key = `${source ? "s" : taskId ? "t" : "p"}:${taskId || phaseId}:${scope}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push(source ? { taskId, scope, source: true } : taskId ? { taskId, scope } : { phaseId, scope });
  }
  return rules.length ? rules : undefined;
}
