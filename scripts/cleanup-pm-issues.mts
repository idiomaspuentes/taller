/**
 * Delete (hard-remove) all TAS `pm` subtareas in the plan repository (`pmRepo`, `{org}/taller`).
 *
 * Usage:
 *   DCS_TOKEN=… DCS_ORG=es-419_gl DCS_HOST=https://qa.door43.org npx tsx scripts/cleanup-pm-issues.mts
 *   … --dry-run
 *
 * Optional: DCS_MILESTONE=NEH, DCS_STATE=all|open|closed (default all)
 */
import {
  PRODUCTION_HOST,
  searchIssues,
  type DcsIssue,
} from "@ip-lms/dcs-client";
import { request } from "../../idiomas-puentes-lms/packages/dcs-client/src/http.ts";
import { dcsConfig } from "../src/dcs/config.ts";
import { isPmNamespacedIssue } from "../src/dcs/issues.ts";
import { PM_REPO_NAME } from "../src/domain/types.ts";

const token = (process.env.DCS_TOKEN || process.env.GT_TOKEN || "").trim();
const org = (process.env.DCS_ORG || process.env.GT_ORG || "").trim();
const host = (process.env.DCS_HOST || PRODUCTION_HOST).replace(/\/$/, "");
const milestone = (process.env.DCS_MILESTONE || "").trim();
const state = (process.env.DCS_STATE || "all") as "open" | "closed" | "all";
const dryRun = process.argv.includes("--dry-run");

if (!token || !org) {
  console.error(
    "Set DCS_TOKEN (or GT_TOKEN) and DCS_ORG (or GT_ORG). Optional: DCS_HOST, DCS_MILESTONE, DCS_STATE, --dry-run",
  );
  process.exit(1);
}

const config = dcsConfig(host);

function isGatewayTasksRepo(issue: DcsIssue): boolean {
  const name = issue.repository?.name;
  if (name === PM_REPO_NAME) return true;
  const full = issue.repository?.full_name;
  if (full?.endsWith(`/${PM_REPO_NAME}`)) return true;
  return false;
}

async function listPmIssues(): Promise<DcsIssue[]> {
  const issues: DcsIssue[] = [];
  let page = 1;
  let more = true;
  while (more && page <= 40) {
    const batch = await searchIssues(config, {
      token,
      owner: org,
      labels: ["pm"],
      milestones: milestone ? [milestone] : undefined,
      type: "issues",
      state,
      page,
      limit: 50,
    });
    issues.push(...batch);
    more = batch.length === 50;
    page += 1;
  }
  return issues.filter((issue) => isPmNamespacedIssue(issue, "pm") && isGatewayTasksRepo(issue));
}

async function deleteIssue(number: number): Promise<void> {
  await request(config, {
    method: "DELETE",
    path: `/repos/${encodeURIComponent(org)}/${encodeURIComponent(PM_REPO_NAME)}/issues/${number}`,
    token,
  });
}

const issues = await listPmIssues();
console.log(
  `Found ${issues.length} pm issue(s) in ${org}/${PM_REPO_NAME}` +
    (milestone ? ` (milestone ${milestone})` : "") +
    ` @ ${host}` +
    (dryRun ? " [dry-run]" : ""),
);

let ok = 0;
let fail = 0;
for (const issue of issues) {
  const label = `#${issue.number} ${issue.title} (${issue.state})`;
  if (dryRun) {
    console.log(`  would delete ${label}`);
    ok += 1;
    continue;
  }
  try {
    await deleteIssue(issue.number);
    console.log(`  deleted ${label}`);
    ok += 1;
  } catch (err) {
    fail += 1;
    console.error(`  FAILED ${label}:`, err instanceof Error ? err.message : err);
  }
}

console.log(`Done. ok=${ok} fail=${fail}`);
if (fail) process.exit(2);
