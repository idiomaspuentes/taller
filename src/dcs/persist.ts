import {
  createOrUpdateContents,
  createOrgRepo,
  getContents,
  getRawContent,
  getRepo,
  getUserOrgs,
  listOrgMembers,
  listOrgRepos,
  type DcsOrg,
  type DcsOrgMember,
  type DcsRepo,
} from "@ip-lms/dcs-client";
import type { AssignmentsDoc, InventoryDoc, Person, Team, TeamPreset } from "../domain/types";
import {
  ASSIGNMENTS_SCHEMA,
  PM_REPO_NAME,
} from "../domain/types";
import {
  assignmentsPath,
  inventoryPath,
  normalizeAssignmentsDoc,
  normalizeInventory,
  normalizeTeamPresets,
  isInventoryDoc,
  teamPresetsPath,
  teamsPath,
  toExportDoc,
} from "../domain/store";
import { dcsConfig } from "./config";
import type { GtSession } from "./auth";

export async function listUserOrgs(session: GtSession): Promise<DcsOrg[]> {
  return getUserOrgs(dcsConfig(session.host), session.token);
}

type OrgMemberRow = DcsOrgMember & { full_name?: string; username?: string };

/** Map DCS org members to people. Id is the DCS username (stable). Tokens are not stored. */
export async function listPmOrgMembers(session: GtSession, org: string): Promise<Person[]> {
  const members = await listOrgMembers(dcsConfig(session.host), org, session.token);
  const people: Person[] = [];
  const seen = new Set<string>();
  for (const row of members as OrgMemberRow[]) {
    const username = String(row.login || row.username || "").trim();
    if (!username || seen.has(username.toLocaleLowerCase("es"))) continue;
    seen.add(username.toLocaleLowerCase("es"));
    const fullName = String(row.full_name ?? "").trim();
    people.push({ id: username, name: fullName || username });
  }
  return people;
}

export async function ensurePmRepo(session: GtSession, org: string): Promise<DcsRepo> {
  const config = dcsConfig(session.host);
  try {
    return await getRepo(config, org, PM_REPO_NAME, session.token);
  } catch {
    return createOrgRepo(config, org, {
      name: PM_REPO_NAME,
      description: "Asignaciones de Preparación (Gateway Tasks)",
      private: false,
      auto_init: true,
      token: session.token,
    });
  }
}

export async function listPmBooks(
  session: GtSession,
  org: string,
  lang: string,
): Promise<string[]> {
  const config = dcsConfig(session.host);
  try {
    const contents = await getContents(config, org, PM_REPO_NAME, lang.toLowerCase(), {
      token: session.token,
    });
    if (!Array.isArray(contents)) return [];
    return contents
      .filter((row) => row.type === "dir")
      .map((row) => row.name.toUpperCase())
      .sort();
  } catch {
    return [];
  }
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
    const parsed = JSON.parse(raw) as { people?: unknown; teams?: unknown };
    const doc = normalizeAssignmentsDoc(
      { people: parsed.people, teams: parsed.teams },
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
    return normalizeAssignmentsDoc(JSON.parse(raw), {
      book,
      lang,
      contentOrg,
      pmOrg: org,
    });
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

  const exportDoc = toExportDoc({
    ...assignments,
    schema: ASSIGNMENTS_SCHEMA,
    book: book.toUpperCase(),
    lang,
    pmOrg: org,
  });

  await writeJsonFile(
    session,
    org,
    teamsPath(lang),
    { people: exportDoc.people, teams: exportDoc.teams, updated_at: exportDoc.exported_at },
    `Actualizar equipos (${lang})`,
  );
  await writeJsonFile(
    session,
    org,
    assignmentsPath(lang, book),
    exportDoc,
    `Asignaciones ${book} (${lang})`,
  );
  if (inventory) {
    await writeJsonFile(
      session,
      org,
      inventoryPath(lang, book),
      inventory,
      `Inventario ${book} (${lang})`,
    );
  }
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

export async function orgHasPmRepo(session: GtSession, org: string): Promise<boolean> {
  const repos = await listOrgRepos(dcsConfig(session.host), org, {
    token: session.token,
    limit: 50,
  });
  return repos.some((r) => r.name === PM_REPO_NAME);
}
