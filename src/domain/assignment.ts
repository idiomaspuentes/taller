import {
  type Article,
  type ArticleFilter,
  type Assignment,
  type AssignmentGrain,
  type AssignmentState,
  type BundleGrain,
  type InventoryTask,
  type ItemType,
  type Person,
  type Portion,
  type ScopeKey,
  type ScopeRule,
  type TaskResource,
  type Team,
  type TeamBundle,
  articleFilterLabel,
  citesArticlesFromPortions,
  displayResourceGrain,
  expandsArticleOccurrences,
  GRAIN_LABEL,
  isArticleResource,
  REMAINING,
  SCOPE_LABEL,
} from "./types";
import { flattenTasks, groupPortionsByChapter, portionKey } from "./chapters";

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function itemKey(type: ItemType, id: string): string {
  return `${type}:${id}`;
}

export function parseItemKey(key: string): { type: ItemType; id: string } | null {
  const split = key.indexOf(":");
  if (split < 1) return null;
  const type = key.slice(0, split);
  const id = key.slice(split + 1);
  if ((type !== "articulo" && type !== "porcion" && type !== "tarea") || !id) return null;
  return { type, id };
}

export function taskItemId(resource: TaskResource, id: string): string {
  return `${resource}:${id}`;
}

export function parseTaskItemId(itemId: string): { resource: TaskResource; id: string } | null {
  if (itemId.startsWith("notas:")) return { resource: "notas", id: itemId.slice(6) };
  if (itemId.startsWith("preguntas:")) return { resource: "preguntas", id: itemId.slice(10) };
  return null;
}

const ARTICLE_OCCURRENCE_SEP = "::";
const BUNDLE_KEY_PREFIX = "lote:";

export function articleOccurrenceId(portionId: string, articleId: string): string {
  return `${portionId}${ARTICLE_OCCURRENCE_SEP}${articleId}`;
}

export function parseArticleOccurrenceId(
  itemId: string,
): { portionId: string; articleId: string } | null {
  const split = itemId.indexOf(ARTICLE_OCCURRENCE_SEP);
  if (split < 1) return null;
  const portionId = itemId.slice(0, split);
  const articleId = itemId.slice(split + ARTICLE_OCCURRENCE_SEP.length);
  if (!portionId || !articleId) return null;
  return { portionId, articleId };
}

export function bundleKey(id: string): string {
  return `${BUNDLE_KEY_PREFIX}${id}`;
}

export function parseBundleKey(key: string): string | null {
  if (!key.startsWith(BUNDLE_KEY_PREFIX)) return null;
  const id = key.slice(BUNDLE_KEY_PREFIX.length);
  return id || null;
}

export function teamGrain(team: Team): AssignmentGrain | undefined {
  return team.grain;
}

export function teamBundle(team: Team): TeamBundle | undefined {
  return team.bundle;
}

export function bundleEnabled(team: Team): boolean {
  return Boolean(team.bundle?.enabled);
}

/** No grain on the team or any rule: oldest docs list the article catalog. */
export function isLegacyGrain(team: Team): boolean {
  return team.grain == null && teamRules(team).every((rule) => rule.grain == null);
}

export function resolvedRuleGrain(team: Team, rule: ScopeRule): AssignmentGrain | undefined {
  return rule.grain ?? team.grain;
}

export function ruleStayInChapter(team: Team, rule: ScopeRule): boolean {
  if (typeof rule.stayInChapter === "boolean") return rule.stayInChapter;
  const grain = resolvedRuleGrain(team, rule);
  if (grain === "chapter" || grain === "portionsInChapter" || grain === "portionRefs") return true;
  return bundleEnabled(team);
}

export function ruleIncludeDuplicates(team: Team, rule: ScopeRule): boolean {
  if (typeof rule.includeDuplicates === "boolean") return rule.includeDuplicates;
  const grain = resolvedRuleGrain(team, rule);
  return citesArticlesFromPortions(grain);
}

function allowedIdSet(ids?: string[]): Set<string> | null {
  if (!ids?.length) return null;
  const set = new Set(ids.map((id) => id.trim()).filter(Boolean));
  return set.size ? set : null;
}

function itemIdSet(team: Team, rule: ScopeRule): Set<string> | null {
  return allowedIdSet(rule.itemIds?.length ? rule.itemIds : team.grainItemIds);
}

function idAllowed(allowed: Set<string> | null, ...candidates: string[]): boolean {
  if (!allowed) return true;
  return candidates.some((id) => id && allowed.has(id));
}

type GeoSpec = {
  chapter?: number;
  portionIds?: string[];
  stayInChapter: boolean;
};

function bundleGeo(team: Team): GeoSpec | null {
  if (!team.bundle?.enabled) return null;
  return {
    chapter: team.bundle.chapter,
    portionIds: team.bundle.portionIds,
    stayInChapter: true,
  };
}

function ruleGeo(team: Team, rule: ScopeRule): GeoSpec {
  const bundled = bundleGeo(team);
  if (bundled) return bundled;
  const grain = resolvedRuleGrain(team, rule);
  const portionIds = rule.portionIds?.length
    ? rule.portionIds
    : grain === "portionsInChapter"
      ? team.grainPortionIds
      : rule.stayInChapter !== false && team.grainPortionIds?.length
        ? team.grainPortionIds
        : undefined;
  return {
    chapter: rule.chapter ?? team.grainChapter,
    portionIds,
    stayInChapter: ruleStayInChapter(team, rule),
  };
}

function teamGeo(team: Team): GeoSpec {
  const bundled = bundleGeo(team);
  if (bundled) return bundled;
  return {
    chapter: team.grainChapter,
    portionIds: team.grainPortionIds,
    stayInChapter: team.grain === "chapter" || team.grain === "portionsInChapter",
  };
}

function filterPortionsByGeo(portions: Portion[], spec: GeoSpec): Portion[] {
  let rows = portions;
  if (spec.chapter) {
    rows = rows.filter((portion) => portion.chapter === spec.chapter);
  }
  if (spec.portionIds?.length) {
    const allowed = new Set(spec.portionIds);
    rows = rows.filter(
      (portion) => allowed.has(portionKey(portion)) || allowed.has(portion.ref),
    );
  }
  return rows;
}

export function portionsMatchingRule(
  team: Team,
  rule: ScopeRule,
  portions: Portion[],
): Portion[] {
  return filterPortionsByGeo(portions, ruleGeo(team, rule));
}

export function portionsMatchingGrain(team: Team, portions: Portion[]): Portion[] {
  if (bundleEnabled(team) || isLegacyGrain(team) || !teamRules(team).length) {
    return filterPortionsByGeo(portions, teamGeo(team));
  }
  const seen = new Set<string>();
  const rows: Portion[] = [];
  for (const rule of teamRules(team)) {
    for (const portion of portionsMatchingRule(team, rule, portions)) {
      const key = portionKey(portion);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(portion);
    }
  }
  if (!rows.length && (team.grainChapter || team.grainPortionIds?.length)) {
    return filterPortionsByGeo(portions, teamGeo(team));
  }
  return rows.length ? rows : portions;
}

function showsNoteRowsForRule(team: Team, rule: ScopeRule): boolean {
  if (rule.resource !== "notas" && rule.resource !== "preguntas") return false;
  return resolvedRuleGrain(team, rule) !== "portion";
}

export function showsNoteRows(team: Team): boolean {
  if (isLegacyGrain(team)) return false;
  return teamRules(team).some((rule) => showsNoteRowsForRule(team, rule));
}

export function showsPortionRows(team: Team): boolean {
  if (isLegacyGrain(team)) {
    return teamRules(team).some((rule) => rule.resource === "notas" || rule.resource === "preguntas");
  }
  return teamRules(team).some((rule) => {
    if (rule.resource !== "notas" && rule.resource !== "preguntas") return false;
    return resolvedRuleGrain(team, rule) === "portion";
  });
}

export function tasksInScope(team: Team, portions: Portion[]): InventoryTask[] {
  const tasks: InventoryTask[] = [];
  const seen = new Set<string>();
  for (const rule of teamRules(team)) {
    if (!showsNoteRowsForRule(team, rule)) continue;
    const scoped = portionsMatchingRule(team, rule, portions).filter((portion) =>
      portionMatchesFilter(portion, rule.resource as TaskResource, rule.articleFilter),
    );
    const allowedIds = itemIdSet(team, rule);
    for (const task of flattenTasks(scoped, rule.resource as TaskResource)) {
      if (
        !idAllowed(
          allowedIds,
          task.id,
          taskItemId(task.resource, task.id),
        )
      ) {
        continue;
      }
      const key = taskItemId(task.resource, task.id);
      if (seen.has(key)) continue;
      seen.add(key);
      tasks.push(task);
    }
  }
  return tasks;
}

export type ScopedArticle = Article & {
  firstSeenInBook: boolean;
  portionId?: string;
  portionRef?: string;
  occurrenceId: string;
};

export function articleAssignmentId(article: ScopedArticle): string {
  return article.occurrenceId;
}

function portionArticleRefs(portion: Portion, resource: ScopeKey) {
  if (resource === "academia") return portion.academia;
  if (resource === "palabras") return portion.palabras;
  return [];
}

function catalogArticle(
  catalog: Map<string, Article>,
  id: string,
  resource: ScopeKey,
): Article {
  return (
    catalog.get(id) ?? {
      id,
      kind: articleKindFor(resource) ?? "",
      path: "",
      status: "missing",
    }
  );
}

function kindForResource(resource: ScopeKey): string | null {
  return articleKindFor(resource);
}

function resourceForKind(kind: string): ScopeKey | undefined {
  if (kind === "Translation Academy") return "academia";
  if (kind === "Translation Words") return "palabras";
  return undefined;
}

function articlesFromCatalog(rule: ScopeRule, articles: Article[]): ScopedArticle[] {
  const kind = kindForResource(rule.resource);
  if (!kind) return [];
  return articles
    .filter((article) => article.kind === kind && articleMatchesFilter(article, rule.articleFilter))
    .map((article) => ({ ...article, firstSeenInBook: true, occurrenceId: article.id }));
}

function uniqueCitedArticles(
  team: Team,
  rule: ScopeRule,
  portions: Portion[],
  articles: Article[],
): ScopedArticle[] {
  const catalog = new Map(articles.map((article) => [article.id, article]));
  const cited = new Map<string, { firstSeenInBook: boolean }>();
  for (const portion of portionsMatchingRule(team, rule, portions)) {
    for (const ref of portionArticleRefs(portion, rule.resource)) {
      if (!cited.has(ref.id)) {
        cited.set(ref.id, { firstSeenInBook: ref.firstSeenInBook });
      }
    }
  }
  const rows: ScopedArticle[] = [];
  for (const [id, meta] of cited) {
    const article = catalogArticle(catalog, id, rule.resource);
    if (!articleMatchesFilter(article, rule.articleFilter)) continue;
    rows.push({ ...article, firstSeenInBook: meta.firstSeenInBook, occurrenceId: article.id });
  }
  return rows;
}

function expandedCitedArticles(
  team: Team,
  rule: ScopeRule,
  portions: Portion[],
  articles: Article[],
): ScopedArticle[] {
  const catalog = new Map(articles.map((article) => [article.id, article]));
  const rows: ScopedArticle[] = [];
  for (const portion of portionsMatchingRule(team, rule, portions)) {
    const key = portionKey(portion);
    for (const ref of portionArticleRefs(portion, rule.resource)) {
      const article = catalogArticle(catalog, ref.id, rule.resource);
      if (!articleMatchesFilter(article, rule.articleFilter)) continue;
      rows.push({
        ...article,
        firstSeenInBook: ref.firstSeenInBook,
        portionId: key,
        portionRef: portion.ref,
        occurrenceId: articleOccurrenceId(key, article.id),
      });
    }
  }
  return rows;
}

/**
 * Catalog only when the grain is unset (oldest docs) or explicit `item` without
 * a geographic citation scope. Legacy `team.grain === "item"` stays unique-cited.
 */
function listsCatalogArticles(team: Team, rule: ScopeRule): boolean {
  const grain = resolvedRuleGrain(team, rule);
  if (grain == null) return true;
  if (grain !== "item") return false;
  if (ruleStayInChapter(team, rule) || rule.chapter || rule.portionIds?.length) return false;
  if (bundleEnabled(team)) return false;
  if (team.grain === "item" && rule.grain == null) return false;
  return true;
}

export function articlesInGrain(
  team: Team,
  portions: Portion[],
  articles: Article[],
): ScopedArticle[] {
  if (isLegacyGrain(team)) {
    return articles
      .filter((article) => articleInScope(article, team))
      .map((article) => ({ ...article, firstSeenInBook: true, occurrenceId: article.id }));
  }

  const rows: ScopedArticle[] = [];
  const seen = new Set<string>();
  for (const rule of teamRules(team)) {
    if (!isArticleResource(rule.resource)) continue;
    const grain = resolvedRuleGrain(team, rule);
    let listed: ScopedArticle[];
    if (listsCatalogArticles(team, rule)) {
      listed = articlesFromCatalog(rule, articles);
    } else if (expandsArticleOccurrences(grain, ruleIncludeDuplicates(team, rule))) {
      listed = expandedCitedArticles(team, rule, portions, articles);
    } else {
      listed = uniqueCitedArticles(team, rule, portions, articles);
    }
    for (const row of listed) {
      if (seen.has(row.occurrenceId)) continue;
      seen.add(row.occurrenceId);
      rows.push(row);
    }
  }
  return rows;
}

export function articleLabel(article: Article): string {
  return article.title?.trim() || article.id;
}

/** Legacy `scope[]` becomes pending-only rules (old article matching). */
export function teamRules(team: Team): ScopeRule[] {
  if (Array.isArray(team.rules) && team.rules.length) return team.rules;
  return (team.scope ?? []).map((resource) => ({
    resource,
    articleFilter: "pending" as const,
  }));
}

export function scopeFromRules(rules: ScopeRule[]): ScopeKey[] {
  const seen = new Set<ScopeKey>();
  const scope: ScopeKey[] = [];
  for (const rule of rules) {
    if (seen.has(rule.resource)) continue;
    seen.add(rule.resource);
    scope.push(rule.resource);
  }
  return scope;
}

export function scopeRuleLabel(rule: ScopeRule, grain?: AssignmentGrain): string {
  const resolved = grain ?? rule.grain;
  const filter = articleFilterLabel(rule.resource, rule.articleFilter, resolved).toLocaleLowerCase(
    "es",
  );
  const grainText = resolved ? ` · ${GRAIN_LABEL[displayResourceGrain(resolved)].toLocaleLowerCase("es")}` : "";
  return `${SCOPE_LABEL[rule.resource]} · ${filter}${grainText}`;
}

export function teamPhaseLabel(team: Team): string {
  const note = team.description?.trim();
  return note ? `${team.name} — ${note}` : team.name;
}

function articleKindFor(resource: ScopeKey): string | null {
  if (resource === "academia") return "Translation Academy";
  if (resource === "palabras") return "Translation Words";
  return null;
}

function articleMatchesFilter(article: Article, filter: ArticleFilter): boolean {
  if (filter === "all") return true;
  if (filter === "pending") return REMAINING.has(article.status);
  return article.status === filter;
}

function portionCount(portion: Portion, resource: "notas" | "preguntas"): number {
  return resource === "notas" ? portion.notas : portion.preguntas;
}

/** Portions have counts only — never invent article statuses. */
function portionMatchesFilter(
  portion: Portion,
  resource: "notas" | "preguntas",
  filter: ArticleFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "pending") return portionCount(portion, resource) > 0;
  return false;
}

/** Portions expose counts only (no article status). `pending` = count > 0; `all` = every portion. */
export function portionInScope(portion: Portion, team: Team): boolean {
  for (const rule of teamRules(team)) {
    if (rule.resource !== "notas" && rule.resource !== "preguntas") continue;
    if (portionMatchesFilter(portion, rule.resource, rule.articleFilter)) return true;
  }
  return false;
}

/** How many inventory rows a single resource rule covers. */
export function ruleItemCount(
  rule: ScopeRule,
  portions: Portion[],
  articles: Article[],
  team?: Team,
): number {
  const fake: Team = team
    ? { ...team, rules: [rule], scope: [rule.resource] }
    : {
        id: "count",
        name: "",
        description: "",
        memberIds: [],
        rules: [rule],
        scope: [rule.resource],
        grain: rule.grain,
      };
  if (rule.resource === "notas" || rule.resource === "preguntas") {
    const resource = rule.resource;
    if (showsNoteRowsForRule(fake, rule)) {
      return tasksInScope(fake, portions).length;
    }
    return portionsMatchingRule(fake, rule, portions).filter((row) =>
      portionMatchesFilter(row, resource, rule.articleFilter),
    ).length;
  }
  return articlesInGrain(fake, portions, articles).length;
}

/** Article matches if any included resource rule covers its kind and filter. */
export function articleInScope(article: Article, team: Team): boolean {
  for (const rule of teamRules(team)) {
    const kind = articleKindFor(rule.resource);
    if (!kind || article.kind !== kind) continue;
    if (articleMatchesFilter(article, rule.articleFilter)) return true;
  }
  return false;
}

export function itemInTeamScope(
  type: ItemType,
  id: string,
  team: Team,
  portions: Portion[],
  articles: Article[],
): boolean {
  if (type === "tarea") {
    const parsed = parseTaskItemId(id);
    if (!parsed) return false;
    return tasksInScope(team, portions).some(
      (task) => task.resource === parsed.resource && task.id === parsed.id,
    );
  }
  if (type === "porcion") {
    const scoped = portionsMatchingGrain(team, portions);
    const portion = scoped.find((row) => row.ref === id || row.id === id);
    return portion ? portionInScope(portion, team) : false;
  }
  return articlesInGrain(team, portions, articles).some(
    (row) => row.occurrenceId === id || row.id === id,
  );
}

/** Assignment for this item on this team (phase). Other teams' rows are ignored. */
export function assignmentFor(
  assignments: Assignment[],
  type: ItemType,
  id: string,
  teamId?: string,
): Assignment | undefined {
  if (teamId) {
    return assignments.find(
      (row) => row.itemType === type && row.itemId === id && row.teamId === teamId,
    );
  }
  return assignments.find((row) => row.itemType === type && row.itemId === id);
}

export type WorkItem = {
  type: ItemType;
  id: string;
  resource?: ScopeKey;
  portionId?: string;
};

function workItemsInScope(
  team: Team,
  portions: Portion[],
  articles: Article[],
): WorkItem[] {
  const items: WorkItem[] = [];
  if (showsNoteRows(team)) {
    for (const task of tasksInScope(team, portions)) {
      items.push({
        type: "tarea",
        id: taskItemId(task.resource, task.id),
        resource: task.resource,
        portionId: task.portionId,
      });
    }
  }
  if (showsPortionRows(team)) {
    const scoped = portionsMatchingGrain(team, portions);
    for (const portion of scoped) {
      if (!portionInScope(portion, team)) continue;
      items.push({ type: "porcion", id: portion.ref, portionId: portionKey(portion) });
    }
  }
  const sorted = [...articlesInGrain(team, portions, articles)].sort((a, b) => {
    const portionCmp = (a.portionRef ?? "").localeCompare(b.portionRef ?? "", "es");
    if (portionCmp) return portionCmp;
    return articleLabel(a).localeCompare(articleLabel(b), "es");
  });
  for (const article of sorted) {
    items.push({
      type: "articulo",
      id: articleAssignmentId(article),
      resource: resourceForKind(article.kind),
      portionId: article.portionId,
    });
  }
  return items;
}

/** Unassigned (or empty) items in a team's scope, ignoring other teams' phases. */
export function unassignedInScope(
  team: Team,
  portions: Portion[],
  articles: Article[],
  assignments: Assignment[],
): { type: ItemType; id: string }[] {
  const items: { type: ItemType; id: string }[] = [];
  for (const item of workItemsInScope(team, portions, articles)) {
    const current = assignmentFor(assignments, item.type, item.id, team.id);
    if (current && current.state !== "sin asignar" && current.personId) continue;
    items.push({ type: item.type, id: item.id });
  }
  return items;
}

function teamForBundleUnit(team: Team, unitPortionIds: string[], chapter?: number): Team {
  const portionIds = unitPortionIds.length ? unitPortionIds : undefined;
  return {
    ...team,
    grainChapter: chapter ?? team.grainChapter,
    grainPortionIds: portionIds,
    bundle: team.bundle
      ? { ...team.bundle, chapter: chapter ?? team.bundle.chapter, portionIds }
      : undefined,
    rules: teamRules(team).map((rule) => ({
      ...rule,
      chapter: chapter ?? rule.chapter,
      portionIds,
    })),
  };
}

export type ScopeBundle = {
  id: string;
  grain: BundleGrain;
  label: string;
  chapter: number;
  portionIds: string[];
  portionRefs: string[];
  items: WorkItem[];
  counts: Record<ScopeKey, number>;
};

function emptyCounts(): Record<ScopeKey, number> {
  return { notas: 0, preguntas: 0, academia: 0, palabras: 0 };
}

function countWorkItem(counts: Record<ScopeKey, number>, item: WorkItem): void {
  if (item.type === "tarea" && (item.resource === "notas" || item.resource === "preguntas")) {
    counts[item.resource] += 1;
    return;
  }
  if (item.type === "porcion") {
    counts.notas += 1;
    return;
  }
  if (item.resource === "academia" || item.resource === "palabras") {
    counts[item.resource] += 1;
  }
}

function bundleUnits(
  team: Team,
  portions: Portion[],
): {
  id: string;
  grain: BundleGrain;
  label: string;
  chapter: number;
  portionIds: string[];
  portionRefs: string[];
  portions: Portion[];
}[] {
  const grain: BundleGrain = team.bundle?.grain ?? "portion";
  const scoped = filterPortionsByGeo(portions, teamGeo(team));
  if (grain === "portion") {
    return scoped.map((portion) => {
      const key = portionKey(portion);
      return {
        id: `portion:${key}`,
        grain,
        label: `Porción ${portion.ref}`,
        chapter: portion.chapter,
        portionIds: [key],
        portionRefs: [portion.ref],
        portions: [portion],
      };
    });
  }
  return groupPortionsByChapter(scoped).map((group) => {
    const ids = group.portions.map(portionKey);
    const refs = group.portions.map((portion) => portion.ref);
    if (grain === "chapter") {
      return {
        id: `chapter:${group.chapter}`,
        grain,
        label: `Capítulo ${group.chapter}`,
        chapter: group.chapter,
        portionIds: ids,
        portionRefs: refs,
        portions: group.portions,
      };
    }
    return {
      id: `chapter-portions:${group.chapter}:${[...ids].sort().join(",")}`,
      grain,
      label:
        group.portions.length === 1
          ? `Porción ${group.portions[0].ref}`
          : `Porciones ${refs.join(" · ")}`,
      chapter: group.chapter,
      portionIds: ids,
      portionRefs: refs,
      portions: group.portions,
    };
  });
}

export function bundlesInScope(
  team: Team,
  portions: Portion[],
  articles: Article[],
): ScopeBundle[] {
  if (!bundleEnabled(team)) return [];
  const bundles: ScopeBundle[] = [];
  for (const unit of bundleUnits(team, portions)) {
    const scopedTeam = teamForBundleUnit(team, unit.portionIds, unit.chapter);
    const items = workItemsInScope(scopedTeam, portions, articles);
    if (!items.length) continue;
    const counts = emptyCounts();
    for (const item of items) countWorkItem(counts, item);
    bundles.push({
      id: unit.id,
      grain: unit.grain,
      label: unit.label,
      chapter: unit.chapter,
      portionIds: unit.portionIds,
      portionRefs: unit.portionRefs,
      items,
      counts,
    });
  }
  return bundles;
}

export function bundleSummary(bundle: ScopeBundle): string {
  const parts: string[] = [];
  if (bundle.counts.notas) {
    parts.push(`${bundle.counts.notas} ${bundle.counts.notas === 1 ? "nota" : "notas"}`);
  }
  if (bundle.counts.preguntas) {
    parts.push(
      `${bundle.counts.preguntas} ${bundle.counts.preguntas === 1 ? "pregunta" : "preguntas"}`,
    );
  }
  if (bundle.counts.academia) {
    parts.push(`${bundle.counts.academia} academia`);
  }
  if (bundle.counts.palabras) {
    parts.push(`${bundle.counts.palabras} palabras`);
  }
  return parts.length ? `${bundle.label} · ${parts.join(" · ")}` : bundle.label;
}

function bundleState(
  bundle: ScopeBundle,
  assignments: Assignment[],
  teamId: string,
): AssignmentState {
  const states = bundle.items.map((item) => {
    const current = assignmentFor(assignments, item.type, item.id, teamId);
    if (!current || current.state === "sin asignar" || !current.personId) return "sin asignar";
    return current.state;
  });
  if (!states.length || states.every((state) => state === "sin asignar")) return "sin asignar";
  if (states.every((state) => state === "hecho")) return "hecho";
  if (states.every((state) => state === "en curso")) return "en curso";
  if (states.some((state) => state === "sin asignar")) return "sin asignar";
  return "asignado";
}

export function bundleAssignmentState(
  bundle: ScopeBundle,
  assignments: Assignment[],
  teamId: string,
): AssignmentState {
  return bundleState(bundle, assignments, teamId);
}

function unassignedBundles(
  team: Team,
  portions: Portion[],
  articles: Article[],
  assignments: Assignment[],
): ScopeBundle[] {
  return bundlesInScope(team, portions, articles).filter(
    (bundle) => bundleState(bundle, assignments, team.id) === "sin asignar",
  );
}

function upsertAssignment(
  list: Assignment[],
  type: ItemType,
  id: string,
  person: Person,
  teamId: string,
  state: AssignmentState,
  note: string,
  bundleId?: string,
): Assignment[] {
  const next = list.filter(
    (row) => !(row.itemType === type && row.itemId === id && row.teamId === teamId),
  );
  next.push({
    id: uid(),
    person: person.name,
    personId: person.id,
    teamId,
    itemType: type,
    itemId: id,
    note,
    state,
    bundleId,
  });
  return next;
}

export type AssignResult = {
  assignments: Assignment[];
  added: number;
  skipped: number;
};

function expandSelectedKeys(
  selectedKeys: string[],
  team: Team,
  portions: Portion[],
  articles: Article[],
): { type: ItemType; id: string; bundleId?: string }[] {
  const expanded: { type: ItemType; id: string; bundleId?: string }[] = [];
  const seen = new Set<string>();
  const bundles = bundleEnabled(team) ? bundlesInScope(team, portions, articles) : [];
  for (const key of selectedKeys) {
    const lote = parseBundleKey(key);
    if (lote) {
      const found = bundles.find((row) => row.id === lote);
      if (!found) continue;
      for (const item of found.items) {
        const itemKeyId = itemKey(item.type, item.id);
        if (seen.has(itemKeyId)) continue;
        seen.add(itemKeyId);
        expanded.push({ type: item.type, id: item.id, bundleId: found.id });
      }
      continue;
    }
    const parsed = parseItemKey(key);
    if (!parsed) continue;
    const itemKeyId = itemKey(parsed.type, parsed.id);
    if (seen.has(itemKeyId)) continue;
    seen.add(itemKeyId);
    expanded.push(parsed);
  }
  return expanded;
}

/** Assign selected item keys (or lote keys) to a person on a team. Skips out-of-scope items. */
export function assignToPerson(
  assignments: Assignment[],
  selectedKeys: string[],
  person: Person,
  team: Team,
  portions: Portion[],
  articles: Article[],
  state: AssignmentState = "asignado",
  note = "",
): AssignResult {
  let list = [...assignments];
  let added = 0;
  let skipped = 0;
  for (const item of expandSelectedKeys(selectedKeys, team, portions, articles)) {
    if (!itemInTeamScope(item.type, item.id, team, portions, articles)) {
      skipped += 1;
      continue;
    }
    list = upsertAssignment(
      list,
      item.type,
      item.id,
      person,
      team.id,
      state,
      note,
      item.bundleId,
    );
    added += 1;
  }
  return { assignments: list, added, skipped };
}

/** Round-robin unassigned in-scope items — or lotes when “asignar juntos” is on. */
export function autoAssign(
  assignments: Assignment[],
  team: Team,
  people: Person[],
  portions: Portion[],
  articles: Article[],
): { assignments: Assignment[]; assigned: number; message: string } {
  const members = team.memberIds
    .map((id) => people.find((p) => p.id === id))
    .filter((row): row is Person => Boolean(row));
  if (!members.length) {
    return {
      assignments,
      assigned: 0,
      message: `Añade integrantes a ${team.name} antes de autoasignar.`,
    };
  }
  if (bundleEnabled(team)) {
    const pool = unassignedBundles(team, portions, articles, assignments);
    if (!pool.length) {
      return {
        assignments,
        assigned: 0,
        message: `No queda un lote sin asignar en el alcance de ${team.name}.`,
      };
    }
    let list = [...assignments];
    let assignedItems = 0;
    pool.forEach((bundle, index) => {
      const member = members[index % members.length];
      for (const item of bundle.items) {
        list = upsertAssignment(
          list,
          item.type,
          item.id,
          member,
          team.id,
          "asignado",
          "",
          bundle.id,
        );
        assignedItems += 1;
      }
    });
    return {
      assignments: list,
      assigned: assignedItems,
      message: `Autoasignados ${pool.length} ${
        pool.length === 1 ? "lote" : "lotes"
      } de ${team.name} entre ${members.length} personas.`,
    };
  }
  const pool = unassignedInScope(team, portions, articles, assignments);
  if (!pool.length) {
    return {
      assignments,
      assigned: 0,
      message: `No queda trabajo sin asignar en el alcance de ${team.name}.`,
    };
  }
  let list = [...assignments];
  pool.forEach((item, index) => {
    const member = members[index % members.length];
    list = upsertAssignment(list, item.type, item.id, member, team.id, "asignado", "");
  });
  return {
    assignments: list,
    assigned: pool.length,
    message: `Autoasignados ${pool.length} ítems de ${team.name} entre ${members.length} personas.`,
  };
}

export function pipelineCounts(assignments: Assignment[]): Record<AssignmentState, number> {
  const counts: Record<AssignmentState, number> = {
    "sin asignar": 0,
    asignado: 0,
    "en curso": 0,
    hecho: 0,
  };
  for (const row of assignments) {
    counts[row.state] += 1;
  }
  return counts;
}

export function loadByPerson(
  assignments: Assignment[],
  people: Person[],
): { person: Person; count: number }[] {
  return people
    .map((person) => ({
      person,
      count: assignments.filter(
        (row) => row.personId === person.id && row.state !== "sin asignar",
      ).length,
    }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || a.person.name.localeCompare(b.person.name, "es"));
}

export function loadByTeam(
  assignments: Assignment[],
  teams: Team[],
): { team: Team; count: number }[] {
  return teams
    .map((team) => ({
      team,
      count: assignments.filter(
        (row) => row.teamId === team.id && row.state !== "sin asignar",
      ).length,
    }))
    .filter((row) => row.count > 0);
}

export function overlappingTeams(team: Team, all: Team[]): Team[] {
  const resources = new Set(teamRules(team).map((rule) => rule.resource));
  if (!resources.size) return [];
  return all.filter(
    (other) =>
      other.id !== team.id && teamRules(other).some((rule) => resources.has(rule.resource)),
  );
}
