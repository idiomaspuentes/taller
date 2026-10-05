/**
 * References to passages of the Bible in an article, written by the app and not by whoever translates.
 *
 * An article of the words lists where the Bible uses the word: «[1 John 1:7](rc://en/tn/help/1jn/01/07)». Nothing
 * there is translated but the name of the book, and that is the same every time: the app knows what each book is
 * called in the team's language and writes the reference itself. The book is read from the address of the link, not
 * from what the link shows, so how the source names it does not matter. Pure.
 */

/** A link to a passage as the resources write it; the same shape `articleBlocks.ts` leaves out of the words to translate. */
const PASSAGE_LINK_RE = /\[([^\]]*)\]\(rc:\/\/[^/)\s]+\/tn\/help\/([a-z0-9]{3})\/(\d+)\/(\d+)\)/gi;

/** The chapter and verses at the end of what a reference shows: «1:7-8» of «1 John 1:7-8». */
const PLACE_RE = /(\d+(?::\d+)?(?:\s*[-–]\s*\d+(?::\d+)?)?)\s*$/;

/** Whether a piece of an article is nothing but references to passages: an item of the list of them. */
export function isPassageList(md: string): boolean {
  const rest = md.replace(PASSAGE_LINK_RE, "");
  return rest !== md && !/[\p{L}\p{N}]/u.test(rest);
}

/**
 * A piece that is only references, written in the team's language: each book by the name `nameOf` gives it, the
 * chapter and verses as the source shows them, and the address for any language (`rc://*`), as the team's published
 * articles have it. `null` when the piece is something else, or names a book `nameOf` does not know: then it is
 * left to whoever translates, as before.
 */
export function localPassages(md: string, nameOf: (book: string) => string | undefined): string | null {
  if (!isPassageList(md)) return null;
  let known = true;
  const written = md.replace(PASSAGE_LINK_RE, (all: string, shown: string, book: string, chapter: string, verse: string) => {
    const name = nameOf(book.toUpperCase());
    if (!name) {
      known = false;
      return all;
    }
    const place = PLACE_RE.exec(shown.trim())?.[1]?.replace(/\s+/g, "") ?? `${Number(chapter)}:${Number(verse)}`;
    return `[${name} ${place}](rc://*/tn/help/${book.toLowerCase()}/${chapter}/${verse})`;
  });
  return known ? written : null;
}
