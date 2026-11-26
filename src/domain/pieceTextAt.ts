/**
 * What each piece of a draft says now, in the form of an editor box, by the place a comment names it with. Asked by
 * `openComments` to tell a proposal that was used from one that was not (see `proposalUsed`). Pure: the screen reads
 * the files from the head of the review and gives their text here.
 */
import { articleRows, introPieceRef, pieceRef } from "./articleBlocks";
import { helpRowRef } from "./commentPlace";
import { helpRows, introItems } from "./reviewItems";
import type { PieceText } from "./reviewProposals";
import { listVerseSpans, verseLinesText, type RefRange } from "./usfmEdit";

export type PieceFile = {
  filename: string;
  /** The file as the head of the review has it. */
  text: string;
  /** An article: its source, as the rows are made against it. */
  source?: string;
};

export function pieceTextAt(params: {
  files: PieceFile[];
  range: RefRange;
  /** The source of each introduction of a file of notes, by its id. */
  introSources?: Record<string, string>;
}): (ref: string) => PieceText | undefined {
  const { files, range, introSources = {} } = params;
  const found = new Map<string, PieceText>();
  const put = (ref: string, piece: PieceText) => {
    if (!found.has(ref)) found.set(ref, piece);
  };
  for (const file of files) {
    const name = file.filename.toLowerCase();
    if (name.endsWith(".usfm") || name.endsWith(".sfm")) {
      for (const span of listVerseSpans(file.text)) {
        if (span.chapter !== range.chapter || span.segment) continue;
        const ref = span.verseTo > span.verse ? `${span.chapter}:${span.verse}–${span.verseTo}` : `${span.chapter}:${span.verse}`;
        put(ref, { text: verseLinesText(file.text, span) });
      }
    } else if (name.endsWith(".tsv")) {
      for (const row of helpRows(file.text, range)) {
        put(helpRowRef(`${row.chapter}:${row.verse}`, row.id), row.answer !== undefined ? { text: row.said, secondary: row.answer } : { text: row.said });
      }
      for (const intro of introItems(file.text, "", range.chapter, () => true)) {
        const rows = articleRows(introSources[intro.key] ?? "", intro.now);
        rows?.forEach((row, index) => put(introPieceRef(intro.chapter, index), { text: row.draft }));
      }
    } else if (name.endsWith(".md")) {
      const rows = articleRows(file.source ?? "", file.text);
      rows?.forEach((row, index) => put(pieceRef(file.filename, index), { text: row.draft }));
    }
  }
  return (ref) => found.get(ref);
}
