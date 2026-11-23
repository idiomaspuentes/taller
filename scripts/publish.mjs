/**
 * Publishes Taller, and only ever what is on origin/main.
 *
 * Cloudflare Pages serves the last folder uploaded, whatever branch it came from: on 12 November a publish from a
 * branch without main's latest took two merged pull requests out of production. So this never builds the folder it
 * is run from: it builds a clean checkout of origin/main, whatever branch or unsaved edits that folder has.
 *
 *   npm run deploy -- --check     only says whether it could publish
 *   npm run deploy -- --dry-run   also builds, and publishes nothing
 *   npm run deploy                publishes
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isInMain, lastPublishedCommit, parseEnvFile, publishBlockers } from "./publish-guard.mjs";

const PROJECT = "taller";
const SITE = "https://taller.idiomaspuentes.org/";
const mode = process.argv.includes("--check") ? "check" : process.argv.includes("--dry-run") ? "dry-run" : "publish";

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const root = path.dirname(path.resolve(git(["rev-parse", "--git-common-dir"], process.cwd())));

function shell(command, { cwd, env, capture = false }) {
  const result = spawnSync(command, { cwd, env, shell: true, encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
  if (result.status !== 0) throw new Error(`Falló: ${command.split(" ").slice(0, 4).join(" ")}`);
  return result.stdout ?? "";
}

function readLive(cwd, env) {
  try {
    const out = shell(`npx wrangler pages deployment list --project-name ${PROJECT} --environment production --json`, { cwd, env, capture: true });
    const commit = lastPublishedCommit(JSON.parse(out.slice(out.indexOf("["))));
    return { commit, inMain: isInMain(root, commit, "origin/main") };
  } catch {
    return { commit: null, inMain: false };
  }
}

const bundleIn = (html) => /assets\/index-[^"']+\.js/.exec(html)?.[0] ?? null;

async function liveBundle() {
  const response = await fetch(SITE, { headers: { "Cache-Control": "no-cache" } });
  return bundleIn(await response.text());
}

/** A new deployment takes a moment to be what the site answers with. */
async function confirmLive(bundle) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if ((await liveBundle().catch(() => null)) === bundle) return true;
    await new Promise((done) => setTimeout(done, 3000));
  }
  return false;
}

async function buildAndPublish({ commit, buildEnv, cloudflareEnv, neutral }) {
  const short = commit.slice(0, 7);
  const worktrees = path.join(root, ".claude", "worktrees");
  const checkout = path.join(worktrees, `publicar-${short}`);
  if (fs.existsSync(checkout)) throw new Error(`Ya existe ${checkout}: otra publicación está en curso o quedó a medias.`);

  // The build reads `../usfm-ast`, next to the checkout. The dependencies are found by walking up to the main folder.
  fs.mkdirSync(worktrees, { recursive: true });
  const usfmLink = path.join(worktrees, "usfm-ast");
  const madeLink = !fs.existsSync(usfmLink);
  if (madeLink) fs.symlinkSync(path.resolve(root, "..", "usfm-ast"), usfmLink, "junction");

  try {
    git(["worktree", "add", "--detach", "--quiet", checkout, commit], root);
    console.log(`Compilando main (${short}) en una copia limpia…`);
    shell("npm run build", { cwd: checkout, env: buildEnv });
    const dist = path.join(checkout, "dist");
    const bundle = bundleIn(fs.readFileSync(path.join(dist, "index.html"), "utf8"));
    if (!bundle) throw new Error("La compilación no dejó un index con su paquete.");
    if (mode === "dry-run") {
      console.log(`Compiló bien (${bundle}). No se publicó nada.`);
      return;
    }
    // From a neutral folder: inside the project wrangler tries to configure Vite by itself.
    shell(`npx wrangler pages deploy "${dist}" --project-name ${PROJECT} --branch main --commit-hash ${commit} --commit-message "main ${short}" --commit-dirty=true`, {
      cwd: neutral,
      env: cloudflareEnv,
    });
    if (!(await confirmLive(bundle))) throw new Error(`Se subió, pero ${SITE} todavía no sirve ${bundle}. Revísalo.`);
    console.log(`Publicado main (${short}): ${SITE} sirve ${bundle}.`);
  } finally {
    if (fs.existsSync(checkout)) {
      try {
        git(["worktree", "remove", "--force", checkout], root);
      } catch {
        console.error(`No pude quitar la copia temporal ${checkout}.`);
      }
    }
    if (madeLink) fs.rmdirSync(usfmLink); // Takes the link only: the real usfm-ast stays.
  }
}

async function main() {
  git(["fetch", "--quiet", "origin", "main"], root);
  const commit = git(["rev-parse", "origin/main"], root);
  const envFile = path.join(root, ".env.production.local");
  const env = fs.existsSync(envFile) ? parseEnvFile(fs.readFileSync(envFile, "utf8")) : {};
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID || "";
  const cloudflareEnv = { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId };
  const neutral = fs.mkdtempSync(path.join(os.tmpdir(), "taller-publish-"));

  try {
    const live = accountId ? readLive(neutral, cloudflareEnv) : { commit: null, inMain: false };
    const blockers = publishBlockers({ env, accountId, live });
    if (blockers.length) {
      console.error("No se publicó nada:");
      for (const reason of blockers) console.error(`  - ${reason}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Publicado ahora: ${live.commit}. Se publicaría main: ${commit.slice(0, 7)}.`);
    if (mode === "check") return;

    // Only the production file's variables reach the build, not a VITE_ left in this shell.
    const buildEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("VITE_")));
    for (const [name, value] of Object.entries(env)) if (name.startsWith("VITE_")) buildEnv[name] = value;
    await buildAndPublish({ commit, buildEnv, cloudflareEnv, neutral });
  } finally {
    fs.rmSync(neutral, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
