/**
 * Builds the parallel passages the app shows beside a verse: one small file per book in `public/parallels/`,
 * and an index of the books that have any.
 *
 * The list is the one of the United Bible Societies (github.com/ubsicap/ubs-open-license, CC BY-SA 4.0). It
 * numbers the Old Testament as the Hebrew Bible does; the app's texts (UHB, ULT) number it as most English and
 * Spanish Bibles do, so each reference is moved with the standard table of Paratext
 * (github.com/Copenhagen-Alliance/versification-specification, data under CC BY-SA 4.0).
 *
 * The list says which words of a verse its parallels share, a digit for each. In the Hebrew it also gives a digit
 * to the sign that ends a section, and to the form a word is read in when it is written otherwise; our text shows
 * neither as a word. Where they are is read from the app's own Hebrew text (unfoldingWord's UHB), one file per
 * book named by its code (`GEN.usfm`): the folder `trees:build` is given too.
 *
 *   npm run parallels:build -- --texts originals                             # reads the rest from GitHub
 *   npm run parallels:build -- --texts originals --xml <file> --map <file>  # or from files already at hand
 *
 * It only writes local files, which are committed: the app serves them itself.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hebrewTokens, hebrewToOurs, parallelFiles, passagesOfXml, type CountedToken } from "../src/domain/parallels";

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

const texts = option("--texts");
if (!texts) throw new Error("Give --texts: the folder of the app's Hebrew texts (see the head of this file).");
// What the list counts in each verse of a book of ours, by `"chapter:verse"`. A book that is not there (the
// Greek ones need not be) gives nothing, and its marks are left as they came.
const byBook = new Map<string, Map<string, CountedToken[]>>();
let found = 0;
function counted(book: string, place: { chapter: number; verse: number }): CountedToken[] {
  let verses = byBook.get(book);
  if (!verses) {
    verses = new Map();
    const file = path.join(texts!, `${book}.usfm`);
    if (existsSync(file)) {
      found++;
      for (const chapter of readFileSync(file, "utf8").split(/(?=\\c \d+)/)) {
        const number = /^\\c (\d+)/.exec(chapter);
        if (!number) continue;
        for (const verse of chapter.split(/(?=\\v \d+)/)) {
          const at = /^\\v (\d+)/.exec(verse);
          if (at) verses.set(`${Number(number[1])}:${Number(at[1])}`, hebrewTokens(verse));
        }
      }
    }
    byBook.set(book, verses);
  }
  return verses.get(`${place.chapter}:${place.verse}`) ?? [];
}

const files = parallelFiles(passages, hebrewToOurs(mapping.mappedVerses), counted);
if (found < 20) throw new Error(`Only ${found} books of the Hebrew were found in ${texts}.`);
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
