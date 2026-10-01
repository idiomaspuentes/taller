import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { request } from "./http.js";
import { DcsApiError } from "./errors.js";
import type { DcsClientConfig } from "./config.js";

const config: DcsClientConfig = { host: "https://qa.door43.org" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("request", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the URL with /api/v1 prefix and query string, sends User-Agent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await request(config, { path: "/catalog/search", query: { subject: "Bible", page: undefined } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://qa.door43.org/api/v1/catalog/search?subject=Bible");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("IdiomasPuentesLMS/1.0");
  });

  it("sends Authorization: token {token}, never Bearer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    await request(config, { path: "/user", token: "abc123" });

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe("token abc123");
  });

  it("returns undefined on 204 No Content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await request(config, { method: "DELETE", path: "/repos/x/y/contents/z" });
    expect(result).toBeUndefined();
  });

  it("retries on 429 then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: "rate limited" }, 429))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const result = await request<{ ok: boolean }>(config, { path: "/user" });
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after MAX_RETRIES and throws DcsApiError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: "down" }, 503));
    vi.stubGlobal("fetch", fetchMock);

    await expect(request(config, { path: "/user" })).rejects.toBeInstanceOf(DcsApiError);
    // initial attempt + 3 retries = 4 calls
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("throws DcsApiError immediately on a non-retryable status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: "not found" }, 404));
    vi.stubGlobal("fetch", fetchMock);

    const error = await request(config, { path: "/repos/x/y" }).catch((e) => e);
    expect(error).toBeInstanceOf(DcsApiError);
    expect((error as DcsApiError).status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
