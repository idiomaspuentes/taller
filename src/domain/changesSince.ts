/**
 * What changed between two states of a file of the group's work (a text or a help), piece by piece: a verse of the
 * text, a row of a help. Pure: the loader reads the two states (a tag and the draft, or two tags) and this says
 * which pieces are different. It is what «Qué cambió» shows for a phase and for a delivered subtarea.
 */
import { reviewItems, type ReviewItem } from "./reviewItems";
import { plainWords } from "./unitPublish";
import { listVerseSpans, type RefRange } from "./usfmEdit";

const isText = (filename: string) => /\.(usfm|sfm)$/i.test(filename);
const isTable = (filename: string) => /\.tsv$/i.test(filename);

/** Whether «what changed» can be told piece by piece for this file. Articles (one file each) are not covered. */
export function comparable(filename: string): boolean {
  return isText(filename) || isTable(filename);
}

function tableChapters(tsv: string): number[] {
  const lines = tsv.split(/\r?\n/);
  const at = (lines[0] ?? "").split("\t").findIndex((cell) => cell.trim().toLowerCase() === "reference");
  if (at < 0) return [];
  return lines.slice(1).flatMap((line) => {
    const m = (line.split("\t")[at] ?? "").trim().match(/^(\d+):\d+/);
    return m ? [Number(m[1])] : [];
  });
}

const WHOLE = (chapter: number): RefRange => ({ chapter, from: 0, to: 9999 });

/**
 * The pieces that are not the same in `now` as in `before`, in the order of the book. With `range`, only the pieces
 * of that passage. A verse is compared by its words: marks that say how it is aligned or formatted are not a change
 * of the text.
 */
export function changesBetween(params: { filename: string; before: string; now: string; range?: RefRange | null }): ReviewItem[] {
  const { filename, before, now } = params;
  if (!comparable(filename)) return [];
  const chapters = params.range
    ? [params.range.chapter]
    : [...new Set(isText(filename) ? [...listVerseSpans(now), ...listVerseSpans(before)].map((span) => span.chapter) : [...tableChapters(now), ...tableChapters(before)])].sort((a, b) => a - b);
  const out: ReviewItem[] = [];
  for (const chapter of chapters) {
    const range = params.range ?? WHOLE(chapter);
    for (const item of reviewItems({ filename, now, before, range })) {
      const was = isText(filename) ? plainWords(item.before) : item.before;
      const is = isText(filename) ? plainWords(item.now) : item.now;
      if (was === is) continue;
      out.push({ ...item, before: was, now: is, state: !is ? "removed" : !was ? "new" : "changed" });
    }
  }
  return out;
}

/** How a resource of a phase can be compared, from which of its phases already left a mark. */
export type PhaseCompare =
  /** The phase closed: from the mark before it to its own. */
  | { status: "closed"; beforeMark: number | null; nowMark: number }
  /** The phase is open and the one before it is closed (or there is none): from that mark to the draft of today. */
  | { status: "open"; beforeMark: number | null }
  /** An earlier phase is still open: what this one changed cannot be told apart from what that one is changing. */
  | { status: "waiting" };

/**
 * `marked[i]`: whether phase `i` (of those that work on the resource, in order) left its mark. For phase `at`, what
 * to compare; the indexes are positions in `marked`, `null` meaning what is published.
 */
export function phaseCompare(marked: boolean[], at: number): PhaseCompare {
  const earlier = marked.slice(0, at);
  const beforeMark = earlier.lastIndexOf(true);
  if (marked[at]) return { status: "closed", beforeMark: beforeMark >= 0 ? beforeMark : null, nowMark: at };
  if (earlier.some((mark) => !mark)) return { status: "waiting" };
  return { status: "open", beforeMark: beforeMark >= 0 ? beforeMark : null };
}
