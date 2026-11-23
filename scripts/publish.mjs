/**
 * Publishes Taller, and only ever what is on origin/main.
 *
 * Cloudflare Pages serves the last folder uploaded, whatever branch it came from: on 12 November a publish from a
 * branch without main's latest took two merged pull requests out of production. So this never builds the folder it
 * is run from. In a throwaway folder it fetches that commit, clones usfm-ast at the commit Taller pins, installs from
 * the lockfile and builds: no branch, unsaved edit or local dependency of this machine can reach the site.
 *
 *   npm run deploy                only says whether it could publish
 *   npm run deploy -- --dry-run   also builds, and publishes nothing
 *   npm run deploy -- --publish   publishes
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isInMain, lastPublishedCommit, parseEnvFile, parsePublishArgs, publishBlockers } from "./publish-guard.mjs";

const PROJECT = "taller";
const SITE = "https://taller.idiomaspuentes.org/";
// Pinned: it receives the production credentials, and the check reads the shape of its output.
const WRANGLER = "npx --yes wrangler@4.167.0";

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const gitDir = path.resolve(git(["rev-parse", "--git-common-dir"], process.cwd()));
const root = path.dirname(gitDir);

function shell(command, { cwd, env, capture = false }) {
  const result = spawnSync(command, { cwd, env, shell: true, encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
  if (result.status !== 0) {
    const said = (result.stderr ?? "").trim().split(/\r?\n/).filter(Boolean).at(-1);
    throw new Error(said || `falló ${command.split(" ").slice(0, 4).join(" ")}`);
  }
  return result.stdout ?? "";
}

const bundleIn = (html) => /assets\/index-[^"']+\.js/.exec(html)?.[0] ?? null;

async function bundleAt(url) {
  const response = await fetch(url, { headers: { "Cache-Control": "no-cache" } });
  return response.ok ? bundleIn(await response.text()) : null;
}

/** What is live, and whether the newest deployment is really what the site answers with (after a Rollback it is not). */
async function readLive(cwd, env, commitToPublish) {
  const unknown = (reason) => ({ commit: null, inMain: false, serving: false, reason });
  try {
    const out = shell(`${WRANGLER} pages deployment list --project-name ${PROJECT} --environment production --json`, { cwd, env, capture: true });
    const rows = JSON.parse(out.slice(out.indexOf("[")));
    const commit = lastPublishedCommit(rows);
    if (!commit) return unknown("la última publicación no dice su commit");
    const [site, newest] = await Promise.all([bundleAt(SITE), bundleAt(rows[0].Deployment)]);
    if (!site || !newest) return unknown("no pude leer el sitio");
    return { commit, inMain: isInMain(root, commit, commitToPublish), serving: site === newest };
  } catch (error) {
    return unknown(error.message);
  }
}

/** One publish at a time on this machine. A lock left by a run that died is taken over. */
function takeLock() {
  const lock = path.join(gitDir, "taller-publish.lock");
  const pidFile = path.join(lock, "pid");
  try {
    fs.mkdirSync(lock);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const pid = fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, "utf8")) : 0;
    const justMade = !pid && Date.now() - fs.statSync(lock).mtimeMs < 60_000;
    if (justMade || (pid && isRunning(pid))) throw new Error("Otra publicación está en curso.");
    fs.rmSync(lock, { recursive: true, force: true });
    fs.mkdirSync(lock);
  }
  fs.writeFileSync(pidFile, String(process.pid));
  return () => fs.rmSync(lock, { recursive: true, force: true });
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** Whether the command running now is the one in the commit to publish: an old branch has an old guard. */
function guardMatches(commit) {
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  const plain = (text) => text.replace(/\r\n/g, "\n").trim();
  return ["publish.mjs", "publish-guard.mjs"].every((file) => {
    try {
      return plain(fs.readFileSync(path.join(decodeURIComponent(here), file), "utf8")) === plain(git(["show", `${commit}:scripts/${file}`], root));
    } catch {
      return false;
    }
  });
}

async function confirmLive(bundle) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if ((await bundleAt(SITE).catch(() => null)) === bundle) return true;
    await new Promise((done) => setTimeout(done, 3000));
  }
  return false;
}

async function buildAndPublish({ mode, commit, live, productionEnv, cloudflareEnv, neutral }) {
  const short = commit.slice(0, 7);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "taller-build-"));
  const checkout = path.join(work, "taller");
  // Everything is inside `work`, usfm-ast and the links npm makes to it too: removing it cannot reach anything else.
  try {
    fs.mkdirSync(checkout);
    git(["init", "--quiet"], checkout);
    git(["fetch", "--quiet", "--depth", "1", git(["remote", "get-url", "origin"], root), commit], checkout);
    git(["checkout", "--quiet", "--detach", "FETCH_HEAD"], checkout);
    if (git(["rev-parse", "HEAD"], checkout) !== commit) throw new Error("La copia limpia no quedó en el commit esperado.");

    const shellEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("VITE_") && name !== "NODE_ENV"));
    console.log(`Preparando una copia limpia de main (${short}) con usfm-ast fijado…`);
    shell("node scripts/setup-workspace.mjs", { cwd: checkout, env: shellEnv });
    console.log("Compilando…");
    shell("npm run build", { cwd: checkout, env: { ...shellEnv, ...productionEnv, NODE_ENV: "production" } });

    const dist = path.join(checkout, "dist");
    const bundle = bundleIn(fs.readFileSync(path.join(dist, "index.html"), "utf8"));
    if (!bundle) throw new Error("La compilación no dejó un index con su paquete.");
    if (mode === "dry-run") {
      console.log(`Compiló bien (${bundle}). No se publicó nada.`);
      return;
    }

    // The build takes minutes: what is live is read again right before replacing it.
    const now = await readLive(neutral, cloudflareEnv, commit);
    if (now.commit !== live.commit) throw new Error(`Mientras compilaba cambió lo publicado (${live.commit} → ${now.commit ?? "?"}). No se subió nada.`);

    // From a neutral folder: inside the project wrangler tries to configure Vite by itself.
    shell(`${WRANGLER} pages deploy "${dist}" --project-name ${PROJECT} --branch main --commit-hash ${commit} --commit-message "main ${short}" --commit-dirty=true`, {
      cwd: neutral,
      env: cloudflareEnv,
    });
    if (!(await confirmLive(bundle))) throw new Error(`Se subió, pero ${SITE} todavía no sirve ${bundle}. Revísalo.`);
    console.log(`Publicado main (${short}): ${SITE} sirve ${bundle}.`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
}

async function main() {
  const { mode, replace } = parsePublishArgs(process.argv.slice(2));
  git(["fetch", "--quiet", "origin", "+refs/heads/main:refs/remotes/origin/main"], root);
  const commit = git(["rev-parse", "refs/remotes/origin/main"], root);
  const envFile = path.join(root, ".env.production.local");
  const env = fs.existsSync(envFile) ? parseEnvFile(fs.readFileSync(envFile, "utf8")) : {};
  // The production file wins over a variable left in this shell.
  const accountId = env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || "";
  const cloudflareEnv = { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId };
  const productionEnv = Object.fromEntries(Object.entries(env).filter(([name]) => name.startsWith("VITE_")));
  const neutral = fs.mkdtempSync(path.join(os.tmpdir(), "taller-publish-"));
  const release = mode === "publish" ? takeLock() : null;

  try {
    const live = accountId ? await readLive(neutral, cloudflareEnv, commit) : { commit: null, inMain: false, serving: false };
    const current = guardMatches(commit);
    const blockers = publishBlockers({ env, accountId, live, guardIsCurrent: mode !== "publish" || current, replace });
    if (blockers.length) {
      console.error("No se publicó nada:");
      for (const reason of blockers) console.error(`  - ${reason}`);
      process.exitCode = 1;
      return;
    }
    if (!current) console.log("Ojo: esta copia del comando no es la de main; desde aquí --publish no seguirá.");
    console.log(`Publicado ahora: ${live.commit}. Se publicaría main: ${commit.slice(0, 7)}.`);
    if (mode === "check") return;
    await buildAndPublish({ mode, commit, live, productionEnv, cloudflareEnv, neutral });
  } finally {
    release?.();
    fs.rmSync(neutral, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
