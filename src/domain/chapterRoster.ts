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

/**
 * The sections of a subtask from its portions: an id is looked up in the book's portions (`EST-01-01` → `1:1-4`), or
 * read as a reference itself. What is neither is left out, and with nothing left the section is the whole chapter.
 */
export function sectionsOf(portionIds: string[], chapter: number, portions: { id: string; ref: string }[] = []): RosterSection[] {
  const refOf = new Map(portions.map((portion) => [portion.id, portion.ref]));
  const sections = portionIds
    .map((id) => refOf.get(id) ?? id)
    // The book's own references carry its code («EST 1:1-4»): the section is named by its verses alone.
    .map((ref) => parseRefRange(ref.replace(/^\s*[1-3]?[A-Z]{2,3}\s+/, "")))
    .filter((range): range is NonNullable<typeof range> => Boolean(range && range.chapter === chapter))
    .map((range) => ({ ref: range.from === range.to ? `${chapter}:${range.from}` : `${chapter}:${range.from}-${range.to}`, from: range.from, to: range.to }));
  return sections.length ? sections : [{ ref: String(chapter), from: 1, to: WHOLE_CHAPTER_TO }];
}

/**
 * The items of a subtask: those of its sections. A stretch of a split chapter is titled «Capítulo 1 · parte 1», with
 * no verses in it, and loaded the whole chapter: it never closed, and the other stretch's items were counted in it.
 */
export function inSections<T extends { verse: number }>(items: T[], sections: RosterSection[]): T[] {
  return items.filter((item) => sections.some((section) => item.verse >= section.from && item.verse <= section.to));
}

function statusOf(tally: CheckItemTally | undefined, voices: string[], me: string): RosterStatus {
  if (tally?.state === "ok") return "ready";
  if (tally?.turn === "mine") return "mine";
  // Begun and not finished by this person: some of its questions nobody answered yet, theirs to go on with.
  if (tally?.turn === "new" && me && voices.includes(me)) return "mine";
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
export function rosterOf(p: { items: CheckItem[]; summary: ChecklistSummary; sections: RosterSection[]; me?: string }): RosterRow[] {
  const me = (p.me ?? "").trim().toLowerCase();
  const tallies = new Map(p.summary.items.map((tally) => [tally.itemId, tally]));
  const rows: RosterRow[] = [];
  for (const item of p.items) {
    const [chapter, verse] = item.verseKey.split(":").map(Number);
    if (!chapter || !verse) continue;
    const section = p.sections.find((s) => verse >= s.from && verse <= s.to);
    if (!section) continue;
    const tally = tallies.get(item.id);
    const voices = voicesOf(tally);
    rows.push({ itemId: item.id, chapter, verse, section: section.ref, status: statusOf(tally, voices, me), voices });
  }
  return rows;
}

export function rosterCounts(rows: RosterRow[]): { ready: number; mine: number; waiting: number; unread: number; total: number; readyShare: number } {
  const count = (status: RosterStatus) => rows.filter((row) => row.status === status).length;
  const ready = count("ready");
  return { ready, mine: count("mine"), waiting: count("waiting"), unread: count("unread"), total: rows.length, readyShare: rows.length ? ready / rows.length : 0 };
}

export type RosterFilter = "all" | "mine" | "unread";

/**
 * The filters worth showing (27 October): one that would show nothing is left out, and «Esperando a otros» is never
 * one, since there is nothing to do there. With «Todas» alone nothing would filter, so there is no row at all.
 */
export function rosterFilters(counts: { mine: number; unread: number }): RosterFilter[] {
  const some = (["mine", "unread"] as const).filter((key) => counts[key] > 0);
  return some.length ? ["all", ...some] : [];
}

const plain = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/**
 * The rows a search finds (27 October): by the id the team uses to name a help, by its verse, or by the words it is
 * about. A verse is that verse: «1:1» is not 1:10.
 */
export function searchRoster(rows: RosterRow[], query: string, labelOf: (itemId: string) => string): RosterRow[] {
  const wanted = plain(query);
  if (!wanted) return rows;
  const verse = wanted.match(/^(\d+):(\d+)$/);
  if (verse) return rows.filter((row) => row.chapter === Number(verse[1]) && row.verse === Number(verse[2]));
  return rows.filter((row) => plain(row.itemId).includes(wanted) || plain(labelOf(row.itemId)).includes(wanted));
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
  // Who answered and who is on it now, each once: somebody still reading what they answered is one person.
  const people = (row: RosterRow) => new Set([...row.voices, ...(p.present?.[row.itemId] ?? []).map((who) => who.toLowerCase())].filter((who) => who !== me)).size;
  return (
    order.find((row) => row.status === "mine")?.itemId ??
    open.find((row) => people(row) < p.needed)?.itemId ??
    open[0]?.itemId ??
    null
  );
}
