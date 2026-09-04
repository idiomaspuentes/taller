/** Domain types for gateway-tasks (schema gateway-assignments-1). */

export type ArticleStatus = "translated" | "english" | "incomplete" | "missing";
export type ItemType = "articulo" | "porcion" | "tarea";
/**
 * How a resource (or a legacy whole team) is listed.
 * `chapter` / `portionsInChapter` stay loadable for older teams.
 * New teams use `item` | `portion` | `portionRefs` per rule.
 */
export type AssignmentGrain = "item" | "portion" | "chapter" | "portionsInChapter" | "portionRefs";
/** Shared geographic unit when “asignar juntos” is on. */
export type BundleGrain = "portion" | "chapterPortions" | "chapter";
export type TaskResource = "notas" | "preguntas";
export type AssignmentState = "sin asignar" | "asignado" | "en curso" | "hecho";
export type ScopeKey = "notas" | "preguntas" | "academia" | "palabras";

export type StatusCounts = {
  translated: number;
  english: number;
  incomplete: number;
  missing: number;
  articles: number;
};

export type Article = {
  id: string;
  kind: string;
  path: string;
  status: ArticleStatus;
  title?: string;
  parent?: string;
};

export type InventoryTask = {
  id: string;
  ref: string;
  chapter: number;
  portionId: string;
  resource: TaskResource;
};

export type PortionArticleRef = {
  id: string;
  firstSeenInBook: boolean;
};

export type Portion = {
  id: string;
  ref: string;
  chapter: number;
  verses: number[];
  notas: number;
  preguntas: number;
  notasItems: InventoryTask[];
  preguntasItems: InventoryTask[];
  academia: PortionArticleRef[];
  palabras: PortionArticleRef[];
};

export type InventoryDoc = {
  schema?: string;
  generated_at?: string;
  book: string;
  lang?: string;
  contentOrg?: string;
  dcs?: {
    org?: string;
    ta_repo?: string;
    tw_repo?: string;
    branch?: string;
  };
  counts?: {
    palabras?: Partial<StatusCounts>;
    academia?: Partial<StatusCounts>;
    total?: Partial<StatusCounts>;
  };
  portions: Portion[];
  preguntas_sin_asignar?: number;
  articles: Article[];
};

export type Person = {
  id: string;
  name: string;
};

/**
 * Scope matcher persisted on each resource rule.
 * `pending` / `all` stay loadable for older teams.
 * Article resources also use inventory `status` values.
 * Portion resources only evaluate `pending` (count > 0) and `all`.
 */
export type ArticleFilter =
  | "pending"
  | "all"
  | "translated"
  | "english"
  | "incomplete"
  | "missing";

export type ScopeRule = {
  resource: ScopeKey;
  articleFilter: ArticleFilter;
  /**
   * How this resource is listed. Missing on older teams: inherit `Team.grain`.
   */
  grain?: AssignmentGrain;
  /**
   * Selected portions (or auto-grouping) stay inside one chapter.
   * Default ON for `portionRefs` / chapter grains unless the user allows the whole book.
   */
  stayInChapter?: boolean;
  /**
   * Academia/Palabras: keep one row per citing portion (Ya citado when not first).
   * Default ON for portion-reference grains.
   */
  includeDuplicates?: boolean;
  chapter?: number;
  portionIds?: string[];
  itemIds?: string[];
};

export type TeamBundle = {
  enabled: boolean;
  grain: BundleGrain;
  chapter?: number;
  portionIds?: string[];
};

export type Team = {
  id: string;
  name: string;
  /** Free-text phase / role note (e.g. "Borrador", "Revisión"). */
  description: string;
  memberIds: string[];
  /**
   * Legacy derived resource list. Kept so older `gateway-assignments-1`
   * documents still load; prefer `rules` for matching.
   */
  scope: ScopeKey[];
  /**
   * Mixed per-resource filters (union). A team can include several resources,
   * each with its own inventory-backed filter and grain. Overlap across teams is a phase, not a conflict.
   */
  rules: ScopeRule[];
  /**
   * Legacy team-level grain. Missing on older docs and on new teams that
   * store grain on `rules[]`. Still applied to every resource when loading.
   */
  grain?: AssignmentGrain;
  grainChapter?: number;
  grainPortionIds?: string[];
  grainItemIds?: string[];
  /** Optional shared geographic unit: the same person gets every listed resource. */
  bundle?: TeamBundle;
};

export type Assignment = {
  id: string;
  /** Display name of the assignee (person). Never a team name. */
  person: string;
  personId: string;
  teamId: string;
  itemType: ItemType;
  itemId: string;
  note: string;
  state: AssignmentState;
  /** Set when the row was assigned as part of an “asignar juntos” lote. */
  bundleId?: string;
};

/** Persisted deliverable + local board state. */
export type AssignmentsDoc = {
  schema: "gateway-assignments-1";
  book: string;
  lang: string;
  contentOrg: string;
  pmOrg: string;
  exported_at?: string;
  people: Person[];
  teams: Team[];
  assignments: Assignment[];
  activeTeamId?: string;
};

export type ProjectContext = {
  lang: string;
  contentOrg: string;
  pmOrg: string;
  book: string;
  host: string;
};

export const REMAINING = new Set<ArticleStatus>(["english", "incomplete", "missing"]);

export const SCOPE_KEYS: ScopeKey[] = ["notas", "preguntas", "academia", "palabras"];

export const ASSIGNMENT_GRAINS: AssignmentGrain[] = [
  "item",
  "portion",
  "chapter",
  "portionsInChapter",
  "portionRefs",
];

export const RESOURCE_GRAINS: AssignmentGrain[] = ["item", "portion", "portionRefs"];

export const BUNDLE_GRAINS: BundleGrain[] = ["portion", "chapterPortions", "chapter"];

export const GRAIN_LABEL: Record<AssignmentGrain, string> = {
  item: "Ítems / lista",
  portion: "Porciones",
  chapter: "Capítulo",
  portionsInChapter: "Porciones del capítulo",
  portionRefs: "Por referencias en porciones",
};

export const BUNDLE_GRAIN_LABEL: Record<BundleGrain, string> = {
  portion: "Una porción",
  chapterPortions: "Porciones de un capítulo",
  chapter: "Un capítulo",
};

export const STATUS_LABEL: Record<ArticleStatus, string> = {
  translated: "Traducido",
  english: "Inglés",
  incomplete: "Incompleto",
  missing: "Falta",
};

export const KIND_LABEL: Record<string, string> = {
  "Translation Words": "Palabras",
  "Translation Academy": "Academia",
};

export const STATE_LABEL: Record<AssignmentState, string> = {
  "sin asignar": "Sin asignar",
  asignado: "Asignado",
  "en curso": "En curso",
  hecho: "Hecho",
};

export const SCOPE_LABEL: Record<ScopeKey, string> = {
  notas: "Notas",
  preguntas: "Preguntas",
  academia: "Academia",
  palabras: "Palabras",
};

export const ARTICLE_FILTERS: ArticleFilter[] = [
  "pending",
  "all",
  "translated",
  "english",
  "incomplete",
  "missing",
];

export const ARTICLE_FILTER_LABEL: Record<ArticleFilter, string> = {
  pending: "Pendientes",
  all: "Todos",
  translated: "Traducido",
  english: "En inglés",
  incomplete: "Incompleto",
  missing: "Faltante / sin artículo",
};

const ARTICLE_RESOURCE_FILTERS: ArticleFilter[] = [
  "all",
  "pending",
  "translated",
  "english",
  "incomplete",
  "missing",
];

const PORTION_RESOURCE_FILTERS: ArticleFilter[] = ["all", "pending"];

export function isArticleResource(resource: ScopeKey): boolean {
  return resource === "academia" || resource === "palabras";
}

/** Filters that resource’s inventory rows can actually evaluate. */
export function filtersForResource(resource: ScopeKey): ArticleFilter[] {
  return isArticleResource(resource) ? ARTICLE_RESOURCE_FILTERS : PORTION_RESOURCE_FILTERS;
}

/** Grains that this resource can actually use in the Equipos UI. */
export function grainsForResource(resource: ScopeKey): AssignmentGrain[] {
  return isArticleResource(resource) ? ["item", "portionRefs"] : ["item", "portion", "portionRefs"];
}

/** Display grain for new knobs: legacy chapter grains become portion-refs. */
export function displayResourceGrain(grain?: AssignmentGrain): AssignmentGrain {
  if (grain === "chapter" || grain === "portionsInChapter") return "portionRefs";
  return grain ?? "item";
}

/** Chapter / subset / portion-ref grains pull Academia and Palabras from citations. */
export function citesArticlesFromPortions(grain?: AssignmentGrain): boolean {
  return grain === "chapter" || grain === "portionsInChapter" || grain === "portionRefs";
}

/** One assignable Academia/Palabras row per citing portion (repeats stay visible). */
export function expandsArticleOccurrences(
  grain?: AssignmentGrain,
  includeDuplicates?: boolean,
): boolean {
  if (includeDuplicates === false) return false;
  if (includeDuplicates === true && citesArticlesFromPortions(grain)) return true;
  return grain === "chapter" || grain === "portionsInChapter" || grain === "portionRefs";
}

export function articleFilterLabel(
  resource: ScopeKey,
  filter: ArticleFilter,
  grain?: AssignmentGrain,
): string {
  if (resource === "notas") {
    if (filter === "all") return "Todas";
    if (filter === "pending") return "Con notas";
  }
  if (resource === "preguntas") {
    if (filter === "all") return "Todas";
    if (filter === "pending") return "Con preguntas";
  }
  if (isArticleResource(resource) && filter === "all") {
    if (citesArticlesFromPortions(grain)) {
      return "Todos (citados en las porciones, incl. traducidos)";
    }
    if (grain === "item") {
      return "Todos (catálogo del libro)";
    }
  }
  return ARTICLE_FILTER_LABEL[filter];
}

export const PM_REPO_NAME = "gateway-tasks";
export const ASSIGNMENTS_SCHEMA = "gateway-assignments-1" as const;
