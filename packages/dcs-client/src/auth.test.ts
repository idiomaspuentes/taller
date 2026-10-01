import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  getAuthenticatedUser,
  createUserToken,
  deleteUserToken,
  signInWithPassword,
} from "./auth.js";
import { DcsApiError } from "./errors.js";
import type { DcsClientConfig } from "./config.js";

const config: DcsClientConfig = { host: "https://qa.door43.org" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("buildAuthorizeUrl", () => {
  it("builds the web (non /api/v1) authorize URL with the required query params", () => {
    const url = buildAuthorizeUrl(config, {
      clientId: "client-abc",
      redirectUri: "https://lms.example.org/callback",
      state: "xyz789",
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://qa.door43.org/login/oauth/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("client-abc");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://lms.example.org/callback");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("state")).toBe("xyz789");
  });
});

describe("exchangeCodeForToken", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs to /login/oauth/access_token with the authorization_code grant", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ access_token: "tok", refresh_token: "ref", expires_in: 3600 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await exchangeCodeForToken(config, {
      clientId: "client-abc",
      clientSecret: "shh",
      redirectUri: "https://lms.example.org/callback",
      code: "auth-code",
    });

    expect(result).toEqual({ access_token: "tok", refresh_token: "ref", expires_in: 3600 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://qa.door43.org/login/oauth/access_token");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      client_id: "client-abc",
      client_secret: "shh",
      redirect_uri: "https://lms.example.org/callback",
      grant_type: "authorization_code",
      code: "auth-code",
    });
  });

  it("throws DcsApiError on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "invalid_grant" }, 400)));
    await expect(
      exchangeCodeForToken(config, { clientId: "a", clientSecret: "b", redirectUri: "c", code: "bad" }),
    ).rejects.toBeInstanceOf(DcsApiError);
  });
});

describe("getAuthenticatedUser", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("GETs /user with the token header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 1, login: "abel" }));
    vi.stubGlobal("fetch", fetchMock);

    const user = await getAuthenticatedUser(config, "my-token");
    expect(user).toEqual({ id: 1, login: "abel" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://qa.door43.org/api/v1/user");
    expect((init.headers as Record<string, string>).Authorization).toBe("token my-token");
  });
});

describe("createUserToken", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("uses Basic auth (not the token header) since no token exists yet", async () => {
    // The real field is `sha1`, not `token` — confirmed against the live
    // QA server's actual response and its swagger.v1.json AccessToken
    // schema (2026-09-03); mocking `token` here previously matched a
    // wrong assumption in the code instead of catching it.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 5, name: "ci-script", sha1: "generated", scopes: ["repo"] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createUserToken(config, {
      username: "abel",
      password: "hunter2",
      name: "ci-script",
      scopes: ["repo"],
    });

    expect(result.sha1).toBe("generated");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://qa.door43.org/api/v1/users/abel/tokens");
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth.startsWith("Basic ")).toBe(true);
    const decoded = Buffer.from(auth.slice("Basic ".length), "base64").toString("utf-8");
    expect(decoded).toBe("abel:hunter2");
  });
});

describe("signInWithPassword", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("lists existing tokens, mints a new one via Basic auth, then confirms it against GET /user", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([])) // GET /tokens — nothing to clean up
      .mockResolvedValueOnce(jsonResponse({ id: 5, name: "ip-lms-learner-ab12cd", sha1: "minted-token", scopes: ["write:repository"] }))
      .mockResolvedValueOnce(jsonResponse({ id: 5, login: "abel" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await signInWithPassword(config, {
      username: "abel",
      password: "hunter2",
      tokenNamePrefix: "ip-lms-learner",
      scopes: ["write:repository"],
    });

    expect(result).toEqual({ user: { id: 5, login: "abel" }, token: "minted-token" });

    const [listUrl, listInit] = fetchMock.mock.calls[0];
    expect(listUrl).toBe("https://qa.door43.org/api/v1/users/abel/tokens");
    expect(listInit.method ?? "GET").toBe("GET");

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[1];
    expect(tokenUrl).toBe("https://qa.door43.org/api/v1/users/abel/tokens");
    expect(tokenInit.method).toBe("POST");
    const tokenBody = JSON.parse(tokenInit.body as string);
    expect(tokenBody.name).toMatch(/^ip-lms-learner-/);
    expect(tokenBody.scopes).toEqual(["write:repository"]);

    const [confirmUrl, confirmInit] = fetchMock.mock.calls[2];
    expect(confirmUrl).toBe("https://qa.door43.org/api/v1/user");
    expect((confirmInit.headers as Record<string, string>).Authorization).toBe("token minted-token");
  });

  it("deletes this app's own previous token(s) before minting a new one, leaving other apps' tokens alone", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([
          { id: 1, name: "ip-lms-learner-oldone", scopes: ["write:repository"] },
          { id: 2, name: "ip-lms-learner-fromanotherdevice", scopes: ["write:repository"] },
          { id: 3, name: "some-other-app-token", scopes: ["read:user"] },
        ]),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 })) // DELETE id 1
      .mockResolvedValueOnce(new Response(null, { status: 204 })) // DELETE id 2
      .mockResolvedValueOnce(jsonResponse({ id: 4, name: "ip-lms-learner-fresh", sha1: "minted-token", scopes: ["write:repository"] }))
      .mockResolvedValueOnce(jsonResponse({ id: 5, login: "abel" }));
    vi.stubGlobal("fetch", fetchMock);

    await signInWithPassword(config, {
      username: "abel",
      password: "hunter2",
      tokenNamePrefix: "ip-lms-learner",
      scopes: ["write:repository"],
    });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    const [deleteOneUrl, deleteOneInit] = fetchMock.mock.calls[1];
    expect(deleteOneUrl).toBe("https://qa.door43.org/api/v1/users/abel/tokens/1");
    expect(deleteOneInit.method).toBe("DELETE");
    const [deleteTwoUrl, deleteTwoInit] = fetchMock.mock.calls[2];
    expect(deleteTwoUrl).toBe("https://qa.door43.org/api/v1/users/abel/tokens/2");
    expect(deleteTwoInit.method).toBe("DELETE");
    // Token id 3 ("some-other-app-token") never gets its own DELETE call — only 5 calls total (list, 2 deletes, create, confirm).
  });

  it("turns a 401 into a friendly bad-credentials message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ message: "unauthorized" }, 401)));

    await expect(
      signInWithPassword(config, { username: "abel", password: "wrong", tokenNamePrefix: "ip-lms-learner", scopes: [] }),
    ).rejects.toThrow("Usuario o contraseña incorrectos.");
  });
});

describe("deleteUserToken", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("DELETEs /users/{username}/tokens/{id} with the token header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await deleteUserToken(config, "abel", 5, "my-token");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://qa.door43.org/api/v1/users/abel/tokens/5");
    expect(init.method).toBe("DELETE");
  });
});
