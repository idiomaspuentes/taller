/**
 * Port of the JSON half of idiomas-puentes-docs/scripts/fcr_prep/emit.py.
 * Markdown/TSV emission is skipped: the gateway-tasks worker only ever
 * requests `--format json`.
 */

import { Portion, slotsFor, type PrepInventory, type ResourceItem, type ResourceSlot } from "./models";

const SCHEMA_ID = "prep-inventory-1";
const GENERATOR = "prep_portions.py";

export function publicArticleIndex(inventory: PrepInventory): {
  palabras: { id: string; path: string }[];
  academia: { id: string; path: string }[];
} {
  const seen: Record<"Palabras" | "Academia", Map<string, { id: string; path: string }>> = {
    Palabras: new Map(),
    Academia: new Map(),
  };
  for (const chapter of inventory.chapters) {
    for (const portion of chapter.portions) {
      const slots = slotsFor(inventory, portion);
      for (const resource of ["Palabras", "Academia"] as const) {
        const slot = slots[resource];
        if (!slot) continue;
        for (const item of slot.items) {
          const path = (item.path || "").trim();
          const itemId = (item.itemId || "").trim();
          const key = path.toLowerCase() || itemId.toLowerCase();
          if (!key || seen[resource].has(key)) continue;
          seen[resource].set(key, { id: itemId, path });
        }
      }
    }
  }
  const sorted = (resource: "Palabras" | "Academia") =>
    [...seen[resource].values()].sort((a, b) => (a.path || a.id).toLowerCase().localeCompare((b.path || b.id).toLowerCase()));
  return { palabras: sorted("Palabras"), academia: sorted("Academia") };
}

function slotItems(slots: Record<string, ResourceSlot>, name: string): ResourceItem[] {
  return slots[name]?.items ?? [];
}

function taskItems(slots: Record<string, ResourceSlot>, name: string, portion: Portion): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const item of slotItems(slots, name)) {
    const itemId = (item.itemId || "").trim();
    if (!itemId) continue;
    rows.push({
      id: itemId,
      ref: (item.ref || "").trim(),
      chapter: portion.chapter,
      portion: portion.portionId,
    });
  }
  return rows;
}

export function markFirstSeenArticles(portions: Record<string, unknown>[]): void {
  const seen: Record<"academia" | "palabras", Set<string>> = { academia: new Set(), palabras: new Set() };
  for (const row of portions) {
    for (const key of ["academia", "palabras"] as const) {
      const flagged: { id: string; firstSeenInBook: boolean }[] = [];
      const bucket = seen[key];
      const entries = (row[key] as unknown[]) ?? [];
      for (const entry of entries) {
        const itemId = typeof entry === "object" && entry
          ? String((entry as Record<string, unknown>).id ?? "").trim()
          : String(entry ?? "").trim();
        if (!itemId) continue;
        const token = itemId.toLowerCase();
        const first = !bucket.has(token);
        bucket.add(token);
        flagged.push({ id: itemId, firstSeenInBook: first });
      }
      row[key] = flagged;
    }
  }
}

function articleIds(slots: Record<string, ResourceSlot>, name: string): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of slotItems(slots, name)) {
    const itemId = (item.itemId || "").trim();
    if (!itemId || seen.has(itemId.toLowerCase())) continue;
    seen.add(itemId.toLowerCase());
    ids.push(itemId);
  }
  return ids;
}

function succinctPortion(portion: Portion, slots: Record<string, ResourceSlot>): Record<string, unknown> {
  return {
    id: portion.portionId,
    ref: portion.ref,
    chapter: portion.chapter,
    verses: portion.verses,
    notas: slotItems(slots, "Notas").length,
    preguntas: slotItems(slots, "Preguntas").length,
    notas_items: taskItems(slots, "Notas", portion),
    preguntas_items: taskItems(slots, "Preguntas", portion),
    academia: articleIds(slots, "Academia"),
    palabras: articleIds(slots, "Palabras"),
  };
}

export function inventoryToDict(inventory: PrepInventory, options: { generatedAt?: string } = {}): Record<string, unknown> {
  const chapters: Record<string, unknown>[] = [];
  let portionCount = 0;
  let notasTotal = 0;
  let preguntasTotal = 0;
  let unassignedTotal = 0;

  for (const chapter of inventory.chapters) {
    const portions: Record<string, unknown>[] = [];
    for (const portion of chapter.portions) {
      portionCount += 1;
      const slots = slotsFor(inventory, portion);
      const row = succinctPortion(portion, slots);
      notasTotal += row.notas as number;
      preguntasTotal += row.preguntas as number;
      portions.push(row);
    }
    unassignedTotal += chapter.unassignedQuestions.length;
    chapters.push({
      chapter: chapter.chapter,
      preguntas_sin_asignar: chapter.unassignedQuestions.length,
      portions,
      intro_notes: chapter.introNotes.length,
    });
  }

  markFirstSeenArticles(chapters.flatMap((row) => row.portions as Record<string, unknown>[]));
  const index = publicArticleIndex(inventory);
  const stamp = options.generatedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  return {
    schema: SCHEMA_ID,
    phase: "0-preparacion",
    book: inventory.book,
    mode: inventory.mode,
    generated_at: stamp,
    generator: GENERATOR,
    ult: inventory.ultPath,
    sources: inventory.sources,
    warnings: inventory.warnings,
    counts: {
      chapters: inventory.chapters.length,
      portions: portionCount,
      notas: notasTotal,
      preguntas: preguntasTotal,
      preguntas_sin_asignar: unassignedTotal,
      palabras: index.palabras.length,
      academia: index.academia.length,
      warnings: inventory.warnings.length,
    },
    palabras: index.palabras,
    academia: index.academia,
    preguntas_sin_asignar: unassignedTotal,
    book_intro: inventory.bookIntro.length,
    chapters,
  };
}

export function emitJson(inventory: PrepInventory, options: { generatedAt?: string } = {}): string {
  return `${JSON.stringify(inventoryToDict(inventory, options), null, 2)}\n`;
}
