/**
 * What a touch puts in a reason, written the way a reason is read back (`reasonText.ts`): the words of the original
 * as they are (they are found again among the words of the verse), what an English text says in quotes with its
 * name, a note by its id, an Academy article by its title and its path. Whoever reads it can then open each.
 */

/** Words of the original, without the cantillation and the joiners a person does not type. */
export function originalSnippet(words: string[]): string {
  return words.map((word) => word.replace(/[֑-ֽ֯⁠]/g, "")).join(" ");
}

/** What a text says, in quotes and with its name: «made his heart firm» (ULT). */
export function textSnippet(label: string, words: string[]): string {
  return `«${words.join(" ").replace(/\s+([,.;:!?])/g, "$1").trim()}» (${label})`;
}

export function noteSnippet(id: string): string {
  return `la nota ${id}`;
}

export function articleSnippet(title: string, path: string): string {
  return title && title !== path ? `el artículo «${title}» (${path})` : `el artículo ${path}`;
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
