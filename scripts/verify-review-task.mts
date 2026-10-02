/**
 * Mock DCS: «Crear la revisión» creates ONLY the review task's subtarea, for
 * the typed verse range, assigned to someone who may edit TPL in DCS (org
 * team access, mocked), and only after the project plan (with the review
 * task) is saved.
 * No network.
 * Run: npx tsx scripts/verify-review-task.mts
 */
import { createReviewIssues, reviewIssuesToast } from "../src/dcs/issues.ts";
import {
  REVIEW_CANDIDATES_FALLBACK_NOTE,
  parseReviewRef,
  resolveReviewCandidates,
  reviewAssigneeCandidates,
  reviewWorkOrders,
  type OrgTeamAccess,
} from "../src/domain/reviewTask.ts";
import { loadReviewCandidates } from "../src/domain/teamEligibility.ts";
import { principalPassGate } from "../src/domain/principalPass.ts";
import {
  publishableWorkOrders,
  workOrderIssueBody,
  workOrderIssueTitle,
  type WorkOrder,
} from "../src/domain/workOrder.ts";
import { issueTaskId } from "../src/domain/myTasks.ts";
import { normalizeAssignmentsDoc } from "../src/domain/store.ts";
import type { AssignmentsDoc, InventoryDoc, ProjectTask } from "../src/domain/types.ts";
import type { GtSession } from "../src/dcs/auth.ts";
import type { DcsIssue } from "@ip-lms/dcs-client";

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

const ORG = "es-419_gl";
const PM = "taller";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function toApi(issue: FakeIssue) {
  return {
    id: issue.number,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    labels: [],
    // Every subtarea of a project carries its milestone: that is how they are told from another project's.
    milestone: { id: 1, title: "NEH" },
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
  /** Files written to the PM repo (the saved plan), by path. */
  const files = new Map<string, { text: string; sha: string }>();
  const state = { failPlanWrites: false };

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
      const limit = Number(url.searchParams.get("limit") || "50");
      const rows = [...issues.values()].filter((i) => state === "all" || i.state === state);
      return json(rows.slice((page - 1) * limit, page * limit).map(toApi));
    }
    const base = `/repos/${ORG}/${PM}`;
    if (path === base && method === "GET") {
      return json({ id: 1, name: PM, full_name: `${ORG}/${PM}`, owner: { id: 1, login: ORG } });
    }
    if (path.startsWith(`${base}/contents/`)) {
      const filepath = decodeURIComponent(path.slice(`${base}/contents/`.length));
      if (method === "GET") {
        const file = files.get(filepath);
        if (!file) return json({ message: "not found" }, 404);
        return json({
          name: filepath.split("/").pop(),
          path: filepath,
          type: "file",
          sha: file.sha,
          content: Buffer.from(file.text, "utf-8").toString("base64"),
        });
      }
      if (method === "POST" || method === "PUT") {
        if (state.failPlanWrites) return json({ message: "permission denied" }, 403);
        const text = Buffer.from(String(body?.content ?? ""), "base64").toString("utf-8");
        const sha = `sha-${nextId++}`;
        files.set(filepath, { text, sha });
        return json({ content: { name: filepath, path: filepath, sha, type: "file" }, commit: { sha } }, 201);
      }
    }
    if (path.startsWith(`${base}/raw/`)) {
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
        state: "open",
        assignees: Array.isArray(body?.assignees) ? (body!.assignees as string[]) : [],
      };
      issues.set(issue.number, issue);
      return json(toApi(issue), 201);
    }
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

  return { issues, calls, files, state };
}

const session: GtSession = {
  host: "https://qa.door43.org",
  username: "gestor",
  token: "tok",
  scopesVersion: 3,
};

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
const inventory = {
  book: "NEH",
  portions: [portion("NEH-1-1", 1, [1, 2, 3]), portion("NEH-1-4", 1, [4, 5, 6])],
  articles: [],
} as unknown as InventoryDoc;

const task = (id: string, name: string, phaseId: string, resource: string, extra: Partial<ProjectTask> = {}) =>
  ({
    id,
    name,
    description: "",
    phaseId,
    memberIds: [],
    scope: [resource],
    rules: [{ resource, articleFilter: "all" }],
    distributeUnit: "portion",
    distributePolicy: "manual",
    ...extra,
  }) as ProjectTask;

const tplDraft = task("tpl-draft", "Traducir TPL", "fase-1", "tpl", { memberIds: ["ana"] });
const notas = task("notas", "Traducir notas", "fase-2", "notas", { memberIds: ["nico"] });
const review = task("revision", "Revisión NEH 1:2", "fase-2", "tpl", {
  reviewsPrincipal: true,
  reviewRef: "NEH 1:2",
  reviewAssigneeId: "ana",
});

const board = {
  schema: "gateway-assignments-2",
  projectId: "NEH",
  book: "NEH",
  books: ["NEH"],
  title: "Nehemías",
  kind: "book",
  lang: "es-419",
  contentOrg: ORG,
  pmOrg: ORG,
  people: [
    { id: "ana", name: "Ana" },
    { id: "nico", name: "Nico" },
  ],
  phases: [
    { id: "fase-1", name: "Fase 1", slug: "fase-1", order: 1 },
    { id: "fase-2", name: "Fase 2", slug: "fase-2", order: 2 },
  ],
  teams: [tplDraft, notas, review],
  assignments: [],
} as unknown as AssignmentsDoc;

{
  // 1. «NEH 1:2» es un solo versículo, no la porción 1:1-3.
  const scope = parseReviewRef("NEH 1:2", ["NEH"]);
  assert(scope.ok, "NEH 1:2 se lee");
  assert(
    scope.range.chapter === 1 && scope.range.from === 2 && scope.range.to === 2,
    `NEH 1:2 → 1:2-2, got ${JSON.stringify(scope.range)}`,
  );
  const range = parseReviewRef("NEH 1:1-3", ["NEH"]);
  assert(range.ok && range.range.from === 1 && range.range.to === 3, "NEH 1:1-3 es un rango");
  assert(parseReviewRef("NEH 1:2 · TPL", ["NEH"]).ok, "acepta el formato de título «NEH 1:2 · TPL»");
  assert(!parseReviewRef("GEN 1:2", ["NEH"]).ok, "rechaza un libro fuera del proyecto");
  assert(!parseReviewRef("NEH 1:9-2:4", ["NEH"]).ok, "rechaza rangos entre capítulos");

  const { orders, reason } = reviewWorkOrders(board, review, inventory);
  assert(!reason && orders.length === 1, `una subtarea TPL, got ${orders.length} (${reason})`);
  const title = workOrderIssueTitle(orders[0]);
  assert(title === "NEH 1:2 · TPL", `título de un versículo, got «${title}»`);
  assert(orders[0].portionIds.join() === "NEH-1-1", "la porción que contiene 1:2 va como contexto");
  assert(orders[0].assignee?.personId === "ana", "asignada a Ana");

  // El rango de «Pasar al borrador principal» sale del título: solo 1:2.
  const gate = principalPassGate({
    issues: [
      {
        ...toApi({ number: 1, title, body: workOrderIssueBody(orders[0]), state: "closed", assignees: [] }),
      } as never,
    ],
    taskId: "revision",
    book: "NEH",
  });
  const passRange = gate.targets[0]?.ranges[0];
  assert(
    !gate.blockReason && passRange?.from === 2 && passRange.to === 2,
    `rango del pase = 1:2, got ${JSON.stringify(gate.targets)} ${gate.blockReason}`,
  );
  console.log("ok  «NEH 1:2» produce una subtarea de un versículo (no 1:1-3)");
}

{
  // 3. Candidatos: TPL de otra fase sí; quien solo edita notas no.
  const candidates = reviewAssigneeCandidates(board, review);
  const ids = candidates.map((c) => c.person.id);
  assert(ids.includes("ana"), `Ana (TPL, Fase 1) aparece, got ${ids.join(",")}`);
  assert(!ids.includes("nico"), "Nico (solo notas) no aparece");
  const ana = candidates.find((c) => c.person.id === "ana")!;
  assert(ana.via.some((v) => v.taskId === "tpl-draft" && v.phaseName === "Fase 1"), "Ana puede por Traducir TPL (Fase 1)");
  console.log("ok  la lista incluye a una editora de TPL de otra fase y excluye a quien no edita TPL");
}

{
  // 5. «Quién revisa» = quien puede editar el recurso en DCS (permisos simulados, sin red).
  const orgTeams: OrgTeamAccess[] = [
    {
      teamName: "pm-tpl",
      repoNames: ["taller", "es-419_glt"],
      members: [
        { id: "ana", name: "ana" },
        { id: "rosa", name: "Rosa" },
      ],
    },
    {
      teamName: "pm-notas",
      repoNames: ["taller", "es-419_tn"],
      members: [
        { id: "nico", name: "Nico" },
        { id: "luis", name: "Luis" },
      ],
    },
    {
      teamName: "pm-tps",
      repoNames: ["taller", "es-419_gst"],
      members: [{ id: "teo", name: "Teo" }],
    },
  ];
  const withPedro = {
    ...board,
    people: [...board.people, { id: "pedro", name: "Pedro" }],
  } as AssignmentsDoc;
  let reads = 0;
  const readAccess = async () => {
    reads++;
    return orgTeams;
  };

  const tpl = await loadReviewCandidates({ session, org: ORG, board: withPedro, task: review, readAccess });
  const tplIds = tpl.candidates.map((c) => c.person.id);
  assert(reads === 1, "lee los permisos una vez");
  assert(tpl.source === "permisos", `fuente = permisos, got ${tpl.source}`);
  assert(tplIds.includes("rosa"), `Rosa (acceso a TPL, sin tarea) aparece, got ${tplIds.join(",")}`);
  assert(tplIds.includes("ana"), "Ana (acceso a TPL) aparece");
  assert(!tplIds.includes("pedro"), "Pedro (sin acceso) no aparece");
  assert(!tplIds.includes("nico") && !tplIds.includes("luis"), "quien solo edita Notas no aparece en TPL");
  assert(!tplIds.includes("teo"), "quien solo edita TPS no aparece en TPL");
  const ana = tpl.candidates.find((c) => c.person.id === "ana")!;
  assert(ana.person.name === "Ana", "usa el nombre guardado en el proyecto");
  assert(ana.teams?.join() === "pm-tpl", "Ana puede por el equipo pm-tpl");
  console.log("ok  TPL: incluye a quien tiene acceso aunque no sea integrante; excluye sin acceso y solo Notas");

  const reviewTps = { ...review, id: "rev-tps", scope: ["tps"], rules: [{ resource: "tps", articleFilter: "all" }] } as ProjectTask;
  const tps = await loadReviewCandidates({ session, org: ORG, board: withPedro, task: reviewTps, readAccess });
  assert(
    tps.candidates.map((c) => c.person.id).join() === "teo",
    `TPS: solo quien edita TPS, got ${tps.candidates.map((c) => c.person.id).join(",")}`,
  );
  console.log("ok  la lista corresponde al recurso de la revisión (TPS ≠ TPL)");

  // La subtarea queda asignada solo a la persona elegida.
  const rosaReview = { ...review, reviewAssigneeId: "rosa" } as ProjectTask;
  const rosaOrders = reviewWorkOrders(board, rosaReview, inventory).orders;
  assert(
    rosaOrders.length === 1 && rosaOrders[0].assignee?.personId === "rosa",
    "la subtarea se asigna solo a Rosa",
  );

  // Si Door43 no responde: integrantes guardados y aviso en español.
  const fallback = await loadReviewCandidates({
    session,
    org: ORG,
    board: withPedro,
    task: review,
    readAccess: async () => {
      throw new TypeError("Failed to fetch");
    },
  });
  assert(fallback.source === "integrantes", `fuente = integrantes, got ${fallback.source}`);
  assert(
    fallback.candidates.map((c) => c.person.id).join() === "ana",
    `respaldo = integrantes de tareas TPL, got ${fallback.candidates.map((c) => c.person.id).join(",")}`,
  );
  assert(
    /no se pudieron leer los permisos/i.test(REVIEW_CANDIDATES_FALLBACK_NOTE) &&
      /ya están en las tareas/i.test(REVIEW_CANDIDATES_FALLBACK_NOTE),
    "el aviso explica que muestra integrantes porque no se leyeron los permisos",
  );
  assert(
    !/\b(git|commit|push|branch|rama|repo|sha|api|403)\b/i.test(REVIEW_CANDIDATES_FALLBACK_NOTE),
    `aviso sin jerga: «${REVIEW_CANDIDATES_FALLBACK_NOTE}»`,
  );
  console.log("ok  sin Door43, muestra los integrantes guardados con un aviso en español");

  // Mientras se leen los permisos, no se ofrece a nadie (ni los integrantes).
  const pending = resolveReviewCandidates(withPedro, review, undefined);
  assert(pending.source === "cargando", `fuente = cargando, got ${pending.source}`);
  assert(pending.candidates.length === 0, `sin opciones mientras carga, got ${pending.candidates.map((c) => c.person.id).join(",")}`);
  assert(
    resolveReviewCandidates(withPedro, review, null).source === "integrantes",
    "solo si la lectura falla se muestran los integrantes",
  );
  console.log("ok  mientras se leen los permisos, la lista queda vacía; los integrantes solo si falla");
}

{
  // 2 y 4. Crear toca solo la subtarea de la revisión; crear otra vez no duplica.
  const original: WorkOrder = {
    key: "NEH|tpl-draft|tpl|NEH-1-1|porcion:NEH-1-1",
    teamId: "tpl-draft",
    teamName: "Traducir TPL",
    book: "NEH",
    resource: "tpl",
    chapter: 1,
    portionIds: ["NEH-1-1"],
    itemIds: ["porcion:NEH-1-1"],
    itemTypes: ["porcion"],
    assignee: { personId: "ana", person: "Ana" },
    label: "1:1–3 · TPL",
  };
  const seed: FakeIssue[] = [
    {
      number: 1,
      title: workOrderIssueTitle(original),
      body: workOrderIssueBody(original),
      state: "open",
      assignees: ["ana"],
    },
  ];
  for (let n = 2; n <= 145; n++) {
    const other: WorkOrder = {
      ...original,
      key: `NEH|tpl-draft|tpl|P${n}|porcion:P${n}`,
      portionIds: [`P${n}`],
      itemIds: [`porcion:P${n}`],
      label: `${n}:1 · TPL`,
    };
    seed.push({
      number: n,
      title: workOrderIssueTitle(other),
      body: workOrderIssueBody(other),
      state: n % 3 === 0 ? "closed" : "open",
      assignees: [],
    });
  }
  const fake = installFakeDcs(seed);
  const before = new Map([...fake.issues.values()].map((i) => [i.number, JSON.stringify(i)]));

  // Si el plan no se guarda, no se crea la subtarea.
  fake.state.failPlanWrites = true;
  let saveError = "";
  try {
    await createReviewIssues({ session, org: ORG, board, task: review, inventory });
  } catch (err) {
    saveError = err instanceof Error ? err.message : String(err);
  }
  fake.state.failPlanWrites = false;
  assert(/no se pudo guardar el plan/i.test(saveError), `error en español al guardar el plan, got «${saveError}»`);
  assert(!/\b(git|commit|push|branch|rama|sha|403|permission)\b/i.test(saveError), `sin jerga técnica: «${saveError}»`);
  const writesAfterFail = fake.calls.filter(
    (c) => (c.method === "POST" && c.path.endsWith("/issues")) || c.method === "PATCH",
  );
  assert(writesAfterFail.length === 0, `sin plan guardado no se escribe ninguna subtarea, got ${writesAfterFail.length}`);
  assert(fake.issues.size === 145, "sin plan guardado no hay subtarea nueva");
  console.log("ok  si guardar el plan falla, no se crea la revisión y el error está en español");

  fake.calls.length = 0;
  const first = await createReviewIssues({ session, org: ORG, board, task: review, inventory });
  assert(first.created.length === 1 && first.existing.length === 0, "primera vez: 1 creada");

  // El plan se guarda en DCS antes de crear la subtarea, con la tarea de revisión completa.
  const planPath = "es-419/NEH/assignments.json";
  const lastPlanWrite = fake.calls.findLastIndex(
    (c) => (c.method === "POST" || c.method === "PUT") && c.path.includes("/contents/"),
  );
  const issuePost = fake.calls.findIndex((c) => c.method === "POST" && c.path.endsWith("/issues"));
  assert(lastPlanWrite >= 0 && issuePost > lastPlanWrite, "el plan se guarda antes de crear la subtarea");
  const savedFile = fake.files.get(planPath);
  assert(savedFile, `plan guardado en ${planPath}`);
  const saved = normalizeAssignmentsDoc(JSON.parse(savedFile.text), {
    book: "NEH",
    lang: "es-419",
    contentOrg: ORG,
    pmOrg: ORG,
  });
  const savedReview = saved.teams.find((t) => t.id === review.id);
  assert(savedReview?.name === "Revisión NEH 1:2", `nombre de la tarea guardado, got «${savedReview?.name}»`);
  assert(savedReview.phaseId === "fase-2", "fase guardada");
  assert(savedReview.reviewsPrincipal === true, "reviewsPrincipal guardado");
  assert(savedReview.reviewRef === "NEH 1:2", "reviewRef guardado");
  assert(savedReview.reviewAssigneeId === "ana", "persona asignada guardada");

  // Otra sesión que carga el plan desde DCS encuentra la tarea y la fase de la subtarea.
  const createdApi = toApi(fake.issues.get(146)!) as unknown as DcsIssue;
  const lookupId = issueTaskId(createdApi);
  const lookupTask = saved.teams.find((t) => t.id === lookupId);
  const lookupPhase = saved.phases.find((p) => p.id === lookupTask?.phaseId);
  assert(
    lookupTask?.name === "Revisión NEH 1:2" && lookupPhase?.name === "Fase 2",
    `Mis tareas resuelve «${lookupId}» a tarea y fase, got ${lookupTask?.name} / ${lookupPhase?.name}`,
  );
  console.log("ok  el plan se guarda antes de crear la subtarea, con nombre, fase y persona de la revisión");

  const patches = fake.calls.filter((c) => c.method === "PATCH");
  assert(patches.length === 0, `no se edita ninguna subtarea existente, got ${patches.map((c) => c.path).join(", ")}`);
  const posts = fake.calls.filter((c) => c.method === "POST" && c.path.endsWith("/issues"));
  assert(posts.length === 1, `un solo POST de subtarea, got ${posts.length}`);
  for (const [number, snapshot] of before) {
    assert(JSON.stringify(fake.issues.get(number)) === snapshot, `#${number} queda igual`);
  }
  assert(fake.issues.get(1)!.state === "open", "la subtarea original de la porción sigue abierta");

  const created = fake.issues.get(146)!;
  assert(created.title === "NEH 1:2 · TPL", `título creado, got «${created.title}»`);
  assert(created.assignees.join() === "ana", "la revisión está asignada a Ana");
  assert(created.state === "open", "la revisión queda abierta");

  const callsBefore = fake.calls.length;
  const second = await createReviewIssues({ session, org: ORG, board, task: review, inventory });
  assert(second.created.length === 0, "segunda vez: 0 creadas");
  assert(second.existing.map((i) => i.number).join() === "146", "segunda vez: reporta #146 existente");
  const againWrites = fake.calls
    .slice(callsBefore)
    .filter((c) => c.method !== "GET" && !c.path.includes("/contents/"));
  assert(againWrites.length === 0, `segunda vez: ninguna escritura de subtareas, got ${againWrites.map((c) => `${c.method} ${c.path}`).join(", ")}`);
  assert(fake.issues.size === 146, "no hay duplicado");
  assert(/ya existe \(#146\)/.test(reviewIssuesToast(second)), `aviso en español: ${reviewIssuesToast(second)}`);

  // Publicar el plan completo después mantiene la misma clave: no retira la revisión.
  const planned = publishableWorkOrders(board, inventory);
  const reviewPlanned = planned.filter((o) => o.teamId === "revision");
  assert(
    reviewPlanned.length === 1 && workOrderIssueBody(reviewPlanned[0]) === created.body,
    "el plan completo trae la misma subtarea de revisión (misma clave)",
  );
  console.log("ok  «Crear la revisión» toca solo su subtarea y no duplica al repetir");
}

console.log("verify-review-task: ok");
