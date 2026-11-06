/**
 * Verses a draft writes as one (`\v 4-5`). Such a verse is one verse of the draft against two of the original:
 * it is known everywhere by its first number, and written, aligned and corrected as the whole it is.
 */
import { listVerseSpans } from "./usfmEdit";

export type JoinedSpan = { from: number; to: number };

/** The verses a name of a verse stands for («JUD 1:4-5», «JUD 1:6»), when it is of the chapter. */
export function spanOfSid(sid: string, chapter: number): JoinedSpan | null {
  const m = /(\d+):(\d+)(?:\s*[-–]\s*(\d+))?\s*$/.exec(sid);
  if (!m || Number(m[1]) !== chapter) return null;
  const from = Number(m[2]);
  const to = Number(m[3] ?? m[2]);
  return to >= from ? { from, to } : { from, to: from };
}

/** The verses a verse is written with in a book: itself alone, or all those of the `\v 4-5` it is in. */
export function spanOfVerse(usfm: string, chapter: number, verse: number): JoinedSpan {
  const hit = listVerseSpans(usfm).find((span) => span.chapter === chapter && !span.segment && span.verse <= verse && span.verseTo >= verse);
  return hit ? { from: hit.verse, to: hit.verseTo } : { from: verse, to: verse };
}

/** A row of a draft being written: one verse, or verses written as one. */
export type DraftRow = { from: number; to: number; text: string };

/**
 * The joins made while the editor is open, by the verses they made («6-7»): the rows taken and the text left. A
 * join by mistake undone at once gives each verse its text back; before, the split left all of it in the first.
 */
export type DraftJoins = Map<string, { parts: DraftRow[]; text: string }>;

function joinKey(row: { from: number; to: number }): string {
  return `${row.from}-${row.to}`;
}

/** Two rows written as one, their texts one after the other; `joins` keeps what each said. */
export function joinDraftRows(cur: DraftRow, next: DraftRow, joins: DraftJoins): DraftRow {
  const text = [cur.text.trim(), next.text.trim()].filter(Boolean).join(" ");
  const row = { from: cur.from, to: next.to, text };
  joins.set(joinKey(row), { parts: [cur, next], text });
  return row;
}

/**
 * A row split into its verses. A join of this sitting whose text nobody changed since gives each verse back what it
 * had. Otherwise nobody knows which words go where, so all of it stays in the first verse and the rest start empty.
 */
export function splitDraftRow(row: DraftRow, joins: DraftJoins): DraftRow[] {
  const kept = joins.get(joinKey(row));
  if (kept) joins.delete(joinKey(row));
  if (kept && kept.text === row.text) return kept.parts.flatMap((part) => (part.to > part.from ? splitDraftRow(part, joins) : [part]));
  const rows: DraftRow[] = [];
  for (let v = row.from; v <= row.to; v++) rows.push({ from: v, to: v, text: v === row.from ? row.text : "" });
  return rows;
}

/** «4», or «4–5» for verses written as one. */
export function spanLabel(span: { verse: number; to?: number } | JoinedSpan): string {
  const from = "verse" in span ? span.verse : span.from;
  const to = span.to ?? from;
  return to > from ? `${from}–${to}` : String(from);
}
