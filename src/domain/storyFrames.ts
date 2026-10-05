/**
 * The frames of the Bible stories an article quotes as examples.
 *
 * An article of the words ends with examples from the stories: «**[1:1](rc://en/tn/help/obs/01/01)** **God** created
 * the universe…». Each is a sentence of a frame, cut and retouched by hand, so nothing can write its translation:
 * the frame the team has already translated says more, and says it in other words. Whoever translates the example
 * is shown that frame whole, beside the source, and marks in it the part that says what the example says, by
 * touching its first word and its last: the example is rarely a whole sentence of the frame, so the part is marked
 * to the word. On a phone that is all the translating there is to do, with nothing typed. Pure.
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

/**
 * A frame put where its example is written: the example keeps its number (a link, for any language) and the frame
 * follows as one paragraph. It is where the translator starts from, to cut it down to what the example says.
 */
export function storyExample(sourcePiece: string, frame: string): string {
  const text = frame.replace(/\s*\n\s*/g, " ").trim();
  const lead = LEAD_RE.exec(sourcePiece);
  if (!lead) return text;
  // `**`, however the source marks it (`__`): it is the mark the box this is written in reads as bold.
  return `${lead[1] ?? ""}**${lead[2]!.replace(/rc:\/\/[^/)\s]+\//i, "rc://*/")}** ${text}`;
}

/** A part of a frame: the places of its first word and its last, among the words of the frame. */
export type WordRange = [first: number, last: number];

/** A frame as the words it is made of, each with the marks written against it («principio.», «“¡Qué»). */
export function frameWords(frame: string): string[] {
  return frame.trim().split(/\s+/).filter(Boolean);
}

/** A part of the frame as text. A comma or a colon left hanging at its end, where the frame went on, is dropped. */
export function pickedText(words: string[], [first, last]: WordRange): string {
  return words.slice(first, last + 1).join(" ").replace(/[,;:]+$/, "");
}

/**
 * A word of the frame was touched: the end of the marked part that is nearer goes there. So the first touch marks
 * one word and the second stretches the part to another; touching outside it stretches it further, touching inside
 * it draws the nearer end in, and touching the word at an end lets go of that word. The only word marked, touched
 * again, leaves nothing marked.
 */
export function touchWord(range: WordRange | null, index: number): WordRange | null {
  if (!range) return [index, index];
  const [first, last] = range;
  if (first === last) return index === first ? null : index < first ? [index, last] : [first, index];
  if (index === first) return [first + 1, last];
  if (index === last) return [first, last - 1];
  if (index < first) return [index, last];
  if (index > last) return [first, index];
  return index - first < last - index ? [index, last] : [first, index];
}

/**
 * What is marked in a frame: one part, or several when the example leaves something out between them («God …
 * the universe … in six days»). The parts are in the order of the frame and never touch; `active` is the one the
 * next touch moves.
 */
export type Marks = { parts: WordRange[]; active: number };

/** What stands for what an example leaves out between two parts: as its source writes it, three dots or one sign. */
export function gapOf(sourcePiece: string): string {
  return sourcePiece.includes("...") ? "..." : "…";
}

/** The parts marked, as the text of the example: each as the frame has it, with what was left out between them shown. */
export function marksText(words: string[], parts: WordRange[], gap = "…"): string {
  return parts.map((part) => pickedText(words, part)).join(` ${gap} `);
}

/**
 * A word of the frame was touched. It moves the part it is in or, outside them all, the active one (see
 * `touchWord`); parts that come to meet become one. `another`: the touch starts a part of its own instead, for an
 * example that leaves something out. `null` when nothing is left marked.
 */
export function touchMarks(marks: Marks | null, index: number, another = false): Marks | null {
  if (!marks?.parts.length) return { parts: [[index, index]], active: 0 };
  const inside = marks.parts.findIndex(([first, last]) => index >= first && index <= last);
  let parts: WordRange[];
  if (another && inside < 0) parts = [...marks.parts, [index, index]];
  else {
    const at = inside >= 0 ? inside : Math.min(marks.active, marks.parts.length - 1);
    const moved = touchWord(marks.parts[at]!, index);
    parts = marks.parts.flatMap((part, here) => (here === at ? (moved ? [moved] : []) : [part]));
  }
  if (!parts.length) return null;
  parts.sort((a, b) => a[0] - b[0]);
  const joined: WordRange[] = [];
  for (const part of parts) {
    const before = joined[joined.length - 1];
    // Two parts with nothing between them leave nothing out: they are one.
    if (before && part[0] <= before[1] + 1) before[1] = Math.max(before[1], part[1]);
    else joined.push([part[0], part[1]]);
  }
  // The part the touch was in or nearest to is the one the next touch moves.
  const distance = ([first, last]: WordRange) => (index < first ? first - index : index > last ? index - last : 0);
  const active = joined.reduce((best, part, here) => (distance(part) < distance(joined[best]!) ? here : best), 0);
  return { parts: joined, active };
}

/** Where a text is in the frame, as a part of it, looking from a word on. */
function partFrom(text: string, words: string[], from: number): WordRange | null {
  for (let first = from; first < words.length; first++) {
    if (!text.startsWith(words[first]!.replace(/[,;:]+$/, ""))) continue;
    for (let last = first; last < words.length; last++) {
      const picked = pickedText(words, [first, last]);
      if (picked === text) return [first, last];
      if (picked.length > text.length) break;
    }
  }
  return null;
}

/**
 * The parts of the frame a row holds, when what it holds is the number of the frame and parts of it, as marking
 * writes them. `null` when the row is empty or holds anything else: something a person wrote, or retouched.
 */
export function pickedRanges(draft: string, words: string[]): WordRange[] | null {
  const lead = LEAD_RE.exec(draft);
  const body = (lead ? draft.slice(lead[0].length) : "").replace(/\s+/g, " ").trim();
  if (!body) return null;
  // One part first: the frame itself may have dots in it.
  const whole = partFrom(body, words, 0);
  if (whole) return [whole];
  const parts: WordRange[] = [];
  for (const text of body.split(/\s*(?:…|\.{3})\s*/)) {
    const part = text ? partFrom(text, words, parts.length ? parts[parts.length - 1]![1] + 2 : 0) : null;
    if (!part) return null;
    parts.push(part);
  }
  return parts;
}
