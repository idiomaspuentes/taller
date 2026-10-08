/**
 * What a verse has besides its words: a footnote, a cross reference, words marked in it (`\nd Jehová\nd*`,
 * `\add …\add*`, `\qs Selah\qs*`), a milestone. Whoever edits a verse sees and writes its words alone, and a verse
 * was written again from them alone: changing one word of a verse took its footnote with it.
 *
 * Here a verse is read as its words and what hangs on them (`readVerse`), and what hangs on them is carried to
 * the words of the verse as it is written again (`carryMarkup`): a note stays after the word it followed, a mark
 * around the words it was around. Nobody has to see a mark, or write one.
 */

/** Something of no width at a place in the text: a note, a milestone. It is never dropped. */
export type VerseAnchor = {
  /** Where it is, in the text of the verse. */
  at: number;
  /** The word it goes with: the one before it (a note), or the one after it (a milestone that opens). */
  side: "after" | "before";
  /** As it is written, from its `\` to the end of its closing mark. */
  raw: string;
  /** A footnote or a cross reference, which say something to the reader; a milestone does not. */
  note: boolean;
};

/** Words that are marked: `open` is written before the first of them, `close` after the last. */
export type VerseMark = { from: number; to: number; open: string; close: string };

export type VerseMarkup = {
  /** What the verse says, a line of text for each of its lines: what `at`, `from` and `to` count in. */
  text: string;
  anchors: VerseAnchor[];
  marks: VerseMark[];
};

export const NO_MARKUP: VerseMarkup = { text: "", anchors: [], marks: [] };

const WORD_FIRST = /^[\p{L}\p{N}\p{M}]/u;
const WORD_LAST = /[\p{L}\p{N}\p{M}]$/u;

/** A milestone ends in `\*`: read without its backslash, the attributes were left in the text. */
const ALIGNMENT = /\\zaln-(?:s\s*\|[^\\]*\\?\*|e\\?\*)/y;
const ALIGNED_WORD = /\\\+?w\s+([^\\|]*)(?:\|[^\\]*)?\\\+?w\*/y;
/** Any other milestone (`\ts\*`, `\qt-s |who="x"\*`) is a mark to its end. */
const MILESTONE = /\\([a-z]+\d*)(-[se])?(?:\s*\|[^\\]*)?\\\*/y;
const NOTE = /\\(fe|ef|ex|f|x)(?=\s)/y;
const CLOSE = /\\(\+?[a-zA-Z0-9-]+)\*/y;
const MARK = /\\(\+?[a-zA-Z0-9-]+)/y;
/** A line that is not of the text of a verse: a heading, a reference under it, a remark. */
const HEADING = /^(?:s\d?|ms\d?|mr|r|d|sp|cl|cd|rem)$/;

/** A line with a note in it, whatever else it has. */
export const HAS_NOTE = /\\(fe|ef|ex|f|x)\s[\s\S]*?\\\1\*/;

type Scan = VerseMarkup & { /** What each row says; empty for a row with no text. */ rows: string[] };

/**
 * A verse read row by row (a row for each of its lines; one row for a text that is read as a run): what it says,
 * and where each thing that is not text stands in it.
 *
 * - The marks of the alignment (`\zaln-s`, `\w`) are of the words themselves, and are not kept here: the
 *   alignment is lifted out and put back by its own writer.
 * - A note, a milestone and the two ends of a marked run of words take no room in the text. They were read as a
 *   space: «al \add pueblo\add*.» was «al pueblo .» for whoever edited it. Only between two letters do they still
 *   part them, as two words.
 * - Any other mark (the one that begins a paragraph, a heading with its line) parts two words and is not kept.
 */
export function readVerse(rows: string[]): Scan {
  let out = "";
  const texts: string[] = [];
  const anchors: VerseAnchor[] = [];
  const marks: (VerseMark & { name: string })[] = [];
  /** The marks that are open, the last one opened last. */
  const open: (VerseMark & { name: string })[] = [];
  /** What goes with the next word, to be told where that word begins. */
  let waiting: ((at: number) => void)[] = [];
  let rowStart = -1;
  let space = false;
  /** Something of no width stands right after the last word. */
  let glued = false;

  const word = (chunk: string) => {
    if (rowStart < 0) {
      if (out) out += "\n";
      rowStart = out.length;
    } else if (space || (glued && WORD_LAST.test(out) && WORD_FIRST.test(chunk))) {
      out += " ";
    }
    for (const place of waiting) place(out.length);
    waiting = [];
    out += chunk;
    space = false;
    glued = false;
  };
  const say = (text: string) => {
    for (const chunk of text.match(/\s+|\S+/g) ?? []) {
      if (/^\s/.test(chunk)) space = true;
      else word(chunk);
    }
  };

  rows.forEach((raw, row) => {
    rowStart = -1;
    space = false;
    glued = false;
    const closesAhead = (marker: string, from: number) => {
      const close = `\\${marker}*`;
      return raw.indexOf(close, from) >= 0 || rows.slice(row + 1).some((later) => later.includes(close));
    };
    let i = 0;
    while (i < raw.length) {
      const slash = raw.indexOf("\\", i);
      if (slash < 0) {
        say(raw.slice(i));
        break;
      }
      const at = (re: RegExp) => {
        re.lastIndex = slash;
        return re.exec(raw);
      };
      /** What a marked run says of itself before it closes (`\w gracia|lemma="grace"\w*`) is not of its text. */
      let attributes = "";
      if (slash > i) {
        let text = raw.slice(i, slash);
        const bar = open.length ? text.indexOf("|") : -1;
        const closing = bar >= 0 ? at(CLOSE) : null;
        if (closing && open.some((mark) => mark.name === closing[1]!.replace(/^\+/, ""))) {
          attributes = text.slice(bar);
          text = text.slice(0, bar);
        }
        say(text);
      }
      i = slash;
      let found: RegExpExecArray | null;
      if ((found = at(ALIGNMENT))) {
        i += found[0].length;
        continue;
      }
      if ((found = at(ALIGNED_WORD))) {
        say(found[1]!);
        i += found[0].length;
        continue;
      }
      if ((found = at(MILESTONE))) {
        i += found[0].length;
        if (found[1]!.startsWith("zaln")) continue;
        const anchor: VerseAnchor = { at: out.length, side: found[2] === "-s" ? "before" : "after", raw: found[0], note: false };
        anchors.push(anchor);
        if (anchor.side === "before") waiting.push((place) => (anchor.at = place));
        glued = true;
        continue;
      }
      if ((found = at(NOTE))) {
        const end = raw.indexOf(`\\${found[1]}*`, slash);
        if (end >= 0) {
          i = end + found[1]!.length + 2;
          anchors.push({ at: out.length, side: "after", raw: raw.slice(slash, i), note: true });
          glued = true;
          continue;
        }
      }
      if ((found = at(CLOSE))) {
        i += found[0].length;
        const name = found[1]!.replace(/^\+/, "");
        const depth = open.map((mark) => mark.name).lastIndexOf(name);
        // A closing mark that closes nothing parts two words, as any mark that is not kept does.
        if (depth < 0) {
          space = true;
          continue;
        }
        // Whatever was opened inside it and never closed ends here with it.
        open.splice(depth).forEach((mark, index) => {
          mark.to = out.length;
          mark.close = index === 0 ? attributes + found![0] : `${mark.open.trim()}*`;
        });
        glued = true;
        continue;
      }
      if ((found = at(MARK))) {
        i += found[0].length;
        const name = found[1]!.replace(/^\+/, "");
        if (HEADING.test(name) && (i >= raw.length || /\s/.test(raw[i]!))) {
          const end = raw.indexOf("\n", i);
          i = end < 0 ? raw.length : end;
          space = true;
          continue;
        }
        if (closesAhead(found[1]!, i)) {
          const mark = { from: -1, to: -1, open: `${found[0]} `, close: "", name };
          marks.push(mark);
          open.push(mark);
          waiting.push((place) => (mark.from = place));
          // The white space that ends the mark is of the mark.
          if (/\s/.test(raw[i] ?? "")) i += 1;
          glued = true;
          continue;
        }
        space = true;
        continue;
      }
      say("\\");
      i += 1;
    }
    texts.push(rowStart < 0 ? "" : out.slice(rowStart));
  });
  for (const place of waiting) place(out.length);
  return {
    rows: texts,
    text: out,
    anchors,
    // A mark around no word (never closed, or with nothing in it) is not one.
    marks: marks.filter((mark) => mark.from >= 0 && mark.to > mark.from).map(({ from, to, open: opens, close }) => ({ from, to, open: opens, close })),
  };
}

/** What a piece of USFM says, as one run of text. */
export function readText(usfm: string): string {
  return usfm.includes("\\") ? readVerse([usfm]).text : usfm.replace(/\s+/g, " ").trim();
}

/** Verses read as one (two that are joined, the two parts of `\v 10a` and `\v 10b`): what each has, at its place in the text of all. */
export function joinMarkup(parts: VerseMarkup[]): VerseMarkup {
  if (parts.length === 1) return parts[0]!;
  const joined: VerseMarkup = { text: "", anchors: [], marks: [] };
  for (const part of parts) {
    const shift = joined.text && part.text ? joined.text.length + 1 : joined.text.length;
    if (part.text) joined.text += (joined.text ? "\n" : "") + part.text;
    joined.anchors.push(...part.anchors.map((anchor) => ({ ...anchor, at: anchor.at + shift })));
    joined.marks.push(...part.marks.map((mark) => ({ ...mark, from: mark.from + shift, to: mark.to + shift })));
  }
  return joined;
}

/**
 * Where each word of a text is in another text of the same verse, or -1 for a word that is not in it: the longest
 * run of words both have, in order.
 */
export function keptWords(before: string[], after: string[]): number[] {
  const run = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0));
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      run[i]![j] = before[i] === after[j] ? run[i + 1]![j + 1]! + 1 : Math.max(run[i + 1]![j]!, run[i]![j + 1]!);
    }
  }
  const at = new Array<number>(before.length).fill(-1);
  for (let i = 0, j = 0; i < before.length && j < after.length; ) {
    if (before[i] === after[j]) at[i++] = j++;
    else if (run[i + 1]![j]! >= run[i]![j + 1]!) i++;
    else j++;
  }
  return at;
}

type Token = { text: string; start: number; end: number };

/** Punctuation that ends what is before it. */
const CLOSES = /^[.,;:!?…»”’)\]}]$/;

/** A word, or a sign of punctuation on its own: a note that follows «Jesús,» may stand before its comma or after it. */
function tokensOf(text: string): Token[] {
  return [...text.matchAll(/[\p{L}\p{N}\p{M}]+|[^\s\p{L}\p{N}\p{M}]/gu)].map((found) => ({ text: found[0], start: found.index!, end: found.index! + found[0].length }));
}

/** A text of a verse beside the text it had before: where what the old one had goes in the new one. */
function carrier(was: string, now: string) {
  const old = tokensOf(was);
  const next = tokensOf(now);
  const at = keptWords(old.map((token) => token.text), next.map((token) => token.text));
  /** The stretch that was written again around a word that is gone: the kept words on each side, and what stands between them now. */
  const stretch = (place: number) => {
    let left = place - 1;
    while (left >= 0 && at[left]! < 0) left--;
    let right = place;
    while (right < old.length && at[right]! < 0) right++;
    return { left, right, from: left >= 0 ? at[left]! + 1 : 0, to: right < old.length ? at[right]! : next.length };
  };

  /**
   * Where something of no width goes. It stands between two words, and goes with the one it was beside while that
   * word is kept: what is written between two kept words is not of either. In a stretch that was written again it
   * goes with the new word that stands as far into the stretch as its own word did (as `textInLines` breaks the
   * lines of a verse): a word changed for another keeps its note, and a word taken out leaves it to the one
   * before. A verse that had no word at all has its notes at its end.
   */
  const anchor = (offset: number, side: "after" | "before"): number => {
    // What follows a word counts the words that begin before it; what leads a word, those that end before it.
    const place = old.filter((token) => (side === "after" ? token.start < offset : token.end <= offset)).length;
    const { left, right, from, to } = stretch(place);
    const gone = right - left - 1;
    // How many of the new words of the stretch stand before it: a note that followed a word still follows one.
    const into = gone ? ((to - from) * (place - left - 1)) / gone : 0;
    let landed = !old.length ? next.length : gone ? from + (side === "after" ? Math.ceil(into) : Math.floor(into)) : side === "after" ? from : to;
    // A comma or a full stop written against the word a note follows is of that word: the note follows it too,
    // as it does in the texts this is translated from («Jesús,¹»).
    if (side === "after" && !gone && landed > 0) {
      while (landed < to && CLOSES.test(next[landed]!.text) && next[landed]!.start === next[landed - 1]!.end) landed++;
    }
    if (side === "after") return landed > 0 ? next[landed - 1]!.end : 0;
    return landed < next.length ? next[landed]!.start : now.length;
  };

  /**
   * What a marked run of words is around now, or null when nothing is left of it. Its words that are kept are
   * still marked, with whatever was written between them. Where its words were written again, the new ones are
   * marked when they stand for marked words alone (a name written another way), or word for word with a
   * neighbour on each side at most («de Jehová» for «del Señor»). Otherwise they are words nobody marked: a mark
   * on the wrong word is in the book for good, since nobody sees it here to take it off, and a verse written all
   * over again in other words has none, however many words it has.
   */
  const run = (from: number, to: number): { from: number; to: number } | null => {
    const first = old.findIndex((token) => token.end > from);
    const last = old.filter((token) => token.start < to).length - 1;
    if (first < 0 || last < first) return null;
    const mine: number[] = [];
    for (let index = first; index <= last; ) {
      if (at[index]! >= 0) {
        mine.push(at[index++]!);
        continue;
      }
      const gap = stretch(index);
      const beside = Math.max(0, first - gap.left - 1) + Math.max(0, gap.right - 1 - last);
      const within = !beside;
      const wordForWord = beside <= 2 && gap.to - gap.from === gap.right - gap.left - 1;
      if (within) for (let word = gap.from; word < gap.to; word++) mine.push(word);
      else if (wordForWord) for (let word = index; word < gap.right && word <= last; word++) mine.push(gap.from + word - gap.left - 1);
      index = gap.right;
    }
    if (!mine.length) return null;
    return { from: next[Math.min(...mine)]!.start, to: next[Math.max(...mine)]!.end };
  };

  return { anchor, run, words: next };
}

/**
 * The lines of a verse as they are written: its words as they are now, with what the verse had besides its words.
 * A note is never dropped: when the word it followed is gone it follows the one before. A mark is dropped only
 * when nothing is left of what it was around. A mark that would run over a line break is closed at the end of the
 * line and opened again in the next: a marked run of words ends with its paragraph.
 */
export function carryMarkup(kept: VerseMarkup, lines: string[]): string[] {
  if (!kept.anchors.length && !kept.marks.length) return lines;
  const text = lines.join("\n");
  const carry = carrier(kept.text, text);
  let start = 0;
  const bounds = lines.map((line) => {
    const from = start;
    start += line.length + 1;
    return { from, to: from + line.length };
  });
  /** At one place: the marks that close (the inner one first), what has no width, the marks that open (the outer one first). */
  const written: { at: number; rank: number; first: number; second: number; raw: string }[] = [];
  kept.anchors.forEach((anchor, index) => written.push({ at: carry.anchor(anchor.at, anchor.side), rank: 1, first: index, second: 0, raw: anchor.raw }));
  kept.marks.forEach((mark, index) => {
    const around = carry.run(mark.from, mark.to);
    if (!around) return;
    for (const line of bounds) {
      const begins = Math.max(around.from, line.from);
      const ends = Math.min(around.to, line.to);
      if (begins >= ends) continue;
      written.push({ at: begins, rank: 2, first: -ends, second: index, raw: mark.open });
      written.push({ at: ends, rank: 0, first: -begins, second: -index, raw: mark.close });
    }
  });
  written.sort((a, b) => a.at - b.at || a.rank - b.rank || a.first - b.first || a.second - b.second);
  return bounds.map((line) => {
    let out = "";
    let cursor = line.from;
    for (const piece of written) {
      if (piece.at < line.from || piece.at > line.to) continue;
      out += text.slice(cursor, piece.at) + piece.raw;
      cursor = piece.at;
    }
    return out + text.slice(cursor, line.to);
  });
}

/** What is left of a verse that says nothing any more: its notes, which may be all that is to be said of it. */
export function markupAlone(kept: VerseMarkup): string {
  return kept.anchors.map((anchor) => anchor.raw).join("");
}

export type VerseNote = {
  kind: "footnote" | "crossref";
  /** What the note says, as a reader has it. */
  says: string;
  /** The word it follows; none for a note that stands before the first word of its verse. */
  after: string;
};

/** What a note says: without its caller (`+`), the reference of its verse (`\fr 1:5`) and its marks. */
function noteSays(raw: string): string {
  const inner = raw
    .replace(/^\\[a-z]+\s+/, "")
    .replace(/\\[a-z]+\*$/, "")
    .replace(/^[^\s\\]+\s+/, "")
    .replace(/\\(?:fr|xo|fv)\s+[^\\]*/g, " ")
    .replace(/\\(?:fr|xo|fv)\*/g, " ");
  return readText(inner);
}

/**
 * The notes of a verse, and the word each follows in a text of it: the text as it is being written, to show
 * where a note will be once it is saved.
 */
export function verseNotes(kept: VerseMarkup, text = kept.text): VerseNote[] {
  const notes = kept.anchors.filter((anchor) => anchor.note);
  if (!notes.length) return [];
  const carry = carrier(kept.text, text);
  const words = carry.words.filter((token) => WORD_FIRST.test(token.text));
  return notes.map((note) => {
    const at = carry.anchor(note.at, note.side);
    return {
      kind: /^\\e?x\s/.test(note.raw) ? ("crossref" as const) : ("footnote" as const),
      says: noteSays(note.raw),
      after: words.filter((token) => token.end <= at).pop()?.text ?? "",
    };
  });
}
