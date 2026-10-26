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

/**
 * What an article teaches, from its start: its first section after the title (the description of a translation
 * article, the definition of a word), at most a few paragraphs. Read in a card when the article was already checked:
 * enough to see whether it teaches what a note points at, with the whole of it a touch away (21 October).
 */
export function articleLead(markdown: string, most = 600): string {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const title = lines.findIndex((line) => /^#\s/.test(line));
  let body = (title >= 0 ? lines.slice(title + 1) : lines).join("\n").trim().split("\n");
  if (/^#{2,6}\s/.test(body[0] ?? "")) body = body.slice(1);
  const end = body.findIndex((line) => /^#{1,6}\s/.test(line));
  const section = (end >= 0 ? body.slice(0, end) : body).join("\n").trim();
  let out = "";
  for (const paragraph of section.split(/\n\s*\n/)) {
    if (out && out.length + paragraph.length > most) break;
    out += (out ? "\n\n" : "") + paragraph.trim();
  }
  return out;
}
