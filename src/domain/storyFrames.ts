/**
 * The frames of the Bible stories an article quotes as examples.
 *
 * An article of the words ends with examples from the stories: «**[1:1](rc://en/tn/help/obs/01/01)** **God** created
 * the universe…». Each is a sentence of a frame, cut and retouched by hand, so nothing can write its translation:
 * the frame the team has already translated says more, and says it in other words. Whoever translates the example
 * is shown that frame whole, beside the source, a sentence to a line, and takes the sentences that say what the
 * example says by touching them: on a phone that is all the translating there is to do, with nothing typed. Pure.
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

/** A frame as the sentences it is made of: what is taken from it is one or several of them, whole. */
export function frameSentences(frame: string): string[] {
  const text = frame.replace(/\s*\n\s*/g, " ").trim();
  return (text.match(/[^.!?…]*[.!?…]+[”"’'»)\]]*|[^.!?…]+$/g) ?? []).map((sentence) => sentence.trim()).filter(Boolean);
}

/** Which sentences of the frame a row already has, word for word. */
export function takenSentences(draft: string, sentences: string[]): boolean[] {
  return sentences.map((sentence) => draft.includes(sentence));
}

/**
 * A sentence of the frame is taken into the row of its example, or given back.
 *
 * While the row holds nothing but sentences of the frame, it is written again from the ones taken, in the order the
 * frame has them, behind the number of the frame; with none left it is empty. Once somebody has written in it by
 * hand, what they wrote is theirs: a sentence taken goes after it, and one given back is only taken out.
 */
export function toggleSentence(sourcePiece: string, draft: string, sentences: string[], index: number): string {
  const sentence = sentences[index];
  if (!sentence) return draft;
  const taken = takenSentences(draft, sentences);
  const said = (flags: boolean[]) => sentences.filter((_, at) => flags[at]).join(" ");
  const lead = LEAD_RE.exec(draft);
  const untouched = !draft.trim() || (lead !== null && draft.slice(lead[0].length).replace(/\s+/g, " ").trim() === said(taken));
  if (untouched) {
    const next = taken.map((flag, at) => (at === index ? !flag : flag));
    return next.some(Boolean) ? storyExample(sourcePiece, said(next)) : "";
  }
  if (taken[index]) return draft.replace(sentence, "").replace(/[ \t]{2,}/g, " ").trimEnd();
  return `${draft.trimEnd()} ${sentence}`;
}
