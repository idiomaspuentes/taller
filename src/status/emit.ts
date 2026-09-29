/**
 * Port of the succinct-JSON path of idiomas-puentes-docs/scripts/fcr_status/emit.py.
 * Verbose output (evidence/dcs per article, thresholds) is skipped: the
 * gateway-tasks worker never requests --verbose.
 */

import { STATUS_TRANSLATED } from "./detect";
import { KIND_ACADEMIA } from "./collect";
import { STATUS_MISSING, STATUS_ENGLISH, STATUS_INCOMPLETE, type ArticleStatus } from "./check";

const SCHEMA_ID = "article-status-1";
const SUBJECT_FALLBACK = "subject";

function emptyCounts(): Record<string, number> {
  return { [STATUS_TRANSLATED]: 0, [STATUS_ENGLISH]: 0, [STATUS_INCOMPLETE]: 0, [STATUS_MISSING]: 0 };
}

function countByKind(results: ArticleStatus[]): Record<string, Record<string, number>> {
  const byKind: Record<string, Record<string, number>> = {
    palabras: emptyCounts(),
    academia: emptyCounts(),
    total: emptyCounts(),
  };
  for (const item of results) {
    const bucket = item.ref.kind === KIND_ACADEMIA ? "academia" : "palabras";
    byKind[bucket][item.status] = (byKind[bucket][item.status] ?? 0) + 1;
    byKind.total[item.status] = (byKind.total[item.status] ?? 0) + 1;
  }
  byKind.palabras.articles = Object.keys(emptyCounts()).reduce((sum, key) => sum + byKind.palabras[key], 0);
  byKind.academia.articles = Object.keys(emptyCounts()).reduce((sum, key) => sum + byKind.academia[key], 0);
  byKind.total.articles = results.length;
  return byKind;
}

function subjectLabel(kind: string, subjects: Record<string, string> | null): string {
  const value = subjects?.[kind]?.trim();
  return value || SUBJECT_FALLBACK;
}

function articleTitle(item: ArticleStatus): string {
  for (const [path, text] of item.fetched.files) {
    const name = path.replace(/\\/g, "/").split("/").pop()!.toLowerCase();
    if (name === "title.md") {
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) return line.trim();
      }
      return "";
    }
  }
  for (const [, text] of item.fetched.files) {
    for (const line of text.split(/\r?\n/)) {
      const stripped = line.trim();
      if (stripped.startsWith("#")) return stripped.replace(/^#+/, "").trim();
    }
  }
  return "";
}

function itemIds(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  const ids: string[] = [];
  for (const item of items) {
    if (item && typeof item === "object") {
      const id = String((item as Record<string, unknown>).id ?? "").trim();
      if (id) ids.push(id);
    } else if (typeof item === "string" && item.trim()) {
      ids.push(item.trim());
    }
  }
  return ids;
}

function taskRows(items: unknown): { id: string; ref: string }[] {
  const rows: { id: string; ref: string }[] = [];
  if (!Array.isArray(items)) return rows;
  const seen = new Set<string>();
  for (const item of items) {
    let id = "";
    let ref = "";
    if (item && typeof item === "object") {
      id = String((item as Record<string, unknown>).id ?? "").trim();
      ref = String((item as Record<string, unknown>).ref ?? "").trim();
    } else if (typeof item === "string" && item.trim()) {
      id = item.trim();
    } else {
      continue;
    }
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({ id, ref });
  }
  return rows;
}

function slotItemsOf(portion: Record<string, unknown>, slotName: string): unknown[] {
  const pkg = portion.paquete_parcial;
  const slot = pkg && typeof pkg === "object" ? (pkg as Record<string, unknown>)[slotName] : null;
  const items = slot && typeof slot === "object" ? (slot as Record<string, unknown>).items : null;
  return Array.isArray(items) ? items : [];
}

function slotCountAndTasks(
  portion: Record<string, unknown>,
  countKey: string,
  slotName: string,
  itemsKey: string,
): { count: number; tasks: { id: string; ref: string }[] } {
  const items = slotItemsOf(portion, slotName);
  let tasks = taskRows(portion[itemsKey]);
  if (!tasks.length) tasks = taskRows(items);
  const raw = portion[countKey];
  let count: number;
  if (typeof raw === "number") count = raw;
  else if (tasks.length) count = tasks.length;
  else count = items.length;
  return { count, tasks };
}

function articleIdsOf(portion: Record<string, unknown>, key: string, slotName: string): string[] {
  const existing = itemIds(portion[key]);
  if (existing.length) return existing;
  return itemIds(slotItemsOf(portion, slotName));
}

function markFirstSeen(rows: Record<string, unknown>[]): void {
  const seen: Record<"academia" | "palabras", Set<string>> = { academia: new Set(), palabras: new Set() };
  for (const row of rows) {
    for (const key of ["academia", "palabras"] as const) {
      const flagged: { id: string; firstSeenInBook: boolean }[] = [];
      const bucket = seen[key];
      const entries = (row[key] as unknown[]) ?? [];
      for (const entry of entries) {
        const id =
          entry && typeof entry === "object"
            ? String((entry as Record<string, unknown>).id ?? "").trim()
            : String(entry ?? "").trim();
        if (!id) continue;
        const token = id.toLowerCase();
        const first = !bucket.has(token);
        bucket.add(token);
        flagged.push({ id, firstSeenInBook: first });
      }
      row[key] = flagged;
    }
  }
}

function unassignedEntries(raw: unknown): { count: number; refs: { id: string; ref: string }[] } {
  if (typeof raw === "number") return { count: raw, refs: [] };
  if (!Array.isArray(raw)) return { count: 0, refs: [] };
  const refs: { id: string; ref: string }[] = [];
  for (const item of raw) {
    if (item && typeof item === "object") {
      refs.push({
        id: String((item as Record<string, unknown>).id ?? "").trim(),
        ref: String((item as Record<string, unknown>).ref ?? "").trim(),
      });
    } else if (typeof item === "string" && item.trim()) {
      refs.push({ id: item.trim(), ref: "" });
    }
  }
  return { count: raw.length, refs };
}

/** Flatten prep chapters into app-facing portion rows with note/question tasks. */
export function portionsFromPrep(data: Record<string, unknown> | null): Record<string, unknown>[] {
  if (!data) return [];
  const rows: Record<string, unknown>[] = [];
  const chapters = (data.chapters as unknown[]) ?? [];
  for (const chapter of chapters) {
    if (!chapter || typeof chapter !== "object") continue;
    const chapterNum = (chapter as Record<string, unknown>).chapter;
    const portions = ((chapter as Record<string, unknown>).portions as unknown[]) ?? [];
    for (const portion of portions) {
      if (!portion || typeof portion !== "object") continue;
      const p = portion as Record<string, unknown>;
      const { count: notas, tasks: notasTasks } = slotCountAndTasks(p, "notas", "Notas", "notas_items");
      const { count: preguntas, tasks: preguntasTasks } = slotCountAndTasks(p, "preguntas", "Preguntas", "preguntas_items");
      const { count: tpl, tasks: tplTasks } = slotCountAndTasks(p, "tpl", "TPL", "tpl_items");
      const { count: tps, tasks: tpsTasks } = slotCountAndTasks(p, "tps", "TPS", "tps_items");
      const chapterVal = p.chapter ?? chapterNum;
      const portionId = String(p.id ?? "").trim();
      const row: Record<string, unknown> = {
        id: portionId,
        ref: String(p.ref ?? ""),
        chapter: chapterVal,
        verses: p.verses ?? [],
        tpl,
        tps,
        notas,
        preguntas,
        tpl_items: tplTasks.map((t) => ({ id: t.id, ref: t.ref, chapter: chapterVal, portion: portionId })),
        tps_items: tpsTasks.map((t) => ({ id: t.id, ref: t.ref, chapter: chapterVal, portion: portionId })),
        notas_items: notasTasks.map((t) => ({ id: t.id, ref: t.ref, chapter: chapterVal, portion: portionId })),
        preguntas_items: preguntasTasks.map((t) => ({ id: t.id, ref: t.ref, chapter: chapterVal, portion: portionId })),
        academia: articleIdsOf(p, "academia", "Academia"),
        palabras: articleIdsOf(p, "palabras", "Palabras"),
      };
      rows.push(row);
    }
  }
  markFirstSeen(rows);
  return rows;
}

/** Count Preguntas that cross portions; do not fold them into a portion. */
export function unassignedFromPrep(data: Record<string, unknown> | null): { count: number; refs: { id: string; ref: string }[] } {
  if (!data) return { count: 0, refs: [] };
  let total = 0;
  const refs: { id: string; ref: string }[] = [];
  let sawChapter = false;
  const chapters = (data.chapters as unknown[]) ?? [];
  for (const chapter of chapters) {
    if (!chapter || typeof chapter !== "object" || !("preguntas_sin_asignar" in chapter)) continue;
    sawChapter = true;
    const { count, refs: chapterRefs } = unassignedEntries((chapter as Record<string, unknown>).preguntas_sin_asignar);
    total += count;
    refs.push(...chapterRefs);
  }
  if (sawChapter) return { count: total, refs };
  return unassignedEntries(data.preguntas_sin_asignar);
}

function succinctDcs(dcs: Record<string, unknown> | null): Record<string, unknown> {
  if (!dcs) return {};
  const short: Record<string, unknown> = {};
  for (const key of ["org", "ta_repo", "tw_repo", "branch"]) {
    if (dcs[key]) short[key] = dcs[key];
  }
  return short;
}

function succinctArticle(item: ArticleStatus, subjects: Record<string, string> | null): Record<string, unknown> {
  const fetched = item.fetched;
  const row: Record<string, unknown> = {
    id: item.ref.articleId,
    kind: subjectLabel(item.ref.kind, subjects),
    path: fetched.path || item.ref.path,
    status: item.status,
  };
  const title = articleTitle(item);
  if (title) row.title = title;
  if (item.status === STATUS_MISSING) {
    const parent = item.evidence.parent;
    if (parent) row.parent = parent;
  }
  return row;
}

export function statusToDict(
  results: ArticleStatus[],
  options: {
    generatedAt?: string;
    book?: string;
    dcs?: Record<string, unknown> | null;
    subjects?: Record<string, string> | null;
    prep?: Record<string, unknown> | null;
  } = {},
): Record<string, unknown> {
  const stamp = options.generatedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const prep = options.prep ?? null;
  const portions = portionsFromPrep(prep);
  const { count: unassigned } = unassignedFromPrep(prep);

  const payload: Record<string, unknown> = {
    schema: SCHEMA_ID,
    generated_at: stamp,
    book: options.book ?? "",
    dcs: succinctDcs(options.dcs ?? null),
    counts: countByKind(results),
  };
  if (prep !== null) {
    payload.portions = portions;
    payload.preguntas_sin_asignar = unassigned;
  }
  payload.articles = results.map((item) => succinctArticle(item, options.subjects ?? null));
  return payload;
}

export function emitJson(results: ArticleStatus[], options: Parameters<typeof statusToDict>[1] = {}): string {
  return `${JSON.stringify(statusToDict(results, options), null, 2)}\n`;
}
