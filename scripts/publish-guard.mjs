/** What must hold before Taller reaches production, apart from how it is found out, so that it can be tested. */
import { spawnSync } from "node:child_process";

/** A build without these loses the notices or the presence with no error: the app simply stops having them. */
const NEEDED_ENV = { VITE_PUSH_URL: "https:", VITE_PRESENCE_URL: "wss:" };

export function parseEnvFile(text) {
  const env = {};
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    const at = line.indexOf("=");
    if (!line || line.startsWith("#") || at < 1) continue;
    const value = line.slice(at + 1).trim();
    const quoted = /^(['"])(.*?)\1/.exec(value);
    env[line.slice(0, at).trim()] = quoted ? quoted[2] : value.replace(/\s+#.*$/, "");
  }
  return env;
}

/**
 * With no option it only checks: publishing is asked for by name. npm swallows flags written without `--` before them
 * (`npm run deploy --dry-run` reaches this with nothing), and that must never end in a publish.
 */
export function parsePublishArgs(args) {
  const modes = new Set();
  let replace = null;
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at];
    if (arg === "--check") modes.add("check");
    else if (arg === "--dry-run") modes.add("dry-run");
    else if (arg === "--publish") modes.add("publish");
    else if (arg === "--replace" && /^[0-9a-f]{7,40}$/i.test(args[at + 1] ?? "")) replace = args[(at += 1)];
    else throw new Error(`Opción no válida: ${arg}. Usa --check, --dry-run o --publish (y --replace <commit>).`);
  }
  if (modes.size > 1) throw new Error("Elige una sola: --check, --dry-run o --publish.");
  const mode = [...modes][0] ?? "check";
  if (replace && mode !== "publish") throw new Error("--replace solo tiene sentido con --publish.");
  return { mode, replace };
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

function isProductionAddress(value, protocol) {
  try {
    const url = new URL(value);
    return url.protocol === protocol && !/^(localhost|127\.|\[::1\]$)|\.localhost$/.test(url.hostname);
  } catch {
    return false;
  }
}

/** Why this publish must not go ahead, said so that the person can act on it. Empty: it may. */
export function publishBlockers({ env, accountId, live, guardIsCurrent, replace }) {
  const found = [];
  if (!live.commit) {
    found.push(`No pude saber qué hay publicado ahora, y publicar a ciegas podría deshacerlo${live.reason ? `: ${live.reason}` : "."}`);
  } else if (replace !== live.commit) {
    const how = `Si de verdad hay que reemplazarlo: npm run deploy -- --publish --replace ${live.commit}`;
    if (!live.inMain) found.push(`Lo publicado ahora (${live.commit}) no está en main: publicar encima lo desharía. Fusiona primero ese trabajo. ${how}`);
    if (!live.serving) found.push(`El sitio no sirve la última publicación (${live.commit}): parece un Rollback, y publicar podría volver a poner lo que se quitó. Revierte primero en main lo que falló. ${how}`);
  }
  if (!guardIsCurrent) {
    found.push("Esta copia del comando no es la de main y podría no tener sus protecciones. Córrelo desde una carpeta al día con main.");
  }
  for (const [name, protocol] of Object.entries(NEEDED_ENV)) {
    const value = env[name]?.trim();
    if (!value) found.push(`Falta ${name} en .env.production.local: la versión publicada lo perdería.`);
    else if (!isProductionAddress(value, protocol)) found.push(`${name} en .env.production.local no es una dirección de producción (${protocol}//…).`);
  }
  if (env.VITE_DEFAULT_HOST?.trim()) {
    found.push("VITE_DEFAULT_HOST está puesto en .env.production.local: es una versión de pruebas y no va a producción.");
  }
  if (!accountId?.trim()) {
    found.push("Falta CLOUDFLARE_ACCOUNT_ID en .env.production.local (la cuenta donde vive el proyecto taller).");
  }
  return found;
}
