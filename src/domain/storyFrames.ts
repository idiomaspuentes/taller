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

// ---------------------------------------------------------------- what the app proposes

/**
 * Measured on the 944 examples of the source's articles (October 2026): an example is one or two whole sentences of
 * its frame, lightly retouched (a name where the frame says «he»). A piece cut inside a sentence is about one in a
 * hundred, and three examples in all leave something out with dots. Nine frames in ten are cut into as many
 * sentences in the team's language as in the source's. So the app can find which sentences of the source frame an
 * example says, take the same ones from the team's frame, and propose them: whoever translates reads the proposal
 * beside the example and says it is right, instead of marking it word by word. Against 499 examples a team had
 * written by hand the proposal was the same sentence in 94 of 100.
 */

const SENTENCE_RE = /[^.!?]+(?:[.!?]+["'”’»)\]]*|$)/g;

/** A frame as its sentences, each as the frame writes it. */
export function frameSentences(frame: string): string[] {
  return (frame.replace(/\s+/g, " ").trim().match(SENTENCE_RE) ?? []).map((sentence) => sentence.trim()).filter(Boolean);
}

/** Sentences of a frame that follow one another: the places of the first and of the last. */
export type SentenceRun = [first: number, last: number];

const unaccented = (text: string) => text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
const EDGE_RE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/** The words of a text as they are compared: no marks, no accents, no capitals. */
function comparable(text: string): string[] {
  return unaccented(text.replace(/\*\*|__/g, "")).split(/\s+/).map((word) => word.replace(EDGE_RE, "")).filter(Boolean);
}

/** The share of the words of `a` that `b` has too, each counted once. */
function shared(a: string[], b: string[]): number {
  const have = new Map<string, number>();
  for (const word of b) have.set(word, (have.get(word) ?? 0) + 1);
  let n = 0;
  for (const word of a) {
    const left = have.get(word) ?? 0;
    if (!left) continue;
    n++;
    have.set(word, left - 1);
  }
  return a.length ? n / a.length : 0;
}

/**
 * Three words of four in common, counted both ways: the example has little the sentences do not say, and they have
 * little it leaves out. Lower, and a sentence that only shares its commonest words is proposed.
 */
const NEAR = 0.75;

/** What an example says: its text without the number of its frame and without marks. */
export function exampleText(sourcePiece: string): string {
  const lead = LEAD_RE.exec(sourcePiece);
  return (lead ? sourcePiece.slice(lead[0].length) : sourcePiece).replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim();
}

/** The run of sentences of a frame that says most nearly what a text says; `null` when none says it nearly enough. */
export function nearestSentences(text: string, frame: string): SentenceRun | null {
  const said = comparable(text);
  const all = frameSentences(frame).map(comparable);
  if (!said.length) return null;
  let best: { run: SentenceRun; score: number; size: number } | null = null;
  for (let first = 0; first < all.length; first++) {
    let span: string[] = [];
    for (let last = first; last < all.length; last++) {
      span = span.concat(all[last]!);
      const score = Math.min(shared(said, span), shared(span, said));
      // Of two runs that say it as nearly, the shorter.
      if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && span.length < best.size)) best = { run: [first, last], score, size: span.length };
    }
  }
  return best && best.score >= NEAR ? best.run : null;
}

/**
 * The sentences of the team's frame to propose for an example: those in the place of the sentences of the source
 * frame that the example says. `null` when the example is not near enough to any, or when the two frames are not
 * cut into as many sentences (a place then says nothing): the person chooses.
 */
export function proposedSentences(sourcePiece: string, sourceFrame: string, teamFrame: string): SentenceRun | null {
  if (!sourceFrame.trim() || !teamFrame.trim()) return null;
  const run = nearestSentences(exampleText(sourcePiece), sourceFrame);
  if (!run) return null;
  const theirs = frameSentences(sourceFrame).length;
  const ours = frameSentences(teamFrame).length;
  if (theirs === ours) return run;
  // An example that is its whole frame is the whole frame, however each language cuts it into sentences.
  return run[0] === 0 && run[1] === theirs - 1 && ours > 0 ? [0, ours - 1] : null;
}

/** The terms an article is about, from its title («llamar, llamado»): what its examples show in bold. */
export function termsOf(articleMd: string): string[] {
  const title = /^#\s+(.+)$/m.exec(articleMd)?.[1] ?? "";
  return title.split(",").map((term) => term.replace(/\*\*|__/g, "").trim()).filter(Boolean);
}

/**
 * The article's own word in bold where a text says it, as the source's examples have it (99 of 100 do). A term of
 * several words is looked for as it is; a term of one word, in any of its forms that begin as it does («ángel»,
 * «ángeles»), which is how nine in ten of the words a team had put in bold by hand were found. A short term is
 * only itself: «fe» is not the beginning of «feliz». What it misses (a verb that changes its stem) is put in bold
 * by hand.
 */
export function boldTerms(text: string, terms: string[]): string {
  const tokens = text.split(/(\s+)/);
  const words = tokens.map((token, at) => ({ token, at })).filter(({ token }) => /\S/.test(token));
  const bare = words.map(({ token }) => unaccented(token).replace(EDGE_RE, ""));
  const bold = new Array<boolean>(words.length).fill(false);
  for (const term of terms) {
    const parts = comparable(term);
    if (!parts.length) continue;
    if (parts.length > 1) {
      for (let at = 0; at + parts.length <= bare.length; at++) if (parts.every((part, n) => bare[at + n] === part)) parts.forEach((_, n) => (bold[at + n] = true));
      continue;
    }
    const word = parts[0]!;
    const stem = word.length < 4 ? null : word.slice(0, Math.max(4, Math.ceil(word.length * 0.5)));
    bare.forEach((mine, at) => {
      if (mine && (stem ? mine.startsWith(stem) : mine === word)) bold[at] = true;
    });
  }
  if (!bold.some(Boolean)) return text;
  const out = [...tokens];
  words.forEach(({ token, at }, n) => {
    if (!bold[n]) return;
    const [, before = "", core = "", after = ""] = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(token) ?? [];
    // Words in bold that follow one another are one stretch of bold, the space between them inside it.
    out[at] = `${before}${bold[n - 1] ? "" : "**"}${core}${bold[n + 1] ? "" : "**"}${after}`;
  });
  return out.join("");
}

/** Sentences of the team's frame as the text of an example, in the order of the frame, the article's word in bold. */
export function sentencesText(frame: string, picked: number[], terms: string[] = []): string {
  const all = frameSentences(frame);
  const text = [...new Set(picked)].sort((a, b) => a - b).map((at) => all[at]).filter(Boolean).join(" ");
  return boldTerms(text, terms);
}

/**
 * What a row holds, when it holds the number of the frame and whole sentences of it: which ones. `null` when the row
 * is empty or holds anything else (a piece of a sentence, something a person wrote).
 */
export function readSentences(draft: string, frame: string): number[] | null {
  let rest = exampleText(draft);
  if (!rest) return null;
  const picked: number[] = [];
  frameSentences(frame).forEach((sentence, at) => {
    if (!rest.startsWith(sentence)) return;
    picked.push(at);
    rest = rest.slice(sentence.length).trimStart();
  });
  return picked.length && !rest ? picked : null;
}
