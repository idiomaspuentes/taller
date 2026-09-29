/**
 * QA only: clone ONE PM issue (same labels, milestone, portion/items) with a
 * suffixed work-order key and a new assignee. Refuses production. Not the
 * inventory publisher — creates exactly one issue.
 *
 * Run:
 *   DCS_HOST=https://qa.door43.org DCS_TOKEN=… DCS_ORG=es-419_gl DCS_FROM=1 \
 *   DCS_ASSIGNEE=abelperez DCS_TITLE="NEH 1:1–3 · TPL · prueba conflicto" \
 *   DCS_KEY_SUFFIX=prueba-conflicto npx tsx scripts/qa-clone-pm-issue.mts
 */
const host = (process.env.DCS_HOST || "").replace(/\/$/, "");
const token = (process.env.DCS_TOKEN || "").trim();
const org = (process.env.DCS_ORG || "").trim();
const from = Number(process.env.DCS_FROM || "0");
const assignee = (process.env.DCS_ASSIGNEE || "").trim();
const title = (process.env.DCS_TITLE || "").trim();
const suffix = (process.env.DCS_KEY_SUFFIX || "").trim();

if (!host || /git\.door43\.org/i.test(host)) throw new Error("DCS_HOST must be a non-production host.");
if (!token || !org || !from || !assignee || !title || !suffix) throw new Error("Missing env.");

const api = `${host}/api/v1/repos/${encodeURIComponent(org)}/gateway-tasks`;
const headers = { Authorization: `token ${token}`, "Content-Type": "application/json" };

const existing = await (await fetch(`${api}/issues?state=open&type=issues&q=${encodeURIComponent(title)}`, { headers })).json();
const dup = (existing as { number: number; title: string }[]).find((i) => i.title === title);
if (dup) {
  console.log(`Already exists: #${dup.number}`);
  process.exit(0);
}

const src = await (await fetch(`${api}/issues/${from}`, { headers })).json();
const oldLogin = src.assignees?.[0]?.login ?? "";
const body = String(src.body)
  .replace(/("key":"[^"]+)"/, `$1|${suffix}"`)
  .replace(/- Asignado a: .*$/m, `- Asignado a: @${assignee}`)
  .replace(new RegExp(`@${oldLogin}\\b`, "g"), `@${assignee}`);

const res = await fetch(`${api}/issues`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    title,
    body,
    labels: (src.labels ?? []).map((l: { id: number }) => l.id),
    milestone: src.milestone?.id,
    assignees: [assignee],
  }),
});
const out = await res.json();
console.log(res.status, res.ok ? `#${out.number} ${out.html_url}` : out);
