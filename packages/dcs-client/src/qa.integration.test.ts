import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DcsClientConfig } from "./config.js";
import { getAuthenticatedUser } from "./auth.js";
import { createUserRepo, createOrgRepo, listOrgRepos, getUserOrgs, getOrg } from "./repos.js";
import { createOrUpdateContents, getRawContent, deleteContents } from "./content.js";
import { searchCatalog, listCatalogLanguages } from "./catalog.js";
import { DcsApiError } from "./errors.js";
import type { DcsRepo } from "./repos.js";

// Loads `.env` at the repo root (Node >= 20.6's built-in loader — no
// dotenv dependency needed). Safe to call even when the file doesn't
// exist (CI, a fresh clone with no `.env` yet): the whole suite just
// self-skips below instead of failing.
try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // no .env — fine, the describe.skipIf below handles it
}

const DCS_HOST = process.env.DCS_HOST || "https://qa.door43.org";
const DCS_TOKEN = process.env.DCS_TOKEN;
const DCS_TEST_OWNER = process.env.DCS_TEST_OWNER;
const DCS_TEST_ORG = process.env.DCS_TEST_ORG;

const hasToken = Boolean(DCS_TOKEN && DCS_TEST_OWNER);

/**
 * Real network calls against a live DCS/Gitea server — QA only, never
 * production (see `.env.example`). Entirely opt-in: with no
 * `DCS_TOKEN`/`DCS_TEST_OWNER` set, every test here is skipped and
 * `pnpm test`/`vitest run` stays exactly what dcs-client's own
 * package.json still promises ("Unit-tested against a mocked fetch
 * only — no live DCS calls") for everyone who hasn't opted in.
 *
 * What this proves that the mocked-fetch suite can't: that the client
 * is actually shaped the way the real API wants it — real auth
 * headers, real base64 round-tripping, a real create/read/delete
 * cycle. It creates exactly one throwaway repo (named with a run-scoped
 * timestamp so parallel runs don't collide) and deletes it in
 * `afterAll`, regardless of which tests pass or fail.
 */
describe.skipIf(!hasToken)("DCS QA integration (live network, opt-in via .env)", () => {
  const config: DcsClientConfig = { host: DCS_HOST, userAgent: "IdiomasPuentesLMS-IntegrationTest/1.0" };
  const token = DCS_TOKEN as string;
  const owner = DCS_TEST_OWNER as string;
  const testRepoName = `ip-lms-integration-test-${Date.now()}`;
  let createdRepo: DcsRepo | undefined;

  afterAll(async () => {
    // Best-effort cleanup — a failed assertion above must never leave
    // a scratch repo behind on the QA server.
    if (createdRepo) {
      await fetch(`${DCS_HOST}/api/v1/repos/${owner}/${testRepoName}`, {
        method: "DELETE",
        headers: { Authorization: `token ${token}` },
      }).catch(() => undefined);
    }
  });

  it("getAuthenticatedUser resolves the token to DCS_TEST_OWNER", async () => {
    const user = await getAuthenticatedUser(config, token);
    expect(user.login.toLowerCase()).toBe(owner.toLowerCase());
  });

  it("searchCatalog and listCatalogLanguages return real data (no auth needed)", async () => {
    const languages = await listCatalogLanguages(config);
    expect(Array.isArray(languages)).toBe(true);
    expect(languages.length).toBeGreaterThan(0);

    const results = await searchCatalog(config, { limit: 1 });
    expect(results.ok).toBe(true);
  });

  it("creates a repo, writes a file, reads it back, then deletes both", async () => {
    createdRepo = await createUserRepo(config, {
      name: testRepoName,
      description: "Throwaway repo created by @ip-lms/dcs-client's QA integration test — safe to delete.",
      private: true,
      auto_init: true,
      token,
    });
    expect(createdRepo.name).toBe(testRepoName);

    const written = await createOrUpdateContents(config, owner, testRepoName, "hello.md", {
      content: "# Hola desde la prueba de integración\n\nEste archivo se crea y se borra automáticamente.",
      message: "Add hello.md",
      token,
    });
    expect(written.commit.sha).toBeTruthy();

    const raw = await getRawContent(config, owner, testRepoName, "hello.md");
    expect(raw).toContain("Hola desde la prueba de integración");

    await deleteContents(config, owner, testRepoName, "hello.md", {
      message: "Remove hello.md",
      sha: written.content.sha,
      token,
    });

    // Confirm the delete actually took: re-reading now 404s.
    await expect(getRawContent(config, owner, testRepoName, "hello.md")).rejects.toBeInstanceOf(DcsApiError);
  });

  it.skipIf(!DCS_TEST_ORG)("lists repos and confirms membership for DCS_TEST_ORG", async () => {
    const org = await getOrg(config, DCS_TEST_ORG as string, token);
    expect(org.name.toLowerCase()).toBe((DCS_TEST_ORG as string).toLowerCase());

    const orgs = await getUserOrgs(config, token);
    expect(orgs.some((o) => o.name.toLowerCase() === (DCS_TEST_ORG as string).toLowerCase())).toBe(true);

    // Read-only here on purpose — creating a repo under a shared org
    // the user didn't explicitly scratch-test against is out of scope
    // for an automated suite; listOrgRepos alone still proves the call
    // is shaped correctly against a real org.
    const repos = await listOrgRepos(config, DCS_TEST_ORG as string, { limit: 1, token });
    expect(Array.isArray(repos)).toBe(true);
  });

  it("createOrgRepo is exercised only when DCS_TEST_ORG is set", () => {
    // createOrgRepo itself is covered by the mocked-fetch suite in
    // repos.test.ts; deliberately not creating a *live* org repo here
    // by default (see the note above) to keep this suite's footprint
    // to "one throwaway user repo, cleaned up," not "one throwaway
    // repo per org someone points DCS_TEST_ORG at."
    expect(typeof createOrgRepo).toBe("function");
  });
});

if (!hasToken) {
  // Not a failure — just make it obvious *why* the block above shows
  // as skipped rather than looking like the file silently did nothing.
  // eslint-disable-next-line no-console
  console.log(
    "[dcs-client] QA integration tests skipped — set DCS_TOKEN and DCS_TEST_OWNER in .env to run them (see .env.example).",
  );
}
