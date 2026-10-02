import { textFingerprint } from "./reviewRound";
import { isValidBookUsfm, listVerseSpans, type RefRange } from "./usfmEdit";

/**
 * Publishing one unit (a chapter, or a stretch of a split one): what is checked before, and how the unit is put into
 * the published file without touching the rest of it. Pure: reading and writing Door43 is done by the caller.
 */

/** A resource of the unit: a text (USFM) or a helps table (TSV). */
/** `articles`: the support articles the unit links to (they belong to the whole language, not to a chapter). */
export type UnitFileKind = "usfm" | "tsv" | "articles";

/** Fingerprint of every piece of a resource inside the unit: per verse of a text, per row of a table. */
export type UnitFingerprints = Record<string, Record<string, string>>;

export type UnitCheckId =
  | "draft-missing"
  | "usfm-invalid"
  | "verses-missing"
  | "verses-empty"
  | "conflict-marks"
  | "not-aligned"
  | "tsv-header"
  | "rows-none"
  | "row-id"
  | "row-id-repeated"
  | "row-empty"
  | "row-quote"
  | "row-support"
  | "article-empty"
  | "changed-since-endorsement"
  | "not-endorsed";

/** One thing found. `where` are the verses or rows it is about, for the message. */
export type UnitProblem = { id: UnitCheckId; resource: string; where: string[] };

const inRange = (range: RefRange, chapter: number, verse: number) => chapter === range.chapter && verse >= range.from && verse <= range.to;

// ---------------------------------------------------------------- texts

/** Words of a verse that sit outside every alignment mark. */
export function unalignedWords(rawBody: string): string[] {
  const out: string[] = [];
  let depth = 0;
  const re = /\\zaln-s\b[^*]*\\\*|\\zaln-e\\\*|\\w\s+([^|\\]+?)\s*(?:\|[^\\]*)?\\w\*/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(rawBody)) !== null) {
    if (match[0].startsWith("\\zaln-s")) depth++;
    else if (match[0].startsWith("\\zaln-e")) depth = Math.max(0, depth - 1);
    else if (depth === 0 && match[1]) out.push(match[1]);
  }
  return out;
}

/**
 * A text of the unit is ready to publish: it reads as USFM, every verse the source has is there with words, nothing
 * is left from a clash, and (when the process aligns it) every verse is aligned.
 */
export function checkUnitText(params: { resource: string; usfm: string | null; range: RefRange; expectedVerses: number[]; aligned: boolean }): UnitProblem[] {
  const { resource, usfm, range } = params;
  if (!usfm) return [{ id: "draft-missing", resource, where: [] }];
  const problems: UnitProblem[] = [];
  if (!isValidBookUsfm(usfm)) problems.push({ id: "usfm-invalid", resource, where: [] });
  const spans = listVerseSpans(usfm).filter((span) => span.chapter === range.chapter);
  const covered = new Map<number, (typeof spans)[number]>();
  for (const span of spans) for (let v = span.verse; v <= span.verseTo; v++) covered.set(v, span);
  const ref = (verse: number) => `${range.chapter}:${verse}`;
  const wanted = params.expectedVerses.filter((verse) => inRange(range, range.chapter, verse));
  const missing = wanted.filter((verse) => !covered.has(verse));
  if (missing.length) problems.push({ id: "verses-missing", resource, where: missing.map(ref) });
  const present = wanted.filter((verse) => covered.has(verse));
  const empty = present.filter((verse) => !plainWords(covered.get(verse)!.rawBody));
  if (empty.length) problems.push({ id: "verses-empty", resource, where: empty.map(ref) });
  const marked = present.filter((verse) => /^(<{7}|={7}|>{7})/m.test(covered.get(verse)!.rawBody));
  if (marked.length) problems.push({ id: "conflict-marks", resource, where: marked.map(ref) });
  if (params.aligned) {
    const loose = present.filter((verse) => {
      const body = covered.get(verse)!.rawBody;
      return body.trim() !== "" && (!/\\zaln-s\b/.test(body) || unalignedWords(body).length > 0);
    });
    if (loose.length) problems.push({ id: "not-aligned", resource, where: [...new Set(loose)].map(ref) });
  }
  return problems;
}

/** The words of a verse as a reader sees them: no alignment marks, word attributes, notes or other markers. */
export function plainWords(rawBody: string): string {
  return rawBody
    .replace(/\\(f|fe|x)\s[\s\S]*?\\\1\*/g, " ")
    .replace(/\\zaln-s\b[\s\S]*?\\\*/g, "")
    .replace(/\\zaln-e\\\*/g, "")
    .replace(/\\w\s+([^|\\]+?)\s*(?:\|[^\\]*)?\\w\*/g, "$1")
    .replace(/\\[a-zA-Z0-9-]+\*?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The unit's verses of a text, per verse, as plain words: what an endorsement is about. */
export function textFingerprints(usfm: string | null, range: RefRange): Record<string, string> {
  const out: Record<string, string> = {};
  if (!usfm) return out;
  for (const span of listVerseSpans(usfm)) {
    if (span.chapter !== range.chapter || span.verseTo < range.from || span.verse > range.to) continue;
    out[`${span.chapter}:${span.verse}`] = textFingerprint(plainWords(span.rawBody));
  }
  return out;
}

const eolOf = (text: string) => (text.includes("\r\n") ? "\r\n" : "\n");
const endWithEol = (text: string, eol: string) => (text.endsWith("\n") ? text : `${text}${eol}`);

/**
 * The published file with the unit's verses taken from the group draft, marks and all. Everything outside the unit
 * keeps the bytes it had. With no published file yet, it starts from the draft's header and holds only the unit.
 */
export function publishUnitUsfm(published: string | null, draft: string, range: RefRange): string {
  const mine = listVerseSpans(draft).filter((span) => span.chapter === range.chapter && span.verseTo >= range.from && span.verse <= range.to);
  if (!mine.length) return published ?? "";
  const eol = eolOf(published ?? draft);
  const block = endWithEol(draft.slice(mine[0]!.start, mine[mine.length - 1]!.end).replace(/\r?\n/g, eol), eol);
  const chapterLine = `\\c ${range.chapter}${eol}\\p${eol}`;

  if (!published || !published.trim()) {
    const firstChapter = draft.search(/\\c\s+\d+/);
    const header = endWithEol((firstChapter >= 0 ? draft.slice(0, firstChapter) : "").replace(/\r?\n/g, eol), eol);
    return `${header}${chapterLine}${block}`;
  }

  const spans = listVerseSpans(published);
  const theirs = spans.filter((span) => span.chapter === range.chapter && span.verseTo >= range.from && span.verse <= range.to);
  if (theirs.length) {
    return `${published.slice(0, theirs[0]!.start)}${block}${published.slice(theirs[theirs.length - 1]!.end)}`;
  }
  const inChapter = spans.filter((span) => span.chapter === range.chapter);
  const before = inChapter.filter((span) => span.verseTo < range.from).pop();
  if (before) return `${endWithEol(published.slice(0, before.end), eol)}${block}${published.slice(before.end)}`;
  const after = inChapter.find((span) => span.verse > range.to);
  if (after) return `${published.slice(0, after.start)}${block}${published.slice(after.start)}`;

  // The chapter has no verses there, or does not exist: after its `\c` line, or before the next chapter, or last.
  const chapters = [...published.matchAll(/\\c\s+(\d+)[^\r\n]*\r?\n?/g)].map((m) => ({ number: Number(m[1]), start: m.index!, end: m.index! + m[0].length }));
  const own = chapters.find((c) => c.number === range.chapter);
  if (own) return `${endWithEol(published.slice(0, own.end), eol)}\\p${eol}${block}${published.slice(own.end)}`;
  const next = chapters.find((c) => c.number > range.chapter);
  if (next) return `${published.slice(0, next.start)}${chapterLine}${block}${published.slice(next.start)}`;
  return `${endWithEol(published, eol)}${chapterLine}${block}`;
}

// ---------------------------------------------------------------- tables

type Table = { header: string[]; rows: { cells: string[]; line: string }[]; eol: string };

function readTable(tsv: string): Table {
  const eol = eolOf(tsv);
  const lines = tsv.split(/\r?\n/).filter((line) => line.length > 0);
  const header = (lines[0] ?? "").split("\t");
  return { header, rows: lines.slice(1).map((line) => ({ line, cells: line.split("\t") })), eol };
}

const column = (table: Table, name: string) => table.header.findIndex((cell) => cell.trim().toLowerCase() === name.toLowerCase());

/** Where a row sits: `2:intro` goes with the first verse of its chapter, `front:intro` with the very first unit. */
function rowPlace(reference: string): { chapter: number; verse: number } | null {
  const ref = reference.trim();
  if (/^front:intro$/i.test(ref)) return { chapter: 1, verse: 0 };
  const match = /^(\d+):(\d+|intro)/i.exec(ref);
  if (!match) return null;
  return { chapter: Number(match[1]), verse: /intro/i.test(match[2]!) ? 0 : Number(match[2]) };
}

const rowInRange = (range: RefRange, reference: string): boolean => {
  const place = rowPlace(reference);
  if (!place || place.chapter !== range.chapter) return false;
  return place.verse === 0 ? range.from <= 1 : place.verse >= range.from && place.verse <= range.to;
};

/** A helps table of the unit is ready to publish: its columns are there and every row of the unit is whole. */
export function checkUnitTable(params: { resource: string; tsv: string | null; range: RefRange; content: string[]; quoted: boolean }): UnitProblem[] {
  const { resource, tsv, range } = params;
  if (!tsv) return [{ id: "draft-missing", resource, where: [] }];
  const table = readTable(tsv);
  const refAt = column(table, "Reference");
  const idAt = column(table, "ID");
  const contentAt = params.content.map((name) => column(table, name));
  if (refAt < 0 || idAt < 0 || contentAt.some((at) => at < 0)) return [{ id: "tsv-header", resource, where: [] }];
  const mine = table.rows.filter((row) => rowInRange(range, row.cells[refAt] ?? ""));
  if (!mine.length) return [{ id: "rows-none", resource, where: [] }];
  const label = (row: Table["rows"][number]) => `${(row.cells[refAt] ?? "").trim()} · ${(row.cells[idAt] ?? "").trim() || "—"}`;
  const counts = new Map<string, number>();
  for (const row of table.rows) {
    const id = (row.cells[idAt] ?? "").trim();
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const problems: UnitProblem[] = [];
  const add = (id: UnitCheckId, rows: Table["rows"]) => {
    if (rows.length) problems.push({ id, resource, where: rows.map(label) });
  };
  add("row-id", mine.filter((row) => !/^[a-z0-9]{4}$/i.test((row.cells[idAt] ?? "").trim())));
  add("row-id-repeated", mine.filter((row) => (counts.get((row.cells[idAt] ?? "").trim()) ?? 0) > 1));
  add("row-empty", mine.filter((row) => contentAt.some((at) => !(row.cells[at] ?? "").trim())));
  if (params.quoted) {
    const quoteAt = column(table, "Quote");
    const supportAt = column(table, "SupportReference");
    const isIntro = (row: Table["rows"][number]) => rowPlace(row.cells[refAt] ?? "")?.verse === 0;
    if (quoteAt >= 0) add("row-quote", mine.filter((row) => !isIntro(row) && !(row.cells[quoteAt] ?? "").trim()));
    if (supportAt >= 0) add("row-support", mine.filter((row) => (row.cells[supportAt] ?? "").trim() !== "" && !/^rc:\/\//.test((row.cells[supportAt] ?? "").trim())));
  }
  return problems;
}

/** The unit's rows of a table, per row id. */
export function tableFingerprints(tsv: string | null, range: RefRange): Record<string, string> {
  const out: Record<string, string> = {};
  if (!tsv) return out;
  const table = readTable(tsv);
  const refAt = column(table, "Reference");
  const idAt = column(table, "ID");
  if (refAt < 0) return out;
  table.rows.forEach((row, index) => {
    if (!rowInRange(range, row.cells[refAt] ?? "")) return;
    const id = (idAt >= 0 ? (row.cells[idAt] ?? "").trim() : "") || `fila-${index}`;
    out[`${(row.cells[refAt] ?? "").trim()} · ${id}`] = textFingerprint(row.line);
  });
  return out;
}

/** The published table with the unit's rows taken from the group draft; the other rows stay as they are. */
export function publishUnitTsv(published: string | null, draft: string, range: RefRange): string {
  const from = readTable(draft);
  const fromRef = column(from, "Reference");
  const mine = fromRef < 0 ? [] : from.rows.filter((row) => rowInRange(range, row.cells[fromRef] ?? ""));
  if (!mine.length) return published ?? "";
  if (!published || !published.trim()) return `${[from.header.join("\t"), ...mine.map((row) => row.line)].join(from.eol)}${from.eol}`;

  const into = readTable(published);
  const refAt = column(into, "Reference");
  if (refAt < 0) return published;
  const lines: string[] = [];
  let placed = false;
  const place = () => {
    if (placed) return;
    lines.push(...mine.map((row) => row.line));
    placed = true;
  };
  for (const row of into.rows) {
    const reference = row.cells[refAt] ?? "";
    if (rowInRange(range, reference)) {
      place();
      continue;
    }
    const at = rowPlace(reference);
    if (at && (at.chapter > range.chapter || (at.chapter === range.chapter && at.verse > range.to))) place();
    lines.push(row.line);
  }
  place();
  return `${[into.header.join("\t"), ...lines].join(into.eol)}${into.eol}`;
}

// ---------------------------------------------------------------- articles

/**
 * The support articles a unit links to: the Academia articles its notes point at (a folder each) and the Palabras
 * articles of its key terms (a file each). They are published with the first unit that uses them.
 */
export function articlesOfUnit(params: { notesTsv: string | null; termsTsv: string | null; range: RefRange }): { academia: string[]; palabras: string[] } {
  const linked = (tsv: string | null, columnName: string, pattern: RegExp, toPath: (match: RegExpExecArray) => string): string[] => {
    if (!tsv) return [];
    const table = readTable(tsv);
    const refAt = column(table, "Reference");
    const at = column(table, columnName);
    if (refAt < 0 || at < 0) return [];
    const out = new Set<string>();
    for (const row of table.rows) {
      if (!rowInRange(params.range, row.cells[refAt] ?? "")) continue;
      const match = pattern.exec((row.cells[at] ?? "").trim());
      if (match) out.add(toPath(match));
    }
    return [...out].sort();
  };
  return {
    academia: linked(params.notesTsv, "SupportReference", /^rc:\/\/[^/]+\/ta\/man\/([^/\s]+)\/([^/\s]+)$/, (m) => `${m[1]}/${m[2]}`),
    palabras: linked(params.termsTsv, "TWLink", /^rc:\/\/[^/]+\/tw\/dict\/(bible\/[^/\s]+\/[^/\s]+)$/, (m) => `${m[1]}.md`),
  };
}

/** Articles of the unit that are empty in the team's version. */
export function checkUnitArticles(resource: string, files: { path: string; text: string }[]): UnitProblem[] {
  const empty = files.filter((file) => !file.text.trim()).map((file) => file.path);
  return empty.length ? [{ id: "article-empty", resource, where: empty }] : [];
}

/** What each article of the unit says, by path. */
export function articleFingerprints(files: { path: string; text: string }[]): Record<string, string> {
  return Object.fromEntries(files.map((file) => [file.path, textFingerprint(file.text.replace(/\r\n/g, "\n").trim())]));
}

// ---------------------------------------------------------------- the endorsement

/** What changed in the unit since it was endorsed. Nothing recorded = it was never endorsed. */
export function checkAgainstEndorsement(now: UnitFingerprints, endorsed: UnitFingerprints | null): UnitProblem[] {
  if (!endorsed) return [{ id: "not-endorsed", resource: "", where: [] }];
  const problems: UnitProblem[] = [];
  for (const resource of Object.keys(now)) {
    const before = endorsed[resource];
    if (!before) continue; // a resource the committee did not have before it
    const current = now[resource]!;
    const changed = [...new Set([...Object.keys(current), ...Object.keys(before)])].filter((key) => current[key] !== before[key]);
    if (changed.length) problems.push({ id: "changed-since-endorsement", resource, where: changed });
  }
  return problems;
}

/** Name of the unit inside file names and branch names: `2.1-15`. */
export function unitSlug(range: RefRange): string {
  return `${range.chapter}.${range.from}-${range.to}`;
}
