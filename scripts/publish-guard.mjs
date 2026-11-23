/** What must hold before Taller reaches production, apart from how it is found out, so that it can be tested. */
import { spawnSync } from "node:child_process";

/** A build without these loses the notices or the presence with no error: the app simply stops having them. */
const NEEDED_ENV = ["VITE_PUSH_URL", "VITE_PRESENCE_URL"];

export function parseEnvFile(text) {
  const env = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const at = line.indexOf("=");
    if (!line || line.startsWith("#") || at < 1) continue;
    env[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return env;
}

/** The commit of the newest production deployment (wrangler lists the newest first). */
export function lastPublishedCommit(deployments) {
  const source = Array.isArray(deployments) ? deployments[0]?.Source : null;
  return typeof source === "string" && /^[0-9a-f]{7,40}$/i.test(source) ? source : null;
}

/** Whether `ref` already contains `commit`. A commit this clone has never seen is not known to be there. */
export function isInMain(cwd, commit, ref) {
  if (!commit) return false;
  return spawnSync("git", ["merge-base", "--is-ancestor", commit, ref], { cwd, stdio: "ignore" }).status === 0;
}

/** Why this publish must not go ahead, said so that the person can act on it. Empty: it may. */
export function publishBlockers({ env, accountId, live }) {
  const found = [];
  if (!live.commit) {
    found.push("No pude saber qué hay publicado ahora en Cloudflare, y publicar a ciegas podría deshacerlo.");
  } else if (!live.inMain) {
    found.push(`Lo publicado ahora (${live.commit}) no está en main: publicar encima lo desharía. Fusiona primero ese trabajo.`);
  }
  for (const name of NEEDED_ENV) {
    if (!env[name]?.trim()) found.push(`Falta ${name} en .env.production.local: la versión publicada lo perdería.`);
  }
  if (env.VITE_DEFAULT_HOST?.trim()) {
    found.push("VITE_DEFAULT_HOST está puesto en .env.production.local: es una versión de pruebas y no va a producción.");
  }
  if (!accountId?.trim()) {
    found.push("Falta CLOUDFLARE_ACCOUNT_ID en .env.production.local (la cuenta donde vive el proyecto taller).");
  }
  return found;
}
