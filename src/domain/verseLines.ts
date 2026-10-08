/**
 * A verse of a poem written a line to a field. In one box the lines of a verse are told apart by a key (Enter)
 * that whoever writes has to know of, and nothing shows the shape of the verse while it is written. Here each
 * line of the source has its field, and what the keys do between fields is said once, apart from the screen:
 * Enter begins a line, Backspace at the start of a line joins it to the one before.
 *
 * The verse is still one text, its lines parted by `\n`: that is what is kept, saved and shown.
 */

/** Where the cursor goes after a change: in which line, after how many characters. */
export type LinePlace = { line: number; offset: number };

export type LinesChange = { lines: string[]; place: LinePlace };

/** A text in the lines it was typed in: empty ones are kept (a line left for later), at least one. */
export function typedLines(text: string): string[] {
  const lines = text.replace(/\r/g, "").split("\n");
  return lines.length ? lines : [""];
}

/**
 * The lines as the text that is kept. Empty lines at the end are not text: left there, a verse nobody changed
 * would differ from itself by a line end.
 */
export function linesText(lines: string[]): string {
  return lines.join("\n").replace(/\n+$/, "");
}

/** The fields to show: the lines that were typed, and those the source has that are not written yet. */
export function fieldLines(text: string, least: number, more = 0): string[] {
  const lines = typedLines(text);
  const count = Math.max(lines.length, least, 1) + (lines.length >= least ? more : 0);
  return Array.from({ length: Math.max(count, lines.length) }, (_, index) => lines[index] ?? "");
}

/** What was typed into a line. Text pasted with line ends in it becomes lines of its own. */
export function setLine(lines: string[], line: number, value: string): LinesChange {
  const parts = value.replace(/\r/g, "").split("\n");
  const next = [...lines.slice(0, line), ...parts, ...lines.slice(line + 1)];
  const last = line + parts.length - 1;
  return { lines: next, place: { line: last, offset: parts[parts.length - 1]!.length } };
}

/**
 * Enter in a line: what follows the cursor begins a line of its own, in the empty line after it when there is
 * one.
 */
export function splitLine(lines: string[], line: number, from: number, to = from): LinesChange {
  const text = lines[line] ?? "";
  const before = text.slice(0, from).replace(/[ \t]+$/, "");
  const after = text.slice(to).replace(/^[ \t]+/, "");
  // An empty line that follows is the line that begins: one is not left empty to make another.
  const empty = lines[line + 1] !== undefined && !lines[line + 1]!.trim();
  return { lines: [...lines.slice(0, line), before, after, ...lines.slice(line + (empty ? 2 : 1))], place: { line: line + 1, offset: 0 } };
}

/** Backspace at the start of a line: it joins the one before, a space between the two when both say something. */
export function joinLine(lines: string[], line: number): LinesChange {
  if (line <= 0 || line >= lines.length) return { lines, place: { line: Math.max(0, Math.min(line, lines.length - 1)), offset: 0 } };
  const before = lines[line - 1]!.replace(/[ \t]+$/, "");
  const after = lines[line]!.replace(/^[ \t]+/, "");
  const joined = before && after ? `${before} ${after}` : before + after;
  return { lines: [...lines.slice(0, line - 1), joined, ...lines.slice(line + 1)], place: { line: line - 1, offset: before.length + (before && after ? 1 : 0) } };
}

/** In which line of a text a place of it is, and how far into that line. */
export function lineOfOffset(text: string, at: number): LinePlace {
  const lines = typedLines(text);
  let left = Math.max(0, at);
  for (let line = 0; line < lines.length; line++) {
    if (left <= lines[line]!.length) return { line, offset: left };
    left -= lines[line]!.length + 1;
  }
  return { line: lines.length - 1, offset: lines[lines.length - 1]!.length };
}
