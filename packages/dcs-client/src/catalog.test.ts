import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchCatalog, listCatalogLanguages, listCatalogSubjects, listCatalogOwners, getCatalogEntry } from "./catalog.js";
import type { DcsClientConfig } from "./config.js";

const config: DcsClientConfig = { host: "https://qa.door43.org" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("searchCatalog", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("builds the query string from subject/lang/owner/stage", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await searchCatalog(config, { subject: "Bible", lang: "es-419", stage: "prod" });

    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(url as string);
    expect(parsed.pathname).toBe("/api/v1/catalog/search");
    expect(parsed.searchParams.get("subject")).toBe("Bible");
    expect(parsed.searchParams.get("lang")).toBe("es-419");
    expect(parsed.searchParams.get("stage")).toBe("prod");
  });

  it("repeats array-valued params (e.g. multiple subjects)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await searchCatalog(config, { subject: ["Bible", "Translation Notes"] });

    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(url as string);
    expect(parsed.searchParams.getAll("subject")).toEqual(["Bible", "Translation Notes"]);
  });

  it("passes owner and topic through (ARQUITECTURA.md §20.1's course-discovery query)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await searchCatalog(config, { owner: "idiomasPuentesLMS", topic: "ip-lms-course" });

    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(url as string);
    expect(parsed.searchParams.get("owner")).toBe("idiomasPuentesLMS");
    expect(parsed.searchParams.get("topic")).toBe("ip-lms-course");
  });

  it("repeats topic when given multiple values, same as subject", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await searchCatalog(config, { topic: ["ip-lms-course", "ip-lms-course-draft"] });

    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(url as string);
    expect(parsed.searchParams.getAll("topic")).toEqual(["ip-lms-course", "ip-lms-course-draft"]);
  });

  it("returns the catalog entries", async () => {
    const entry = {
      id: 1,
      self_url: "https://qa.door43.org/api/v1/catalog/entry/owner/repo",
      name: "repo",
      full_name: "owner/repo",
      owner: "owner",
      repo: { name: "repo", owner: "owner" },
      title: "Some Resource",
      subject: "Bible",
      language: "es-419",
      stage: "prod" as const,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: [entry] })));

    const result = await searchCatalog(config, { lang: "es-419" });
    expect(result.data).toEqual([entry]);
  });
});

describe("catalog list endpoints", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("listCatalogLanguages hits /catalog/list/languages", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ identifier: "es-419", title: "Español", direction: "ltr", is_gl: true }]));
    vi.stubGlobal("fetch", fetchMock);
    const langs = await listCatalogLanguages(config);
    expect(langs[0].identifier).toBe("es-419");
    expect(fetchMock.mock.calls[0][0]).toBe("https://qa.door43.org/api/v1/catalog/list/languages");
  });

  it("listCatalogSubjects hits /catalog/list/subjects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(["Bible", "Translation Notes"])));
    const subjects = await listCatalogSubjects(config);
    expect(subjects).toContain("Bible");
  });

  it("listCatalogOwners hits /catalog/list/owners", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(["unfoldingWord", "Door43-Catalog"])));
    const owners = await listCatalogOwners(config);
    expect(owners).toContain("unfoldingWord");
  });
});

describe("getCatalogEntry", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("builds /catalog/entry/{owner}/{repo} without a ref", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 1, name: "repo" }));
    vi.stubGlobal("fetch", fetchMock);
    await getCatalogEntry(config, "owner", "repo");
    expect(fetchMock.mock.calls[0][0]).toBe("https://qa.door43.org/api/v1/catalog/entry/owner/repo");
  });

  it("appends the ref when given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 1, name: "repo" }));
    vi.stubGlobal("fetch", fetchMock);
    await getCatalogEntry(config, "owner", "repo", "v1.0");
    expect(fetchMock.mock.calls[0][0]).toBe("https://qa.door43.org/api/v1/catalog/entry/owner/repo/v1.0");
  });
});
