/**
 * QA only: turn a ghost work ref (git ref exists, branches API 404) into a
 * real branch via `POST /branches` from a source branch. Refuses production.
 *
 * Run:
 *   DCS_HOST=https://qa.door43.org DCS_TOKEN=… DCS_OWNER=es-419_gl DCS_REPO=es-419_glt \
 *   DCS_BRANCH=trabajo/neh/<task>/<user>/<issue> DCS_SOURCE=borrador/neh/<task> DCS_FILE=16-NEH.usfm \
 *   npx tsx scripts/qa-fix-work-ref.mts
 */
const host = (process.env.DCS_HOST || "").replace(/\/$/, "");
const token = (process.env.DCS_TOKEN || "").trim();
const owner = (process.env.DCS_OWNER || "").trim();
const repo = (process.env.DCS_REPO || "").trim();
const branch = (process.env.DCS_BRANCH || "").trim();
const source = (process.env.DCS_SOURCE || "").trim();
const file = (process.env.DCS_FILE || "").trim();

if (!host || /git\.door43\.org/i.test(host)) throw new Error("DCS_HOST must be a non-production host.");
if (!token || !owner || !repo || !branch || !source || !file) throw new Error("Missing env.");
if (!/^(trabajo|w)\//.test(branch)) throw new Error("Only work refs (trabajo/… or the older w/…) are allowed.");

const api = `${host}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
const headers = { Authorization: `token ${token}`, "Content-Type": "application/json" };
const enc = (s: string) => encodeURIComponent(s);
const refPath = branch.split("/").map(enc).join("/");

async function status(url: string, init?: RequestInit): Promise<number> {
  return (await fetch(url, { headers, ...init })).status;
}

async function probe(name: string) {
  const refs = await fetch(`${api}/git/refs/heads/${name.split("/").map(enc).join("/")}`, { headers });
  const rows = refs.ok ? await refs.json() : [];
  const list = Array.isArray(rows) ? rows : [rows];
  const sha = list.find((r: { ref?: string }) => r?.ref === `refs/heads/${name}`)?.object?.sha ?? null;
  return {
    name,
    gitRefSha: sha as string | null,
    branchApi: (await status(`${api}/branches/${enc(name)}`)) === 200,
    fileApi: (await status(`${api}/contents/${enc(file)}?ref=${enc(name)}`)) === 200,
  };
}

const src = await probe(source);
console.log("source", src);
if (!src.branchApi || !src.fileApi) throw new Error("Source branch is not healthy; stopping.");

const before = await probe(branch);
console.log("before", before);
if (before.branchApi) {
  console.log("Work branch already visible in the branches API; nothing to do.");
  process.exit(0);
}
if (before.gitRefSha) {
  const del = await status(`${api}/git/refs/heads/${refPath}`, { method: "DELETE" });
  console.log("DELETE git ref →", del);
}
const create = await fetch(`${api}/branches`, {
  method: "POST",
  headers,
  body: JSON.stringify({ new_branch_name: branch, old_ref_name: source, old_branch_name: source }),
});
console.log("POST /branches →", create.status, create.ok ? "" : await create.text());
console.log("after", await probe(branch));
