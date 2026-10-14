/**
 * The reason of a proposal as something to open, not only to read: the words of the original it quotes are the
 * words of the verse, and open what they mean; the notes it names open the note. A reason that says «el hebreo dice
 * בְּאֵימָה עֲלֵיהֶם, y la nota n3m4…» was checked by looking for the word and the note in another screen.
 */

export type ReasonPiece =
  | { kind: "text"; text: string; strong?: true }
  /** A word of the original; `match` is its place among the words it was looked for in, or -1 when not found. */
  | { kind: "word"; text: string; match: number; strong?: true }
  | { kind: "note"; text: string; id: string; strong?: true }
  /** An Academy article, by its path («translate/figs-metaphor»). */
  | { kind: "article"; text: string; path: string; strong?: true };

/** Hebrew (with Aramaic, which is written the same) or Greek, without the marks two writings of a word may differ in. */
export function originalKey(word: string): string {
  return word
    .normalize("NFD")
    .replace(/[֑-ֽ֯׀׃׆⁠‌‍]/g, "")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[׳״'’.,;:·!?«»()\[\]]/g, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
    .normalize("NFC");
}

/** The same with no vowels: what is left to find a word quoted without its points, or pointed otherwise. */
export function consonantKey(word: string): string {
  return originalKey(word).normalize("NFD").replace(/[ְ-ׇ]/g, "");
}

/** Where a word of the original is among some words: by its points first, then by its letters alone. */
export function findOriginal(word: string, among: string[]): number {
  const key = originalKey(word);
  if (!key) return -1;
  const exact = among.findIndex((other) => originalKey(other) === key);
  if (exact >= 0) return exact;
  const bare = consonantKey(word);
  const loose = among.map((other, at) => (consonantKey(other) === bare ? at : -1)).filter((at) => at >= 0);
  return loose.length === 1 ? loose[0]! : -1;
}

// A word of the original: Hebrew letters and points (not the maqaf, which joins two words), or Greek.
const ORIGINAL = "[\\u0591-\\u05BD\\u05BF-\\u05F4\\uFB1D-\\uFB4F\\u2060\\u0370-\\u03FF\\u1F00-\\u1FFF]+";
/**
 * The words a reason names notes with («nota n3m4», «notas d9rn, fr03 y vvzw»), in every language the app has: a
 * reason written in Portuguese is read in Spanish too.
 */
export type NoteWords = { note: string[]; and: string[] };
const SPANISH: NoteWords = { note: ["nota", "notas"], and: ["y"] };

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const listJoin = (words: NoteWords) => [",", ...words.and.map(escape)].join("|");
const patterns = new Map<string, RegExp>();

// The ids after a word for notes; an Academy article by its path («translate/figs-metaphor»), the same in every
// language; and a note's id that has a figure, alone.
function piecesPattern(words: NoteWords): RegExp {
  const key = JSON.stringify(words);
  if (!patterns.has(key)) {
    const note = words.note.map(escape).sort((a, b) => b.length - a.length).join("|");
    patterns.set(key, new RegExp(`(\\b(?:${note})\\s+)([a-z0-9]{4}(?:\\s*(?:${listJoin(words)})\\s*[a-z0-9]{4})*)\\b|(${ORIGINAL})|\\b((?:translate|checking|intro|process)/[a-z0-9-]+[a-z0-9])|\\b([a-z0-9]*\\d[a-z0-9]*)\\b`, "giu"));
  }
  return new RegExp(patterns.get(key)!);
}

function piecesOf(text: string, strong: boolean, among: string[], notes: Set<string>, words: NoteWords): ReasonPiece[] {
  const out: ReasonPiece[] = [];
  const flag = strong ? { strong: true as const } : {};
  const plain = (value: string) => {
    if (!value) return;
    const last = out[out.length - 1];
    if (last && last.kind === "text") last.text += value;
    else out.push({ kind: "text", text: value, ...flag });
  };
  let from = 0;
  const joiner = new RegExp(`(\\s*(?:${listJoin(words)})\\s*)`, "i");
  for (const match of text.matchAll(piecesPattern(words))) {
    const at = match.index ?? 0;
    plain(text.slice(from, at));
    from = at + match[0].length;
    if (match[2] !== undefined) {
      // «nota » and then each id, the ones the book has a note for to open.
      plain(match[1]!);
      for (const part of match[2].split(joiner)) {
        if (notes.has(part)) out.push({ kind: "note", text: part, id: part, ...flag });
        else plain(part);
      }
    } else if (match[3] !== undefined) {
      out.push({ kind: "word", text: match[3], match: findOriginal(match[3], among), ...flag });
    } else if (match[4] !== undefined) {
      out.push({ kind: "article", text: match[4], path: match[4].toLowerCase(), ...flag });
    } else if (match[5] !== undefined && match[5].length === 4 && notes.has(match[5])) {
      out.push({ kind: "note", text: match[5], id: match[5], ...flag });
    } else {
      plain(match[0]);
    }
  }
  plain(text.slice(from));
  return out;
}

/**
 * A reason in paragraphs of pieces: what is written in bold (`**…**`) stays so, the words of the original are found
 * among `among` (the words of the verse, then of its chapter), and the ids of `notes` are notes to open.
 */
export function reasonPieces(text: string, among: string[], notes: Set<string>, words: NoteWords = SPANISH): ReasonPiece[][] {
  return text
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\*\*(.+?)\*\*/).flatMap((part, index) => piecesOf(part, index % 2 === 1, among, notes, words)));
}
