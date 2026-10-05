/**
 * The frames of the Bible stories an article quotes as examples.
 *
 * An article of the words ends with examples from the stories: «**[1:1](rc://en/tn/help/obs/01/01)** **God** created
 * the universe…». Each is a piece of a frame, cut and retouched by hand, so nothing can write its translation: the
 * frame the team has already translated says more, and says it in other words. Whoever translates the example is
 * shown that frame whole, beside the source, and marks in it what the example says.
 *
 * It is marked to the word, a part at a time: two touches make a part, its first word and its last. An example is
 * rarely a whole sentence of the frame, and some are put together from pieces of it («God» from one sentence and
 * «created the universe» from the next) or leave something out between them («God … the universe … in six days»).
 * On a phone that is all the translating there is to do, with nothing typed. Pure.
 */

export type StoryRef = { story: number; frame: number };

const STORY_LINK = "\\[[^\\]]*\\]\\(rc:\\/\\/[^/)\\s]+\\/tn\\/help\\/obs\\/(\\d+)\\/(\\d+)\\)";

/** The frame a piece of an article points to, when it is an example from a story. */
export function storyRefOf(md: string): StoryRef | null {
  const found = new RegExp(STORY_LINK, "i").exec(md);
  return found ? { story: Number(found[1]), frame: Number(found[2]) } : null;
}

/** The stories an article quotes, each once, in the order it quotes them. */
export function storiesIn(md: string): number[] {
  return [...new Set([...md.matchAll(new RegExp(STORY_LINK, "gi"))].map((found) => Number(found[1])))];
}

/** Where a story is in the repository of the stories. */
export function storyPath(story: number): string {
  return `content/${String(story).padStart(2, "0")}.md`;
}

/**
 * The frames of a story as its file has them: the text under each picture, in order (the first frame is `[0]`).
 * The title above the first picture and the line that says where the story is from, under the last, are not frames.
 */
export function storyFrames(md: string): string[] {
  const parts = md.replace(/\r\n?/g, "\n").split(/^!\[[^\]]*\]\([^)]*\)[ \t]*$/m);
  return parts.slice(1).map((part, index, all) => (index === all.length - 1 ? part.replace(/\n+_[^\n]*_\s*$/, "") : part).trim());
}

/** The start of an example: its place in the list and the number of its frame, which is a link, in bold. */
const LEAD_RE = new RegExp(`^(\\s*(?:[*+-]|\\d+[.)])\\s+)?(?:\\*\\*|__)?(${STORY_LINK})(?:\\*\\*|__)?`, "i");

/** A text put where an example is written: behind the number of its frame, which is a link for any language. */
export function storyExample(sourcePiece: string, text: string): string {
  const said = text.replace(/\s*\n\s*/g, " ").trim();
  const lead = LEAD_RE.exec(sourcePiece);
  if (!lead) return said;
  // `**`, however the source marks it (`__`): it is the mark the box this is written in reads as bold.
  return `${lead[1] ?? ""}**${lead[2]!.replace(/rc:\/\/[^/)\s]+\//i, "rc://*/")}** ${said}`;
}

// ---------------------------------------------------------------- what is marked in a frame

/** A part of a frame: the places of its first word and its last, among the words of the frame. */
export type WordRange = [first: number, last: number];

/**
 * What is marked in a frame. The parts are in the order of the frame and never touch. `open` is the part that has
 * its first word and waits for its last (`null`: none); `current` is the one the arrows move, the last one made.
 * `dots`: what is left out between two parts is shown; otherwise they are read on, one after the other.
 */
export type Marks = { parts: WordRange[]; open: number | null; current: number; dots: boolean };

/** A frame as the words it is made of, each with the marks written against it («principio.», «“¡Qué»). */
export function frameWords(frame: string): string[] {
  return frame.trim().split(/\s+/).filter(Boolean);
}

/** A part of the frame as text. A comma or a colon left hanging at its end, where the frame went on, is dropped. */
export function pickedText(words: string[], [first, last]: WordRange): string {
  return words.slice(first, last + 1).join(" ").replace(/[,;:]+$/, "");
}

const isDots = (text: string) => text === "…" || text === "...";

/**
 * How an example shows what it leaves out, and whether it leaves anything out at all: read from its source. An
 * example with nothing left out is put together from the parts marked, read on («Dios» + «creó el universo»).
 */
export function dotsOf(sourcePiece: string): { sign: string; on: boolean } {
  const lead = LEAD_RE.exec(sourcePiece);
  const said = lead ? sourcePiece.slice(lead[0].length) : sourcePiece;
  return { sign: said.includes("...") ? "..." : "…", on: /…|\.{3}/.test(said) };
}

/** The parts marked, as the text of the example. */
export function marksText(words: string[], marks: Pick<Marks, "parts" | "dots">, sign = "…"): string {
  return marks.parts.map((part) => pickedText(words, part)).join(marks.dots ? ` ${sign} ` : " ");
}

/** The parts in the order of the frame; two with nothing between them leave nothing out, and are one. */
function joined(parts: WordRange[]): WordRange[] {
  const out: WordRange[] = [];
  for (const part of [...parts].sort((a, b) => a[0] - b[0])) {
    const before = out[out.length - 1];
    if (before && part[0] <= before[1] + 1) before[1] = Math.max(before[1], part[1]);
    else out.push([part[0], part[1]]);
  }
  return out;
}

const partAt = (parts: WordRange[], index: number) => parts.findIndex(([first, last]) => index >= first && index <= last);

/**
 * A word of the frame was touched. Two touches make a part: the first opens it on a word, the second closes it on
 * another (or on the same one, for a part of a single word), whichever of the two comes first in the frame. With no
 * part open, a touch on a part already made takes it away, and a touch anywhere else opens another. `null` when
 * nothing is left marked. `dots` is what a first part starts with (see `dotsOf`).
 */
export function touchMarks(marks: Marks | null, index: number, dots = false): Marks | null {
  if (!marks?.parts.length) return { parts: [[index, index]], open: 0, current: 0, dots };
  if (marks.open !== null) {
    const [first, last] = marks.parts[marks.open]!;
    const parts = joined(marks.parts.map((part, at) => (at === marks.open ? [Math.min(first, index), Math.max(last, index)] : part)));
    return { ...marks, parts, open: null, current: partAt(parts, index) };
  }
  const inside = partAt(marks.parts, index);
  if (inside >= 0) {
    const parts = marks.parts.filter((_, at) => at !== inside);
    return parts.length ? { ...marks, parts, open: null, current: Math.max(0, Math.min(parts.length - 1, marks.current - (inside <= marks.current ? 1 : 0))) } : null;
  }
  const parts = joined([...marks.parts, [index, index]]);
  const at = partAt(parts, index);
  // A word right beside a part became one with it: it is that part, open again for its other end.
  return { ...marks, parts, open: at, current: at };
}

/**
 * An end of the current part goes one word earlier or later. A finger does not always land on a short word («y»,
 * «el»); the arrows are big, and move a word at a time. A part never turns inside out, and one that comes to meet
 * its neighbour becomes one with it.
 */
export function nudgeMarks(marks: Marks, end: "first" | "last", by: -1 | 1, count: number): Marks {
  const part = marks.parts[marks.current];
  if (!part) return marks;
  const moved: WordRange = end === "first" ? [Math.max(0, Math.min(part[1], part[0] + by)), part[1]] : [part[0], Math.max(part[0], Math.min(count - 1, part[1] + by))];
  const parts = joined(marks.parts.map((other, at) => (at === marks.current ? moved : other)));
  return { ...marks, parts, open: null, current: partAt(parts, end === "first" ? moved[0] : moved[1]) };
}

/** The longest run of the frame, starting at `from` or after, that says the words of a text from `at` on. */
function runFrom(tokens: string[], at: number, words: string[], from: number): WordRange | null {
  let best: WordRange | null = null;
  for (let first = from; first < words.length; first++) {
    let n = 0;
    while (at + n < tokens.length && first + n < words.length && !isDots(tokens[at + n]!)) {
      const word = words[first + n]!;
      if (tokens[at + n] === word) n++;
      else {
        // The last word of a part has lost the comma the frame went on with: the run ends there.
        if (tokens[at + n] === word.replace(/[,;:]+$/, "")) n++;
        break;
      }
    }
    if (n && (!best || n > best[1] - best[0] + 1)) best = [first, first + n - 1];
  }
  return best;
}

/**
 * What a row holds, when it holds the number of the frame and parts of it as marking writes them: the parts, and
 * whether what is left out between them is shown. `null` when the row is empty or holds anything else: something a
 * person wrote, or retouched. A word the frame says twice is taken for the place that makes the longest part.
 */
export function readMarks(draft: string, words: string[]): Pick<Marks, "parts" | "dots"> | null {
  const lead = LEAD_RE.exec(draft);
  const body = (lead ? draft.slice(lead[0].length) : "").replace(/\s+/g, " ").trim();
  if (!body) return null;
  const tokens = body.split(" ");
  const parts: WordRange[] = [];
  let at = 0;
  while (at < tokens.length) {
    if (isDots(tokens[at]!)) {
      at++;
      continue;
    }
    const part = runFrom(tokens, at, words, parts.length ? parts[parts.length - 1]![1] + 2 : 0);
    if (!part) return null;
    parts.push(part);
    at += part[1] - part[0] + 1;
  }
  const read = { parts, dots: tokens.some(isDots) };
  // Written again from what was read, it has to be what the row holds: otherwise somebody has had a hand in it.
  return parts.length && ["…", "..."].some((sign) => marksText(words, read, sign) === body) ? read : null;
}
