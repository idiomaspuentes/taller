/**
 * Read-only audit of the history of a gateway-tasks repository.
 *
 * Why: in one working session the app was open on production by mistake. It may have saved
 * `solvers.json` or `config.json` there. This lists who changed those files and when, so a
 * person can decide if anything needs undoing. It never writes anything.
 *
 * Run it yourself with your own token (it is read from the environment, never typed in a file):
 *
 *   DCS_TOKEN=xxxx node scripts/audit-gateway-tasks-history.mjs https://git.door43.org es-419_gl 2026-09-01
 *
 * Arguments: host, organization, and the date (YYYY-MM-DD) to look from. The repository
 * is `gateway-tasks`. Optional 4th argument: a login to highlight.
 */
const [host, org, since, highlight] = process.argv.slice(2);
const token = process.env.DCS_TOKEN;

if (!host || !org || !/^\d{4}-\d{2}-\d{2}$/.test(since || "") || !token) {
  console.error("Uso: DCS_TOKEN=... node scripts/audit-gateway-tasks-history.mjs <host> <organizacion> <AAAA-MM-DD> [login]");
  process.exit(1);
}

const base = `${host.replace(/\/$/, "")}/api/v1/repos/${encodeURIComponent(org)}/gateway-tasks`;

async function get(path, query = {}) {
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { Authorization: `token ${token}`, "User-Agent": "tas-audit/0.1" } });
  if (!res.ok) throw new Error(`${res.status} ${url.pathname}`);
  return res.json();
}

async function commitsFor(path) {
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const rows = await get("/commits", { path, since: `${since}T00:00:00Z`, limit: 50, page, stat: "false", verification: "false", files: "false" });
    out.push(...rows);
    if (rows.length < 50) break;
  }
  return out;
}

const watched = ["solvers.json", "config.json"];
let found = 0;
for (const file of watched) {
  let rows;
  try {
    rows = await commitsFor(file);
  } catch (err) {
    console.log(`\n${file}: no se pudo leer (${err.message})`);
    continue;
  }
  console.log(`\n${file}: ${rows.length} cambio(s) desde ${since}`);
  for (const c of rows) {
    const who = c.author?.login || c.commit?.author?.name || "?";
    const mark = highlight && who.toLowerCase() === highlight.toLowerCase() ? "  <<<" : "";
    const when = c.commit?.author?.date || c.created || "";
    console.log(`  ${when}  ${who.padEnd(18)} ${String(c.sha).slice(0, 8)}  ${String(c.commit?.message || "").split("\n")[0]}${mark}`);
    found++;
  }
}

try {
  const recent = await get("/commits", { since: `${since}T00:00:00Z`, limit: 50, stat: "false", verification: "false", files: "false" });
  console.log(`\nTodos los cambios del repositorio desde ${since} (los 50 más recientes): ${recent.length}`);
  for (const c of recent) {
    const who = c.author?.login || c.commit?.author?.name || "?";
    console.log(`  ${c.commit?.author?.date || ""}  ${who.padEnd(18)} ${String(c.commit?.message || "").split("\n")[0]}`);
  }
} catch (err) {
  console.log(`\nNo se pudo listar el historial completo (${err.message})`);
}

console.log(
  found
    ? "\nSi alguno de esos cambios no lo hizo una persona a propósito, se puede revertir desde el historial del repositorio."
    : "\nNo hay cambios en esos dos archivos en ese periodo.",
);
