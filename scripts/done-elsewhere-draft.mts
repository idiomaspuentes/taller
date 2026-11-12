/**
 * A draft of the record of the work a space did before Taller (`es-419/fuera-de-taller.json`, see
 * `src/domain/doneElsewhere.ts`), read from what Door43 shows of each book. Read only: it prints the draft, and writes
 * it to the plan repository only with `--save` and a token (`DCS_TOKEN`), which is a write to that Door43.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/done-elsewhere-draft.mts TIT RUT JON 3JN EPH
 *   ... --out borrador.json          writes the draft to a file to correct it by hand
 *   ... --save borrador.json         saves a corrected draft (asks for DCS_TOKEN)
 *
 * What it can tell from the content alone:
 *  - a book in the latest published version of every text and help the process works on, and whole on the default
 *    branch, is finished: every task (Nehemiah was in a version once and is not on the default branch any more);
 *  - otherwise, for each resource, the chapters that have text on the default branch go to the task that translates
 *    that resource (the first of the process that works on it).
 * What the content does not show (aligning, harmonizing, validating) is left out: whoever knows adds it by hand.
 * A book already in the record is kept as it is, unless `--replace`. A book with a project in Taller is left out: its
 * subtareas already say what was done (Esther and Ezra were brought as closed subtareas), and Esther, published years
 * ago, is being done again.
 *
 * Options: --host (https://git.door43.org), --org (es-419_gl), --lang (es-419), --process (fcr-base),
 * --from (where the work was done; «translationCore»).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { chaptersOf } from "../src/domain/bookChapters";
import { DONE_ELSEWHERE_SCHEMA, normalizeDoneElsewhere, PUBLISHED_FROM, type BookDoneElsewhere, type DoneElsewhereDoc } from "../src/domain/doneElsewhere";
import { shippedWorkflow } from "../src/domain/processes";
import { normalizePmConfig, resolveResourceRepo } from "../src/domain/roles";
import type { ScopeKey } from "../src/domain/types";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1]! : fallback;
};
const HOST = option("host", "https://git.door43.org").replace(/\/$/, "");
const ORG = option("org", "es-419_gl");
const LANG = option("lang", "es-419");
const PROCESS = option("process", "fcr-base");
const FROM = option("from", "translationCore");
const OUT = option("out", "");
const SAVE = option("save", "");
const REPLACE = args.includes("--replace");
const valued = new Set(["--host", "--org", "--lang", "--process", "--from", "--out", "--save"]);
const books = args.filter((arg, i) => !arg.startsWith("--") && !valued.has(args[i - 1] ?? "")).map((code) => code.toUpperCase());
const RECORD = `${LANG.toLowerCase()}/fuera-de-taller.json`;

const get = async (path: string): Promise<Response> => fetch(`${HOST}/api/v1${path}`, { headers: process.env.DCS_TOKEN ? { authorization: `token ${process.env.DCS_TOKEN}` } : {} });
async function json<T>(path: string): Promise<T | null> {
  const res = await get(path);
  return res.ok ? ((await res.json()) as T) : null;
}
async function raw(repo: string, path: string, ref: string): Promise<string | null> {
  const res = await get(`/repos/${ORG}/${repo}/raw/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`);
  return res.ok ? res.text() : null;
}

/** The file of a book in a resource: `57-TIT.usfm`, `tn_TIT.tsv`, `tq_TIT.tsv`. */
async function bookFile(repo: string, ref: string, book: string): Promise<string | null> {
  const list = await json<{ name: string; type: string }[]>(`/repos/${ORG}/${repo}/contents?ref=${encodeURIComponent(ref)}`);
  return list?.find((row) => row.type === "file" && (row.name.toUpperCase().endsWith(`-${book}.USFM`) || row.name.toUpperCase().endsWith(`_${book}.TSV`)))?.name ?? null;
}

/** The chapters of a file that have text: a USFM chapter with words in its verses, a TSV with rows for the chapter. */
function chaptersWithText(name: string, text: string): number[] {
  const out = new Set<number>();
  if (name.toLowerCase().endsWith(".usfm")) {
    for (const part of text.split(/\\c\s+/).slice(1)) {
      const chapter = Number.parseInt(part, 10);
      const words = part.replace(/\\[a-z0-9-]+\*?/gi, " ").replace(/\|[^\\]*?(?=\\|$)/g, " ").replace(/^\d+/, "");
      if (chapter > 0 && /\p{L}{2,}.*\p{L}{2,}/su.test(words.split(/\\v|\n/).slice(1).join(" ") || words)) out.add(chapter);
    }
  } else {
    for (const line of text.split(/\r?\n/).slice(1)) {
      const match = /^(\d+):/.exec(line.split("\t")[0] ?? "");
      if (match) out.add(Number(match[1]));
    }
  }
  return [...out].sort((a, b) => a - b);
}

const workflow = shippedWorkflow(PROCESS);
if (!workflow) throw new Error(`The process ${PROCESS} is not shipped`);
const configText = await raw("taller", "config.json", "master");
const config = normalizePmConfig(configText ? JSON.parse(configText) : {});
// The resources the process works on book by book, and the task that translates each one.
const resources = [...new Set(workflow.tasks.flatMap((task) => (task.rules ?? []).map((rule) => rule.resource)))].filter((resource): resource is ScopeKey => resource !== "palabras" && resource !== "academia");
const translates = new Map(resources.map((resource) => [resource, workflow.tasks.find((task) => (task.rules ?? []).some((rule) => rule.resource === resource))!.id]));

let record: DoneElsewhereDoc;
if (SAVE) record = normalizeDoneElsewhere(JSON.parse(readFileSync(SAVE, "utf8")));
else {
  const existing = await raw("taller", RECORD, "master");
  record = existing ? normalizeDoneElsewhere(JSON.parse(existing)) : { schema: DONE_ELSEWHERE_SCHEMA, books: {} };
  record.process ??= PROCESS;
  const projects = new Set(((await json<{ name: string; type: string }[]>(`/repos/${ORG}/taller/contents/${LANG.toLowerCase()}`)) ?? []).filter((row) => row.type === "dir").map((row) => row.name.toUpperCase()));
  for (const book of books) {
    const chapters = chaptersOf(book);
    if (!chapters) {
      console.error(`${book}: no es un libro`);
      continue;
    }
    if (projects.has(book)) {
      console.error(`${book}: tiene proyecto en Taller; sus subtareas dicen lo hecho (se deja fuera)`);
      continue;
    }
    if (record.books[book] && !REPLACE) {
      console.error(`${book}: ya está en el registro (se deja como está; --replace para rehacerlo)`);
      continue;
    }
    const published: string[] = [];
    let whole = true;
    const tasks: Record<string, number[] | "todo"> = {};
    for (const resource of resources) {
      const repo = resolveResourceRepo(resource, LANG, config);
      if (!repo) continue;
      const release = (await json<{ tag_name: string; published_at: string }[]>(`/repos/${ORG}/${repo}/releases?limit=1`))?.[0];
      const inRelease = Boolean(release && (await bookFile(repo, release.tag_name, book)));
      if (inRelease) published.push(release!.published_at.slice(0, 10));
      const name = await bookFile(repo, "master", book);
      const text = name ? await raw(repo, name, "master") : null;
      const done = name && text ? chaptersWithText(name, text) : [];
      if (done.length < chapters) whole = false;
      console.error(`${book} ${resource} (${repo}): ${inRelease ? `en la versión ${release!.tag_name}; ` : ""}${done.length ? `capítulos con texto: ${done.join(", ")}` : "sin texto"}`);
      if (done.length) tasks[translates.get(resource)!] = done.length >= chapters ? "todo" : done;
    }
    let entry: BookDoneElsewhere | null = null;
    if (published.length === resources.length && whole) entry = { from: PUBLISHED_FROM, at: published.sort().at(-1), tasks: "todo" };
    else if (Object.keys(tasks).length) entry = { from: FROM, at: new Date().toISOString().slice(0, 10), tasks };
    if (entry) record.books[book] = entry;
    else console.error(`${book}: nada hecho fuera de Taller según el contenido`);
  }
}
record.updated_at = new Date().toISOString();
const text = `${JSON.stringify(record, null, 2)}\n`;

if (SAVE) {
  if (!process.env.DCS_TOKEN) throw new Error("--save needs DCS_TOKEN: it writes to the plan repository of that Door43");
  const now = await json<{ sha: string }>(`/repos/${ORG}/taller/contents/${RECORD}`);
  const res = await fetch(`${HOST}/api/v1/repos/${ORG}/taller/contents/${RECORD}`, {
    method: now ? "PUT" : "POST",
    headers: { "content-type": "application/json", authorization: `token ${process.env.DCS_TOKEN}` },
    body: JSON.stringify({ content: Buffer.from(text).toString("base64"), message: "Lo hecho fuera de Taller", ...(now ? { sha: now.sha } : {}) }),
  });
  if (!res.ok) throw new Error(`No se guardó: ${res.status} ${await res.text()}`);
  console.error(`Guardado en ${ORG}/taller/${RECORD}`);
} else if (OUT) {
  writeFileSync(OUT, text);
  console.error(`Borrador en ${OUT}: corríjalo y guárdelo con --save ${OUT}`);
} else process.stdout.write(text);
