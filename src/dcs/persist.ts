import { rememberBoard } from "./notices";
import {
  createOrUpdateContents,
  createOrgRepo,
  createTeam,
  editTeam,
  getContents,
  getRawContent,
  getRepo,
  getOrg,
  getUserOrgs,
  listOrgMembers,
  listOrgRepos,
  listOrgTeams,
  listTeamMembers,
  addTeamMember,
  removeTeamMember,
  type DcsOrg,
  type DcsOrgMember,
  type DcsRepo,
  type DcsTeam,
} from "@ip-lms/dcs-client";
import type {
  AssignmentsDoc,
  InventoryDoc,
  Person,
  ProjectIndexEntry,
  Team,
  TeamPreset,
  WorkflowsCatalog,
} from "../domain/types";
import {
  ASSIGNMENTS_SCHEMA,
  PM_REPO_NAME,
} from "../domain/types";
import {
  assignmentsPath,
  inventoryPath,
  mergeInventories,
  normalizeAssignmentsDoc,
  normalizeInventory,
  normalizeProjectsIndex,
  normalizeTeamPresets,
  normalizeWorkflowsCatalog,
  isInventoryDoc,
  projectsIndexPath,
  resolveProjectMeta,
  teamPresetsPath,
  teamsPath,
  toExportDoc,
  workflowsPath,
} from "../domain/store";
import { normalizeProjectId } from "../domain/books";
import { dcsConfig } from "./config";
import type { GtSession } from "./auth";

export type { DcsTeam };

export async function listUserOrgs(session: GtSession): Promise<DcsOrg[]> {
  return getUserOrgs(dcsConfig(session.host), session.token);
}

/** GET /orgs/{org} — public orgs work without a token. */
export async function fetchOrg(host: string, org: string, token?: string): Promise<DcsOrg> {
  return getOrg(dcsConfig(host), org, token);
}

type OrgMemberRow = DcsOrgMember & { full_name?: string; username?: string };

function personFromOrgMember(row: OrgMemberRow): Person | null {
  const username = String(row.login || row.username || "").trim();
  if (!username) return null;
  const fullName = String(row.full_name ?? "").trim();
  return { id: username, name: fullName || username };
}

/** Map DCS org members to people. Id is the DCS username (stable). Tokens are not stored. */
export async function listPmOrgMembers(session: GtSession, org: string): Promise<Person[]> {
  const members = await listOrgMembers(dcsConfig(session.host), org, session.token);
  const people: Person[] = [];
  const seen = new Set<string>();
  for (const row of members as OrgMemberRow[]) {
    const person = personFromOrgMember(row);
    if (!person || seen.has(person.id.toLocaleLowerCase("es"))) continue;
    seen.add(person.id.toLocaleLowerCase("es"));
    people.push(person);
  }
  return people;
}

/** DCS organization teams (permission groups) — not gateway-tasks assignment teams. */
export async function listPmOrgTeams(session: GtSession, org: string): Promise<DcsTeam[]> {
  const teams = await listOrgTeams(dcsConfig(session.host), org, session.token);
  return [...teams].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export async function createPmOrgTeam(
  session: GtSession,
  org: string,
  name: string,
  description = "",
): Promise<DcsTeam> {
  return createTeam(dcsConfig(session.host), org, {
    name: name.trim(),
    description: description.trim() || undefined,
    // The team exists to do work: it may edit (and open reviews on) the repositories it is given, and only those.
    permission: "write",
    units: EDIT_UNITS,
    unitsMap: Object.fromEntries(EDIT_UNITS.map((unit) => [unit, "write"])),
    canCreateOrgRepo: false,
    includesAllRepositories: false,
    token: session.token,
  });
}

/** The units a working team needs to write to: the text, the subtareas and the reviews. */
const EDIT_UNITS = ["repo.code", "repo.issues", "repo.pulls"];

/** Whether a team may edit the repositories it is given. The server says it per unit; older ones in `permission`. */
export function teamCanEdit(team: Pick<DcsTeam, "permission" | "units_map">): boolean {
  const code = team.units_map?.["repo.code"] ?? team.permission;
  return code === "write" || code === "admin" || code === "owner";
}

/** Let a team edit the repositories it is given (and only those). What else it could already do is kept. */
export async function allowPmOrgTeamToEdit(session: GtSession, team: Pick<DcsTeam, "id" | "name" | "description" | "units_map">): Promise<DcsTeam> {
  const unitsMap = { ...team.units_map, ...Object.fromEntries(EDIT_UNITS.map((unit) => [unit, "write"])) };
  return editTeam(dcsConfig(session.host), team.id, { token: session.token, name: team.name, description: team.description, unitsMap });
}

export async function listPmOrgTeamMembers(
  session: GtSession,
  teamId: number,
): Promise<Person[]> {
  const members = await listTeamMembers(dcsConfig(session.host), teamId, session.token);
  const people: Person[] = [];
  const seen = new Set<string>();
  for (const row of members) {
    const person = personFromOrgMember(row as OrgMemberRow);
    if (!person || seen.has(person.id.toLocaleLowerCase("es"))) continue;
    seen.add(person.id.toLocaleLowerCase("es"));
    people.push(person);
  }
  return people;
}

export async function addPmOrgTeamMember(
  session: GtSession,
  teamId: number,
  username: string,
): Promise<void> {
  await addTeamMember(dcsConfig(session.host), teamId, username, session.token);
}

export async function removePmOrgTeamMember(
  session: GtSession,
  teamId: number,
  username: string,
): Promise<void> {
  await removeTeamMember(dcsConfig(session.host), teamId, username, session.token);
}

/** Add usernames to `toTeamId`; if `fromTeamId` is set, remove them from that team first (move). */
export async function placePmOrgTeamMembers(
  session: GtSession,
  usernames: string[],
  toTeamId: number,
  fromTeamId?: number,
): Promise<{ ok: string[]; failed: { username: string; error: string }[] }> {
  const ok: string[] = [];
  const failed: { username: string; error: string }[] = [];
  for (const username of usernames) {
    try {
      if (fromTeamId != null && fromTeamId !== toTeamId) {
        await removePmOrgTeamMember(session, fromTeamId, username);
      }
      await addPmOrgTeamMember(session, toTeamId, username);
      ok.push(username);
    } catch (err) {
      failed.push({
        username,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { ok, failed };
}

export async function ensurePmRepo(session: GtSession, org: string): Promise<DcsRepo> {
  const config = dcsConfig(session.host);
  try {
    return await getRepo(config, org, PM_REPO_NAME, session.token);
  } catch {
    return createOrgRepo(config, org, {
      name: PM_REPO_NAME,
      description: "Translation Assistance System (TAS) — asignaciones de preparación",
      private: false,
      auto_init: true,
      token: session.token,
    });
  }
}

export async function listPmProjects(
  session: GtSession,
  org: string,
  lang: string,
): Promise<ProjectIndexEntry[]> {
  const config = dcsConfig(session.host);
  try {
    const raw = await getRawContent(config, org, PM_REPO_NAME, projectsIndexPath(lang), {
      token: session.token,
    });
    const parsed = JSON.parse(raw) as { projects?: unknown } | unknown[];
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && "projects" in parsed
        ? (parsed as { projects: unknown }).projects
        : [];
    const indexed = normalizeProjectsIndex(list);
    if (indexed.length) return indexed;
  } catch {
    /* fall through to directory scan */
  }
  try {
    const contents = await getContents(config, org, PM_REPO_NAME, lang.toLowerCase(), {
      token: session.token,
    });
    if (!Array.isArray(contents)) return [];
    return contents
      .filter((row) => row.type === "dir")
      .map((row) => resolveProjectMeta({ projectId: normalizeProjectId(row.name) }))
      .map((meta) => ({
        projectId: meta.projectId,
        title: meta.title,
        kind: meta.kind,
        books: meta.books,
      }))
      .sort((a, b) => a.title.localeCompare(b.title, "es"));
  } catch {
    return [];
  }
}

/** @deprecated Prefer {@link listPmProjects}. */
export async function listPmBooks(
  session: GtSession,
  org: string,
  lang: string,
): Promise<string[]> {
  const projects = await listPmProjects(session, org, lang);
  return projects.map((p) => p.projectId);
}

export async function loadProjectsIndexFromDcs(
  session: GtSession,
  org: string,
  lang: string,
): Promise<ProjectIndexEntry[]> {
  return listPmProjects(session, org, lang);
}

export async function saveProjectsIndexToDcs(
  session: GtSession,
  org: string,
  lang: string,
  entries: ProjectIndexEntry[],
): Promise<void> {
  await ensurePmRepo(session, org);
  await writeJsonFile(
    session,
    org,
    projectsIndexPath(lang),
    { projects: entries, updated_at: new Date().toISOString() },
    `Índice de proyectos (${lang})`,
  );
}

export async function loadTeamsFromDcs(
  session: GtSession,
  org: string,
  lang: string,
): Promise<{ people: Person[]; teams: Team[] } | null> {
  const config = dcsConfig(session.host);
  try {
    const raw = await getRawContent(config, org, PM_REPO_NAME, teamsPath(lang), {
      token: session.token,
    });
    const parsed = JSON.parse(raw) as { people?: unknown; teams?: unknown; tasks?: unknown };
    const doc = normalizeAssignmentsDoc(
      { people: parsed.people, teams: parsed.teams, tasks: parsed.tasks },
      { book: "TMP", lang, contentOrg: "", pmOrg: org },
    );
    return { people: doc.people, teams: doc.teams };
  } catch {
    return null;
  }
}

export async function loadAssignmentsFromDcs(
  session: GtSession,
  org: string,
  lang: string,
  book: string,
  contentOrg: string,
): Promise<AssignmentsDoc | null> {
  const config = dcsConfig(session.host);
  try {
    const raw = await getRawContent(
      config,
      org,
      PM_REPO_NAME,
      assignmentsPath(lang, book),
      { token: session.token },
    );
    const board = normalizeAssignmentsDoc(JSON.parse(raw), {
      book,
      lang,
      contentOrg,
      pmOrg: org,
    });
    rememberBoard(session, org, board);
    return board;
  } catch {
    return null;
  }
}

export async function loadInventoryFromDcs(
  session: GtSession,
  org: string,
  lang: string,
  book: string,
): Promise<InventoryDoc | null> {
  const config = dcsConfig(session.host);
  try {
    const raw = await getRawContent(
      config,
      org,
      PM_REPO_NAME,
      inventoryPath(lang, book),
      { token: session.token },
    );
    const parsed: unknown = JSON.parse(raw);
    if (!isInventoryDoc(parsed)) return null;
    return normalizeInventory(parsed);
  } catch {
    return null;
  }
}

async function writeJsonFile(
  session: GtSession,
  org: string,
  filepath: string,
  data: unknown,
  message: string,
): Promise<void> {
  const config = dcsConfig(session.host);
  let sha: string | undefined;
  try {
    const existing = await getContents(config, org, PM_REPO_NAME, filepath, {
      token: session.token,
    });
    if (!Array.isArray(existing) && existing.sha) sha = existing.sha;
  } catch {
    sha = undefined;
  }
  const content = `${JSON.stringify(data, null, 2)}\n`;
  await createOrUpdateContents(config, org, PM_REPO_NAME, filepath, {
    content,
    message,
    sha,
    token: session.token,
  });
}

export async function saveProjectToDcs(params: {
  session: GtSession;
  org: string;
  lang: string;
  book: string;
  assignments: AssignmentsDoc;
  inventory: InventoryDoc | null;
}): Promise<void> {
  const { session, org, lang, book, assignments, inventory } = params;
  await ensurePmRepo(session, org);

  const meta = resolveProjectMeta({
    projectId: assignments.projectId || book,
    book: assignments.book || book,
    title: assignments.title,
    kind: assignments.kind,
    books: assignments.books,
  });
  const exportDoc = toExportDoc({
    ...assignments,
    schema: ASSIGNMENTS_SCHEMA,
    projectId: meta.projectId,
    book: meta.projectId,
    title: meta.title,
    kind: meta.kind,
    books: meta.books,
    lang,
    pmOrg: org,
  });

  await writeJsonFile(
    session,
    org,
    teamsPath(lang),
    {
      people: exportDoc.people,
      tasks: exportDoc.tasks,
      updated_at: exportDoc.exported_at,
    },
    `Actualizar tareas (${lang})`,
  );
  await writeJsonFile(
    session,
    org,
    assignmentsPath(lang, meta.projectId),
    exportDoc,
    `Asignaciones ${meta.projectId} (${lang})`,
  );

  const books = meta.books.length ? meta.books : [meta.projectId];
  if (inventory) {
    if (books.length <= 1) {
      const only = books[0] || inventory.book;
      await writeJsonFile(
        session,
        org,
        inventoryPath(lang, only),
        { ...inventory, book: only },
        `Inventario ${only} (${lang})`,
      );
    } else {
      for (const code of books) {
        const portions = inventory.portions.filter(
          (p) => (p.book || "").toUpperCase() === code.toUpperCase(),
        );
        if (!portions.length && inventory.book.toUpperCase() !== code.toUpperCase()) continue;
        const slice = normalizeInventory({
          ...inventory,
          book: code,
          portions: portions.length
            ? portions.map((p) => ({
                ...p,
                book: code,
                id: p.id.includes(":") ? p.id.split(":").slice(1).join(":") : p.id,
              }))
            : inventory.portions,
          articles: inventory.articles,
        });
        await writeJsonFile(
          session,
          org,
          inventoryPath(lang, code),
          slice,
          `Inventario ${code} (${lang})`,
        );
      }
    }
  }

  const indexEntry = {
    projectId: meta.projectId,
    title: meta.title,
    kind: meta.kind,
    books: meta.books,
    updated_at: exportDoc.exported_at,
  };
  let index = await listPmProjects(session, org, lang);
  index = index.filter((e) => e.projectId !== meta.projectId);
  index.push(indexEntry);
  index.sort((a, b) => a.title.localeCompare(b.title, "es"));
  await saveProjectsIndexToDcs(session, org, lang, index);
}

/** Load and merge inventories for each project book. */
export async function loadProjectInventoriesFromDcs(
  session: GtSession,
  org: string,
  lang: string,
  books: string[],
  projectLabel: string,
): Promise<InventoryDoc | null> {
  const docs: InventoryDoc[] = [];
  for (const code of books) {
    const inv = await loadInventoryFromDcs(session, org, lang, code);
    if (inv) docs.push(inv);
  }
  return mergeInventories(docs, projectLabel);
}

export async function loadTeamPresetsFromDcs(
  session: GtSession,
  org: string,
): Promise<TeamPreset[] | null> {
  const config = dcsConfig(session.host);
  try {
    const raw = await getRawContent(config, org, PM_REPO_NAME, teamPresetsPath(), {
      token: session.token,
    });
    const parsed = JSON.parse(raw) as { presets?: unknown };
    return normalizeTeamPresets(parsed.presets);
  } catch {
    return null;
  }
}

export async function saveTeamPresetsToDcs(
  session: GtSession,
  org: string,
  presets: TeamPreset[],
): Promise<void> {
  await ensurePmRepo(session, org);
  await writeJsonFile(
    session,
    org,
    teamPresetsPath(),
    { presets, updated_at: new Date().toISOString() },
    "Actualizar presets de equipos",
  );
}

export async function loadWorkflowsFromDcs(
  session: GtSession,
  org: string,
): Promise<WorkflowsCatalog | null> {
  const config = dcsConfig(session.host);
  try {
    const raw = await getRawContent(config, org, PM_REPO_NAME, workflowsPath(), {
      token: session.token,
    });
    return normalizeWorkflowsCatalog(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveWorkflowsToDcs(
  session: GtSession,
  org: string,
  catalog: WorkflowsCatalog,
): Promise<void> {
  await ensurePmRepo(session, org);
  const normalized = normalizeWorkflowsCatalog(catalog);
  await writeJsonFile(
    session,
    org,
    workflowsPath(),
    {
      schema: normalized.schema,
      workflows: normalized.workflows,
      updated_at: new Date().toISOString(),
    },
    "Actualizar plantillas de flujo",
  );
}

export async function orgHasPmRepo(session: GtSession, org: string): Promise<boolean> {
  const repos = await listOrgRepos(dcsConfig(session.host), org, {
    token: session.token,
    limit: 50,
  });
  return repos.some((r) => r.name === PM_REPO_NAME);
}
