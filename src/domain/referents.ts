/**
 * Who a word of the original is about: the noun a pronoun stands for, and who does what a verb says when the
 * sentence does not name them. The answers are those of MACULA (Clear-Bible/macula-hebrew and macula-greek, by
 * Biblica, CC BY 4.0), reshaped by `scripts/build-referents.mts` into one file per book, in the numbering the
 * app's texts use.
 */

/** `refers`: what a pronoun or a suffix stands for. `subject`: who does what the verb says. */
export type ReferentKind = "refers" | "subject";

/** A word a word points to: where it is, how it is written and its Strong's number (`H3124`, `G2424`). */
export type ReferentTarget = { kind: ReferentKind; piece?: string; chapter: number; verse: number; text: string; strong: string };

/** A word of a verse that points to others. `occurrence` counts the words of the verse written like it, from 0. */
export type ReferentWord = { key: string; occurrence: number; targets: ReferentTarget[] };

/** The words of a book that point to others, by `"chapter:verse"`. */
export type ReferentFile = { verses: Record<string, ReferentWord[]> };

/**
 * What a word is found by: its letters alone. The editions differ in accents, in the marks of the chant and in
 * how they write a final sigma or a capital, and none of that makes it another word.
 */
export function referentKey(surface: string): string {
  return surface
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
    .replace(/[^\p{L}]/gu, "");
}

const KINDS: Record<string, ReferentKind> = { r: "refers", s: "subject" };

/** A file as it is served: `{ verses: { "1:17": [["key", 0, [["r", "piece", 1, 15, "text", "H3124"]]]] } }`. */
export function normalizeReferentFile(raw: unknown): ReferentFile | null {
  const rows = (raw as { verses?: unknown } | null)?.verses;
  if (!rows || typeof rows !== "object") return null;
  const verses: Record<string, ReferentWord[]> = {};
  for (const [place, words] of Object.entries(rows as Record<string, unknown>)) {
    if (!/^\d+:\d+$/.test(place) || !Array.isArray(words)) continue;
    const kept: ReferentWord[] = [];
    for (const word of words) {
      if (!Array.isArray(word) || typeof word[0] !== "string" || !Array.isArray(word[2])) continue;
      const targets = (word[2] as unknown[]).flatMap((row): ReferentTarget[] => {
        if (!Array.isArray(row)) return [];
        const [kind, piece, chapter, verse, text, strong] = row as [string, string, number, number, string, string];
        if (!KINDS[kind] || typeof text !== "string" || !text || !Number.isFinite(chapter) || !Number.isFinite(verse)) return [];
        return [{ kind: KINDS[kind], ...(piece ? { piece } : {}), chapter, verse, text, strong: /^[HG]\d+[a-z]?$/.test(strong ?? "") ? strong : "" }];
      });
      if (targets.length) kept.push({ key: word[0], occurrence: Number(word[1]) || 0, targets });
    }
    if (kept.length) verses[place] = kept;
  }
  return Object.keys(verses).length ? { verses } : null;
}

const sameTargets = (a: ReferentTarget[], b: ReferentTarget[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Whom a word of a verse points to. A verse may write the same word twice, about two people: then the answer is
 * given only when it is known which of the two was touched (`occurrence`), and not guessed.
 */
export function referentsOf(file: ReferentFile | null | undefined, at: { chapter: number; verse: number }, surface: string, occurrence?: number): ReferentTarget[] {
  const key = referentKey(surface);
  const same = (file?.verses[`${at.chapter}:${at.verse}`] ?? []).filter((word) => word.key === key);
  if (!key || !same.length) return [];
  if (occurrence !== undefined) return same.find((word) => word.occurrence === occurrence)?.targets ?? [];
  return same.every((word) => sameTargets(word.targets, same[0]!.targets)) ? same[0]!.targets : [];
}

// ---------------------------------------------------------------- building the files

/** A row of MACULA's tables: a word of the Greek, or a piece of a word of the Hebrew. */
export type MaculaRow = {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  /** The place of the word in its verse; the pieces of a Hebrew word share it. */
  word: number;
  text: string;
  /** `H3124`, `G2424`, or nothing. */
  strong: string;
  refers: string[];
  subject: string[];
};

// The Greek table writes an id with the letter its rows begin with (`n40001002014`); the Hebrew one, without.
const ids = (cell: string | undefined) => (cell ?? "").split(/[\s;]+/).map((id) => id.replace(/^[on]/, "")).filter(Boolean);

/**
 * The rows of one of MACULA's tables (`ref` is «GEN 1:11!13»). The Hebrew table calls the Strong's number
 * `strongnumberx` and what a pronoun stands for `participantref`; the Greek one, `strong` and `referent`.
 */
export function maculaRows(tsv: string, hebrew: boolean): MaculaRow[] {
  const lines = tsv.split(/\r?\n/);
  const head = lines[0]!.split("\t");
  const at = (name: string) => head.indexOf(name);
  const [id, ref, text, strong, refers, subject] = [at("xml:id"), at("ref"), at("text"), at(hebrew ? "strongnumberx" : "strong"), at(hebrew ? "participantref" : "referent"), at("subjref")];
  const rows: MaculaRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    const place = /^([1-3A-Z][A-Z]{2}) (\d+):(\d+)!(\d+)/.exec(cells[ref] ?? "");
    if (!place) continue;
    const number = /^(\d+)([a-z]?)$/.exec((cells[strong] ?? "").trim());
    rows.push({
      id: (cells[id] ?? "").replace(/^[on]/, ""),
      book: place[1]!,
      chapter: Number(place[2]),
      verse: Number(place[3]),
      word: Number(place[4]),
      text: cells[text] ?? "",
      strong: number ? `${hebrew ? "H" : "G"}${number[1]!.padStart(4, "0")}${number[2]}` : "",
      refers: ids(cells[refers]),
      subject: ids(cells[subject]),
    });
  }
  return rows;
}

type Place = { chapter: number; verse: number };

/** How a target is written to be read: without the marks of the chant, which say nothing of who it is. */
const shown = (text: string) => text.normalize("NFC").replace(/[֑-ֽ֯׀׃]/g, "").trim();

/**
 * What is written for each book: for every verse, the words that point to others. `toOurs` moves a verse to the
 * numbering of the app's texts (the Hebrew table follows the Hebrew Bible). A word is told from another of its
 * verse that is written the same by which one it is, counted among all the words of the verse.
 */
export function referentFiles(rows: MaculaRow[], toOurs: (book: string, place: Place) => Place = (_book, place) => place): Map<string, Record<string, unknown[]>> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const files = new Map<string, Record<string, unknown[]>>();
  // The pieces of a word, in the order of the text.
  const words = new Map<string, MaculaRow[]>();
  for (const row of rows) {
    const key = `${row.book} ${row.chapter}:${row.verse}!${row.word}`;
    words.set(key, [...(words.get(key) ?? []), row]);
  }
  const seen = new Map<string, number>();
  for (const pieces of words.values()) {
    const first = pieces[0]!;
    const place = toOurs(first.book, first);
    const key = referentKey(pieces.map((piece) => piece.text).join(""));
    // Counted in the verse as we number it: two verses of theirs may be one of ours.
    const count = `${first.book} ${place.chapter}:${place.verse}|${key}`;
    const occurrence = seen.get(count) ?? 0;
    seen.set(count, occurrence + 1);
    const targets: unknown[] = [];
    for (const piece of pieces) {
      for (const [kind, list] of [["r", piece.refers], ["s", piece.subject]] as const) {
        for (const id of list) {
          const target = byId.get(id);
          // A group of words has no row of its own; a word that points to itself says nothing.
          if (!target || !target.text.trim() || pieces.includes(target)) continue;
          const where = toOurs(target.book, target);
          // Which piece of the word it is matters for a suffix («su» in «su casa»); a verb is the whole word.
          targets.push([kind, kind === "r" && pieces.length > 1 ? shown(piece.text) : "", where.chapter, where.verse, shown(target.text), target.strong]);
        }
      }
    }
    if (!key || !targets.length) continue;
    const file = files.get(first.book) ?? {};
    (file[`${place.chapter}:${place.verse}`] ??= []).push([key, occurrence, targets]);
    files.set(first.book, file);
  }
  return files;
}
