/**
 * Corrections a later phase asks of an earlier one. A committee that validates may not change what it reads: what
 * it finds goes back to the task that maintains that resource, as a subtarea of its own, so it is somebody's work
 * with a name and an end, and not a comment that may be missed.
 */
import { asksWhileOpen } from "./commentPlace";
import { classifyComment } from "./conversation";
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

/** The verse a concern is about, as a tool takes it («1:12»), from where it was said («1:12 «arrecifes»», «1:3 §x7k2»). */
export function refOfAsk(ask: Pick<CorrectionAsk, "where">): string | undefined {
  const place = /^\s*(\d+):(\d+)/.exec(ask.where ?? "");
  return place ? `${Number(place[1])}:${Number(place[2])}` : undefined;
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
  /** The subtarea that asks (the committee's), so each correction can answer there. */
  askedIn?: number,
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
    const ref = refOfAsk(ask);
    settings = addExtraWork(settings, { taskId: owner.id, title, ...(portionId ? { portionId } : {}), ...(ref ? { ref } : {}), ...(ask.by ? { askedBy: ask.by } : {}), ...(askedIn ? { askedIn } : {}) });
  }
  return { settings, added: (settings.extraWork ?? []).filter((row) => !had.has(row.id)) };
}

const SAID_MAX = 240;

/**
 * What is said to whoever asked for a correction once it is finished: what was asked, the last thing a person said
 * in its conversation (how it was answered, or what was changed), and whether others they asked for are still
 * being worked on. `say` gives the texts of the interface.
 */
export function correctionOutcome(row: Pick<ExtraWork, "title" | "askedBy">, comments: { body: string; by: string }[], stillOpen: number, say: (key: "cx.attended" | "cx.attendedSaid" | "cx.stillOpen" | "cx.allBack") => string): string {
  const answer = [...comments].reverse().find((comment) => classifyComment(comment.body).kind === "humano" && !asksWhileOpen(comment.body) && classifyComment(comment.body).text.trim());
  // Without the names it began with: they are of the team that corrected, and named here they would be told again.
  const text = answer ? classifyComment(answer.body).text.replace(/^(\*\*[^*]+\*\*\s*—\s*)?(?:\s*@[\w-]+)+[\s,:]*/, "$1").replace(/\s+/g, " ").trim() : "";
  const said = text.length > SAID_MAX ? `${text.slice(0, SAID_MAX - 1).trimEnd()}…` : text;
  return [
    `${row.askedBy ? `@${row.askedBy} ` : ""}${say("cx.attended").replace("{title}", row.title)}`,
    said && answer ? say("cx.attendedSaid").replace("{who}", answer.by).replace("{text}", said) : "",
    stillOpen ? say("cx.stillOpen").replace("{n}", String(stillOpen)) : say("cx.allBack"),
  ]
    .filter(Boolean)
    .join(" ");
}
