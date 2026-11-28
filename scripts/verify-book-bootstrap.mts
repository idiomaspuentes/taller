/**
 * Mock DCS: missing book branch + missing USFM must create the branch
 * before creating the file. Run: npx tsx scripts/verify-book-bootstrap.mts
 */
import { ensureBookUsfm, ensureTaskBranchFromBook, recreateBookWorkspace } from "../src/dcs/bookBootstrap.ts";
import {
  closeOwnedPortionPrIfSafe,
  resolveVisiblePortionPr,
  retireEarlierPull,
  saveUsfmOnPortionBranch,
} from "../src/dcs/portionPr.ts";
import { BootstrapError, explainRepoFileError } from "../src/dcs/repoFile.ts";
import {
  createOrFindPull,
  deleteArchivedWorkBranch,
  ensureArchiveRef,
  ensureBranchFrom,
  ensurePhaseTag,
  findOpenPullBetween,
  getArchiveSha,
  getPullByBranches,
} from "../src/dcs/pulls.ts";
import { dcsConfig } from "../src/dcs/config.ts";
import { getContents } from "@ip-lms/dcs-client";
import {
  archiveRefName,
  bookBranchName,
  legacyTaskBranchName,
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
import { HelpsConflictError, saveOwnHelps, type HelpsFile } from "../src/dcs/ownHelpsSave.ts";
import { saveOwnText } from "../src/dcs/ownTextSave.ts";
import { writeRefusedStatus } from "../src/dcs/repoFile.ts";
import { tsvRowsToDraftItems } from "../src/domain/helpsDraft.ts";
import { parseTsvTable } from "../src/prep/tsv.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

type Call = { method: string; path: string; ref?: string; sha?: string };

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
    scopesVersion: 3,
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
  /** As Door43 does: `GET pulls/{base}/{head}` answers 404 when a branch name has a slash, even with a pull there. */
  pairRouteMissesSlashes?: boolean;
  /** How many times `GET /pulls/{n}` fails with a passing 500 before it answers. */
  pullGet500?: number;
  /** `GET /pulls` (the list) fails with a 500. */
  pullList500?: boolean;
  /** `POST /pulls` is refused with a 409 whatever is open. */
  pullPost409?: boolean;
  /** Door43 gives at most this many rows a page, whatever `limit` asks. */
  pageCap?: number;
  ghost409?: boolean;
  /** Names in `branches` that only exist as git refs (branch + contents APIs 404). */
  ghosts?: string[];
  /** Names Door43 still lists whose git ref is gone (the branch API answers 500). */
  listedGone?: string[];
  /** How many times `GET /branches/{name}` fails with a passing 500 before it answers. */
  branchGet500?: Record<string, number>;
  /** `DELETE /branches/{name}` fails with a 500 while the branch is there. */
  branchDelete500?: boolean;
  tags?: Record<string, string>;
  /**
   * As git and Door43 do it: a branch is cut with the files of the one it is cut from, a file's sha changes when it
   * is written, an update with another sha is refused (409), and a create over a file that is there too (422).
   */
  gitLike?: boolean;
}) {
  const tags: Record<string, string> = { ...opts.tags };
  const branches = { ...opts.branches };
  const ghosts = new Set(opts.ghosts ?? []);
  // Door43's own list of branches, apart from git: what `git/refs` changes, it does not see.
  const rows = new Set([...Object.keys(branches).filter((name) => !ghosts.has(name)), ...(opts.listedGone ?? [])]);
  const branchGet500 = { ...opts.branchGet500 };
  const commits = new Set(Object.values(branches));
  const files = { ...opts.files };
  const shas: Record<string, string> = {};
  let writes = 0;
  const shaOf = (key: string) => shas[key] ?? `sha-${key}`;
  /** A branch cut from `from` (a branch, or the commit of one) has its files. */
  const copyFiles = (name: string, from: string) => {
    if (!opts.gitLike) return;
    const source = branches[from] ? from : Object.keys(branches).find((b) => b !== name && branches[b] === from);
    if (!source) return;
    for (const key of Object.keys(files)) {
      if (!key.startsWith(`${source}:`)) continue;
      const to = `${name}:${key.slice(source.length + 1)}`;
      files[to] = files[key]!;
      shas[to] = shaOf(key);
    }
  };
  const issues = { ...(opts.issues ?? {}) };
  const pulls = { ...(opts.pulls ?? {}) };
  const pullGet500: { left?: number } = { left: opts.pullGet500 };
  /** Comments by `owner/repo/number` (an issue or a pull: Door43 keeps both the same way). */
  const comments: Record<string, string[]> = {};
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

    const commentMatch = rest.match(/^\/issues\/(\d+)\/comments$/);
    if (commentMatch && method === "POST") {
      const key = `${owner}/${repo}/${commentMatch[1]}`;
      const body = String((JSON.parse(String(init?.body || "{}")) as { body?: string }).body ?? "");
      (comments[key] ??= []).push(body);
      return json({ id: Object.values(comments).flat().length, body }, 201);
    }

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

    if (rest === "/pulls" && method === "GET") {
      if (opts.pullList500) return json({ message: "internal error" }, 500);
      const state = parsed.url.searchParams.get("state") || "open";
      const limit = Math.min(Number(parsed.url.searchParams.get("limit") || "30"), opts.pageCap ?? Infinity);
      const page = Number(parsed.url.searchParams.get("page") || "1");
      const rows = Object.entries(pulls)
        .filter(([key, row]) => key.startsWith(`${owner}/${repo}/`) && (state === "all" || row.state === state))
        .map(([, row]) => row);
      return json(rows.slice((page - 1) * limit, page * limit));
    }
    if (rest === "/pulls" && method === "POST") {
      const body = JSON.parse(String(init?.body || "{}")) as { head: string; base: string; title?: string };
      const open = Object.entries(pulls).some(
        ([key, row]) => key.startsWith(`${owner}/${repo}/`) && row.state === "open" && row.head?.ref === body.head && row.base?.ref === body.base,
      );
      if (open || opts.pullPost409) return json({ message: "pull request already exists for these targets" }, 409);
      const number = Object.keys(pulls).filter((key) => key.startsWith(`${owner}/${repo}/`)).length + 100;
      const pull: FakePull = {
        number,
        state: "open",
        title: body.title,
        html_url: `https://qa.door43.org/${owner}/${repo}/pulls/${number}`,
        head: { ref: body.head },
        base: { ref: body.base },
      };
      pulls[`${owner}/${repo}/${number}`] = pull;
      return json(pull, 201);
    }

    const pullIdMatch = rest.match(/^\/pulls\/(\d+)$/);
    if (pullIdMatch) {
      const key = `${owner}/${repo}/${pullIdMatch[1]}`;
      if (method === "GET") {
        if ((pullGet500.left ?? 0) > 0) {
          pullGet500.left! -= 1;
          return json({ message: "internal error" }, 500);
        }
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
      if (opts.pairRouteMissesSlashes && (base.includes("/") || head.includes("/"))) return notFound();
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
        if ((branchGet500[name] ?? 0) > 0) {
          branchGet500[name]!--;
          return json({ message: "" }, 500);
        }
        if (!rows.has(name)) return notFound();
        if (!branches[name]) return json({ message: "" }, 500);
        return json({ name, commit: { id: branches[name] } });
      }
      if (method === "DELETE" && branchMatch[1]) {
        const name = branchMatch[1].split("/").map((part) => decodeURIComponent(part)).join("/");
        if (!rows.has(name)) return notFound();
        if (opts.branchDelete500) return json({ message: "" }, 500);
        delete branches[name];
        rows.delete(name);
        return new Response(null, { status: 204 });
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
        rows.add(name);
        copyFiles(name, from);
        return json({ name, commit: { id: sha } }, 201);
      }
    }

    const tagMatch = rest.match(/^\/tags(?:\/(.+))?$/);
    if (tagMatch) {
      const name = (tagMatch[1] || "").split("/").map((part) => decodeURIComponent(part)).join("/");
      if (method === "POST" && !name) {
        const body = JSON.parse(String(init?.body || "{}")) as { tag_name?: string; target?: string };
        call.ref = body.tag_name;
        if (!body.tag_name || !body.target) return json({ message: "missing" }, 422);
        if (tags[body.tag_name]) return json({ message: "tag already exists" }, 409);
        tags[body.tag_name] = body.target;
        return json({ name: body.tag_name, commit: { sha: body.target } }, 201);
      }
      if (method === "GET" && name) return tags[name] ? json({ name, commit: { sha: tags[name] } }) : notFound();
      if (method === "DELETE" && name) {
        if (!tags[name]) return notFound();
        delete tags[name];
        return new Response(null, { status: 204 });
      }
    }

    const refMatch = rest.match(/^\/git\/refs(?:\/heads\/(.+))?$/);
    if (refMatch) {
      if (method === "POST") {
        const body = JSON.parse(String(init?.body || "{}")) as { ref?: string; target?: string };
        const name = (body.ref || "").replace(/^refs\/heads\//, "");
        const sha = body.target;
        call.ref = name;
        if (!name || !sha) return json({ message: "Unable to form reference" }, 422);
        if (opts.ghost409) return json({ message: "already exists" }, 409);
        if (branches[name]) return json({ message: "already exists" }, 409);
        if (!rows.has(name)) ghosts.add(name);
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
        copyFiles(name, sha);
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
          sha: shaOf(key),
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
          sha?: string;
        };
        const dest = body.new_branch || body.branch || ref;
        call.ref = dest;
        call.sha = body.sha;
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
          rows.add(body.new_branch);
        }
        const text = body.content ? Buffer.from(body.content, "base64").toString("utf8") : "";
        const key = `${dest}:${filepath}`;
        if (opts.gitLike && !body.new_branch) {
          if (body.sha && (files[key] == null || body.sha !== shaOf(key))) return json({ message: "sha does not match" }, 409);
          if (!body.sha && files[key] != null) return json({ message: "repository file already exists" }, 422);
        }
        files[key] = text;
        if (opts.gitLike) shas[key] = `sha-${key}#${++writes}`;
        return json({
          content: {
            name: filepath,
            path: filepath,
            sha: shaOf(key),
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
    tags,
    branches,
    ghosts,
    files,
    issues,
    pulls,
    comments,
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
  assert(result.bookBranch === "borrador/neh/tpl-draft", `book branch is libro/tarea, got ${result.bookBranch}`);
  assert(result.createdBranch, "created missing book branch");
  assert(result.createdFile, "created missing USFM");
  assert(result.usfm.includes("\\id NEH"), "skeleton has id");
  assert(result.usfm.includes("\\v 10"), "skeleton has verse 10");
  assert(fake.branches["borrador/neh/tpl-draft"], "borrador/neh/tpl-draft ref exists");
  assert(fake.files["borrador/neh/tpl-draft:16-NEH.usfm"], "file exists on book branch");
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
  assert(!fake.branches["borrador/neh/tpl-draft"], "do not orphan-create the new name when legacy exists");
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
  assert(!fake.branches["borrador/neh/tpl-draft"], "do not orphan-create libro/tarea when afinacion exists");
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
  assert(result.bookBranch === "borrador/neh/tpl-draft", `custom Revisión must not name the branch, got ${result.bookBranch}`);
  assert(fake.branches["borrador/neh/tpl-draft"], "borrador/neh/tpl-draft ref exists");
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
  assert(!fake.branches["borrador/neh/tpl-draft"], "do not orphan-create libro/tarea when old phase ref exists");
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

assert(bookBranchName("NEH", "tpl-draft") === "borrador/neh/tpl-draft", "NEH uses libro/tarea");
assert(bookBranchName("NEH") === "borrador/neh/tarea", "missing task is not a phase slug");
assert(legacyPhaseBookBranchName("NEH", "fase-1") === "fase-1/neh", "old phase name kept for reuse");

{
  const fake = installFakeDcs({
    branches: {
      master: "abc123master",
      "borrador/neh/tpl-draft": "halfcreated",
      "borrador/neh/tpl-draft/ana/41": "halfcreated",
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
    workBranch: "borrador/neh/tpl-draft/ana/41",
    username: "ana",
    issueNumber: 41,
    createdFileThisSession: true,
  });
  assert(result.wipedTrunk, "missing/broken trunk file is recreated");
  assert(result.deletedWorkBranch, "work branch was deleted");
  assert(result.workBranch === "trabajo/neh/tpl-draft/ana/41", "work remapped off the trunk");
  assert(fake.branches["borrador/neh/tpl-draft"], "trunk recreated");
  assert(fake.branches["trabajo/neh/tpl-draft/ana/41"], "work branch recreated from trunk");
  assert(!fake.branches["borrador/neh/tpl-draft/ana/41"], "do not recreate nested work under trunk");
  assert(fake.files["borrador/neh/tpl-draft:16-NEH.usfm"], "skeleton written on trunk");
  // Through `git/refs`: Door43's branch API would move or close the reviews others have open on the group draft.
  const deleteTrunk = fake.calls.findIndex((c) => c.method === "DELETE" && c.path.includes("/git/refs/heads/borrador/neh/tpl-draft") && !c.path.includes("/ana/"));
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
      "borrador/neh/tpl-draft": "trunksha",
      "trabajo/neh/tpl-draft/ana/41": "oldwork",
    },
    files: { "borrador/neh/tpl-draft:16-NEH.usfm": filled },
  });
  const result = await recreateBookWorkspace({
    session,
    owner: "es-419_gl",
    repo: "es-419_glt",
    filepath: "16-NEH.usfm",
    book: "NEH",
    resource: "tpl",
    taskId: "tpl-draft",
    workBranch: "trabajo/neh/tpl-draft/ana/41",
    username: "ana",
    issueNumber: 41,
    createdFileThisSession: true,
  });
  assert(result.reusedTrunk, "filled trunk is reused");
  assert(!result.wipedTrunk, "do not wipe other people's verses");
  assert(fake.files["borrador/neh/tpl-draft:16-NEH.usfm"] === filled, "trunk USFM unchanged");
  assert(fake.branches["borrador/neh/tpl-draft"] === "trunksha", "trunk ref not deleted");
  assert(fake.branches["trabajo/neh/tpl-draft/ana/41"] === "trunksha", "fresh work branch from trunk SHA");
  assert(
    fake.calls.some((c) => c.method === "DELETE" && c.path.includes("/branches/trabajo/neh/tpl-draft/ana/41")),
    "the old work branch is deleted through Door43's branch API, so its list of branches stays right",
  );
  assert(
    !fake.calls.some((c) => c.method === "POST" && c.path.endsWith("/git/refs")),
    "no git ref had to be put back behind Door43's list",
  );
}

{
  // Without a subtarea nothing says whose a branch is: the one the editor had open may be the group's.
  const fake = installFakeDcs({
    branches: {
      master: "abc123master",
      "borrador/neh/tpl-draft": "trunksha",
      "borrador/neh/otra-tarea": "othertrunk",
      "trabajo/neh/tpl-draft/ana/41": "oldwork",
    },
    files: { "borrador/neh/tpl-draft:16-NEH.usfm": "\\id NEH\n\\c 1\n\\v 1 Texto\n" },
  });
  await recreateBookWorkspace({
    session,
    owner: "es-419_gl",
    repo: "es-419_glt",
    filepath: "16-NEH.usfm",
    book: "NEH",
    resource: "tpl",
    taskId: "tpl-draft",
    workBranch: "trabajo/neh/tpl-draft/ana/41",
    extraWorkBranches: ["borrador/neh/otra-tarea"],
    username: "ana",
    issueNumber: 0,
    createdFileThisSession: true,
  });
  assert(fake.branches["borrador/neh/otra-tarea"] === "othertrunk", "no subtarea: a branch that is not the work branch stays");
  assert(!fake.calls.some((c) => c.method === "DELETE" && c.path.includes("otra-tarea")), "and nothing is asked to delete it");
}

{
  // «Rehacer» on a branch already listed with no git ref, when Door43 answers 500 to deleting it.
  const fake = installFakeDcs({
    branches: { master: "abc123master", "borrador/neh/tpl-draft": "trunksha" },
    files: { "borrador/neh/tpl-draft:16-NEH.usfm": "\\id NEH\n\\c 1\n\\v 1 Texto\n" },
    listedGone: ["trabajo/neh/tpl-draft/ana/41"],
    branchDelete500: true,
  });
  const result = await recreateBookWorkspace({
    session,
    owner: "es-419_gl",
    repo: "es-419_glt",
    filepath: "16-NEH.usfm",
    book: "NEH",
    resource: "tpl",
    taskId: "tpl-draft",
    workBranch: "trabajo/neh/tpl-draft/ana/41",
    username: "ana",
    issueNumber: 41,
    createdFileThisSession: true,
  });
  assert(!result.deletedWorkBranch, "nothing was there to delete");
  assert(fake.branches["trabajo/neh/tpl-draft/ana/41"] === "trunksha", "and the draft is made again");
}

{
  // A ghost: a git ref Door43's list does not have. The branch API answers 404, and only `git/refs` can take it.
  const fake = installFakeDcs({
    branches: { master: "abc123master", "borrador/neh/tpl-draft": "trunksha", "trabajo/neh/tpl-draft/ana/41": "ghostwork" },
    files: { "borrador/neh/tpl-draft:16-NEH.usfm": "\\id NEH\n\\c 1\n\\v 1 Texto\n" },
    ghosts: ["trabajo/neh/tpl-draft/ana/41"],
  });
  const result = await recreateBookWorkspace({
    session,
    owner: "es-419_gl",
    repo: "es-419_glt",
    filepath: "16-NEH.usfm",
    book: "NEH",
    resource: "tpl",
    taskId: "tpl-draft",
    workBranch: "trabajo/neh/tpl-draft/ana/41",
    username: "ana",
    issueNumber: 41,
    createdFileThisSession: true,
  });
  assert(result.deletedWorkBranch, "the ghost is deleted");
  assert(fake.calls.some((c) => c.method === "DELETE" && c.path.includes("/git/refs/heads/trabajo/neh/tpl-draft/ana/41")), "through git/refs");
  assert(fake.branches["trabajo/neh/tpl-draft/ana/41"] === "trunksha", "and made again");
}

const openWork = {
  session,
  owner: "es-419_gl",
  repo: "es-419_glt",
  book: "NEH",
  resource: "tpl",
  taskId: "tpl-draft",
  filepath: "16-NEH.usfm",
  taskBranch: "trabajo/neh/tpl-draft/ana/41",
  username: "ana",
  issueNumber: 41,
};

{
  // NEH 1:1–3 on 17 November: an earlier redo deleted the work branch's git ref by hand; Door43 still listed it and
  // its branch API answered 500, so the draft could not be made again. Opening it now puts it back.
  const fake = installFakeDcs({
    branches: { master: "abc123master", "borrador/neh/tpl-draft": "trunksha" },
    files: { "borrador/neh/tpl-draft:16-NEH.usfm": "\\id NEH\n\\c 1\n\\v 1 Texto\n" },
    listedGone: ["trabajo/neh/tpl-draft/ana/41"],
  });
  const opened = await ensureTaskBranchFromBook(openWork);
  assert(opened.workBranch === "trabajo/neh/tpl-draft/ana/41", "the same work branch, by its name");
  assert(opened.created && opened.restored === true, "the editor is told, so what the device keeps is not taken as saved");
  assert(fake.branches["trabajo/neh/tpl-draft/ana/41"] === "trunksha", "listed with no git ref: made again at the group draft");
  assert(!fake.calls.some((c) => c.method === "DELETE"), "opening a draft deletes nothing");
}

{
  // A passing failure of Door43 on a branch with saved work: it is asked again, and nothing is deleted or moved.
  const fake = installFakeDcs({
    branches: { master: "abc123master", "borrador/neh/tpl-draft": "trunksha", "trabajo/neh/tpl-draft/ana/41": "savedwork" },
    files: { "borrador/neh/tpl-draft:16-NEH.usfm": "\\id NEH\n\\c 1\n\\v 1 Texto\n" },
    branchGet500: { "trabajo/neh/tpl-draft/ana/41": 4 },
  });
  const opened = await ensureTaskBranchFromBook(openWork);
  assert(!opened.created && !opened.restored, "a branch with its commit is not made again");
  assert(fake.branches["trabajo/neh/tpl-draft/ana/41"] === "savedwork", "the saved work stays where it was");
  assert(!fake.calls.some((c) => c.method === "DELETE"), "a passing 500 deletes nothing");
}

{
  // The same failure that does not pass: the person sees the error, and the branch is untouched.
  const fake = installFakeDcs({
    branches: { master: "abc123master", "borrador/neh/tpl-draft": "trunksha", "trabajo/neh/tpl-draft/ana/41": "savedwork" },
    files: { "borrador/neh/tpl-draft:16-NEH.usfm": "\\id NEH\n\\c 1\n\\v 1 Texto\n" },
    branchGet500: { "trabajo/neh/tpl-draft/ana/41": 100 },
  });
  const failed = await ensureTaskBranchFromBook(openWork).then(() => false, () => true);
  assert(failed, "a 500 that lasts is said");
  assert(fake.branches["trabajo/neh/tpl-draft/ana/41"] === "savedwork", "and the saved work stays");
  assert(!fake.calls.some((c) => c.method === "DELETE"), "and nothing is deleted");
}

{
  // «Rehacer» when Door43 refuses to delete the branch: never the old way under it, which would leave it listed.
  const fake = installFakeDcs({
    branches: { master: "abc123master", "borrador/neh/tpl-draft": "trunksha", "trabajo/neh/tpl-draft/ana/41": "savedwork" },
    files: { "borrador/neh/tpl-draft:16-NEH.usfm": "\\id NEH\n\\c 1\n\\v 1 Texto\n" },
    branchDelete500: true,
  });
  const failed = await recreateBookWorkspace({
    session,
    owner: "es-419_gl",
    repo: "es-419_glt",
    filepath: "16-NEH.usfm",
    book: "NEH",
    resource: "tpl",
    taskId: "tpl-draft",
    workBranch: "trabajo/neh/tpl-draft/ana/41",
    username: "ana",
    issueNumber: 41,
    createdFileThisSession: true,
  }).then(() => false, () => true);
  assert(failed, "the failed delete is said");
  assert(fake.branches["trabajo/neh/tpl-draft/ana/41"] === "savedwork", "the branch stays");
  assert(!fake.calls.some((c) => c.method === "DELETE" && c.path.includes("/git/refs/")), "no delete through git/refs");
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
  assert(trunk === `borrador/neh/${uuid}`, "UUID trunk is borrador/libro/tarea");
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
    "Ya existe el borrador «trabajo»; no se puede crear «trabajo/neh/task/ana/5».",
    "task-branch",
    500,
    undefined,
    "trabajo/neh/task/ana/5",
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
  assert(msg.includes("trabajo/neh/task/ana/5"), "alert uses the failing ref from the error");
  assert(msg.includes("Ya existe el borrador") || msg.includes("HTTP 500"), "500 is diagnosed");
}

{
  const fake = installFakeDcs({
    branches: { master: "abc123master", "borrador/neh/tpl-draft": "trunksha" },
    files: { "borrador/neh/tpl-draft:16-NEH.usfm": "\\id NEH\n\\c 1\n\\v 1\n" },
  });
  let threw = false;
  try {
    const { ensureBranchFrom } = await import("../src/dcs/pulls.ts");
    const { dcsConfig } = await import("../src/dcs/config.ts");
    await ensureBranchFrom(
      dcsConfig(session.host),
      "es-419_gl",
      "es-419_glt",
      "borrador/neh/tpl-draft/ana/41",
      session.token,
      "borrador/neh/tpl-draft",
    );
  } catch (err) {
    threw = true;
    const text = err instanceof Error ? err.message : String(err);
    assert(/Ya existe el borrador|cuelgan|500/i.test(text), `nested create is diagnosed, got: ${text}`);
  }
  assert(threw, "creating a git child of the trunk must fail");
  assert(
    !fake.calls.some((c) => c.method === "POST" && c.ref === "borrador/neh/tpl-draft/ana/41"),
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
  // A leftover `neh` used to stand in the way of `neh/{taskId}`; a draft under its own word is never in that spot.
  assert(boot.bookBranch === preferred, `a leftover neh does not move the draft, got ${boot.bookBranch}`);
  assert(task.bookBranch === preferred, "work forks from the draft");
  assert(task.workBranch === work, "work stays trabajo/neh/task/user/issue");
  assert(fake.branches.neh === "oldbook", "do not delete leftover neh");
  assert(fake.branches[preferred], "created borrador/neh/task");
  const posted = fake.calls.filter((c) => c.method === "POST" && c.path.endsWith("/branches")).map((c) => c.ref);
  assert(!posted.includes(safe) && !posted.includes(legacyTaskBranchName("NEH", uuid)), "the older names are never created again");
  assert(posted.includes(work), "POST work ref");
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
    "do not start a new draft when reusing neh",
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
  assert(result.bookBranch === preferred, `Recreate uses the draft of the task when neh exists, got ${result.bookBranch}`);
  assert(result.workBranch === `trabajo/neh/${uuid}/abelper8/5`, "Recreate work stays trabajo/…");
  assert(fake.branches.neh === "oldbook", "Recreate does not delete production neh");
  assert(fake.branches[preferred], "Recreate created borrador/neh/{taskId}");
  assert(fake.files[`${preferred}:16-NEH.usfm`], "skeleton written on the draft");
  const posted = fake.calls.filter((c) => c.method === "POST" && c.path.endsWith("/branches")).map((c) => c.ref);
  assert(!posted.includes(safe), "Recreate never creates the older t/ name");
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
  const safe = bookBranchName("NEH", uuid);
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
  assert(result.bookBranch === safe, `Recreate starts the draft of the task when neh exists, got ${result.bookBranch}`);
  assert(result.workBranch === work, "Recreate work stays trabajo/…");
  assert(fake.branches.neh === "oldbook", "filled neh leftover stays");
  assert(fake.branches[safe], "Recreate created borrador/neh/{taskId} instead of reusing neh");
  assert(fake.branches[work], "Recreate created the work ref on es-419_gl/es-419_glt");
  const posted = fake.calls.filter((c) => c.method === "POST" && c.path.endsWith("/branches"));
  assert(posted.every((c) => c.path.includes("/repos/es-419_gl/es-419_glt/")), "create hits es-419_gl/es-419_glt");
  assert(posted.some((c) => c.ref === safe), "POST borrador/neh/{taskId}");
  assert(posted.some((c) => c.ref === work), "POST work branch");
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
    base: "borrador/neh/tpl-draft",
    issueNumber: 0,
  };
  const fake = installFakeDcs({
    branches: {
      master: "abc123master",
      "borrador/neh/tpl-draft": "trunksha",
      [nested]: "oldwork",
    },
    files: { "borrador/neh/tpl-draft:16-NEH.usfm": "\\id NEH\n\\c 1\n\\v 1\n" },
    issues: {
      "es-419_gl/taller/41": {
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
        base: { ref: "borrador/neh/tpl-draft" },
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
        bookBranch: "borrador/neh/tpl-draft",
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
    !parsePortionPrMarker(fake.issues["es-419_gl/taller/41"]?.body),
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
      "es-419_gl/taller/41": {
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
      body: fake.issues["es-419_gl/taller/41"].body,
      state: "open",
      html_url: "https://qa.door43.org/es-419_gl/taller/issues/41",
    },
    workBranch: work,
    username: "ana",
    book: "NEH",
    taskId: "tpl-draft",
  });
  assert(!visible.marker, "Ver PR hidden when stored head ≠ current work");
  assert(visible.dropped, "stale marker dropped");
  assert(
    !parsePortionPrMarker(fake.issues["es-419_gl/taller/41"]?.body),
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
      "trabajo/neh/tpl-draft/ana/41",
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
  assert(!fake.branches["trabajo/neh/tpl-draft/ana/41"], "ghost 409 did not create a branch");
}

const postsGitRefs = (calls: Call[]) => calls.some((c) => c.method === "POST" && c.path.endsWith("/git/refs"));
const postedBranches = (calls: Call[]) =>
  calls.filter((c) => c.method === "POST" && c.path.endsWith("/branches")).map((c) => c.ref);

{
  const work = portionPrBranchName({ book: "NEH", username: "ana", taskId: "tpl-draft", issueNumber: 41 });
  const fake = installFakeDcs({
    branches: { master: "abc123master", "borrador/neh/tpl-draft": "trunksha" },
    files: { "borrador/neh/tpl-draft:16-NEH.usfm": "\\id NEH\n\\c 1\n\\v 1\n" },
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
    branches: { master: "abc123master", "borrador/neh/tpl-draft": "trunksha", [work]: ghostSha },
    ghosts: [work],
    files: {
      "borrador/neh/tpl-draft:16-NEH.usfm": "\\id NEH\n\\c 1\n\\v 1\n",
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
    branches: { master: "abc123master", "borrador/neh/tpl-draft": "trunksha", [work]: "ghostworksha" },
    ghosts: [work],
    files: { "borrador/neh/tpl-draft:16-NEH.usfm": "\\id NEH\n\\c 1\n\\v 1\n" },
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
  const work = "trabajo/neh/sin-grupal/ana/9";
  const fake = installFakeDcs({ branches: { master: "abc123master" }, files: {} });
  const result = await ensureBranchFrom(
    dcsConfig(session.host),
    "es-419_gl",
    "es-419_glt",
    work,
    session.token,
    "borrador/neh/sin-grupal",
    { fallbackSource: async () => "master" },
  );
  assert(result.created && result.base === "master", "missing borrador grupal falls back to principal");
  assert(fake.branches[work] === "abc123master", "w/ starts at the borrador principal tip");
  assert(postedBranches(fake.calls).includes(work), "fallback create uses POST /branches");
  assert(!postsGitRefs(fake.calls), "fallback create never calls POST git/refs");
}

// ── The archive of a delivery is a tag, and the work branch goes once the tag has its commit ──

const postedTags = (calls: Call[]) => calls.filter((c) => c.method === "POST" && c.path.endsWith("/tags")).map((c) => c.ref);
const cfg = dcsConfig(session.host);
const at = ["es-419_gl", "es-419_glt"] as const;

{
  const archive = archiveRefName("NEH", 41);
  const work = "trabajo/neh/t/ana/41";
  const fake = installFakeDcs({ branches: { master: "abc123master", [work]: "worksha" }, files: {} });
  const res = await ensureArchiveRef(cfg, ...at, archive, "worksha", session.token);
  assert(res.action === "create", "archive created on Cerrar");
  assert(postedTags(fake.calls).includes(archive) && fake.tags[archive] === "worksha", "the archive is a tag at the work commit");
  assert(!fake.branches[archive] && !postedBranches(fake.calls).includes(archive), "and never a branch: it stays out of the list of branches");
  assert(!postsGitRefs(fake.calls), "archive create never calls POST git/refs");
  assert((await getArchiveSha(cfg, ...at, archive, session.token)) === "worksha", "whoever reads the archive finds the tag");

  const again = await ensureArchiveRef(cfg, ...at, archive, "worksha", session.token);
  assert(again.action === "noop" && postedTags(fake.calls).length === 1, "same commit: nothing is written again");

  assert(await deleteArchivedWorkBranch(cfg, ...at, work, archive, session.token), "delivered: the work branch goes");
  assert(!fake.branches[work] && fake.tags[archive] === "worksha", "after a delivery the tag stays and the work branch does not");
}

{
  // Delivered again after more work: the tag is removed and made at the new commit.
  const archive = archiveRefName("NEH", 41);
  const fake = installFakeDcs({ branches: { master: "abc123master", "trabajo/neh/t/ana/41": "newsha" }, tags: { [archive]: "oldsha" }, files: {} });
  const res = await ensureArchiveRef(cfg, ...at, archive, "newsha", session.token);
  assert(res.action === "update" && fake.tags[archive] === "newsha", "a second delivery points the tag at the new commit");
  const del = fake.calls.findIndex((c) => c.method === "DELETE" && c.path.endsWith(`/tags/${archive}`));
  const post = fake.calls.findIndex((c) => c.method === "POST" && c.path.endsWith("/tags"));
  assert(del >= 0 && post > del, "a tag cannot be moved: removed, then made");
}

{
  // The branch is never removed unless the tag holds the very commit it is on.
  const archive = archiveRefName("NEH", 41);
  const work = "trabajo/neh/t/ana/41";
  const fake = installFakeDcs({ branches: { master: "abc123master", [work]: "worksha", "borrador/neh/t": "trunksha" }, tags: { [archive]: "othersha" }, files: {} });
  assert(!(await deleteArchivedWorkBranch(cfg, ...at, work, archive, session.token)) && fake.branches[work], "tag on another commit: the branch stays");
  delete fake.tags[archive];
  assert(!(await deleteArchivedWorkBranch(cfg, ...at, work, archive, session.token)) && fake.branches[work], "no tag: the branch stays");
  fake.tags[archive] = "trunksha";
  assert(!(await deleteArchivedWorkBranch(cfg, ...at, "borrador/neh/t", archive, session.token)) && fake.branches["borrador/neh/t"], "a group draft is never removed, whatever the tag says");
  assert(!(await deleteArchivedWorkBranch(cfg, ...at, "master", archive, session.token)), "nor the published branch");
  let refused = false;
  await ensureArchiveRef(cfg, ...at, work, "worksha", session.token).catch(() => (refused = true));
  assert(refused && !fake.tags[work], "only an archive name can be tagged");
}

{
  // A book delivered before the archive was a tag has it as a branch: it is still read, and the tag takes its place.
  const archive = archiveRefName("NEH", 41);
  const fake = installFakeDcs({ branches: { master: "abc123master", [archive]: "oldsha" }, files: {} });
  assert((await getArchiveSha(cfg, ...at, archive, session.token)) === "oldsha", "an older archive branch is still read");
  await ensureArchiveRef(cfg, ...at, archive, "newsha", session.token);
  assert(fake.tags[archive] === "newsha" && !fake.branches[archive], "delivered again: the tag stands for it, with no branch of the same name");
}

{
  // The mark of a phase: a tag on the group draft, moved when the phase closes again.
  const fake = installFakeDcs({ branches: { master: "abc123master", "borrador/neh/t": "trunksha" }, files: {} });
  const res = await ensurePhaseTag(cfg, ...at, "fase/neh/traduccion", "trunksha", session.token);
  assert(res.action === "create" && fake.tags["fase/neh/traduccion"] === "trunksha", "phase closed: its tag is on the draft's commit");
  assert((await ensurePhaseTag(cfg, ...at, "fase/neh/traduccion", "latersha", session.token)).action === "update" && fake.tags["fase/neh/traduccion"] === "latersha", "closed again: the tag moves");
  assert(fake.branches["borrador/neh/t"] === "trunksha", "the draft itself is not touched");
  let refused = false;
  await ensurePhaseTag(cfg, ...at, "borrador/neh/t", "trunksha", session.token).catch(() => (refused = true));
  assert(refused && !fake.tags["borrador/neh/t"], "only a phase name can be tagged as a phase");
}

// ---------------------------------------------------------------- the chunk marks of the source

/** Nehemiah 1 of a source text: a chunk at 1:1 and another at 1:3. */
const SOURCE = "\\id NEH EN_ULT\n\\usfm 3.0\n\\mt Nehemiah\n\n\\ts\\*\n\\c 1\n\\p\n\\v 1 The words.\n\\v 2 And Hanani came.\n\n\\ts\\*\n\\p\n\\v 3 And they said.\n";
const PUBLISHED = "\\id NEH\n\\usfm 3.0\n\\mt Nehemías\n\\c 1\n\\p\n\\v 1 Las palabras.\n\\v 2 Y Hanani vino.\n\\p\n\\v 3 Y dijeron.\n";
const WITH_MARKS = "\\id NEH\n\\usfm 3.0\n\\mt Nehemías\n\n\\ts\\*\n\\c 1\n\\p\n\\v 1 Las palabras.\n\\v 2 Y Hanani vino.\n\n\\ts\\*\n\\p\n\\v 3 Y dijeron.\n";
const book = { session, owner: "es-419_gl", repo: "es-419_glt", filepath: "16-NEH.usfm", book: "NEH", resource: "tpl", taskId: "tpl" };
const writes = (calls: Call[]) => calls.filter((c) => (c.method === "POST" || c.method === "PUT") && c.path.includes("/contents/16-NEH.usfm")).length;

{
  // A book begun here is born with the chunks of its source.
  const fake = installFakeDcs({ branches: { master: "abc123master" }, files: {} });
  const result = await ensureBookUsfm({ ...book, lang: "es-419", loadSource: async () => SOURCE });
  assert(result.createdFile && fake.files["borrador/neh/tpl:16-NEH.usfm"] === result.usfm, "the new book is on the group's draft");
  assert(result.usfm.includes("\n\n\\ts\\*\n\\c 1\n\\p\n\\v 1\n\\v 2\n\n\\ts\\*\n\\p\n\\v 3\n"), `a new book has the chunk marks of its source, got ${JSON.stringify(result.usfm)}`);
  assert(!/words|Hanani/.test(result.usfm), "and none of its text");
}

{
  // A draft copied from what is published takes them as it is copied; what is published is not touched.
  const fake = installFakeDcs({ branches: { master: "abc123master" }, files: { "master:16-NEH.usfm": PUBLISHED } });
  const result = await ensureBookUsfm({ ...book, loadSource: async () => SOURCE });
  assert(result.usfm === WITH_MARKS, `the copy has the chunk marks, got ${JSON.stringify(result.usfm)}`);
  assert(fake.files["borrador/neh/tpl:16-NEH.usfm"] === WITH_MARKS && fake.files["master:16-NEH.usfm"] === PUBLISHED, "on the group's draft, not on what is published");
  assert(writes(fake.calls) === 1, "one write: the copy");
}

{
  // A draft from before has none: it is given them once, and the hash that comes back is of what was written.
  const fake = installFakeDcs({ branches: { master: "abc123master", "borrador/neh/tpl": "trunksha" }, files: { "master:16-NEH.usfm": PUBLISHED, "borrador/neh/tpl:16-NEH.usfm": PUBLISHED } });
  const first = await ensureBookUsfm({ ...book, loadSource: async () => SOURCE });
  assert(first.usfm === WITH_MARKS && fake.files["borrador/neh/tpl:16-NEH.usfm"] === WITH_MARKS, "the draft got the chunk marks");
  assert(!first.createdFile && Boolean(first.sha), "it is the same file, with its new hash");
  assert(writes(fake.calls) === 1 && fake.files["master:16-NEH.usfm"] === PUBLISHED, "written once, and only the draft");
  const again = await ensureBookUsfm({ ...book, loadSource: async () => SOURCE });
  assert(again.usfm === WITH_MARKS && writes(fake.calls) === 1, "opened again: nothing is written");
}

{
  // A draft that has marks of its own is the team's to keep: none is added, even where the source has more.
  const own = PUBLISHED.replace("\\p\n\\v 3", "\\ts\\*\n\\p\n\\v 3");
  const fake = installFakeDcs({ branches: { master: "abc123master", "borrador/neh/tpl": "trunksha" }, files: { "borrador/neh/tpl:16-NEH.usfm": own } });
  const result = await ensureBookUsfm({ ...book, loadSource: async () => SOURCE });
  assert(result.usfm === own && writes(fake.calls) === 0, "a draft with chunk marks is left as it is");
}

{
  // The source cannot be read, or has no chunk marks: the draft opens as it is, and nothing is written.
  for (const loadSource of [async () => undefined, async () => { throw new Error("sin red"); }, async () => PUBLISHED]) {
    const fake = installFakeDcs({ branches: { master: "abc123master", "borrador/neh/tpl": "trunksha" }, files: { "borrador/neh/tpl:16-NEH.usfm": PUBLISHED } });
    const result = await ensureBookUsfm({ ...book, loadSource });
    assert(result.usfm === PUBLISHED && writes(fake.calls) === 0, "no source to take the chunks from: the draft is opened as it is");
  }
  // And with the app's own reader, which finds no source in this fake Door43.
  const fake = installFakeDcs({ branches: { master: "abc123master", "borrador/neh/tpl": "trunksha" }, files: { "borrador/neh/tpl:16-NEH.usfm": PUBLISHED } });
  const result = await ensureBookUsfm(book);
  assert(result.usfm === PUBLISHED && writes(fake.calls) === 0, "the source is not on this Door43: opened as it is");
}

// ── The helps editor saves on the person's own draft (entrega 8) ──

const TN_HEAD = ["Reference", "ID", "Tags", "SupportReference", "Quote", "Occurrence", "Note"].join("\t");
const tnRow = (...cells: string[]) => cells.join("\t");
const tnFile = (one: string, two: string) => [TN_HEAD, tnRow("1:1", "abc1", "", "", "Quote", "1", one), tnRow("2:1", "xy9z", "", "", "Otra", "1", two), ""].join("\n");
const helpsNoteOf = (text: string, id: string) => parseTsvTable(text).rows.find((row) => row.ID === id)?.Note;
const helpsMain = tnFile("Note in English one", "Note in English two");
const helpsTrunkText = tnFile("Note in English one", "Nota del grupo dos");
const helpsTrunk = bookBranchName("NEH", "notas");
const helpsWork = portionPrBranchName({ book: "NEH", username: "ana", taskId: "notas", issueNumber: 41 });
/** The notes of NEH 1:1, the passage Ana translates: the rows of chapter 1. */
const helpsPassage = (text: string) => tsvRowsToDraftItems("notas", "tn_NEH.tsv", parseTsvTable(text).rows.filter((row) => row.Reference.startsWith("1:")));

/** Ana saves «Nota de ana» on the note of NEH 1:1, with what her editor read of the file. */
function saveAnasNote(files: Record<string, HelpsFile>) {
  const items = helpsPassage(files["tn_NEH.tsv"]?.text ?? helpsMain).map((item) => ({ ...item, text: "Nota de ana" }));
  return saveOwnHelps({
    session,
    target: { owner: "es-419_gl", repo: "es-419_tn", kind: "tsv", filepath: "tn_NEH.tsv", resource: "notas" },
    task: { book: "NEH", resource: "notas", taskId: "notas", phaseSlug: "", username: "ana", issueNumber: 41 },
    items,
    files,
    branch: helpsWork,
    message: () => "TAS: NEH 1:1 (notas) · #41",
    passage: helpsPassage,
  });
}
const putsOf = (calls: Call[]) => calls.filter((c) => (c.method === "PUT" || c.method === "POST") && c.path.endsWith("/contents/tn_NEH.tsv"));

{
  // Caso 2 del PR #48, en las ayudas: Ana's branch is listed with no git ref. Her editor read it before it was lost.
  const fake = installFakeDcs({
    branches: { master: "abc123master", [helpsTrunk]: "trunksha" },
    files: { "master:tn_NEH.tsv": helpsMain, [`${helpsTrunk}:tn_NEH.tsv`]: helpsTrunkText },
    listedGone: [helpsWork],
    gitLike: true,
  });
  let saved: Awaited<ReturnType<typeof saveAnasNote>> | undefined;
  let failure: unknown;
  try {
    saved = await saveAnasNote({ "tn_NEH.tsv": { text: helpsTrunkText, sha: "sha-before-it-was-lost", ref: helpsWork } });
  } catch (err) {
    failure = err;
  }
  assert(!failure, `un guardado de ayudas sobre una rama listada sin commit la rehace y no borra nada: ${failure}`);
  assert(saved!.restored === true, "the editor is told the branch was made again (restored)");
  assert(fake.branches[helpsWork] === "trunksha", "the branch is made again at the group's draft");
  assert(!fake.calls.some((c) => c.method === "DELETE"), "nothing is deleted");
  assert(helpsNoteOf(fake.files[`${helpsWork}:tn_NEH.tsv`] ?? "", "abc1") === "Nota de ana", "Ana's note is written there");
  assert(putsOf(fake.calls)[0]?.sha === `sha-${helpsTrunk}:tn_NEH.tsv`, "with the sha of the file in the group's draft, where the branch was made from");
}

{
  // Ana's branch was deleted altogether while her editor was open (seen on the mock): it is cut again, and that is
  // the same loss as a branch made again. Her note goes over what the new branch has, not into a conflict.
  const fake = installFakeDcs({
    branches: { master: "abc123master", [helpsTrunk]: "trunksha" },
    files: { "master:tn_NEH.tsv": helpsMain, [`${helpsTrunk}:tn_NEH.tsv`]: helpsTrunkText },
    gitLike: true,
  });
  const saved = await saveAnasNote({ "tn_NEH.tsv": { text: tnFile("Lo que ana guardó antes", "Nota del grupo dos"), sha: "sha-gone", ref: helpsWork } });
  assert(saved.restored === true, "una rama borrada del todo con el editor abierto se trata como rehecha");
  assert(helpsNoteOf(fake.files[`${helpsWork}:tn_NEH.tsv`]!, "abc1") === "Nota de ana", "Ana's note is written on the new branch");
}

{
  // A healthy branch: written with the sha the editor read there, and nothing is made again.
  const fake = installFakeDcs({
    branches: { master: "abc123master", [helpsTrunk]: "trunksha", [helpsWork]: "worksha" },
    files: { "master:tn_NEH.tsv": helpsMain, [`${helpsTrunk}:tn_NEH.tsv`]: helpsTrunkText, [`${helpsWork}:tn_NEH.tsv`]: helpsTrunkText },
    gitLike: true,
  });
  const saved = await saveAnasNote({ "tn_NEH.tsv": { text: helpsTrunkText, sha: `sha-${helpsWork}:tn_NEH.tsv`, ref: helpsWork } });
  assert(!saved.restored, "un guardado de ayudas sobre una rama sana no la rehace");
  assert(fake.branches[helpsWork] === "worksha", "the branch does not move");
  assert(putsOf(fake.calls).length === 1 && putsOf(fake.calls)[0]!.sha === `sha-${helpsWork}:tn_NEH.tsv`, "one write, with the sha read on the branch");
  assert(helpsNoteOf(fake.files[`${helpsWork}:tn_NEH.tsv`]!, "abc1") === "Nota de ana", "Ana's note is written");
}

{
  // Ana has no branch yet: her editor read the main branch (no sha). The group already translated a note of
  // another passage in its draft, where her branch is cut from.
  const fake = installFakeDcs({
    branches: { master: "abc123master", [helpsTrunk]: "trunksha" },
    files: { "master:tn_NEH.tsv": helpsMain, [`${helpsTrunk}:tn_NEH.tsv`]: helpsTrunkText },
    gitLike: true,
  });
  await saveAnasNote({ "tn_NEH.tsv": { text: helpsMain } });
  const written = fake.files[`${helpsWork}:tn_NEH.tsv`] ?? "";
  assert(helpsNoteOf(written, "abc1") === "Nota de ana", "Ana's note is written on her new branch");
  assert(
    helpsNoteOf(written, "xy9z") === "Nota del grupo dos",
    `un guardado de notas de quien aún no tiene rama no pisa las filas de otro pasaje que el grupo cambió (got «${helpsNoteOf(written, "xy9z")}»)`,
  );
}

{
  // The sha the editor has is old (somebody wrote a row of another passage on Ana's branch since): refused once,
  // read again on the branch, and written over what is there, keeping that row.
  const theirs = tnFile("Note in English one", "Escrita desde otra pantalla");
  const fake = installFakeDcs({
    branches: { master: "abc123master", [helpsTrunk]: "trunksha", [helpsWork]: "worksha" },
    files: { [`${helpsTrunk}:tn_NEH.tsv`]: helpsTrunkText, [`${helpsWork}:tn_NEH.tsv`]: theirs },
    gitLike: true,
  });
  await saveAnasNote({ "tn_NEH.tsv": { text: helpsTrunkText, sha: "sha-old", ref: helpsWork } });
  const written = fake.files[`${helpsWork}:tn_NEH.tsv`]!;
  assert(putsOf(fake.calls).length === 2, "un sha rechazado se lee de nuevo una sola vez");
  assert(helpsNoteOf(written, "abc1") === "Nota de ana" && helpsNoteOf(written, "xy9z") === "Escrita desde otra pantalla", "and the other passage's row stays");
}

{
  // The rows of Ana's passage on her branch say something else than what her editor read: nothing is written.
  const fake = installFakeDcs({
    branches: { master: "abc123master", [helpsTrunk]: "trunksha", [helpsWork]: "worksha" },
    files: { [`${helpsTrunk}:tn_NEH.tsv`]: helpsTrunkText, [`${helpsWork}:tn_NEH.tsv`]: tnFile("Otra versión de ana", "Nota del grupo dos") },
    gitLike: true,
  });
  let failure: unknown;
  await saveAnasNote({ "tn_NEH.tsv": { text: helpsMain } }).catch((err) => (failure = err));
  assert(failure instanceof HelpsConflictError, `el pasaje cambió en la rama: es un conflicto (got ${failure})`);
  assert(putsOf(fake.calls).length === 0, "and nothing is written");
  assert(helpsNoteOf(fake.files[`${helpsWork}:tn_NEH.tsv`]!, "abc1") === "Otra versión de ana", "what was there stays");
}

// The editor of the text (#90): the sha it holds is old, as after a save from another tab.
const textWork = portionPrBranchName({ book: "NEH", username: "ana", taskId: "tpl-draft", issueNumber: 41 });
const textTrunk = "\\id NEH\n\\c 1\n\\v 1\n";
const textLoaded = "\\id NEH\n\\c 1\n\\v 1 Lo que ana guardó\n";
const saveAnasText = (loaded: string) =>
  saveOwnText({
    session,
    owner: "es-419_gl",
    repo: "es-419_glt",
    filepath: "16-NEH.usfm",
    content: "\\id NEH\n\\c 1\n\\v 1 Lo que ana escribe ahora\n",
    message: "TAS: NEH 1:1",
    branch: textWork,
    sha: "sha-old",
    book: "NEH",
    resource: "tpl",
    taskId: "tpl-draft",
    username: "ana",
    issueNumber: 41,
    loaded,
  });
const textPuts = (calls: Call[]) => calls.filter((c) => (c.method === "PUT" || c.method === "POST") && c.path.endsWith("/contents/16-NEH.usfm"));

{
  // Her branch still has the text her editor loaded: only the sha was wrong. Read again there, and saved once.
  const fake = installFakeDcs({
    branches: { master: "abc123master", "borrador/neh/tpl-draft": "trunksha", [textWork]: "worksha" },
    files: { "borrador/neh/tpl-draft:16-NEH.usfm": textTrunk, [`${textWork}:16-NEH.usfm`]: textLoaded },
    gitLike: true,
  });
  let failure: unknown;
  const saved = await saveAnasText(textLoaded).catch((err) => {
    failure = err;
    return undefined;
  });
  assert(!failure, `texto: un sha viejo sobre el mismo texto se guarda con el sha leído en la rama, sin conflicto (got ${failure})`);
  assert(fake.files[`${textWork}:16-NEH.usfm`]?.includes("Lo que ana escribe ahora"), "texto: lo escrito llega a la rama");
  assert(textPuts(fake.calls).length === 2, "texto: el sha rechazado se lee de nuevo una sola vez");
  assert(saved?.sha === `sha-${textWork}:16-NEH.usfm#1`, "texto: el editor se queda con el sha que dejó el guardado");
}

{
  // Somebody else wrote her branch since it was loaded: a real conflict, said, and nothing written over it.
  const fake = installFakeDcs({
    branches: { master: "abc123master", "borrador/neh/tpl-draft": "trunksha", [textWork]: "worksha" },
    files: { "borrador/neh/tpl-draft:16-NEH.usfm": textTrunk, [`${textWork}:16-NEH.usfm`]: "\\id NEH\n\\c 1\n\\v 1 Escrito desde otra pantalla\n" },
    gitLike: true,
  });
  let failure: unknown;
  await saveAnasText(textLoaded).catch((err) => (failure = err));
  assert(writeRefusedStatus(failure) === 409, `texto: otro texto en la rama es un conflicto (got ${failure})`);
  assert(textPuts(fake.calls).length === 1, "texto: y no se intenta otra vez");
  assert(fake.files[`${textWork}:16-NEH.usfm`]!.includes("Escrito desde otra pantalla"), "texto: lo que había se queda");
}

// #86: Nehemías 1:10–11 TPS. Elisha's review is PR 32 (`trabajo/neh/tps/elisha/1637`); the reviewer, abelper8, opened
// her task, and the marker that leads to the comments was taken off the issue.
const elishaWork = portionPrBranchName({ book: "NEH", username: "Elisha", taskId: "tps", issueNumber: 1637 });
const reviewerWork = portionPrBranchName({ book: "NEH", username: "abelper8", taskId: "tps", issueNumber: 1637 });
const elishaMarker: PortionPrMarker = {
  schema: "gateway-portion-pr-1",
  owner: "es-419_gl",
  repo: "es-419_gst",
  number: 32,
  htmlUrl: "https://qa.door43.org/es-419_gl/es-419_gst/pulls/32",
  head: elishaWork,
  base: "borrador/neh/tps",
  issueNumber: 1637,
};
const elishaPull: FakePull = {
  number: 32,
  state: "open",
  html_url: elishaMarker.htmlUrl,
  head: { ref: elishaWork },
  base: { ref: "borrador/neh/tps" },
};
const issue1637 = (body: string) => ({
  id: 1637,
  number: 1637,
  title: "NEH 1:10–11 · TPS",
  body,
  state: "open",
  html_url: "https://qa.door43.org/es-419_gl/taller/issues/1637",
});
const elishaFake = (extra: Partial<Parameters<typeof installFakeDcs>[0]> = {}) =>
  installFakeDcs({
    branches: { master: "m", "borrador/neh/tps": "trunk", [elishaWork]: "elisha" },
    files: {},
    issues: { "es-419_gl/taller/1637": { number: 1637, body: upsertPortionPrInBody("Texto", elishaMarker) } },
    pulls: { "es-419_gl/es-419_gst/32": { ...elishaPull } },
    pairRouteMissesSlashes: true,
    ...extra,
  });

{
  // The reviewer opens Elisha's task in the editor: the editor names the branch after whoever opens it.
  const fake = elishaFake();
  const visible = await resolveVisiblePortionPr({
    session: { ...session, username: "abelper8" },
    pmOrg: "es-419_gl",
    issue: issue1637(fake.issues["es-419_gl/taller/1637"].body),
    workBranch: reviewerWork,
    username: "abelper8",
    book: "NEH",
    taskId: "tps",
  });
  assert(!visible.dropped, "#86: el PR de la autora no se da por perdido cuando otra persona abre su tarea");
  assert(!visible.marker, "#86: tampoco se le da al editor de quien no es la autora (leería y escribiría su rama)");
  assert(
    parsePortionPrMarker(fake.issues["es-419_gl/taller/1637"].body)?.number === 32,
    "#86: la marca sigue en la incidencia",
  );
  assert(!fake.calls.some((c) => c.method === "PATCH"), "#86: la incidencia no se toca");
}

{
  // A passing error reading the pull is not a pull that is gone.
  const fake = elishaFake({ pullGet500: 1 });
  const visible = await resolveVisiblePortionPr({
    session: { ...session, username: "Elisha" },
    pmOrg: "es-419_gl",
    issue: issue1637(fake.issues["es-419_gl/taller/1637"].body),
    workBranch: elishaWork,
    username: "Elisha",
    book: "NEH",
    taskId: "tps",
  });
  assert(!visible.dropped && visible.marker?.number === 32, "#86: un error pasajero al leer el PR deja la marca");
  assert(parsePortionPrMarker(fake.issues["es-419_gl/taller/1637"].body), "#86: y la incidencia la conserva");
}

{
  // The marker was already lost: the open pull is found by its branches although Door43's own route misses it.
  const fake = elishaFake();
  const found = await getPullByBranches(cfg, "es-419_gl", "es-419_gst", "borrador/neh/tps", elishaWork, session.token);
  assert(found?.number === 32, `#86: el PR abierto se encuentra por sus ramas aunque lleven «/» (got ${found?.number})`);
  const none = await getPullByBranches(cfg, "es-419_gl", "es-419_gst", "borrador/neh/tps", reviewerWork, session.token);
  assert(none === null, "#86: otra rama no tiene PR");
  void fake;
}

{
  // Opening the review again when it is open: the open one is given back instead of failing with a 409.
  const fake = elishaFake();
  const opened = await createOrFindPull(cfg, "es-419_gl", "es-419_gst", {
    title: "NEH 1:10–11 · TPS (#1637)",
    head: elishaWork,
    base: "borrador/neh/tps",
    token: session.token,
  });
  assert(opened.pull.number === 32 && !opened.created, "#86: con un PR abierto, «Terminé» se queda con él en vez de fallar con 409");
  assert(Object.keys(fake.pulls).length === 1, "#86: no se abre un segundo PR");
  fake.branches[reviewerWork] = "reviewer";
  const fresh = await createOrFindPull(cfg, "es-419_gl", "es-419_gst", {
    title: "otro",
    head: reviewerWork,
    base: "borrador/neh/tps",
    token: session.token,
  });
  assert(fresh.created && fresh.pull.number !== 32, "#86: sin PR abierto, se abre uno");
}

{
  // A 409 that is not about an open pull between those branches is not hidden.
  installFakeDcs({ branches: { master: "m" }, files: {}, pulls: {}, pullPost409: true });
  const refused = await createOrFindPull(cfg, "es-419_gl", "es-419_gst", {
    title: "x",
    head: elishaWork,
    base: "borrador/neh/tps",
    token: session.token,
  }).catch((err) => err);
  assert(refused instanceof Error && /409/.test(String(refused.message) + String((refused as { status?: number }).status)), `#86: un 409 sin PR abierto que lo explique sigue siendo un error (got ${refused})`);
}

{
  // The list of pulls cannot be read: no pull, as before, instead of a failure where the lookup used to say none.
  installFakeDcs({ branches: { master: "m" }, files: {}, pulls: {}, pairRouteMissesSlashes: true, pullList500: true });
  const none = await getPullByBranches(cfg, "es-419_gl", "es-419_gst", "borrador/neh/tps", elishaWork, session.token);
  assert(none === null, "#86: si la lista de PR no se puede leer, la búsqueda dice «ninguno», como antes");
  const strict = await getPullByBranches(cfg, "es-419_gl", "es-419_gst", "borrador/neh/tps", elishaWork, session.token, { strict: true }).then(
    () => "answered",
    () => "threw",
  );
  assert(strict === "threw", "#102: con strict, una lista que no se puede leer no pasa por «ninguno»: avisa");
}

{
  // #102: Elisha's subtarea was given to abelper8, whose review is PR 40. Elisha's PR 32 would stay open with nobody
  // to deliver it: it is closed with a line that says where the work went, and her branch stays.
  const fake = elishaFake();
  const now: PortionPrMarker = { ...elishaMarker, number: 40, htmlUrl: "https://qa.door43.org/es-419_gl/es-419_gst/pulls/40", head: reviewerWork };
  await retireEarlierPull(session, elishaMarker, now, "abelper8");
  assert(fake.pulls["es-419_gl/es-419_gst/32"]!.state === "closed", "#102: el PR anterior se cierra");
  const said = fake.comments["es-419_gl/es-419_gst/32"] ?? [];
  assert(said.length === 1 && said[0]!.includes("@abelper8") && said[0]!.includes(now.htmlUrl!) && said[0]!.includes(elishaWork), `#102: con un comentario que dice a quién pasó, dónde sigue y qué rama se queda (got ${said})`);
  assert(fake.branches[elishaWork] === "elisha" && !fake.calls.some((c) => c.method === "DELETE"), "#102: la rama de Elisha no se borra");
}

{
  // #102: the same review, or one that is no longer open, is left as it is.
  const fake = elishaFake();
  await retireEarlierPull(session, elishaMarker, elishaMarker, "Elisha");
  fake.pulls["es-419_gl/es-419_gst/32"]!.state = "closed";
  await retireEarlierPull(session, elishaMarker, { ...elishaMarker, number: 40 }, "abelper8");
  assert(!fake.comments["es-419_gl/es-419_gst/32"] && !fake.calls.some((c) => c.method === "PATCH"), "#102: un PR que es el mismo o que ya no está abierto no se toca");
}

{
  // #102: a pull that cannot be read is not closed blindly, and the new review goes on.
  const fake = elishaFake({ pullGet500: 5 });
  await retireEarlierPull(session, elishaMarker, { ...elishaMarker, number: 40 }, "abelper8");
  assert(fake.pulls["es-419_gl/es-419_gst/32"]!.state === "open" && !fake.comments["es-419_gl/es-419_gst/32"], "#102: si no se puede leer el PR anterior, no se toca y no falla");
}

{
  // Many open pulls: the one sought may be on a later page.
  const many: Record<string, FakePull> = {};
  for (let n = 1; n <= 60; n++) {
    many[`es-419_gl/es-419_gst/${n}`] = {
      number: n,
      state: "open",
      html_url: `https://qa.door43.org/es-419_gl/es-419_gst/pulls/${n}`,
      head: { ref: n === 58 ? elishaWork : `trabajo/neh/tps/otra/${n}` },
      base: { ref: "borrador/neh/tps" },
    };
  }
  installFakeDcs({ branches: { master: "m" }, files: {}, pulls: many, pairRouteMissesSlashes: true });
  const found = await findOpenPullBetween(cfg, "es-419_gl", "es-419_gst", "borrador/neh/tps", elishaWork, session.token);
  assert(found?.number === 58, `#86: el PR se encuentra en la segunda página (got ${found?.number})`);
  installFakeDcs({ branches: { master: "m" }, files: {}, pulls: many, pairRouteMissesSlashes: true, pageCap: 30 });
  const capped = await findOpenPullBetween(cfg, "es-419_gl", "es-419_gst", "borrador/neh/tps", elishaWork, session.token);
  assert(capped?.number === 58, `#86: también cuando Door43 da menos filas por página de las pedidas (got ${capped?.number})`);
}

console.log("verify-book-bootstrap: ok");
