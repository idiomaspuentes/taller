/**
 * A book's USFM cut by chapter. A tool works on a passage of one chapter, and the book it is read from may be large
 * (Matthew in aligned English is 3.6 MB): what is kept on the device and what is parsed is the chapter. Pure.
 */

/** What comes before the first chapter (the book's `\id`, its titles), and each chapter's own text. */
export type UsfmChapters = { header: string; chapters: Record<number, string> };

export function splitUsfmChapters(usfm: string): UsfmChapters {
  const marks = [...usfm.matchAll(/^[ \t]*\\c[ \t]+(\d+)\b/gm)];
  if (!marks.length) return { header: usfm, chapters: {} };
  const chapters: Record<number, string> = {};
  marks.forEach((mark, index) => {
    const end = index + 1 < marks.length ? marks[index + 1]!.index : usfm.length;
    chapters[Number(mark[1])] = usfm.slice(mark.index, end);
  });
  return { header: usfm.slice(0, marks[0]!.index), chapters };
}

/**
 * One chapter as a text that stands alone: the book's heading and that chapter, so its verses are still named by
 * the book («JUD 1:1») when it is parsed without the rest. Null when the book has no such chapter.
 */
export function chapterUsfm(parts: UsfmChapters, chapter: number): string | null {
  const body = parts.chapters[chapter];
  return body ? `${parts.header.replace(/\s*$/, "\n")}${body}` : null;
}
