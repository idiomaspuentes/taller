/**
 * Port of idiomas-puentes-docs/scripts/fcr_prep/models.py.
 * Data models for Preparación inventories.
 */

export const PUBLIC_RESOURCES = ["TPL", "TPS", "Notas", "Palabras", "Preguntas", "Academia"] as const;

export const STATUS_PENDIENTE = "pendiente";
export const STATUS_IDENTIFICADO = "identificado";
export const STATUS_YA = "ya";
export const STATUS_REVISAR = "revisar_limite";
export const STATUS_PRODUCIR = "hay_que_producir";

export type PortionSource = "ts" | "capitulo_sin_ts" | "antes_del_ts";

export class Portion {
  book: string;
  chapter: number;
  index: number;
  verses: number[];
  source: PortionSource;
  tsSid: string;

  constructor(params: {
    book: string;
    chapter: number;
    index: number;
    verses: number[];
    source: PortionSource;
    tsSid?: string;
  }) {
    this.book = params.book;
    this.chapter = params.chapter;
    this.index = params.index;
    this.verses = params.verses;
    this.source = params.source;
    this.tsSid = params.tsSid ?? "";
  }

  get start(): number {
    return this.verses.length ? this.verses[0] : 0;
  }

  get end(): number {
    return this.verses.length ? this.verses[this.verses.length - 1] : 0;
  }

  get ref(): string {
    if (!this.verses.length) return `${this.book} ${this.chapter}`;
    if (this.start === this.end) return `${this.book} ${this.chapter}:${this.start}`;
    return `${this.book} ${this.chapter}:${this.start}-${this.end}`;
  }

  get portionId(): string {
    const chapter = String(this.chapter).padStart(2, "0");
    const index = String(this.index).padStart(2, "0");
    return `${this.book}-${chapter}-${index}`;
  }

  containsVerse(chapter: number, verse: number): boolean {
    return chapter === this.chapter && this.verses.includes(verse);
  }
}

export type ResourceItem = {
  itemId: string;
  ref: string;
  label: string;
  path: string;
  rc: string;
  status: string;
  extra: Record<string, unknown>;
};

export function makeResourceItem(params: Partial<ResourceItem> & { itemId: string; ref: string }): ResourceItem {
  return {
    itemId: params.itemId,
    ref: params.ref,
    label: params.label ?? "",
    path: params.path ?? "",
    rc: params.rc ?? "",
    status: params.status ?? STATUS_IDENTIFICADO,
    extra: params.extra ?? {},
  };
}

export function resourceItemToDict(item: ResourceItem): Record<string, unknown> {
  const data: Record<string, unknown> = {
    id: item.itemId,
    ref: item.ref,
    label: item.label,
    path: item.path,
    status: item.status,
  };
  if (item.rc) data.rc = item.rc;
  if (Object.keys(item.extra).length) Object.assign(data, item.extra);
  return data;
}

export type ResourceSlot = {
  resource: string;
  status: string;
  items: ResourceItem[];
  note: string;
};

export function makeResourceSlot(params: Partial<ResourceSlot> & { resource: string; status: string }): ResourceSlot {
  return {
    resource: params.resource,
    status: params.status,
    items: params.items ?? [],
    note: params.note ?? "",
  };
}

export type ChapterWork = {
  chapter: number;
  portions: Portion[];
  introNotes: ResourceItem[];
  unassignedQuestions: ResourceItem[];
};

export type PrepInventory = {
  book: string;
  ultPath: string;
  mode: "usfm-only" | "package";
  chapters: ChapterWork[];
  warnings: string[];
  bookIntro: ResourceItem[];
  sources: Record<string, string>;
  portionSlots: Record<string, Record<string, ResourceSlot>>;
};

export function slotsFor(inventory: PrepInventory, portion: Portion): Record<string, ResourceSlot> {
  return inventory.portionSlots[portion.portionId] ?? {};
}
