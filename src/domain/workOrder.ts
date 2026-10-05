import type {
  AssignmentsDoc,
  InventoryDoc,
  ItemType,
  Person,
  ScopeKey,
  Team,
} from "./types";
import { bundleGrainForDistributeUnit, SCOPE_LABEL, type ResourceNames } from "./types";
import {
  bundleEnabled,
  bundlesInScope,
  chapterRoundsPartition,
  contiguousPartition,
  itemKey,
  parseTaskItemId,
  resolveDistributePolicy,
  resolveDistributeUnit,
  type ScopeBundle,
  type ScriptureScopeContext,
  type WorkItem,
} from "./assignment";
import { portionKey, verseRangeLabel } from "./chapters";
import { isScopedReview, reviewWorkOrders } from "./reviewTask";
import { extraWorkOrders } from "./extraWork";

export const WORK_ORDER_SCHEMA = "gateway-work-order-1";

export type WorkOrder = {
  /** Stable idempotency key — used in the HTML marker and to match existing issues. */
  key: string;
  teamId: string;
  teamName: string;
  book: string;
  /** Primary resource, or `bundle` when packaging is on. */
  resource: ScopeKey | "bundle";
  chapter: number;
  portionIds: string[];
  itemIds: string[];
  itemTypes: ItemType[];
  assignee?: { personId: string; person: string };
  /** Human-readable title fragment, e.g. `1:1–8 · TPL`. */
  label: string;
};

function resourceLabel(resource: ScopeKey | "bundle"): string {
  if (resource === "bundle") return "Lote";
  return SCOPE_LABEL[resource] ?? resource.toUpperCase();
}

function portionSortKey(
  portionId: string,
  portions: InventoryDoc["portions"],
): { chapter: number; verse: number } {
  const portion = portions.find((p) => portionKey(p) === portionId || p.ref === portionId);
  return {
    chapter: portion?.chapter ?? 0,
    verse: portion?.verses[0] ?? 0,
  };
}

export function rangeLabelForPortions(
  book: string,
  portionIds: string[],
  portions: InventoryDoc["portions"],
): string {
  const refs = portionIds
    .map((id) => portions.find((p) => portionKey(p) === id || p.ref === id))
    .filter(Boolean)
    .map((p) => verseRangeLabel(p!.ref) || p!.ref);
  if (!refs.length) return book;
  if (refs.length === 1) return refs[0];
  const spans = refs.map((ref) => ref.match(/^(\d+):(\d+)(?:–(\d+))?$/));
  if (spans.every(Boolean)) {
    const chapter = spans[0]![1];
    const from = Math.min(...spans.map((m) => Number(m![2])));
    const to = Math.max(...spans.map((m) => Number(m![3] ?? m![2])));
    if (spans.every((m) => m![1] === chapter)) {
      return to > from ? `${chapter}:${from}–${to}` : `${chapter}:${from}`;
    }
  }
  return `${refs[0]}–${refs[refs.length - 1]}`;
}

function workOrderKey(parts: {
  book: string;
  teamId: string;
  resource: string;
  portionIds: string[];
  itemIds: string[];
}): string {
  return [
    parts.book.toUpperCase(),
    parts.teamId,
    parts.resource,
    parts.portionIds.join("+") || "_",
    parts.itemIds.slice().sort().join(","),
  ].join("|");
}

function itemsFromBundle(bundle: ScopeBundle): {
  itemIds: string[];
  itemTypes: ItemType[];
  portionIds: string[];
  resources: ScopeKey[];
} {
  const itemIds: string[] = [];
  const itemTypes: ItemType[] = [];
  const resources = new Set<ScopeKey>();
  for (const item of bundle.items) {
    itemIds.push(itemKey(item.type, item.id));
    itemTypes.push(item.type);
    if (item.resource) resources.add(item.resource);
  }
  return {
    itemIds,
    itemTypes,
    portionIds: bundle.portionIds,
    resources: [...resources],
  };
}

function bookForPortionIds(
  portionIds: string[],
  portions: InventoryDoc["portions"],
  fallback: string,
): string {
  for (const id of portionIds) {
    const portion = portions.find((p) => portionKey(p) === id || p.ref === id || p.id === id);
    if (portion?.book) return portion.book.toUpperCase();
  }
  // Prefixed ids from mergeInventories: BOOK:localId
  for (const id of portionIds) {
    const colon = id.indexOf(":");
    if (colon > 0) {
      const maybe = id.slice(0, colon).toUpperCase();
      if (/^[0-9A-Z]{3}$/.test(maybe) || maybe.length === 3) return maybe;
    }
  }
  return fallback.toUpperCase();
}

/**
 * Build publishable work orders from the current board assignments.
 * Contiguous assignments for the same person + team + resource collapse into one lot.
 */
export function workOrdersFromAssignments(
  board: AssignmentsDoc,
  inventory: InventoryDoc,
): WorkOrder[] {
  const orders: WorkOrder[] = [];
  const peopleById = new Map(board.people.map((p) => [p.id, p]));
  const teamsById = new Map(board.teams.map((t) => [t.id, t]));
  const fallbackBook = (board.books?.[0] || board.book).toUpperCase();
  const scopeCtx = {
    projectBooks: board.books?.length ? board.books : [board.book],
    fallbackBook,
  };

  type LotBucket = {
    team: Team;
    person: Person;
    resource: ScopeKey | "bundle";
    chapter: number;
    portionIds: string[];
    itemIds: string[];
    itemTypes: ItemType[];
    sort: number;
      /** The title of the article, for a subtarea that is one article. */
    named?: string;
  };

  const buckets = new Map<string, LotBucket>();

  for (const row of board.assignments) {
    if (!row.personId || row.state === "sin asignar") continue;
    const team = teamsById.get(row.teamId);
    const person = peopleById.get(row.personId);
    if (!team || !person) continue;
    if (isScopedReview(team)) continue;

    let resource: ScopeKey | "bundle" = "bundle";
    let portionId = "";
    let articleId = "";
    let named = "";
    if (row.bundleId) {
      resource = taskResource(team);
      const bundle = bundlesInScope(
        team,
        inventory.portions,
        inventory.articles,
        scopeCtx,
      ).find((b) => b.id === row.bundleId);
      portionId = bundle?.portionIds[0] ?? "";
    } else {
      const parsed = parseTaskItemId(row.itemId);
      if (parsed) {
        resource = parsed.resource;
        const task = inventory.portions
          .flatMap((p) => [
            ...p.tplItems,
            ...p.tpsItems,
            ...p.notasItems,
            ...p.preguntasItems,
          ])
          .find((t) => t.id === parsed.id);
        portionId = task?.portionId ?? "";
      } else if (row.itemType === "porcion") {
        resource = taskResource(team);
        portionId = row.itemId;
      } else if (row.itemType === "articulo") {
        const article = inventory.articles.find(
          (a) => a.id === row.itemId || row.itemId.endsWith(a.id),
        );
        // The task says which articles it works on; an older board whose task names several is read by the kind.
        const own = taskResource(team);
        resource = own === "academia" || own === "palabras" ? own : /academy/i.test(article?.kind ?? "") ? "academia" : "palabras";
        // An article is a subtarea of its own, with the first passage that links to it (see `planUnassignedLots`).
        articleId = article?.id ?? row.itemId;
        named = article?.title?.trim() || articleId;
        portionId = firstPortionCiting(articleId, resource, inventory.portions) ?? "";
      }
    }

    const sort = portionSortKey(portionId, inventory.portions);
    // Group by person + team + resource + chapter so contiguous ranges stay together per chapter.
    const groupKey = `${team.id}|${person.id}|${resource}|${sort.chapter}|${row.bundleId ?? ""}|${articleId}`;
    const existing = buckets.get(groupKey);
    const itemId = itemKey(row.itemType, row.itemId);
    if (existing) {
      if (!existing.itemIds.includes(itemId)) {
        existing.itemIds.push(itemId);
        existing.itemTypes.push(row.itemType);
      }
      if (portionId && !existing.portionIds.includes(portionId)) {
        existing.portionIds.push(portionId);
      }
    } else {
      buckets.set(groupKey, {
        team,
        person,
        resource,
        chapter: sort.chapter || 1,
        portionIds: portionId ? [portionId] : [],
        itemIds: [itemId],
        itemTypes: [row.itemType],
        sort: sort.chapter * 10_000 + sort.verse,
        ...(named ? { named } : {}),
      });
    }
  }

  for (const bucket of [...buckets.values()].sort((a, b) => a.sort - b.sort)) {
    bucket.portionIds.sort((a, b) => {
      const sa = portionSortKey(a, inventory.portions);
      const sb = portionSortKey(b, inventory.portions);
      return sa.chapter - sb.chapter || sa.verse - sb.verse || a.localeCompare(b);
    });
    const orderBook = bookForPortionIds(bucket.portionIds, inventory.portions, fallbackBook);
    const range = rangeLabelForPortions(orderBook, bucket.portionIds, inventory.portions);
    const label = `${bucket.named || range} · ${resourceLabel(bucket.resource)}`;
    const key = workOrderKey({
      book: orderBook,
      teamId: bucket.team.id,
      resource: bucket.resource,
      portionIds: bucket.portionIds,
      itemIds: bucket.itemIds,
    });
    orders.push({
      key,
      teamId: bucket.team.id,
      teamName: bucket.team.name,
      book: orderBook,
      resource: bucket.resource,
      chapter: bucket.chapter,
      portionIds: bucket.portionIds,
      itemIds: bucket.itemIds,
      itemTypes: bucket.itemTypes,
      assignee: { personId: bucket.person.id, person: bucket.person.name },
      label,
    });
  }

  return orders;
}

function buildWorkOrder(params: {
  team: Team;
  book: string;
  resource: ScopeKey | "bundle";
  chapter: number;
  portionIds: string[];
  itemIds: string[];
  itemTypes: ItemType[];
  portions: InventoryDoc["portions"];
  assignee?: WorkOrder["assignee"];
  /** What the subtarea is called instead of its passage: the title of the article it is about. */
  named?: string;
}): WorkOrder {
  const orderBook = bookForPortionIds(params.portionIds, params.portions, params.book);
  const range = rangeLabelForPortions(orderBook, params.portionIds, params.portions);
  return {
    key: workOrderKey({
      book: orderBook,
      teamId: params.team.id,
      resource: params.resource,
      portionIds: params.portionIds,
      itemIds: params.itemIds,
    }),
    teamId: params.team.id,
    teamName: params.team.name,
    book: orderBook,
    resource: params.resource,
    chapter: params.chapter,
    portionIds: params.portionIds,
    itemIds: params.itemIds,
    itemTypes: params.itemTypes,
    assignee: params.assignee,
    label: `${params.named?.trim() || range} · ${resourceLabel(params.resource)}`,
  };
}

/** The first passage of the book that links to an article: where whoever translates it can see it at work. */
function firstPortionCiting(articleId: string, resource: ScopeKey | "bundle", portions: InventoryDoc["portions"]): string | undefined {
  if (resource !== "academia" && resource !== "palabras") return undefined;
  const portion = portions.find((row) => (row[resource] ?? []).some((cited) => cited.id === articleId));
  return portion ? portionKey(portion) : undefined;
}

/**
 * The resource a task works on, read from its rules: the one it names, `tpl` when it names none (the oldest
 * boards), and `bundle` when it names several (a review that goes over more than one resource).
 */
export function taskResource(team: Team): ScopeKey | "bundle" {
  const named = [...new Set((team.rules ?? []).map((rule) => rule.resource))];
  if (named.length === 1) return named[0];
  return named.length ? "bundle" : "tpl";
}

/** A passage carries no resource of its own: it is whatever the task works on. */
function workItemResource(item: WorkItem, team: Team): ScopeKey | "bundle" {
  if (item.resource) return item.resource;
  if (item.type === "porcion") return taskResource(team);
  return "bundle";
}

/** The resource of a packaged unit: the one its items share, or else what the task works on. */
function packagedResource(resources: ScopeKey[], team: Team): ScopeKey | "bundle" {
  if (resources.length === 1) return resources[0];
  return resources.length ? "bundle" : taskResource(team);
}

/**
 * Geographic lots for a team with no assignee — the self-claim / open queue.
 * Uses the team's distribute grain; packaging keeps resources together, otherwise
 * one order per resource inside each geographic unit.
 */
export function planUnassignedLots(
  team: Team,
  inventory: InventoryDoc,
  book: string,
  ctx: ScriptureScopeContext = {},
): WorkOrder[] {
  const packaged = bundleEnabled(team);
  const lotTeam: Team = {
    ...team,
    bundle: {
      enabled: true,
      grain:
        team.bundle?.grain ??
        bundleGrainForDistributeUnit(resolveDistributeUnit(team)),
    },
  };

  const orders: WorkOrder[] = [];
  for (const bundle of bundlesInScope(
    lotTeam,
    inventory.portions,
    inventory.articles,
    ctx,
  )) {
    if (packaged) {
      const extracted = itemsFromBundle(bundle);
      if (!extracted.itemIds.length) continue;
      const resource = packagedResource(extracted.resources, team);
      orders.push(
        buildWorkOrder({
          team,
          book,
          resource,
          chapter: bundle.chapter,
          portionIds: extracted.portionIds,
          itemIds: extracted.itemIds,
          itemTypes: extracted.itemTypes,
          portions: inventory.portions,
        }),
      );
      continue;
    }

    const groups = new Map<ScopeKey | "bundle", WorkItem[]>();
    for (const item of bundle.items) {
      const resource = workItemResource(item, team);
      const list = groups.get(resource) ?? [];
      list.push(item);
      groups.set(resource, list);
    }
    for (const [resource, items] of groups) {
      // An article is a piece of work of its own: it is of the language, not of a passage, and several in one
      // subtarea would hand one person all of them and show them on one screen. One subtarea for each.
      if ((resource === "academia" || resource === "palabras") && items.every((item) => item.type === "articulo")) {
        for (const item of items) {
          const article = inventory.articles?.find((row) => row.id === item.id);
          const cited = firstPortionCiting(item.id, resource, inventory.portions);
          const ids = cited ? [cited] : bundle.portionIds.slice(0, 1);
          orders.push(
            buildWorkOrder({
              team,
              book,
              resource,
              chapter: inventory.portions.find((row) => portionKey(row) === ids[0])?.chapter ?? bundle.chapter,
              portionIds: ids,
              itemIds: [itemKey(item.type, item.id)],
              itemTypes: [item.type],
              portions: inventory.portions,
              named: article?.title?.trim() || item.id,
            }),
          );
        }
        continue;
      }
      const itemIds = items.map((item) => itemKey(item.type, item.id));
      const itemTypes = items.map((item) => item.type);
      const portionIds = [
        ...new Set(
          items
            .map((item) => item.portionId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const ids = portionIds.length ? portionIds : bundle.portionIds;
      if (!itemIds.length) continue;
      orders.push(
        buildWorkOrder({
          team,
          book,
          resource,
          chapter: bundle.chapter,
          portionIds: ids,
          itemIds,
          itemTypes,
          portions: inventory.portions,
        }),
      );
    }
  }
  return orders;
}

/**
 * Publish set: assigned lots first, then open lots for remaining scope items.
 * Allows Entregar without Asignar so trabajadores can self-claim.
 *
 * «Covered» is per task: the same portion in two tasks (e.g. Traducir TPL
 * and a later revisión) is two pieces of work, so one task's assignment
 * never removes the item from another task's lot (that would change the
 * lot's key and retire the other task's subtarea as an orphan).
 */
export function publishableWorkOrders(
  board: AssignmentsDoc,
  inventory: InventoryDoc,
): WorkOrder[] {
  const assigned = workOrdersFromAssignments(board, inventory);
  const coveredKey = (teamId: string, itemId: string) => `${teamId}\u0000${itemId}`;
  const covered = new Set(assigned.flatMap((order) => order.itemIds.map((id) => coveredKey(order.teamId, id))));
  const fallbackBook = (board.books?.[0] || board.book).toUpperCase();
  const scopeCtx: ScriptureScopeContext = {
    projectBooks: board.books?.length ? board.books : [board.book],
    fallbackBook,
    handoffUnits: board.settings?.handoffUnits,
  };

  const open: WorkOrder[] = [];
  for (const team of board.teams) {
    if (isScopedReview(team)) {
      open.push(...reviewWorkOrders(board, team, inventory).orders);
      continue;
    }
    for (const lot of planUnassignedLots(team, inventory, fallbackBook, scopeCtx)) {
      const itemIds: string[] = [];
      const itemTypes: ItemType[] = [];
      lot.itemIds.forEach((id, index) => {
        if (covered.has(coveredKey(team.id, id))) return;
        itemIds.push(id);
        itemTypes.push(lot.itemTypes[index] ?? "tarea");
      });
      if (!itemIds.length) continue;
      // A lot nobody took a piece of goes as it was planned, with its own name (an article's title).
      const next =
        itemIds.length === lot.itemIds.length
          ? lot
          : buildWorkOrder({
              team,
              book: lot.book,
              resource: lot.resource,
              chapter: lot.chapter,
              portionIds: lot.portionIds,
              itemIds,
              itemTypes,
              portions: inventory.portions,
            });
      open.push(next);
      for (const id of itemIds) covered.add(coveredKey(team.id, id));
    }
  }

  return [...named([...assigned, ...open], board.settings?.resourceNames), ...extraWorkOrders(board, inventory)];
}

/** Subtareas titled with the name the project's process gives each resource («2:11–13 · Biblia»). */
function named(orders: WorkOrder[], names: ResourceNames | undefined): WorkOrder[] {
  if (!names) return orders;
  return orders.map((order) => {
    const own = order.resource === "bundle" ? undefined : names[order.resource]?.name;
    const cut = order.label.lastIndexOf(" · ");
    return own && cut >= 0 ? { ...order, label: `${order.label.slice(0, cut)} · ${own}` } : order;
  });
}

/**
 * Plan work orders for a team using the same contiguous partition as autoAssign,
 * without mutating the board.
 */
export function planWorkOrders(
  team: Team,
  people: Person[],
  inventory: InventoryDoc,
  book: string,
  ctx: ScriptureScopeContext = {},
): WorkOrder[] {
  const members = team.memberIds
    .map((id) => people.find((p) => p.id === id))
    .filter((row): row is Person => Boolean(row));
  if (!members.length || resolveDistributePolicy(team) === "manual") {
    return planUnassignedLots(team, inventory, book, ctx);
  }

  const unit = resolveDistributeUnit(team);
  function partitionForUnit<T extends { chapter: number }>(ordered: T[]): T[][] {
    if (unit === "chapterRounds") return chapterRoundsPartition(ordered, members.length);
    return contiguousPartition(ordered, members.length);
  }

  if (!bundleEnabled(team)) {
    return planUnassignedLots(team, inventory, book, ctx);
  }

  const pool = bundlesInScope(team, inventory.portions, inventory.articles, ctx);
  const partitions = partitionForUnit(pool);
  const orders: WorkOrder[] = [];
  partitions.forEach((chunk, index) => {
    const member = members[index];
    for (const bundle of chunk) {
      const extracted = itemsFromBundle(bundle);
      if (!extracted.itemIds.length) continue;
      const resource = packagedResource(extracted.resources, team);
      orders.push(
        buildWorkOrder({
          team,
          book,
          resource,
          chapter: bundle.chapter,
          portionIds: extracted.portionIds,
          itemIds: extracted.itemIds,
          itemTypes: extracted.itemTypes,
          portions: inventory.portions,
          assignee: { personId: member.id, person: member.name },
        }),
      );
    }
  });
  return orders;
}

export type WorkOrderMarker = {
  schema: typeof WORK_ORDER_SCHEMA;
  key: string;
  book: string;
  teamId: string;
  resource: string;
  portionIds: string[];
  itemIds: string[];
};

export function encodeWorkOrderMarker(order: WorkOrder): string {
  const marker: WorkOrderMarker = {
    schema: WORK_ORDER_SCHEMA,
    key: order.key,
    book: order.book,
    teamId: order.teamId,
    resource: order.resource,
    portionIds: order.portionIds,
    itemIds: order.itemIds,
  };
  return `<!-- gateway-work-order ${JSON.stringify(marker)} -->`;
}

export function parseWorkOrderMarker(body: string | undefined): WorkOrderMarker | null {
  if (!body) return null;
  const match = body.match(/<!--\s*gateway-work-order\s+(\{[\s\S]*?\})\s*-->/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as Partial<WorkOrderMarker>;
    if (parsed.schema !== WORK_ORDER_SCHEMA || !parsed.key || !parsed.teamId) return null;
    return {
      schema: WORK_ORDER_SCHEMA,
      key: String(parsed.key),
      book: String(parsed.book ?? ""),
      teamId: String(parsed.teamId),
      resource: String(parsed.resource ?? ""),
      portionIds: Array.isArray(parsed.portionIds) ? parsed.portionIds.map(String) : [],
      itemIds: Array.isArray(parsed.itemIds) ? parsed.itemIds.map(String) : [],
    };
  } catch {
    return null;
  }
}

export function workOrderIssueBody(order: WorkOrder): string {
  const lines = [
    `## ${order.label}`,
    "",
    `- Tarea: **${order.teamName}**`,
    `- Proyecto: **${order.book}**`,
    // Work about the book in general (added by hand) belongs to no chapter.
    ...(order.chapter > 0 ? [`- Capítulo: **${order.chapter}**`] : []),
    order.assignee ? `- Asignado a: **${order.assignee.person}** (@${order.assignee.personId})` : "- Sin asignar",
    "",
    "### Trabajos",
    ...order.itemIds.map((id) => `- [ ] \`${id}\``),
    "",
    encodeWorkOrderMarker(order),
  ];
  return lines.join("\n");
}

/** What the app keeps in a subtarea's text besides the plan's own marker: hidden notes, each with its name. */
const KEPT_NOTE_RE = /<!--\s*(?:gateway|tas)[-:][\w:-]+\s[\s\S]*?-->/g;
const PLAN_NOTE_RE = /^<!--\s*gateway-work-order\b/;

/**
 * The text of a subtarea that already exists, written again from the plan. The plan says what the subtarea is; the
 * subtarea's own text also says how far its steps are and which review is its own, and the plan knows neither.
 * Writing only what the plan says sent work in hand back to its first step and cut it from its review.
 */
export function refreshedIssueBody(order: WorkOrder, previous: string | undefined): string {
  const fresh = workOrderIssueBody(order);
  const kept = (previous ?? "").match(KEPT_NOTE_RE)?.filter((note) => !PLAN_NOTE_RE.test(note)) ?? [];
  return kept.length ? `${fresh.trimEnd()}\n\n${kept.join("\n\n")}\n` : fresh;
}

export function workOrderIssueTitle(order: WorkOrder): string {
  return `${order.book} ${order.label}`;
}

/**
 * What a work order is, however its key was written: the task and the items it covers. The key of the same work
 * differs between a subtarea planned without a person and the same one once somebody has it (passages are named
 * by their id in one and by their reference in the other), so the key alone would plan finished work again.
 */
export function workIdentity(teamId: string, itemIds: string[]): string | null {
  return itemIds.length ? `${teamId}\u0000${[...itemIds].sort().join("\u0001")}` : null;
}

/** The subtareas that already exist, found by key or, failing that, by what they cover. */
export function indexWorkIssues<T extends { body?: string }>(issues: T[]): {
  find: (order: Pick<WorkOrder, "key" | "teamId" | "itemIds">) => T | undefined;
  add: (order: Pick<WorkOrder, "key" | "teamId" | "itemIds">, issue: T) => void;
} {
  const byKey = new Map<string, T>();
  const byIdentity = new Map<string, T>();
  for (const issue of issues) {
    const marker = parseWorkOrderMarker(issue.body);
    if (!marker) continue;
    byKey.set(marker.key, issue);
    const identity = workIdentity(marker.teamId, marker.itemIds);
    // The first one stands: the original subtarea, not a later copy of it.
    if (identity && !byIdentity.has(identity)) byIdentity.set(identity, issue);
  }
  return {
    find: (order) => byKey.get(order.key) ?? byIdentity.get(workIdentity(order.teamId, order.itemIds) ?? ""),
    add: (order, issue) => {
      byKey.set(order.key, issue);
      const identity = workIdentity(order.teamId, order.itemIds);
      if (identity && !byIdentity.has(identity)) byIdentity.set(identity, issue);
    },
  };
}

/** Is a subtarea still part of the plan? By key, or by what it covers. */
export function planKeeps(orders: Pick<WorkOrder, "key" | "teamId" | "itemIds">[]): (marker: Pick<WorkOrderMarker, "key" | "teamId" | "itemIds">) => boolean {
  const keys = new Set(orders.map((order) => order.key));
  const identities = new Set(orders.map((order) => workIdentity(order.teamId, order.itemIds)).filter((id): id is string => Boolean(id)));
  return (marker) => keys.has(marker.key) || identities.has(workIdentity(marker.teamId, marker.itemIds) ?? "");
}
