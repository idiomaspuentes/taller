import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createUserRepo,
  createOrgRepo,
  listOrgRepos,
  getUserOrgs,
  getOrg,
  createOrg,
  listOrgMembers,
  getRepo,
  forkRepo,
  mergeUpstreamRepo,
  setRepoTopics,
  searchReposByTopic,
} from "./repos.js";
import type { DcsClientConfig } from "./config.js";

const config: DcsClientConfig = { host: "https://qa.door43.org" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const repoFixture = {
  id: 1,
  name: "progreso-abel",
  full_name: "abel/progreso-abel",
  owner: { id: 1, login: "abel" },
  private: true,
  html_url: "https://qa.door43.org/abel/progreso-abel",
  default_branch: "main",
};

describe("createUserRepo", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs /user/repos with private defaulting to false and auto_init to true", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(repoFixture));
    vi.stubGlobal("fetch", fetchMock);

    await createUserRepo(config, { name: "progreso-abel", token: "tok" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://qa.door43.org/api/v1/user/repos");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ name: "progreso-abel", description: undefined, private: false, auto_init: true });
  });

  it("respects explicit private/auto_init overrides", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(repoFixture));
    vi.stubGlobal("fetch", fetchMock);

    await createUserRepo(config, { name: "x", private: true, auto_init: false, token: "tok" });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.private).toBe(true);
    expect(body.auto_init).toBe(false);
  });

  it("passes default_branch through when given, so raw-content URLs built from a fixed branch name don't depend on the server's own configured default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(repoFixture));
    vi.stubGlobal("fetch", fetchMock);

    await createUserRepo(config, { name: "x", auto_init: false, default_branch: "main", token: "tok" });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.default_branch).toBe("main");
  });
});

describe("createOrgRepo", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs /org/{org}/repos", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(repoFixture));
    vi.stubGlobal("fetch", fetchMock);

    await createOrgRepo(config, "idiomas-puentes", { name: "curso-1", token: "tok" });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://qa.door43.org/api/v1/org/idiomas-puentes/repos");
  });
});

describe("listOrgRepos", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("GETs /orgs/{org}/repos with pagination params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([repoFixture]));
    vi.stubGlobal("fetch", fetchMock);

    const repos = await listOrgRepos(config, "idiomas-puentes", { page: 2, limit: 10 });
    expect(repos).toEqual([repoFixture]);
    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(url as string);
    expect(parsed.pathname).toBe("/api/v1/orgs/idiomas-puentes/repos");
    expect(parsed.searchParams.get("page")).toBe("2");
    expect(parsed.searchParams.get("limit")).toBe("10");
  });
});

describe("org endpoints", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("getUserOrgs GETs /user/orgs with the token header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ id: 1, name: "idiomas-puentes" }]));
    vi.stubGlobal("fetch", fetchMock);
    const orgs = await getUserOrgs(config, "tok");
    expect(orgs[0].name).toBe("idiomas-puentes");
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe("token tok");
  });

  it("getOrg GETs /orgs/{org}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 1, name: "idiomas-puentes" }));
    vi.stubGlobal("fetch", fetchMock);
    await getOrg(config, "idiomas-puentes");
    expect(fetchMock.mock.calls[0][0]).toBe("https://qa.door43.org/api/v1/orgs/idiomas-puentes");
  });

  it("listOrgMembers GETs /orgs/{org}/members", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ id: 1, login: "abel" }]));
    vi.stubGlobal("fetch", fetchMock);
    const members = await listOrgMembers(config, "idiomas-puentes");
    expect(members[0].login).toBe("abel");
  });

  it("createOrg POSTs /orgs with the org name as `username` (CreateOrgOption's field, not `name`)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 9, name: "idiomasPuentesLMS" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const org = await createOrg(config, { name: "idiomasPuentesLMS", token: "tok" });

    expect(org.name).toBe("idiomasPuentesLMS");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://qa.door43.org/api/v1/orgs");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({ username: "idiomasPuentesLMS", visibility: "public" });
  });
});

describe("getRepo", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("GETs /repos/{owner}/{repo}", async () => {
    const forkFixture = { ...repoFixture, fork: true, parent: { ...repoFixture, full_name: "otraOrg/curso-externo" } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(forkFixture));
    vi.stubGlobal("fetch", fetchMock);

    const repo = await getRepo(config, "idiomas-puentes", "curso-externo", "tok");

    expect(fetchMock.mock.calls[0][0]).toBe("https://qa.door43.org/api/v1/repos/idiomas-puentes/curso-externo");
    expect(repo.parent?.full_name).toBe("otraOrg/curso-externo");
  });
});

describe("forkRepo", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs /repos/{owner}/{repo}/forks with the target org", async () => {
    const forkFixture = {
      ...repoFixture,
      name: "curso-externo",
      full_name: "idiomas-puentes/curso-externo",
      fork: true,
      parent: { ...repoFixture, full_name: "otraOrg/curso-externo" },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(forkFixture, 202));
    vi.stubGlobal("fetch", fetchMock);

    const result = await forkRepo(config, "otraOrg", "curso-externo", { organization: "idiomas-puentes", token: "tok" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://qa.door43.org/api/v1/repos/otraOrg/curso-externo/forks");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ organization: "idiomas-puentes", name: undefined });
    expect(result.full_name).toBe("idiomas-puentes/curso-externo");
    expect(result.parent?.full_name).toBe("otraOrg/curso-externo");
  });
});

describe("mergeUpstreamRepo", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs /repos/{owner}/{repo}/merge-upstream and maps merge_type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ merge_type: "fast-forward" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await mergeUpstreamRepo(config, "idiomas-puentes", "curso-externo", { token: "tok" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://qa.door43.org/api/v1/repos/idiomas-puentes/curso-externo/merge-upstream");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ branch: undefined, ff_only: undefined });
    expect(result).toEqual({ mergeType: "fast-forward" });
  });

  it("passes branch and ffOnly through", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ merge_type: "merge" }));
    vi.stubGlobal("fetch", fetchMock);

    await mergeUpstreamRepo(config, "idiomas-puentes", "curso-externo", { branch: "main", ffOnly: true, token: "tok" });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ branch: "main", ff_only: true });
  });
});

describe("setRepoTopics", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("PUTs /repos/{owner}/{repo}/topics with the full replacement list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await setRepoTopics(config, "idiomasPuentesLMS", "prt-es-419", ["lms-course"], "tok");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://qa.door43.org/api/v1/repos/idiomasPuentesLMS/prt-es-419/topics");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ topics: ["lms-course"] });
  });
});

describe("searchReposByTopic", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("GETs /repos/search with topic (not /catalog/search — this LMS's course.json isn't RC-manifest content)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: [repoFixture] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchReposByTopic(config, { topic: "lms-course", owner: "idiomasPuentesLMS" });

    expect(result.data).toEqual([repoFixture]);
    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(url as string);
    expect(parsed.pathname).toBe("/api/v1/repos/search");
    expect(parsed.searchParams.getAll("topic")).toEqual(["lms-course"]);
    expect(parsed.searchParams.get("owner")).toBe("idiomasPuentesLMS");
  });

  it("ORs multiple topics", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await searchReposByTopic(config, { topic: ["lms-course", "lms-course-es"] });

    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(url as string);
    expect(parsed.searchParams.getAll("topic")).toEqual(["lms-course", "lms-course-es"]);
  });
});
