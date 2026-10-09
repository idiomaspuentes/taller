/**
 * Builds how each sentence of the original is put together, for the sheet that shows it: one file per book in
 * `public/trees/`, and an index of the books.
 *
 * The analysis is MACULA's (github.com/Clear-Bible/macula-hebrew and macula-greek, by Biblica, CC BY 4.0). Its
 * trees weigh 500 MB; what is kept is the parts of each sentence that have a function, and the place of each
 * word in its verse. The Hebrew is moved to the numbering of the app's texts, as the parallel passages are.
 *
 * The trees are read from two folders already at hand, since they are too many to ask for one by one:
 *
 *   git clone --depth 1 --filter=blob:none --sparse https://github.com/Clear-Bible/macula-hebrew && git -C macula-hebrew sparse-checkout set WLC/lowfat
 *   git clone --depth 1 --filter=blob:none --sparse https://github.com/Clear-Bible/macula-greek && git -C macula-greek sparse-checkout set SBLGNT/lowfat
 *   npm run trees:build -- --hebrew macula-hebrew/WLC/lowfat --greek macula-greek/SBLGNT/lowfat [--map eng.json]
 *
 * It only writes local files, which are committed: the app serves them itself.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hebrewToOurs } from "../src/domain/parallels";
import { encodeTree, leavesOf, parseLowfat, reduceSentence, type RawNode, type TreeNode } from "../src/domain/syntaxTree";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "public", "trees");
const MAP = "https://raw.githubusercontent.com/Copenhagen-Alliance/versification-specification/master/versification-mappings/standard-mappings/eng.json";

const args = process.argv.slice(2);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const hebrew = option("--hebrew");
const greek = option("--greek");
if (!hebrew || !greek) throw new Error("Give --hebrew and --greek: the folders of MACULA's lowfat trees (see the head of this file).");

const mapFile = option("--map");
const mapping = JSON.parse(mapFile ? await readFile(mapFile, "utf8") : await (await fetch(MAP)).text()) as { mappedVerses: Record<string, string> };
const toOurs = hebrewToOurs(mapping.mappedVerses);

const bookOf = (raw: RawNode): string | undefined => raw.ref?.book ?? raw.kids.map(bookOf).find(Boolean);
const books = new Map<string, TreeNode[]>();
const roles = new Map<string, number>();
const count = (node: TreeNode) => {
  if (node.role) roles.set(node.role, (roles.get(node.role) ?? 0) + 1);
  for (const kid of node.kids) if (!("word" in kid)) count(kid);
};

for (const [folder, move] of [[hebrew, toOurs], [greek, undefined]] as const) {
  for (const name of (await readdir(folder)).filter((file) => file.endsWith(".xml")).sort()) {
    for (const raw of parseLowfat(await readFile(path.join(folder, name), "utf8"))) {
      const book = bookOf(raw);
      const tree = book ? reduceSentence(raw, move) : null;
      // The title of a psalm is a verse of its own in the Hebrew Bible and none in our texts.
      if (!book || !tree || !leavesOf(tree).length) continue;
      count(tree);
      books.set(book, [...(books.get(book) ?? []), tree]);
    }
  }
}
if (books.size < 60) throw new Error(`Only ${books.size} books came out: the trees are not what they were.`);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const names = [...books.keys()].sort();
let bytes = 0;
let sentences = 0;
for (const book of names) {
  const text = `${JSON.stringify({ sentences: books.get(book)!.map(encodeTree) })}\n`;
  bytes += Buffer.byteLength(text);
  sentences += books.get(book)!.length;
  await writeFile(path.join(OUT, `${book}.json`), text);
}
await writeFile(
  path.join(OUT, "index.json"),
  `${JSON.stringify({ source: "MACULA Hebrew and Greek Linguistic Datasets, Biblica (github.com/Clear-Bible/macula-hebrew, github.com/Clear-Bible/macula-greek)", license: "CC BY 4.0", books: names }, null, 2)}\n`,
);
console.log(`${names.length} books, ${sentences} sentences, ${(bytes / 1e6).toFixed(1)} MB written to ${path.relative(process.cwd(), OUT)}`);
console.log(`functions: ${[...roles].sort((a, b) => b[1] - a[1]).map(([role, n]) => `${role}:${n}`).join(" ")}`);
