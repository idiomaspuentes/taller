/**
 * What the one button at the foot of «Estudiar» does. It is always in view, so whoever studies never has to scroll a
 * long chapter to find how to go on: it marks as read the part in view, and once all are read it finishes the step.
 * With a part in view that is already read (or the person's notes), it takes them to the first part still unread
 * (`goto`) without marking it: «Leído» is said only of what was on screen. When the step was already done, it only
 * takes the person back.
 */
export type StudyFoot = { kind: "read" | "goto" | "finish" | "back"; part?: string };

export function studyFoot(p: { parts: string[]; read: ReadonlySet<string>; open: string | null; done: boolean }): StudyFoot {
  if (p.done) return { kind: "back" };
  const unread = p.parts.filter((part) => !p.read.has(part));
  if (!unread.length) return { kind: "finish" };
  if (p.open && p.parts.includes(p.open) && !p.read.has(p.open)) return { kind: "read", part: p.open };
  return { kind: "goto", part: unread[0]! };
}

/**
 * The notes worth reading in «Notas»: without the rows that introduce the book or the chapter, already read in their
 * own parts. Their codes («1:intro · v1fp») say nothing to a translator.
 */
export function notesToStudy<T extends { ref: string }>(rows: T[]): T[] {
  // A row's `ref` is its reference, then « · » and its id when it has one: «1:intro · v1fp».
  return rows.filter((row) => !/(^|:)intro$/i.test((row.ref.split("·")[0] ?? "").trim()));
}
