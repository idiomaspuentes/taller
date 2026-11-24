import type { BoardCard } from "./myTasksBoard";
import type { Localized } from "./types";

/**
 * The phase a card of «Mis tareas» is of, for whoever works in more than one team. Their cards came mixed, named by
 * task and passage alone («Palabras clave TPL · Esdras 2», «Traducir Palabras · Esdras 3»), and the same «Revisar»
 * on both: nothing said which was for Afinación and which for Traducción (24 November). Pure; no phase is named here.
 */

/** How many colours there are for phases; a sixth phase takes the first one again. */
export const PHASE_TONES = 5;

export type PhaseBadge = { name: string; names?: Localized; tone: number };

type CardPhase = Pick<BoardCard, "task" | "bucket">;

/** The phase of the card's task, with its colour from the phase's place in the plan; none without a task or phase. */
export function phaseOfCard(card: CardPhase): PhaseBadge | undefined {
  const phases = card.bucket?.board.phases ?? [];
  const id = card.task?.phaseId;
  if (!id) return undefined;
  // By `order` when every phase has one, else where each is written (an order beside a place in the list means
  // nothing), and where it is written between equal orders: the colour stays put between visits.
  const ordered = phases.every((phase) => typeof phase.order === "number");
  const placed = phases.map((phase, at) => ({ phase, at })).sort((a, b) => (ordered ? a.phase.order - b.phase.order : 0) || a.at - b.at);
  const at = placed.findIndex((row) => row.phase.id === id);
  if (at < 0) return undefined;
  const { name, names } = placed[at]!.phase;
  return { name, ...(names ? { names } : {}), tone: (at % PHASE_TONES) + 1 };
}

const nameKey = (name: string) => name.trim().toLocaleLowerCase();

/**
 * Whether the cards still to work on are of more than one phase. A phase is told by its name: the Traducción of two
 * books is one phase to the person. What is done, and the work of a project set aside, are folded at the end and do
 * not count.
 */
export function mixesPhases(cards: Pick<BoardCard, "task" | "bucket" | "group">[]): boolean {
  const names = new Set<string>();
  for (const card of cards) {
    if (card.group === "done" || card.group === "paused") continue;
    const phase = phaseOfCard(card);
    if (phase) names.add(nameKey(phase.name));
    if (names.size > 1) return true;
  }
  return false;
}
