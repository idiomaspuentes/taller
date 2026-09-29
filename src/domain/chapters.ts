import type { InventoryTask, Portion, TaskResource } from "./types";

export type ChapterGroup<T extends { chapter: number }> = {
  chapter: number;
  portions: T[];
};

export function groupPortionsByChapter<T extends { chapter: number }>(
  portions: T[],
): ChapterGroup<T>[] {
  const map = new Map<number, T[]>();
  for (const portion of portions) {
    const list = map.get(portion.chapter) ?? [];
    list.push(portion);
    map.set(portion.chapter, list);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([chapter, rows]) => ({ chapter, portions: rows }));
}

export function portionKey(portion: Pick<Portion, "id" | "ref">): string {
  return portion.id || portion.ref;
}

export function displayRef(book: string, ref: string): string {
  const text = (ref || "").trim();
  if (!text) return book;
  if (/^[A-Z0-9]{2,3}\s/.test(text)) return text;
  return book ? `${book} ${text}` : text;
}

/**
 * Human verse range for list titles: "1:1–3" from "NEH 1:1-3" or "1:1-3".
 * Falls back to the trimmed ref when it doesn't look like chapter:verse.
 */
export function verseRangeLabel(ref: string): string {
  const text = (ref || "").trim();
  if (!text) return "";
  const match = text.match(/(\d+:\d+(?:\s*[-–—]\s*\d+)?)\s*$/);
  if (!match) return text;
  return match[1].replace(/\s*[-–—]\s*/, "–");
}

/** Resource chip for scripture / note / question tasks. */
export function taskKindLabel(resource: TaskResource): string {
  if (resource === "notas") return "Nota";
  if (resource === "preguntas") return "Pregunta";
  if (resource === "tpl") return "TPL";
  return "TPS";
}

export function flattenTasks(portions: Portion[], resource: TaskResource): InventoryTask[] {
  const tasks: InventoryTask[] = [];
  for (const portion of portions) {
    const items =
      resource === "notas"
        ? portion.notasItems
        : resource === "preguntas"
          ? portion.preguntasItems
          : resource === "tpl"
            ? portion.tplItems
            : portion.tpsItems;
    for (const item of items) tasks.push(item);
  }
  return tasks;
}

export function tasksByChapter(portions: Portion[], resource: TaskResource) {
  return groupPortionsByChapter(portions)
    .map((group) => ({
      chapter: group.chapter,
      portions: group.portions.filter((portion) => {
        const items =
          resource === "notas"
            ? portion.notasItems
            : resource === "preguntas"
              ? portion.preguntasItems
              : resource === "tpl"
                ? portion.tplItems
                : portion.tpsItems;
        return items.length > 0;
      }),
    }))
    .filter((group) => group.portions.length > 0);
}
