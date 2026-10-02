/**
 * Orchestrates the fcr_prep port end to end — the TS equivalent of
 * `prep_portions.py --ult … --book … --tn … --tq … --twl … --format json`.
 */

import { detectBookCode, parseUsfmEvents } from "./parseUsfm";
import { splitPortions, type PortionStarts } from "./chunks";
import { buildInventory } from "./inventory";
import { emitJson, inventoryToDict } from "./emit";

export type PrepInput = {
  book?: string;
  ultText: string;
  ultPath?: string;
  tn?: { path: string; text: string } | null;
  tq?: { path: string; text: string } | null;
  twl?: { path: string; text: string } | null;
  hasUst?: boolean;
  ustPath?: string;
  chapterFilter?: number | null;
  /** Portions cut where the project says, instead of where the source does (see `regroupPortions`). */
  portionStarts?: PortionStarts;
  generatedAt?: string;
};

function prepareInventory(input: PrepInput) {
  const usfm = input.ultText;
  const book = detectBookCode(usfm, input.book ?? "");
  if (!book) {
    throw new Error("No se pudo determinar el libro. Pasa --book TIT (u otro código).");
  }

  const events = parseUsfmEvents(usfm);
  const { portions, warnings } = splitPortions(book, events, {
    chapterFilter: input.chapterFilter ?? null,
    starts: input.portionStarts,
  });

  return buildInventory({
    book,
    ultPath: input.ultPath ?? "",
    portions,
    warnings,
    tn: input.tn ?? null,
    tq: input.tq ?? null,
    twl: input.twl ?? null,
    hasUst: input.hasUst,
    ustPath: input.ustPath,
    published: new Set(),
  });
}

export function runPrep(input: PrepInput): Record<string, unknown> {
  return inventoryToDict(prepareInventory(input), { generatedAt: input.generatedAt });
}

export function runPrepJson(input: PrepInput): string {
  return emitJson(prepareInventory(input), { generatedAt: input.generatedAt });
}
