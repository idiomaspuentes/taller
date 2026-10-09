/**
 * How a sentence of the original is put together: its clauses, and in each one what is the verb, the subject,
 * the object. The analysis is MACULA's (Clear-Bible/macula-hebrew and macula-greek, by Biblica, CC BY 4.0),
 * reduced by `scripts/build-trees.mts` to what a narrow screen can show: the parts that have a function, one
 * inside another, and the words of each by their place in the verse.
 *
 * The words themselves are not kept: they are read from the app's own text of the original, so each can open
 * its sheet. MACULA reads other editions, so a sentence is shown only where its verses have as many words there
 * as here.
 */

export type TreePlace = { chapter: number; verse: number };

/** A word of a sentence, by its place in its verse (from 1). `piece` when only a part of it has the function. */
export type TreeLeaf = TreePlace & { word: number; piece?: string };

/**
 * A part of a sentence with a function (`role`: `s`, `v`, `o`…), or a clause (`clause`), and what it is made of.
 * The role `&` is a word that joins: an «and» between two clauses or two nouns, a «because» before a clause.
 */
export type TreeNode = { role: string; clause: boolean; kids: (TreeNode | TreeLeaf)[] };

export const LINK = "&";

export type TreeSentence = { root: TreeNode; verses: TreePlace[] };

export type TreeFile = { sentences: TreeSentence[]; /** How many words each verse has there, by `"chapter:verse"`. */ counts: Map<string, number> };

export const isLeaf = (kid: TreeNode | TreeLeaf): kid is TreeLeaf => "word" in kid;

const placeKey = (place: TreePlace) => `${place.chapter}:${place.verse}`;

export function leavesOf(node: TreeNode): TreeLeaf[] {
  return node.kids.flatMap((kid) => (isLeaf(kid) ? [kid] : leavesOf(kid)));
}

// ---------------------------------------------------------------- what kind of sentence it is

/** A clause that is shown as one: a verb alone that MACULA counts as a clause (an infinitive) is shown as a verb. */
export const isClause = (node: TreeNode) => node.clause && node.role !== "v";

const partsOf = (node: TreeNode) => node.kids.filter((kid): kid is TreeNode => !isLeaf(kid));

/** The clauses a clause only holds together, when it is nothing but them: «he rose, and went, and found a ship». */
export function joinedIn(node: TreeNode): TreeNode[] {
  if (!isClause(node)) return [];
  const parts = partsOf(node);
  const own = node.kids.some(isLeaf) || parts.some((part) => part.role !== LINK && !(isClause(part) && !part.role));
  return own ? [] : parts.filter((part) => isClause(part) && !part.role);
}

/**
 * How a clause stands in its sentence. `joined`: one of several side by side. `as`: it fills a place of the clause
 * it is in (its object, a circumstance). `describes`: it is inside a part, saying something of it («the ship
 * that was going to Tarshish»). `main` otherwise.
 */
export type ClauseKind = "main" | "joined" | "as" | "describes";

export function clauseKind(node: TreeNode, parent: TreeNode | undefined): ClauseKind {
  if (node.role) return "as";
  if (!parent) return "main";
  if (!isClause(parent)) return "describes";
  return joinedIn(parent).length > 1 ? "joined" : "main";
}

/**
 * A sentence in three numbers: how many clauses it has, how many of them depend on another (a complex sentence),
 * and how many stand side by side at most (a compound one). A clause that only holds others together is not
 * counted as one more.
 */
export function sentenceShape(root: TreeNode): { clauses: number; subordinate: number; joined: number } {
  const shape = { clauses: 0, subordinate: 0, joined: 0 };
  const walk = (node: TreeNode, parent: TreeNode | undefined) => {
    if (isClause(node)) {
      const held = joinedIn(node);
      if (!held.length) shape.clauses++;
      if (held.length > 1) shape.joined = Math.max(shape.joined, held.length);
      const kind = clauseKind(node, parent);
      if (kind === "as" || kind === "describes") shape.subordinate++;
    }
    for (const part of partsOf(node)) walk(part, node);
  };
  walk(root, undefined);
  return shape;
}

// ---------------------------------------------------------------- reading a served file

function decode(raw: unknown): TreeNode | TreeLeaf | null {
  if (typeof raw === "number") return { chapter: Math.floor(raw / 1e6), verse: Math.floor(raw / 1e3) % 1000, word: raw % 1000 };
  if (!Array.isArray(raw)) return null;
  if (typeof raw[0] === "number") {
    const leaf = decode(raw[0]) as TreeLeaf;
    return typeof raw[1] === "string" && raw[1] ? { ...leaf, piece: raw[1] } : leaf;
  }
  if (typeof raw[0] !== "string") return null;
  const kids = raw.slice(1).map(decode).filter((kid): kid is TreeNode | TreeLeaf => Boolean(kid));
  return kids.length ? { role: raw[0].replace("*", ""), clause: raw[0].endsWith("*"), kids } : null;
}

/**
 * A file as it is served: `{ sentences: [["*", ["v", 1001001], ["s", 1001002, 1001003]]] }`. A part is its
 * function (with `*` when it is a clause) and then what it holds; a word is chapter, verse and place in one
 * number, or `[number, "piece"]`.
 */
export function normalizeTreeFile(raw: unknown): TreeFile | null {
  const rows = (raw as { sentences?: unknown } | null)?.sentences;
  if (!Array.isArray(rows)) return null;
  const sentences: TreeSentence[] = [];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const root = decode(row);
    if (!root || isLeaf(root)) continue;
    const verses = new Map<string, TreePlace>();
    for (const leaf of leavesOf(root)) {
      verses.set(placeKey(leaf), { chapter: leaf.chapter, verse: leaf.verse });
      counts.set(placeKey(leaf), Math.max(counts.get(placeKey(leaf)) ?? 0, leaf.word));
    }
    sentences.push({ root, verses: [...verses.values()] });
  }
  return sentences.length ? { sentences, counts } : null;
}

/** The sentences a verse is part of: nearly always one, two when a verse ends one and begins the next. */
export function sentencesAt(file: TreeFile | null | undefined, at: TreePlace): TreeSentence[] {
  return (file?.sentences ?? []).filter((sentence) => sentence.verses.some((verse) => verse.chapter === at.chapter && verse.verse === at.verse));
}

/** Whether every verse of a sentence has here as many words as the analysis counted: only then is a place a word. */
export function sentenceFits(file: TreeFile, sentence: TreeSentence, wordsHere: (place: TreePlace) => number | undefined): boolean {
  return sentence.verses.every((verse) => wordsHere(verse) === file.counts.get(placeKey(verse)));
}

// ---------------------------------------------------------------- building the files

/** A node of MACULA's tree: a group (`wg`) or a word, or a piece of a word in Hebrew (`w`). */
export type RawNode = { word: boolean; role: string; cls: string; ref?: { book: string; chapter: number; verse: number; word: number }; text: string; kids: RawNode[] };

const attrsOf = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map((found) => [found[1]!, found[2]!]));

/** The sentences of a lowfat file, each as the group that holds it whole. */
export function parseLowfat(xml: string): RawNode[] {
  const sentences: RawNode[] = [];
  let stack: RawNode[] = [];
  for (const tag of xml.matchAll(/<(\/?)(sentence|wg|w)\b([^>]*?)(\/?)>([^<]*)/g)) {
    const [, close, name, attrs, , text] = tag;
    if (name === "sentence") {
      if (close) {
        if (stack[0]?.kids.length) sentences.push(stack[0]);
        stack = [];
      } else stack = [{ word: false, role: "", cls: "", text: "", kids: [] }];
      continue;
    }
    if (!stack.length) continue;
    if (close) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const a = attrsOf(attrs ?? "");
    const ref = /^([1-3A-Z][A-Z]{2}) (\d+):(\d+)!(\d+)/.exec(a.ref ?? "");
    // A few groups carry a note of the analysts' tool where the function goes: that is no function.
    const node: RawNode = { word: name === "w", role: /^[a-z][a-z0-9]{0,5}$/.test(a.role ?? "") ? a.role! : "", cls: a.class ?? "", text: (text ?? "").trim(), kids: [], ...(ref ? { ref: { book: ref[1]!, chapter: Number(ref[2]), verse: Number(ref[3]), word: Number(ref[4]) } } : {}) };
    stack[stack.length - 1]!.kids.push(node);
    stack.push(node);
  }
  return sentences;
}

type Leaf = TreeLeaf & { texts: string[] };
type Part = { role: string; clause: boolean; kids: (Part | Leaf)[] };
const leafOf = (kid: Part | Leaf): kid is Leaf => "word" in kid;
const wordId = (leaf: TreeLeaf) => leaf.chapter * 1e6 + leaf.verse * 1e3 + leaf.word;
const idsIn = (part: Part): number[] => part.kids.flatMap((kid) => (leafOf(kid) ? [wordId(kid)] : idsIn(kid)));
const firstOf = (kid: Part | Leaf): number => (leafOf(kid) ? wordId(kid) : Math.min(...idsIn(kid)));

/** A piece as it is shown: without the marks of the chant. */
const shown = (text: string) => text.normalize("NFC").replace(/[֑-ֽ֯׀׃]/g, "").trim();

/**
 * A sentence of MACULA reduced to its parts. Only what has a function, or is a clause, stays as a part; the
 * groups between (a noun with its article, two nouns joined) give their words to the part they are in. A part
 * that holds nothing but one other is one part with it. The pieces of a Hebrew word are one word; when two
 * parts share a word («me rodearon»: the verb and its object; «y dijo»: the «and» and the verb), each says which
 * piece is its own.
 */
export function reduceSentence(raw: RawNode, toOurs: (book: string, place: TreePlace) => TreePlace = (_book, place) => place): TreeNode | null {
  const items = (node: RawNode): (Part | Leaf)[] => {
    if (node.word) {
      if (!node.ref) return [];
      const place = toOurs(node.ref.book, node.ref);
      const leaf: Leaf = { chapter: place.chapter, verse: place.verse, word: node.ref.word, texts: [node.text] };
      // A word that joins is kept as what it is: it is what says whether two clauses stand side by side.
      const role = node.role || (/^(cj|conj)$/.test(node.cls) ? LINK : "");
      return role ? [{ role, clause: false, kids: [leaf] }] : [leaf];
    }
    const kids = node.kids.flatMap(items);
    return node.role || node.cls === "cl" ? [{ role: node.role, clause: node.cls === "cl", kids }] : kids;
  };
  const tidy = (part: Part): Part => {
    let kids = part.kids.map((kid) => (leafOf(kid) ? kid : tidy(kid)));
    // The pieces of one word that are loose in this part are that word, once.
    const loose = new Map<number, Leaf>();
    kids = kids.filter((kid) => {
      if (!leafOf(kid)) return true;
      const known = loose.get(wordId(kid));
      if (known) known.texts.push(...kid.texts);
      else loose.set(wordId(kid), kid);
      return !known;
    });
    // A loose piece of a word that a part beside it holds (the «and» joined to a verb) is shown with that part.
    const held = new Set(kids.filter((kid): kid is Part => !leafOf(kid)).flatMap(idsIn));
    kids = kids.filter((kid) => !leafOf(kid) || !held.has(wordId(kid)));
    // In the order of the text: the tree of the Greek moves a particle before the word it follows.
    kids.sort((a, b) => firstOf(a) - firstOf(b));
    let role = part.role;
    let clause = part.clause;
    while (kids.length === 1 && !leafOf(kids[0]!) && (!role || !kids[0]!.role)) {
      const only = kids[0] as Part;
      role ||= only.role;
      clause ||= only.clause;
      kids = only.kids;
    }
    return { role, clause, kids };
  };
  const root = tidy({ role: "", clause: true, kids: items(raw) });
  if (!root.kids.length) return null;
  // Which pieces of a word each part holds matters only where two parts hold pieces of the same word.
  const share = (part: Part) => {
    const groups = part.kids.filter((kid): kid is Part => !leafOf(kid));
    const times = new Map<number, number>();
    for (const group of groups) for (const id of new Set(idsIn(group))) times.set(id, (times.get(id) ?? 0) + 1);
    const mark = (inner: Part) => {
      for (const kid of inner.kids) {
        if (!leafOf(kid)) mark(kid);
        else if ((times.get(wordId(kid)) ?? 0) > 1) kid.piece = shown(kid.texts.join(""));
      }
    };
    for (const group of groups) {
      mark(group);
      share(group);
    }
  };
  share(root);
  const plain = (part: Part): TreeNode => ({
    role: part.role,
    clause: part.clause,
    kids: part.kids.map((kid) => (leafOf(kid) ? { chapter: kid.chapter, verse: kid.verse, word: kid.word, ...(kid.piece ? { piece: kid.piece } : {}) } : plain(kid))),
  });
  return plain(root);
}

/** A sentence as it is written to a file (see `normalizeTreeFile`). */
export function encodeTree(node: TreeNode): unknown[] {
  return [`${node.role}${node.clause ? "*" : ""}`, ...node.kids.map((kid) => (isLeaf(kid) ? (kid.piece ? [wordId(kid), kid.piece] : wordId(kid)) : encodeTree(kid)))];
}
