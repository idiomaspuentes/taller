/**
 * A Door43 in memory for testing TAS with several people, without touching
 * any real server. Run: `node scripts/mock-door43/server.mjs` (port 8787).
 *
 * - Everything of the team (the plan, subtareas, the text repository) lives here and
 *   is written here. Nothing is sent to Door43.
 * - unfoldingWord's public repositories (original texts, notes, words) are read
 *   from qa.door43.org, anonymously and read only, and cached.
 * - People sign in with test tokens: `token-ana`, `token-bea`, `token-carla`, `token-dina`, `token-eva`.
 *
 * Debug: GET /__mock/files?repo=owner/name&branch=x, GET /__mock/log, POST /__mock/reset,
 * GET /__mock/dump (the whole state, to keep it across a restart) and POST /__mock/load (put it back).
 */
import http from "node:http";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

const PORT = Number(process.env.MOCK_PORT || 8787);
const REAL = "https://qa.door43.org";
const PM_ORG = process.env.MOCK_PM_ORG || "BSOJ";
const CONTENT_ORG = "es-419_gl";

const USERS = {
  "token-ana": { id: 1, login: "ana", full_name: "Ana" },
  "token-bea": { id: 2, login: "bea", full_name: "Bea" },
  "token-carla": { id: 3, login: "carla", full_name: "Carla" },
  "token-dina": { id: 4, login: "dina", full_name: "Dina" },
  "token-eva": { id: 5, login: "eva", full_name: "Eva" },
};

let counter = 0;
const nextSha = () => `sha${String(++counter).padStart(6, "0")}`;
const json = (res, body, status = 200, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

/** repos: "owner/name" → { defaultBranch, branches: Map<branch, Map<path, {text, sha}>> } */
let repos;
let issues;
let comments;
let labels;
let milestones;
/** Notification threads: a mention in a comment tells the person mentioned, as Door43 does. */
let notifications = [];
/** "owner/name" → pull requests of that repository. */
let pulls;
let log;
let issueCounter;
const cache = new Map();

function repoOf(key) {
  return repos.get(key);
}

function put(repoKey, branch, path, text) {
  const repo = repos.get(repoKey);
  if (!repo.branches.has(branch)) repo.branches.set(branch, new Map());
  repo.branches.get(branch).set(path, { text, sha: nextSha() });
}

const DRAFT = [
  "\\id NEH EN",
  "\\usfm 3.1",
  "\\h Nehemías",
  "\\mt Nehemías",
  "\\c 1",
  "\\p",
  "\\v 1 Las palabras de Nehemías hijo de Hacalías.",
  "\\v 2 Y Hanani, uno de mis hermanos, vino con hombres de Judá.",
  "\\v 3 Y me dijeron: El muro de Jerusalén está derribado.",
  "",
].join("\n");

function ago(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function doneSteps(taskId) {
  const [id, steps] = (process.env.MOCK_DONE_STEPS || "").split(":");
  if (id !== taskId || !steps) return "";
  return `
<!-- gateway-task-progress ${JSON.stringify({ v: 2, doneStepIds: steps.split(","), steps: {} })} -->`;
}

/** Where the published files of the real organization are read from (read only, public). */
const SEED_HOST = "https://git.door43.org";
const CONTENT_REPOS = ["es-419_glt", "es-419_gst", "es-419_tn", "es-419_tq", "es-419_tw", "es-419_ta"];
/** Files read once from the real Door43 (read only) and put back after every reset: `[repo, branch, path, text]`. */
let seeded = [];

/**
 * MOCK_SEED_BOOK=TIT: start from what is published for that book in the real organization, so a walk through the
 * process uses real texts, notes and questions. The two texts are also placed on the group-draft branches of the
 * translation tasks (`tit/tpl`, `tit/tps`), as if Traducción had delivered them.
 */
async function seedFromReal(book) {
  const code = book.toUpperCase();
  const numbers = { TIT: "57", NEH: "16", RUT: "08", JON: "32", EST: "17", "3JN": "65" };
  const usfm = `${numbers[code] || "00"}-${code}.usfm`;
  const wanted = [
    ["es-419_glt", usfm, ["master", `${code.toLowerCase()}/tpl`]],
    ["es-419_gst", usfm, ["master", `${code.toLowerCase()}/tps`]],
    ["es-419_tn", `tn_${code}.tsv`, ["master"]],
    ["es-419_tq", `tq_${code}.tsv`, ["master"]],
  ];
  for (const [repo, path, branches] of wanted) {
    try {
      const r = await fetch(`${SEED_HOST}/${CONTENT_ORG}/${repo}/raw/branch/master/${path}`, { headers: { "user-agent": "GatewayTasks-mock/0.1" } });
      if (!r.ok) {
        console.log(`seed: ${repo}/${path} → ${r.status} (se deja vacío)`);
        continue;
      }
      const text = await r.text();
      for (const branch of branches) seeded.push([repo, branch, path, text]);
      console.log(`seed: ${repo}/${path} (${text.length} bytes) → ${branches.join(", ")}`);
    } catch (err) {
      console.log(`seed: ${repo}/${path} falló: ${err}`);
    }
  }
  reset();
}

function workOrder(n, taskId, portion, assignee, created, updated, title) {
  const marker = JSON.stringify({ schema: "gateway-work-order-1", key: `${taskId}|${portion}`, book: "NEH", teamId: taskId, resource: "tpl", portionIds: [portion], itemIds: [] });
  return {
    id: n, number: n, title, state: "open",
    // MOCK_DONE_STEPS="afinar-tpl-1:notas,palabras": start a task with some steps already done, to try a later one.
    body: `<!-- gateway-work-order ${marker} -->${doneSteps(taskId)}`,
    labels: [{ id: 0, name: "pm" }, { id: 1, name: `pm/tarea:${taskId}` }],
    milestone: { id: 1, title: "NEH", state: "open" },
    assignee: assignee ? USERS[`token-${assignee}`] : null,
    assignees: assignee ? [USERS[`token-${assignee}`]] : [],
    created_at: ago(created), updated_at: ago(updated), comments: 0,
  };
}

function reset() {
  repos = new Map();
  pulls = new Map();
  repos.set(`${PM_ORG}/taller`, { defaultBranch: "main", branches: new Map() });
  // The content repositories of the space: the two texts and the four helps.
  for (const name of CONTENT_REPOS) repos.set(`${CONTENT_ORG}/${name}`, { defaultBranch: "master", branches: new Map([["master", new Map()]]) });
  for (const [repo, branch, path, text] of seeded) put(`${CONTENT_ORG}/${repo}`, branch, path, text);
  const board = {
    schema: "gateway-assignments-1", projectId: "NEH", book: "NEH", title: "Nehemías", lang: "es-419", contentOrg: CONTENT_ORG, pmOrg: PM_ORG,
    settings: { allowSelfAssign: true },
    people: [{ id: "ana", name: "Ana" }, { id: "bea", name: "Bea" }, { id: "carla", name: "Carla" }],
    phases: [{ id: "p1", name: "Traducción", slug: "traduccion", order: 0 }, { id: "p2", name: "Afinación", slug: "afinacion", order: 1 }],
    teams: [
      {
        id: "tpl-1", name: "Traducir TPL 1", resource: "tpl", phaseId: "p1", memberIds: ["ana", "bea", "carla"], orgTeamName: "Equipo", scope: ["tpl"], rules: [{ resource: "tpl", articleFilter: "pending" }],
        // MOCK_TPL_STEPS=1: the translation task with a free step and a pair review, to try marking a step done.
        ...(process.env.MOCK_TPL_STEPS === "1"
          ? { steps: [{ id: "borrador", name: "Borrador", solverAppId: "tpl-translate" }, { id: "pares", name: "Revisión en pares", claimMode: "exclusive", excludeIssueAssignee: true, includeAuthorInApproval: true, excludePriorStepIds: ["borrador"] }] }
          : {}),
      },
      {
        id: "afinar-tpl-1", name: "Afinar TPL 1", resource: "tpl", phaseId: "p2", memberIds: ["ana", "bea", "carla"], orgTeamName: "Equipo", minLevel: "practicante",
        scope: ["tpl"], rules: [{ resource: "tpl", articleFilter: "pending" }], waitsFor: [{ taskId: "tpl-1", scope: "chapter" }],
        steps: [
          { id: "notas", closing: "consensus", name: "Revisar notas", solverAppId: "afinar-notas", claimMode: "pool", minAssignees: 2, maxAssignees: 3, minIndependent: 1 },
          { id: "palabras", closing: "consensus", name: "Revisar palabras clave", solverAppId: "afinar-palabras", claimMode: "pool", minAssignees: 2, maxAssignees: 3, minIndependent: 1 },
          { id: "alineacion", closing: "consensus", name: "Alineación", solverAppId: "afinar-alineacion", claimMode: "pool", minAssignees: 2, maxAssignees: 3, minIndependent: 1 },
        ],
      },
    ],
  };
  put(`${PM_ORG}/taller`, "main", "es-419/NEH/assignments.json", JSON.stringify(board, null, 2));
  put(`${PM_ORG}/taller`, "main", "config.json", JSON.stringify({ levels: { ana: "habilitada", bea: "habilitada", carla: "habilitada", dina: "habilitada", eva: "habilitada" } }));
  put(`${CONTENT_ORG}/es-419_glt`, "neh", "16-NEH.usfm", DRAFT);
  issues = [
    workOrder(1, "afinar-tpl-1", "c1", null, 6, 6, "NEH 1 · Afinar TPL 1"),
    workOrder(2, "tpl-1", "c2", "carla", 12, 8, "NEH 2 · Traducir TPL 1"),
  ];
  issueCounter = 2;
  comments = new Map();
  labels = [{ id: 1, name: "pm/tarea:tpl-1", color: "0075ca" }];
  milestones = [{ id: 1, title: "NEH", state: "open" }];
  log = [];
}
reset();

/**
 * The commit a branch points at. The mock keeps no history: the id is derived from the files of the branch, so it
 * changes with every write and a branch made from another starts at the same commit. A branch with no files has no
 * ref, like an empty repository.
 */
function headSha(files) {
  if (!files || !files.size) return null;
  const hash = createHash("sha1");
  for (const path of [...files.keys()].sort()) hash.update(`${path}:${files.get(path).sha}\n`);
  return hash.digest("hex");
}

function cloneFiles(files) {
  return new Map([...files].map(([k, v]) => [k, { ...v }]));
}

/** A branch by name, or the one whose head is that commit. */
function branchByRef(repo, ref) {
  if (!ref) return undefined;
  if (repo.branches.has(ref)) return repo.branches.get(ref);
  for (const files of repo.branches.values()) if (headSha(files) === ref) return files;
  // A tag keeps the files of its commit, so the commit can still be read once its branch is gone.
  if (repo.tags?.has(ref)) return repo.tags.get(ref);
  for (const files of repo.tags?.values() ?? []) if (headSha(files) === ref) return files;
  return undefined;
}

function pullView(repoKey, repo, pull) {
  const head = repo.branches.get(pull.head);
  const base = repo.branches.get(pull.base);
  return {
    number: pull.number, title: pull.title, body: pull.body, state: pull.state, merged: pull.merged, mergeable: pull.state === "open",
    html_url: `http://localhost:${PORT}/${repoKey}/pulls/${pull.number}`, user: pull.user,
    head: { ref: pull.head, sha: headSha(head) || pull.headSha }, base: { ref: pull.base, sha: headSha(base) || "" }, merge_base: pull.mergeBase,
  };
}

/** Files of the head branch that differ from the base. */
function changedFiles(repo, pull) {
  const head = repo.branches.get(pull.head) || new Map();
  const base = repo.branches.get(pull.base) || new Map();
  const out = [];
  for (const [path, file] of head) {
    const there = base.get(path);
    if (!there) out.push({ filename: path, status: "added", additions: file.text.split("\n").length, deletions: 0 });
    else if (there.text !== file.text) out.push({ filename: path, status: "modified", additions: 1, deletions: 1 });
  }
  return out;
}

/**
 * Merge without history: a file the base has not touched since the pull was opened takes the head's version; when
 * both changed it and the lines still match one to one (edits inside verses or rows), each line takes whichever
 * side changed it; otherwise the head wins. Enough to walk a delivery; it is not git's merge.
 */
function mergeInto(repo, pull) {
  const head = repo.branches.get(pull.head);
  if (!repo.branches.has(pull.base)) repo.branches.set(pull.base, new Map());
  const base = repo.branches.get(pull.base);
  for (const [path, file] of head) {
    const there = base.get(path);
    const origin = pull.snapshot.get(path);
    if (there && there.text === file.text) continue;
    let text = file.text;
    if (there && origin && there.text !== origin.text) {
      const [o, a, b] = [origin.text.split("\n"), there.text.split("\n"), file.text.split("\n")];
      if (o.length === a.length && o.length === b.length) text = o.map((line, i) => (b[i] !== line ? b[i] : a[i])).join("\n");
    }
    base.set(path, { text, sha: nextSha() });
  }
}

function contentEntry(path, file) {
  return { name: path.split("/").pop(), path, sha: file.sha, size: file.text.length, type: "file" };
}

function cors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "authorization, content-type, user-agent");
  res.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("access-control-expose-headers", "x-total-count, link");
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf-8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

async function proxyReal(req, res, url) {
  const target = `${REAL}${url.pathname}${url.search}`;
  let hit = cache.get(target);
  if (!hit) {
    const r = await fetch(target, { headers: { "user-agent": "GatewayTasks-mock/0.1" } });
    hit = { status: r.status, body: Buffer.from(await r.arrayBuffer()), type: r.headers.get("content-type") || "application/json" };
    if (r.status === 200 || r.status === 404) cache.set(target, hit);
  }
  res.writeHead(hit.status, { "content-type": hit.type });
  res.end(hit.body);
}

function handleContents(req, res, url, user, owner, name, path, body) {
  const repo = repoOf(`${owner}/${name}`);
  if (!repo) return json(res, { message: "repository does not exist" }, 404);
  const method = req.method;
  if (method === "GET") {
    // `ref` is a branch or a commit, as in the real API.
    const files = branchByRef(repo, url.searchParams.get("ref") || repo.defaultBranch);
    if (!files) return json(res, { message: "branch not found" }, 404);
    const file = files.get(path);
    if (file) {
      return json(res, { ...contentEntry(path, file), content: Buffer.from(file.text, "utf-8").toString("base64"), encoding: "base64" });
    }
    const prefix = path ? `${path}/` : "";
    const children = new Map();
    for (const [p, f] of files) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      const first = rest.split("/")[0];
      if (rest.includes("/")) children.set(first, { name: first, path: `${prefix}${first}`, sha: "dir", size: 0, type: "dir" });
      else children.set(first, contentEntry(p, f));
    }
    return children.size ? json(res, [...children.values()]) : json(res, { message: "path not found" }, 404);
  }
  if (!user) return json(res, { message: "token is required" }, 401);
  // `new_branch`: the commit goes to a new branch started from `branch` (or the default one), as in the real API.
  const from = body.branch || repo.defaultBranch;
  const branch = body.new_branch || from;
  if (body.new_branch) {
    if (repo.branches.has(body.new_branch)) return json(res, { message: "branch already exists" }, 409);
    repo.branches.set(body.new_branch, cloneFiles(repo.branches.get(from) || new Map()));
  }
  if (!repo.branches.has(branch)) return json(res, { message: "branch not found" }, 404);
  const files = repo.branches.get(branch);
  const existing = files.get(path);
  if (method === "POST") {
    if (existing) return json(res, { message: "repository file already exists" }, 422);
  } else if (method === "PUT") {
    if (!existing) return json(res, { message: "path not found" }, 404);
    if (body.sha !== existing.sha) return json(res, { message: "sha does not match" }, 422);
  } else if (method === "DELETE") {
    if (!existing) return json(res, { message: "path not found" }, 404);
    if (body.sha !== existing.sha) return json(res, { message: "sha does not match" }, 422);
    files.delete(path);
    return json(res, { commit: { sha: nextSha() } });
  }
  const text = Buffer.from(body.content || "", "base64").toString("utf-8");
  const file = { text, sha: nextSha() };
  files.set(path, file);
  log.push({ at: new Date().toISOString(), user: user.login, write: `${method} ${owner}/${name}@${branch}:${path}`, bytes: text.length });
  (repo.commits ??= []).unshift({ sha: nextSha(), created: new Date().toISOString(), branch, html_url: "", author: { login: user.login }, commit: { message: body.message || "", author: { name: user.full_name } } });
  return json(res, { content: contentEntry(path, file), commit: { sha: nextSha(), message: body.message || "" } }, method === "POST" ? 201 : 200);
}

function issueView(issue) {
  return { ...issue, comments: (comments.get(issue.number) || []).length, html_url: `http://localhost:${PORT}/${PM_ORG}/taller/issues/${issue.number}` };
}

async function handle(req, res) {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const token = /^token (.+)$/.exec(req.headers.authorization || "")?.[1];
  const user = token ? USERS[token] : undefined;
  const p = url.pathname;

  if (p === "/__mock/reset" && req.method === "POST") {
    reset();
    return json(res, { ok: true });
  }
  if (p === "/__mock/log") return json(res, log);
  if (p === "/__mock/dump") {
    const plain = (map) => [...map].map(([branch, files]) => [branch, [...files]]);
    return json(res, {
      repos: [...repos].map(([key, repo]) => [key, { defaultBranch: repo.defaultBranch, branches: plain(repo.branches), tags: plain(repo.tags ?? new Map()), commits: repo.commits ?? [] }]),
      pulls: [...pulls].map(([key, list]) => [key, list.map((pull) => ({ ...pull, snapshot: [...pull.snapshot] }))]),
      issues, comments: [...comments], labels, milestones, issueCounter, counter,
    });
  }
  if (p === "/__mock/load" && req.method === "POST") {
    const state = await readBody(req);
    repos = new Map(state.repos.map(([key, repo]) => [key, { defaultBranch: repo.defaultBranch, commits: repo.commits ?? [], branches: new Map(repo.branches.map(([branch, files]) => [branch, new Map(files)])), tags: new Map((repo.tags ?? []).map(([tag, files]) => [tag, new Map(files)])) }]));
    pulls = new Map(state.pulls.map(([key, list]) => [key, list.map((pull) => ({ ...pull, snapshot: new Map(pull.snapshot) }))]));
    issues = state.issues;
    comments = new Map(state.comments);
    labels = state.labels;
    milestones = state.milestones;
    issueCounter = state.issueCounter;
    counter = state.counter;
    return json(res, { ok: true, issues: issues.length });
  }
  if (p === "/__mock/files") {
    const repo = repos.get(url.searchParams.get("repo") || "");
    const files = repo?.branches.get(url.searchParams.get("branch") || repo?.defaultBranch || "");
    if (url.searchParams.get("path")) return json(res, { text: files?.get(url.searchParams.get("path"))?.text ?? null });
    return json(res, files ? [...files.entries()].map(([path, f]) => ({ path, bytes: f.text.length })) : null);
  }

  const api = p.startsWith("/api/v1") ? p.slice("/api/v1".length) : null;
  if (api === null) return json(res, { message: "not an api path" }, 404);

  // Public unfoldingWord texts: read from the real QA, read only.
  const repoMatch = /^\/repos\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(api);
  if (repoMatch && decodeURIComponent(repoMatch[1]) === "unfoldingWord" && req.method === "GET") return proxyReal(req, res, url);

  if (api === "/user") return user ? json(res, { ...user, avatar_url: "" }) : json(res, { message: "token is required" }, 401);
  if (api === "/user/teams") {
    if (!user) return json(res, [], 401);
    // Only Ana coordinates; the others are plain members.
    return json(res, user.login === "ana" ? [{ id: 10, name: "managers", organization: { name: PM_ORG, username: PM_ORG } }] : [{ id: 11, name: "Equipo", organization: { name: PM_ORG, username: PM_ORG } }]);
  }
  if (api === "/notifications" && req.method === "GET") {
    return json(res, user ? notifications.filter((thread) => thread.to === user.login && thread.unread).map(({ to, ...thread }) => thread) : []);
  }
  const threadMatch = /^\/notifications\/threads\/(\d+)$/.exec(api);
  if (threadMatch && req.method === "PATCH") {
    const thread = notifications.find((row) => row.id === Number(threadMatch[1]) && row.to === user?.login);
    if (thread) thread.unread = false;
    return json(res, thread ? { id: thread.id, unread: false } : { message: "not found" }, thread ? 205 : 404);
  }
  if (api === "/notifications" || api.startsWith("/notifications/")) return json(res, []);
  if (api === "/user/orgs") return json(res, [{ id: 1, name: PM_ORG, username: PM_ORG }, { id: 2, name: CONTENT_ORG, username: CONTENT_ORG }]);
  // POST /orgs/{org}/repos (and the older /org/{org}/repos): a new repository, with a first file when asked.
  const newRepo = /^\/orgs?\/([^/]+)\/repos$/.exec(api);
  if (newRepo && req.method === "POST") {
    if (!user) return json(res, { message: "token is required" }, 401);
    const body = await readBody(req);
    const key = `${decodeURIComponent(newRepo[1])}/${body.name}`;
    if (repos.has(key)) return json(res, { message: "repository already exists" }, 409);
    repos.set(key, { defaultBranch: "master", branches: new Map([["master", new Map()]]) });
    if (body.auto_init) put(key, "master", "README.md", `# ${body.name}\n`);
    log.push({ at: new Date().toISOString(), user: user.login, write: `repo ${key} created` });
    return json(res, { name: body.name, full_name: key, default_branch: "master", owner: { login: decodeURIComponent(newRepo[1]) } }, 201);
  }
  const orgMatch = /^\/orgs\/([^/]+)$/.exec(api);
  if (orgMatch) return json(res, { id: 1, name: decodeURIComponent(orgMatch[1]), username: decodeURIComponent(orgMatch[1]), full_name: decodeURIComponent(orgMatch[1]) });
  if (api === `/repos/${PM_ORG}/taller/issues/comments`) return json(res, []);
  if (/^\/orgs\/[^/]+\/teams$/.test(api)) return json(res, [{ id: 10, name: "managers", organization: { name: PM_ORG } }, { id: 11, name: "Equipo", organization: { name: PM_ORG } }]);
  if (/^\/teams\/\d+\/members$/.test(api)) return json(res, Object.values(USERS));
  // What a team works on: here every team has every repository, so giving a phase its team has nothing to hand out.
  if (/^\/teams\/\d+\/repos$/.test(api) && req.method === "GET") {
    return json(res, [...repos.keys()].map((key) => ({ name: key.split("/")[1], full_name: key, owner: { login: key.split("/")[0] }, permissions: { admin: false, push: true, pull: true } })));
  }
  if (/^\/teams\/\d+\/repos\/[^/]+\/[^/]+$/.test(api) && (req.method === "PUT" || req.method === "DELETE")) return json(res, {}, 204);
  if (/^\/orgs\/[^/]+\/members$/.test(api)) return json(res, Object.values(USERS));

  if (api === "/repos/issues/search") {
    const state = url.searchParams.get("state") || "open";
    const mine = url.searchParams.get("assigned") === "true";
    let list = issues.filter((i) => state === "all" || i.state === state);
    if (mine && user) list = list.filter((i) => i.assignees.some((a) => a.login === user.login));
    // Like the real API: only the issues of the given milestones (a project) and with every given label. And like
    // the real API (seen on qa.door43.org, October 2026): a milestone that does not exist is not a filter at all,
    // and every issue comes back.
    const wantedMilestones = (url.searchParams.get("milestones") || "").split(",").map((x) => x.trim()).filter((title) => title && milestones.some((m) => m.title === title));
    if (wantedMilestones.length) list = list.filter((i) => i.milestone && wantedMilestones.includes(i.milestone.title));
    const wantedLabels = (url.searchParams.get("labels") || "").split(",").map((x) => x.trim()).filter(Boolean);
    if (wantedLabels.length) list = list.filter((i) => !i.labels.length || wantedLabels.every((name) => i.labels.some((l) => l.name === name)));
    return json(res, Number(url.searchParams.get("page") || 1) > 1 ? [] : list.map(issueView), 200, { "x-total-count": String(list.length) });
  }

  if (repoMatch) {
    const owner = decodeURIComponent(repoMatch[1]);
    const name = decodeURIComponent(repoMatch[2]);
    const rest = repoMatch[3] || "";
    const repoKey = `${owner}/${name}`;
    if (!repos.has(repoKey)) return json(res, { message: "repository does not exist" }, 404);
    if (rest.startsWith("contents/") || rest === "contents") {
      const body = req.method === "GET" ? {} : await readBody(req);
      return handleContents(req, res, url, user, owner, name, decodeURIComponent(rest.slice("contents/".length)), body);
    }
    if (rest === "commits" && req.method === "GET") {
      const repo = repos.get(repoKey);
      const wanted = url.searchParams.get("sha") || repo.defaultBranch;
      return json(res, (repo.commits ?? []).filter((c) => c.branch === wanted).slice(0, Number(url.searchParams.get("limit") || 30)));
    }
    if (rest === "") return json(res, { name, owner: { login: owner }, full_name: repoKey, default_branch: repos.get(repoKey).defaultBranch, permissions: { admin: true, push: true, pull: true } });
    if (rest === "branches" && req.method === "GET") return json(res, [...repos.get(repoKey).branches].map(([b, files]) => ({ name: b, commit: { id: headSha(files) || "" } })));
    if (rest === "branches" && req.method === "POST") {
      const body = await readBody(req);
      const repo = repos.get(repoKey);
      // From a branch name or from a commit (`old_ref_name`), as the real API accepts.
      const from = branchByRef(repo, body.old_branch_name || body.old_ref_name) || repo.branches.get(repo.defaultBranch);
      if (!from) return json(res, { message: "branch not found" }, 404);
      if (repo.branches.has(body.new_branch_name)) return json(res, { message: "branch already exists" }, 409);
      repo.branches.set(body.new_branch_name, cloneFiles(from));
      log.push({ at: new Date().toISOString(), user: user?.login, write: `branch ${repoKey}@${body.new_branch_name}` });
      return json(res, { name: body.new_branch_name }, 201);
    }
    // ---- releases: a published version, cut from a branch as it stands ----
    if (rest === "releases") {
      const repo = repos.get(repoKey);
      repo.releases ??= [];
      if (req.method === "GET") return json(res, repo.releases);
      if (!user) return json(res, { message: "token is required" }, 401);
      if (req.method === "POST") {
        const body = await readBody(req);
        if (!body.tag_name) return json(res, { message: "tag_name is required" }, 422);
        if (repo.releases.some((row) => row.tag_name === body.tag_name)) return json(res, { message: "release already exists" }, 409);
        const release = { id: repo.releases.length + 1, tag_name: body.tag_name, name: body.name || body.tag_name, body: body.body || "", target_commitish: body.target_commitish || repo.defaultBranch, draft: false, prerelease: false };
        repo.releases.push(release);
        log.push({ at: new Date().toISOString(), user: user.login, write: `release ${repoKey}@${release.tag_name}` });
        return json(res, release, 201);
      }
    }
    // ---- tags: a name for a commit that nobody edits (the archive of a delivery) ----
    const tagMatch = /^tags(?:\/(.+))?$/.exec(rest);
    if (tagMatch) {
      const repo = repos.get(repoKey);
      repo.tags ??= new Map();
      const tag = (tagMatch[1] || "").split("/").map(decodeURIComponent).join("/");
      const tagOf = (tagName) => ({ name: tagName, commit: { sha: headSha(repo.tags.get(tagName)) } });
      if (req.method === "GET") {
        if (!tag) return json(res, [...repo.tags.keys()].map(tagOf));
        return repo.tags.has(tag) ? json(res, tagOf(tag)) : json(res, { message: "tag not found" }, 404);
      }
      if (!user) return json(res, { message: "token is required" }, 401);
      if (req.method === "POST" && !tag) {
        const body = await readBody(req);
        const from = branchByRef(repo, body.target);
        if (!body.tag_name || !from) return json(res, { message: "target not found" }, 404);
        if (repo.tags.has(body.tag_name)) return json(res, { message: "tag already exists" }, 409);
        repo.tags.set(body.tag_name, cloneFiles(from));
        log.push({ at: new Date().toISOString(), user: user.login, write: `tag ${repoKey}@${body.tag_name}` });
        return json(res, tagOf(body.tag_name), 201);
      }
      if (req.method === "DELETE" && tag) {
        if (!repo.tags.delete(tag)) return json(res, { message: "tag not found" }, 404);
        res.writeHead(204);
        return res.end();
      }
    }
    // ---- git refs: every branch (the app lists them once, and then asks only the ones that exist) ----
    if (rest === "git/refs/heads" && req.method === "GET") {
      const repo = repos.get(repoKey);
      return json(res, [...repo.branches.keys()].filter((name) => headSha(repo.branches.get(name))).map((name) => ({ ref: `refs/heads/${name}`, object: { sha: headSha(repo.branches.get(name)), type: "commit" } })));
    }
    // ---- git refs: where a branch points, moving it, deleting it ----
    const refMatch = /^git\/refs\/heads\/(.+)$/.exec(rest);
    if (refMatch) {
      const repo = repos.get(repoKey);
      const branch = refMatch[1].split("/").map(decodeURIComponent).join("/");
      const refOf = (name) => ({ ref: `refs/heads/${name}`, object: { sha: headSha(repo.branches.get(name)), type: "commit" } });
      if (req.method === "GET") {
        if (headSha(repo.branches.get(branch))) return json(res, [refOf(branch)]);
        // Like Gitea: with no exact ref, the ones under that prefix.
        const under = [...repo.branches.keys()].filter((name) => name.startsWith(`${branch}/`) && headSha(repo.branches.get(name)));
        return under.length ? json(res, under.map(refOf)) : json(res, { message: "ref not found" }, 404);
      }
      if (!user) return json(res, { message: "token is required" }, 401);
      if (req.method === "DELETE") {
        if (!repo.branches.has(branch)) return json(res, { message: "ref not found" }, 404);
        repo.branches.delete(branch);
        log.push({ at: new Date().toISOString(), user: user.login, write: `delete ref ${repoKey}@${branch}` });
        res.writeHead(204);
        return res.end();
      }
      if (req.method === "PATCH") {
        const body = await readBody(req);
        const from = branchByRef(repo, body.sha);
        if (!from) return json(res, { message: "sha not found" }, 404);
        repo.branches.set(branch, cloneFiles(from));
        log.push({ at: new Date().toISOString(), user: user.login, write: `move ref ${repoKey}@${branch}` });
        return json(res, refOf(branch));
      }
    }
    const blobMatch = /^git\/blobs\/(.+)$/.exec(rest);
    if (blobMatch && req.method === "GET") {
      for (const files of repos.get(repoKey).branches.values()) {
        for (const file of files.values()) {
          if (file.sha === blobMatch[1]) return json(res, { sha: file.sha, encoding: "base64", content: Buffer.from(file.text, "utf-8").toString("base64") });
        }
      }
      return json(res, { message: "blob not found" }, 404);
    }

    // ---- pull requests: one per subtarea, merged on delivery ----
    if (rest === "pulls" || rest.startsWith("pulls/")) {
      const repo = repos.get(repoKey);
      const list = pulls.get(repoKey) || [];
      pulls.set(repoKey, list);
      if (rest === "pulls" && req.method === "GET") {
        const state = url.searchParams.get("state") || "open";
        return json(res, list.filter((pull) => state === "all" || pull.state === state).map((pull) => pullView(repoKey, repo, pull)));
      }
      if (rest === "pulls" && req.method === "POST") {
        if (!user) return json(res, { message: "token is required" }, 401);
        const body = await readBody(req);
        if (!repo.branches.has(body.head) || !repo.branches.has(body.base)) return json(res, { message: "branch not found" }, 404);
        if (list.some((pull) => pull.state === "open" && pull.head === body.head && pull.base === body.base)) return json(res, { message: "pull request already exists for these targets" }, 409);
        const pull = {
          number: list.length + 1, title: String(body.title || ""), body: String(body.body || ""), state: "open", merged: false, user,
          head: body.head, base: body.base, mergeBase: headSha(repo.branches.get(body.base)), snapshot: cloneFiles(repo.branches.get(body.base)), reviews: [],
        };
        list.push(pull);
        log.push({ at: new Date().toISOString(), user: user.login, write: `pull ${repoKey}#${pull.number} ${body.head} → ${body.base}` });
        return json(res, pullView(repoKey, repo, pull), 201);
      }
      const diff = /^pulls\/(\d+)\.diff$/.exec(rest);
      if (diff) {
        const pull = list.find((x) => x.number === Number(diff[1]));
        if (!pull) return json(res, { message: "pull request not found" }, 404);
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end(changedFiles(repo, pull).map((f) => `diff --git a/${f.filename} b/${f.filename}\n`).join(""));
      }
      const byNumber = /^pulls\/(\d+)(?:\/(merge|files|reviews)(?:\/(\d+))?)?$/.exec(rest);
      if (byNumber) {
        const pull = list.find((x) => x.number === Number(byNumber[1]));
        if (!pull) return json(res, { message: "pull request not found" }, 404);
        const kind = byNumber[2];
        if (!kind && req.method === "GET") return json(res, pullView(repoKey, repo, pull));
        if (kind === "files" && req.method === "GET") return json(res, changedFiles(repo, pull));
        if (kind === "reviews" && req.method === "GET") return json(res, pull.reviews);
        if (!user) return json(res, { message: "token is required" }, 401);
        if (!kind && req.method === "PATCH") {
          const body = await readBody(req);
          if (typeof body.state === "string" && !pull.merged) pull.state = body.state;
          if (typeof body.title === "string") pull.title = body.title;
          return json(res, pullView(repoKey, repo, pull));
        }
        if (kind === "reviews" && req.method === "POST") {
          const body = await readBody(req);
          let review = byNumber[3] ? pull.reviews.find((r) => r.id === Number(byNumber[3])) : undefined;
          if (byNumber[3] && !review) return json(res, { message: "review not found" }, 404);
          const state = { APPROVE: "APPROVED", APPROVED: "APPROVED", REQUEST_CHANGES: "REQUEST_CHANGES", COMMENT: "COMMENT" }[String(body.event || "").toUpperCase()] || "PENDING";
          if (!review) {
            // Gitea refuses an approval of one's own pull request.
            if (state === "APPROVED" && pull.user.login === user.login) return json(res, { message: "approve your own pull is not allowed" }, 422);
            review = { id: pull.reviews.length + 1, user, body: String(body.body || ""), state, commit_id: headSha(repo.branches.get(pull.head)) };
            pull.reviews.push(review);
          } else {
            review.state = state;
            if (typeof body.body === "string") review.body = body.body;
          }
          log.push({ at: new Date().toISOString(), user: user.login, write: `review ${repoKey}#${pull.number} ${review.state}` });
          return json(res, review);
        }
        if (kind === "merge" && req.method === "POST") {
          if (pull.merged) return json(res, { message: "pull request already merged" }, 405);
          if (pull.state !== "open") return json(res, { message: "pull request is closed" }, 405);
          if (!repo.branches.has(pull.head)) return json(res, { message: "head branch not found" }, 404);
          pull.headSha = headSha(repo.branches.get(pull.head));
          mergeInto(repo, pull);
          pull.state = "closed";
          pull.merged = true;
          log.push({ at: new Date().toISOString(), user: user.login, write: `merge ${repoKey}#${pull.number} ${pull.head} → ${pull.base}` });
          res.writeHead(200);
          return res.end();
        }
      }
      // GET pulls/{base}/{head}: the open pull between two branches (branch names may contain slashes).
      if (req.method === "GET") {
        const tail = decodeURIComponent(rest.slice("pulls/".length));
        const pull = list.find((x) => x.state === "open" && `${x.base}/${x.head}` === tail) || list.find((x) => `${x.base}/${x.head}` === tail);
        return pull ? json(res, pullView(repoKey, repo, pull)) : json(res, { message: "pull request not found" }, 404);
      }
    }

    const branchGet = /^branches\/(.+)$/.exec(rest);
    if (branchGet && req.method === "GET") {
      return repos.get(repoKey).branches.has(decodeURIComponent(branchGet[1])) ? json(res, { name: decodeURIComponent(branchGet[1]), commit: { id: headSha(repos.get(repoKey).branches.get(decodeURIComponent(branchGet[1]))) || "" } }) : json(res, { message: "branch not found" }, 404);
    }
    if (repoKey === `${PM_ORG}/taller`) {
      if (rest === "labels" && req.method === "GET") return json(res, labels);
      if (rest === "labels" && req.method === "POST") {
        const body = await readBody(req);
        const label = { id: labels.length + 1, name: body.name, color: body.color || "cccccc" };
        labels.push(label);
        return json(res, label, 201);
      }
      if (rest === "milestones" && req.method === "GET") return json(res, milestones);
      if (rest === "milestones" && req.method === "POST") {
        const body = await readBody(req);
        const m = { id: milestones.length + 1, title: body.title, state: "open" };
        milestones.push(m);
        return json(res, m, 201);
      }
      const issueMatch = /^issues\/(\d+)(?:\/(comments|assignees|labels))?$/.exec(rest);
      if (issueMatch) {
        const number = Number(issueMatch[1]);
        const issue = issues.find((i) => i.number === number);
        if (!issue) return json(res, { message: "issue not found" }, 404);
        const kind = issueMatch[2];
        if (!kind && req.method === "GET") return json(res, issueView(issue));
        if (!user) return json(res, { message: "token is required" }, 401);
        if (!kind && req.method === "PATCH") {
          const body = await readBody(req);
          if (Array.isArray(body.assignees)) {
            issue.assignees = body.assignees.map((l) => Object.values(USERS).find((u) => u.login === l)).filter(Boolean);
            issue.assignee = issue.assignees[0] || null;
          }
          if (typeof body.state === "string") {
            issue.state = body.state;
            if (body.state === "closed") issue.closed_at = new Date().toISOString();
          }
          if (typeof body.body === "string") issue.body = body.body;
          if (typeof body.title === "string") issue.title = body.title;
          issue.updated_at = new Date().toISOString();
          log.push({ at: issue.updated_at, user: user.login, write: `issue #${number} ${JSON.stringify(Object.keys(body))}` });
          return json(res, issueView(issue));
        }
        if (kind === "comments") {
          const list = comments.get(number) || [];
          if (req.method === "GET") return json(res, list);
          const body = await readBody(req);
          const c = { id: list.length + 1, body: body.body, user, created_at: new Date().toISOString() };
          comments.set(number, [...list, c]);
          for (const [, login] of String(body.body).matchAll(/@([a-z0-9_-]+)/gi)) {
            if (login === user.login || !Object.values(USERS).some((u) => u.login === login)) continue;
            notifications.push({ id: notifications.length + 1, to: login, unread: true, updated_at: c.created_at, subject: { title: issue.title, type: "Issue", url: `http://localhost:${PORT}/api/v1/repos/${PM_ORG}/taller/issues/${number}` }, repository: { full_name: `${PM_ORG}/taller` } });
          }
          issue.updated_at = c.created_at;
          log.push({ at: c.created_at, user: user.login, write: `comment #${number}`, text: String(body.body).split("\n")[0] });
          return json(res, c, 201);
        }
        if (kind === "assignees" && req.method === "POST") {
          const body = await readBody(req);
          for (const l of body.assignees || []) {
            const u = Object.values(USERS).find((x) => x.login === l);
            if (u && !issue.assignees.some((a) => a.login === l)) issue.assignees.push(u);
          }
          issue.assignee = issue.assignees[0] || null;
          issue.updated_at = new Date().toISOString();
          return json(res, issueView(issue), 201);
        }
        if (kind === "labels") return json(res, issue.labels);
      }
      if (rest === "issues" && req.method === "GET") return json(res, issues.map(issueView));
      if (rest === "issues" && req.method === "POST") {
        if (!user) return json(res, { message: "token is required" }, 401);
        const body = await readBody(req);
        issueCounter += 1;
        const created = {
          id: issueCounter, number: issueCounter, title: String(body.title || ""), state: "open", body: String(body.body || ""),
          labels: labels.filter((l) => (body.labels || []).includes(l.id)),
          assignee: null, assignees: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), comments: 0,
          milestone: milestones.find((m) => m.id === body.milestone) || null,
        };
        issues.push(created);
        log.push({ at: created.created_at, user: user.login, write: `issue #${created.number} created` });
        return json(res, issueView(created), 201);
      }
    }
  }

  log.push({ at: new Date().toISOString(), unhandled: `${req.method} ${req.url}` });
  return json(res, { message: `mock: ${req.method} ${api} is not implemented` }, 404);
}

http
  .createServer((req, res) => {
    const writeHead = res.writeHead.bind(res);
    res.writeHead = (status, ...rest) => {
      if (status === 401) log.push({ at: new Date().toISOString(), unauthorized: `${req.method} ${req.url}`, auth: String(req.headers.authorization || "").slice(0, 20) });
      return writeHead(status, ...rest);
    };
    handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) json(res, { message: String(err) }, 500);
    });
  })
  .listen(PORT, () => {
    console.log(`mock Door43 on http://localhost:${PORT} (users: ${Object.keys(USERS).join(", ")})`);
    if (process.env.MOCK_SEED_BOOK) void seedFromReal(process.env.MOCK_SEED_BOOK);
  });
