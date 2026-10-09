/**
 * Who a word of the original is about: the noun a pronoun stands for, and for a verb, who does it and to whom.
 * The answers are those of MACULA (Clear-Bible/macula-hebrew and macula-greek, by Biblica, CC BY 4.0), reshaped
 * by `scripts/build-referents.mts` into one file per book, in the numbering the app's texts use.
 */

/**
 * `refers`: what a pronoun or a suffix stands for. `subject`: who a verb speaks of when its sentence does not
 * name them and MACULA gives the verb no frame. The others are the places of a verb's frame: `causer` makes it
 * happen (the one who has another do it), `agent` does it, `patient` is the one it is done to, `other` takes part
 * in some other way.
 */
export type ReferentKind = "refers" | "subject" | "causer" | "agent" | "patient" | "other";

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

const KINDS: Record<string, ReferentKind> = { r: "refers", s: "subject", c: "causer", a: "agent", p: "patient", o: "other" };

/** The order the questions about a word are answered in: who is behind it, who does it, to whom. */
export const REFERENT_ORDER: ReferentKind[] = ["causer", "agent", "subject", "patient", "other", "refers"];

/**
 * A file as it is served. The words pointed to are written once (`words`, as `[text, strong]`), since a book
 * names the same few people again and again, and a target is `[kind, piece, chapter, verse, word]`, with chapter
 * 0 for the verse the word itself is in:
 * `{ words: [["יוֹנָה", "H3124"]], verses: { "1:17": [["key", 0, [["r", "ו", 1, 15, 0]]]] } }`.
 */
export function normalizeReferentFile(raw: unknown): ReferentFile | null {
  const file = raw as { words?: unknown; verses?: unknown } | null;
  const rows = file?.verses;
  const table = Array.isArray(file?.words) ? (file.words as unknown[]) : [];
  if (!rows || typeof rows !== "object") return null;
  const verses: Record<string, ReferentWord[]> = {};
  for (const [place, words] of Object.entries(rows as Record<string, unknown>)) {
    const here = /^(\d+):(\d+)$/.exec(place);
    if (!here || !Array.isArray(words)) continue;
    const kept: ReferentWord[] = [];
    for (const word of words) {
      if (!Array.isArray(word) || typeof word[0] !== "string" || !Array.isArray(word[2])) continue;
      const targets = (word[2] as unknown[]).flatMap((row): ReferentTarget[] => {
        if (!Array.isArray(row)) return [];
        const [kind, piece, chapter, verse, index] = row as [string, string, number, number, number];
        const named = table[index];
        const [text, strong] = Array.isArray(named) ? (named as [string, string]) : ["", ""];
        if (!KINDS[kind] || typeof text !== "string" || !text || !Number.isFinite(chapter) || !Number.isFinite(verse)) return [];
        return [{ kind: KINDS[kind], ...(piece ? { piece } : {}), chapter: chapter || Number(here[1]), verse: chapter ? verse : Number(here[2]), text, strong: /^[HG]\d+[a-z]?$/.test(strong ?? "") ? strong : "" }];
      });
      // In the order the questions are asked, whatever order the frame was written in.
      targets.sort((a, b) => REFERENT_ORDER.indexOf(a.kind) - REFERENT_ORDER.indexOf(b.kind));
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
  /** The frame of a verb: each place (`A0`, `A1`, `A2`, `AA`) with the words that fill it. */
  frame: [string, string[]][];
};

// The Greek table writes an id with the letter its rows begin with (`n40001002014`); the Hebrew one, without.
const ids = (cell: string | undefined) => (cell ?? "").split(/[\s;]+/).map((id) => id.replace(/^[on]/, "")).filter(Boolean);

/** «A0:n40001002001 A1:n40001002004;n40001002009» (Greek), «A0:010010010031; A1:010010010052;» (Hebrew). */
const frameOf = (cell: string | undefined) => [...(cell ?? "").matchAll(/([A-Z]+\d*):([^A-Z]*)/g)].map((part): [string, string[]] => [part[1]!, ids(part[2])]);

/**
 * The rows of one of MACULA's tables (`ref` is «GEN 1:11!13»). The Hebrew table calls the Strong's number
 * `strongnumberx` and what a pronoun stands for `participantref`; the Greek one, `strong` and `referent`.
 */
export function maculaRows(tsv: string, hebrew: boolean): MaculaRow[] {
  const lines = tsv.split(/\r?\n/);
  const head = lines[0]!.split("\t");
  const at = (name: string) => head.indexOf(name);
  const [id, ref, text, strong, refers, subject, frame] = [at("xml:id"), at("ref"), at("text"), at(hebrew ? "strongnumberx" : "strong"), at(hebrew ? "participantref" : "referent"), at("subjref"), at("frame")];
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
      frame: frame < 0 ? [] : frameOf(cells[frame]),
    });
  }
  return rows;
}

type Place = { chapter: number; verse: number };

/** How a target is written to be read: without the marks of the chant, which say nothing of who it is. */
const shown = (text: string) => text.normalize("NFC").replace(/[֑-ֽ֯׀׃]/g, "").trim();

// `AA` is the one who has another do it (a causative: «Yahweh hurled a wind» is «made a wind fall»).
const PLACES: Record<string, string> = { AA: "c", A0: "a", A1: "p" };

/** What is written for a book: the words pointed to, once each, and the words of each verse that point to them. */
export type ReferentBook = { words: [string, string][]; verses: Record<string, unknown[]> };

/**
 * What is written for each book. `toOurs` moves a verse to the numbering of the app's texts (the Hebrew table
 * follows the Hebrew Bible). A word is told from another of its verse that is written the same by which one it
 * is, counted among all the words of the verse.
 *
 * In a verb's frame, a place a pronoun fills is given as what the pronoun stands for («lo dejó» → Tito): that is
 * what a translator has to know. And the subject the sentence leaves unsaid is left out when the frame already
 * names it, which is nearly always.
 */
export function referentFiles(rows: MaculaRow[], toOurs: (book: string, place: Place) => Place = (_book, place) => place): Map<string, ReferentBook> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const files = new Map<string, ReferentBook>();
  const tables = new Map<string, Map<string, number>>();
  // The pieces of a word, in the order of the text.
  const words = new Map<string, MaculaRow[]>();
  for (const row of rows) {
    const key = `${row.book} ${row.chapter}:${row.verse}!${row.word}`;
    words.set(key, [...(words.get(key) ?? []), row]);
  }
  /** The words an id stands for: itself, or, for a pronoun in a frame, what it stands for. */
  const resolved = (id: string, hop: boolean): MaculaRow[] => {
    const target = byId.get(id);
    if (!target) return [];
    const behind = hop ? target.refers.map((other) => byId.get(other)).filter((row): row is MaculaRow => Boolean(row?.text.trim())) : [];
    return behind.length ? behind : [target];
  };
  const seen = new Map<string, number>();
  for (const pieces of words.values()) {
    const first = pieces[0]!;
    const place = toOurs(first.book, first);
    const key = referentKey(pieces.map((piece) => piece.text).join(""));
    // Counted in the verse as we number it: two verses of theirs may be one of ours.
    const count = `${first.book} ${place.chapter}:${place.verse}|${key}`;
    const occurrence = seen.get(count) ?? 0;
    seen.set(count, occurrence + 1);
    const file = files.get(first.book) ?? { words: [], verses: {} };
    const table = tables.get(first.book) ?? new Map<string, number>();
    const targets: unknown[] = [];
    const written = new Set<string>();
    // Whom the frame of the word already names: the subject left unsaid, and the suffix that is the verb's own
    // object («me rodearon»), would say the same person a second time.
    const framed = new Set(pieces.flatMap((piece) => piece.frame.flatMap(([, list]) => list.flatMap((id) => resolved(id, true)))).map((row) => row.id));
    for (const piece of pieces) {
      const asked: [string, MaculaRow[]][] = piece.frame.map(([role, list]) => [PLACES[role] ?? "o", list.flatMap((id) => resolved(id, true))]);
      asked.push(["s", piece.subject.flatMap((id) => resolved(id, false)).filter((row) => !framed.has(row.id))]);
      asked.push(["r", piece.refers.flatMap((id) => resolved(id, false)).filter((row) => !framed.has(row.id))]);
      for (const [kind, found] of asked) {
        for (const target of found) {
          // A group of words has no row of its own; a word that points to itself says nothing.
          if (!target.text.trim() || pieces.includes(target) || written.has(`${kind}|${target.id}`)) continue;
          written.add(`${kind}|${target.id}`);
          const where = toOurs(target.book, target);
          const name = JSON.stringify([shown(target.text), target.strong]);
          if (!table.has(name)) {
            table.set(name, file.words.length);
            file.words.push([shown(target.text), target.strong]);
          }
          const same = where.chapter === place.chapter && where.verse === place.verse;
          // Which piece of the word it is matters for a suffix («su» in «su casa»); a verb is the whole word.
          targets.push([kind, kind === "r" && pieces.length > 1 ? shown(piece.text) : "", same ? 0 : where.chapter, same ? 0 : where.verse, table.get(name)]);
        }
      }
    }
    if (!key || !targets.length) continue;
    (file.verses[`${place.chapter}:${place.verse}`] ??= []).push([key, occurrence, targets]);
    files.set(first.book, file);
    tables.set(first.book, table);
  }
  return files;
}
