import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getContents, getRawContent, createOrUpdateContents, createOrUpdateBinaryContents, deleteContents } from "./content.js";
import { encodeBase64 } from "./base64.js";
import { DcsApiError } from "./errors.js";
import type { DcsClientConfig } from "./config.js";

const config: DcsClientConfig = { host: "https://qa.door43.org" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("getContents / getRawContent", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("getRawContent decodes the base64 content field", async () => {
    const text = "# Lección 1\n\nContenido de la lección.";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          name: "leccion-1.md",
          path: "courses/curso-1/leccion-1.md",
          sha: "abc123",
          size: text.length,
          content: encodeBase64(text),
          encoding: "base64",
          type: "file",
        }),
      ),
    );

    const raw = await getRawContent(config, "owner", "repo", "courses/curso-1/leccion-1.md");
    expect(raw).toBe(text);
  });

  it("getRawContent throws DcsApiError if the path is a directory", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse([{ name: "a.md", path: "courses/a.md", sha: "x", size: 1, type: "file" }])),
    );
    await expect(getRawContent(config, "owner", "repo", "courses")).rejects.toBeInstanceOf(DcsApiError);
  });

  it("getContents passes ref as a query param", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ name: "f", path: "f", sha: "s", size: 0, type: "file" }));
    vi.stubGlobal("fetch", fetchMock);

    await getContents(config, "owner", "repo", "f.md", { ref: "release-1" });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://qa.door43.org/api/v1/repos/owner/repo/contents/f.md?ref=release-1");
  });
});

describe("createOrUpdateContents", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("uses POST (create) when no sha is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ content: { name: "f", path: "f", sha: "new", size: 5, type: "file" }, commit: { sha: "c1", message: "add" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createOrUpdateContents(config, "owner", "repo", "f.md", {
      content: "hello",
      message: "add f.md",
      token: "tok",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.content).toBe(encodeBase64("hello"));
    expect(body.sha).toBeUndefined();
  });

  it("retries PUT create when POST to a missing path returns 404", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: "not found" }, 404))
      .mockResolvedValueOnce(
        jsonResponse({
          content: { name: "f", path: "f", sha: "new", size: 5, type: "file" },
          commit: { sha: "c1", message: "add" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await createOrUpdateContents(config, "owner", "repo", "16-NEH.usfm", {
      content: "\\id NEH\n",
      message: "add NEH",
      branch: "book/neh",
      token: "tok",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(fetchMock.mock.calls[1][1].method).toBe("PUT");
    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(putBody.sha).toBeUndefined();
    expect(putBody.branch).toBe("book/neh");
  });

  it("sends new_branch when creating a file on a new Gitea branch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ content: { name: "f", path: "f", sha: "new", size: 5, type: "file" }, commit: { sha: "c1", message: "add" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createOrUpdateContents(config, "owner", "repo", "16-NEH.usfm", {
      content: "\\id NEH\n",
      message: "add NEH",
      branch: "master",
      new_branch: "afinacion/neh",
      token: "tok",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(body.branch).toBe("master");
    expect(body.new_branch).toBe("afinacion/neh");
  });

  it("uses PUT (update) when sha is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ content: { name: "f", path: "f", sha: "new2", size: 5, type: "file" }, commit: { sha: "c2", message: "update" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createOrUpdateContents(config, "owner", "repo", "f.md", {
      content: "updated",
      message: "update f.md",
      sha: "old-sha",
      token: "tok",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body as string);
    expect(body.sha).toBe("old-sha");
  });

  it("surfaces a 409 conflict (stale sha) as DcsApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ message: "sha does not match" }, 409)));
    const error = await createOrUpdateContents(config, "owner", "repo", "f.md", {
      content: "x",
      message: "m",
      sha: "stale",
      token: "tok",
    }).catch((e) => e);
    expect(error).toBeInstanceOf(DcsApiError);
    expect((error as DcsApiError).status).toBe(409);
  });
});

describe("createOrUpdateBinaryContents", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("sends the given base64 as-is, without re-encoding it as UTF-8 text", async () => {
    // Bytes that are NOT valid UTF-8 on their own — encodeBase64(String.fromCharCode(...)) would mangle them,
    // which is exactly the corruption this function exists to avoid.
    const rawBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const contentBase64 = Buffer.from(rawBytes).toString("base64");

    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ content: { name: "logo.png", path: "images/logo.png", sha: "new", size: rawBytes.length, type: "file" }, commit: { sha: "c1", message: "add" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createOrUpdateBinaryContents(config, "owner", "repo", "images/logo.png", {
      contentBase64,
      message: "add images/logo.png",
      token: "tok",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.content).toBe(contentBase64);
    expect(Buffer.from(body.content, "base64")).toEqual(Buffer.from(rawBytes));
  });

  it("uses PUT (update) when sha is given, same as createOrUpdateContents", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ content: { name: "logo.png", path: "images/logo.png", sha: "new2", size: 8, type: "file" }, commit: { sha: "c2", message: "update" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createOrUpdateBinaryContents(config, "owner", "repo", "images/logo.png", {
      contentBase64: "AAAA",
      message: "update images/logo.png",
      sha: "old-sha",
      token: "tok",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body as string);
    expect(body.sha).toBe("old-sha");
  });
});

describe("deleteContents", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("DELETEs with message/sha/branch in the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await deleteContents(config, "owner", "repo", "f.md", { message: "remove f.md", sha: "abc", branch: "main", token: "tok" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://qa.door43.org/api/v1/repos/owner/repo/contents/f.md");
    expect(init.method).toBe("DELETE");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ message: "remove f.md", sha: "abc", branch: "main" });
  });
});
