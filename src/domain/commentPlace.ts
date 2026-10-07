/**
 * A comment of a review is about a place of the draft: a verse, a paragraph of an article or of an introduction. It
 * is stored under a name the tools find that place by («JUD figs-metaphor ¶5», see `pieceRef`), which is an address,
 * not something to read. This tells the place from what the comment says, so that wherever the comment is shown (the
 * conversation, the line under a task) the place can be said in words, with what it says beside it.
 * Pure, and on nothing else: the notices (the push Worker too) read this file to word a comment.
 */

/** A comment about one piece starts with where it is, so it can be shown next to it again. */
export function refComment(book: string, ref: string, text: string): string {
  return `**${book.toUpperCase()} ${ref}** — ${text.trim()}`;
}

const WHILE_OPEN = "<!-- gt:mientras-abierta -->";

/**
 * A message that asks for something to be done in its subtarea («ya se puede cerrar la revisión», «¿cómo va esta
 * tarea?»), marked as such: once the subtarea is finished it asks nothing, and it stayed in «Avisos» of whoever it
 * named until they opened it.
 */
export const whileOpen = (text: string) => `${text.trim()}\n${WHILE_OPEN}`;
export const asksWhileOpen = (body: string | undefined) => (body ?? "").includes(WHILE_OPEN);

/**
 * The name a comment about one row of a help (a note, a question) is filed under: its verse and the id of the row,
 * «1:3 §x7k2». Ten notes may be of one verse: named by the verse alone, «Falta traducir esta nota» was read under
 * each of the ten by whoever reviewed, and over the first of them by whoever had to correct it. A row without an id
 * of its own is named by its verse, as before.
 */
export function helpRowRef(ref: string, id: string): string {
  return /^[A-Za-z0-9]+$/.test(id.trim()) ? `${ref} §${id.trim()}` : ref;
}

/** The reference a comment was written about (`1:2`), and what it says without it; `ref` empty when it has none. */
export function parseRefComment(body: string): { ref: string; text: string } {
  const m = body.match(/^\*\*[A-Z0-9]{3}\s+(\d+:\d+(?:[–-]\d+)?[a-z]?(?: §[A-Za-z0-9]+)?)\*\*\s*[—-]\s*/);
  if (m) return { ref: m[1]!.replace("-", "–"), text: body.slice(m[0].length).trim() };
  // About an article, which is named by its title instead of a verse.
  const article = body.match(/^\*\*[A-Z0-9]{3}\s+([^*\n]+?)\*\*\s*[—-]\s*/);
  return article ? { ref: article[1]!.trim(), text: body.slice(article[0].length).trim() } : { ref: "", text: body.trim() };
}

export type CommentPlace =
  | { kind: "verse"; ref: string }
  | { kind: "help"; ref: string; id: string }
  | { kind: "paragraph"; article: string; index: number }
  | { kind: "title"; article: string }
  | { kind: "subtitle"; article: string }
  | { kind: "intro"; chapter?: number; index: number };

/** The place a comment's name stands for; `null` when it names none this app knows (an older comment, by a title). */
export function commentPlace(ref: string): CommentPlace | null {
  const text = ref.trim();
  if (/^\d+:\d+(?:[–-]\d+)?[a-z]?$/.test(text)) return { kind: "verse", ref: text.replace("-", "–") };
  const help = text.match(/^(\d+:\d+(?:[–-]\d+)?[a-z]?) §([A-Za-z0-9]+)$/);
  if (help) return { kind: "help", ref: help[1]!.replace("-", "–"), id: help[2]! };
  const intro = text.match(/^(?:(\d+):)?intro ¶(\d+)$/);
  if (intro) return { kind: "intro", ...(intro[1] ? { chapter: Number(intro[1]) } : {}), index: Number(intro[2]) - 1 };
  const part = text.match(/^(.+?) \((título|subtítulo)\)$/);
  if (part) return { kind: part[2] === "título" ? "title" : "subtitle", article: part[1]! };
  const paragraph = text.match(/^(.+?) ¶(\d+)$/);
  if (paragraph) return { kind: "paragraph", article: paragraph[1]!, index: Number(paragraph[2]) - 1 };
  return null;
}

/**
 * A message that is about a place: the name it is filed under, the place, and what is said about it. Read from the
 * message as it was written (`**JUD 1:2** — …`) or from a preview of it, which has lost its marks. `null`: a message
 * about nothing in particular.
 */
export function placedMessage(text: string): { ref: string; place: CommentPlace; text: string } | null {
  const marked = parseRefComment(text);
  if (marked.ref) {
    const place = commentPlace(marked.ref);
    return place ? { ref: marked.ref, place, text: marked.text } : null;
  }
  // Only a name this app gives a place is taken for one: «JUD es corto — …» is somebody's sentence.
  const bare = text.match(/^[A-Z0-9]{3}\s+(.+?)\s+—\s+([\s\S]*)$/);
  const place = bare ? commentPlace(bare[1]!) : null;
  return bare && place ? { ref: bare[1]!.trim(), place, text: bare[2]!.trim() } : null;
}

/** A paragraph as one line of plain words, to quote it: without the marks of its markdown or the addresses of its links. */
export function plainLine(md: string): string {
  return md
    .replace(/\[\[rc:\/\/[^\]]*?\/([^\]/]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>+\s?|[*-]\s+|\d+\.\s+)/gm, "")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
