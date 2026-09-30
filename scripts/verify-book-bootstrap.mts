/**
 * Mock DCS: missing book branch + missing USFM must create the branch
 * before creating the file. Run: npx tsx scripts/verify-book-bootstrap.mts
 */
import { ensureBookUsfm, ensureTaskBranchFromBook, recreateBookWorkspace } from "../src/dcs/bookBootstrap.ts";
import {
  closeOwnedPortionPrIfSafe,
  resolveVisiblePortionPr,
  saveUsfmOnPortionBranch,
} from "../src/dcs/portionPr.ts";
import { BootstrapError, explainRepoFileError } from "../src/dcs/repoFile.ts";
import { ensureArchiveRef, ensureBranchFrom } from "../src/dcs/pulls.ts";
import { dcsConfig } from "../src/dcs/config.ts";
import { getContents } from "@ip-lms/dcs-client";
import {
  archiveRefName,
  bookBranchName,
  isGitRefDescendant,
  legacyPhaseBookBranchName,
  nestedPortionPrBranchName,
  parsePortionPrMarker,
  portionPrBranchName,
  taskTrunkBranchName,
  upsertPortionPrInBody,
  type PortionPrMarker,
} from "../src/domain/portionPr.ts";
import type { GtSession } from "../src/dcs/auth.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

type Call = { method: string; path: string; ref?: string };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function notFound(message = "not found"): Response {
  return json({ message }, 404);
}

function parseUrl(input: RequestInfo | URL): { method: string; path: string; url: URL } {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : String(input);
  const url = new URL(raw);
  return { method: "GET", path: url.pathname.replace(/^\/api\/v1/, ""), url };
}

function makeSession(): GtSession {
  return {
    host: "https://qa.door43.org",
    username: "ana",
    token: "tok",
    scopesVersion: 2,
  };
}

type FakeIssue = { number: number; body: string; html_url?: string };
type FakePull = {
  number: number;
  state: string;
  merged?: boolean;
  html_url?: string;
  title?: string;
  head?: { ref?: string };
  base?: { ref?: string };
};

function installFakeDcs(opts: {
  branches: Record<string, string>;
  files: Record<string, string>;
  issues?: Record<string, FakeIssue>;
  pulls?: Record<string, FakePull>;
  ghost409?: boolean;
  /** Names in `branches` that only exist as git refs (branch + contents APIs 404). */
  ghosts?: string[];
}) {
  const branches = { ...opts.branches };
  const ghosts = new Set(opts.ghosts ?? []);
  const commits = new Set(Object.values(branches));
  const files = { ...opts.files };
  const issues = { ...(opts.issues ?? {}) };
  const pulls = { ...(opts.pulls ?? {}) };
  const calls: Call[] = [];

  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const parsed = parseUrl(input);
    const method = (init?.method || "GET").toUpperCase();
    const path = parsed.path;
    const call: Call = { method, path };
    calls.push(call);

    const repoMatch = path.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
    if (!repoMatch) return notFound();
    const owner = repoMatch[1];
    const repo = repoMatch[2];
    const rest = repoMatch[3] || "";

    if (owner === "unfoldingWord") return notFound();

    const issueMatch = rest.match(/^\/issues\/(\d+)$/);
    if (issueMatch) {
      const key = `${owner}/${repo}/${issueMatch[1]}`;
      if (method === "GET") {
        const issue = issues[key];
        if (!issue) return notFound();
        return json({
          number: issue.number,
          title: `issue ${issue.number}`,
          body: issue.body,
          state: "open",
          html_url: issue.html_url || `https://qa.door43.org/${owner}/${repo}/issues/${issue.number}`,
        });
      }
      if (method === "PATCH") {
        const issue = issues[key];
        if (!issue) return notFound();
        const body = JSON.parse(String(init?.body || "{}")) as { body?: string };
        if (body.body != null) issue.body = body.body;
        return json({
          number: issue.number,
          title: `issue ${issue.number}`,
          body: issue.body,
          state: "open",
          html_url: issue.html_url || `https://qa.door43.org/${owner}/${repo}/issues/${issue.number}`,
        });
      }
    }

    const pullIdMatch = rest.match(/^\/pulls\/(\d+)$/);
    if (pullIdMatch) {
      const key = `${owner}/${repo}/${pullIdMatch[1]}`;
      if (method === "GET") {
        const pull = pulls[key];
        if (!pull) return notFound();
        return json(pull);
      }
      if (method === "PATCH") {
        const pull = pulls[key];
        if (!pull) return notFound();
        const body = JSON.parse(String(init?.body || "{}")) as { state?: string };
        if (body.state) pull.state = body.state;
        return json(pull);
      }
    }

    const pullPairMatch = rest.match(/^\/pulls\/([^/]+)\/(.+)$/);
    if (pullPairMatch && method === "GET") {
      const base = decodeURIComponent(pullPairMatch[1]);
      const head = decodeURIComponent(pullPairMatch[2]);
      const found = Object.values(pulls).find(
        (row) => row.base?.ref === base && row.head?.ref === head,
      );
      return found ? json(found) : notFound();
    }

    if (!rest || rest === "/") {
      if (method === "GET") {
        return json({
          id: 1,
          name: repo,
          full_name: `${owner}/${repo}`,
          owner: { id: 1, login: owner },
          private: false,
          html_url: `https://qa.door43.org/${owner}/${repo}`,
          default_branch: "master",
        });
      }
    }

    const branchMatch = rest.match(/^\/branches(?:\/(.+))?$/);
    if (branchMatch) {
      if (method === "GET" && branchMatch[1]) {
        const name = branchMatch[1].split("/").map((part) => decodeURIComponent(part)).join("/");
        if (!branches[name] || ghosts.has(name)) return notFound();
        return json({ name, commit: { id: branches[name] } });
      }
      if (method === "POST" && !branchMatch[1]) {
        const body = JSON.parse(String(init?.body || "{}")) as {
          new_branch_name?: string;
          old_ref_name?: string;
          old_branch_name?: string;
        };
        const name = body.new_branch_name || "";
        const from = body.old_ref_name || body.old_branch_name || "";
        call.ref = name;
        if (opts.ghost409) return json({ message: "already exists" }, 409);
        if (branches[name]) return json({ message: "already exists" }, 409);
        const sha = branches[from] && !ghosts.has(from) ? branches[from] : commits.has(from) ? from : "";
        if (!name || !sha) return notFound("old ref not found");
        const parts = name.split("/").filter(Boolean);
        for (let i = 1; i < parts.length; i++) {
          if (branches[parts.slice(0, i).join("/")]) return json({ message: "parent exists" }, 500);
        }
        if (Object.keys(branches).some((existing) => existing.startsWith(`${name}/`))) {
          return json({ message: "child exists" }, 500);
        }
        branches[name] = sha;
        return json({ name, commit: { id: sha } }, 201);
      }
    }

    const refMatch = rest.match(/^\/git\/refs(?:\/heads\/(.+))?$/);
    if (refMatch) {
      if (method === "POST") {
        const body = JSON.parse(String(init?.body || "{}")) as { ref?: string; target?: string; sha?: string };
        const name = (body.ref || "").replace(/^refs\/heads\//, "");
        const sha = body.target || body.sha;
        call.ref = name;
        if (!name || !sha) return json({ message: "Unable to form reference" }, 422);
        if (opts.ghost409) return json({ message: "already exists" }, 409);
        if (branches[name]) return json({ message: "already exists" }, 409);
        ghosts.add(name);
        const parts = name.split("/").filter(Boolean);
        for (let i = 1; i < parts.length; i++) {
          const parent = parts.slice(0, i).join("/");
          if (branches[parent]) {
            return json({ message: "Unable to form reference (parent exists)" }, 500);
          }
        }
        for (const existing of Object.keys(branches)) {
          if (existing.startsWith(`${name}/`)) {
            return json({ message: "Unable to form reference (child exists)" }, 500);
          }
        }
        branches[name] = sha;
        return json({ ref: `refs/heads/${name}`, object: { sha } }, 201);
      }
      const name = decodeURIComponent((refMatch[1] || "").split("/").map((part) => decodeURIComponent(part)).join("/"));
      if (method === "DELETE") {
        if (!name || !branches[name]) return notFound();
        delete branches[name];
        ghosts.delete(name);
        return new Response(null, { status: 204 });
      }
      if (name && branches[name]) {
        return json({ ref: `refs/heads/${name}`, object: { sha: branches[name] } });
      }
      const children = Object.keys(branches).filter((b) => name && b.startsWith(`${name}/`));
      if (children.length) {
        return json(children.map((b) => ({ ref: `refs/heads/${b}`, object: { sha: branches[b] } })));
      }
      return notFound();
    }

    const contentsMatch = rest.match(/^\/contents\/(.+)$/);
    if (contentsMatch) {
      const filepath = decodeURIComponent(contentsMatch[1]);
      const ref = parsed.url.searchParams.get("ref") || "master";
      const key = `${ref}:${filepath}`;
      if (method === "GET") {
        if (!files[key] || ghosts.has(ref)) return notFound();
        return json({
          name: filepath,
          path: filepath,
          sha: `sha-${key}`,
          size: files[key].length,
          content: Buffer.from(files[key], "utf8").toString("base64"),
          encoding: "base64",
          type: "file",
        });
      }
      if (method === "POST" || method === "PUT") {
        const body = JSON.parse(String(init?.body || "{}")) as {
          branch?: string;
          new_branch?: string;
          content?: string;
        };
        const dest = body.new_branch || body.branch || ref;
        if (ghosts.has(dest) || (body.branch && ghosts.has(body.branch))) return notFound();
        if (body.branch && !body.new_branch && !branches[body.branch] && body.branch !== dest) {
          return notFound();
        }
        if (!body.new_branch && body.branch && !branches[body.branch]) {
          return notFound();
        }
        if (body.new_branch) {
          const base = body.branch && branches[body.branch] ? branches[body.branch] : branches.master;
          if (!base) return notFound();
          branches[body.new_branch] = `${base}-nb`;
        }
        const text = body.content ? Buffer.from(body.content, "base64").toString("utf8") : "";
        files[`${dest}:${filepath}`] = text;
        return json({
          content: {
            name: filepath,
            path: filepath,
            sha: `sha-${dest}:${filepath}`,
            size: text.length,
            type: "file",
          },
          commit: { sha: "c1", message: "add" },
        }, 201);
      }
    }

    return notFound();
  };

  globalThis.fetch = fetchMock as typeof fetch;
  return {
    calls,
    branches,
    ghosts,
    files,
    issues,
    pulls,
    restore() {
      // tsx process ends after the script
    },
  };
}

const session = makeSession();

{
  const fake = installFakeDcs({
    branches: { master: "abc123master" },
    files: {},
  });
  const result = await ensureBookUsfm({
    session,
    owner: "es-419_gl",
    repo: "es-419_glt",
    filepath: "16-NEH.usfm",
    book: "NEH",
    resource: "tpl",
    taskId: "tpl-draft",
    phaseSlug: "fase-1",
    fallbackRange: { chapter: 1, from: 10, to: 11 },
  });
  assert(result.bookBranch === "neh/tpl-draft", `book branch is libro/tarea, got ${result.bookBranch}`);
  assert(result.createdBranch, "created missing book branch");
  assert(result.createdFile, "created missing USFM");
  assert(result.usfm.includes("\\id NEH"), "skeleton has id");
  assert(result.usfm.includes("\\v 10"), "skeleton has verse 10");
  assert(fake.branches["neh/tpl-draft"], "neh/tpl-draft ref exists");
  assert(fake.files["neh/tpl-draft:16-NEH.usfm"], "file exists on book branch");
  assert(!fake.branches["fase-1/neh"], "do not create phase-based name for a new book");

  const createRef = fake.calls.findIndex((c) => c.method === "POST" && c.path.endsWith("/branches"));
  const createFile = fake.calls.findIndex((c) => c.method === "POST" && c.path.includes("/contents/16-NEH.usfm"));
  assert(createRef >= 0, "posted git ref");
  assert(createFile >= 0, "posted file create");
  assert(createRef < createFile, "branch created before file write");
}

{
  const fake = installFakeDcs({
    branches: { master: "abc123master", "book/neh": "abc123master" },
    files: { "book/neh:16-NEH.usfm": "\\id NEH\n\\c 1\n\\v 1\n" },
  });
  const result = await ensureBookUsfm({
    session,
    owner: "es-419_gl",
    repo: "es-419_glt",
    filepath: "16-NEH.usfm",
    book: "NEH",
    resource: "tpl",
    taskId: "tpl-draft",
    phaseSlug: "fase-1",
  });
  assert(result.bookBranch === "book/neh", "reuse legacy book/neh");
  assert(!result.createdFile, "do not invent a second book file");
  assert(!fake.branches["neh/tpl-draft"], "do not orphan-create the new name when legacy exists");
  assert(!fake.branches["fase-1/neh"], "do not orphan-create the old phase name either");
  assert(result.usfm.includes("\\v 1"), "reused existing USFM");
}

{
  const fake = installFakeDcs({
    branches: { master: "abc123master", "afinacion/neh": "abc123master" },
    files: { "afinacion/neh:16-NEH.usfm": "\\id NEH\n\\c 1\n\\v 1\n" },
  });
  const result = await ensureBookUsfm({
    session,
    owner: "es-419_gl",
    repo: "es-419_glt",
    filepath: "16-NEH.usfm",
    book: "NEH",
    resource: "tpl",
    taskId: "tpl-draft",
    phaseSlug: "revision",
  });
  assert(result.bookBranch === "afinacion/neh", "reuse existing afinacion/neh");
  assert(!fake.branches["neh/tpl-draft"], "do not orphan-create libro/tarea when afinacion exists");
  assert(!fake.branches["revision/neh"], "do not orphan-create revision/neh when afinacion exists");
}

{
  const fake = installFakeDcs({
    branches: { master: "abc123master" },
    files: {},
  });
  const result = await ensureBookUsfm({
    session,
    owner: "es-419_gl",
    repo: "es-419_glt",
    filepath: "16-NEH.usfm",
    book: "NEH",
    resource: "tpl",
    taskId: "tpl-draft",
    phaseSlug: "Revisión",
  });
  assert(result.bookBranch === "neh/tpl-draft", `custom Revisión must not name the branch, got ${result.bookBranch}`);
  assert(fake.branches["neh/tpl-draft"], "neh/tpl-draft ref exists");
  assert(!fake.branches["revision/neh"], "custom phase name must not appear in new refs");
}

{
  const fake = installFakeDcs({
    branches: { master: "abc123master", "fase-1/neh": "abc123master" },
    files: { "fase-1/neh:16-NEH.usfm": "\\id NEH\n\\c 1\n\\v 1\n" },
  });
  const result = await ensureBookUsfm({
    session,
    owner: "es-419_gl",
    repo: "es-419_glt",
    filepath: "16-NEH.usfm",
    book: "NEH",
    resource: "tpl",
    taskId: "tpl-draft",
    phaseSlug: "fase-1",
  });
  assert(result.bookBranch === "fase-1/neh", "reuse existing {oldPhaseSlug}/{book}");
  assert(!fake.branches["neh/tpl-draft"], "do not orphan-create libro/tarea when old phase ref exists");
}

{
  const err = new BootstrapError("La rama «afinacion/neh» no existe.", "book-branch", 404);
  const msg = explainRepoFileError(err, {
    owner: "es-419_gl",
    repo: "es-419_glt",
    filepath: "16-NEH.usfm",
    branch: "afinacion/neh",
    creating: true,
  });
  assert(msg.includes("HTTP 404"), "alert includes HTTP status");
  assert(msg.includes("rama del libro") || msg.includes("afinacion/neh"), "alert names the book-branch step");
  assert(!msg.includes("sin permiso") || !msg.includes("HTTP 404"), "404 is not collapsed into 403");
}

{
  const err = new BootstrapError("Sin permiso para acceder.", "repo", 403);
  const msg = explainRepoFileError(err, {
    owner: "es-419_gl",
    repo: "es-419_glt",
    filepath: "16-NEH.usfm",
    creating: true,
  });
  assert(msg.includes("HTTP 403"), "403 stays 403");
  assert(msg.includes("permiso"), "403 talks about permission");
}

assert(bookBranchName("NEH", "tpl-draft") === "neh/tpl-draft", "NEH uses libro/tarea");
assert(bookBranchName("NEH") === "neh/tarea", "missing task is not a phase slug");
assert(legacyPhaseBookBranchName("NEH", "fase-1") === "fase-1/neh", "old phase name kept for reuse");

{
  const fake = installFakeDcs({
    branches: {
      master: "abc123master",
      "neh/tpl-draft": "halfcreated",
      "neh/tpl-draft/ana/41": "halfcreated",
    },
    files: {},
  });
  const result = await recreateBookWorkspace({
    session,
    owner: "es-419_gl",
    repo: "es-419_glt",
    filepath: "16-NEH.usfm",
    book: "NEH",
    resource: "tpl",
    taskId: "tpl-draft",
    fallbackRange: { chapter: 1, from: 10, to: 11 },
    workBranch: "neh/tpl-draft/ana/41",
    username: "ana",
    issueNumber: 41,
    createdFileThisSession: true,
  });
  assert(result.wipedTrunk, "missing/broken trunk file is recreated");
  assert(result.deletedWorkBranch, "work branch was deleted");
  assert(result.workBranch === "w/neh/tpl-draft/ana/41", "work remapped off the trunk");
  assert(fake.branches["neh/tpl-draft"], "trunk recreated");
  assert(fake.branches["w/neh/tpl-draft/ana/41"], "work branch recreated from trunk");
  assert(!fake.branches["neh/tpl-draft/ana/41"], "do not recreate nested work under trunk");
  assert(fake.files["neh/tpl-draft:16-NEH.usfm"], "skeleton written on trunk");
  const deleteTrunk = fake.calls.findIndex((c) => c.method === "DELETE" && c.path.includes("/git/refs/heads/neh/tpl-draft") && !c.path.includes("/ana/"));
  const createTrunk = fake.calls.findIndex((c) => c.method === "POST" && c.path.endsWith("/branches"));
  const createFile = fake.calls.findIndex((c) => (c.method === "POST" || c.method === "PUT") && c.path.includes("/contents/16-NEH.usfm"));
  assert(deleteTrunk >= 0, "deleted broken trunk ref");
  assert(createTrunk >= 0, "reposted trunk ref");
  assert(createFile >= 0, "posted file after rollback");
  assert(createTrunk < createFile, "recreate keeps repo → SHA → branch → file order");
}

{
  const filled = "\\id NEH\n\\c 1\n\\v 1 Texto de otra persona\n";
  const fake = installFakeDcs({
    branches: {
      master: "abc123master",
      "neh/tpl-draft": "trunksha",
      "w/neh/tpl-draft/ana/41": "oldwork",
    },
    files: { "neh/tpl-draft:16-NEH.usfm": filled },
  });
  const result = await recreateBookWorkspace({
    session,
    owner: "es-419_gl",
    repo: "es-419_glt",
    filepath: "16-NEH.usfm",
    book: "NEH",
    resource: "tpl",
    taskId: "tpl-draft",
    workBranch: "w/neh/tpl-draft/ana/41",
    username: "ana",
    issueNumber: 41,
    createdFileThisSession: true,
  });
  assert(result.reusedTrunk, "filled trunk is reused");
  assert(!result.wipedTrunk, "do not wipe other people's verses");
  assert(fake.files["neh/tpl-draft:16-NEH.usfm"] === filled, "trunk USFM unchanged");
  assert(fake.branches["neh/tpl-draft"] === "trunksha", "trunk ref not deleted");
  assert(fake.branches["w/neh/tpl-draft/ana/41"] === "trunksha", "fresh work branch from trunk SHA");
}

{
  const uuid = "6f1e771e-2f2d-4987-b516-6455a751405a";
  const trunk = bookBranchName("NEH", uuid);
  const nested = nestedPortionPrBranchName({
    book: "NEH",
    username: "abelper8",
    taskId: uuid,
    issueNumber: 5,
  });
  const work = portionPrBranchName({
    book: "NEH",
    username: "abelper8",
    taskId: uuid,
    issueNumber: 5,
  });
  assert(trunk === `neh/${uuid}`, "UUID trunk is libro/tarea");
  assert(!isGitRefDescendant(work, trunk), "canonical work is not a git child of trunk");
  const fake = installFakeDcs({
    branches: { master: "abc123master" },
    files: {},
  });
  const boot = await ensureBookUsfm({
    session,
    owner: "es-419_gl",
    repo: "es-419_glt",
    filepath: "16-NEH.usfm",
    book: "NEH",
    resource: "tpl",
    taskId: uuid,
    fallbackRange: { chapter: 6, from: 1, to: 2 },
  });
  const task = await ensureTaskBranchFromBook({
    session,
    owner: "es-419_gl",
    repo: "es-419_glt",
    book: "NEH",
    taskId: uuid,
    taskBranch: nested,
    username: "abelper8",
    issueNumber: 5,
  });
  assert(boot.bookBranch === trunk, "book bootstrap creates trunk only");
  assert(task.workBranch === work, "nested request remaps to w/ work");
  const posted = fake.calls.filter((c) => c.method === "POST" && c.path.endsWith("/branches")).map((c) => c.ref);
  assert(posted.includes(trunk), "POSTed trunk ref");
  assert(posted.includes(work), "POSTed non-descendant work ref");
  assert(!posted.includes(nested), "never POST nested work as a git ref");
  assert(!posted.some((ref) => ref === nested || ref?.startsWith(`${trunk}/`)), "no book/work child of trunk");
}

{
  const err = new BootstrapError(
    "Ya existe el borrador «w»; no se puede crear «w/neh/task/ana/5».",
    "task-branch",
    500,
    undefined,
    "w/neh/task/ana/5",
  );
  const msg = explainRepoFileError(err, {
    owner: "es-419_gl",
    repo: "es-419_glt",
    filepath: "16-NEH.usfm",
    branch: "neh/6f1e771e-2f2d-4987-b516-6455a751405a/abelper8/5",
    creating: true,
  });
  assert(msg.includes("es-419_gl/es-419_glt"), "alert names the real repo, not a dash");
  assert(!msg.includes("es-419_gl/—"), "placeholder repo is gone");
  assert(msg.includes("w/neh/task/ana/5"), "alert uses the failing ref from the error");
  assert(msg.includes("Ya existe el borrador") || msg.includes("HTTP 500"), "500 is diagnosed");
}

{
  const fake = installFakeDcs({
    branches: { master: "abc123master", "neh/tpl-draft": "trunksha" },
    files: { "neh/tpl-draft:16-NEH.usfm": "\\id NEH\n\\c 1\n\\v 1\n" },
  });
  let threw = false;
  try {
    const { ensureBranchFrom } = await import("../src/dcs/pulls.ts");
    const { dcsConfig } = await import("../src/dcs/config.ts");
    await ensureBranchFrom(
      dcsConfig(session.host),
      "es-419_gl",
      "es-419_glt",
      "neh/tpl-draft/ana/41",
      session.token,
      "neh/tpl-draft",
    );
  } catch (err) {
    threw = true;
    const text = err instanceof Error ? err.message : String(err);
    assert(/Ya existe el borrador|cuelgan|500/i.test(text), `nested create is diagnosed, got: ${text}`);
  }
  assert(threw, "creating a git child of the trunk must fail");
  assert(
    !fake.calls.some((c) => c.method === "POST" && c.ref === "neh/tpl-draft/ana/41"),
    "detect parent conflict before POST /branches",
  );
}

{
  const uuid = "6f1e771e-2f2d-4987-b516-6455a751405a";
  const preferred = bookBranchName("NEH", uuid);
  const safe = taskTrunkBranchName("NEH", uuid);
  const work = portionPrBranchName({
    book: "NEH",
    username: "abelper8",
    taskId: uuid,
    issueNumber: 5,
  });
  const fake = installFakeDcs({
    branches: { master: "abc123master", neh: "oldbook" },
    files: {},
  });
  const boot = await ensureBookUsfm({
    session,
    owner: "es-419_gl",
    repo: "es-419_glt",
    filepath: "16-NEH.usfm",
    book: "NEH",
    resource: "tpl",
    taskId: uuid,
    fallbackRange: { chapter: 6, from: 1, to: 2 },
  });
  const task = await ensureTaskBranchFromBook({
    session,
    owner: "es-419_gl",
    repo: "es-419_glt",
    book: "NEH",
    taskId: uuid,
    filepath: "16-NEH.usfm",
    taskBranch: work,
    username: "abelper8",
    issueNumber: 5,
  });
  assert(boot.bookBranch === safe, `parent neh → t/neh/task trunk, got ${boot.bookBranch}`);
  assert(task.bookBranch === safe, "work forks from t/ trunk");
  assert(task.workBranch === work, "work stays w/neh/task/user/issue");
  assert(fake.branches.neh === "oldbook", "do not delete leftover neh");
  assert(fake.branches[safe], "created t/neh/task");
  const posted = fake.calls.filter((c) => c.method === "POST" && c.path.endsWith("/branches")).map((c) => c.ref);
  assert(!posted.includes(preferred), "never POST neh/{taskId} when parent neh exists");
  assert(posted.includes(safe), "POST t/neh/{taskId} instead");
  assert(posted.includes(work), "POST w/ work ref");
}

{
  const fake = installFakeDcs({
    branches: { master: "abc123master", neh: "oldbook" },
    files: { "neh:16-NEH.usfm": "\\id NEH\n\\c 1\n\\v 1 Texto\n" },
  });
  const result = await ensureBookUsfm({
    session,
    owner: "es-419_gl",
    repo: "es-419_glt",
    filepath: "16-NEH.usfm",
    book: "NEH",
    resource: "tpl",
    taskId: "6f1e771e-2f2d-4987-b516-6455a751405a",
  });
  assert(result.bookBranch === "neh", "reuse neh when it already holds a valid book USFM");
  assert(!result.createdFile, "do not invent a second book file");
  assert(
    !fake.calls.some((c) => c.method === "POST" && c.ref === bookBranchName("NEH", "6f1e771e-2f2d-4987-b516-6455a751405a")),
    "do not POST neh/{taskId} when reusing neh",
  );
  assert(!fake.branches[taskTrunkBranchName("NEH", "6f1e771e-2f2d-4987-b516-6455a751405a")], "no extra t/ trunk when neh is valid");
}

{
  const uuid = "6f1e771e-2f2d-4987-b516-6455a751405a";
  const preferred = bookBranchName("NEH", uuid);
  const safe = taskTrunkBranchName("NEH", uuid);
  const fake = installFakeDcs({
    branches: { master: "abc123master", neh: "oldbook" },
    files: {},
  });
  const result = await recreateBookWorkspace({
    session,
    owner: "es-419_gl",
    repo: "es-419_glt",
    filepath: "16-NEH.usfm",
    book: "NEH",
    resource: "tpl",
    taskId: uuid,
    fallbackRange: { chapter: 6, from: 1, to: 2 },
    workBranch: portionPrBranchName({
      book: "NEH",
      username: "abelper8",
      taskId: uuid,
      issueNumber: 5,
    }),
    username: "abelper8",
    issueNumber: 5,
    createdFileThisSession: true,
  });
  assert(result.bookBranch === safe, `Recreate uses t/ trunk when neh exists, got ${result.bookBranch}`);
  assert(result.workBranch === `w/neh/${uuid}/abelper8/5`, "Recreate work stays w/…");
  assert(fake.branches.neh === "oldbook", "Recreate does not delete production neh");
  assert(fake.branches[safe], "Recreate created t/neh/{taskId}");
  assert(fake.files[`${safe}:16-NEH.usfm`], "skeleton written on t/ trunk");
  const posted = fake.calls.filter((c) => c.method === "POST" && c.path.endsWith("/branches")).map((c) => c.ref);
  assert(!posted.includes(preferred), "Recreate never POSTs blocked neh/{taskId}");
  assert(
    !fake.calls.some((c) => c.method === "DELETE" && /\/heads\/neh$/.test(c.path)),
    "Recreate does not DELETE the neh book leftover",
  );
}

{
  const err = new BootstrapError(
    "Ya existe el borrador «neh»; no se puede crear «neh/6f1e771e-2f2d-4987-b516-6455a751405a».",
    "book-branch",
    500,
    undefined,
    "neh/6f1e771e-2f2d-4987-b516-6455a751405a",
  );
  const msg = explainRepoFileError(err, {
    owner: "es-419_gl",
    repo: "es-419_glt",
    filepath: "16-NEH.usfm",
    branch: "neh/6f1e771e-2f2d-4987-b516-6455a751405a",
    creating: true,
  });
  assert(msg.includes("es-419_gl/es-419_glt"), "book-branch alert names the real repo");
  assert(msg.includes("Ya existe el borrador «neh»"), "book-branch alert names the blocking parent");
  assert(msg.includes("no se puede crear"), "book-branch alert finishes the sentence");
  assert(!msg.endsWith("exist"), "parent-ref sentence is not truncated");
}

{
  const uuid = "6f1e771e-2f2d-4987-b516-6455a751405a";
  const safe = taskTrunkBranchName("NEH", uuid);
  const work = portionPrBranchName({
    book: "NEH",
    username: "abelper8",
    taskId: uuid,
    issueNumber: 5,
  });
  const fake = installFakeDcs({
    branches: { master: "abc123master", neh: "oldbook" },
    files: { "neh:16-NEH.usfm": "\\id NEH\n\\c 1\n\\v 1 Texto de otra persona\n" },
  });
  const result = await recreateBookWorkspace({
    session,
    owner: "es-419_gl",
    repo: "es-419_glt",
    filepath: "16-NEH.usfm",
    book: "NEH",
    resource: "tpl",
    taskId: uuid,
    fallbackRange: { chapter: 6, from: 1, to: 2 },
    workBranch: work,
    username: "abelper8",
    issueNumber: 5,
    createdFileThisSession: true,
  });
  assert(result.bookBranch === safe, `Recreate new trunk t/neh/{taskId} when neh exists, got ${result.bookBranch}`);
  assert(result.workBranch === work, "Recreate work stays w/…");
  assert(fake.branches.neh === "oldbook", "filled neh leftover stays");
  assert(fake.branches[safe], "Recreate created t/neh/{taskId} instead of reusing neh");
  assert(fake.branches[work], "Recreate created w/ work ref on es-419_gl/es-419_glt");
  const posted = fake.calls.filter((c) => c.method === "POST" && c.path.endsWith("/branches"));
  assert(posted.every((c) => c.path.includes("/repos/es-419_gl/es-419_glt/")), "create hits es-419_gl/es-419_glt");
  assert(posted.some((c) => c.ref === safe), "POST t/neh/{taskId}");
  assert(posted.some((c) => c.ref === work), "POST w/ work branch");
}

{
  const work = portionPrBranchName({
    book: "NEH",
    username: "ana",
    taskId: "tpl-draft",
    issueNumber: 41,
  });
  const nested = nestedPortionPrBranchName({
    book: "NEH",
    username: "ana",
    taskId: "tpl-draft",
    issueNumber: 41,
  });
  const marker: PortionPrMarker = {
    schema: "gateway-portion-pr-1",
    owner: "es-419_gl",
    repo: "es-419_glt",
    number: 99,
    htmlUrl: "https://qa.door43.org/es-419_gl/es-419_glt/pulls/99",
    head: nested,
    base: "neh/tpl-draft",
    issueNumber: 0,
  };
  const fake = installFakeDcs({
    branches: {
      master: "abc123master",
      "neh/tpl-draft": "trunksha",
      [nested]: "oldwork",
    },
    files: { "neh/tpl-draft:16-NEH.usfm": "\\id NEH\n\\c 1\n\\v 1\n" },
    issues: {
      "es-419_gl/gateway-tasks/41": {
        number: 41,
        body: upsertPortionPrInBody("## NEH 1:1–8\n", marker),
      },
    },
    pulls: {
      "es-419_gl/es-419_glt/99": {
        number: 99,
        state: "open",
        html_url: marker.htmlUrl,
        head: { ref: nested },
        base: { ref: "neh/tpl-draft" },
      },
    },
  });
  const result = await recreateBookWorkspace({
    session,
    owner: "es-419_gl",
    repo: "es-419_glt",
    filepath: "16-NEH.usfm",
    book: "NEH",
    resource: "tpl",
    taskId: "tpl-draft",
    workBranch: work,
    username: "ana",
    issueNumber: 41,
    createdFileThisSession: true,
    closeOwnedPr: () =>
      closeOwnedPortionPrIfSafe({
        session,
        pmOrg: "es-419_gl",
        issueNumber: 41,
        owner: "es-419_gl",
        repo: "es-419_glt",
        workBranch: work,
        bookBranch: "neh/tpl-draft",
        username: "ana",
        book: "NEH",
        taskId: "tpl-draft",
      }),
  });
  assert(result.closedPr, "Recreate closed the antique PR");
  assert(result.unlinkedPr, "Recreate cleared the portion-PR marker");
  assert(result.workBranch === work, "Recreate remapped work to w/");
  assert(fake.branches[work], "new w/ head exists after Recreate");
  assert(!fake.branches[nested], "legacy nested work ref was deleted");
  assert(fake.pulls["es-419_gl/es-419_glt/99"]?.state === "closed", "PR 99 closed");
  assert(
    !parsePortionPrMarker(fake.issues["es-419_gl/gateway-tasks/41"]?.body),
    "issue marker dropped so Ver PR cannot reopen the old URL",
  );
}

{
  const work = portionPrBranchName({
    book: "NEH",
    username: "ana",
    taskId: "tpl-draft",
    issueNumber: 41,
  });
  const stale: PortionPrMarker = {
    schema: "gateway-portion-pr-1",
    owner: "es-419_gl",
    repo: "es-419_glt",
    number: 7,
    htmlUrl: "https://qa.door43.org/es-419_gl/es-419_glt/pulls/7",
    head: "antique-other-head",
    base: "master",
    issueNumber: 41,
  };
  const fake = installFakeDcs({
    branches: { master: "abc123master", [work]: "worksha" },
    files: {},
    issues: {
      "es-419_gl/gateway-tasks/41": {
        number: 41,
        body: upsertPortionPrInBody("texto", stale),
      },
    },
    pulls: {
      "es-419_gl/es-419_glt/7": {
        number: 7,
        state: "open",
        html_url: stale.htmlUrl,
        head: { ref: "antique-other-head" },
        base: { ref: "master" },
      },
    },
  });
  const visible = await resolveVisiblePortionPr({
    session,
    pmOrg: "es-419_gl",
    issue: {
      id: 41,
      number: 41,
      title: "x",
      body: fake.issues["es-419_gl/gateway-tasks/41"].body,
      state: "open",
      html_url: "https://qa.door43.org/es-419_gl/gateway-tasks/issues/41",
    },
    workBranch: work,
    username: "ana",
    book: "NEH",
    taskId: "tpl-draft",
  });
  assert(!visible.marker, "Ver PR hidden when stored head ≠ current work");
  assert(visible.dropped, "stale marker dropped");
  assert(
    !parsePortionPrMarker(fake.issues["es-419_gl/gateway-tasks/41"]?.body),
    "issue no longer points at the antique PR",
  );
}

{
  const fake = installFakeDcs({
    branches: { master: "abc123master" },
    files: {},
    ghost409: true,
  });
  let threw = false;
  try {
    await ensureBranchFrom(
      dcsConfig(session.host),
      "es-419_gl",
      "es-419_glt",
      "w/neh/tpl-draft/ana/41",
      session.token,
      "master",
    );
  } catch (err) {
    threw = true;
    const text = err instanceof Error ? err.message : String(err);
    assert(/409|no existe/i.test(text), `ghost 409 is surfaced, got: ${text}`);
    assert(text.includes("es-419_gl/es-419_glt"), "ghost 409 names the repo");
  }
  assert(threw, "do not claim success when POST /branches 409 has no visible ref");
  assert(!fake.branches["w/neh/tpl-draft/ana/41"], "ghost 409 did not create a branch");
}

const postsGitRefs = (calls: Call[]) => calls.some((c) => c.method === "POST" && c.path.endsWith("/git/refs"));
const postedBranches = (calls: Call[]) =>
  calls.filter((c) => c.method === "POST" && c.path.endsWith("/branches")).map((c) => c.ref);

{
  const work = portionPrBranchName({ book: "NEH", username: "ana", taskId: "tpl-draft", issueNumber: 41 });
  const fake = installFakeDcs({
    branches: { master: "abc123master", "neh/tpl-draft": "trunksha" },
    files: { "neh/tpl-draft:16-NEH.usfm": "\\id NEH\n\\c 1\n\\v 1\n" },
  });
  const saved = await saveUsfmOnPortionBranch({
    session,
    owner: "es-419_gl",
    repo: "es-419_glt",
    filepath: "16-NEH.usfm",
    content: "\\id NEH\n\\c 1\n\\v 1 Primer guardado\n",
    message: "TAS: NEH 1:1",
    branch: work,
    book: "NEH",
    resource: "tpl",
    taskId: "tpl-draft",
    username: "ana",
    issueNumber: 41,
  });
  assert(saved.branch === work, "first Guardar lands on the w/ borrador");
  assert(postedBranches(fake.calls).includes(work), "new w/ borrador is created with POST /branches");
  assert(!postsGitRefs(fake.calls), "first Guardar never calls POST git/refs");
  assert(!fake.ghosts.has(work), "new w/ borrador is not a ghost");
  assert(fake.branches[work] === "trunksha", "new w/ borrador starts at the borrador grupal tip");
  assert(fake.files[`${work}:16-NEH.usfm`]?.includes("Primer guardado"), "first Guardar wrote the file");
}

{
  const work = portionPrBranchName({ book: "NEH", username: "ana", taskId: "tpl-draft", issueNumber: 41 });
  const ghostSha = "ghostworksha";
  const fake = installFakeDcs({
    branches: { master: "abc123master", "neh/tpl-draft": "trunksha", [work]: ghostSha },
    ghosts: [work],
    files: {
      "neh/tpl-draft:16-NEH.usfm": "\\id NEH\n\\c 1\n\\v 1\n",
      [`${work}:16-NEH.usfm`]: "\\id NEH\n\\c 1\n\\v 1 Texto ya guardado\n",
    },
  });
  const task = await ensureTaskBranchFromBook({
    session,
    owner: "es-419_gl",
    repo: "es-419_glt",
    book: "NEH",
    taskId: "tpl-draft",
    filepath: "16-NEH.usfm",
    taskBranch: work,
    username: "ana",
    issueNumber: 41,
  });
  assert(task.workBranch === work, "ghost w/ keeps its name");
  const del = fake.calls.findIndex((c) => c.method === "DELETE" && c.path.endsWith(`/git/refs/heads/${work}`));
  const post = fake.calls.findIndex((c) => c.method === "POST" && c.path.endsWith("/branches") && c.ref === work);
  assert(del >= 0 && post > del, "ghost git ref deleted, then POST /branches");
  assert(!postsGitRefs(fake.calls), "ghost repair never calls POST git/refs");
  assert(fake.branches[work] === ghostSha, "ghost rebuilt from the SHA it already pointed at");
  assert(!fake.ghosts.has(work), "branch API sees the repaired borrador");
  const meta = await getContents(dcsConfig(session.host), "es-419_gl", "es-419_glt", "16-NEH.usfm", {
    token: session.token,
    ref: work,
  });
  assert(!Array.isArray(meta) && meta.sha, "contents API sees the file on the repaired borrador");
  assert(fake.files[`${work}:16-NEH.usfm`]?.includes("Texto ya guardado"), "saved verse text survives repair");
}

{
  const work = portionPrBranchName({ book: "NEH", username: "ana", taskId: "tpl-draft", issueNumber: 41 });
  const fake = installFakeDcs({
    branches: { master: "abc123master", "neh/tpl-draft": "trunksha", [work]: "ghostworksha" },
    ghosts: [work],
    files: { "neh/tpl-draft:16-NEH.usfm": "\\id NEH\n\\c 1\n\\v 1\n" },
  });
  const saved = await saveUsfmOnPortionBranch({
    session,
    owner: "es-419_gl",
    repo: "es-419_glt",
    filepath: "16-NEH.usfm",
    content: "\\id NEH\n\\c 1\n\\v 1 Guardar tras fantasma\n",
    message: "TAS: NEH 1:1",
    branch: work,
    sha: "sha-neh/tpl-draft:16-NEH.usfm",
    book: "NEH",
    resource: "tpl",
    taskId: "tpl-draft",
    username: "ana",
    issueNumber: 41,
  });
  assert(saved.branch === work, "Guardar on a ghost borrador succeeds without Administración");
  assert(fake.files[`${work}:16-NEH.usfm`]?.includes("Guardar tras fantasma"), "Guardar wrote after repair");
}

{
  const work = "w/neh/sin-grupal/ana/9";
  const fake = installFakeDcs({ branches: { master: "abc123master" }, files: {} });
  const result = await ensureBranchFrom(
    dcsConfig(session.host),
    "es-419_gl",
    "es-419_glt",
    work,
    session.token,
    "neh/sin-grupal",
    { fallbackSource: async () => "master" },
  );
  assert(result.created && result.base === "master", "missing borrador grupal falls back to principal");
  assert(fake.branches[work] === "abc123master", "w/ starts at the borrador principal tip");
  assert(postedBranches(fake.calls).includes(work), "fallback create uses POST /branches");
  assert(!postsGitRefs(fake.calls), "fallback create never calls POST git/refs");
}

{
  const archive = archiveRefName("NEH", 41);
  const fake = installFakeDcs({ branches: { master: "abc123master", "w/neh/t/ana/41": "worksha" }, files: {} });
  const res = await ensureArchiveRef(dcsConfig(session.host), "es-419_gl", "es-419_glt", archive, "worksha", session.token);
  assert(res.action === "create", "archive ref created on Cerrar");
  assert(postedBranches(fake.calls).includes(archive), "archive ref created with POST /branches");
  assert(!postsGitRefs(fake.calls), "archive create never calls POST git/refs");
  assert(fake.branches[archive] === "worksha" && !fake.ghosts.has(archive), "archive is a real branch at the work SHA");
}

{
  const archive = archiveRefName("NEH", 41);
  const fake = installFakeDcs({
    branches: { master: "abc123master", "w/neh/t/ana/41": "worksha", [archive]: "worksha" },
    ghosts: [archive],
    files: {},
  });
  await ensureArchiveRef(dcsConfig(session.host), "es-419_gl", "es-419_glt", archive, "worksha", session.token);
  assert(!fake.ghosts.has(archive), "ghost archive ref rebuilt as a real branch");
  assert(fake.branches[archive] === "worksha", "ghost archive keeps its SHA");
  assert(!postsGitRefs(fake.calls), "archive repair never calls POST git/refs");
}

console.log("verify-book-bootstrap: ok");
