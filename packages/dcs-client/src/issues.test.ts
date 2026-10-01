import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listRepoIssues,
  searchIssues,
  createIssue,
  getIssue,
  editIssue,
  addIssueAssignees,
  removeIssueAssignees,
  listIssueComments,
  createIssueComment,
} from "./issues.js";
import type { DcsClientConfig } from "./config.js";

const config: DcsClientConfig = { host: "https://qa.door43.org" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const issueFixture = {
  id: 10,
  number: 3,
  title: "NEH 1:1-8 · TPL",
  body: "checklist",
  state: "open",
  assignee: { id: 1, login: "abelper8" },
  labels: [{ id: 2, name: "recurso:tpl" }],
  milestone: { id: 5, title: "NEH" },
};

describe("listRepoIssues", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("GETs /repos/{owner}/{repo}/issues with filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([issueFixture]));
    vi.stubGlobal("fetch", fetchMock);

    const issues = await listRepoIssues(config, "es-419_gl", "gateway-tasks", {
      token: "tok",
      state: "open",
      milestones: ["NEH"],
      labels: ["recurso:tpl", "equipo:alpha"],
    });

    expect(issues).toEqual([issueFixture]);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("https://qa.door43.org/api/v1/repos/es-419_gl/gateway-tasks/issues?");
    expect(String(url)).toContain("state=open");
    expect(String(url)).toContain("milestones=NEH");
    expect(String(url)).toContain("labels=recurso%3Atpl%2Cequipo%3Aalpha");
    expect(String(url)).toContain("type=issues");
  });
});

describe("searchIssues", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("GETs /repos/issues/search with assigned and owner", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([issueFixture]));
    vi.stubGlobal("fetch", fetchMock);

    await searchIssues(config, {
      token: "tok",
      assigned: true,
      owner: "es-419_gl",
      team: "gt-alpha",
      state: "open",
    });

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/repos/issues/search?");
    expect(String(url)).toContain("assigned=true");
    expect(String(url)).toContain("owner=es-419_gl");
    expect(String(url)).toContain("team=gt-alpha");
  });
});

describe("createIssue", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs /repos/{owner}/{repo}/issues", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(issueFixture, 201));
    vi.stubGlobal("fetch", fetchMock);

    const issue = await createIssue(config, "es-419_gl", "gateway-tasks", {
      token: "tok",
      title: "NEH 1:1-8 · TPL",
      body: "body",
      assignees: ["abelper8"],
      labels: [2, 3],
      milestone: 5,
    });

    expect(issue.number).toBe(3);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://qa.door43.org/api/v1/repos/es-419_gl/gateway-tasks/issues");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      title: "NEH 1:1-8 · TPL",
      assignees: ["abelper8"],
      labels: [2, 3],
      milestone: 5,
    });
  });
});

describe("getIssue / editIssue", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("GETs a single issue by index", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(issueFixture));
    vi.stubGlobal("fetch", fetchMock);
    await getIssue(config, "es-419_gl", "gateway-tasks", 3, "tok");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://qa.door43.org/api/v1/repos/es-419_gl/gateway-tasks/issues/3",
    );
  });

  it("PATCHes an issue", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ...issueFixture, state: "closed" }));
    vi.stubGlobal("fetch", fetchMock);
    await editIssue(config, "es-419_gl", "gateway-tasks", 3, {
      token: "tok",
      state: "closed",
      title: "done",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://qa.door43.org/api/v1/repos/es-419_gl/gateway-tasks/issues/3");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toMatchObject({ state: "closed", title: "done" });
  });
});

describe("assignees and comments", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs assignees", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(issueFixture));
    vi.stubGlobal("fetch", fetchMock);
    await addIssueAssignees(config, "es-419_gl", "gateway-tasks", 3, ["abelper8"], "tok");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/issues/3/assignees");
    expect(init.method).toBe("POST");
  });

  it("DELETEs assignees", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(issueFixture));
    vi.stubGlobal("fetch", fetchMock);
    await removeIssueAssignees(config, "es-419_gl", "gateway-tasks", 3, ["abelper8"], "tok");
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });

  it("lists and creates comments", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ id: 1, body: "hola" }]))
      .mockResolvedValueOnce(jsonResponse({ id: 2, body: "nuevo" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const comments = await listIssueComments(config, "es-419_gl", "gateway-tasks", 3, "tok");
    expect(comments[0].body).toBe("hola");

    await createIssueComment(config, "es-419_gl", "gateway-tasks", 3, "nuevo", "tok");
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ body: "nuevo" });
  });
});
