/**
 * Corrections a later phase asks of an earlier one. A committee that validates may not change what it reads: what
 * it finds goes back to the task that maintains that resource, as a subtarea of its own, so it is somebody's work
 * with a name and an end, and not a comment that may be missed.
 */
import { addExtraWork } from "./extraWork";
import { ownerTaskOf } from "./resourceOwner";
import type { AssignmentsDoc, ExtraWork, ProjectSettings, ProjectTask } from "./types";

export type CorrectionAsk = {
  /** The resource the concern is about. */
  about: string;
  /** Where in the passage (`1:3`), when the concern says it. */
  where?: string;
  text: string;
  by?: string;
};

const TITLE_MAX = 140;

/** «Corrección 1:3: dice "siervo" y la nota habla de "esclavo"». */
export function correctionTitle(ask: CorrectionAsk): string {
  const text = ask.text.replace(/\s+/g, " ").trim();
  const head = `Corrección${ask.where?.trim() ? ` ${ask.where.trim()}` : ""}: `;
  return `${head}${text.length > TITLE_MAX - head.length ? `${text.slice(0, TITLE_MAX - head.length - 1).trimEnd()}…` : text}`;
}

/**
 * The plan with one subtarea of correction for each concern, each in the task that maintains what it is about. A
 * concern about a resource nobody before `from` works on is left out, and one already asked (same task, same words)
 * is not asked twice.
 */
export function correctionRows(
  board: Pick<AssignmentsDoc, "teams" | "phases" | "settings">,
  from: ProjectTask,
  asks: CorrectionAsk[],
  portionId?: string,
): { settings: ProjectSettings; added: ExtraWork[] } {
  let settings: ProjectSettings = board.settings ?? {};
  const had = new Set((settings.extraWork ?? []).map((row) => row.id));
  for (const ask of asks) {
    if (!ask.text.trim()) continue;
    const owner = ownerTaskOf(ask.about, board as AssignmentsDoc, from);
    if (!owner) continue;
    const title = correctionTitle(ask);
    if ((settings.extraWork ?? []).some((row) => row.taskId === owner.id && row.title === title)) continue;
    settings = addExtraWork(settings, { taskId: owner.id, title, ...(portionId ? { portionId } : {}) });
  }
  return { settings, added: (settings.extraWork ?? []).filter((row) => !had.has(row.id)) };
}
