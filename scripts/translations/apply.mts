/**
 * Merges a file downloaded from the review tool into src/i18n/locales/.
 *
 *   npm run translations:apply -- <arquivo.json> [--dry]
 *
 * A translation that does not keep the {placeholders} of the Spanish text, or that is empty, is skipped and reported.
 * Texts marked as reviewed are recorded in pt.review.json (who and when); comments are appended to
 * docs/traduccion/comentarios.md.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LOCALES, ROOT, ID, loadAll, placeholdersOf, samePlaceholders, writeJson } from "./shared.mts";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("Uso: npm run translations:apply -- <arquivo.json> [--dry]");
  process.exit(1);
}
const doc = JSON.parse(readFileSync(file, "utf8")) as { format?: string; reviewer?: string; exportedAt?: string; entries?: Record<string, { pt?: string; reviewed?: boolean; comment?: string }> };
if (doc.format !== "taller-translation-review-1") throw new Error("No es un archivo de revisión del Taller (format).");

const { es, pt, glossary, review } = loadAll();
const by = doc.reviewer || "sin nombre";
const at = doc.exportedAt || new Date().toISOString();
let changed = 0, reviewed = 0;
const skipped: string[] = [];
const comments: string[] = [];

for (const [id, e] of Object.entries(doc.entries ?? {})) {
  let source: string | undefined;
  let set: ((value: string) => void) | undefined;
  if (id.startsWith("ui:")) {
    const key = id.slice(3);
    if (!(key in es)) { skipped.push(`${id}: la clave ya no existe`); continue; }
    source = es[key]!;
    set = (value) => { pt[key] = value; };
  } else if (id.startsWith("gl:")) {
    const [, section, ...rest] = id.split(":");
    const spanish = rest.join(":");
    if (!glossary[section!] || !(spanish in glossary[section!]!)) { skipped.push(`${id}: ya no existe en el glosario`); continue; }
    source = spanish;
    set = (value) => { glossary[section!]![spanish] = value; };
  }
  if (e.comment) comments.push(`- **${id}** (${source ?? "—"}): ${e.comment}`);
  if (!set || source === undefined) continue;
  if (typeof e.pt === "string") {
    if (!e.pt.trim()) skipped.push(`${id}: traducción vacía`);
    else if (id.startsWith("ui:") && !samePlaceholders(source, e.pt)) skipped.push(`${id}: debe conservar ${placeholdersOf(source).join(" ") || "ningún {marcador}"}`);
    else { set(e.pt); changed += 1; }
  }
  if (e.reviewed) { review.reviewed[id] = { by, at }; reviewed += 1; }
}

console.log(`${changed} traducciones cambiadas, ${reviewed} marcadas como revisadas, ${comments.length} comentarios${dry ? " (simulacro: no se escribió nada)" : ""}.`);
for (const line of skipped) console.log(`  omitido · ${line}`);
if (!dry) {
  writeJson(join(LOCALES, "pt.json"), pt);
  writeJson(join(LOCALES, "glossary.pt.json"), glossary);
  writeJson(join(LOCALES, "pt.review.json"), review);
  if (comments.length) {
    const log = join(ROOT, "docs", "traduccion", "comentarios.md");
    if (!existsSync(log)) writeFileSync(log, "# Comentarios de la revisión del portugués\n");
    appendFileSync(log, `\n## ${by} · ${at.slice(0, 10)}\n\n${comments.join("\n")}\n`);
  }
}
void ID;
