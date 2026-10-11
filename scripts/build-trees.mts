/**
 * Builds how each sentence of the original is put together, for the sheet that shows it: one file per book in
 * `public/trees/`, and an index of the books.
 *
 * The analysis is MACULA's (github.com/Clear-Bible/macula-hebrew and macula-greek, by Biblica, CC BY 4.0). Its
 * trees weigh 500 MB; what is kept is the parts of each sentence that have a function, and the place of each
 * word in its verse. The Hebrew is moved to the numbering of the app's texts, as the parallel passages are.
 *
 * MACULA analysed other editions than the ones the app reads (the Westminster Leningrad Codex and the SBL Greek
 * New Testament; the app, unfoldingWord's UHB and UGNT), so each word is given the place it has in the app's
 * text, where it is found by its letters. A word the app's text does not have is left out; one only the app's
 * text has is in no sentence, and the sheet says so.
 *
 * The trees and the texts are read from folders already at hand, since they are too many to ask for one by one:
 *
 *   git clone --depth 1 --filter=blob:none --sparse https://github.com/Clear-Bible/macula-hebrew && git -C macula-hebrew sparse-checkout set WLC/lowfat
 *   git clone --depth 1 --filter=blob:none --sparse https://github.com/Clear-Bible/macula-greek && git -C macula-greek sparse-checkout set SBLGNT/lowfat
 *   npm run trees:build -- --hebrew macula-hebrew/WLC/lowfat --greek macula-greek/SBLGNT/lowfat --texts originals [--map eng.json]
 *
 * `originals` holds the app's texts, one file per book named by its code (`GEN.usfm`, `MAT.usfm`): the books of
 * git.door43.org/unfoldingWord/hbo_uhb and el-x-koine_ugnt.
 *
 * It only writes local files, which are committed: the app serves them itself.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hebrewToOurs } from "../src/domain/parallels";
import { encodeTree, fitWords, leavesOf, parseLowfat, reduceSentence, type RawNode, type TreeLeaf, type TreeNode } from "../src/domain/syntaxTree";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "public", "trees");
const MAP = "https://raw.githubusercontent.com/Copenhagen-Alliance/versification-specification/master/versification-mappings/standard-mappings/eng.json";

const args = process.argv.slice(2);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const hebrew = option("--hebrew");
const greek = option("--greek");
const texts = option("--texts");
if (!hebrew || !greek || !texts) throw new Error("Give --hebrew and --greek, the folders of MACULA's lowfat trees, and --texts, the folder of the app's texts (see the head of this file).");

const mapFile = option("--map");
const mapping = JSON.parse(mapFile ? await readFile(mapFile, "utf8") : await (await fetch(MAP)).text()) as { mappedVerses: Record<string, string> };
const toOurs = hebrewToOurs(mapping.mappedVerses);

const bookOf = (raw: RawNode): string | undefined => raw.ref?.book ?? raw.kids.map(bookOf).find(Boolean);
const books = new Map<string, TreeNode[]>();

/**
 * The words of each verse of a book in the app's text, by `"chapter:verse"`, counted as the app counts them: the
 * title of a psalm is of no verse, and a word that is read otherwise than it is written is two words, the one
 * written and, in its note, the one read.
 */
const ours = new Map<string, Map<string, string[]>>();
async function ourWords(book: string): Promise<Map<string, string[]>> {
  const known = ours.get(book);
  if (known) return known;
  const file = path.join(texts!, `${book}.usfm`);
  if (!existsSync(file)) throw new Error(`The app's text of ${book} is not in ${texts}.`);
  const verses = new Map<string, string[]>();
  let chapter = 0;
  let verse = 0;
  for (const found of (await readFile(file, "utf8")).matchAll(/\\c (\d+)|\\v (\d+)|\\\+?w ([^|\\]+)[|\\]/g)) {
    if (found[1]) [chapter, verse] = [Number(found[1]), 0];
    else if (found[2]) verse = Number(found[2]);
    else if (verse) verses.set(`${chapter}:${verse}`, [...(verses.get(`${chapter}:${verse}`) ?? []), found[3]!.trim()]);
  }
  ours.set(book, verses);
  return verses;
}

type Theirs = TreeLeaf & { text: string };
const wordsIn = (raw: RawNode, into: Map<string, Theirs>) => {
  if (raw.word && raw.ref) {
    const key = `${raw.ref.chapter}:${raw.ref.verse}!${raw.ref.word}`;
    const known = into.get(key);
    // The pieces of a Hebrew word are one word.
    if (known) known.text += raw.text;
    else into.set(key, { chapter: raw.ref.chapter, verse: raw.ref.verse, word: raw.ref.word, text: raw.text });
  }
  for (const kid of raw.kids) wordsIn(kid, into);
};

let placed = 0;
let leftOut = 0;
let moved = 0;
/**
 * Where each word of the analysis of a book is in the app's text, by its place there (`"chapter:verse!word"`).
 * The words of all the verses of theirs that are one verse of ours are found in it together, in their order.
 */
async function placesOf(book: string, sentences: RawNode[], move: ((book: string, place: TreeLeaf) => { chapter: number; verse: number }) | undefined) {
  const theirs = new Map<string, Theirs>();
  for (const raw of sentences) wordsIn(raw, theirs);
  const byVerse = new Map<string, { at: { chapter: number; verse: number }; key: string; word: Theirs }[]>();
  for (const [key, word] of theirs) {
    const at = move ? move(book, word) : word;
    const verse = `${at.chapter}:${at.verse}`;
    byVerse.set(verse, [...(byVerse.get(verse) ?? []), { at: { chapter: at.chapter, verse: at.verse }, key, word }]);
  }
  const here = await ourWords(book);
  const places = new Map<string, TreeLeaf | null>();
  for (const [verse, words] of byVerse) {
    words.sort((a, b) => a.word.chapter - b.word.chapter || a.word.verse - b.word.verse || a.word.word - b.word.word);
    const fit = fitWords(words.map((each) => each.word.text), here.get(verse) ?? []);
    words.forEach((each, i) => {
      const found = fit[i];
      places.set(each.key, found === null || found === undefined ? null : { ...each.at, word: found + 1 });
      if (found === null || found === undefined) leftOut++;
      else placed++;
      if (found !== null && found !== undefined && found + 1 !== each.word.word) moved++;
    });
  }
  return places;
}
const roles = new Map<string, number>();
const count = (node: TreeNode) => {
  if (node.role) roles.set(node.role, (roles.get(node.role) ?? 0) + 1);
  for (const kid of node.kids) if (!("word" in kid)) count(kid);
};

for (const [folder, move] of [[hebrew, toOurs], [greek, undefined]] as const) {
  // A book is one file in the Greek and one per chapter in the Hebrew: read whole before its words are placed,
  // since a verse of ours may be made of verses of two chapters of theirs.
  const raws = new Map<string, RawNode[]>();
  for (const name of (await readdir(folder)).filter((file) => file.endsWith(".xml")).sort()) {
    for (const raw of parseLowfat(await readFile(path.join(folder, name), "utf8"))) {
      const book = bookOf(raw);
      if (book) raws.set(book, [...(raws.get(book) ?? []), raw]);
    }
  }
  for (const [book, sentences] of raws) {
    const places = await placesOf(book, sentences, move);
    for (const raw of sentences) {
      const tree = reduceSentence(raw, (_book, place) => places.get(`${place.chapter}:${place.verse}!${place.word}`) ?? null);
      // The title of a psalm is a verse of its own in the Hebrew Bible and none in our texts.
      if (!tree || !leavesOf(tree).length) continue;
      count(tree);
      books.set(book, [...(books.get(book) ?? []), tree]);
    }
  }
}
if (books.size < 60) throw new Error(`Only ${books.size} books came out: the trees are not what they were.`);
if (leftOut > placed / 50) throw new Error(`${leftOut} words of the analysis were not found in the app's texts, of ${placed + leftOut}: the texts are not the ones it was made for.`);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const names = [...books.keys()].sort();
let bytes = 0;
let sentences = 0;
let unheld = 0;
for (const book of names) {
  // How many words a verse has is told by its last word in a sentence; said apart where that one is in none.
  const last = new Map<string, number>();
  const held = new Set<string>();
  for (const tree of books.get(book)!) {
    for (const leaf of leavesOf(tree)) {
      const verse = `${leaf.chapter}:${leaf.verse}`;
      last.set(verse, Math.max(last.get(verse) ?? 0, leaf.word));
      held.add(`${verse}!${leaf.word}`);
    }
  }
  const words: Record<string, number> = {};
  for (const [verse, list] of ours.get(book)!) {
    if (!last.has(verse)) continue;
    if (last.get(verse) !== list.length) words[verse] = list.length;
    unheld += list.filter((_, i) => !held.has(`${verse}!${i + 1}`)).length;
  }
  const text = `${JSON.stringify({ sentences: books.get(book)!.map(encodeTree), ...(Object.keys(words).length ? { words } : {}) })}\n`;
  bytes += Buffer.byteLength(text);
  sentences += books.get(book)!.length;
  await writeFile(path.join(OUT, `${book}.json`), text);
}
await writeFile(
  path.join(OUT, "index.json"),
  `${JSON.stringify({ source: "MACULA Hebrew and Greek Linguistic Datasets, Biblica (github.com/Clear-Bible/macula-hebrew, github.com/Clear-Bible/macula-greek)", license: "CC BY 4.0", books: names }, null, 2)}\n`,
);
console.log(`${names.length} books, ${sentences} sentences, ${(bytes / 1e6).toFixed(1)} MB written to ${path.relative(process.cwd(), OUT)}`);
console.log(`words of the analysis: ${placed} found in the app's texts (${moved} at another place in their verse), ${leftOut} not there and left out; ${unheld} words of the app's texts are in no sentence`);
console.log(`functions: ${[...roles].sort((a, b) => b[1] - a[1]).map(([role, n]) => `${role}:${n}`).join(" ")}`);
