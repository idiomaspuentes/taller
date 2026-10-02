/**
 * The engine does not know any process. A process (for Idiomas Puentes, the FCR) is a JSON package under
 * `processes/`, listed in `taller.config.ts`. This check fails when code under `src/` names a template, a phase, a
 * task or a tool of a package, or reads a package directly: that would tie the app to one process again.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { tallerConfig } from "../taller.config";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

const ROOT = join(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}

type Raw = Record<string, unknown>;
const rows = (value: unknown): Raw[] => (Array.isArray(value) ? (value as Raw[]) : []);

/** Ids that belong to a process: only those that could not be an ordinary word (they carry a dash). */
function processIds(): string[] {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    const id = String(value ?? "").trim();
    if (id.includes("-")) ids.add(id);
  };
  for (const pack of tallerConfig.processes) {
    for (const tool of rows(pack.tools)) add(tool.id);
    for (const workflow of rows(pack.workflows)) {
      add(workflow.id);
      for (const phase of rows(workflow.phases)) add(phase.id);
      for (const profile of rows(workflow.releaseProfiles)) add(profile.id);
      for (const task of rows(workflow.tasks)) {
        add(task.id);
        for (const step of rows(task.steps)) add(step.id);
      }
    }
  }
  return [...ids];
}

const files = sourceFiles(join(ROOT, "src"));
const ids = processIds();

test("hay paquetes de proceso y traen ids que vigilar", () => {
  assert.ok(tallerConfig.processes.length > 0, "taller.config.ts no lista ningún proceso");
  assert.ok(ids.length > 10, "muy pocos ids: ¿cambió la forma del paquete?");
});

test("ningún archivo de src nombra una plantilla, fase, tarea, paso o herramienta de un proceso", () => {
  const hits: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const id of ids) {
      // As a string literal: "id", 'id' or `id`.
      if (new RegExp(`["'\`]${id.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}["'\`]`).test(text)) hits.push(`${relative(ROOT, file)} nombra «${id}»`);
    }
  }
  assert.deepEqual(hits, [], `el motor volvió a nombrar partes de un proceso:\n${hits.join("\n")}`);
});

test("solo taller.config.ts lee los paquetes de procesos", () => {
  const hits = files.filter((file) => /from\s+["'][^"']*processes\/[^"']+\.json["']/.test(readFileSync(file, "utf8")));
  assert.deepEqual(hits.map((file) => relative(ROOT, file)), []);
});

console.log(`\nverify-decoupling: ${passed} checks passed.`);
