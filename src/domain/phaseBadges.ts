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
  // By `order`, and where it is written when that does not tell them apart: the colour stays put between visits.
  const placed = phases.map((phase, at) => ({ phase, at })).sort((a, b) => (a.phase.order ?? a.at) - (b.phase.order ?? b.at) || a.at - b.at);
  const at = placed.findIndex((row) => row.phase.id === id);
  if (at < 0) return undefined;
  const { name, names } = placed[at]!.phase;
  return { name, ...(names ? { names } : {}), tone: (at % PHASE_TONES) + 1 };
}

const nameKey = (name: string) => name.trim().toLocaleLowerCase();

/**
 * Whether the cards still to work on are of more than one phase. A phase is told by its name: the Traducción of two
 * books is one phase to the person. What is done is folded at the end and does not count.
 */
export function mixesPhases(cards: Pick<BoardCard, "task" | "bucket" | "group">[]): boolean {
  const names = new Set<string>();
  for (const card of cards) {
    if (card.group === "done") continue;
    const phase = phaseOfCard(card);
    if (phase) names.add(nameKey(phase.name));
    if (names.size > 1) return true;
  }
  return false;
}
