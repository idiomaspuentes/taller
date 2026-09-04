/**
 * Port of idiomas-puentes-docs/scripts/fcr_prep/inventory.py.
 * Resolve the six public package resources for each porción.
 *
 * `--published` (an "already in Spanish" inventory file) is a filesystem-only
 * CLI flag the gateway-tasks worker never passes, so `_published_status`
 * always sees an empty set here and this port omits `load_published`.
 */

import {
  makeResourceItem,
  makeResourceSlot,
  Portion,
  STATUS_IDENTIFICADO,
  STATUS_PENDIENTE,
  STATUS_PRODUCIR,
  STATUS_REVISAR,
  STATUS_YA,
  type ChapterWork,
  type PrepInventory,
  type ResourceItem,
  type ResourceSlot,
} from "./models";
import { readTsv } from "./tsv";

const REF_RE = /^(?:(?<book>[A-Z0-9]{2,3})\s+)?(?<chapter>\d+):(?<start>\d+)(?:-(?<end>\d+))?$/i;
const RC_TW_RE = /rc:\/\/[^/]*\/tw\/dict\/(?<path>bible\/[^#\s]+)/i;
const RC_TA_RE = /rc:\/\/[^/]*\/ta\/man\/(?<path>[^#\s]+)/i;

export function parseVerseRef(ref: string): { chapter: number; verses: number[] } | null {
  const text = (ref || "").trim();
  if (!text || text.toLowerCase().includes("intro") || text.toLowerCase().startsWith("front")) {
    return null;
  }
  const match = REF_RE.exec(text);
  if (!match || !match.groups) return null;
  const chapter = parseInt(match.groups.chapter, 10);
  const start = parseInt(match.groups.start, 10);
  let end = match.groups.end ? parseInt(match.groups.end, 10) : start;
  if (end < start) end = start;
  const verses: number[] = [];
  for (let v = start; v <= end; v++) verses.push(v);
  return { chapter, verses };
}

export function isIntroRef(ref: string): boolean {
  return (ref || "").toLowerCase().includes("intro");
}

export function supportReferenceOf(row: Record<string, string>): string {
  for (const key of [
    "SupportReference",
    "support-reference",
    "support_reference",
    "Support-Reference",
    "supportReference",
  ]) {
    const value = (row[key] || "").trim();
    if (value) return value;
  }
  return "";
}

function legacyTnRows(rows: Record<string, string>[]): Record<string, string>[] {
  if (!rows.length) return rows;
  const first = rows[0];
  if ("Reference" in first) return rows;
  if ("Chapter" in first && "Verse" in first) {
    return rows.map((row) => {
      const chapter = row.Chapter || "";
      const verse = row.Verse || "";
      const ref = chapter ? `${chapter}:${verse}` : verse;
      return {
        Reference: ref,
        ID: row.ID || "",
        Tags: row.Tags || "",
        SupportReference: supportReferenceOf(row),
        Quote: row.OrigQuote || row.GLQuote || "",
        Occurrence: row.Occurrence || "",
        Note: row.OccurrenceNote || row.Note || "",
      };
    });
  }
  return rows;
}

export function twPathFromRc(rc: string): string {
  const match = RC_TW_RE.exec(rc);
  return match?.groups?.path ?? "";
}

export function taPathFromRc(rc: string): string {
  const match = RC_TA_RE.exec(rc);
  if (match?.groups?.path) return match.groups.path;
  const text = rc.trim();
  if (text && !text.includes("://") && !text.includes("/")) return `translate/${text}`;
  if (text.startsWith("translate/") || text.startsWith("checking/") || text.startsWith("intro/")) {
    return text;
  }
  return "";
}

function publishedStatus(path: string, published: Set<string>): string {
  if (!published.size) return STATUS_IDENTIFICADO;
  const lower = path.toLowerCase();
  const tail = lower.includes("/") ? lower.slice(lower.lastIndexOf("/") + 1) : lower;
  const tokens = new Set([lower, tail]);
  let matched = false;
  for (const value of tokens) {
    if (published.has(value)) {
      matched = true;
      break;
    }
  }
  if (!matched) {
    for (const p of published) {
      if (p.endsWith(lower) || lower.endsWith(p)) {
        matched = true;
        break;
      }
    }
  }
  return matched ? STATUS_YA : STATUS_PRODUCIR;
}

export function portionsOverlapping(portions: Portion[], chapter: number, verses: number[]): Portion[] {
  return portions.filter((p) => p.chapter === chapter && verses.some((v) => p.verses.includes(v)));
}

export function emptySlots(portion: Portion, hasUst: boolean): Record<string, ResourceSlot> {
  const tpl = makeResourceSlot({
    resource: "TPL",
    status: STATUS_IDENTIFICADO,
    note: `Adaptar ULT ${portion.ref} a TPL.`,
    items: [
      makeResourceItem({
        itemId: `tpl-${portion.portionId}`,
        ref: portion.ref,
        label: `ULT ${portion.ref}`,
        status: STATUS_IDENTIFICADO,
      }),
    ],
  });
  const tps = makeResourceSlot({
    resource: "TPS",
    status: hasUst ? STATUS_IDENTIFICADO : STATUS_PENDIENTE,
    note: hasUst
      ? `Adaptar UST ${portion.ref} a TPS.`
      : `Rango ${portion.ref} (falta UST / --ust para confirmar el texto).`,
    items: [
      makeResourceItem({
        itemId: `tps-${portion.portionId}`,
        ref: portion.ref,
        label: `UST ${portion.ref}`,
        status: hasUst ? STATUS_IDENTIFICADO : STATUS_PENDIENTE,
      }),
    ],
  });
  const slots: Record<string, ResourceSlot> = { TPL: tpl, TPS: tps };
  for (const name of ["Notas", "Palabras", "Preguntas", "Academia"]) {
    slots[name] = makeResourceSlot({
      resource: name,
      status: STATUS_PENDIENTE,
      note: "Sin archivo compañero; el inventario queda pendiente.",
    });
  }
  return slots;
}

export type BuildInventoryParams = {
  book: string;
  ultPath: string;
  portions: Portion[];
  warnings: string[];
  tn?: { path: string; text: string } | null;
  tq?: { path: string; text: string } | null;
  twl?: { path: string; text: string } | null;
  hasUst?: boolean;
  ustPath?: string;
  published?: Set<string>;
};

export function buildInventory(params: BuildInventoryParams): PrepInventory {
  const { book, ultPath, portions, warnings: initialWarnings } = params;
  const published = params.published ?? new Set<string>();
  const hasUst = Boolean(params.hasUst);
  const hasHelpers = Boolean(params.tn || params.tq || params.twl || hasUst);
  const mode: PrepInventory["mode"] = hasHelpers ? "package" : "usfm-only";

  const sources: Record<string, string> = { ult: ultPath };
  if (hasUst && params.ustPath) sources.ust = params.ustPath;
  if (params.tn) sources.notas = params.tn.path;
  if (params.tq) sources.preguntas = params.tq.path;
  if (params.twl) sources.enlaces_palabras = params.twl.path;

  const inventory: PrepInventory = {
    book,
    ultPath,
    mode,
    chapters: [],
    warnings: [...initialWarnings],
    bookIntro: [],
    sources,
    portionSlots: {},
  };

  const byChapter = new Map<number, Portion[]>();
  for (const portion of portions) {
    const list = byChapter.get(portion.chapter) ?? [];
    list.push(portion);
    byChapter.set(portion.chapter, list);
    inventory.portionSlots[portion.portionId] = emptySlots(portion, hasUst);
  }

  const tnRows = params.tn ? legacyTnRows(readTsv(params.tn.text)) : [];
  const tqRows = params.tq ? readTsv(params.tq.text) : [];
  const twlRows = params.twl ? readTsv(params.twl.text) : [];

  const introByChapter = new Map<number, ResourceItem[]>();

  for (const row of tnRows) {
    const ref = row.Reference || "";
    const support = supportReferenceOf(row);
    const item = makeResourceItem({
      itemId: row.ID || "",
      ref,
      label: (row.Quote || row.Note || "").slice(0, 80),
      path: "",
      rc: support,
      status: STATUS_IDENTIFICADO,
      extra: { tags: row.Tags || "" },
    });
    if (ref.toLowerCase().startsWith("front")) {
      inventory.bookIntro.push(item);
      continue;
    }
    const parsed = parseVerseRef(ref);
    if (parsed === null && isIntroRef(ref)) {
      const chapterStr = ref.split(":", 1)[0];
      const chapter = parseInt(chapterStr, 10);
      if (Number.isNaN(chapter)) continue;
      const list = introByChapter.get(chapter) ?? [];
      list.push(item);
      introByChapter.set(chapter, list);
      continue;
    }
    if (parsed === null) continue;
    const { chapter, verses } = parsed;
    const hits = portionsOverlapping(portions, chapter, verses);
    if (!hits.length) continue;
    if (hits.length > 1) {
      inventory.warnings.push(
        `Nota ${item.itemId || ref} (${ref}) cruza porciones ` +
          hits.map((p) => p.ref).join(", ") +
          ". Revisar el límite (no se duplica).",
      );
      item.status = STATUS_REVISAR;
      continue;
    }
    const slot = inventory.portionSlots[hits[0].portionId].Notas;
    slot.items.push(item);
    slot.status = STATUS_IDENTIFICADO;
    slot.note = `${slot.items.length} nota(s) en ${hits[0].ref}.`;

    const taPath = taPathFromRc(support);
    if (taPath) {
      const acad = inventory.portionSlots[hits[0].portionId].Academia;
      if (!acad.items.some((existing) => existing.path === taPath)) {
        acad.items.push(
          makeResourceItem({
            itemId: taPath.includes("/") ? taPath.slice(taPath.lastIndexOf("/") + 1) : taPath,
            ref,
            label: taPath.includes("/") ? taPath.slice(taPath.lastIndexOf("/") + 1) : taPath,
            path: taPath,
            rc: support,
            status: publishedStatus(taPath, published),
          }),
        );
        if (acad.items.some((it) => it.status === STATUS_PRODUCIR)) {
          acad.status = STATUS_PRODUCIR;
          acad.note = "Artículos de Academia a producir o comprobar.";
        } else if (acad.items.some((it) => it.status === STATUS_YA)) {
          acad.status = STATUS_YA;
          acad.note = "Artículos de Academia ya publicados en español (lista de informática).";
        } else {
          acad.status = STATUS_IDENTIFICADO;
          acad.note = `${acad.items.length} artículo(s) de Academia enlazado(s) desde Notas.`;
        }
      }
    }
  }

  for (const row of tqRows) {
    const ref = row.Reference || "";
    const parsed = parseVerseRef(ref);
    const item = makeResourceItem({
      itemId: row.ID || "",
      ref,
      label: (row.Question || "").slice(0, 120),
      status: STATUS_IDENTIFICADO,
      extra: { response: (row.Response || "").slice(0, 120) },
    });
    if (parsed === null) continue;
    const { chapter, verses } = parsed;
    const hits = portionsOverlapping(portions, chapter, verses);
    if (!hits.length) continue;
    if (hits.length > 1) {
      item.status = STATUS_REVISAR;
      inventory.warnings.push(
        `Pregunta ${item.itemId || ref} (${ref}) depende de más de una porción (` +
          hits.map((p) => p.ref).join(", ") +
          "). Ajustar el límite o la asignación; no se duplica ni se elige una porción «principal».",
      );
      continue;
    }
    const slot = inventory.portionSlots[hits[0].portionId].Preguntas;
    slot.items.push(item);
    slot.status = STATUS_IDENTIFICADO;
    slot.note = `${slot.items.length} pregunta(s) asignada(s) a ${hits[0].ref}.`;
  }

  const unassigned = new Map<number, ResourceItem[]>();
  for (const row of tqRows) {
    const ref = row.Reference || "";
    const parsed = parseVerseRef(ref);
    if (parsed === null) continue;
    const { chapter, verses } = parsed;
    const hits = portionsOverlapping(portions, chapter, verses);
    if (hits.length > 1) {
      const list = unassigned.get(chapter) ?? [];
      list.push(
        makeResourceItem({
          itemId: row.ID || "",
          ref,
          label: (row.Question || "").slice(0, 120),
          status: STATUS_REVISAR,
        }),
      );
      unassigned.set(chapter, list);
    }
  }

  for (const row of twlRows) {
    const ref = row.Reference || "";
    const parsed = parseVerseRef(ref);
    if (parsed === null) continue;
    const rc = row.TWLink || row.twlink || "";
    const path = twPathFromRc(rc);
    if (!path) continue;
    const { chapter, verses } = parsed;
    const hits = portionsOverlapping(portions, chapter, verses);
    if (!hits.length) continue;
    // Word links are per occurrence; attach the article to every overlapping
    // porción (same article may serve several porciones — that is expected).
    for (const portion of hits) {
      const slot = inventory.portionSlots[portion.portionId].Palabras;
      const existing = slot.items.find((e) => e.path === path);
      if (existing) {
        const occ = (existing.extra.occurrences as unknown[] | undefined) ?? [];
        occ.push({ ref, link_id: row.ID || "" });
        existing.extra.occurrences = occ;
        continue;
      }
      slot.items.push(
        makeResourceItem({
          itemId: path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path,
          ref,
          label: path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path,
          path,
          rc,
          status: publishedStatus(path, published),
          extra: { occurrences: [{ ref, link_id: row.ID || "" }] },
        }),
      );
      if (slot.items.some((it) => it.status === STATUS_PRODUCIR)) {
        slot.status = STATUS_PRODUCIR;
        slot.note = "Artículos de Palabras a producir o comprobar.";
      } else if (slot.items.some((it) => it.status === STATUS_YA)) {
        slot.status = STATUS_YA;
        slot.note = "Artículos de Palabras ya publicados en español (lista de informática).";
      } else {
        slot.status = STATUS_IDENTIFICADO;
        slot.note = `${slot.items.length} artículo(s) de Palabras en ${portion.ref}.`;
      }
    }
  }

  const chapterWork: ChapterWork[] = [];
  for (const chapter of [...byChapter.keys()].sort((a, b) => a - b)) {
    chapterWork.push({
      chapter,
      portions: byChapter.get(chapter) ?? [],
      introNotes: introByChapter.get(chapter) ?? [],
      unassignedQuestions: unassigned.get(chapter) ?? [],
    });
  }
  inventory.chapters = chapterWork;

  finalizeEmptySlots(inventory, {
    hasTn: Boolean(params.tn),
    hasTq: Boolean(params.tq),
    hasTwl: Boolean(params.twl),
    hasTa: Boolean(params.tn),
  });

  return inventory;
}

function finalizeEmptySlots(
  inventory: PrepInventory,
  provided: { hasTn: boolean; hasTq: boolean; hasTwl: boolean; hasTa: boolean },
): void {
  const map: Record<string, boolean> = {
    Notas: provided.hasTn,
    Preguntas: provided.hasTq,
    Palabras: provided.hasTwl,
    Academia: provided.hasTa,
  };
  for (const slots of Object.values(inventory.portionSlots)) {
    for (const [name, wasProvided] of Object.entries(map)) {
      const slot = slots[name];
      if (!slot || slot.items.length || !wasProvided) continue;
      slot.status = STATUS_IDENTIFICADO;
      slot.note = `Ningún ítem de ${name} en este rango.`;
    }
  }
}
