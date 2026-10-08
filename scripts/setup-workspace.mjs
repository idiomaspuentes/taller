#!/usr/bin/env node
/**
 * Prepares a fresh checkout of Taller (for a new machine or a cloud session).
 *
 * Taller builds on top of `usfm-ast` (the USFM parser, editor core and alignment model), which lives in its own
 * repository and is expected NEXT TO this one:
 *
 *     some-folder/
 *       taller/       ← this repository
 *       usfm-ast/     ← cloned here by this script
 *
 * Run it once from the root of this repository:
 *
 *     node scripts/setup-workspace.mjs
 *
 * It needs git, Node 20+ and Bun (usfm-ast is a Bun monorepo: https://bun.sh).
 * Options (environment): USFM_AST_URL, USFM_AST_REF (a commit or branch), SKIP_USFM_AST_BUILD=1.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const sibling = path.resolve(root, "..", "usfm-ast");

const URL = process.env.USFM_AST_URL || "https://github.com/abelpz/usfm-ast.git";
// The commit of usfm-ast that Taller is known to build against. Move it forward on purpose, not by accident.
const REF = process.env.USFM_AST_REF || "c1f9b20";

/** The packages of usfm-ast Taller uses, in the order they must be built (each needs the ones before it). */
const BUILD_ORDER = ["shared-types", "usfm-parser", "usfm-usj-core", "usfm-adapters", "usfm-editor-checking", "usfm-editor-core", "usfm-readonly-react"];

function run(label, command, args, cwd) {
  console.log(`\n▶ ${label}`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    console.error(`\n✖ Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
}

function has(command) {
  return spawnSync(command, ["--version"], { stdio: "ignore", shell: process.platform === "win32" }).status === 0;
}

for (const tool of ["git", "node", "bun"]) {
  if (!has(tool)) {
    console.error(`✖ ${tool} is not installed or not on the PATH.${tool === "bun" ? " Install it from https://bun.sh" : ""}`);
    process.exit(1);
  }
}

// 1. usfm-ast next to this repository.
if (existsSync(sibling)) {
  console.log(`✓ usfm-ast already at ${sibling} (left as it is)`);
} else {
  run(`clone usfm-ast into ${sibling}`, "git", ["clone", URL, sibling], root);
  run(`check out ${REF}`, "git", ["checkout", "--quiet", REF], sibling);
}

if (process.env.SKIP_USFM_AST_BUILD !== "1") {
  // 2. Its dependencies and the packages Taller type-checks against.
  run("install usfm-ast dependencies", "bun", ["install"], sibling);
  for (const pkg of BUILD_ORDER) {
    run(`build usfm-ast/${pkg}`, "bun", ["run", "build"], path.join(sibling, "packages", pkg));
  }
}

// 3. This repository: the Door43 client it carries, then its own dependencies.
run("install Taller dependencies", "npm", ["install", "--no-audit", "--no-fund"], root);
run("build packages/dcs-client", "npx", ["tsc", "-b", "packages/dcs-client/tsconfig.json"], root);

// 4. Check it all fits together.
run("type-check", "npx", ["tsc", "--noEmit", "-p", "."], root);
run("test the settings and workspaces", "npm", ["run", "verify:config"], root);

console.log("\n✔ Ready. `npm run dev` starts the app; `npm run build` makes the published version.");
