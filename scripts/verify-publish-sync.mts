/**
 * Mock DCS: Entregar «Publicar» must keep finished (closed) subtareas closed,
 * create missing ones as open, and close orphans. No network.
 * Run: npx tsx scripts/verify-publish-sync.mts
 */
import { publishWorkOrders, previewPublishWorkOrders } from "../src/dcs/issues.ts";
import {
  publishableWorkOrders,
  workOrderIssueBody,
  workOrderIssueTitle,
  type WorkOrder,
} from "../src/domain/workOrder.ts";
import type { AssignmentsDoc, InventoryDoc } from "../src/domain/types.ts";
import type { GtSession } from "../src/dcs/auth.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

type FakeIssue = {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  assignees: string[];
};

type Call = { method: string; path: string; body?: Record<string, unknown> };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ORG = "es-419_gl";
const PM = "gateway-tasks";

function toApi(issue: FakeIssue) {
  return {
    id: issue.number,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    labels: [],
    assignees: issue.assignees.map((login) => ({ login })),
    assignee: issue.assignees[0] ? { login: issue.assignees[0] } : null,
    html_url: `https://qa.door43.org/${ORG}/${PM}/issues/${issue.number}`,
    repository: { name: PM, full_name: `${ORG}/${PM}` },
  };
}

function installFakeDcs(seed: FakeIssue[]) {
  const issues = new Map(seed.map((i) => [i.number, { ...i }]));
  let nextNumber = Math.max(0, ...seed.map((i) => i.number)) + 1;
  let nextId = 1;
  const calls: Call[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : String(input);
    const url = new URL(raw);
    const method = (init?.method || "GET").toUpperCase();
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ method, path, body });

    if (path === "/repos/issues/search" && method === "GET") {
      const state = url.searchParams.get("state") || "open";
      const page = Number(url.searchParams.get("page") || "1");
      if (page > 1) return json([]);
      const rows = [...issues.values()].filter((i) => state === "all" || i.state === state);
      return json(rows.map(toApi));
    }

    const base = `/repos/${ORG}/${PM}`;
    if (path === base && method === "GET") {
      return json({ id: 1, name: PM, full_name: `${ORG}/${PM}`, owner: { id: 1, login: ORG } });
    }
    if (path.startsWith(`${base}/contents/`) || path.startsWith(`${base}/raw/`)) {
      return json({ message: "not found" }, 404);
    }
    if (path === `${base}/labels`) {
      if (method === "GET") return json([]);
      return json({ id: nextId++, name: String(body?.name ?? ""), color: "ededed" }, 201);
    }
    if (path === `${base}/milestones`) {
      if (method === "GET") return json([]);
      return json({ id: nextId++, title: String(body?.title ?? ""), state: "open" }, 201);
    }
    if (path === `${base}/issues` && method === "POST") {
      const issue: FakeIssue = {
        number: nextNumber++,
        title: String(body?.title ?? ""),
        body: String(body?.body ?? ""),
        state: body?.closed ? "closed" : "open",
        assignees: Array.isArray(body?.assignees) ? (body!.assignees as string[]) : [],
      };
      issues.set(issue.number, issue);
      return json(toApi(issue), 201);
    }
    const labelsMatch = path.match(new RegExp(`^${base}/issues/(\\d+)/labels$`));
    if (labelsMatch && method === "POST") return json([]);
    const issueMatch = path.match(new RegExp(`^${base}/issues/(\\d+)$`));
    if (issueMatch && method === "PATCH") {
      const issue = issues.get(Number(issueMatch[1]));
      if (!issue) return json({ message: "not found" }, 404);
      if (typeof body?.title === "string") issue.title = body.title;
      if (typeof body?.body === "string") issue.body = body.body;
      if (body?.state === "open" || body?.state === "closed") issue.state = body.state;
      if (Array.isArray(body?.assignees)) issue.assignees = body.assignees as string[];
      return json(toApi(issue));
    }
    return json({ message: `unhandled ${method} ${path}` }, 404);
  }) as typeof fetch;

  return { issues, calls };
}

function order(key: string, label: string, assignee?: string): WorkOrder {
  return {
    key,
    teamId: "tpl-draft",
    teamName: "Borrador TPL",
    book: "NEH",
    resource: "tpl",
    chapter: 1,
    portionIds: [label],
    itemIds: [`porcion:${label}`],
    itemTypes: ["porcion"],
    assignee: assignee ? { personId: assignee, person: assignee } : undefined,
    label: `${label} · TPL`,
  };
}

const session: GtSession = {
  host: "https://qa.door43.org",
  username: "gestor",
  token: "tok",
  scopesVersion: 3,
};

const board = { book: "NEH", projectId: "NEH", people: [], teams: [], assignments: [] } as unknown as AssignmentsDoc;
const inventory = { portions: [], articles: [] } as unknown as InventoryDoc;

const finished = order("NEH|tpl-draft|tpl|1:1-3|porcion:1:1-3", "1:1-3", "ana");
const stillOpen = order("NEH|tpl-draft|tpl|1:4-6|porcion:1:4-6", "1:4-6", "beto");
const orphan = order("NEH|tpl-draft|tpl|9:9|porcion:9:9", "9:9", "carla");
const brandNew = order("NEH|tpl-draft|tpl|1:7-9|porcion:1:7-9", "1:7-9");

const fake = installFakeDcs([
  {
    number: 146,
    title: "título viejo",
    body: workOrderIssueBody({ ...finished, label: "texto viejo" }),
    state: "closed",
    assignees: ["ana"],
  },
  {
    number: 147,
    title: workOrderIssueTitle(stillOpen),
    body: workOrderIssueBody(stillOpen),
    state: "open",
    assignees: ["beto"],
  },
  {
    number: 148,
    title: workOrderIssueTitle(orphan),
    body: workOrderIssueBody(orphan),
    state: "open",
    assignees: ["carla"],
  },
]);

const orders = [finished, stillOpen, brandNew];

const preview = await previewPublishWorkOrders({ session, org: ORG, board, inventory, orders });
assert(preview.created === 1, `vista previa: 1 nueva, got ${preview.created}`);
assert(preview.updated === 2, `vista previa: 2 existentes, got ${preview.updated}`);
assert(preview.closed === 1, `vista previa: 1 huérfana, got ${preview.closed}`);

const result = await publishWorkOrders({ session, org: ORG, board, inventory, orders });

const closedOne = fake.issues.get(146)!;
assert(closedOne.state === "closed", "#146 terminada sigue cerrada después de Publicar");
assert(closedOne.title === workOrderIssueTitle(finished), "#146 recibe el título nuevo del plan");
assert(closedOne.body === workOrderIssueBody(finished), "#146 recibe el cuerpo nuevo del plan");
const patch146 = fake.calls.find((c) => c.method === "PATCH" && c.path.endsWith("/issues/146"));
assert(patch146 && patch146.body?.state === undefined, "la actualización de #146 no envía estado");

assert(fake.issues.get(147)!.state === "open", "#147 abierta sigue abierta");
assert(fake.issues.get(148)!.state === "closed", "#148 huérfana se cierra");

const created = [...fake.issues.values()].filter((i) => i.number > 148);
assert(created.length === 1, `se crea exactamente una subtarea nueva, got ${created.length}`);
assert(created[0].state === "open", "la subtarea nueva queda abierta");
assert(created[0].body === workOrderIssueBody(brandNew), "la subtarea nueva lleva la clave del plan");

assert(result.created === 1, `created=1, got ${result.created}`);
assert(result.updated === 2, `updated=2, got ${result.updated}`);
assert(result.closed === 1, `closed=1, got ${result.closed}`);

const reopenAttempts = fake.calls.filter((c) => c.method === "PATCH" && c.body?.state === "open");
assert(reopenAttempts.length === 0, "Publicar nunca envía state=open a una subtarea existente");

{
  // Publicar de nuevo: idempotente, #146 sigue cerrada y no se crea nada más.
  const again = await publishWorkOrders({ session, org: ORG, board, inventory, orders });
  assert(again.created === 0, `segunda vez: 0 nuevas, got ${again.created}`);
  assert(again.closed === 0, `segunda vez: 0 huérfanas, got ${again.closed}`);
  assert(fake.issues.get(146)!.state === "closed", "#146 sigue cerrada tras publicar dos veces");
}

console.log("ok  publicar mantiene cerradas las terminadas y cierra huérfanas");

{
  // Una revisión posterior sobre la misma porción que Traducir TPL: las dos subtareas conviven.
  const portion = (id: string, chapter: number, verses: number[]) => ({
    id,
    ref: `${chapter}:${verses[0]}-${verses[verses.length - 1]}`,
    chapter,
    verses,
    book: "NEH",
    tpl: 1,
    tps: 0,
    notas: 0,
    preguntas: 0,
    tplItems: [],
    tpsItems: [],
    notasItems: [],
    preguntasItems: [],
    academia: [],
    palabras: [],
  });
  const inv = {
    book: "NEH",
    portions: [portion("NEH-2-1", 2, [1, 2, 3, 4, 5]), portion("NEH-2-6", 2, [6, 7, 8, 9, 10])],
    articles: [],
  } as unknown as InventoryDoc;
  const task = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    id,
    name,
    description: "",
    phaseId: "fase",
    memberIds: [],
    scope: ["tpl"],
    rules: [{ resource: "tpl", articleFilter: "all" }],
    distributeUnit: "portion",
    distributePolicy: "manual",
    ...extra,
  });
  const tplTask = task("tpl-draft", "Traducir TPL");
  const reviewTask = task("revision", "Revisión NEH 2:6-10", {
    reviewsPrincipal: true,
    scriptureScope: { mode: "portions", book: "NEH", portionIds: ["NEH-2-6"] },
  });
  const baseBoard = {
    schema: "gateway-assignments-1",
    projectId: "NEH",
    book: "NEH",
    books: ["NEH"],
    title: "Nehemías",
    kind: "book",
    lang: "es-419",
    contentOrg: ORG,
    pmOrg: ORG,
    people: [{ id: "dora", name: "Dora" }],
    phases: [{ id: "fase", name: "Fase", slug: "fase", order: 1 }],
    teams: [tplTask],
    assignments: [],
  } as unknown as AssignmentsDoc;
  const withReview = {
    ...baseBoard,
    teams: [tplTask, reviewTask],
    assignments: [
      {
        id: "a1",
        person: "Dora",
        personId: "dora",
        teamId: "revision",
        itemType: "porcion",
        itemId: "2:6-10",
        note: "",
        state: "asignado",
      },
    ],
  } as unknown as AssignmentsDoc;

  const tplOrders = publishableWorkOrders(baseBoard, inv);
  const tplOpen = tplOrders.find((o) => o.portionIds.includes("NEH-2-6"));
  const tplDone = tplOrders.find((o) => o.portionIds.includes("NEH-2-1"));
  assert(tplOpen && tplDone && tplOpen !== tplDone, `TPL: una subtarea por porción, got ${tplOrders.map((o) => o.key).join(" / ")}`);

  const planned = publishableWorkOrders(withReview, inv);
  assert(
    planned.some((o) => o.key === tplOpen.key),
    `la asignación de la revisión no cambia la subtarea TPL de 2:6-10: ${planned.map((o) => o.key).join(" / ")}`,
  );
  const reviewOrder = planned.find((o) => o.teamId === "revision");
  assert(reviewOrder && reviewOrder.itemIds.includes("porcion:2:6-10"), "la revisión tiene su propia subtarea");

  const gone = order("NEH|tarea-borrada|tpl|2:1-5|porcion:NEH-2-1", "2:1-5");
  gone.teamId = "tarea-borrada";
  const fake2 = installFakeDcs([
    { number: 1, title: workOrderIssueTitle(tplOpen), body: workOrderIssueBody(tplOpen), state: "open", assignees: [] },
    { number: 2, title: workOrderIssueTitle(tplDone), body: workOrderIssueBody(tplDone), state: "closed", assignees: [] },
    { number: 3, title: workOrderIssueTitle(gone), body: workOrderIssueBody(gone), state: "open", assignees: [] },
  ]);

  const res = await publishWorkOrders({ session, org: ORG, board: withReview, inventory: inv });
  assert(fake2.issues.get(1)!.state === "open", "#1 Traducir TPL sobre 2:6-10 sigue abierta");
  assert(fake2.issues.get(2)!.state === "closed", "#2 terminada sigue cerrada");
  assert(fake2.issues.get(3)!.state === "closed", "#3 de una tarea que ya no existe se cierra como huérfana");
  const created2 = [...fake2.issues.values()].filter((i) => i.number > 3);
  assert(
    created2.length === 1,
    `solo se crea la subtarea de la revisión, got ${created2.map((i) => i.body.match(/"key":"([^"]+)"/)?.[1]).join(" / ")}`,
  );
  assert(created2[0].state === "open" && created2[0].body === workOrderIssueBody(reviewOrder), "la revisión tiene su subtarea abierta");
  assert(created2[0].assignees.includes("dora"), "la subtarea de la revisión está asignada a Dora");
  assert(res.closed === 1, `closed=1, got ${res.closed}`);
  const closes = fake2.calls.filter((c) => c.method === "PATCH" && c.body?.state === "closed").map((c) => c.path);
  assert(closes.length === 1 && closes[0].endsWith("/issues/3"), `solo se cierra #3, got ${closes.join(", ")}`);
  console.log("ok  revisión sobre la misma porción: la subtarea TPL sigue abierta, la huérfana se cierra");
}

console.log("verify-publish-sync: ok");
