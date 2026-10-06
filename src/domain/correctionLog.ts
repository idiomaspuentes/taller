/**
 * The record of the corrections made to a text after it was drafted: what a verse said, what it says now, why it was
 * changed and what the person was looking at when they changed it.
 *
 * The reason used to be a sentence in the message of the commit, and what the verse said before was only in the
 * history of the file. Neither can be counted: how many corrections a book took, of what kind, which notes or key
 * terms brought the most of them. translationCore keeps one record per edit for this; so does Taller now, one file
 * per person and book beside their answers (`checkings/corrections/`), so two people never write the same file.
 *
 * Not to be taken for `corrections.ts`: that is what a committee asks an earlier phase to correct (a subtarea);
 * this is the log of each change made to a verse.
 */

/** Why a text is corrected, as translators sort it: one tap each (the kinds translationCore asks for). */
export const CORRECTION_REASONS = ["spelling", "punctuation", "wordChoice", "meaning", "grammar", "other"] as const;
export type CorrectionReason = (typeof CORRECTION_REASONS)[number];

/** What the person had in hand when they corrected: the subtarea and step they were in, and the item in view. */
export type CorrectionFrom = {
  issue?: number;
  task?: string;
  step?: string;
  /** The note, key term or verse being checked, by its id in its round. */
  item?: string;
  /** That item as a person reads it: the phrase of the note, the term. */
  label?: string;
};

export type Correction = {
  chapter: number;
  verse: number;
  before: string;
  after: string;
  reasons: CorrectionReason[];
  /** What the person wrote about it, if anything. */
  note?: string;
  from?: CorrectionFrom;
  by: string;
  at: string;
};

export type CorrectionsFile = { book: string; corrections: Correction[] };

export const CORRECTIONS_DIR = "checkings/corrections";

export function correctionsFilePath(book: string, login: string): string {
  return `${CORRECTIONS_DIR}/${book.trim().toUpperCase()}.${login.trim().toLowerCase()}.corrections.json`;
}

export function normalizeReasons(raw: unknown): CorrectionReason[] {
  if (!Array.isArray(raw)) return [];
  return CORRECTION_REASONS.filter((reason) => raw.includes(reason));
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function normalizeFrom(raw: unknown): CorrectionFrom | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  const issue = Number(row.issue);
  const out: CorrectionFrom = {
    ...(Number.isInteger(issue) && issue > 0 ? { issue } : {}),
    ...(text(row.task) ? { task: text(row.task) } : {}),
    ...(text(row.step) ? { step: text(row.step) } : {}),
    ...(text(row.item) ? { item: text(row.item) } : {}),
    ...(text(row.label) ? { label: text(row.label) } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

/** A correction as it is kept: only what is well formed, and nothing of a change that changed nothing. */
export function normalizeCorrection(raw: unknown): Correction | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const chapter = Number(row.chapter);
  const verse = Number(row.verse);
  const after = text(row.after);
  const before = text(row.before);
  if (!Number.isInteger(chapter) || !Number.isInteger(verse) || chapter < 0 || verse < 0 || !after || before === after || !text(row.by) || !text(row.at)) return null;
  const from = normalizeFrom(row.from);
  return { chapter, verse, before, after, reasons: normalizeReasons(row.reasons), ...(text(row.note) ? { note: text(row.note) } : {}), ...(from ? { from } : {}), by: text(row.by), at: text(row.at) };
}

export function parseCorrectionsFile(raw: string, book: string): CorrectionsFile | null {
  try {
    const parsed = JSON.parse(raw) as Partial<CorrectionsFile>;
    if (!parsed || !Array.isArray(parsed.corrections)) return null;
    return { book: text(parsed.book) || book.trim().toUpperCase(), corrections: parsed.corrections.map(normalizeCorrection).filter((row): row is Correction => row !== null) };
  } catch {
    return null;
  }
}

export function serializeCorrectionsFile(file: CorrectionsFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** Everyone's files of a book as one list, in the order the corrections were made. */
export function mergeCorrectionFiles(files: CorrectionsFile[]): Correction[] {
  return files.flatMap((file) => file.corrections).sort((a, b) => a.at.localeCompare(b.at));
}

/** The corrections of one verse, the latest first. */
export function correctionsOfVerse(all: Correction[], chapter: number, verse: number): Correction[] {
  return all.filter((row) => row.chapter === chapter && row.verse === verse).sort((a, b) => b.at.localeCompare(a.at));
}

export type CorrectionsSummary = {
  total: number;
  /** How many different verses were corrected. */
  verses: number;
  /** How many corrections gave each reason; one with two reasons counts in both. The most given first. */
  byReason: { reason: CorrectionReason | "none"; count: number }[];
  byPerson: { login: string; count: number }[];
  /** The items (notes, key terms) that brought the most corrections. */
  byItem: { item: string; label: string; count: number }[];
};

/** A book's corrections counted: how many, of what kind, by whom and what brought them. */
export function summarizeCorrections(all: Correction[]): CorrectionsSummary {
  const count = <K extends string>(keys: K[]) => {
    const map = new Map<K, number>();
    for (const key of keys) map.set(key, (map.get(key) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const labels = new Map<string, string>();
  for (const row of all) if (row.from?.item) labels.set(row.from.item, row.from.label || labels.get(row.from.item) || row.from.item);
  return {
    total: all.length,
    verses: new Set(all.map((row) => `${row.chapter}:${row.verse}`)).size,
    byReason: count(all.flatMap((row) => (row.reasons.length ? row.reasons : (["none"] as const)))).map(([reason, n]) => ({ reason, count: n })),
    byPerson: count(all.map((row) => row.by.toLowerCase())).map(([login, n]) => ({ login, count: n })),
    byItem: count(all.flatMap((row) => (row.from?.item ? [row.from.item] : []))).map(([item, n]) => ({ item, label: labels.get(item) ?? item, count: n })),
  };
}
