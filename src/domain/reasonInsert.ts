/**
 * What a touch puts in a reason, written the way a reason is read back (`reasonText.ts`): the words of the original
 * as they are (they are found again among the words of the verse), what an English text says in quotes with its
 * name, a note by its id, an Academy article by its title and its path. Whoever reads it can then open each.
 */

/** Words of the original, without the cantillation and the joiners a person does not type. */
export function originalSnippet(words: string[]): string {
  return words.map((word) => word.replace(/[\u0591-\u05AF\u05BD\u2060]/g, "")).join(" ");
}

/** What a text says, in quotes and with its name: «made his heart firm» (ULT). */
export function textSnippet(label: string, words: string[]): string {
  return `«${words.join(" ").replace(/\s+([,.;:!?])/g, "$1").trim()}» (${label})`;
}

/** A note by its id, in the words of the language the person writes in («la nota {id}», «a nota {id}»). */
export function noteSnippet(id: string, template = "la nota {id}"): string {
  return template.replace("{id}", id);
}

/** An article by its title and its path, which is what it is recognized by in any language. */
export function articleSnippet(title: string, path: string, template = "el artículo «{title}» ({path})", bare = "el artículo {path}"): string {
  return (title && title !== path ? template.replace("{title}", title) : bare).replace("{path}", path);
}

/**
 * A reason with something put where the person was writing (in place of what was selected), with a space before and
 * after it unless one is there or it begins or ends the line. Returns the text and where the cursor goes.
 */
export function insertAt(value: string, start: number, end: number, snippet: string): { text: string; cursor: number } {
  const from = Math.max(0, Math.min(start, value.length));
  const to = Math.max(from, Math.min(end, value.length));
  const before = value.slice(0, from);
  const after = value.slice(to);
  const lead = before && !/[\s(«"“]$/.test(before) ? " " : "";
  const trail = after && !/^[\s,.;:!?)»"”]/.test(after) ? " " : "";
  const text = `${before}${lead}${snippet}${trail}${after}`;
  return { text, cursor: before.length + lead.length + snippet.length + trail.length };
}
