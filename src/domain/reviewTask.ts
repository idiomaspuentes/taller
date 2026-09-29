/**
 * Revisión puntual: after a phase already translated a portion, a gestor
 * creates ONE review task for a verse or a range (`NEH 1:2`, `NEH 1:1-3`)
 * and assigns it to someone who may edit that resource in DCS (see
 * `reviewCandidatesFromOrgTeams`). Pure: the DCS writer is
 * `createReviewIssues` in `dcs/issues.ts`.
 */

import type { AssignmentsDoc, InventoryDoc, Person, ProjectTask, ScopeKey } from "./types";
import { isScriptureResource, SCOPE_LABEL } from "./types";
import { parseRefRange, type RefRange } from "./usfmEdit";
import { portionKey } from "./chapters";
import { DEFAULT_PM_CONFIG, reposForTask, teamHasReposForTask, type PmConfig } from "./roles";
import type { WorkOrder } from "./workOrder";

export const REVIEW_CREATE_ACTION = "Crear la revisión";

export type ReviewScope =
  | { ok: true; book: string; range: RefRange; label: string; display: string }
  | { ok: false; reason: string };

/** `1:2` or `1:1–3` (same dash as portion titles). */
export function reviewRangeLabel(range: RefRange): string {
  return range.to > range.from
    ? `${range.chapter}:${range.from}–${range.to}`
    : `${range.chapter}:${range.from}`;
}

/**
 * Read the verse or range a gestor typed. Accepts `NEH 1:2`, `NEH 1:1-3`,
 * `1:2` (single-book project) and the portion title form `NEH 1:2 · TPL`.
 */
export function parseReviewRef(ref: string | undefined, projectBooks: string[]): ReviewScope {
  const text = (ref ?? "").trim();
  if (!text) {
    return { ok: false, reason: "Escribe el versículo o el rango que se revisa, por ejemplo NEH 1:2." };
  }
  const books = projectBooks.map((b) => b.trim().toUpperCase()).filter(Boolean);
  const lead = text.match(/^([A-Z0-9]{3})\s+/i);
  let book = "";
  if (lead) {
    book = lead[1]!.toUpperCase();
    if (books.length && !books.includes(book)) {
      return { ok: false, reason: `${book} no es un libro de este proyecto.` };
    }
  } else if (books.length === 1) {
    book = books[0]!;
  } else {
    return { ok: false, reason: "Indica el libro, por ejemplo NEH 1:2." };
  }
  const range = parseRefRange(text);
  if (!range) {
    return {
      ok: false,
      reason: "Escribe un versículo (NEH 1:2) o un rango dentro de un capítulo (NEH 1:1-3).",
    };
  }
  const label = reviewRangeLabel(range);
  return { ok: true, book, range, label, display: `${book} ${label}` };
}

/** A revisión with its own verse range (not the whole inventory portion). */
export function isScopedReview(task: Pick<ProjectTask, "reviewsPrincipal" | "reviewRef">): boolean {
  return Boolean(task.reviewsPrincipal && task.reviewRef?.trim());
}

/** Scripture resources (TPL / TPS) the review edits. */
export function reviewResources(task: Pick<ProjectTask, "scope" | "rules">): ScopeKey[] {
  const fromRules = (task.rules ?? []).map((r) => r.resource);
  const all = fromRules.length ? fromRules : task.scope ?? [];
  return [...new Set(all.filter(isScriptureResource))];
}

function reviewOrderKey(book: string, taskId: string, resource: ScopeKey, range: RefRange): string {
  return `${book}|${taskId}|${resource}|revision:${range.chapter}:${range.from}-${range.to}`;
}

/**
 * The review's own subtareas: one per scripture resource, titled with the
 * typed range only (`NEH 1:2 · TPL`), assigned to `reviewAssigneeId`.
 * Keys depend on the task and the range, never on the inventory.
 */
export function reviewWorkOrders(
  board: Pick<AssignmentsDoc, "books" | "book" | "people">,
  task: ProjectTask,
  inventory?: Pick<InventoryDoc, "portions"> | null,
): { orders: WorkOrder[]; reason: string | null } {
  const projectBooks = board.books?.length ? board.books : [board.book];
  const scope = parseReviewRef(task.reviewRef, projectBooks);
  if (!scope.ok) return { orders: [], reason: scope.reason };
  const resources = reviewResources(task);
  if (!resources.length) {
    return { orders: [], reason: "Esta revisión no tiene TPL ni TPS. Añade el recurso en Alcance." };
  }
  const { book, range } = scope;
  const portionIds = (inventory?.portions ?? [])
    .filter((p) => {
      if (p.book && p.book.toUpperCase() !== book) return false;
      if (p.chapter !== range.chapter) return false;
      return p.verses.some((v) => v >= range.from && v <= range.to);
    })
    .map(portionKey);
  const assigneeId = task.reviewAssigneeId?.trim();
  const person = assigneeId ? board.people.find((p) => p.id === assigneeId) : undefined;
  const assignee = assigneeId ? { personId: assigneeId, person: person?.name || assigneeId } : undefined;
  const itemId = `porcion:${range.chapter}:${range.from}-${range.to}`;
  const orders = resources.map<WorkOrder>((resource) => ({
    key: reviewOrderKey(book, task.id, resource, range),
    teamId: task.id,
    teamName: task.name,
    book,
    resource,
    chapter: range.chapter,
    portionIds,
    itemIds: [itemId],
    itemTypes: ["porcion"],
    assignee,
    label: `${scope.label} · ${SCOPE_LABEL[resource]}`,
  }));
  return { orders, reason: null };
}

export type ReviewCandidate = {
  person: Person;
  /** Tasks (any phase) through which this person may edit the resource. */
  via: Array<{ taskId: string; taskName: string; phaseName: string }>;
  /** Org teams (display names) that give this person write access to the resource. */
  teams?: string[];
};

/** One DCS org team as the review list needs it: its repos and its members. */
export type OrgTeamAccess = {
  teamName: string;
  repoNames: string[];
  members: Person[];
};

/**
 * Everyone who may edit the review's resource in DCS: members of any org team
 * whose repos cover every repo the review needs. Same rule as linking an org
 * team to a task (`teamHasReposForTask`), so being an integrante of a task is
 * not required, and a team with only the notes repo never qualifies for TPL.
 */
export function reviewCandidatesFromOrgTeams(
  board: Pick<AssignmentsDoc, "people" | "lang">,
  task: ProjectTask,
  orgTeams: OrgTeamAccess[],
  pmConfig: PmConfig = DEFAULT_PM_CONFIG,
): ReviewCandidate[] {
  const resources = reviewResources(task);
  if (!resources.length) return [];
  const need = { scope: resources };
  const peopleById = new Map(board.people.map((p) => [p.id.toLowerCase(), p]));
  const byId = new Map<string, ReviewCandidate>();
  for (const team of orgTeams) {
    if (!teamHasReposForTask(team.repoNames, need, board.lang, pmConfig).ok) continue;
    for (const member of team.members) {
      const key = member.id.toLowerCase();
      const person = peopleById.get(key) ?? member;
      const row = byId.get(key) ?? { person, via: [], teams: [] };
      if (!row.teams!.includes(team.teamName)) row.teams!.push(team.teamName);
      byId.set(key, row);
    }
  }
  return [...byId.values()].sort((a, b) => a.person.name.localeCompare(b.person.name, "es"));
}

export type ReviewCandidatesResult = {
  candidates: ReviewCandidate[];
  /**
   * `permisos`: who may edit the resource in DCS.
   * `integrantes`: DCS could not be read; people already on the project's tasks.
   */
  source: "permisos" | "integrantes";
};

/**
 * «Quién revisa»: write access from DCS when `orgTeams` was read; otherwise
 * (`null`) the integrantes of tasks that cover the resource.
 */
export function resolveReviewCandidates(
  board: Pick<AssignmentsDoc, "people" | "teams" | "phases" | "lang">,
  task: ProjectTask,
  orgTeams: OrgTeamAccess[] | null,
  pmConfig: PmConfig = DEFAULT_PM_CONFIG,
): ReviewCandidatesResult {
  if (orgTeams) {
    return { candidates: reviewCandidatesFromOrgTeams(board, task, orgTeams, pmConfig), source: "permisos" };
  }
  return { candidates: reviewAssigneeCandidates(board, task, pmConfig), source: "integrantes" };
}

export const REVIEW_CANDIDATES_FALLBACK_NOTE =
  "No se pudieron leer los permisos de Door43. Se muestran las personas que ya están en las tareas del proyecto.";

/**
 * Fallback when DCS permissions cannot be read: everyone who may already edit
 * the review's resource on some task of this project, any phase. Same rule as linking an org team to a task
 * (`teamHasReposForTask`): a task grants the resource when its repos cover
 * every repo the review needs.
 */
export function reviewAssigneeCandidates(
  board: Pick<AssignmentsDoc, "people" | "teams" | "phases" | "lang">,
  task: ProjectTask,
  pmConfig: PmConfig = DEFAULT_PM_CONFIG,
): ReviewCandidate[] {
  const resources = reviewResources(task);
  if (!resources.length) return [];
  const need = { scope: resources };
  const phaseName = new Map(board.phases.map((p) => [p.id, p.name]));
  const peopleById = new Map(board.people.map((p) => [p.id, p]));
  const byId = new Map<string, ReviewCandidate>();
  for (const other of board.teams) {
    const repos = reposForTask(other, board.lang, pmConfig);
    if (!teamHasReposForTask(repos, need, board.lang, pmConfig).ok) continue;
    for (const id of other.memberIds) {
      const person = peopleById.get(id) ?? { id, name: id };
      const row = byId.get(id) ?? { person, via: [] };
      row.via.push({
        taskId: other.id,
        taskName: other.name,
        phaseName: phaseName.get(other.phaseId) ?? "",
      });
      byId.set(id, row);
    }
  }
  return [...byId.values()].sort((a, b) => a.person.name.localeCompare(b.person.name, "es"));
}
