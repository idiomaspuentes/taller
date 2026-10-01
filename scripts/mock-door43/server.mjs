/**
 * A Door43 in memory for testing TAS with several people, without touching
 * any real server. Run: `node scripts/mock-door43/server.mjs` (port 8787).
 *
 * - Everything of the team (the plan, subtareas, the text repository) lives here and
 *   is written here. Nothing is sent to Door43.
 * - unfoldingWord's public repositories (original texts, notes, words) are read
 *   from qa.door43.org, anonymously and read only, and cached.
 * - People sign in with test tokens: `token-ana`, `token-bea`, `token-carla`.
 *
 * Debug: GET /__mock/files?repo=owner/name&branch=x, GET /__mock/log, POST /__mock/reset
 */
import http from "node:http";
import { Buffer } from "node:buffer";

const PORT = Number(process.env.MOCK_PORT || 8787);
const REAL = "https://qa.door43.org";
const PM_ORG = process.env.MOCK_PM_ORG || "BSOJ";
const CONTENT_ORG = "es-419_gl";

const USERS = {
  "token-ana": { id: 1, login: "ana", full_name: "Ana" },
  "token-bea": { id: 2, login: "bea", full_name: "Bea" },
  "token-carla": { id: 3, login: "carla", full_name: "Carla" },
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

function workOrder(n, taskId, portion, assignee, created, updated, title) {
  const marker = JSON.stringify({ schema: "gateway-work-order-1", key: `${taskId}|${portion}`, book: "NEH", teamId: taskId, resource: "tpl", portionIds: [portion], itemIds: [] });
  return {
    id: n, number: n, title, state: "open",
    body: `<!-- gateway-work-order ${marker} -->`,
    labels: [{ id: 1, name: `pm/tarea:${taskId}` }],
    assignee: assignee ? USERS[`token-${assignee}`] : null,
    assignees: assignee ? [USERS[`token-${assignee}`]] : [],
    created_at: ago(created), updated_at: ago(updated), comments: 0,
  };
}

function reset() {
  repos = new Map();
  repos.set(`${PM_ORG}/taller`, { defaultBranch: "main", branches: new Map() });
  repos.set(`${CONTENT_ORG}/es-419_glt`, { defaultBranch: "master", branches: new Map() });
  const board = {
    schema: "gateway-assignments-1", projectId: "NEH", book: "NEH", title: "Nehemías", lang: "es-419", contentOrg: CONTENT_ORG, pmOrg: PM_ORG,
    settings: { allowSelfAssign: true },
    people: [{ id: "ana", name: "Ana" }, { id: "bea", name: "Bea" }, { id: "carla", name: "Carla" }],
    phases: [{ id: "p1", name: "Traducción", slug: "traduccion", order: 0 }, { id: "p2", name: "Afinación", slug: "afinacion", order: 1 }],
    teams: [
      { id: "tpl-1", name: "Traducir TPL 1", resource: "tpl", phaseId: "p1", memberIds: ["ana", "bea", "carla"], scope: ["tpl"], rules: [{ resource: "tpl", articleFilter: "pending" }] },
      {
        id: "afinar-tpl-1", name: "Afinar TPL 1", resource: "tpl", phaseId: "p2", memberIds: ["ana", "bea", "carla"], minLevel: "practicante",
        scope: ["tpl"], rules: [{ resource: "tpl", articleFilter: "pending" }], waitsFor: [{ taskId: "tpl-1", scope: "chapter" }],
        steps: [
          { id: "notas", name: "Revisar notas", solverAppId: "afinar-notas", claimMode: "pool", minAssignees: 2, maxAssignees: 3, minIndependent: 1 },
          { id: "palabras", name: "Revisar palabras clave", solverAppId: "afinar-palabras", claimMode: "pool", minAssignees: 2, maxAssignees: 3, minIndependent: 1 },
          { id: "alinear", name: "Alinear", solverAppId: "afinar-alineacion", claimMode: "exclusive" },
          { id: "revisar-alineacion", name: "Revisar la alineación", solverAppId: "afinar-alineacion", claimMode: "pool", minAssignees: 2, maxAssignees: 3, minIndependent: 1 },
        ],
      },
    ],
  };
  put(`${PM_ORG}/taller`, "main", "es-419/NEH/assignments.json", JSON.stringify(board, null, 2));
  put(`${PM_ORG}/taller`, "main", "config.json", JSON.stringify({ levels: { ana: "habilitada", bea: "habilitada", carla: "habilitada" } }));
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
    const branch = url.searchParams.get("ref") || repo.defaultBranch;
    const files = repo.branches.get(branch);
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
  const branch = body.branch || repo.defaultBranch;
  if (!repo.branches.has(branch)) {
    if (body.new_branch) repo.branches.set(branch, new Map());
    else return json(res, { message: "branch not found" }, 404);
  }
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
  if (api === "/notifications" || api.startsWith("/notifications/")) return json(res, []);
  if (api === "/user/orgs") return json(res, [{ id: 1, name: PM_ORG, username: PM_ORG }, { id: 2, name: CONTENT_ORG, username: CONTENT_ORG }]);
  const orgMatch = /^\/orgs\/([^/]+)$/.exec(api);
  if (orgMatch) return json(res, { id: 1, name: decodeURIComponent(orgMatch[1]), username: decodeURIComponent(orgMatch[1]), full_name: decodeURIComponent(orgMatch[1]) });
  if (api === `/repos/${PM_ORG}/taller/issues/comments`) return json(res, []);
  if (/^\/orgs\/[^/]+\/teams$/.test(api)) return json(res, [{ id: 10, name: "managers", organization: { name: PM_ORG } }, { id: 11, name: "Equipo", organization: { name: PM_ORG } }]);
  if (/^\/teams\/\d+\/members$/.test(api)) return json(res, Object.values(USERS));
  if (/^\/orgs\/[^/]+\/members$/.test(api)) return json(res, Object.values(USERS));

  if (api === "/repos/issues/search") {
    const state = url.searchParams.get("state") || "open";
    const mine = url.searchParams.get("assigned") === "true";
    let list = issues.filter((i) => state === "all" || i.state === state);
    if (mine && user) list = list.filter((i) => i.assignees.some((a) => a.login === user.login));
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
    if (rest === "") return json(res, { name, owner: { login: owner }, full_name: repoKey, default_branch: repos.get(repoKey).defaultBranch, permissions: { admin: true, push: true, pull: true } });
    if (rest === "branches" && req.method === "GET") return json(res, [...repos.get(repoKey).branches.keys()].map((b) => ({ name: b })));
    if (rest === "branches" && req.method === "POST") {
      const body = await readBody(req);
      const repo = repos.get(repoKey);
      const from = repo.branches.get(body.old_branch_name || repo.defaultBranch);
      if (!from) return json(res, { message: "branch not found" }, 404);
      if (repo.branches.has(body.new_branch_name)) return json(res, { message: "branch already exists" }, 409);
      repo.branches.set(body.new_branch_name, new Map([...from].map(([k, v]) => [k, { ...v }])));
      log.push({ at: new Date().toISOString(), user: user?.login, write: `branch ${repoKey}@${body.new_branch_name}` });
      return json(res, { name: body.new_branch_name }, 201);
    }
    const branchGet = /^branches\/(.+)$/.exec(rest);
    if (branchGet && req.method === "GET") {
      return repos.get(repoKey).branches.has(decodeURIComponent(branchGet[1])) ? json(res, { name: decodeURIComponent(branchGet[1]), commit: { id: nextSha() } }) : json(res, { message: "branch not found" }, 404);
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
  .listen(PORT, () => console.log(`mock Door43 on http://localhost:${PORT} (users: ${Object.keys(USERS).join(", ")})`));
