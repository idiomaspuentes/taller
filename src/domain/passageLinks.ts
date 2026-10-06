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

/**
 * The links of a piece of the source, kept in its translation.
 *
 * A note says «Introduction ([1:1–2](../01/01.md))» and whoever translates writes «Introducción (1:1–2)»: a link is
 * not something a person types on a phone. The reference was saved as plain text and nobody was told, so the
 * published note lost its way to the passage. What the source links and the translation shows with the same words
 * is linked again by the app; a link whose words are not there (the name of an article of the Academy) is given
 * back, for the screen to offer it by a touch.
 */
export type SourceLink = {
  /** As the source writes it: `[1:1–2](../01/01.md)`, or the address of an article of the Academy between double brackets. */
  raw: string;
  /** Where it leads. */
  target: string;
  /** What it shows; empty for a link that shows the title of what it leads to. */
  text: string;
};

const LINK_RE = /\[\[([^\]\s]+)\]\]|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** The links a piece of markdown has, in the order it has them. */
export function sourceLinks(md: string): SourceLink[] {
  return [...md.matchAll(LINK_RE)].map((m) => (m[1] ? { raw: m[0], target: m[1], text: "" } : { raw: m[0], target: m[3]!, text: m[2]! }));
}

/**
 * A line that is only links, one after another («(See also: [pray](../kt/pray.md), [cry](../other/cry.md))»), and
 * its translation naming as many things in the same order («(Ver también: orar, clamar)»): each name is linked to
 * what the source links in its place. The names are other words in the translation, so they cannot be found by
 * what they say, and nearly every article of the words ends with such a line. `null` when it is not that.
 */
function linkedList(sourceMd: string, draftMd: string): string | null {
  const links = sourceLinks(sourceMd);
  if (!links.length || links.some((link) => !link.text)) return null;
  // Without its links the source is its lead and what stands between them: «(See also: , , )».
  if (!/^\s*\(?[^:()[\]]{1,40}:[\s,;]*\)?\.?\s*$/.test(sourceMd.replace(LINK_RE, ""))) return null;
  const said = /^(\s*\(?[^:()[\]]{1,40}:\s*)([^()[\]]*?)(\s*\)?\.?\s*)$/.exec(draftMd);
  if (!said) return null;
  let names = said[2]!.split(/\s*[,;]\s*/).map((name) => name.trim()).filter(Boolean);
  // «orar, clamar y llamar»: the last two are joined by a word, not a comma.
  if (names.length === links.length - 1) names = [...names.slice(0, -1), ...names[names.length - 1]!.split(/\s+(?:y|e|o|u|ou|and|or)\s+/)];
  if (names.length !== links.length) return null;
  return `${said[1]}${names.map((name, index) => `[${name}](${links[index]!.target})`).join(", ")}${said[3]}`;
}

/**
 * The translation of a piece with the links of its source: those it already has are left, those whose words it
 * shows are put back around those words, and the rest are returned as `missing`.
 */
export function withSourceLinks(sourceMd: string, draftMd: string): { text: string; missing: SourceLink[] } {
  if (!draftMd.trim()) return { text: draftMd, missing: [] };
  const listed = linkedList(sourceMd, draftMd);
  if (listed) return { text: listed, missing: [] };
  let text = draftMd;
  const missing: SourceLink[] = [];
  const had = sourceLinks(draftMd).map((link) => link.target);
  for (const link of sourceLinks(sourceMd)) {
    const at = had.indexOf(link.target);
    if (at >= 0) {
      had.splice(at, 1);
      continue;
    }
    // Only where it is not already inside a link: the text between brackets, or an address between parentheses.
    const found = link.text ? new RegExp(`(?<![\\[\\w])${link.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[-–—]/g, "[-–—]")}(?![\\]\\w]|\\]\\()`).exec(text) : null;
    // A reference to another book shows its name in the source's language («Romans 6:1–2»): the translation has the
    // same place under the book's own name («Romanos 6:1–2»), and that is what is linked.
    const place = found || !link.text ? null : /(\d+:\d+[a-z]?(?:\s*[-–]\s*\d+(?::\d+)?[a-z]?)?)\s*$/.exec(link.text.trim())?.[1];
    const named = place && place !== link.text.trim() ? new RegExp(`(?<![\\[\\w])(?:[1-3] )?\\p{Lu}[\\p{L}.]* ${place.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[-–—]/g, "[-–—]")}(?![\\]\\w]|\\]\\()`, "u").exec(text) : null;
    const hit = found ?? named;
    if (hit) text = `${text.slice(0, hit.index)}[${hit[0]}](${link.target})${text.slice(hit.index + hit[0].length)}`;
    else missing.push(link);
  }
  return { text, missing };
}

/** A link of the source put into a translation that lacks it: before the parenthesis or the stop it ends with, or at the end. */
export function addSourceLink(draftMd: string, link: SourceLink): string {
  // Only a parenthesis and a stop: the brackets a text ends with are those of a link already there.
  const end = /(\)*[.!?]?)\s*$/.exec(draftMd);
  const tail = end?.[1] ?? "";
  const body = draftMd.trimEnd().slice(0, draftMd.trimEnd().length - tail.length);
  return `${body}${/[\s(]$/.test(body) || !body ? "" : " "}${link.raw}${tail}`;
}

/** What a link is called on the button that offers it: what it shows, or the last word of where it leads. */
export function linkName(link: SourceLink): string {
  return link.text || (link.target.split("/").filter(Boolean).pop() ?? link.target);
}
