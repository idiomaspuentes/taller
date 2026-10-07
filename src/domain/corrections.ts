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

/**
 * The passage a concern is about: of the passages of the unit, the one that has its verse («1:12 «arrecifes»» is of
 * 1:12–16). A unit of a whole chapter is several passages, and every correction was filed under the first: the one
 * about 1:12 read «JUD 1:1–4 · Corrección 1:12», and its tool opened on verses 1 to 4. `undefined` when the concern
 * names no verse, or none of the passages has it.
 */
export function portionOfAsk(ask: Pick<CorrectionAsk, "where">, portions: { id: string; chapter: number; verses: number[] }[]): string | undefined {
  const place = /^\s*(\d+):(\d+)/.exec(ask.where ?? "");
  if (!place) return undefined;
  return portions.find((portion) => portion.chapter === Number(place[1]) && portion.verses.includes(Number(place[2])))?.id;
}

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
  /** The passage each correction opens on: one for them all, or the one of each concern. */
  portion?: string | ((ask: CorrectionAsk) => string | undefined),
): { settings: ProjectSettings; added: ExtraWork[] } {
  let settings: ProjectSettings = board.settings ?? {};
  const had = new Set((settings.extraWork ?? []).map((row) => row.id));
  for (const ask of asks) {
    if (!ask.text.trim()) continue;
    const owner = ownerTaskOf(ask.about, board as AssignmentsDoc, from);
    if (!owner) continue;
    const title = correctionTitle(ask);
    if ((settings.extraWork ?? []).some((row) => row.taskId === owner.id && row.title === title)) continue;
    const portionId = typeof portion === "function" ? portion(ask) : portion;
    settings = addExtraWork(settings, { taskId: owner.id, title, ...(portionId ? { portionId } : {}) });
  }
  return { settings, added: (settings.extraWork ?? []).filter((row) => !had.has(row.id)) };
}
