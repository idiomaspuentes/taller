/**
 * Builds the review tool: one self-contained HTML file (no server, works offline) with every text of the app in
 * Spanish next to its Portuguese, to be edited and checked by a native speaker. The reviewer downloads a JSON file
 * with the changes; `npm run translations:apply -- <file>` merges it into src/i18n/locales/.
 *
 *   npm run translations:review      → docs/traduccion/revisar-portugues.html
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tallerConfig } from "../../taller.config";
import { AREA_NAMES, GLOSSARY_NAMES, ID, ROOT, loadAll } from "./shared.mts";
import { buildExamples } from "./examples.mts";
import { BOOKS } from "../../src/domain/books";
import { LEVEL_LABEL } from "../../src/domain/levels";

type Item = { id: string; kind: string; key: string; group: string; es: string; pt: string; editable: boolean; reviewed: boolean; why?: string };

const { es, pt, glossary, review } = loadAll();
const items: Item[] = [];

/** Some glossary tables are keyed by a code, not by the Spanish text: show the Spanish a person would read. */
const LANGUAGE_ES: Record<string, string> = { "es-419": "Español", es: "Español", en: "Inglés", "pt-br": "Portugués", pt: "Portugués", fr: "Francés" };
function spanishOf(section: string, key: string): string {
  if (section === "books") return BOOKS.find((b) => b.code === key)?.name ?? key;
  if (section === "levelNames") return (LEVEL_LABEL as Record<string, string>)[key] ?? key;
  if (section === "languages") return LANGUAGE_ES[key] ?? key;
  return key;
}

for (const key of Object.keys(es)) {
  const area = key.split(".")[0]!;
  const id = ID.ui(key);
  items.push({ id, kind: "Texto da tela", key, group: `${AREA_NAMES[area] ?? area}`, es: es[key]!, pt: pt[key] ?? "", editable: true, reviewed: Boolean(review.reviewed[id]) });
}
for (const [section, table] of Object.entries(glossary)) {
  for (const [source, target] of Object.entries(table)) {
    const id = ID.gl(section, source);
    items.push({ id, kind: "Glossário", key: section === "books" || section === "levelNames" || section === "languages" ? `${section} · ${source}` : section, group: `Glossário · ${GLOSSARY_NAMES[section] ?? section}`, es: spanishOf(section, source), pt: target, editable: true, reviewed: Boolean(review.reviewed[id]) });
  }
}
const welcomeEs = tallerConfig.welcome.es as Record<string, string>;
const welcomePt = tallerConfig.welcome.pt as Record<string, string>;
for (const field of Object.keys(welcomeEs)) {
  if (typeof welcomeEs[field] !== "string") continue;
  items.push({ id: `cfg:welcome.${field}`, kind: "Texto da organização", key: `taller.config.ts · welcome.${field}`, group: "Texto da organização (boas-vindas)", es: welcomeEs[field]!, pt: welcomePt[field] ?? "", editable: false, reviewed: false, why: "está em taller.config.ts: comente e quem coordena altera" });
}
for (const [i, ex] of buildExamples().entries()) {
  items.push({ id: `ex:${i}`, kind: "Frase com partes variáveis", key: "exemplo", group: "Frases com nomes e números (exemplos)", es: ex.es, pt: ex.pt, editable: false, reviewed: false, why: "frase montada pelo aplicativo; comente e quem coordena altera no código" });
}

const groups = [...new Set(items.map((i) => i.group))];
const html = readFileSync(join(import.meta.dirname, "page.html"), "utf8").replace("__DATA__", () => JSON.stringify({ items, groups }).replace(/</g, "\\u003c"));
const out = join(ROOT, "docs", "traduccion", "revisar-portugues.html");
writeFileSync(out, html);
const editable = items.filter((i) => i.editable);
console.log(`${out}\n${editable.length} textos editáveis (${Object.keys(es).length} da interface + ${editable.length - Object.keys(es).length} do glossário), ${items.length - editable.length} só para comentar; ${editable.filter((i) => i.reviewed).length} já revisados.`);
