/**
 * Builds the parallel passages the app shows beside a verse: one small file per book in `public/parallels/`,
 * and an index of the books that have any.
 *
 * The list is the one of the United Bible Societies (github.com/ubsicap/ubs-open-license, CC BY-SA 4.0). It
 * numbers the Old Testament as the Hebrew Bible does; the app's texts (UHB, ULT) number it as most English and
 * Spanish Bibles do, so each reference is moved with the standard table of Paratext
 * (github.com/Copenhagen-Alliance/versification-specification, data under CC BY-SA 4.0).
 *
 *   npm run parallels:build                               # reads both from GitHub
 *   npm run parallels:build -- --xml <file> --map <file>  # or from files already at hand
 *
 * It only writes local files, which are committed: the app serves them itself.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hebrewToOurs, parallelFiles, passagesOfXml } from "../src/domain/parallels";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "public", "parallels");
const XML = "https://raw.githubusercontent.com/ubsicap/ubs-open-license/main/parallel%20passages/ParallelPassages.xml";
const MAP = "https://raw.githubusercontent.com/Copenhagen-Alliance/versification-specification/master/versification-mappings/standard-mappings/eng.json";

const args = process.argv.slice(2);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

async function read(file: string | undefined, url: string): Promise<string> {
  if (file) return readFile(file, "utf8");
  const answer = await fetch(url);
  if (!answer.ok) throw new Error(`${url}: ${answer.status}`);
  return answer.text();
}

const passages = passagesOfXml(await read(option("--xml"), XML));
const mapping = JSON.parse(await read(option("--map"), MAP)) as { mappedVerses: Record<string, string> };
const files = parallelFiles(passages, hebrewToOurs(mapping.mappedVerses));
if (files.size < 40) throw new Error(`Only ${files.size} books came out of ${passages.length} passages: the source is not what it was.`);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const books = [...files.keys()].sort();
for (const book of books) await writeFile(path.join(OUT, `${book}.json`), `${JSON.stringify({ passages: files.get(book) })}\n`);
await writeFile(
  path.join(OUT, "index.json"),
  `${JSON.stringify({ source: "United Bible Societies, Parallel Passages (github.com/ubsicap/ubs-open-license)", license: "CC BY-SA 4.0", books }, null, 2)}\n`,
);
const kept = [...files.values()].reduce((sum, rows) => sum + rows.length, 0);
console.log(`${passages.length} passages read; ${books.length} books written (${kept} passages in all) to ${path.relative(process.cwd(), OUT)}`);
