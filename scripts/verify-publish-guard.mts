/**
 * `npm run deploy` stops before publishing anything that would undo what is already live.
 * On 12 November a publish from a branch without main's latest took two merged pull requests out of production.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isInMain, lastPublishedCommit, parseEnvFile, parsePublishArgs, publishBlockers } from "./publish-guard.mjs";

let passed = 0;
function test(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`  ok  ${name}`);
}

const env = { VITE_PUSH_URL: "https://push.example", VITE_PRESENCE_URL: "wss://presence.example" };
const live = { commit: "abc1234", inMain: true, serving: true };
const blockers = (over: Record<string, unknown> = {}) =>
  publishBlockers({ env, accountId: "account", live, guardIsCurrent: true, replace: null, ...over } as never);

test("con todo en orden, nada lo detiene", () => {
  assert.deepEqual(blockers(), []);
});

test("lo publicado que no está en main lo detiene: publicar encima lo desharía", () => {
  const found = blockers({ live: { ...live, commit: "def5678", inMain: false } });
  assert.equal(found.length, 1);
  assert.match(found[0], /def5678/);
  assert.match(found[0], /no está en main/);
  assert.match(found[0], /--replace def5678/, "y dice cómo seguir si se decide reemplazarlo");
});

test("si el sitio no sirve la última publicación (un Rollback), no se vuelve a poner encima", () => {
  const found = blockers({ live: { ...live, serving: false } });
  assert.equal(found.length, 1);
  assert.match(found[0], /Rollback/);
  assert.match(found[0], /--replace abc1234/);
});

test("reemplazar lo publicado exige nombrar justo ese commit", () => {
  const stale = { ...live, commit: "def5678", inMain: false, serving: false };
  assert.deepEqual(blockers({ live: stale, replace: "def5678" }), []);
  assert.equal(blockers({ live: stale, replace: "abc1234" }).length, 2, "otro commit no vale");
});

test("si no se puede saber qué hay publicado, no se publica a ciegas, ni con --replace", () => {
  const unknown = { commit: null, inMain: false, serving: false, reason: "not logged in" };
  const found = blockers({ live: unknown, replace: "abc1234" });
  assert.equal(found.length, 1);
  assert.match(found[0], /No pude saber/);
  assert.match(found[0], /not logged in/, "y dice por qué");
});

test("una copia vieja del comando no publica: podría no tener sus protecciones", () => {
  const found = blockers({ guardIsCurrent: false });
  assert.equal(found.length, 1);
  assert.match(found[0], /main/);
});

test("sin la dirección de los avisos o de la presencia, no se publica una versión que los pierde", () => {
  const found = blockers({ env: { VITE_PRESENCE_URL: "wss://presence.example" } });
  assert.equal(found.length, 1);
  assert.match(found[0], /VITE_PUSH_URL/);
  assert.equal(blockers({ env: { ...env, VITE_PRESENCE_URL: "  " } }).length, 1, "una dirección vacía tampoco sirve");
});

test("una dirección de pruebas no llega a producción", () => {
  assert.equal(blockers({ env: { ...env, VITE_PUSH_URL: "http://localhost:8787" } }).length, 1);
  assert.equal(blockers({ env: { ...env, VITE_PRESENCE_URL: "ws://127.0.0.1:8788" } }).length, 1);
  assert.equal(blockers({ env: { ...env, VITE_PRESENCE_URL: "https://presence.example" } }).length, 1, "la presencia va por wss");
});

test("una versión de pruebas, que arranca en QA, no llega a producción", () => {
  const found = blockers({ env: { ...env, VITE_DEFAULT_HOST: "qa" } });
  assert.equal(found.length, 1);
  assert.match(found[0], /VITE_DEFAULT_HOST/);
});

test("sin la cuenta de Cloudflare no se elige una al azar", () => {
  const found = blockers({ accountId: "" });
  assert.equal(found.length, 1);
  assert.match(found[0], /CLOUDFLARE_ACCOUNT_ID/);
});

test("el archivo de variables se lee con BOM, CRLF, comentarios y comillas", () => {
  assert.deepEqual(parseEnvFile('﻿# note\r\nVITE_PUSH_URL=https://a.example/x?y=1 # the worker\r\n\r\nVITE_PRESENCE_URL="wss://b.example#c"\r\n'), {
    VITE_PUSH_URL: "https://a.example/x?y=1",
    VITE_PRESENCE_URL: "wss://b.example#c",
  });
});

test("sin opciones solo comprueba: publicar se pide por su nombre", () => {
  assert.deepEqual(parsePublishArgs([]), { mode: "check", replace: null });
  assert.deepEqual(parsePublishArgs(["--check"]), { mode: "check", replace: null });
  assert.deepEqual(parsePublishArgs(["--dry-run"]), { mode: "dry-run", replace: null });
  assert.deepEqual(parsePublishArgs(["--publish"]), { mode: "publish", replace: null });
  assert.deepEqual(parsePublishArgs(["--publish", "--replace", "abc1234"]), { mode: "publish", replace: "abc1234" });
});

test("una opción mal escrita o contradictoria no publica", () => {
  for (const args of [["--dryrun"], ["--publsh"], ["--publish", "--dry-run"], ["--replace", "abc1234"], ["--publish", "--replace"], ["--publish", "extra"]]) {
    assert.throws(() => parsePublishArgs(args), undefined, args.join(" "));
  }
});

test("lo último publicado es la primera fila de la lista; una fila sin commit no cuenta como uno", () => {
  assert.equal(lastPublishedCommit([{ Source: "be47fd6" }, { Source: "f133643" }]), "be47fd6");
  assert.equal(lastPublishedCommit([{ Source: "" }]), null);
  assert.equal(lastPublishedCommit([]), null);
  assert.equal(lastPublishedCommit(null), null);
});

// With real git: an old commit of main counts, one of a branch or one this clone has never seen does not.
const repo = fs.mkdtempSync(path.join(os.tmpdir(), "taller-guard-"));
try {
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const commit = (message: string) => {
    git("commit", "--allow-empty", "-m", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "-b", "main");
  const older = commit("older");
  const tip = commit("tip");
  git("switch", "-c", "side", older);
  const side = commit("not merged");
  git("switch", "main");

  test("un commit anterior de main está en main, también por su nombre corto", () => {
    assert.equal(isInMain(repo, older, "main"), true);
    assert.equal(isInMain(repo, older.slice(0, 7), "main"), true);
    assert.equal(isInMain(repo, tip, "main"), true);
  });

  test("lo que se compara es el commit que se va a publicar: uno más nuevo no está en uno anterior", () => {
    assert.equal(isInMain(repo, tip, older), false);
  });

  test("un commit de una rama sin fusionar no está en main", () => {
    assert.equal(isInMain(repo, side, "main"), false);
  });

  test("un commit que este clon no conoce no cuenta como que está en main", () => {
    assert.equal(isInMain(repo, "0123456789abcdef0123456789abcdef01234567", "main"), false);
    assert.equal(isInMain(repo, null, "main"), false);
  });
} finally {
  fs.rmSync(repo, { recursive: true, force: true });
}

console.log(`verify-publish-guard: ${passed} checks passed.`);
