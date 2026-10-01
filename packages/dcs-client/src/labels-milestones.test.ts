import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listLabels, createLabel, editLabel } from "./labels.js";
import { listMilestones, createMilestone, editMilestone } from "./milestones.js";
import { getNewNotificationCount } from "./notifications.js";
import type { DcsClientConfig } from "./config.js";

const config: DcsClientConfig = { host: "https://qa.door43.org" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("labels", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("lists labels", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ id: 1, name: "recurso:tpl", color: "ededed" }]));
    vi.stubGlobal("fetch", fetchMock);
    const labels = await listLabels(config, "org", "repo", { token: "tok" });
    expect(labels[0].name).toBe("recurso:tpl");
    expect(fetchMock.mock.calls[0][0]).toBe("https://qa.door43.org/api/v1/repos/org/repo/labels");
  });

  it("creates a label stripping leading # from color", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 2, name: "cap:1", color: "ff0000" }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await createLabel(config, "org", "repo", { token: "tok", name: "cap:1", color: "#ff0000" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({
      name: "cap:1",
      color: "ff0000",
    });
  });

  it("edits a label", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 2, name: "cap:2", color: "00ff00" }));
    vi.stubGlobal("fetch", fetchMock);
    await editLabel(config, "org", "repo", 2, { token: "tok", name: "cap:2" });
    expect(fetchMock.mock.calls[0][1].method).toBe("PATCH");
  });
});

describe("milestones", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("lists milestones", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ id: 5, title: "NEH" }]));
    vi.stubGlobal("fetch", fetchMock);
    const ms = await listMilestones(config, "org", "repo", { token: "tok", state: "open", name: "NEH" });
    expect(ms[0].title).toBe("NEH");
    expect(String(fetchMock.mock.calls[0][0])).toContain("state=open");
    expect(String(fetchMock.mock.calls[0][0])).toContain("name=NEH");
  });

  it("creates and edits milestones", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 5, title: "NEH" }, 201))
      .mockResolvedValueOnce(jsonResponse({ id: 5, title: "NEH", state: "closed" }));
    vi.stubGlobal("fetch", fetchMock);

    await createMilestone(config, "org", "repo", { token: "tok", title: "NEH", description: "Nehemías" });
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");

    await editMilestone(config, "org", "repo", 5, { token: "tok", state: "closed" });
    expect(fetchMock.mock.calls[1][1].method).toBe("PATCH");
  });
});

describe("notifications", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("GETs /notifications/new", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ new: 4 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getNewNotificationCount(config, "tok")).toEqual({ new: 4 });
    expect(fetchMock.mock.calls[0][0]).toBe("https://qa.door43.org/api/v1/notifications/new");
  });
});
