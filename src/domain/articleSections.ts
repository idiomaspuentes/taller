/**
 * Sections of an article left out where it is read to understand a point, not to translate it: the translation
 * suggestions of Translation Words and the translation strategies of Translation Academy are written for whoever
 * translates into another language, and the team refining the TPL or the TPS took them as what to do, against the
 * rules of its text (19 October). Which sections, by their titles, is said by the process package (`readingOmits`).
 *
 * Only whole sections are left out: a suggestion inside the definition, as a bullet, is left where it is.
 */

/** A title as it is compared: without marks at its ends, in one spacing and one case. */
export function headingKey(title: string): string {
  return title
    .normalize("NFC")
    .replace(/^[\s#*_]+|[\s:*_.]+$/g, "")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

/**
 * The article without the sections whose titles are among `omit`: each from its title to the next title of its
 * level or above. `omitted`: whether anything was left out, to say so where it is read.
 */
export function withoutSections(markdown: string, omit: readonly string[]): { text: string; omitted: boolean } {
  const keys = new Set(omit.map(headingKey).filter(Boolean));
  if (!keys.size || !markdown) return { text: markdown, omitted: false };
  const kept: string[] = [];
  let skipping: number | null = null;
  let omitted = false;
  let fence = false;
  for (const line of markdown.split(/\r?\n/)) {
    // A «#» inside a block of code is not a title.
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const title = fence ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (title) {
      const level = title[1]!.length;
      if (skipping !== null && level <= skipping) skipping = null;
      if (skipping === null && keys.has(headingKey(title[2]!))) {
        skipping = level;
        omitted = true;
        continue;
      }
    }
    if (skipping === null) kept.push(line);
  }
  return { text: kept.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd(), omitted };
}
