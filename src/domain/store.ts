import {
  ASSIGNMENTS_SCHEMA,
  type Article,
  type ArticleStatus,
  type Assignment,
  type AssignmentGrain,
  type AssignmentState,
  type AssignmentsDoc,
  type BundleGrain,
  type InventoryDoc,
  type InventoryTask,
  type ItemType,
  type ArticleFilter,
  type Person,
  type Portion,
  type PortionArticleRef,
  type ScopeKey,
  type ScopeRule,
  type Team,
  type TeamBundle,
  type TeamPreset,
  type TaskResource,
  ARTICLE_FILTERS,
  ASSIGNMENT_GRAINS,
  BUNDLE_GRAINS,
  SCOPE_KEYS,
} from "./types";
import { scopeFromRules, uid } from "./assignment";

const STORE_PREFIX = "gt-assignments:";
const CONTEXT_KEY = "gt-context";
const SESSION_INV_KEY = "gt-session-inventory";
const TEAM_PRESETS_KEY = "gt-team-presets";

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

function isArticleFilter(value: string): value is ArticleFilter {
  return (ARTICLE_FILTERS as string[]).includes(value);
}

export function emptyAssignments(
  book: string,
  lang: string,
  contentOrg: string,
  pmOrg: string,
): AssignmentsDoc {
  return {
    schema: ASSIGNMENTS_SCHEMA,
    book: book.toUpperCase(),
    lang,
    contentOrg,
    pmOrg,
    people: [],
    teams: [],
    assignments: [],
    activeTeamId: "",
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

export function normalizeTeams(raw: unknown, people: Person[]): Team[] {
  if (!Array.isArray(raw)) return [];
  const personIds = new Set(people.map((row) => row.id));
  return raw
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const item = row as Partial<Team> & { description?: unknown };
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
      return {
        id: String(item.id || uid()),
        name: String(item.name ?? "").trim(),
        description: String(item.description ?? ""),
        memberIds,
        scope: scope.length ? scope : legacyScope,
        rules,
        grain,
        grainChapter: Number.isFinite(grainChapter) && grainChapter > 0 ? grainChapter : undefined,
        grainPortionIds,
        grainItemIds,
        bundle: normalizeBundle(item.bundle),
      };
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
      };
      const id = String(source.id ?? "").trim();
      const ref = String(source.ref ?? "").trim();
      const chapter = Number(source.chapter) || 0;
      const portionId = id || ref;
      return {
        id: portionId,
        ref,
        chapter,
        verses: Array.isArray(source.verses)
          ? source.verses.map((n) => Number(n)).filter((n) => Number.isFinite(n))
          : [],
        notas: Number(source.notas) || 0,
        preguntas: Number(source.preguntas) || 0,
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

export function normalizeAssignmentsDoc(
  raw: unknown,
  fallback: { book: string; lang: string; contentOrg: string; pmOrg: string },
): AssignmentsDoc {
  const row = (raw && typeof raw === "object" ? raw : {}) as Partial<AssignmentsDoc>;
  const people = normalizePeople(row.people);
  const teams = normalizeTeams(row.teams, people);
  const assignments = normalizeAssignments(row.assignments);
  const activeTeamId =
    typeof row.activeTeamId === "string" && teams.some((t) => t.id === row.activeTeamId)
      ? row.activeTeamId
      : "";
  return {
    schema: ASSIGNMENTS_SCHEMA,
    book: String(row.book || fallback.book).toUpperCase(),
    lang: String(row.lang || fallback.lang),
    contentOrg: String(row.contentOrg || fallback.contentOrg),
    pmOrg: String(row.pmOrg || fallback.pmOrg),
    exported_at: typeof row.exported_at === "string" ? row.exported_at : undefined,
    people,
    teams,
    assignments,
    activeTeamId,
  };
}

function storageKey(lang: string, book: string): string {
  return `${STORE_PREFIX}${lang.trim().toLowerCase()}:${book.trim().toUpperCase()}`;
}

export function loadLocalAssignments(
  lang: string,
  book: string,
  contentOrg: string,
  pmOrg: string,
): AssignmentsDoc {
  try {
    const raw = localStorage.getItem(storageKey(lang, book));
    if (!raw) return emptyAssignments(book, lang, contentOrg, pmOrg);
    return normalizeAssignmentsDoc(JSON.parse(raw), { book, lang, contentOrg, pmOrg });
  } catch {
    return emptyAssignments(book, lang, contentOrg, pmOrg);
  }
}

export function saveLocalAssignments(doc: AssignmentsDoc): void {
  if (!doc.book || !doc.lang) return;
  localStorage.setItem(storageKey(doc.lang, doc.book), JSON.stringify(doc));
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
  return `${lang.trim().toLowerCase()}/teams.json`;
}

export function assignmentsPath(lang: string, book: string): string {
  return `${lang.trim().toLowerCase()}/${book.trim().toUpperCase()}/assignments.json`;
}

export function inventoryPath(lang: string, book: string): string {
  return `${lang.trim().toLowerCase()}/${book.trim().toUpperCase()}/inventory.json`;
}

export function toExportDoc(doc: AssignmentsDoc): AssignmentsDoc {
  return {
    ...doc,
    schema: ASSIGNMENTS_SCHEMA,
    exported_at: new Date().toISOString(),
    activeTeamId: undefined,
  };
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
      };
    })
    .filter((row) => row.name && row.rules.length);
}

export function loadTeamPresets(): TeamPreset[] {
  try {
    const raw = localStorage.getItem(TEAM_PRESETS_KEY);
    if (!raw) return [];
    return normalizeTeamPresets(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveTeamPresets(presets: TeamPreset[]): void {
  try {
    localStorage.setItem(TEAM_PRESETS_KEY, JSON.stringify(presets));
  } catch {
    /* quota */
  }
}
