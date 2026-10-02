import { activeScope, issueInScope, scopeFolder, scopeLabelName, scopedMilestone } from "../domain/scope";
import {
  addIssueAssignees,
  addIssueLabels,
  addTeamMember,
  addTeamRepo,
  createIssue,
  createIssueComment,
  createLabel,
  createMilestone,
  createOrUpdateContents,
  createTeam,
  DcsApiError,
  editIssue,
  getContents,
  getRawContent,
  listLabels,
  listMilestones,
  listOrgTeams,
  listTeamMembers,
  listTeamRepos,
  removeTeamMember,
  request,
  searchIssues,
  type DcsIssue,
  type DcsTeam,
} from "@ip-lms/dcs-client";
import type { Assignment, AssignmentsDoc, InventoryDoc, Team } from "../domain/types";
import { PM_REPO_NAME } from "../domain/types";
import { upsertTaskProgressInBody, type TaskProgressMarker } from "../domain/taskProgress";
import {
  mirroredOrgTeamName,
  normalizePmConfig,
  pmFacetLabel,
  pmRootLabel,
  teamHasReposForTask,
  type PmConfig,
  type TeamRepoEligibility,
  DEFAULT_PM_CONFIG,
  DEFAULT_PM_NAMESPACE,
  parsePmFacetValue,
  isPmLabel,
} from "../domain/roles";
import {
  DEFAULT_SOLVERS_CATALOG,
  normalizeSolversCatalog,
  upgradeShippedTools,
  withShippedTools,
  type SolversCatalog,
} from "../domain/solvers";
import { normalizeProjectId } from "../domain/books";
import {
  encodeWorkOrderMarker,
  indexWorkIssues,
  parseWorkOrderMarker,
  planKeeps,
  workOrderIssueBody,
  workOrderIssueTitle,
  publishableWorkOrders,
  type WorkOrder,
} from "../domain/workOrder";
import { reviewWorkOrders } from "../domain/reviewTask";
import { parseItemKey, uid } from "../domain/assignment";
import { formatChatEvent } from "../domain/chatEvent";
import { dcsConfig } from "./config";
import type { GtSession } from "./auth";
import { ensurePmRepo, saveProjectToDcs } from "./persist";

const FACET_COLORS: Record<string, string> = {
  "recurso:tpl": "1d4ed8",
  "recurso:tps": "7c3aed",
  "recurso:notas": "0f766e",
  "recurso:preguntas": "b45309",
  "recurso:academia": "be123c",
  "recurso:palabras": "a21caf",
  "recurso:bundle": "475569",
  "estado:en-curso": "ea580c",
  equipo: "64748b",
  tarea: "0d9488",
  cap: "94a3b8",
  root: "0f172a",
};

function configPath(): string {
  return `${scopeFolder()}config.json`;
}

function solversPath(): string {
  return "solvers.json";
}

function labelColorFor(name: string, namespaceId: string): string {
  if (name === namespaceId) return FACET_COLORS.root;
  const withoutNs = name.startsWith(`${namespaceId}/`) ? name.slice(namespaceId.length + 1) : name;
  if (FACET_COLORS[withoutNs]) return FACET_COLORS[withoutNs];
  if (withoutNs.startsWith("equipo:")) return FACET_COLORS.equipo;
  if (withoutNs.startsWith("tarea:")) return FACET_COLORS.tarea;
  if (withoutNs.startsWith("libro:")) return FACET_COLORS.cap;
  if (withoutNs.startsWith("cap:")) return FACET_COLORS.cap;
  if (withoutNs.startsWith("estado:")) return FACET_COLORS["estado:en-curso"];
  return "ededed";
}

/** Labels every platform issue must carry for searchable namespacing. */
export function pmIssueLabelNames(
  order: Pick<WorkOrder, "resource" | "teamId" | "teamName" | "chapter" | "book">,
  namespaceId: string = DEFAULT_PM_NAMESPACE,
): string[] {
  const labels = [
    pmRootLabel(namespaceId),
    pmFacetLabel("recurso", order.resource, namespaceId),
    // Stable ProjectTask id — preferred filter for “subtareas de esta tarea”.
    pmFacetLabel("tarea", order.teamId, namespaceId),
    // Legacy facet (display name of the project task). Kept for older boards/filters.
    pmFacetLabel("equipo", order.teamName, namespaceId),
    pmFacetLabel("cap", order.chapter, namespaceId),
  ];
  if (order.book) {
    labels.push(pmFacetLabel("libro", order.book.toUpperCase(), namespaceId));
  }
  // A scoped workspace marks its issues so another workspace in the same organization never lists them.
  if (activeScope()) labels.push(scopeLabelName(activeScope(), namespaceId));
  return labels;
}

/** Read `pm/tarea:{taskId}` from an issue, if present. */
export function issueProjectTaskId(
  issue: DcsIssue,
  namespaceId: string = DEFAULT_PM_NAMESPACE,
): string | null {
  for (const label of issue.labels ?? []) {
    const value = parsePmFacetValue(label.name, "tarea", namespaceId);
    if (value) return value;
  }
  const marker = parseWorkOrderMarker(issue.body);
  return marker?.teamId ?? null;
}

/**
 * True when an issue belongs to this product.
 * DCS `labels=` drops unknown names (“Non existent labels are discarded”),
 * so server-side search can return every assigned issue — this is the real gate.
 */
export function isPmNamespacedIssue(
  issue: DcsIssue,
  namespaceId: string = DEFAULT_PM_NAMESPACE,
): boolean {
  if ((issue.labels ?? []).some((l) => isPmLabel(l.name, namespaceId))) return true;
  if (parseWorkOrderMarker(issue.body)) return true;
  return false;
}

function isGatewayTasksRepo(issue: DcsIssue): boolean {
  const name = issue.repository?.name;
  if (name === PM_REPO_NAME) return true;
  const full = issue.repository?.full_name;
  if (full?.endsWith(`/${PM_REPO_NAME}`)) return true;
  // Search payloads sometimes omit repository; don't reject solely for that —
  // label/marker check already ran.
  return !issue.repository;
}

async function searchPmIssues(
  session: GtSession,
  org: string,
  opts: {
    state?: "open" | "closed" | "all";
    milestones?: string[];
    team?: string;
    assigned?: boolean;
    maxPages?: number;
    namespaceId?: string;
  },
): Promise<DcsIssue[]> {
  const config = dcsConfig(session.host);
  const namespaceId = opts.namespaceId ?? DEFAULT_PM_NAMESPACE;
  const issues: DcsIssue[] = [];
  const maxPages = opts.maxPages ?? 10;
  let page = 1;
  let more = true;
  while (more && page <= maxPages) {
    const batch = await searchIssues(config, {
      token: session.token,
      owner: org,
      labels: [pmRootLabel(namespaceId)],
      milestones: opts.milestones?.map((m) => scopedMilestone(m)),
      team: opts.team,
      assigned: opts.assigned,
      type: "issues",
      state: opts.state ?? "open",
      page,
      limit: 50,
    });
    issues.push(...batch);
    more = batch.length === 50;
    page += 1;
  }
  return issues.filter(
    (issue) => isPmNamespacedIssue(issue, namespaceId) && isGatewayTasksRepo(issue) && issueInScope(issue),
  );
}

export async function loadPmConfig(session: GtSession, org: string): Promise<PmConfig> {
  const config = dcsConfig(session.host);
  try {
    const raw = await getRawContent(config, org, PM_REPO_NAME, configPath(), {
      token: session.token,
    });
    return normalizePmConfig(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PM_CONFIG };
  }
}

export async function loadSolversCatalog(
  session: GtSession,
  org: string,
): Promise<SolversCatalog> {
  if (!org) return DEFAULT_SOLVERS_CATALOG;
  const config = dcsConfig(session.host);
  try {
    const raw = await getRawContent(config, org, PM_REPO_NAME, solversPath(), {
      token: session.token,
    });
    const catalog = normalizeSolversCatalog(JSON.parse(raw));
    if (catalog.solvers.length) {
      const upgraded = upgradeShippedTools(catalog);
      if (upgraded !== catalog) {
        void saveSolversCatalog(session, org, upgraded).catch(() => undefined);
      }
      return withShippedTools(upgraded);
    }
  } catch {
    /* missing or unreadable — seed defaults below */
  }
  // First-time / empty: persist shipped defaults so gestores see a real list.
  try {
    await saveSolversCatalog(session, org, DEFAULT_SOLVERS_CATALOG);
  } catch {
    /* read-only token — still use defaults in-memory */
  }
  return DEFAULT_SOLVERS_CATALOG;
}

export async function saveSolversCatalog(
  session: GtSession,
  org: string,
  catalog: SolversCatalog,
): Promise<void> {
  await ensurePmRepo(session, org);
  const config = dcsConfig(session.host);
  const normalized = normalizeSolversCatalog(catalog);
  const body: SolversCatalog = {
    schema: normalized.schema,
    solvers: normalized.solvers.length ? normalized.solvers : DEFAULT_SOLVERS_CATALOG.solvers,
  };
  let sha: string | undefined;
  try {
    const existing = await getContents(config, org, PM_REPO_NAME, solversPath(), {
      token: session.token,
    });
    if (!Array.isArray(existing) && existing.sha) sha = existing.sha;
  } catch {
    sha = undefined;
  }
  await createOrUpdateContents(config, org, PM_REPO_NAME, solversPath(), {
    content: `${JSON.stringify(body, null, 2)}\n`,
    message: "Actualizar catálogo de herramientas (solvers)",
    sha,
    token: session.token,
  });
}

export async function savePmConfig(
  session: GtSession,
  org: string,
  pmConfig: PmConfig,
): Promise<void> {
  await ensurePmRepo(session, org);
  const config = dcsConfig(session.host);
  let sha: string | undefined;
  try {
    const existing = await getContents(config, org, PM_REPO_NAME, configPath(), {
      token: session.token,
    });
    if (!Array.isArray(existing) && existing.sha) sha = existing.sha;
  } catch {
    sha = undefined;
  }
  await createOrUpdateContents(config, org, PM_REPO_NAME, configPath(), {
    content: `${JSON.stringify(pmConfig, null, 2)}\n`,
    message: "Actualizar config de TAS",
    sha,
    token: session.token,
  });
}

/**
 * Link a project task to an existing DCS org team.
 * Does **not** create org teams. Optionally grants missing repos (admin)
 * and pulls org members into `task.memberIds` for local auto-assign.
 */
export async function assignOrgTeamToTask(params: {
  session: GtSession;
  org: string;
  lang: string;
  task: Team;
  orgTeam: DcsTeam;
  /** Try `addTeamRepo` for each missing required repo. */
  grantMissingRepos?: boolean;
  /** Replace task.memberIds with current org team member logins. */
  pullMembers?: boolean;
  pmConfig?: PmConfig;
}): Promise<{
  task: Team;
  eligibility: TeamRepoEligibility;
  warnings: string[];
  memberLogins: string[];
}> {
  const {
    session,
    org,
    lang,
    task,
    orgTeam,
    grantMissingRepos = false,
    pullMembers = true,
  } = params;
  const config = dcsConfig(session.host);
  const resolved = params.pmConfig ?? (await loadPmConfig(session, org));
  const warnings: string[] = [];

  let repoNames: string[] = [];
  try {
    const repos = await listTeamRepos(config, orgTeam.id, session.token, { limit: 100 });
    repoNames = repos.map((r) => r.name);
  } catch (err) {
    throw enrich403(err, `No se pudieron listar los repos del equipo ${orgTeam.name}.`);
  }

  let eligibility = teamHasReposForTask(repoNames, task, lang, resolved);

  if (!eligibility.ok && grantMissingRepos) {
    for (const repo of eligibility.missing) {
      try {
        await addTeamRepo(config, orgTeam.id, org, repo, session.token);
        repoNames = [...repoNames, repo];
      } catch (err) {
        const status = err instanceof DcsApiError ? err.status : 0;
        if (status === 404) {
          warnings.push(`Repo ${org}/${repo} no existe todavía; se omitió.`);
        } else if (status === 403) {
          warnings.push(`Sin permiso para añadir ${repo} al equipo ${orgTeam.name}.`);
        } else {
          warnings.push(
            `No se pudo añadir ${repo}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
    eligibility = teamHasReposForTask(repoNames, task, lang, resolved);
  }

  if (!eligibility.ok) {
    const missing = eligibility.missing.join(", ");
    throw new Error(
      `El equipo ${orgTeam.name} no tiene todos los repos de esta tarea (faltan: ${missing}).` +
        (session.canManage
          ? " Puedes concederlos si eres gestor."
          : " Pide a un gestor que conceda el acceso."),
    );
  }

  let memberLogins: string[] = task.memberIds;
  if (pullMembers) {
    try {
      const members = await listTeamMembers(config, orgTeam.id, session.token);
      memberLogins = members.map((m) => m.login);
    } catch (err) {
      warnings.push(
        `No se pudieron leer miembros de ${orgTeam.name}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return {
    task: {
      ...task,
      orgTeamId: orgTeam.id,
      orgTeamName: orgTeam.name,
      memberIds: pullMembers ? memberLogins : task.memberIds,
    },
    eligibility,
    warnings,
    memberLogins,
  };
}

/**
 * @deprecated Prefer {@link assignOrgTeamToTask}. Kept for reference; creates a
 * mirrored org team — do not call from UI.
 */
export async function syncTeamToOrg(
  session: GtSession,
  org: string,
  team: Team,
  lang: string,
  pmConfig?: PmConfig,
): Promise<{ team: Team; orgTeam: DcsTeam; warnings: string[] }> {
  const config = dcsConfig(session.host);
  const resolved = pmConfig ?? (await loadPmConfig(session, org));
  const warnings: string[] = [];
  const desiredName = mirroredOrgTeamName(team.name, resolved.teamPrefix);

  let orgTeam: DcsTeam | undefined;
  try {
    const existing = await listOrgTeams(config, org, session.token);
    orgTeam =
      existing.find((t) => t.id === team.orgTeamId) ||
      existing.find((t) => t.name === desiredName) ||
      existing.find((t) => t.name === team.orgTeamName);
  } catch (err) {
    throw enrich403(err, "No se pudieron listar los equipos de la organización.");
  }

  if (!orgTeam) {
    try {
      orgTeam = await createTeam(config, org, {
        name: desiredName,
        description: team.description || `Equipo TAS: ${team.name}`,
        permission: "write",
        canCreateOrgRepo: false,
        includesAllRepositories: false,
        units: ["repo.code", "repo.issues"],
        token: session.token,
      });
    } catch (err) {
      throw enrich403(
        err,
        "No se pudo crear el equipo en la organización (hace falta ser admin/owner de la org).",
      );
    }
  }

  const result = await assignOrgTeamToTask({
    session,
    org,
    lang,
    task: team,
    orgTeam,
    grantMissingRepos: true,
    pullMembers: false,
    pmConfig: resolved,
  });

  // Legacy: also push local members onto the org team.
  try {
    const current = await listTeamMembers(config, orgTeam.id, session.token);
    const currentLogins = new Set(current.map((m) => m.login.toLowerCase()));
    const desired = new Set(team.memberIds.map((id) => id.toLowerCase()));

    for (const login of desired) {
      if (currentLogins.has(login)) continue;
      try {
        await addTeamMember(config, orgTeam.id, login, session.token);
      } catch (err) {
        warnings.push(
          `No se pudo añadir @${login}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    for (const member of current) {
      if (desired.has(member.login.toLowerCase())) continue;
      try {
        await removeTeamMember(config, orgTeam.id, member.login, session.token);
      } catch (err) {
        warnings.push(
          `No se pudo quitar @${member.login}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } catch (err) {
    warnings.push(
      `No se pudieron sincronizar miembros: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {
    team: result.task,
    orgTeam,
    warnings: [...result.warnings, ...warnings],
  };
}

function enrich403(err: unknown, message: string): Error {
  if (err instanceof DcsApiError && err.status === 403) {
    return new Error(message);
  }
  return err instanceof Error ? err : new Error(String(err));
}

async function ensureLabel(
  session: GtSession,
  org: string,
  name: string,
  color: string,
  cache: Map<string, number>,
): Promise<number> {
  const existing = cache.get(name);
  if (existing) return existing;
  const config = dcsConfig(session.host);
  const labels = await listLabels(config, org, PM_REPO_NAME, { token: session.token, limit: 100 });
  for (const label of labels) cache.set(label.name, label.id);
  if (cache.has(name)) return cache.get(name)!;
  const created = await createLabel(config, org, PM_REPO_NAME, {
    token: session.token,
    name,
    color,
    description: name,
  });
  cache.set(created.name, created.id);
  return created.id;
}

async function ensureMilestone(
  session: GtSession,
  org: string,
  projectTitle: string,
  cache: Map<string, number>,
): Promise<number> {
  const title = scopedMilestone(projectTitle);
  if (cache.has(title)) return cache.get(title)!;
  const config = dcsConfig(session.host);
  const list = await listMilestones(config, org, PM_REPO_NAME, {
    token: session.token,
    state: "all",
    name: title,
    limit: 50,
  });
  for (const ms of list) cache.set(ms.title, ms.id);
  if (cache.has(title)) return cache.get(title)!;
  const created = await createMilestone(config, org, PM_REPO_NAME, {
    token: session.token,
    title,
    description: `Libro ${title}`,
  });
  cache.set(created.title, created.id);
  return created.id;
}

export type PublishProgress = {
  total: number;
  done: number;
  created: number;
  updated: number;
  current?: string;
};

export type PublishPreview = {
  created: number;
  updated: number;
  closed: number;
  totalOrders: number;
  /** Open work-order issues already on the milestone. */
  existingOpen: number;
  /** True when open issues would be closed because their keys left the plan. */
  scopeChanged: boolean;
};

/**
 * Dry-run of publish: same key matching as publishWorkOrders, no writes.
 */
export async function previewPublishWorkOrders(params: {
  session: GtSession;
  org: string;
  board: AssignmentsDoc;
  inventory: InventoryDoc;
  orders?: WorkOrder[];
  retireOrphans?: boolean;
}): Promise<PublishPreview> {
  const { session, org, board, inventory } = params;
  const retireOrphans = params.retireOrphans !== false;
  const pmConfig = await loadPmConfig(session, org);
  const orders = params.orders ?? publishableWorkOrders(board, inventory);
  const projectId = normalizeProjectId(board.projectId || board.book);

  const existing = await searchPmIssues(session, org, {
    state: "all",
    milestones: [projectId],
    maxPages: 10,
    namespaceId: pmConfig.namespaceId,
  });

  const known = indexWorkIssues(existing);
  let existingOpen = 0;
  for (const issue of existing) {
    if (parseWorkOrderMarker(issue.body) && issue.state !== "closed") existingOpen += 1;
  }

  const keeps = planKeeps(orders);
  let created = 0;
  let updated = 0;
  let closed = 0;
  for (const order of orders) {
    if (known.find(order)) updated += 1;
    else created += 1;
  }
  if (retireOrphans) {
    for (const issue of existing) {
      if (issue.state === "closed") continue;
      const marker = parseWorkOrderMarker(issue.body);
      if (!marker || keeps(marker)) continue;
      closed += 1;
    }
  }

  return {
    created,
    updated,
    closed,
    totalOrders: orders.length,
    existingOpen,
    scopeChanged: closed > 0,
  };
}

/**
 * Publish work orders as issues in the PM repo. Idempotent via the HTML marker key.
 */
export async function publishWorkOrders(params: {
  session: GtSession;
  org: string;
  board: AssignmentsDoc;
  inventory: InventoryDoc;
  orders?: WorkOrder[];
  /**
   * When true (default), close open work-order issues whose keys are no longer in the plan.
   * Existing issues keep their state: closed ones stay closed.
   */
  retireOrphans?: boolean;
  onProgress?: (progress: PublishProgress) => void;
}): Promise<{ created: number; updated: number; closed: number; issues: DcsIssue[] }> {
  const { session, org, board, inventory, onProgress } = params;
  const retireOrphans = params.retireOrphans !== false;
  await ensurePmRepo(session, org);
  const config = dcsConfig(session.host);
  const pmConfig = await loadPmConfig(session, org);
  const namespaceId = pmConfig.namespaceId;
  const orders = params.orders ?? publishableWorkOrders(board, inventory);
  const labelCache = new Map<string, number>();
  const milestoneCache = new Map<string, number>();
  const projectId = normalizeProjectId(board.projectId || board.book);

  const existing = await searchPmIssues(session, org, {
    state: "all",
    milestones: [projectId],
    maxPages: 10,
    namespaceId,
  });

  // By key, or by what the subtarea covers: the same work must never be planned twice (see `workIdentity`).
  const known = indexWorkIssues(existing);

  let created = 0;
  let updated = 0;
  let closed = 0;
  const results: DcsIssue[] = [];
  const keeps = planKeeps(orders);

  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    onProgress?.({
      total: orders.length,
      done: i,
      created,
      updated,
      current: order.label,
    });

    const labelNames = pmIssueLabelNames(order, namespaceId);
    const labelIds: number[] = [];
    for (const name of labelNames) {
      try {
        labelIds.push(
          await ensureLabel(session, org, name, labelColorFor(name, namespaceId), labelCache),
        );
      } catch {
        /* label creation may fail without admin; continue without it */
      }
    }
    const milestoneId = await ensureMilestone(
      session,
      org,
      projectId,
      milestoneCache,
    );

    const title = workOrderIssueTitle(order);
    const body = workOrderIssueBody(order);
    const found = known.find(order);

    if (found) {
      // A closed subtarea means the work finished; the plan carries no "reopen" signal,
      // so publishing again only refreshes its text and never touches its state.
      const edited = await editIssue(config, org, PM_REPO_NAME, found.number, {
        token: session.token,
        title,
        body,
        milestone: milestoneId,
        assignees: order.assignee ? [order.assignee.personId] : [],
      });
      if (labelIds.length) {
        try {
          await addIssueLabels(config, org, PM_REPO_NAME, found.number, labelIds, session.token);
        } catch {
          /* ignore */
        }
      }
      updated += 1;
      results.push(edited);
    } else {
      const issue = await createIssue(config, org, PM_REPO_NAME, {
        token: session.token,
        title,
        body,
        milestone: milestoneId,
        labels: labelIds,
        assignees: order.assignee ? [order.assignee.personId] : undefined,
      });
      created += 1;
      results.push(issue);
      known.add(order, issue);
    }
  }

  if (retireOrphans) {
    for (const issue of existing) {
      if (issue.state === "closed") continue;
      const marker = parseWorkOrderMarker(issue.body);
      if (!marker || keeps(marker)) continue;
      try {
        const closedIssue = await editIssue(config, org, PM_REPO_NAME, issue.number, {
          token: session.token,
          state: "closed",
        });
        closed += 1;
        results.push(closedIssue);
      } catch {
        /* best-effort retirement */
      }
    }
  }

  onProgress?.({
    total: orders.length,
    done: orders.length,
    created,
    updated,
  });

  return { created, updated, closed, issues: results };
}

export type ReviewIssuesResult = {
  created: DcsIssue[];
  /** Review subtareas that already existed (never duplicated, never reopened). */
  existing: DcsIssue[];
  /** Existing open ones whose assignee was changed to the task's person. */
  reassigned: DcsIssue[];
  /** Other open subtareas of this same task with a different range (left as they are). */
  otherOpen: DcsIssue[];
};

/**
 * «Crear la revisión»: save the project plan (like «Solo guardar plan»), then
 * create only this review task's subtareas. The plan must be on DCS first so
 * other sessions can resolve the issue's `pm/tarea:{task.id}` to its name and
 * phase. Never edits, closes or reopens any other issue of the project
 * (unlike Publicar). An existing review issue is reported, not duplicated; if
 * it is still open and assigned to someone else, only its assignee is changed.
 */
export async function createReviewIssues(params: {
  session: GtSession;
  org: string;
  board: AssignmentsDoc;
  task: Team;
  inventory?: InventoryDoc | null;
}): Promise<ReviewIssuesResult> {
  const { session, org, board, task } = params;
  const { orders, reason } = reviewWorkOrders(board, task, params.inventory);
  if (reason) throw new Error(reason);
  if (!task.reviewAssigneeId?.trim()) throw new Error("Elige a la persona que hará la revisión.");
  if (!board.teams.some((t) => t.id === task.id)) {
    throw new Error("Esta revisión no está en el plan del proyecto. Guárdala en Editar y vuelve a intentarlo.");
  }

  try {
    await saveProjectToDcs({
      session,
      org,
      lang: board.lang,
      book: board.projectId || board.book,
      assignments: board,
      inventory: params.inventory ?? null,
    });
  } catch {
    throw new Error(
      "No se pudo guardar el plan del proyecto, así que no se creó la revisión. Revisa tu conexión y tus permisos en la organización e inténtalo de nuevo.",
    );
  }

  await ensurePmRepo(session, org);
  const config = dcsConfig(session.host);
  const pmConfig = await loadPmConfig(session, org);
  const namespaceId = pmConfig.namespaceId;
  const projectId = normalizeProjectId(board.projectId || board.book);

  const existing = await searchPmIssues(session, org, {
    state: "all",
    milestones: [projectId],
    maxPages: 20,
    namespaceId,
  });
  const known = indexWorkIssues(existing);

  const result: ReviewIssuesResult = { created: [], existing: [], reassigned: [], otherOpen: [] };
  const keeps = planKeeps(orders);
  for (const issue of existing) {
    if (issue.state === "closed") continue;
    const marker = parseWorkOrderMarker(issue.body);
    if (marker && marker.teamId === task.id && !keeps(marker)) result.otherOpen.push(issue);
  }

  const labelCache = new Map<string, number>();
  const milestoneCache = new Map<string, number>();
  for (const order of orders) {
    const found = known.find(order);
    if (found) {
      result.existing.push(found);
      const want = order.assignee?.personId;
      if (found.state !== "closed" && want && !isIssueAssignedTo(found, want)) {
        result.reassigned.push(
          await editIssue(config, org, PM_REPO_NAME, found.number, {
            token: session.token,
            assignees: [want],
          }),
        );
      }
      continue;
    }
    const labelIds: number[] = [];
    for (const name of pmIssueLabelNames(order, namespaceId)) {
      try {
        labelIds.push(
          await ensureLabel(session, org, name, labelColorFor(name, namespaceId), labelCache),
        );
      } catch {
        /* label creation may fail without admin; continue without it */
      }
    }
    const milestoneId = await ensureMilestone(session, org, projectId, milestoneCache);
    const issue = await createIssue(config, org, PM_REPO_NAME, {
      token: session.token,
      title: workOrderIssueTitle(order),
      body: workOrderIssueBody(order),
      milestone: milestoneId,
      labels: labelIds,
      assignees: order.assignee ? [order.assignee.personId] : undefined,
    });
    result.created.push(issue);
    known.add(order, issue);
  }
  return result;
}

/** Spanish toast for {@link createReviewIssues}. */
export function reviewIssuesToast(result: ReviewIssuesResult): string {
  const nums = (list: DcsIssue[]) => list.map((i) => `#${i.number}`).join(", ");
  const parts: string[] = [];
  if (result.created.length) {
    parts.push(
      result.created.length === 1
        ? `Revisión creada: ${nums(result.created)}.`
        : `Revisiones creadas: ${nums(result.created)}.`,
    );
  }
  if (result.existing.length) {
    parts.push(
      `Esta revisión ya existe (${nums(result.existing)}); no se creó otra.` +
        (result.reassigned.length ? ` Se cambió la persona asignada en ${nums(result.reassigned)}.` : ""),
    );
  }
  if (result.otherOpen.length) {
    parts.push(
      `Esta tarea tiene otra revisión abierta con otros versículos (${nums(result.otherOpen)}); se dejó como estaba.`,
    );
  }
  return parts.join(" ") || "No hubo nada que crear.";
}

export type IssueBoardProjection = {
  assignments: Assignment[];
  issues: DcsIssue[];
};

function stateFromIssue(
  issue: DcsIssue,
  namespaceId: string = DEFAULT_PM_NAMESPACE,
): Assignment["state"] {
  if (issue.state === "closed") return "hecho";
  if (issueIsInProgress(issue, namespaceId)) return "en curso";
  if (issue.assignee || (issue.assignees && issue.assignees.length)) return "asignado";
  return "sin asignar";
}

/**
 * Pull issues for a book and project them onto the assignment board.
 * Existing assignments become a cache; issues are authoritative for person/state.
 */
export async function pullIssues(params: {
  session: GtSession;
  org: string;
  book: string;
  board: AssignmentsDoc;
}): Promise<IssueBoardProjection> {
  const { session, org, book, board } = params;
  const pmConfig = await loadPmConfig(session, org);
  const issues = await searchPmIssues(session, org, {
    state: "all",
    milestones: [normalizeProjectId(book)],
    maxPages: 20,
    namespaceId: pmConfig.namespaceId,
  });

  const peopleByLogin = new Map(board.people.map((p) => [p.id.toLowerCase(), p]));
  const next: Assignment[] = [];
  const seenItems = new Set<string>();

  for (const issue of issues) {
    const marker = parseWorkOrderMarker(issue.body);
    if (!marker) continue;
    const assigneeLogin =
      issue.assignee?.login ||
      issue.assignees?.[0]?.login ||
      "";
    const person = assigneeLogin
      ? peopleByLogin.get(assigneeLogin.toLowerCase()) || {
          id: assigneeLogin,
          name: issue.assignee?.full_name || assigneeLogin,
        }
      : null;
    const state = stateFromIssue(issue, pmConfig.namespaceId);
    for (const itemId of marker.itemIds) {
      const parsed = parseItemKey(itemId);
      if (!parsed) continue;
      const dedupe = `${marker.teamId}|${parsed.type}|${parsed.id}`;
      if (seenItems.has(dedupe)) continue;
      seenItems.add(dedupe);
      next.push({
        id: uid(),
        person: person?.name ?? "",
        personId: person?.id ?? "",
        teamId: marker.teamId,
        itemType: parsed.type,
        itemId: parsed.id,
        note: `#${issue.number}`,
        state: person ? state : "sin asignar",
      });
    }
  }

  for (const row of board.assignments) {
    const dedupe = `${row.teamId}|${row.itemType}|${row.itemId}`;
    if (seenItems.has(dedupe)) continue;
    next.push(row);
  }

  return { assignments: next, issues };
}

/** Search PM-namespaced issues assigned to the current user. */
export async function listMyIssues(
  session: GtSession,
  org: string,
): Promise<DcsIssue[]> {
  const pmConfig = await loadPmConfig(session, org);
  return searchPmIssues(session, org, {
    assigned: true,
    state: "open",
    maxPages: 10,
    namespaceId: pmConfig.namespaceId,
  });
}

/** Open PM issues for a project milestone (all assignees). */
export async function listProjectOpenIssues(
  session: GtSession,
  org: string,
  projectId: string,
): Promise<DcsIssue[]> {
  const pmConfig = await loadPmConfig(session, org);
  return searchPmIssues(session, org, {
    state: "open",
    milestones: [normalizeProjectId(projectId)],
    maxPages: 20,
    namespaceId: pmConfig.namespaceId,
  });
}

/** Every PM issue (open and closed) of a project milestone. */
export async function listProjectIssues(
  session: GtSession,
  org: string,
  projectId: string,
): Promise<{ issues: DcsIssue[]; namespaceId: string }> {
  const pmConfig = await loadPmConfig(session, org);
  const issues = await searchPmIssues(session, org, {
    state: "all",
    milestones: [normalizeProjectId(projectId)],
    maxPages: 20,
    namespaceId: pmConfig.namespaceId,
  });
  return { issues, namespaceId: pmConfig.namespaceId };
}

/** Open PM issues for an org team with no assignee (claimable). */
export async function listTeamOpenIssues(
  session: GtSession,
  org: string,
  orgTeamName: string,
): Promise<DcsIssue[]> {
  const pmConfig = await loadPmConfig(session, org);
  const issues = await searchPmIssues(session, org, {
    team: orgTeamName,
    state: "open",
    maxPages: 10,
    namespaceId: pmConfig.namespaceId,
  });
  return issues.filter((issue) => isIssueUnassigned(issue));
}

export function issueAssigneeLogins(issue: DcsIssue): string[] {
  const logins = new Set<string>();
  if (issue.assignee?.login) logins.add(issue.assignee.login);
  for (const row of issue.assignees ?? []) {
    if (row.login) logins.add(row.login);
  }
  return [...logins];
}

export function isIssueUnassigned(issue: DcsIssue): boolean {
  return issueAssigneeLogins(issue).length === 0;
}

export function isIssueAssignedTo(issue: DcsIssue, username: string): boolean {
  const needle = username.trim().toLowerCase();
  if (!needle) return false;
  return issueAssigneeLogins(issue).some((login) => login.toLowerCase() === needle);
}

export async function claimIssue(
  session: GtSession,
  org: string,
  issueNumber: number,
): Promise<DcsIssue> {
  return addIssueAssignees(
    dcsConfig(session.host),
    org,
    PM_REPO_NAME,
    issueNumber,
    [session.username],
    session.token,
  );
}

/**
 * Hand a subtarea to another person (replaces whoever had it) and tell them with a mention.
 * Caller must enforce capability (coordinators only).
 */
export async function reassignIssue(
  session: GtSession,
  org: string,
  issue: DcsIssue,
  login: string,
  taskLabel: string,
): Promise<DcsIssue> {
  const edited = await editIssue(dcsConfig(session.host), org, PM_REPO_NAME, issue.number, {
    token: session.token,
    assignees: [login],
  });
  const before = issueAssigneeLogins(issue).filter((l) => l.toLowerCase() !== login.toLowerCase());
  const summary = `@${login} Te asignaron «${taskLabel}».${before.length ? ` La tenía ${before.map((l) => `@${l}`).join(", ")}.` : ""}`;
  await commentOnIssue(
    session,
    org,
    issue.number,
    formatChatEvent({ type: "tarea-asignada", emitter: "equipo-hoy", issue: issue.number, summary, mentions: [login], data: { by: session.username, from: before } }),
  ).catch(() => undefined);
  return edited;
}

/**
 * A subtarea for the team to decide something about a verse (an alignment proposal or
 * objection). It belongs to the same project and task as the work it is about and has
 * nobody assigned, so it reaches the whole team like any free subtarea.
 */
export async function createDecisionIssue(
  session: GtSession,
  org: string,
  params: {
    projectId: string;
    taskId: string;
    taskName: string;
    resource: "tpl" | "tps";
    book: string;
    chapter: number;
    verse: number;
    decisionId: string;
    title: string;
    text: string;
  },
): Promise<DcsIssue> {
  const config = dcsConfig(session.host);
  const pmConfig = await loadPmConfig(session, org);
  const namespaceId = pmConfig.namespaceId;
  const labelCache = new Map<string, number>();
  const order: WorkOrder = {
    key: `${params.taskId}|decision:${params.decisionId}`,
    teamId: params.taskId,
    teamName: params.taskName,
    book: params.book,
    resource: params.resource,
    chapter: params.chapter,
    portionIds: [`decision:${params.decisionId}`],
    itemIds: [],
    itemTypes: [],
    label: `${params.chapter}:${params.verse} · Decisión`,
  };
  const labelIds: number[] = [];
  for (const name of pmIssueLabelNames(order, namespaceId)) {
    try {
      labelIds.push(await ensureLabel(session, org, name, labelColorFor(name, namespaceId), labelCache));
    } catch {
      /* labels are a convenience; the marker is what identifies the subtarea */
    }
  }
  const milestoneId = await ensureMilestone(session, org, normalizeProjectId(params.projectId), new Map());
  return createIssue(config, org, PM_REPO_NAME, {
    token: session.token,
    title: params.title,
    body: `${params.text}

${encodeWorkOrderMarker(order)}`,
    milestone: milestoneId,
    labels: labelIds,
  });
}

/** Clear assignees (Liberar). Caller must enforce capability. */
export async function unclaimIssue(
  session: GtSession,
  org: string,
  issueNumber: number,
): Promise<DcsIssue> {
  return editIssue(dcsConfig(session.host), org, PM_REPO_NAME, issueNumber, {
    token: session.token,
    assignees: [],
  });
}

export async function markIssueInProgress(
  session: GtSession,
  org: string,
  issue: DcsIssue,
): Promise<DcsIssue> {
  const config = dcsConfig(session.host);
  const pmConfig = await loadPmConfig(session, org);
  const namespaceId = pmConfig.namespaceId;
  const labelCache = new Map<string, number>();
  const estadoLabel = pmFacetLabel("estado", "en-curso", namespaceId);
  try {
    const enCursoId = await ensureLabel(
      session,
      org,
      estadoLabel,
      labelColorFor(estadoLabel, namespaceId),
      labelCache,
    );
    await addIssueLabels(config, org, PM_REPO_NAME, issue.number, [enCursoId], session.token);
  } catch {
    /* fall through — body marker still applied */
  }
  return editIssue(config, org, PM_REPO_NAME, issue.number, {
    token: session.token,
    body: ensureEnCursoInBody(issue.body),
  });
}

/** `pm/estado:conflicto`: keeps a closed subtarea in "Necesitan tu atención" until decided. */
export async function markIssueConflict(
  session: GtSession,
  org: string,
  issueNumber: number,
): Promise<void> {
  const pmConfig = await loadPmConfig(session, org);
  const name = pmFacetLabel("estado", "conflicto", pmConfig.namespaceId);
  const id = await ensureLabel(session, org, name, labelColorFor(name, pmConfig.namespaceId), new Map());
  await addIssueLabels(dcsConfig(session.host), org, PM_REPO_NAME, issueNumber, [id], session.token);
}

export async function clearIssueConflict(
  session: GtSession,
  org: string,
  issueNumber: number,
): Promise<void> {
  const config = dcsConfig(session.host);
  const pmConfig = await loadPmConfig(session, org);
  const name = pmFacetLabel("estado", "conflicto", pmConfig.namespaceId);
  const labels = await listLabels(config, org, PM_REPO_NAME, { token: session.token, limit: 100 });
  const label = labels.find((row) => row.name === name);
  if (!label) return;
  await request<void>(config, {
    method: "DELETE",
    path: `/repos/${encodeURIComponent(org)}/${PM_REPO_NAME}/issues/${issueNumber}/labels/${label.id}`,
    token: session.token,
  });
}

export function issueHasConflict(issue: DcsIssue, namespaceId: string = DEFAULT_PM_NAMESPACE): boolean {
  const name = pmFacetLabel("estado", "conflicto", namespaceId);
  return (issue.labels ?? []).some((label) => label.name === name);
}

/**
 * Closed subtareas assigned to me that still carry the conflict label.
 * `labels=` in the search drops unknown labels, so filter in the client.
 */
/** My subtareas closed in the last `days` days (newest first): «Terminadas» in Mis tareas. */
export async function listMyClosedIssues(session: GtSession, org: string, days = 7, now: Date = new Date()): Promise<DcsIssue[]> {
  const pmConfig = await loadPmConfig(session, org);
  const closed = await searchPmIssues(session, org, {
    assigned: true,
    state: "closed",
    maxPages: 2,
    namespaceId: pmConfig.namespaceId,
  });
  return closedWithin(closed, days, now);
}

/** Closed within the last `days` days, newest first. */
export function closedWithin(issues: DcsIssue[], days: number, now: Date): DcsIssue[] {
  const since = now.getTime() - days * 86_400_000;
  return issues
    .filter((issue) => {
      const at = Date.parse(issue.closed_at ?? issue.updated_at ?? "");
      return Number.isFinite(at) && at >= since;
    })
    .sort((a, b) => Date.parse(b.closed_at ?? b.updated_at ?? "") - Date.parse(a.closed_at ?? a.updated_at ?? ""));
}

export async function listMyConflictIssues(session: GtSession, org: string): Promise<DcsIssue[]> {
  const pmConfig = await loadPmConfig(session, org);
  const closed = await searchPmIssues(session, org, {
    assigned: true,
    state: "closed",
    maxPages: 2,
    namespaceId: pmConfig.namespaceId,
  });
  return closed.filter((issue) => issueHasConflict(issue, pmConfig.namespaceId));
}

function ensureEnCursoInBody(body: string | undefined): string {
  const text = body || "";
  if (text.includes("<!-- gt:en-curso -->")) return text;
  return `<!-- gt:en-curso -->\n${text}`;
}

export function issueIsInProgress(
  issue: DcsIssue,
  namespaceId: string = DEFAULT_PM_NAMESPACE,
): boolean {
  const names = (issue.labels ?? []).map((l) => l.name);
  if (names.includes(pmFacetLabel("estado", "en-curso", namespaceId))) return true;
  // Legacy un-namespaced label from earlier builds
  if (names.includes("en-curso")) return true;
  return Boolean(issue.body?.includes("<!-- gt:en-curso -->"));
}

export { parsePmFacetValue, isPmLabel, pmRootLabel, pmFacetLabel };

export async function closeIssue(
  session: GtSession,
  org: string,
  issueNumber: number,
): Promise<DcsIssue> {
  return editIssue(dcsConfig(session.host), org, PM_REPO_NAME, issueNumber, {
    token: session.token,
    state: "closed",
  });
}

export async function commentOnIssue(
  session: GtSession,
  org: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  await createIssueComment(
    dcsConfig(session.host),
    org,
    PM_REPO_NAME,
    issueNumber,
    body,
    session.token,
  );
}

/** Persist checklist progress on the issue body (`gateway-task-progress` marker). */
export async function setIssueTaskProgress(
  session: GtSession,
  org: string,
  issue: DcsIssue,
  markerOrIds: TaskProgressMarker | string[],
): Promise<DcsIssue> {
  const body = upsertTaskProgressInBody(issue.body, markerOrIds);
  return editIssue(dcsConfig(session.host), org, PM_REPO_NAME, issue.number, {
    token: session.token,
    body,
  });
}
