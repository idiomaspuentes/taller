import type { CheckItem, CheckItemTally, ChecklistSummary } from "./checklist";
import { parseRefRange } from "./usfmEdit";

/**
 * The list of a chapter's helps in one subtask (26 October): where each stands for the person looking, grouped by
 * the sections the work used to be split into, and where people are still needed.
 */

/** Ready: decided by the people needed. Mine: their opinion is missing, or somebody answered them. */
export type RosterStatus = "ready" | "mine" | "waiting" | "unread";
export type RosterSection = { ref: string; from: number; to: number };
export type RosterRow = { itemId: string; chapter: number; verse: number; verseTo?: number; section: string; status: RosterStatus; voices: string[] };

const WHOLE_CHAPTER_TO = 200;

/** The sections of a subtask from its portions; ids that are not references are left out, and none is the chapter. */
export function sectionsOf(portionIds: string[], chapter: number): RosterSection[] {
  const sections = portionIds
    .map((id) => ({ id, range: parseRefRange(id) }))
    .filter((row): row is { id: string; range: NonNullable<typeof row.range> } => Boolean(row.range && row.range.chapter === chapter))
    .map(({ id, range }) => ({ ref: id, from: range.from, to: range.to }));
  return sections.length ? sections : [{ ref: String(chapter), from: 1, to: WHOLE_CHAPTER_TO }];
}

function statusOf(tally: CheckItemTally | undefined, voices: string[]): RosterStatus {
  if (tally?.state === "ok") return "ready";
  if (tally?.turn === "mine") return "mine";
  if (tally?.turn === "waiting") return "waiting";
  if (tally?.turn === "new" || !voices.length) return "unread";
  return "waiting";
}

function voicesOf(tally: CheckItemTally | undefined): string[] {
  const all = new Set<string>();
  for (const slot of Object.values(tally?.slots ?? {})) for (const who of slot.voices) all.add(who.toLowerCase());
  if (!tally?.slots) for (const answer of Object.values(tally?.answers ?? {})) if (answer?.by) all.add(answer.by.toLowerCase());
  return [...all].sort();
}

/** Each item in reading order, in the section of its verse; an item outside every section is not this subtask's. */
export function rosterOf(p: { items: CheckItem[]; summary: ChecklistSummary; sections: RosterSection[] }): RosterRow[] {
  const tallies = new Map(p.summary.items.map((tally) => [tally.itemId, tally]));
  const rows: RosterRow[] = [];
  for (const item of p.items) {
    const [chapter, verse] = item.verseKey.split(":").map(Number);
    if (!chapter || !verse) continue;
    const section = p.sections.find((s) => verse >= s.from && verse <= s.to);
    if (!section) continue;
    const tally = tallies.get(item.id);
    const voices = voicesOf(tally);
    rows.push({ itemId: item.id, chapter, verse, section: section.ref, status: statusOf(tally, voices), voices });
  }
  return rows;
}

export function rosterCounts(rows: RosterRow[]): { ready: number; mine: number; waiting: number; unread: number; total: number; readyShare: number } {
  const count = (status: RosterStatus) => rows.filter((row) => row.status === status).length;
  const ready = count("ready");
  return { ready, mine: count("mine"), waiting: count("waiting"), unread: count("unread"), total: rows.length, readyShare: rows.length ? ready / rows.length : 0 };
}

/**
 * Where to go on to: what is the person's turn first; then what they have not reviewed and still lacks people (those
 * who answered plus those on it now); then anything they have not reviewed. It never blocks: covered is not closed.
 */
export function nextNeeding(rows: RosterRow[], p: { me: string; needed: number; after?: string; present?: Record<string, string[]> }): string | null {
  const me = p.me.toLowerCase();
  const start = p.after ? rows.findIndex((row) => row.itemId === p.after) + 1 : 0;
  const order = [...rows.slice(start), ...rows.slice(0, start)];
  const open = order.filter((row) => row.status !== "ready" && !row.voices.includes(me));
  const people = (row: RosterRow) => row.voices.length + (p.present?.[row.itemId] ?? []).filter((who) => who.toLowerCase() !== me).length;
  return (
    order.find((row) => row.status === "mine")?.itemId ??
    open.find((row) => people(row) < p.needed)?.itemId ??
    open[0]?.itemId ??
    null
  );
}
