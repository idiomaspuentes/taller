/**
 * What whoever prepares a project decides about its subtareas beyond what the process gives: subtareas added by hand
 * to a task, and portions cut differently from the source. Both live in the project's settings.
 */
import { uid } from "./assignment";
import { portionKey, verseRangeLabel } from "./chapters";
import type { AssignmentsDoc, ExtraWork, InventoryDoc, Portion, ProjectSettings } from "./types";
import { taskResource, type WorkOrder } from "./workOrder";

/* ------------------------------------------------------- subtareas by hand */

export function addExtraWork(settings: ProjectSettings | undefined, row: Omit<ExtraWork, "id">): ProjectSettings {
  const title = row.title.trim();
  if (!title) return settings ?? {};
  return { ...settings, extraWork: [...(settings?.extraWork ?? []), { ...row, title, id: `x-${uid().slice(0, 8)}` }] };
}

export function removeExtraWork(settings: ProjectSettings | undefined, id: string): ProjectSettings {
  const rest = (settings?.extraWork ?? []).filter((row) => row.id !== id);
  const { extraWork: _gone, ...kept } = settings ?? {};
  return rest.length ? { ...kept, extraWork: rest } : kept;
}

export function normalizeExtraWork(raw: unknown): ExtraWork[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rows: ExtraWork[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<ExtraWork>;
    const id = String(row.id ?? "").trim();
    const taskId = String(row.taskId ?? "").trim();
    const title = String(row.title ?? "").trim();
    if (!id || !taskId || !title || rows.some((have) => have.id === id)) continue;
    const portionId = String(row.portionId ?? "").trim();
    rows.push({ id, taskId, title, ...(portionId ? { portionId } : {}) });
  }
  return rows.length ? rows : undefined;
}

/** The id of the one item a subtarea added by hand covers: what tells it apart, in its marker, from laid-out work. */
export const extraItemId = (id: string) => `extra:${id}`;
export const isExtraItemId = (itemId: string) => itemId.startsWith("extra:");

/**
 * The subtareas added by hand, as work orders. One whose task is gone is left out; one whose portion is gone (the
 * book was cut again) stays, as work about the book in general.
 */
export function extraWorkOrders(board: Pick<AssignmentsDoc, "teams" | "settings" | "books" | "book">, inventory: Pick<InventoryDoc, "portions"> | null): WorkOrder[] {
  const book = (board.books?.[0] || board.book || "").toUpperCase();
  const orders: WorkOrder[] = [];
  for (const row of board.settings?.extraWork ?? []) {
    const task = board.teams.find((team) => team.id === row.taskId);
    if (!task) continue;
    const portion = row.portionId ? inventory?.portions.find((p) => portionKey(p) === row.portionId) : undefined;
    const range = portion ? verseRangeLabel(portion.ref) || portion.ref : "";
    orders.push({
      key: `${(portion?.book || book).toUpperCase()}|${task.id}|extra:${row.id}`,
      teamId: task.id,
      teamName: task.name,
      book: (portion?.book || book).toUpperCase(),
      // General work has no resource of its own: it travels as a mixed lot, which no tool takes for a text.
      resource: task.general || !task.rules.length ? "bundle" : taskResource(task),
      chapter: portion?.chapter ?? 0,
      portionIds: portion ? [portionKey(portion)] : [],
      itemIds: [extraItemId(row.id)],
      itemTypes: ["tarea"],
      label: range ? `${range} · ${row.title}` : row.title,
    });
  }
  return orders;
}

/* ------------------------------------------------------- portions cut by hand */

/** The verses at which the portions of a chapter start, as they stand. */
export function startsOf(portions: Pick<Portion, "verses">[]): number[] {
  return portions.map((portion) => portion.verses[0]).filter((verse): verse is number => typeof verse === "number");
}

/** Join the portion at `index` with the next one. */
export function joinWithNext(starts: number[], index: number): number[] {
  return starts.filter((_, at) => at !== index + 1);
}

/** Cut a portion in two: the second part starts at `verse`. */
export function cutAt(starts: number[], verse: number): number[] {
  return starts.includes(verse) ? starts : [...starts, verse].sort((a, b) => a - b);
}

function sameStarts(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((verse, index) => verse === b[index]);
}

/**
 * The project's settings with the portions of one chapter starting at `starts`. Cuts equal to the ones the chapter
 * has now are still recorded: once chosen by hand, the chapter keeps them even if the source changes its own.
 */
export function withPortionStarts(settings: ProjectSettings | undefined, book: string, chapter: number, starts: number[]): ProjectSettings {
  const code = book.toUpperCase();
  const ofBook = { ...(settings?.portionStarts?.[code] ?? {}), [String(chapter)]: starts };
  return { ...settings, portionStarts: { ...(settings?.portionStarts ?? {}), [code]: ofBook } };
}

/** Back to the cuts of the source for one chapter. */
export function withoutPortionStarts(settings: ProjectSettings | undefined, book: string, chapter: number): ProjectSettings {
  const code = book.toUpperCase();
  const { [String(chapter)]: _gone, ...restOfBook } = settings?.portionStarts?.[code] ?? {};
  const { [code]: _book, ...otherBooks } = settings?.portionStarts ?? {};
  const all = Object.keys(restOfBook).length ? { ...otherBooks, [code]: restOfBook } : otherBooks;
  const { portionStarts: _all, ...kept } = settings ?? {};
  return Object.keys(all).length ? { ...kept, portionStarts: all } : kept;
}

/** The cuts of one book in the shape the reader of the book takes. */
export function portionStartsOfBook(settings: ProjectSettings | undefined, book: string): Record<number, number[]> | undefined {
  const ofBook = settings?.portionStarts?.[book.toUpperCase()];
  if (!ofBook || !Object.keys(ofBook).length) return undefined;
  return Object.fromEntries(Object.entries(ofBook).map(([chapter, starts]) => [Number(chapter), starts]));
}

/** Whether the inventory in hand was read with the cuts the project asks for now. */
export function portionsMatchStarts(settings: ProjectSettings | undefined, inventory: Pick<InventoryDoc, "portions" | "book">): boolean {
  const wanted = portionStartsOfBook(settings, inventory.book);
  if (!wanted) return true;
  return Object.entries(wanted).every(([chapter, starts]) => sameStarts(startsOf(inventory.portions.filter((portion) => portion.chapter === Number(chapter))), starts));
}

export function normalizePortionStarts(raw: unknown): ProjectSettings["portionStarts"] {
  if (!raw || typeof raw !== "object") return undefined;
  const out: NonNullable<ProjectSettings["portionStarts"]> = {};
  for (const [book, chapters] of Object.entries(raw as Record<string, unknown>)) {
    if (!chapters || typeof chapters !== "object") continue;
    const ofBook: Record<string, number[]> = {};
    for (const [chapter, starts] of Object.entries(chapters as Record<string, unknown>)) {
      if (!Array.isArray(starts) || !(Number(chapter) > 0)) continue;
      const verses = [...new Set(starts.map(Number).filter((verse) => Number.isInteger(verse) && verse > 0))].sort((a, b) => a - b);
      if (verses.length) ofBook[String(Number(chapter))] = verses;
    }
    if (Object.keys(ofBook).length) out[book.toUpperCase()] = ofBook;
  }
  return Object.keys(out).length ? out : undefined;
}
