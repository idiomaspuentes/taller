import { tallerConfig } from "../../taller.config";
/** Domain types for gateway-tasks (schema gateway-assignments-2). */
import type { PersonLevel } from "./levels";
import type { SourcePackage } from "./sourcePackage";

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
/**
 * Geographic unit when splitting work among team members (autoasignar / lotes).
 * Independent of whether resources are packaged together or separate.
 *
 * - `portion` — contiguous blocks across the whole book
 * - `chapter` — each whole chapter is one unit
 * - `chapterRounds` — within each chapter, split portions among all members; then the next chapter
 */
export type DistributeUnit = "portion" | "chapter" | "chapterRounds";
/**
 * How autoasignar hands units to people.
 * `contiguous` = book-order blocks, as even as possible (some may get one more when N≠M).
 * `manual` = no auto-split (assign by hand in Asignar).
 */
export type DistributePolicy = "contiguous" | "manual";
export type TaskResource = "notas" | "preguntas" | "tpl" | "tps";
export type AssignmentState = "sin asignar" | "asignado" | "en curso" | "hecho";
export type ScopeKey = "notas" | "preguntas" | "academia" | "palabras" | "tpl" | "tps";

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
  /**
   * UBS book code when this portion comes from a merged multi-book inventory.
   * Single-book inventories may omit it (implied by InventoryDoc.book).
   */
  book?: string;
  /** 1 when ULT range is identified for TPL (always after prep). */
  tpl: number;
  /** 1 when UST confirms the same range for TPS; 0 if UST missing. */
  tps: number;
  notas: number;
  preguntas: number;
  tplItems: InventoryTask[];
  tpsItems: InventoryTask[];
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

/**
 * Phase within a project. Groups several tasks of one workflow stage
 * (e.g. "Fase 1" containing TPL + TPS + helps).
 */
export type Phase = {
  id: string;
  name: string;
  /** The name in other interface languages (`{ pt: "Tradução" }`); `name` is the fallback. */
  names?: Localized;
  /**
   * Stable git prefix (`{slug}/{book}`). Persisted so a later rename of
   * `name` does not move existing branches.
   */
  slug: string;
  description?: string;
  /** Display order ascending. */
  order: number;
};

/** How a project relates to Bible books. */
export type ProjectKind = "book" | "thematic";

/**
 * Geographic / scripture window for a project task.
 * Default `{ mode: "project" }` = all books listed on the project.
 */
export type ScriptureScope =
  | { mode: "project" }
  | { mode: "books"; books: string[] }
  | { mode: "chapters"; book: string; chapters: number[] }
  | { mode: "portions"; book: string; portionIds: string[] };

/**
 * A project task: scoped work with distribution policy, assigned to an org team.
 * Formerly misnamed `Team` in the UI ("equipo de PM").
 */
export type ProjectTask = {
  id: string;
  name: string;
  /** The name in other interface languages; `name` is the fallback. */
  names?: Localized;
  /** Free-text note (legacy phase hint may still appear here on old docs). */
  description: string;
  /** Owning phase. Required on new tasks; backfilled on load. */
  phaseId: string;
  /**
   * Local member ids for offline auto-assign when no org team is linked yet.
   * Prefer org team membership once `orgTeamId` is set.
   */
  memberIds: string[];
  /**
   * Legacy derived resource list. Kept so older `gateway-assignments-1`
   * documents still load; prefer `rules` for matching.
   */
  scope: ScopeKey[];
  /**
   * Mixed per-resource filters (union). A task can include several resources,
   * each with its own inventory-backed filter and grain.
   */
  rules: ScopeRule[];
  /**
   * General work: the task is not about a resource of the book. The app lays out nothing for it by itself; its
   * subtareas are the ones somebody adds by hand (see `extraWork.ts`).
   */
  general?: boolean;
  /** Scripture window; omit = whole project books. */
  scriptureScope?: ScriptureScope;
  grain?: AssignmentGrain;
  grainChapter?: number;
  grainPortionIds?: string[];
  grainItemIds?: string[];
  bundle?: TeamBundle;
  distributeUnit?: DistributeUnit;
  distributePolicy?: DistributePolicy;
  /**
   * The task goes over every unit of its scope (each chapter, or each stretch of a split one), whether or not that
   * unit has articles left to work on: a review of what is already there, like checking the key terms of a chapter.
   */
  everyUnit?: boolean;
  /** Assigned DCS organization team (reusable across projects). */
  orgTeamId?: number;
  orgTeamName?: string;
  /**
   * Id of an org solver app (`solvers.json`) used to open a tool from Mis tareas.
   * Empty / omitted = no Resolver button for the whole subtarea.
   */
  solverAppId?: string;
  /**
   * Checklist template snapshotted from a workflow (or edited on the project).
   * Every subtarea of this task inherits these steps.
   */
  steps?: TaskStep[];
  /** Work this task waits for before it can start (see `domain/waits.ts`). */
  waitsFor?: WaitRule[];
  /** Lowest person level that can take this task (see `domain/levels.ts`). */
  minLevel?: PersonLevel;
  /**
   * Revisión of text already in the borrador principal: «Pasar al borrador
   * principal» may replace differing verses inside this task's range after
   * the gestor confirms. Omitted = normal task (a differing verse aborts).
   */
  reviewsPrincipal?: boolean;
  /**
   * Revisión only: verse or range the gestor typed (`NEH 1:2`, `NEH 1:1-3`).
   * When set, the task has exactly one subtarea per scripture resource with
   * this range, instead of one per inventory portion.
   */
  reviewRef?: string;
  /** Revisión only: login of the one person the subtarea is assigned to. */
  reviewAssigneeId?: string;
};

/**
 * One step in a task checklist. Optional `solverAppId` opens a tool for that step.
 * Claim policy drives Mis tareas seating (exclusive pair vs pool group).
 */
export type StepClaimMode = "none" | "exclusive" | "pool";

/** Text per interface language code (`es`, `pt`, …). A process defines its own words; the engine has none. */
export type Localized = Partial<Record<string, string>>;

/**
 * The name a process gives a resource: one process works on «TPL» and «TPS», another calls its only text «Biblia».
 * The resource keys are how the engine stores and delivers; the names are the process's own.
 */
export type ResourceNames = Partial<Record<ScopeKey, { name: string; names?: Localized }>>;

/**
 * How a step is completed. The process chooses; the engine only knows these mechanics.
 * - `self`: the person doing it marks it done.
 * - `approval`: someone else approves it.
 * - `consensus`: item by item, until every item is agreed (a final decision settles what is disputed).
 * - `checklist`: item by item, yes/no questions (see `checklist`).
 * - `automatic`: a tool completes it when its checks pass.
 */
export type StepClosing = "self" | "approval" | "consensus" | "checklist" | "automatic";

/** What a step covers: one subtarea (default), the whole handoff unit, or a chapter once per person. */
export type StepScope = "subtask" | "unit" | "chapter-once";

/** One yes/no question of a `checklist` step, asked for every item (or once per verse). */
export type ChecklistQuestion = {
  id: string;
  text: string;
  texts?: Localized;
  /** `item` (default): asked for each item. `verse`: asked once for each verse. */
  per?: "item" | "verse";
};

export type TaskStep = {
  id: string;
  name: string;
  /** The name in other interface languages; `name` is the fallback. */
  names?: Localized;
  /** What the big button says («Revisar», «Votar»). Without it the engine words the mechanics. */
  actionLabel?: string;
  actionLabels?: Localized;
  /** How the step is completed. Omitted: derived from `claimMode` (none → self, otherwise approval). */
  closing?: StepClosing;
  /** Questions of a `checklist` step. */
  checklist?: ChecklistQuestion[];
  /** What the step covers. Omitted: one subtarea. */
  scope?: StepScope;
  /** A committee's decision: how it is taken when its members do not all agree. Omitted: by majority. */
  decisionRule?: "majority" | "unanimous";
  description?: string;
  descriptions?: Localized;
  solverAppId?: string;
  /** Default `none` — free checklist toggle. */
  claimMode?: StepClaimMode;
  /** Pool only: minimum approvals / seats to complete (default 2). */
  minAssignees?: number;
  /** Pool only: max claim seats (default = minAssignees). */
  maxAssignees?: number;
  /**
   * Review rounds (see `reviewRound.ts`): how many of the agreeing habilitadas
   * must not have written the text. Omitted = 0.
   */
  minIndependent?: number;
  /** Logins who were assignees on these prior steps cannot claim this step. */
  excludePriorStepIds?: string[];
  /**
   * When true, the subtarea (issue) assignee cannot claim this step.
   * Independent of prior-step seating.
   */
  excludeIssueAssignee?: boolean;
  /**
   * Exclusive: the prior-step author (assignee of the first excluded prior step,
   * or the issue assignee) must also approve for the step to complete.
   */
  includeAuthorInApproval?: boolean;
};

/**
 * @deprecated Use {@link ProjectTask}. Alias kept while call sites migrate.
 */
export type Team = ProjectTask;

/** How much of the awaited work must be closed: the same portion, the same chapter, or all of it. */
export type WaitScope = "portion" | "chapter" | "all";

/**
 * «Espera a»: the task cannot start until the awaited work is closed.
 * Names one task (`taskId`) or a whole phase (`phaseId`), never both.
 */
export type WaitRule = {
  taskId?: string;
  phaseId?: string;
  scope: WaitScope;
  /**
   * The awaited task is not of this project: it is a task of the **source project**, the project of the same book
   * in the organization the source resources come from (`settings.sourcePackage`). The work is free only once that
   * project closed the task for the same chapter: «what they already published».
   */
  source?: boolean;
};

/**
 * Reusable task shape inside an org {@link WorkflowTemplate}.
 * No book-specific scripture window; apply sets `{ mode: "project" }`.
 */
export type TaskTemplate = {
  id: string;
  name: string;
  names?: Localized;
  description?: string;
  phaseId: string;
  rules: ScopeRule[];
  /**
   * General work: the task is not about a resource of the book. The app lays out nothing for it by itself; its
   * subtareas are the ones somebody adds by hand (see `extraWork.ts`).
   */
  general?: boolean;
  distributeUnit?: DistributeUnit;
  distributePolicy?: DistributePolicy;
  /**
   * The task goes over every unit of its scope (each chapter, or each stretch of a split one), whether or not that
   * unit has articles left to work on: a review of what is already there, like checking the key terms of a chapter.
   */
  everyUnit?: boolean;
  bundle?: { enabled: boolean; grain: BundleGrain };
  orgTeamId?: number;
  orgTeamName?: string;
  solverAppId?: string;
  steps?: TaskStep[];
  waitsFor?: WaitRule[];
  minLevel?: PersonLevel;
};

/**
 * «Versión publicada» profile: which phases must be ready before the gestor
 * publishes a version from the borrador principal. Phases not listed may
 * stay unfinished. Lives in the app; DCS releases carry no dependency data.
 */
export type ReleaseProfile = {
  id: string;
  /** Short Spanish name the gestor edits, e.g. «Traducción». */
  name: string;
  /** Existing {@link Phase.id}s; empty is invalid for publishing. */
  requiredPhaseIds: string[];
};

/**
 * One successful «Pasar al borrador principal» of a scripture task (TPL/TPS)
 * in one book. «Publicar versión» needs it for every scripture task of a
 * required phase. It stops counting (and is dropped when seen) once the task
 * has an open subtarea, an open verse decision, a subtarea not in `issues`,
 * or one closed after `closedThrough`.
 */
export type PrincipalPassMark = {
  book: string;
  taskId: string;
  /** ISO time of the pass. Marks saved before `serverAt` existed hold a browser time here; never compared. */
  at: string;
  /**
   * Door43 server time of the pass: committer date of the principal write, or
   * of the principal file's last commit when it already had the text. Verse
   * decisions (`created_at`, same clock) strictly after it make the mark stale;
   * a mark without it never counts for scripture tasks.
   */
  serverAt?: string;
  by: string;
  /** Scripture subtareas covered by the pass. */
  issues: number[];
  /** Latest `closed_at` among `issues` at pass time (server clock). */
  closedThrough?: string;
  /** Commit ids written into the borrador principal; empty when it already had the text. */
  commits?: string[];
};

export const WORKFLOWS_SCHEMA = "gateway-workflows-1" as const;

/** Org-level reusable pipeline: phases → tasks → checklists. */
export type WorkflowTemplate = {
  id: string;
  name: string;
  names?: Localized;
  /** Goes up every time the template is saved; a project records the one it was created from. */
  version?: number;
  description?: string;
  descriptions?: Localized;
  phases: Phase[];
  tasks: TaskTemplate[];
  /** Copied into project settings when the template is applied. */
  releaseProfiles?: ReleaseProfile[];
  /** What this process calls each resource it works on. Copied into project settings too. */
  resourceNames?: ResourceNames;
  /**
   * How much of the first phase must be delivered (0 to 1) before whoever coordinates is told to start the next
   * book. Copied into project settings; 0.7 when the process does not say.
   */
  nextBookAt?: number;
  /**
   * The most verses a chapter may have and still move from one phase to the next in one piece. A longer chapter is
   * suggested to be split into stretches. Copied into project settings; 40 when the process does not say.
   */
  maxChapterVerses?: number;
};

export type WorkflowsCatalog = {
  schema: typeof WORKFLOWS_SCHEMA;
  workflows: WorkflowTemplate[];
};

/**
 * Reusable task template: resource shape without book-specific chapter/portion
 * or org team. Applying a preset pre-fills the task form.
 * @deprecated Prefer {@link WorkflowTemplate}; kept for older `team-presets.json`.
 */
export type TeamPreset = {
  id: string;
  name: string;
  description?: string;
  rules: ScopeRule[];
  bundle?: { enabled: boolean; grain: BundleGrain };
  distributeUnit?: DistributeUnit;
  distributePolicy?: DistributePolicy;
  /**
   * The task goes over every unit of its scope (each chapter, or each stretch of a split one), whether or not that
   * unit has articles left to work on: a review of what is already there, like checking the key terms of a chapter.
   */
  everyUnit?: boolean;
};

export type Assignment = {
  id: string;
  /** Display name of the assignee (person). Never a team name. */
  person: string;
  personId: string;
  /** Id of the {@link ProjectTask} this row belongs to (field name kept for JSON compat). */
  teamId: string;
  itemType: ItemType;
  itemId: string;
  note: string;
  state: AssignmentState;
  bundleId?: string;
};

/** Index row for `{lang}/projects.json`. */
export type ProjectIndexEntry = {
  projectId: string;
  title: string;
  kind: ProjectKind;
  books: string[];
  updated_at?: string;
};

/**
 * A subtarea added by hand to a task: work the book does not give by itself («Revisar la introducción», a second look
 * at one passage). It follows the team and the steps of its task.
 */
export type ExtraWork = {
  id: string;
  taskId: string;
  title: string;
  /** The portion of the book it is about, when it is about one: the tools of the task open on it. */
  portionId?: string;
};

/** What moves together from one phase to the next: see `handoff.ts`. Only split chapters are listed. */
export type HandoffUnit = { id: string; label?: string; portionIds: string[] };

/**
 * Per-project policies persisted on `assignments.json`.
 * Defaults are all off / omitted.
 */
export type ProjectSettings = {
  /**
   * When true, members of linked org teams can claim unassigned subtareas and
   * browse the full project queue in Mis tareas (not only their own).
   */
  allowSelfAssign?: boolean;
  /**
   * Last successful Entregar → Publicar (issues). Plan JSON remains the SoT for
   * phases/tasks; this is recognition that subtareas already exist in DCS.
   */
  lastPublish?: {
    at: string;
    created: number;
    updated: number;
  };
  /** «Publicar versión» profiles (phase dependencies). */
  releaseProfiles?: ReleaseProfile[];
  /** What the project's process calls each resource (see `resourceNames.ts`); absent = the usual names. */
  resourceNames?: ResourceNames;
  /** Share of the first phase delivered at which the next book is called for (see `startBook.ts`). */
  nextBookAt?: number;
  /**
   * The most verses a chapter may have and still move from one phase to the next in one piece. A longer chapter is
   * suggested to be split into stretches. See `handoff.ts`.
   */
  maxChapterVerses?: number;
  /** Scripture tasks already passed into the borrador principal (release gate). */
  principalPasses?: PrincipalPassMark[];
  /** Notes, words and texts the Afinación reads; the default is unfoldingWord's English package. */
  sourcePackage?: SourcePackage;
  /** Chapters split into stretches that move on by themselves. A chapter not listed here is one unit. */
  handoffUnits?: HandoffUnit[];
  /**
   * Portions cut where the project chose instead of where the source does: by book, by chapter, the verses at which
   * a portion starts. Decided before the project is created; the subtareas are laid out on these portions.
   */
  portionStarts?: Record<string, Record<string, number[]>>;
  /** Subtareas somebody added by hand, beside the ones the book gives (see `extraWork.ts`). */
  extraWork?: ExtraWork[];
};

/** Persisted deliverable + local board state for one project. */
export type AssignmentsDoc = {
  schema: typeof ASSIGNMENTS_SCHEMA;
  /** Stable project slug (`NEH` or `pentateuco-r1`). */
  projectId: string;
  /**
   * Legacy mirror of `projectId` (schema 1 field). Kept in memory so call sites
   * that still read `doc.book` keep working; prefer `projectId`.
   */
  book: string;
  title: string;
  kind: ProjectKind;
  /** UBS books this project may inventariar / use. */
  books: string[];
  lang: string;
  contentOrg: string;
  pmOrg: string;
  exported_at?: string;
  settings?: ProjectSettings;
  people: Person[];
  phases: Phase[];
  /**
   * Project tasks. In memory the field stays `teams` so call sites migrate
   * gradually; on disk {@link AssignmentsPersistDoc} writes `tasks` only
   * (legacy `teams[]` is still accepted on load).
   */
  teams: ProjectTask[];
  assignments: Assignment[];
  activeTeamId?: string;
  /** Org workflow this board was snapshotted from (if any). */
  workflowId?: string;
  /** The version of that workflow when it was applied: what an update is compared with. */
  workflowVersion?: number;
  workflowAppliedAt?: string;
};

/**
 * On-disk / download shape for `{lang}/{projectId}/assignments.json`.
 */
export type AssignmentsPersistDoc = {
  schema: typeof ASSIGNMENTS_SCHEMA;
  projectId: string;
  /** Legacy mirror of projectId for older tooling. */
  book: string;
  title: string;
  kind: ProjectKind;
  books: string[];
  lang: string;
  contentOrg: string;
  pmOrg: string;
  exported_at?: string;
  settings?: ProjectSettings;
  people: Person[];
  phases: Phase[];
  tasks: ProjectTask[];
  assignments: Assignment[];
  workflowId?: string;
  workflowVersion?: number;
  workflowAppliedAt?: string;
};

export type ProjectContext = {
  lang: string;
  contentOrg: string;
  pmOrg: string;
  /** Active project id (same as AssignmentsDoc.projectId). */
  book: string;
  host: string;
};

export const REMAINING = new Set<ArticleStatus>(["english", "incomplete", "missing"]);

export const SCOPE_KEYS: ScopeKey[] = ["tpl", "tps", "notas", "preguntas", "academia", "palabras"];

export const ASSIGNMENT_GRAINS: AssignmentGrain[] = [
  "item",
  "portion",
  "chapter",
  "portionsInChapter",
  "portionRefs",
];

export const RESOURCE_GRAINS: AssignmentGrain[] = ["item", "portion", "portionRefs"];

export const BUNDLE_GRAINS: BundleGrain[] = ["portion", "chapterPortions", "chapter"];

export const DISTRIBUTE_UNITS: DistributeUnit[] = ["portion", "chapter", "chapterRounds"];

export const DISTRIBUTE_POLICIES: DistributePolicy[] = ["contiguous", "manual"];

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

export const DISTRIBUTE_UNIT_LABEL: Record<DistributeUnit, string> = {
  portion: "Por porción",
  chapter: "Por capítulo entero",
  chapterRounds: "Porciones por capítulo",
};

export const DISTRIBUTE_UNIT_HELP: Record<DistributeUnit, string> = {
  portion:
    "Parte todas las porciones del libro en bloques contiguos entre el equipo (quien lleva varias, las lleva seguidas).",
  chapter:
    "Cada capítulo completo va a una persona. Si alguien recibe varios, serán capítulos contiguos.",
  chapterRounds:
    "En cada capítulo se reparten las porciones entre todos; luego se pasa al siguiente. El libro avanza capítulo a capítulo.",
};

export const DISTRIBUTE_POLICY_LABEL: Record<DistributePolicy, string> = {
  contiguous: "Automático · bloques contiguos",
  manual: "Solo manual",
};

export const DISTRIBUTE_POLICY_HELP: Record<DistributePolicy, string> = {
  contiguous:
    "Parte las unidades en el orden del libro, lo más parejo posible. Si no hay el mismo número de unidades que de personas, algunos llevan una más.",
  manual: "No autoasignar. En Asignar eliges persona a persona.",
};

/** Bundle lote size that matches a distribute unit (legacy chapterPortions → portion). */
export function bundleGrainForDistributeUnit(unit: DistributeUnit): BundleGrain {
  return unit === "chapter" ? "chapter" : "portion";
}

export function distributeUnitFromBundleGrain(grain?: BundleGrain): DistributeUnit {
  return grain === "chapter" ? "chapter" : "portion";
}

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
  tpl: "TPL",
  tps: "TPS",
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

/** Scripture slots: TPL from ULT, TPS from UST — one unit per porción. */
export function isScriptureResource(resource: ScopeKey): boolean {
  return resource === "tpl" || resource === "tps";
}

/** Filters that resource’s inventory rows can actually evaluate. */
export function filtersForResource(resource: ScopeKey): ArticleFilter[] {
  return isArticleResource(resource) ? ARTICLE_RESOURCE_FILTERS : PORTION_RESOURCE_FILTERS;
}

/** Grains that this resource can actually use in the Equipos UI. */
export function grainsForResource(resource: ScopeKey): AssignmentGrain[] {
  if (isArticleResource(resource)) return ["item", "portionRefs"];
  // TPL/TPS: one unit per porción either way — no grain decision to make.
  if (isScriptureResource(resource)) return ["item"];
  return ["item", "portion"];
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
  if (resource === "tpl") {
    if (filter === "all") return "Todas las porciones";
    if (filter === "pending") return "Con TPL";
  }
  if (resource === "tps") {
    if (filter === "all") return "Todas las porciones";
    if (filter === "pending") return "Con TPS (UST)";
  }
  if (resource === "notas") {
    if (filter === "all") return "Todas las porciones";
    if (filter === "pending") return "Solo con notas";
  }
  if (resource === "preguntas") {
    if (filter === "all") return "Todas las porciones";
    if (filter === "pending") return "Solo con preguntas";
  }
  if (isArticleResource(resource) && filter === "all") {
    if (citesArticlesFromPortions(grain)) {
      return "Todos los citados";
    }
    if (grain === "item") {
      return "Todo el catálogo";
    }
  }
  return ARTICLE_FILTER_LABEL[filter];
}

/** Short title on the choice card (plainer than GRAIN_LABEL). */
export function grainChoiceLabel(resource: ScopeKey, grain: AssignmentGrain): string {
  if (resource === "notas" || resource === "preguntas") {
    if (grain === "item") return resource === "notas" ? "Nota por nota" : "Pregunta por pregunta";
    if (grain === "portion") return "Porción completa";
  }
  if (isArticleResource(resource)) {
    if (grain === "item") return "Artículo único";
    if (grain === "portionRefs") return "Una fila por cita";
  }
  return GRAIN_LABEL[grain];
}

/** Why this grain matters — shown next to each choice. */
export function grainHelp(resource: ScopeKey, grain: AssignmentGrain): string {
  if (resource === "notas") {
    if (grain === "item") {
      return "En Asignar verás cada nota suelta. Puedes dar notas distintas de la misma porción a personas distintas.";
    }
    if (grain === "portion") {
      return "En Asignar verás la porción entera. Quien la reciba traduce todas las notas de ese bloque.";
    }
  }
  if (resource === "preguntas") {
    if (grain === "item") {
      return "En Asignar verás cada pregunta suelta. Puedes repartirlas entre varias personas.";
    }
    if (grain === "portion") {
      return "En Asignar verás la porción entera. Quien la reciba responde todas las preguntas de ese bloque.";
    }
  }
  if (resource === "academia") {
    if (grain === "item") {
      return "Cada artículo de Academia aparece una sola vez, aunque el libro lo cite muchas veces.";
    }
    if (grain === "portionRefs") {
      return "Si el mismo artículo se cita en 3 porciones, pueden salir hasta 3 filas (una por cita).";
    }
  }
  if (resource === "palabras") {
    if (grain === "item") {
      return "Cada artículo de Palabras aparece una sola vez, aunque el libro lo cite muchas veces.";
    }
    if (grain === "portionRefs") {
      return "Si la misma palabra se cita en 3 porciones, pueden salir hasta 3 filas (una por cita).";
    }
  }
  return "";
}

export function articleFilterHelp(
  resource: ScopeKey,
  filter: ArticleFilter,
  grain?: AssignmentGrain,
): string {
  if (resource === "notas") {
    if (filter === "pending") return "Solo porciones donde hay notas que asignar.";
    return "También incluye porciones sin notas (útiles si mezclas con otros recursos).";
  }
  if (resource === "preguntas") {
    if (filter === "pending") return "Solo porciones donde hay preguntas que asignar.";
    return "También incluye porciones sin preguntas.";
  }
  if (isArticleResource(resource)) {
    const name = SCOPE_LABEL[resource];
    if (filter === "pending") {
      return `Solo lo que falta traducir de ${name} (aún en inglés, incompleto o sin artículo).`;
    }
    if (filter === "all") {
      if (citesArticlesFromPortions(grain)) {
        return `Todo lo citado en las porciones, aunque ya esté traducido.`;
      }
      return `Todo el catálogo de ${name} del libro.`;
    }
    if (filter === "translated") return "Solo artículos ya traducidos.";
    if (filter === "english") return "Solo artículos que siguen en inglés.";
    if (filter === "incomplete") return "Solo artículos a medias.";
    if (filter === "missing") return "Solo referencias sin artículo en el destino.";
  }
  return "";
}

export function stayInChapterHelp(_resource: ScopeKey): string {
  return "Al repartir en Asignar, cada persona recibe bloques que no saltan de un capítulo a otro. No cambia el Ámbito del libro (arriba).";
}

/** Scripture has a single grain — hide the picker. */
export function resourceShowsGrain(resource: ScopeKey): boolean {
  return grainsForResource(resource).length > 1;
}

/** Scripture filters both require source text; the dropdown adds little — hide it. */
export function resourceShowsFilter(resource: ScopeKey): boolean {
  return !isScriptureResource(resource);
}

export function scriptureIntro(resource: "tpl" | "tps"): string {
  if (resource === "tpl") {
    return "Cada porción se asignará a una persona para traducirla al Texto Puente Literal (TPL), a partir del texto fuente en inglés.";
  }
  return "Cada porción se asignará a una persona para traducirla al Texto Puente Simple (TPS), a partir del UST. Solo cuenta si el inventario tiene UST.";
}

/**
 * Noun for the inventory units counted by a resource rule (never “trabajos” —
 * that clashes with project “tarea”).
 */
export function assignableUnitNoun(
  resource: ScopeKey,
  grain: AssignmentGrain,
  count: number,
): string {
  const plural = count !== 1;
  if (isScriptureResource(resource)) return plural ? "porciones" : "porción";
  if (resource === "notas") {
    if (grain === "portion") return plural ? "porciones" : "porción";
    return plural ? "notas" : "nota";
  }
  if (resource === "preguntas") {
    if (grain === "portion") return plural ? "porciones" : "porción";
    return plural ? "preguntas" : "pregunta";
  }
  if (isArticleResource(resource)) {
    if (citesArticlesFromPortions(grain)) return plural ? "citas" : "cita";
    return plural ? "artículos" : "artículo";
  }
  return plural ? "ítems" : "ítem";
}

/** e.g. `145 porciones` — shown on resource chips / summaries. */
export function assignableCountLabel(
  resource: ScopeKey,
  grain: AssignmentGrain,
  count: number,
): string {
  return `${count} ${assignableUnitNoun(resource, grain, count)}`;
}

/** The Door43 repository that holds the plan and the subtareas: `pmRepo` in taller.config.ts. */
export const PM_REPO_NAME: string = tallerConfig.pmRepo;
export const ASSIGNMENTS_SCHEMA = "gateway-assignments-2" as const;
export const ASSIGNMENTS_SCHEMA_LEGACY = "gateway-assignments-1" as const;
