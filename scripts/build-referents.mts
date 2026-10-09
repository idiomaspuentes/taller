/**
 * Builds what the word sheet says about who a word refers to: one file per book in `public/referents/`, and an
 * index of the books.
 *
 * The answers are MACULA's (github.com/Clear-Bible/macula-hebrew and macula-greek, by Biblica, CC BY 4.0): for a
 * pronoun, the word it stands for; for a verb, who does it. Its Hebrew table numbers the verses as the Hebrew
 * Bible does, so they are moved with the standard table of Paratext, as the parallel passages are.
 *
 *   npm run referents:build                                             # reads the tables from GitHub (90 MB)
 *   npm run referents:build -- --greek <tsv> --hebrew <tsv> --map <json> # or from files already at hand
 *
 * It only writes local files, which are committed: the app serves them itself.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hebrewToOurs } from "../src/domain/parallels";
import { maculaRows, referentFiles } from "../src/domain/referents";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "public", "referents");
const GREEK = "https://raw.githubusercontent.com/Clear-Bible/macula-greek/main/SBLGNT/tsv/macula-greek-SBLGNT.tsv";
// Kept with Git LFS: the address of the file itself, not of its pointer.
const HEBREW = "https://media.githubusercontent.com/media/Clear-Bible/macula-hebrew/main/WLC/tsv/macula-hebrew.tsv";
const MAP = "https://raw.githubusercontent.com/Copenhagen-Alliance/versification-specification/master/versification-mappings/standard-mappings/eng.json";

const args = process.argv.slice(2);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

async function read(file: string | undefined, url: string): Promise<string> {
  if (file) return readFile(file, "utf8");
  const answer = await fetch(url);
  if (!answer.ok) throw new Error(`${url}: ${answer.status}`);
  return answer.text();
}

const mapping = JSON.parse(await read(option("--map"), MAP)) as { mappedVerses: Record<string, string> };
const files = new Map([
  ...referentFiles(maculaRows(await read(option("--hebrew"), HEBREW), true), hebrewToOurs(mapping.mappedVerses)),
  ...referentFiles(maculaRows(await read(option("--greek"), GREEK), false)),
]);
if (files.size < 60) throw new Error(`Only ${files.size} books came out: the tables are not what they were.`);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const books = [...files.keys()].sort();
let bytes = 0;
let words = 0;
for (const book of books) {
  const text = `${JSON.stringify({ verses: files.get(book) })}\n`;
  bytes += Buffer.byteLength(text);
  words += Object.values(files.get(book)!).reduce((sum, verse) => sum + verse.length, 0);
  await writeFile(path.join(OUT, `${book}.json`), text);
}
await writeFile(
  path.join(OUT, "index.json"),
  `${JSON.stringify({ source: "MACULA Hebrew and Greek Linguistic Datasets, Biblica (github.com/Clear-Bible/macula-hebrew, github.com/Clear-Bible/macula-greek)", license: "CC BY 4.0", books }, null, 2)}\n`,
);
console.log(`${books.length} books, ${words} words that point to another, ${(bytes / 1e6).toFixed(1)} MB written to ${path.relative(process.cwd(), OUT)}`);
