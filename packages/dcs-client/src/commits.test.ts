import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listCommits, compareCommits } from "./commits.js";
import type { DcsClientConfig } from "./config.js";

const config: DcsClientConfig = { host: "https://qa.door43.org" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("listCommits", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("GETs /repos/{owner}/{repo}/commits with stat/verification disabled", async () => {
    const commitFixture = { sha: "abc123", html_url: "https://qa.door43.org/o/r/commit/abc123", created: "2026-01-01T00:00:00Z", commit: { message: "m" } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([commitFixture]));
    vi.stubGlobal("fetch", fetchMock);

    const commits = await listCommits(config, "idiomas-puentes", "curso-1", { limit: 1, token: "tok" });

    expect(commits).toEqual([commitFixture]);
    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(url as string);
    expect(parsed.pathname).toBe("/api/v1/repos/idiomas-puentes/curso-1/commits");
    expect(parsed.searchParams.get("limit")).toBe("1");
    expect(parsed.searchParams.get("stat")).toBe("false");
    expect(parsed.searchParams.get("verification")).toBe("false");
    expect((init.headers as Record<string, string>).Authorization).toBe("token tok");
  });

  it("passes sha through to start listing from a specific branch/commit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await listCommits(config, "idiomas-puentes", "curso-1", { sha: "master" });

    const [url] = fetchMock.mock.calls[0];
    expect(new URL(url as string).searchParams.get("sha")).toBe("master");
  });
});

describe("compareCommits", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("GETs /repos/{owner}/{repo}/compare/{basehead} and maps total_commits/commits", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        total_commits: 2,
        commits: [
          { sha: "def456", html_url: "u", created: "2026-01-02T00:00:00Z", commit: { message: "m2" }, files: [{ filename: "modules/m1.md", status: "modified" }] },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await compareCommits(config, "otraOrg", "curso-externo", "abc123...master", "tok");

    expect(result.totalCommits).toBe(2);
    expect(result.commits[0].files?.[0]).toEqual({ filename: "modules/m1.md", status: "modified" });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://qa.door43.org/api/v1/repos/otraOrg/curso-externo/compare/abc123...master");
  });
});
