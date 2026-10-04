import {
  parseArticleOccurrenceId,
  parseTaskItemId,
} from "./assignment";
import { portionKey } from "./chapters";
import { helpsMarkdownPath, type HelpsResource } from "./helpsTarget";
import type { SolverLaunchContext } from "./solverLaunch";
import type { InventoryDoc, Portion } from "./types";
import { portionRange } from "./usfmEdit";
import { parseVerseRef } from "../prep/inventory";
import { parseTsvTable, serializeTsv } from "../prep/tsv";

export type HelpsDraftItem = {
  id: string;
  label: string;
  meta: string;
  text: string;
  secondary?: string;
  secondaryLabel?: string;
  filepath: string;
  kind: "tsv" | "markdown";
  /** A file of an article of the Academy that is not its body: its title, or the question it answers. */
  part?: "title" | "sub-title";
  /** A note: where it is and what it quotes of the original, to show the phrase in the source texts. */
  chapter?: number;
  verse?: number;
  quote?: string;
  occurrence?: number;
};

function matchPortion(inventory: InventoryDoc, portionId: string): Portion | undefined {
  return inventory.portions.find(
    (p) => portionKey(p) === portionId || p.ref === portionId || p.id === portionId,
  );
}

function lookupArticle(
  inventory: InventoryDoc,
  articleId: string,
): { id: string; path: string; title?: string } | undefined {
  const needle = articleId.trim().toLowerCase();
  const hit = inventory.articles.find(
    (a) =>
      a.id.toLowerCase() === needle ||
      a.path.toLowerCase() === needle ||
      a.path.toLowerCase().endsWith(`/${needle}`),
  );
  if (!hit) return undefined;
  return { id: hit.id, path: hit.path, title: hit.title };
}

export function tsvRowId(row: Record<string, string>): string {
  return (row.ID || row.Id || row.id || "").trim();
}

/** IDs from the work order / inventory for this TSV resource; null = filter by ref. */
export function tsvIdsForLaunch(
  ctx: Pick<SolverLaunchContext, "resource" | "portionIds" | "itemIds">,
  inventory: InventoryDoc | null,
): Set<string> | null {
  const ids = new Set<string>();
  if (inventory && (ctx.resource === "notas" || ctx.resource === "preguntas")) {
    for (const pid of ctx.portionIds) {
      const portion = matchPortion(inventory, pid);
      if (!portion) continue;
      const items =
        ctx.resource === "notas" ? portion.notasItems : portion.preguntasItems;
      for (const item of items ?? []) {
        if (item.id) ids.add(item.id);
      }
    }
  }
  for (const raw of ctx.itemIds) {
    const parsed = parseTaskItemId(raw);
    if (parsed && parsed.resource === ctx.resource) ids.add(parsed.id);
  }
  return ids.size ? ids : null;
}

export function tsvRowInPortion(
  row: Record<string, string>,
  ctx: Pick<SolverLaunchContext, "ref" | "chapter">,
): boolean {
  const ref = row.Reference || row.reference || "";
  const parsed = parseVerseRef(ref);
  const range = portionRange(ctx.ref, 0);
  if (parsed && range) {
    if (parsed.chapter !== range.chapter) return false;
    return parsed.verses.some((v) => v >= range.from && v <= range.to);
  }
  const lower = ref.trim().toLowerCase();
  const chapter = range?.chapter || ctx.chapter;
  if (chapter && lower === `${chapter}:intro`) return true;
  return false;
}

/**
 * The helps of a passage: every row of the file that falls on its verses, and those the plan lists by id.
 *
 * The plan's inventory is taken from the source helps, and a file in the team's language may carry other ids
 * (questions written anew, notes added). Trusting the ids alone hid those rows from who translates: the
 * questions of a passage came back empty and its notes, half. The verses are what the passage is; the ids add
 * what the plan gives it from outside them (an introduction).
 */
export function selectTsvRowsForPortion(
  rows: Record<string, string>[],
  ctx: Pick<SolverLaunchContext, "resource" | "portionIds" | "itemIds" | "ref" | "chapter">,
  inventory: InventoryDoc | null,
): Record<string, string>[] {
  const ids = tsvIdsForLaunch(ctx, inventory);
  // Without a plan to say whose the introduction is, every passage of the chapter shows it. With one, it belongs
  // to the passage the plan gave it to (the first of the chapter), even when this passage has no notes of its own.
  if (!ids && !inventory) return rows.filter((row) => tsvRowInPortion(row, ctx));
  const range = portionRange(ctx.ref, 0);
  const onItsVerses = (row: Record<string, string>) => {
    const parsed = parseVerseRef(row.Reference || row.reference || "");
    return Boolean(parsed && range && parsed.chapter === range.chapter && parsed.verses.some((v) => v >= range.from && v <= range.to));
  };
  return rows.filter((row) => ids?.has(tsvRowId(row)) || onItsVerses(row));
}

export function applyHelpsTsvEdits(
  original: string,
  edits: { id: string; fields: Record<string, string> }[],
): string {
  const { headers, rows } = parseTsvTable(original);
  if (!headers.length) return original;
  const byId = new Map(edits.map((e) => [e.id, e.fields]));
  const next = rows.map((row) => {
    const patch = byId.get(tsvRowId(row));
    return patch ? { ...row, ...patch } : row;
  });
  return serializeTsv(headers, next);
}

/**
 * A passage's rows put into the group's help file, row by row.
 *
 * Every passage of a book works on the same file, each on its own rows. Two passages that sit next to each other
 * change neighbouring lines, and Door43 refuses to merge the second one although nobody touched the same row. So
 * the delivery does not merge lines: it takes the group's file as it is now and replaces the rows this draft
 * changed since it started (`ancestor`), adding the ones it added. A row the draft left alone keeps what the group
 * has, whoever changed it meanwhile.
 */
export function mergeTsvRows(trunk: string, work: string, ancestor: string): string {
  const trunkTable = parseTsvTable(trunk);
  const workTable = parseTsvTable(work);
  if (!trunkTable.headers.length) return work;
  const key = (row: Record<string, string>, index: number) => tsvRowId(row) || `#${index}`;
  const same = (x: Record<string, string>, y: Record<string, string>) => trunkTable.headers.every((h) => (x[h] ?? "") === (y[h] ?? ""));
  const before = new Map(parseTsvTable(ancestor).rows.map((row, index) => [key(row, index), row]));
  const mine = new Map(workTable.rows.map((row, index) => [key(row, index), row]));
  const out = trunkTable.rows.map((row, index) => {
    const id = key(row, index);
    const changed = mine.get(id);
    const was = before.get(id);
    return changed && (!was || !same(changed, was)) ? changed : row;
  });
  // Rows the draft added go after the row they followed in the draft.
  const have = new Set(trunkTable.rows.map(key));
  workTable.rows.forEach((row, index) => {
    const id = key(row, index);
    if (have.has(id) || before.has(id)) return;
    const previous = index > 0 ? key(workTable.rows[index - 1]!, index - 1) : "";
    const at = previous ? out.findIndex((r, i) => key(r, i) === previous) : -1;
    out.splice(at >= 0 ? at + 1 : out.length, 0, row);
    have.add(id);
  });
  return serializeTsv(trunkTable.headers, out);
}

function placeOf(row: Record<string, string>): { chapter?: number; verse?: number } {
  const parsed = parseVerseRef(row.Reference || row.reference || "");
  return parsed ? { chapter: parsed.chapter, verse: parsed.verses[0] } : {};
}

export function tsvRowsToDraftItems(
  resource: "notas" | "preguntas",
  filepath: string,
  rows: Record<string, string>[],
): HelpsDraftItem[] {
  return rows.map((row) => {
    const id = tsvRowId(row) || `${row.Reference || "fila"}`;
    if (resource === "notas") {
      return {
        id,
        label: row.Quote || row.Note || id,
        meta: [row.Reference, id].filter(Boolean).join(" · "),
        text: row.Note || "",
        filepath,
        kind: "tsv",
        ...placeOf(row),
        quote: (row.Quote || "").trim(),
        occurrence: Math.max(1, parseInt(row.Occurrence || "1", 10) || 1),
      };
    }
    return {
      id,
      label: row.Question || id,
      meta: [row.Reference, id].filter(Boolean).join(" · "),
      text: row.Question || "",
      secondary: row.Response || "",
      secondaryLabel: "Respuesta",
      filepath,
      kind: "tsv",
      ...placeOf(row),
    };
  });
}

export function collectHelpsArticleRefs(
  ctx: Pick<SolverLaunchContext, "resource" | "portionIds" | "itemIds">,
  inventory: InventoryDoc | null,
): { id: string; path: string; title?: string }[] {
  const resource = ctx.resource as HelpsResource;
  if (resource !== "academia" && resource !== "palabras") return [];
  const out: { id: string; path: string; title?: string }[] = [];
  const seen = new Set<string>();

  function push(id: string, path: string, title?: string) {
    const key = (path || id).toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ id, path, title });
  }

  // A subtarea that names its articles (`articulo:figs-metaphor`) is about those and no others: the ones still to
  // be translated. Listing every article of its passage instead showed the translator the 26 already done beside
  // the one to do, and left out an article that belongs to another passage of the book.
  const named = ctx.itemIds.filter((raw) => raw.startsWith("articulo:")).map((raw) => raw.slice("articulo:".length).trim()).filter(Boolean);
  for (const id of named) {
    const article = inventory ? lookupArticle(inventory, id) : undefined;
    push(article?.id || id, article?.path || id, article?.title);
  }
  if (named.length) return out;

  if (inventory) {
    for (const pid of ctx.portionIds) {
      const portion = matchPortion(inventory, pid);
      if (!portion) continue;
      const refs = resource === "academia" ? portion.academia : portion.palabras;
      for (const ref of refs ?? []) {
        const article = lookupArticle(inventory, ref.id);
        push(article?.id || ref.id, article?.path || ref.id, article?.title);
      }
    }
  }

  for (const raw of ctx.itemIds) {
    const occ = parseArticleOccurrenceId(raw);
    if (!occ) continue;
    const article = inventory ? lookupArticle(inventory, occ.articleId) : undefined;
    push(article?.id || occ.articleId, article?.path || occ.articleId, article?.title);
  }

  return out;
}

export function articleRefsToDraftItems(
  resource: "academia" | "palabras",
  refs: { id: string; path: string; title?: string }[],
): HelpsDraftItem[] {
  const out: HelpsDraftItem[] = [];
  for (const ref of refs) {
    const filepath = helpsMarkdownPath(resource, ref);
    if (!filepath) continue;
    // An article of the Academy is a folder: its title and its sub-title are files of their own, and an article
    // translated without them still shows its name in the source language.
    if (resource === "academia" && /\/01\.md$/i.test(filepath)) {
      for (const part of ["title", "sub-title"] as const) {
        out.push({ id: `${ref.id || filepath}#${part}`, label: ref.title?.trim() || ref.id, meta: filepath.replace(/01\.md$/i, `${part}.md`), text: "", filepath: filepath.replace(/01\.md$/i, `${part}.md`), kind: "markdown", part });
      }
    }
    out.push({
      id: ref.id || filepath,
      label: ref.title?.trim() || ref.id,
      meta: filepath,
      text: "",
      filepath,
      kind: "markdown",
    });
  }
  return out;
}

export function tsvFieldsForItem(
  resource: "notas" | "preguntas",
  item: HelpsDraftItem,
): Record<string, string> {
  if (resource === "notas") return { Note: item.text };
  return { Question: item.text, Response: item.secondary ?? "" };
}
