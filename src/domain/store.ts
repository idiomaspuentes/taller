import { normalizeExtraWork, normalizePortionStarts } from "./extraWork";
import { scopeFolder, scopeKey } from "./scope";
import {
  ASSIGNMENTS_SCHEMA,
  type Article,
  type ArticleStatus,
  type Assignment,
  type AssignmentGrain,
  type AssignmentState,
  type AssignmentsDoc,
  type BundleGrain,
  type DistributePolicy,
  type DistributeUnit,
  type InventoryDoc,
  type InventoryTask,
  type ItemType,
  type ArticleFilter,
  type Person,
  type Phase,
  type Portion,
  type PortionArticleRef,
  type PrincipalPassMark,
  type ProjectIndexEntry,
  type ProjectSettings,
  type ProjectKind,
  type ProjectTask,
  type ReleaseProfile,
  type ScriptureScope,
  type ScopeKey,
  type ScopeRule,
  type TeamBundle,
  type TeamPreset,
  type TaskResource,
  type TaskStep,
  type TaskTemplate,
  type WorkflowTemplate,
  type WorkflowsCatalog,
  type AssignmentsPersistDoc,
  ARTICLE_FILTERS,
  ASSIGNMENT_GRAINS,
  BUNDLE_GRAINS,
  DISTRIBUTE_POLICIES,
  DISTRIBUTE_UNITS,
  SCOPE_KEYS,
  type ResourceNames,
  WORKFLOWS_SCHEMA,
  distributeUnitFromBundleGrain,
  type Localized,
  type StepClosing,
  type StepScope,
  type ChecklistQuestion,
} from "./types";
import { normalizeSourcePackage } from "./sourcePackage";
import { scopeFromRules, uid } from "./assignment";
import { ensurePhaseSlug, makePhase } from "./phaseSlug";
import { normalizeWaitRules } from "./waitRules";
import { normalizeHandoffUnits } from "./handoff";
import { isLevel } from "./levels";
import {
  isBookProjectId,
  normalizeProjectId,
  projectDisplayName,
} from "./books";

const STORE_PREFIX = "gt-assignments:";
const CONTEXT_KEY = "gt-context";
const SESSION_INV_KEY = "gt-session-inventory";
const TEAM_PRESETS_KEY = "gt-team-presets";
const WORKFLOWS_KEY = "gt-workflows";
const PROJECTS_INDEX_PREFIX = "gt-projects:";

function isArticleStatus(value: string): value is ArticleStatus {
  return (
    value === "translated" ||
    value === "english" ||
    value === "incomplete" ||
    value === "missing"
  );
}

function isAssignmentState(value: string): value is AssignmentState {
  return (
    value === "sin asignar" ||
    value === "asignado" ||
    value === "en curso" ||
    value === "hecho"
  );
}

function isScopeKey(value: string): value is ScopeKey {
  return (SCOPE_KEYS as string[]).includes(value);
}

function isItemType(value: string): value is ItemType {
  return value === "articulo" || value === "porcion" || value === "tarea";
}

function isAssignmentGrain(value: string): value is AssignmentGrain {
  return (ASSIGNMENT_GRAINS as string[]).includes(value);
}

function isBundleGrain(value: string): value is BundleGrain {
  return (BUNDLE_GRAINS as string[]).includes(value);
}

function isDistributeUnit(value: string): value is DistributeUnit {
  return (DISTRIBUTE_UNITS as string[]).includes(value);
}

function isDistributePolicy(value: string): value is DistributePolicy {
  return (DISTRIBUTE_POLICIES as string[]).includes(value);
}

function normalizeDistributeUnit(
  raw: unknown,
  bundle?: TeamBundle,
): DistributeUnit | undefined {
  const value = String(raw ?? "").trim();
  if (isDistributeUnit(value)) return value;
  if (bundle?.grain) return distributeUnitFromBundleGrain(bundle.grain);
  return undefined;
}

function normalizeDistributePolicy(raw: unknown): DistributePolicy | undefined {
  const value = String(raw ?? "").trim();
  if (isDistributePolicy(value)) return value;
  // Legacy aliases from the two-policy UI (same algorithm).
  if (value === "equitable" || value === "uneven") return "contiguous";
  return undefined;
}

function isArticleFilter(value: string): value is ArticleFilter {
  return (ARTICLE_FILTERS as string[]).includes(value);
}

export function resolveProjectMeta(params: {
  projectId?: string;
  book?: string;
  title?: string;
  kind?: string;
  books?: unknown;
}): {
  projectId: string;
  book: string;
  title: string;
  kind: ProjectKind;
  books: string[];
} {
  const projectId = normalizeProjectId(
    String(params.projectId || params.book || "").trim(),
  );
  const kind: ProjectKind =
    params.kind === "thematic" || params.kind === "book"
      ? params.kind
      : isBookProjectId(projectId)
        ? "book"
        : "thematic";
  let books: string[] = [];
  if (Array.isArray(params.books)) {
    books = params.books
      .map((b) => normalizeProjectId(String(b)))
      .filter(Boolean);
  }
  if (!books.length) {
    books = isBookProjectId(projectId) ? [projectId] : [];
  }
  if (kind === "book" && isBookProjectId(projectId) && !books.includes(projectId)) {
    books = [projectId, ...books];
  }
  const title =
    String(params.title ?? "").trim() ||
    projectDisplayName(projectId) ||
    projectId;
  return { projectId, book: projectId, title, kind, books };
}

export function emptyAssignments(
  projectId: string,
  lang: string,
  contentOrg: string,
  pmOrg: string,
): AssignmentsDoc {
  const meta = resolveProjectMeta({ projectId });
  const defaultPhase: Phase = makePhase({
    id: "phase-default",
    name: "Fase 1",
    slug: "fase-1",
    description: "",
    order: 0,
  });
  return {
    schema: ASSIGNMENTS_SCHEMA,
    projectId: meta.projectId,
    book: meta.book,
    title: meta.title,
    kind: meta.kind,
    books: meta.books,
    lang,
    contentOrg,
    pmOrg,
    people: [],
    phases: [defaultPhase],
    teams: [],
    assignments: [],
    activeTeamId: "",
    settings: {},
  };
}

export function normalizePeople(raw: unknown): Person[] {
  if (!Array.isArray(raw)) return [];
  const people: Person[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const row of raw) {
    if (typeof row === "string") {
      const name = row.trim();
      const key = name.toLocaleLowerCase("es");
      if (!name || seenNames.has(key)) continue;
      seenNames.add(key);
      const id = uid();
      seenIds.add(id);
      people.push({ id, name });
      continue;
    }
    if (!row || typeof row !== "object") continue;
    const item = row as Partial<Person>;
    const name = String(item.name ?? "").trim();
    if (!name) continue;
    const id = String(item.id || "").trim() || uid();
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    people.push({ id, name });
  }
  return people;
}

function normalizeStringList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const values = raw.map(String).map((id) => id.trim()).filter(Boolean);
  return values.length ? values : undefined;
}

function normalizeRules(raw: unknown, fallbackScope: ScopeKey[]): ScopeRule[] {
  if (Array.isArray(raw)) {
    const byResource = new Map<ScopeKey, ScopeRule>();
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      const item = row as Partial<ScopeRule>;
      const resource = String(item.resource ?? "");
      if (!isScopeKey(resource) || byResource.has(resource)) continue;
      const articleFilter = isArticleFilter(String(item.articleFilter ?? "pending"))
        ? (item.articleFilter as ArticleFilter)
        : "pending";
      const grainRaw = String(item.grain ?? "").trim();
      const grain = isAssignmentGrain(grainRaw) ? grainRaw : undefined;
      const chapter = Number(item.chapter);
      byResource.set(resource, {
        resource,
        articleFilter,
        grain,
        stayInChapter: typeof item.stayInChapter === "boolean" ? item.stayInChapter : undefined,
        includeDuplicates:
          typeof item.includeDuplicates === "boolean" ? item.includeDuplicates : undefined,
        chapter: Number.isFinite(chapter) && chapter > 0 ? chapter : undefined,
        portionIds: normalizeStringList(item.portionIds),
        itemIds: normalizeStringList(item.itemIds),
      });
    }
    if (byResource.size) {
      return SCOPE_KEYS.filter((key) => byResource.has(key)).map(
        (resource) => byResource.get(resource) as ScopeRule,
      );
    }
  }
  return fallbackScope.map((resource) => ({ resource, articleFilter: "pending" }));
}

function normalizeBundle(raw: unknown): TeamBundle | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const item = raw as Partial<TeamBundle>;
  const grainRaw = String(item.grain ?? "").trim();
  const grain = isBundleGrain(grainRaw) ? grainRaw : "portion";
  const chapter = Number(item.chapter);
  return {
    enabled: Boolean(item.enabled),
    grain,
    chapter: Number.isFinite(chapter) && chapter > 0 ? chapter : undefined,
    portionIds: normalizeStringList(item.portionIds),
  };
}

export function mergePeople(existing: Person[], incoming: Person[]): Person[] {
  const byId = new Map(existing.map((row) => [row.id, row]));
  for (const person of incoming) {
    if (!person.id || !person.name.trim()) continue;
    if (!byId.has(person.id)) byId.set(person.id, { id: person.id, name: person.name.trim() });
  }
  return [...byId.values()];
}

export function normalizePhases(raw: unknown, tasks: ProjectTask[]): Phase[] {
  if (Array.isArray(raw) && raw.length) {
    const phases: Phase[] = [];
    const seen = new Set<string>();
    let order = 0;
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      const item = row as Partial<Phase>;
      const id = String(item.id || "").trim() || `phase-${order}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const name = String(item.name ?? "").trim() || `Fase ${order + 1}`;
      const names = normalizeLocalized(item.names);
      phases.push({
        ...makePhase({
          id,
          name,
          slug: item.slug,
          description: String(item.description ?? "").trim() || undefined,
          order: Number.isFinite(Number(item.order)) ? Number(item.order) : order,
        }),
        ...(names ? { names } : {}),
      });
      order += 1;
    }
    if (phases.length) {
      const ids = new Set(phases.map((p) => p.id));
      for (const task of tasks) {
        if (!ids.has(task.phaseId)) {
          phases.push(
            makePhase({
              id: task.phaseId,
              name: task.phaseId,
              order: phases.length,
            }),
          );
          ids.add(task.phaseId);
        }
      }
      return phases.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "es"));
    }
  }

  // Legacy: synthesize phases from task.description groups (old "phase note").
  const byKey = new Map<string, Phase>();
  let order = 0;
  for (const task of tasks) {
    const note = task.description.trim();
    const key = note.toLocaleLowerCase("es") || "__default__";
    if (!byKey.has(key)) {
      const derived = ensurePhaseSlug({ name: note, id: "" });
      const id = key === "__default__" ? "phase-default" : `phase-${derived}`;
      byKey.set(
        key,
        makePhase({
          id,
          name: note || "Fase 1",
          description: note || undefined,
          order: order++,
        }),
      );
    }
    const phase = byKey.get(key)!;
    if (task.phaseId !== phase.id) {
      (task as ProjectTask).phaseId = phase.id;
    }
  }
  if (!byKey.size) {
    return [makePhase({ id: "phase-default", name: "Fase 1", slug: "fase-1", order: 0 })];
  }
  return [...byKey.values()].sort((a, b) => a.order - b.order);
}

function normalizeScriptureScope(raw: unknown): ScriptureScope | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const item = raw as Partial<ScriptureScope> & { mode?: string };
  const mode = String(item.mode ?? "").trim();
  if (mode === "project") return { mode: "project" };
  if (mode === "books") {
    const books = normalizeStringList((item as { books?: unknown }).books) ?? [];
    return books.length ? { mode: "books", books: books.map(normalizeProjectId) } : undefined;
  }
  if (mode === "chapters") {
    const book = normalizeProjectId(String((item as { book?: unknown }).book ?? ""));
    const chapters = Array.isArray((item as { chapters?: unknown }).chapters)
      ? (item as { chapters: unknown[] }).chapters
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n) && n > 0)
      : [];
    if (!book || !chapters.length) return undefined;
    return { mode: "chapters", book, chapters };
  }
  if (mode === "portions") {
    const book = normalizeProjectId(String((item as { book?: unknown }).book ?? ""));
    const portionIds = normalizeStringList((item as { portionIds?: unknown }).portionIds) ?? [];
    if (!book || !portionIds.length) return undefined;
    return { mode: "portions", book, portionIds };
  }
  return undefined;
}

/** A whole number of verses, at least one, or nothing. */
export function normalizeMaxVerses(raw: unknown): number | undefined {
  const value = Math.floor(Number(raw));
  return raw !== undefined && raw !== null && Number.isFinite(value) && value >= 1 ? value : undefined;
}

/** A share between 0 and 1 (both excluded), or nothing. */
export function normalizeShare(raw: unknown): number | undefined {
  const value = Number(raw);
  return raw !== undefined && raw !== null && Number.isFinite(value) && value > 0 && value < 1 ? value : undefined;
}

/** Keep only names of resources the engine knows, each with a non-empty name. */
export function normalizeResourceNames(raw: unknown): ResourceNames | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: ResourceNames = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(SCOPE_KEYS as string[]).includes(key) || !value || typeof value !== "object") continue;
    const name = String((value as { name?: unknown }).name ?? "").trim();
    if (!name) continue;
    const names = normalizeLocalized((value as { names?: unknown }).names);
    out[key as ScopeKey] = names ? { name, names } : { name };
  }
  return Object.keys(out).length ? out : undefined;
}

/** `{ pt: "…" }`: only non-empty strings survive; nothing is invented. */
export function normalizeLocalized(raw: unknown): Localized | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Localized = {};
  for (const [lang, text] of Object.entries(raw as Record<string, unknown>)) {
    const value = String(text ?? "").trim();
    if (/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(lang) && value) out[lang] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

const STEP_CLOSINGS: StepClosing[] = ["self", "approval", "consensus", "checklist", "automatic"];
const STEP_SCOPES: StepScope[] = ["subtask", "unit", "chapter-once"];

function normalizeChecklist(raw: unknown): ChecklistQuestion[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ChecklistQuestion[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const item = row as Partial<ChecklistQuestion>;
    const id = String(item.id ?? "").trim();
    const text = String(item.text ?? "").trim();
    if (!id || !text || seen.has(id)) continue;
    seen.add(id);
    const texts = normalizeLocalized(item.texts);
    out.push({ id, text, ...(texts ? { texts } : {}), ...(item.per === "verse" ? { per: "verse" as const } : {}) });
  }
  return out.length ? out : undefined;
}

export function normalizeTaskSteps(raw: unknown): TaskStep[] {
  if (!Array.isArray(raw)) return [];
  const steps: TaskStep[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const item = row as Partial<TaskStep>;
    const name = String(item.name ?? "").trim();
    if (!name) continue;
    let id = String(item.id ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    if (!id || seen.has(id)) id = uid();
    seen.add(id);

    const claimRaw = String(item.claimMode ?? "none").trim().toLowerCase();
    const claimMode: TaskStep["claimMode"] =
      claimRaw === "exclusive" || claimRaw === "pool" ? claimRaw : "none";

    const excludePriorStepIds = Array.isArray(item.excludePriorStepIds)
      ? [
          ...new Set(
            item.excludePriorStepIds
              .map(String)
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        ]
      : undefined;

    let minAssignees: number | undefined;
    let maxAssignees: number | undefined;
    if (claimMode === "pool") {
      const minRaw = Number(item.minAssignees);
      minAssignees = Number.isFinite(minRaw) && minRaw >= 1 ? Math.floor(minRaw) : 2;
      const maxRaw = Number(item.maxAssignees);
      maxAssignees =
        Number.isFinite(maxRaw) && maxRaw >= minAssignees
          ? Math.floor(maxRaw)
          : minAssignees;
    }

    const indRaw = Number(item.minIndependent);
    const minIndependent =
      claimMode === "pool" && Number.isFinite(indRaw) && indRaw >= 1 ? Math.floor(indRaw) : undefined;

    const includeAuthorInApproval =
      claimMode === "exclusive" ? Boolean(item.includeAuthorInApproval) : undefined;
    const excludeIssueAssignee =
      claimMode === "exclusive" || claimMode === "pool"
        ? Boolean(item.excludeIssueAssignee) || undefined
        : undefined;

    const closing = STEP_CLOSINGS.includes(item.closing as StepClosing) ? (item.closing as StepClosing) : undefined;
    const scope = STEP_SCOPES.includes(item.scope as StepScope) && item.scope !== "subtask" ? (item.scope as StepScope) : undefined;

    steps.push({
      id,
      name,
      names: normalizeLocalized(item.names),
      actionLabel: String(item.actionLabel ?? "").trim() || undefined,
      actionLabels: normalizeLocalized(item.actionLabels),
      closing,
      checklist: normalizeChecklist(item.checklist),
      scope,
      ...(item.decisionRule === "unanimous" || item.decisionRule === "majority" ? { decisionRule: item.decisionRule } : {}),
      description: String(item.description ?? "").trim() || undefined,
      descriptions: normalizeLocalized(item.descriptions),
      solverAppId: String(item.solverAppId ?? "").trim() || undefined,
      claimMode: claimMode === "none" ? undefined : claimMode,
      minAssignees,
      maxAssignees,
      minIndependent,
      ...(claimMode === "pool" && Number(item.minAgree) >= 1 ? { minAgree: Math.floor(Number(item.minAgree)) } : {}),
      excludePriorStepIds: excludePriorStepIds?.length ? excludePriorStepIds : undefined,
      excludeIssueAssignee,
      includeAuthorInApproval: includeAuthorInApproval || undefined,
    });
  }
  return steps;
}

export function normalizeTeams(raw: unknown, people: Person[]): ProjectTask[] {
  if (!Array.isArray(raw)) return [];
  const personIds = new Set(people.map((row) => row.id));
  return raw
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const item = row as Partial<ProjectTask> & { description?: unknown };
      const legacyScope = Array.isArray(item.scope)
        ? item.scope.map(String).filter(isScopeKey)
        : [];
      const rules = normalizeRules(item.rules, legacyScope);
      const scope = scopeFromRules(rules);
      const memberIds = Array.isArray(item.memberIds)
        ? item.memberIds.map(String).filter((id) => personIds.has(id))
        : [];
      const grainRaw = String(item.grain ?? "").trim();
      const grain = isAssignmentGrain(grainRaw) ? grainRaw : undefined;
      const grainChapter = Number(item.grainChapter);
      const grainPortionIds = normalizeStringList(item.grainPortionIds);
      const grainItemIds = normalizeStringList(item.grainItemIds);
      const bundle = normalizeBundle(item.bundle);
      const orgTeamId = Number(item.orgTeamId);
      const phaseId = String(item.phaseId ?? "").trim() || "phase-default";
      const scriptureScope = normalizeScriptureScope(item.scriptureScope);
      const steps = normalizeTaskSteps(item.steps);
      const waitsFor = normalizeWaitRules(item.waitsFor);
      const minLevel = isLevel(item.minLevel) ? item.minLevel : undefined;
      return {
        id: String(item.id || uid()),
        name: String(item.name ?? "").trim(),
        names: normalizeLocalized(item.names),
        description: String(item.description ?? ""),
        phaseId,
        memberIds,
        scope: scope.length ? scope : legacyScope,
        rules,
        ...(item.general === true && !rules.length ? { general: true } : {}),
        scriptureScope,
        grain,
        grainChapter: Number.isFinite(grainChapter) && grainChapter > 0 ? grainChapter : undefined,
        grainPortionIds,
        grainItemIds,
        bundle,
        distributeUnit: normalizeDistributeUnit(item.distributeUnit, bundle),
        distributePolicy: normalizeDistributePolicy(item.distributePolicy),
        everyUnit: item.everyUnit === true ? true : undefined,
        orgTeamId: Number.isFinite(orgTeamId) && orgTeamId > 0 ? orgTeamId : undefined,
        orgTeamName: String(item.orgTeamName ?? "").trim() || undefined,
        solverAppId: String(item.solverAppId ?? "").trim() || undefined,
        steps: steps.length ? steps : undefined,
        waitsFor,
        minLevel,
        reviewsPrincipal: item.reviewsPrincipal === true ? true : undefined,
        reviewRef:
          item.reviewsPrincipal === true ? String(item.reviewRef ?? "").trim() || undefined : undefined,
        reviewAssigneeId:
          item.reviewsPrincipal === true
            ? String(item.reviewAssigneeId ?? "").trim() || undefined
            : undefined,
      } satisfies ProjectTask;
    })
    .filter((row) => row.name);
}

export function normalizeAssignments(raw: unknown): Assignment[] {
  if (!Array.isArray(raw)) return [];
  const rows: Assignment[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const item = row as Partial<Assignment>;
    const itemId = String(item.itemId ?? "").trim();
    const personId = String(item.personId ?? "");
    if (!itemId || !personId) continue;
    const itemType: ItemType = isItemType(String(item.itemType))
      ? (item.itemType as ItemType)
      : "articulo";
    const state: AssignmentState = isAssignmentState(String(item.state))
      ? (item.state as AssignmentState)
      : "asignado";
    const bundleId = String(item.bundleId ?? "").trim();
    rows.push({
      id: String(item.id || uid()),
      person: String(item.person ?? "").trim(),
      personId,
      teamId: String(item.teamId ?? ""),
      itemType,
      itemId,
      note: String(item.note ?? ""),
      state,
      bundleId: bundleId || undefined,
    });
  }
  return rows;
}

export function isInventoryDoc(value: unknown): value is InventoryDoc {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.book === "string" &&
    row.book.trim() !== "" &&
    Array.isArray(row.portions) &&
    Array.isArray(row.articles)
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizeTaskItems(
  raw: unknown,
  portionId: string,
  chapter: number,
  resource: TaskResource,
): InventoryTask[] {
  if (!Array.isArray(raw)) return [];
  const tasks: InventoryTask[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    const item = asRecord(row);
    const id = item
      ? String(item.id ?? "").trim()
      : typeof row === "string"
        ? row.trim()
        : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    tasks.push({
      id,
      ref: item ? String(item.ref ?? "").trim() : "",
      chapter: Number(item?.chapter) || chapter,
      portionId: item ? String(item.portion ?? item.portionId ?? "").trim() || portionId : portionId,
      resource,
    });
  }
  return tasks;
}

function normalizeArticleRefs(raw: unknown, seenInBook: Set<string>): PortionArticleRef[] {
  if (!Array.isArray(raw)) return [];
  const refs: PortionArticleRef[] = [];
  const seenHere = new Set<string>();
  for (const row of raw) {
    const item = asRecord(row);
    const id = item
      ? String(item.id ?? "").trim()
      : typeof row === "string"
        ? row.trim()
        : "";
    if (!id || seenHere.has(id)) continue;
    seenHere.add(id);
    const key = id.toLowerCase();
    const flagged =
      typeof item?.firstSeenInBook === "boolean" ? item.firstSeenInBook : !seenInBook.has(key);
    seenInBook.add(key);
    refs.push({ id, firstSeenInBook: flagged });
  }
  return refs;
}

export function normalizeInventory(raw: InventoryDoc): InventoryDoc {
  const seenAcademia = new Set<string>();
  const seenPalabras = new Set<string>();
  const portions: Portion[] = raw.portions
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const source = row as Portion & {
        notas_items?: unknown;
        preguntas_items?: unknown;
        notasItems?: unknown;
        preguntasItems?: unknown;
        tpl_items?: unknown;
        tps_items?: unknown;
        tplItems?: unknown;
        tpsItems?: unknown;
      };
      const id = String(source.id ?? "").trim();
      const ref = String(source.ref ?? "").trim();
      const chapter = Number(source.chapter) || 0;
      const portionId = id || ref;
      const tplItems = normalizeTaskItems(
        source.tplItems ?? source.tpl_items,
        portionId,
        chapter,
        "tpl",
      );
      const tpsItems = normalizeTaskItems(
        source.tpsItems ?? source.tps_items,
        portionId,
        chapter,
        "tps",
      );
      // Legacy inventories omit TPL/TPS: assume TPL for every ULT-cut portion.
      const tpl =
        Number(source.tpl) ||
        tplItems.length ||
        (source.tpl == null && source.tpl_items == null && source.tplItems == null ? 1 : 0);
      const tps = Number(source.tps) || tpsItems.length || 0;
      return {
        id: portionId,
        ref,
        chapter,
        book: String(source.book ?? raw.book ?? "").trim().toUpperCase() || undefined,
        verses: Array.isArray(source.verses)
          ? source.verses.map((n) => Number(n)).filter((n) => Number.isFinite(n))
          : [],
        tpl,
        tps,
        notas: Number(source.notas) || 0,
        preguntas: Number(source.preguntas) || 0,
        tplItems:
          tplItems.length || !tpl
            ? tplItems
            : [
                {
                  id: `tpl-${portionId}`,
                  ref,
                  chapter,
                  portionId,
                  resource: "tpl" as const,
                },
              ],
        tpsItems,
        notasItems: normalizeTaskItems(
          source.notasItems ?? source.notas_items,
          portionId,
          chapter,
          "notas",
        ),
        preguntasItems: normalizeTaskItems(
          source.preguntasItems ?? source.preguntas_items,
          portionId,
          chapter,
          "preguntas",
        ),
        academia: normalizeArticleRefs(source.academia, seenAcademia),
        palabras: normalizeArticleRefs(source.palabras, seenPalabras),
      };
    })
    .filter((row) => row.ref);

  const articles: Article[] = raw.articles
    .filter((row) => row && typeof row === "object")
    .map((row) => ({
      id: String(row.id ?? ""),
      kind: String(row.kind ?? ""),
      path: String(row.path ?? ""),
      status: isArticleStatus(String(row.status)) ? row.status : "missing",
      title: typeof row.title === "string" ? row.title : undefined,
      parent: typeof row.parent === "string" ? row.parent : undefined,
    }))
    .filter((row) => row.id);

  return {
    schema: raw.schema,
    generated_at: raw.generated_at,
    book: raw.book.trim().toUpperCase(),
    lang: raw.lang,
    contentOrg: raw.contentOrg ?? raw.dcs?.org,
    dcs: raw.dcs,
    counts: raw.counts,
    portions,
    preguntas_sin_asignar: Number(raw.preguntas_sin_asignar) || 0,
    articles,
  };
}

function normalizeProjectSettings(raw: unknown): ProjectSettings | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Partial<ProjectSettings> & { lastPublish?: unknown };
  const settings: ProjectSettings = {};
  if (typeof row.allowSelfAssign === "boolean") {
    settings.allowSelfAssign = row.allowSelfAssign;
  }
  if (row.lastPublish && typeof row.lastPublish === "object") {
    const pub = row.lastPublish as Record<string, unknown>;
    if (typeof pub.at === "string") {
      settings.lastPublish = {
        at: pub.at,
        created: Number(pub.created) || 0,
        updated: Number(pub.updated) || 0,
      };
    }
  }
  const releaseProfiles = normalizeReleaseProfiles(row.releaseProfiles);
  if (releaseProfiles) settings.releaseProfiles = releaseProfiles;
  const resourceNames = normalizeResourceNames(row.resourceNames);
  if (resourceNames) settings.resourceNames = resourceNames;
  const nextBookAt = normalizeShare(row.nextBookAt);
  if (nextBookAt !== undefined) settings.nextBookAt = nextBookAt;
  const maxChapterVerses = normalizeMaxVerses(row.maxChapterVerses);
  if (maxChapterVerses !== undefined) settings.maxChapterVerses = maxChapterVerses;
  const principalPasses = normalizePrincipalPasses(row.principalPasses);
  if (principalPasses) settings.principalPasses = principalPasses;
  const sourcePackage = normalizeSourcePackage(row.sourcePackage);
  if (sourcePackage) settings.sourcePackage = sourcePackage;
  const handoffUnits = normalizeHandoffUnits(row.handoffUnits);
  if (handoffUnits) settings.handoffUnits = handoffUnits;
  const portionStarts = normalizePortionStarts(row.portionStarts);
  if (portionStarts) settings.portionStarts = portionStarts;
  const extraWork = normalizeExtraWork(row.extraWork);
  if (extraWork) settings.extraWork = extraWork;
  return Object.keys(settings).length ? settings : undefined;
}

/** One mark per book + task (last wins); rows without task, book or time are dropped. */
export function normalizePrincipalPasses(raw: unknown): PrincipalPassMark[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const byKey = new Map<string, PrincipalPassMark>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<PrincipalPassMark>;
    const taskId = String(row.taskId ?? "").trim();
    const book = String(row.book ?? "").trim().toUpperCase();
    const serverAt = typeof row.serverAt === "string" ? row.serverAt : "";
    const at = typeof row.at === "string" && row.at ? row.at : serverAt;
    if (!taskId || !book || !at) continue;
    const issues = (Array.isArray(row.issues) ? row.issues : [])
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n > 0);
    const commits = (Array.isArray(row.commits) ? row.commits : [])
      .map((c) => String(c ?? "").trim())
      .filter(Boolean);
    byKey.set(`${book}|${taskId}`, {
      book,
      taskId,
      at,
      ...(serverAt ? { serverAt } : {}),
      by: String(row.by ?? ""),
      issues,
      ...(typeof row.closedThrough === "string" && row.closedThrough ? { closedThrough: row.closedThrough } : {}),
      ...(commits.length ? { commits } : {}),
    });
  }
  return byKey.size ? [...byKey.values()] : undefined;
}

/** Keeps profiles with a name; empty `requiredPhaseIds` stays (the UI asks for a phase). */
export function normalizeReleaseProfiles(raw: unknown): ReleaseProfile[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: ReleaseProfile[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<ReleaseProfile>;
    const name = String(row.name ?? "").trim();
    if (!name) continue;
    let id = String(row.id ?? "").trim() || uid();
    if (seen.has(id)) id = uid();
    seen.add(id);
    const requiredPhaseIds = [
      ...new Set(
        (Array.isArray(row.requiredPhaseIds) ? row.requiredPhaseIds : [])
          .map((p) => String(p ?? "").trim())
          .filter(Boolean),
      ),
    ];
    out.push({ id, name, requiredPhaseIds });
  }
  return out.length ? out : undefined;
}

export function projectAllowsSelfAssign(doc: Pick<AssignmentsDoc, "settings">): boolean {
  return Boolean(doc.settings?.allowSelfAssign);
}

export function projectWasPublished(doc: Pick<AssignmentsDoc, "settings" | "exported_at">): boolean {
  return Boolean(doc.settings?.lastPublish?.at || doc.exported_at);
}

/** True when the user belongs to an org team linked to any task in the project. */
export function userInvolvedInProject(
  doc: Pick<AssignmentsDoc, "teams">,
  sessionTeams: { name: string; organization?: { name?: string } | null }[] | undefined,
  pmOrg: string,
  /** Being one of the people of a task also counts (team decisions are for them). */
  username?: string,
): boolean {
  const me = username?.trim().toLowerCase();
  if (me && doc.teams.some((task) => task.memberIds.some((m) => m.trim().toLowerCase() === me))) return true;
  const mine = new Set(
    (sessionTeams ?? [])
      .filter((t) => t.organization?.name === pmOrg)
      .map((t) => t.name),
  );
  if (!mine.size) return false;
  return doc.teams.some((task) => Boolean(task.orgTeamName && mine.has(task.orgTeamName)));
}

export function normalizeAssignmentsDoc(
  raw: unknown,
  fallback: { book: string; lang: string; contentOrg: string; pmOrg: string },
): AssignmentsDoc {
  const row = (raw && typeof raw === "object" ? raw : {}) as Partial<AssignmentsDoc> & {
    tasks?: unknown;
    projectId?: unknown;
    title?: unknown;
    kind?: unknown;
    books?: unknown;
    settings?: unknown;
    workflowId?: unknown;
    workflowAppliedAt?: unknown;
    workflowVersion?: unknown;
  };
  const people = normalizePeople(row.people);
  const rawTaskList =
    Array.isArray(row.tasks) && row.tasks.length
      ? row.tasks
      : row.teams;
  const teams = normalizeTeams(rawTaskList, people);
  const phases = normalizePhases(row.phases, teams);
  const phaseIds = new Set(phases.map((p) => p.id));
  for (const task of teams) {
    if (!phaseIds.has(task.phaseId)) {
      task.phaseId = phases[0]?.id ?? "phase-default";
    }
  }
  const assignments = normalizeAssignments(row.assignments);
  const activeTeamId =
    typeof row.activeTeamId === "string" && teams.some((t) => t.id === row.activeTeamId)
      ? row.activeTeamId
      : "";
  const meta = resolveProjectMeta({
    projectId: String(row.projectId ?? ""),
    book: String(row.book || fallback.book),
    title: typeof row.title === "string" ? row.title : undefined,
    kind: typeof row.kind === "string" ? row.kind : undefined,
    books: row.books,
  });
  const settings = normalizeProjectSettings(row.settings);
  const workflowId = String(row.workflowId ?? "").trim() || undefined;
  const workflowVersion = Number.isInteger(Number(row.workflowVersion)) && Number(row.workflowVersion) > 0 ? Number(row.workflowVersion) : undefined;
  const workflowAppliedAt =
    typeof row.workflowAppliedAt === "string" && row.workflowAppliedAt.trim()
      ? row.workflowAppliedAt.trim()
      : undefined;
  return {
    schema: ASSIGNMENTS_SCHEMA,
    projectId: meta.projectId,
    book: meta.book,
    title: meta.title,
    kind: meta.kind,
    books: meta.books,
    lang: String(row.lang || fallback.lang),
    contentOrg: String(row.contentOrg || fallback.contentOrg),
    pmOrg: String(row.pmOrg || fallback.pmOrg),
    exported_at: typeof row.exported_at === "string" ? row.exported_at : undefined,
    settings,
    people,
    phases,
    teams,
    assignments,
    activeTeamId,
    workflowId,
    workflowVersion,
    workflowAppliedAt,
  };
}

function storageKey(lang: string, projectId: string): string {
  return `${STORE_PREFIX}${scopeKey()}${lang.trim().toLowerCase()}:${normalizeProjectId(projectId)}`;
}

export function loadLocalAssignments(
  lang: string,
  projectId: string,
  contentOrg: string,
  pmOrg: string,
): AssignmentsDoc {
  const id = normalizeProjectId(projectId);
  try {
    const raw = localStorage.getItem(storageKey(lang, id));
    if (!raw) return emptyAssignments(id, lang, contentOrg, pmOrg);
    return normalizeAssignmentsDoc(JSON.parse(raw), { book: id, lang, contentOrg, pmOrg });
  } catch {
    return emptyAssignments(id, lang, contentOrg, pmOrg);
  }
}

/** Edit only `settings` of this browser's copy of the plan; the rest stays byte-for-byte. */
export function editLocalProjectSettings(
  lang: string,
  projectId: string,
  edit: (settings: ProjectSettings | undefined) => ProjectSettings | undefined,
): void {
  const key = storageKey(lang, projectId);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const doc = JSON.parse(raw) as { settings?: ProjectSettings } & Record<string, unknown>;
    const next = edit(doc.settings);
    if (next === doc.settings) return;
    localStorage.setItem(key, JSON.stringify({ ...doc, settings: next }));
  } catch {
    /* no local copy in this browser */
  }
}

export function saveLocalAssignments(doc: AssignmentsDoc): void {
  const id = doc.projectId || doc.book;
  if (!id || !doc.lang) return;
  localStorage.setItem(storageKey(doc.lang, id), JSON.stringify(toPersistDoc(doc)));
}

/**
 * Wire shape for localStorage, download, and DCS.
 * Schema 2: projectId + books + kind; mirrors `book` = projectId for legacy readers.
 * Writes `tasks` only (no `teams` mirror); load still accepts legacy `teams[]`.
 */
export function toPersistDoc(doc: AssignmentsDoc): AssignmentsPersistDoc {
  const people = normalizePeople(doc.people);
  const teams = normalizeTeams(doc.teams, people);
  const phases = normalizePhases(doc.phases, teams);
  const phaseIds = new Set(phases.map((p) => p.id));
  const tasks = teams.map((task) => ({
    ...task,
    phaseId: phaseIds.has(task.phaseId) ? task.phaseId : phases[0]?.id ?? "phase-default",
  }));
  const meta = resolveProjectMeta({
    projectId: doc.projectId || doc.book,
    book: doc.book,
    title: doc.title,
    kind: doc.kind,
    books: doc.books,
  });
  return {
    schema: ASSIGNMENTS_SCHEMA,
    projectId: meta.projectId,
    book: meta.projectId,
    title: meta.title,
    kind: meta.kind,
    books: meta.books,
    lang: doc.lang,
    contentOrg: doc.contentOrg,
    pmOrg: doc.pmOrg,
    exported_at: typeof doc.exported_at === "string" ? doc.exported_at : undefined,
    settings: normalizeProjectSettings(doc.settings),
    people,
    phases,
    tasks,
    assignments: normalizeAssignments(doc.assignments),
    workflowId: String(doc.workflowId ?? "").trim() || undefined,
    workflowVersion: Number.isInteger(Number(doc.workflowVersion)) && Number(doc.workflowVersion) > 0 ? Number(doc.workflowVersion) : undefined,
    workflowAppliedAt:
      typeof doc.workflowAppliedAt === "string" && doc.workflowAppliedAt.trim()
        ? doc.workflowAppliedAt.trim()
        : undefined,
  };
}

export function toExportDoc(doc: AssignmentsDoc): AssignmentsPersistDoc {
  return toPersistDoc({
    ...doc,
    exported_at: new Date().toISOString(),
  });
}

/** Projects that already have a local assignments board for this language. */
export function listLocalBooks(lang: string): string[] {
  return listLocalProjects(lang);
}

export function listLocalProjects(lang: string): string[] {
  const prefix = `${STORE_PREFIX}${lang.trim().toLowerCase()}:`;
  const ids: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const id = normalizeProjectId(key.slice(prefix.length));
      if (id) ids.push(id);
    }
  } catch {
    return [];
  }
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b, "es"));
}

function projectsIndexKey(lang: string): string {
  return `${PROJECTS_INDEX_PREFIX}${scopeKey()}${lang.trim().toLowerCase()}`;
}

export function loadLocalProjectsIndex(lang: string): ProjectIndexEntry[] {
  try {
    const raw = localStorage.getItem(projectsIndexKey(lang));
    if (!raw) return [];
    return normalizeProjectsIndex(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveLocalProjectsIndex(lang: string, entries: ProjectIndexEntry[]): void {
  try {
    localStorage.setItem(projectsIndexKey(lang), JSON.stringify(entries));
  } catch {
    /* quota */
  }
}

export function normalizeProjectsIndex(raw: unknown): ProjectIndexEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ProjectIndexEntry[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const item = row as Partial<ProjectIndexEntry>;
    const meta = resolveProjectMeta({
      projectId: String(item.projectId ?? ""),
      title: item.title,
      kind: item.kind,
      books: item.books,
    });
    if (!meta.projectId || seen.has(meta.projectId)) continue;
    seen.add(meta.projectId);
    out.push({
      projectId: meta.projectId,
      title: meta.title,
      kind: meta.kind,
      books: meta.books,
      updated_at: typeof item.updated_at === "string" ? item.updated_at : undefined,
    });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, "es"));
}

/** Upsert project meta into the local index (and return the next list). */
export function upsertLocalProjectIndex(
  lang: string,
  entry: ProjectIndexEntry,
): ProjectIndexEntry[] {
  const meta = resolveProjectMeta(entry);
  const next = loadLocalProjectsIndex(lang).filter((e) => e.projectId !== meta.projectId);
  next.push({
    projectId: meta.projectId,
    title: meta.title,
    kind: meta.kind,
    books: meta.books,
    updated_at: entry.updated_at ?? new Date().toISOString(),
  });
  const sorted = next.sort((a, b) => a.title.localeCompare(b.title, "es"));
  saveLocalProjectsIndex(lang, sorted);
  return sorted;
}

/**
 * Merge several per-book inventories into one board inventory.
 * Portion ids are prefixed `{BOOK}:{id}` when more than one book is present.
 */
export function mergeInventories(
  docs: InventoryDoc[],
  projectLabel = "MULTI",
): InventoryDoc | null {
  if (!docs.length) return null;
  if (docs.length === 1) {
    const only = normalizeInventory(docs[0]);
    return {
      ...only,
      portions: only.portions.map((p) => ({
        ...p,
        book: p.book || only.book,
      })),
    };
  }
  const portions: Portion[] = [];
  const articles: Article[] = [];
  const seenArticles = new Set<string>();
  for (const raw of docs) {
    const doc = normalizeInventory(raw);
    const book = doc.book.toUpperCase();
    for (const portion of doc.portions) {
      const id = portion.id.includes(":") ? portion.id : `${book}:${portion.id}`;
      portions.push({
        ...portion,
        id,
        book,
        tplItems: portion.tplItems.map((t) => ({
          ...t,
          id: t.id.includes(":") ? t.id : `${book}:${t.id}`,
          portionId: id,
        })),
        tpsItems: portion.tpsItems.map((t) => ({
          ...t,
          id: t.id.includes(":") ? t.id : `${book}:${t.id}`,
          portionId: id,
        })),
        notasItems: portion.notasItems.map((t) => ({
          ...t,
          id: t.id.includes(":") ? t.id : `${book}:${t.id}`,
          portionId: id,
        })),
        preguntasItems: portion.preguntasItems.map((t) => ({
          ...t,
          id: t.id.includes(":") ? t.id : `${book}:${t.id}`,
          portionId: id,
        })),
      });
    }
    for (const article of doc.articles) {
      if (seenArticles.has(article.id)) continue;
      seenArticles.add(article.id);
      articles.push(article);
    }
  }
  return {
    book: projectLabel,
    lang: docs[0]?.lang,
    contentOrg: docs[0]?.contentOrg,
    portions,
    articles,
    preguntas_sin_asignar: portions.reduce((n, p) => n + (p.preguntas || 0), 0),
  };
}

export type SavedContext = {
  lang: string;
  contentOrg: string;
  pmOrg: string;
  book: string;
  host: string;
};

export function loadContext(): SavedContext | null {
  try {
    const raw = localStorage.getItem(CONTEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedContext>;
    if (!parsed.lang || !parsed.book) return null;
    return {
      lang: String(parsed.lang),
      contentOrg: String(parsed.contentOrg || ""),
      pmOrg: String(parsed.pmOrg || ""),
      book: String(parsed.book).toUpperCase(),
      host: String(parsed.host || "https://git.door43.org"),
    };
  } catch {
    return null;
  }
}

export function saveContext(ctx: SavedContext): void {
  localStorage.setItem(CONTEXT_KEY, JSON.stringify(ctx));
}

export function persistSessionInventory(doc: InventoryDoc): void {
  try {
    sessionStorage.setItem(SESSION_INV_KEY, JSON.stringify(doc));
  } catch {
    /* quota */
  }
}

export function restoreSessionInventory(): InventoryDoc | null {
  try {
    const raw = sessionStorage.getItem(SESSION_INV_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isInventoryDoc(parsed)) return null;
    return normalizeInventory(parsed);
  } catch {
    return null;
  }
}

export function teamsPath(lang: string): string {
  return `${scopeFolder()}${lang.trim().toLowerCase()}/teams.json`;
}

/** Team-shape presets aren't tied to one language or book, so they live at the repo root. */
export function teamPresetsPath(): string {
  return `${scopeFolder()}team-presets.json`;
}

/** Local entries win on a name collision; remote-only presets are added. */
export function mergeTeamPresets(local: TeamPreset[], remote: TeamPreset[]): TeamPreset[] {
  const byName = new Map(local.map((preset) => [preset.name.toLocaleLowerCase("es"), preset]));
  for (const preset of remote) {
    const key = preset.name.toLocaleLowerCase("es");
    if (!byName.has(key)) byName.set(key, preset);
  }
  return [...byName.values()];
}

export function assignmentsPath(lang: string, projectId: string): string {
  return `${scopeFolder()}${lang.trim().toLowerCase()}/${normalizeProjectId(projectId)}/assignments.json`;
}

export function inventoryPath(lang: string, book: string): string {
  return `${scopeFolder()}${lang.trim().toLowerCase()}/${normalizeProjectId(book)}/inventory.json`;
}

export function projectsIndexPath(lang: string): string {
  return `${scopeFolder()}${lang.trim().toLowerCase()}/projects.json`;
}

/** Drop anything specific to one book's structure before a rule is reused as a preset. */
function stripRuleForPreset(rule: ScopeRule): ScopeRule {
  return {
    resource: rule.resource,
    articleFilter: rule.articleFilter,
    grain: rule.grain,
    stayInChapter: rule.stayInChapter,
    includeDuplicates: rule.includeDuplicates,
  };
}

export function normalizeTeamPresets(raw: unknown): TeamPreset[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const item = row as Partial<TeamPreset>;
      const rules = normalizeRules(item.rules, []).map(stripRuleForPreset);
      const bundle = normalizeBundle(item.bundle);
      return {
        id: String(item.id || uid()),
        name: String(item.name ?? "").trim(),
        description: String(item.description ?? "").trim() || undefined,
        rules,
        bundle: bundle ? { enabled: bundle.enabled, grain: bundle.grain } : undefined,
        distributeUnit: normalizeDistributeUnit(item.distributeUnit, bundle),
        distributePolicy: normalizeDistributePolicy(item.distributePolicy),
        everyUnit: item.everyUnit === true ? true : undefined,
      };
    })
    .filter((row) => row.name && row.rules.length);
}

export function loadTeamPresets(): TeamPreset[] {
  try {
    const raw = localStorage.getItem(TEAM_PRESETS_KEY + scopeKey());
    if (!raw) return [];
    return normalizeTeamPresets(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveTeamPresets(presets: TeamPreset[]): void {
  try {
    localStorage.setItem(TEAM_PRESETS_KEY + scopeKey(), JSON.stringify(presets));
  } catch {
    /* quota */
  }
}

export function workflowsPath(): string {
  return `${scopeFolder()}workflows.json`;
}

function normalizeTaskTemplate(raw: unknown): TaskTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<TaskTemplate> & { scope?: unknown };
  const legacyScope = Array.isArray(item.scope)
    ? (item.scope as unknown[]).map(String).filter(isScopeKey)
    : [];
  const rules = normalizeRules(item.rules, legacyScope).map(stripRuleForPreset);
  // A task says what it works on, or says that it is general work.
  if (!rules.length && item.general !== true) return null;
  const name = String(item.name ?? "").trim();
  if (!name) return null;
  const bundle = normalizeBundle(item.bundle);
  const orgTeamId = Number(item.orgTeamId);
  const steps = normalizeTaskSteps(item.steps);
  const waitsFor = normalizeWaitRules(item.waitsFor);
  const minLevel = isLevel(item.minLevel) ? item.minLevel : undefined;
  return {
    id: String(item.id || uid()),
    name,
    names: normalizeLocalized(item.names),
    description: String(item.description ?? "").trim() || undefined,
    phaseId: String(item.phaseId ?? "").trim() || "phase-default",
    rules,
    ...(!rules.length ? { general: true } : {}),
    distributeUnit: normalizeDistributeUnit(item.distributeUnit, bundle),
    distributePolicy: normalizeDistributePolicy(item.distributePolicy),
        everyUnit: item.everyUnit === true ? true : undefined,
    bundle: bundle ? { enabled: bundle.enabled, grain: bundle.grain } : undefined,
    orgTeamId: Number.isFinite(orgTeamId) && orgTeamId > 0 ? orgTeamId : undefined,
    orgTeamName: String(item.orgTeamName ?? "").trim() || undefined,
    solverAppId: String(item.solverAppId ?? "").trim() || undefined,
    steps: steps.length ? steps : undefined,
    waitsFor,
    minLevel,
  };
}

export function normalizeWorkflowTemplate(raw: unknown): WorkflowTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<WorkflowTemplate>;
  const name = String(item.name ?? "").trim();
  if (!name) return null;
  const tasks = (Array.isArray(item.tasks) ? item.tasks : [])
    .map(normalizeTaskTemplate)
    .filter((t): t is TaskTemplate => Boolean(t));
  const phases = normalizePhases(item.phases, tasks as unknown as ProjectTask[]);
  const phaseIds = new Set(phases.map((p) => p.id));
  for (const task of tasks) {
    if (!phaseIds.has(task.phaseId)) {
      task.phaseId = phases[0]?.id ?? "phase-default";
    }
  }
  const releaseProfiles = normalizeReleaseProfiles(item.releaseProfiles)?.map((profile) => ({
    ...profile,
    requiredPhaseIds: profile.requiredPhaseIds.filter((id) => phaseIds.has(id)),
  }));
  const version = Number(item.version);
  const names = normalizeLocalized(item.names);
  const descriptions = normalizeLocalized(item.descriptions);
  return {
    id: String(item.id || uid()),
    name,
    ...(names ? { names } : {}),
    ...(Number.isInteger(version) && version > 0 ? { version } : {}),
    description: String(item.description ?? "").trim() || undefined,
    ...(descriptions ? { descriptions } : {}),
    phases,
    tasks,
    ...(releaseProfiles ? { releaseProfiles } : {}),
    ...(normalizeResourceNames(item.resourceNames) ? { resourceNames: normalizeResourceNames(item.resourceNames) } : {}),
    ...(normalizeShare(item.nextBookAt) !== undefined ? { nextBookAt: normalizeShare(item.nextBookAt) } : {}),
    ...(normalizeMaxVerses(item.maxChapterVerses) !== undefined ? { maxChapterVerses: normalizeMaxVerses(item.maxChapterVerses) } : {}),
  };
}

export function normalizeWorkflowsCatalog(raw: unknown): WorkflowsCatalog {
  const row =
    raw && typeof raw === "object"
      ? (raw as { workflows?: unknown; schema?: unknown })
      : {};
  const list = Array.isArray(row.workflows) ? row.workflows : Array.isArray(raw) ? raw : [];
  const workflows: WorkflowTemplate[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const wf = normalizeWorkflowTemplate(item);
    if (!wf || seen.has(wf.id)) continue;
    seen.add(wf.id);
    workflows.push(wf);
  }
  return { schema: WORKFLOWS_SCHEMA, workflows };
}

export function loadLocalWorkflows(): WorkflowsCatalog {
  try {
    const raw = localStorage.getItem(WORKFLOWS_KEY + scopeKey());
    if (!raw) return { schema: WORKFLOWS_SCHEMA, workflows: [] };
    return normalizeWorkflowsCatalog(JSON.parse(raw));
  } catch {
    return { schema: WORKFLOWS_SCHEMA, workflows: [] };
  }
}

export function saveLocalWorkflows(catalog: WorkflowsCatalog): void {
  try {
    localStorage.setItem(
      WORKFLOWS_KEY + scopeKey(),
      JSON.stringify(normalizeWorkflowsCatalog(catalog)),
    );
  } catch {
    /* quota */
  }
}

/** Local entries win on id collision; remote-only workflows are added. */
export function mergeWorkflowCatalogs(
  local: WorkflowsCatalog,
  remote: WorkflowsCatalog,
): WorkflowsCatalog {
  const byId = new Map(local.workflows.map((w) => [w.id, w]));
  for (const wf of remote.workflows) {
    if (!byId.has(wf.id)) byId.set(wf.id, wf);
  }
  return { schema: WORKFLOWS_SCHEMA, workflows: [...byId.values()] };
}
