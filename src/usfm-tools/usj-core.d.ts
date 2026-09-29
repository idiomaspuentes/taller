export type UsjDocument = {
  type: "USJ" | string;
  version?: string;
  content: unknown[];
};

export type ChapterSlice = {
  bookCode: string;
  chapter: number;
  nodes: unknown[];
};

export function splitUsjByChapter(doc: { content?: unknown[] }): ChapterSlice[];
export function collectVerseTextsFromContent(content: unknown[]): Record<string, string>;
export function chapterSliceToUsjDocument(
  slice: ChapterSlice,
  version: string,
): UsjDocument;
