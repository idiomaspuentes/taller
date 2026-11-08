/**
 * What is still to write in a draft of the Bible text when its translator says it is finished. «Terminé el
 * borrador» was offered as soon as one verse had text, and asked nothing: a translator of Nehemiah who was only
 * looking for a way to save handed in one verse of three (8 November 2026). Pure.
 */

/** How many rows of the passage have no text yet, and the first of them (by its first verse). */
export function versesLeft(drafts: { from: number; to: number; text: string }[]): { count: number; first: number | undefined } {
  const empty = drafts.filter((row) => !row.text.trim());
  return { count: empty.length, first: empty[0]?.from };
}
