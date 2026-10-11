/**
 * Writes the table that says how the Hebrew Bible numbers the verses our texts number otherwise (Jonah 1:17 here
 * is 2:1 there), for the app to look a verse up in resources that keep the Hebrew numbering: the lexicon says
 * which sense a word has verse by verse, in that numbering.
 *
 * It is the standard table of Paratext (github.com/Copenhagen-Alliance/versification-specification, data under
 * CC BY-SA 4.0), kept to the books of the Old Testament and to plain verses.
 *
 *   npm run hebrew-numbering:build              # reads it from GitHub
 *   npm run hebrew-numbering:build -- --map <file>
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOOKS } from "../src/domain/books";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "src", "domain", "hebrewNumbering.json");
const MAP = "https://raw.githubusercontent.com/Copenhagen-Alliance/versification-specification/master/versification-mappings/standard-mappings/eng.json";

const args = process.argv.slice(2);
const file = args.includes("--map") ? args[args.indexOf("--map") + 1] : undefined;
const mapping = JSON.parse(file ? await readFile(file, "utf8") : await (await fetch(MAP)).text()) as { mappedVerses: Record<string, string> };

// The first 39 books are the Old Testament; a side with a letter («ESG 1:1a») is of a book we do not have.
const old = new Set(BOOKS.slice(0, 39).map((book) => book.code));
const SIDE = /^([1-3A-Z][A-Z]{2}) \d+:\d+(-\d+)?$/;
const mapped = Object.fromEntries(Object.entries(mapping.mappedVerses).filter(([ours, theirs]) => SIDE.test(ours) && SIDE.test(theirs) && old.has(ours.slice(0, 3)) && ours.slice(0, 3) === theirs.slice(0, 3)));
if (Object.keys(mapped).length < 100) throw new Error(`Only ${Object.keys(mapped).length} lines came out: the table is not what it was.`);

await writeFile(OUT, `${JSON.stringify({ source: "Paratext standard versification mappings (github.com/Copenhagen-Alliance/versification-specification)", license: "CC BY-SA 4.0", mapped }, null, 1)}\n`);
console.log(`${Object.keys(mapped).length} lines written to ${path.relative(process.cwd(), OUT)}`);
