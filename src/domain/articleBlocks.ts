/**
 * An article (of the Academy or of the words) worked on piece by piece: each heading, paragraph, quote and item of a
 * list of the source stands beside what the team has for it, so that whoever translates reads the source of the very
 * paragraph in hand instead of looking for it in the whole article.
 *
 * The article is still one markdown file. The rows are a way of showing it: they are made from the source and the
 * file, edited one at a time, and joined back into the file. A row that was not touched is written back exactly as
 * it was. Pure: `ArticleBlocks` shows the rows and edits them.
 */
import { normalizeMarkdown, parseMarkdown, roundTrips, serializeMarkdown, type Block } from "./helpMarkup";

/** One piece of an article: a block of its markdown, a list being one piece for each of its items. */
type Piece = Block;

function explode(blocks: Block[]): Piece[] {
  return blocks.flatMap((block): Piece[] => {
    if ((block.t !== "ul" && block.t !== "ol") || block.items.length < 2) return [block];
    // Each item after the first is written right under the one before it, and a numbered one keeps its number.
    return block.items.map((item, index) =>
      block.t === "ul"
        ? { ...block, items: [item], ...(index ? { tight: true } : {}) }
        : { ...block, items: [item], ...(index ? { tight: true } : {}), ...((block.start ?? 1) + index === 1 ? { start: undefined } : { start: (block.start ?? 1) + index }) },
    );
  });
}

const piecesOf = (md: string): Piece[] => explode(parseMarkdown(md));

const loose = (piece: Piece): Piece => {
  const { tight: _tight, ...rest } = piece as Piece & { tight?: boolean };
  return rest as Piece;
};

/** Several pieces as markdown; how the first one sits under what comes before it is not part of it. */
const markdownOf = (pieces: Piece[]): string => serializeMarkdown(pieces.map((piece, index) => (index ? piece : loose(piece))));

const isTight = (piece: Piece | undefined): boolean => Boolean(piece && piece.t !== "p" && piece.t !== "h" && piece.tight);

/** An empty block of the same shape: what an empty box starts as, so that what is typed in it is a heading where the source has one. */
function shapeOf(piece: Piece): Block {
  const bare = loose(piece);
  return bare.t === "ul" || bare.t === "ol" ? { ...bare, items: [[{ t: "br" }]] } : { ...bare, c: [{ t: "br" }] };
}

// ---------------------------------------------------------------- what is still to be translated

/**
 * A link to a passage of the Bible, with what it shows («[Matthew 28:20](rc://en/tn/help/mat/28/20)»). The team's
 * process leaves these as they are while an article is translated, so they are not words to translate: a list of
 * references left as the source has it used to count as paragraphs nobody had translated, and a finished article
 * was said to be unfinished every time.
 */
const PASSAGE_LINK_RE = /\[[^\]]*\]\(rc:\/\/[^/)\s]+\/tn\/help\/[a-z0-9]{3}\/\d+\/\d+\)/gi;

/** The words that are read and translated: not the addresses of links, not marks, not references to a passage. */
function wordsOf(md: string): string[] {
  const text = md
    .replace(PASSAGE_LINK_RE, " ")
    .replace(/\[\[[^\]]*\]\]/g, " ")
    .replace(/\]\([^)]*\)/g, "] ")
    .replace(/(?:rc|https?):\/\/\S+/g, " ")
    .replace(/<[^>]+>/g, " ");
  return text.toLowerCase().match(/\p{L}{2,}/gu) ?? [];
}

/** Every word the source article uses. */
export function vocabularyOf(sourceMd: string): Set<string> {
  return new Set(wordsOf(sourceMd));
}

/**
 * A translation shares few words with its source; a text that was only copied from it shares nearly all. Measured on
 * real articles: what is left in the source language keeps four words of five or more, a translated paragraph one of
 * five or fewer. The line is drawn high, so that a paragraph somebody has started to translate is never taken for
 * one nobody touched.
 */
const SOURCE_LANGUAGE = 0.75;

/** Whether a text is still in the language of the source. A text with no words (a link alone) has nothing to translate. */
export function untranslated(md: string, vocabulary: Set<string>): boolean {
  const words = wordsOf(md);
  if (!words.length) return false;
  return words.filter((word) => vocabulary.has(word)).length / words.length >= SOURCE_LANGUAGE;
}

// ---------------------------------------------------------------- pairing the file with the source

type Kind = "h" | "p" | "q" | "li";
const kindOf = (piece: Piece): Kind => (piece.t === "h" ? "h" : piece.t === "quote" ? "q" : piece.t === "p" ? "p" : "li");

/**
 * For each piece of the file, the piece of the source it goes with (-1: none). Both are read in order and never
 * cross. A heading only goes with a heading, so the sections of the article hold the pairing in place; inside a
 * section a piece goes with one of its kind, and a piece that is the source itself (not yet translated) with itself.
 * When the file has fewer pieces of a kind than the source, the first ones are taken: whoever translates goes down
 * the article.
 */
function pair(source: Piece[], draft: Piece[]): number[] {
  const n = source.length;
  const m = draft.length;
  const sourceText = source.map((piece) => markdownOf([piece]));
  const draftText = draft.map((piece) => markdownOf([piece]));
  const score = (i: number, j: number): number => {
    const a = kindOf(source[i]!);
    const b = kindOf(draft[j]!);
    if ((a === "h") !== (b === "h")) return -1;
    return (a === b ? 3 : 1) + (sourceText[i] === draftText[j] ? 5 : 0);
  };
  const width = m + 1;
  const best = new Float64Array((n + 1) * width);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = score(i - 1, j - 1);
      best[i * width + j] = Math.max(best[(i - 1) * width + j]!, best[i * width + j - 1]!, s < 0 ? -1 : best[(i - 1) * width + j - 1]! + s);
    }
  }
  const of = new Array<number>(m).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const here = best[i * width + j]!;
    // Leaving a piece of the source without its pair is tried first: it is how the earliest pairing is found.
    if (here === best[(i - 1) * width + j]!) i--;
    else if (here === best[i * width + j - 1]!) j--;
    else {
      of[j - 1] = i - 1;
      i--;
      j--;
    }
  }
  return of;
}

// ---------------------------------------------------------------- rows

export type ArticleRow = {
  /** The piece of the source this row translates, as markdown. */
  source: string;
  /** An empty block shaped like that piece. */
  shape: Block;
  /** Whether the source piece has words: a link alone has nothing to translate. */
  words: boolean;
  /** What the article has for this row, as markdown: usually one block; none (`""`), or more when the translation needed them. */
  draft: string;
  /** Written right under the row before it, with no blank line between (an item of a list, a quote under its example). */
  tight: boolean;
  /** The file had nothing for this row: what is written in it follows the source. */
  fresh: boolean;
};

/**
 * The article as rows, one for each piece of the source. A piece of the file that goes with no piece of the source
 * stays in the row before it, so the order of the file is never changed. `null` when the article cannot be worked
 * this way: there is no source, or the file uses something that would not come back the same (it is then edited
 * whole, as its source).
 */
export function articleRows(sourceMd: string, draftMd: string): ArticleRow[] | null {
  const source = piecesOf(sourceMd);
  if (!source.length) return null;
  if (draftMd.trim() && !roundTrips(draftMd)) return null;
  const draft = piecesOf(draftMd);
  const of = pair(source, draft);
  const held: Piece[][] = source.map(() => []);
  const firstPaired = of.find((row) => row >= 0) ?? 0;
  let last = -1;
  draft.forEach((piece, index) => {
    if (of[index]! >= 0) last = of[index]!;
    held[last >= 0 ? last : firstPaired]!.push(piece);
  });
  return source.map((piece, index) => {
    const mine = held[index]!;
    return {
      source: markdownOf([piece]),
      shape: shapeOf(piece),
      words: wordsOf(markdownOf([piece])).length > 0,
      draft: mine.length ? markdownOf(mine) : "",
      tight: isTight(mine[0] ?? piece),
      fresh: !mine.length,
    };
  });
}

// ---------------------------------------------------------------- the files of an article, and naming a piece

export type ArticleFile = { filename: string; part?: "title" | "sub-title" };

/**
 * The files an article is read from, in the order it reads, given the files that were worked on. An article of the
 * Academy is a folder: its title and the line under it are files of their own, and they are read with its body
 * even when only the body was touched (a title left in the source language is part of what is reviewed). An article
 * of the words is one file.
 */
export function articleFilesOf(changed: string[], academy: boolean): ArticleFile[] {
  const md = changed.filter((name) => /\.md$/i.test(name));
  if (!academy) return md.map((filename) => ({ filename }));
  const folders = [...new Set(md.map((name) => name.replace(/\/[^/]+$/, "")))];
  return folders.flatMap((folder) => [{ filename: `${folder}/title.md`, part: "title" as const }, { filename: `${folder}/sub-title.md`, part: "sub-title" as const }, { filename: `${folder}/01.md` }]);
}

/**
 * How a piece of an article is named where a comment is about it: «figs-metaphor ¶5», «figs-metaphor (título)». The
 * name is by the article's file and the place of the piece in the source, so that it stays the same while the
 * translation changes: the screen where the article is reviewed and the one where it is written both find the piece
 * from it.
 */
export function pieceRef(filepath: string, index: number): string {
  const parts = filepath.replace(/\.md$/i, "").split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  const part = /^title$/i.test(last) ? "título" : /^sub-?title$/i.test(last) ? "subtítulo" : "";
  const slug = part || /^\d+$/.test(last) ? (parts[parts.length - 2] ?? last) : last;
  if (part) return `${slug} (${part})${index ? ` ¶${index + 1}` : ""}`;
  return `${slug} ¶${index + 1}`;
}

/**
 * How a piece of an introduction (a note of the book or of a chapter, pages long) is named where a comment is about
 * it: «intro ¶3» for the book's, «1:intro ¶3» for that of chapter 1. As with an article, by its place in the source.
 */
export function introPieceRef(chapter: number | undefined, index: number): string {
  return `${chapter ? `${chapter}:` : ""}intro ¶${index + 1}`;
}

/** Whether `articleRows` would give rows: asked on every keystroke, so it does not make them. */
export function rowsPossible(sourceMd: string, draftMd: string): boolean {
  return /\S/.test(sourceMd) && (!draftMd.trim() || roundTrips(draftMd)) && piecesOf(sourceMd).length > 0;
}

/** Only a list and a quote can be written right under what comes before: a paragraph would run into it. */
const canBeTight = (md: string) => /^(?:[*-][ \t]|\d+\.[ \t]|>)/.test(md);

/**
 * The rows joined back into the article. A row with nothing in it leaves nothing. A row the file already had keeps
 * the gap the file had before it; one written anew is put right under the row before it only when the source has it
 * so and that row is there (a numbered item written under a paragraph would be read as part of the paragraph).
 */
export function rowsMarkdown(rows: Pick<ArticleRow, "draft" | "tight" | "fresh">[]): string {
  let out = "";
  rows.forEach((row, index) => {
    const text = row.draft.trim();
    if (!text) return;
    const under = row.tight && canBeTight(text) && (!row.fresh || Boolean(rows[index - 1]?.draft.trim()));
    out += (out ? (under ? "\n" : "\n\n") : "") + text;
  });
  return out;
}

/** A row is still to be translated when the article has nothing for it, or has it in the language of the source. */
export function rowPending(row: Pick<ArticleRow, "draft" | "words">, vocabulary: Set<string>): boolean {
  return row.draft.trim() ? untranslated(row.draft, vocabulary) : row.words;
}

/** How many rows there are to translate, and how many are. */
export function articleProgress(rows: Pick<ArticleRow, "draft" | "words">[], vocabulary: Set<string>): { done: number; total: number } {
  const counted = rows.filter((row) => row.words);
  return { done: counted.filter((row) => !rowPending(row, vocabulary)).length, total: counted.length };
}

/**
 * What to start from when nothing of the article is translated yet. The team's repository often holds a copy of the
 * article in the source language, made from an older version of it: translating over that copy would pair the
 * paragraphs of one version with those of another. An article with nothing translated starts from the source as it
 * is today, a piece for each row. `null`: the article has work in it (or there is no source), and is kept as it is.
 */
export function startingText(sourceMd: string, draftMd: string): string | null {
  const source = piecesOf(sourceMd);
  if (!source.length) return null;
  const fresh = markdownOf(source);
  if (draftMd.trim()) {
    const vocabulary = vocabularyOf(sourceMd);
    const draft = parseMarkdown(draftMd);
    const worded = draft.filter((block) => wordsOf(serializeMarkdown([block])).length);
    if (!worded.length || !worded.every((block) => untranslated(serializeMarkdown([block]), vocabulary))) return null;
  }
  return fresh === normalizeMarkdown(draftMd) ? null : fresh;
}
