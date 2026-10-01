import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getUserTeams,
  listOrgTeams,
  getTeam,
  createTeam,
  editTeam,
  addTeamRepo,
  removeTeamRepo,
  listTeamRepos,
  listTeamMembers,
  checkTeamMember,
  addTeamMember,
  removeTeamMember,
} from "./teams.js";
import type { DcsClientConfig } from "./config.js";

const config: DcsClientConfig = { host: "https://qa.door43.org" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const teamFixture = {
  id: 1,
  name: "lms-admins",
  description: "LMS admins",
  permission: "read" as const,
  organization: { id: 5, name: "idiomasPuentesLMS" },
};

describe("getUserTeams", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("GETs /user/teams with the token header and returns the parsed list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([teamFixture]));
    vi.stubGlobal("fetch", fetchMock);

    const teams = await getUserTeams(config, "tok");

    expect(teams).toEqual([teamFixture]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://qa.door43.org/api/v1/user/teams");
    expect((init.headers as Record<string, string>).Authorization).toBe("token tok");
  });

  it("returns an empty array when the user belongs to no teams", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getUserTeams(config, "tok")).toEqual([]);
  });
});

describe("listOrgTeams", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("GETs /orgs/{org}/teams — every team in the org, not just the caller's own", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([teamFixture]));
    vi.stubGlobal("fetch", fetchMock);

    const teams = await listOrgTeams(config, "idiomasPuentesLMS", "tok");

    expect(teams).toEqual([teamFixture]);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://qa.door43.org/api/v1/orgs/idiomasPuentesLMS/teams");
  });
});

describe("createTeam", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs /orgs/{org}/teams, scoped to no repos by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ...teamFixture, id: 7, permission: "admin" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const team = await createTeam(config, "idiomasPuentesLMS", {
      name: "lms-admins",
      permission: "admin",
      canCreateOrgRepo: true,
      token: "tok",
    });

    expect(team.id).toBe(7);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://qa.door43.org/api/v1/orgs/idiomasPuentesLMS/teams");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      name: "lms-admins",
      permission: "admin",
      can_create_org_repo: true,
      includes_all_repositories: false,
      units: ["repo.code"],
    });
  });

  it("accepts custom units including repo.issues", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(teamFixture, 201));
    vi.stubGlobal("fetch", fetchMock);
    await createTeam(config, "org", {
      name: "gt-alpha",
      permission: "write",
      units: ["repo.code", "repo.issues"],
      token: "tok",
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).units).toEqual(["repo.code", "repo.issues"]);
  });
});

describe("getTeam / editTeam", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("GETs /teams/{id}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(teamFixture));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getTeam(config, 1, "tok")).toEqual(teamFixture);
    expect(fetchMock.mock.calls[0][0]).toBe("https://qa.door43.org/api/v1/teams/1");
  });

  it("PATCHes /teams/{id}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ...teamFixture, permission: "write" }));
    vi.stubGlobal("fetch", fetchMock);
    await editTeam(config, 1, {
      token: "tok",
      name: "lms-admins",
      permission: "write",
      units: ["repo.code", "repo.issues"],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://qa.door43.org/api/v1/teams/1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toMatchObject({
      permission: "write",
      units: ["repo.code", "repo.issues"],
    });
  });
});

describe("addTeamRepo / removeTeamRepo / listTeamRepos", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("PUTs /teams/{id}/repos/{org}/{repo}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await addTeamRepo(config, 7, "idiomasPuentesLMS", "lms-progress", "tok");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://qa.door43.org/api/v1/teams/7/repos/idiomasPuentesLMS/lms-progress");
    expect(init.method).toBe("PUT");
  });

  it("DELETEs /teams/{id}/repos/{org}/{repo}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await removeTeamRepo(config, 7, "idiomasPuentesLMS", "lms-progress", "tok");
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });

  it("GETs /teams/{id}/repos", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ id: 1, name: "gateway-tasks" }]));
    vi.stubGlobal("fetch", fetchMock);
    const repos = await listTeamRepos(config, 7, "tok", { page: 1, limit: 50 });
    expect(repos[0].name).toBe("gateway-tasks");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/teams/7/repos?");
    expect(String(fetchMock.mock.calls[0][0])).toContain("limit=50");
  });
});

describe("listTeamMembers / checkTeamMember", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("GETs /teams/{id}/members", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ id: 9, login: "abelper8" }]));
    vi.stubGlobal("fetch", fetchMock);

    const members = await listTeamMembers(config, 1, "tok");

    expect(members).toEqual([{ id: 9, login: "abelper8" }]);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://qa.door43.org/api/v1/teams/1/members");
  });

  it("returns true when member exists and false on 404", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 9, login: "abelper8" }))
      .mockResolvedValueOnce(jsonResponse({ message: "not found" }, 404));
    vi.stubGlobal("fetch", fetchMock);

    expect(await checkTeamMember(config, 1, "abelper8", "tok")).toBe(true);
    expect(await checkTeamMember(config, 1, "missing", "tok")).toBe(false);
  });
});

describe("addTeamMember", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("PUTs /teams/{id}/members/{username}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await addTeamMember(config, 1, "nueva-persona", "tok");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://qa.door43.org/api/v1/teams/1/members/nueva-persona");
    expect(init.method).toBe("PUT");
  });

  it("surfaces a 403 as a DcsApiError when the caller isn't actually org-admin in DCS", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ message: "forbidden" }, 403)));
    await expect(addTeamMember(config, 1, "nueva-persona", "tok")).rejects.toMatchObject({ status: 403 });
  });
});

describe("removeTeamMember", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("DELETEs /teams/{id}/members/{username}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await removeTeamMember(config, 1, "alguien", "tok");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://qa.door43.org/api/v1/teams/1/members/alguien");
    expect(init.method).toBe("DELETE");
  });
});
