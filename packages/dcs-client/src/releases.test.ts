import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listReleases, createRelease } from "./releases.js";
import type { DcsClientConfig } from "./config.js";

const config: DcsClientConfig = { host: "https://qa.door43.org" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("listReleases", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("GETs /repos/{owner}/{repo}/releases", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ id: 1, tag_name: "v1", draft: false, prerelease: false }]));
    vi.stubGlobal("fetch", fetchMock);

    const releases = await listReleases(config, "idiomasPuentesLMS", "prt-es-419");

    expect(releases).toEqual([{ id: 1, tag_name: "v1", draft: false, prerelease: false }]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://qa.door43.org/api/v1/repos/idiomasPuentesLMS/prt-es-419/releases");
  });
});

describe("createRelease", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs a non-draft, non-prerelease release (so the catalog classifies it as stage: prod)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 1, tag_name: "v1", draft: false, prerelease: false }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const release = await createRelease(config, "idiomasPuentesLMS", "prt-es-419", { tagName: "v1", name: "v1", token: "tok" });

    expect(release.tag_name).toBe("v1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://qa.door43.org/api/v1/repos/idiomasPuentesLMS/prt-es-419/releases");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ tag_name: "v1", name: "v1", draft: false, prerelease: false });
  });
});
