/**
 * The diagrams of sentences a team makes its own: one it corrected, one it made for a verse that had none. They
 * are kept in the plan repository of the team's space, a file per chapter, and are shown in place of the ones
 * that come with the app. Changing a diagram is moving boxes: putting some words (or boxes) into a new one,
 * saying what a box is, or taking a box away and leaving what it held.
 */
import { encodeTree, isLeaf, joinedIn, leavesOf, normalizeTreeFile, type TreeLeaf, type TreeNode, type TreePlace, type TreeSentence } from "./syntaxTree";
import { scopeFolder } from "./scope";

/** Where a box or a word is in a diagram: which child of which child, from the whole sentence down. */
export type TreePath = number[];

const idOf = (leaf: TreeLeaf) => leaf.chapter * 1e6 + leaf.verse * 1e3 + leaf.word;

/** What a sentence is known by: its first word. The same before and after its boxes are moved. */
export function sentenceKey(root: TreeNode): string {
  return String(Math.min(...leavesOf(root).map(idOf)));
}

export function nodeAt(root: TreeNode, path: TreePath): TreeNode | TreeLeaf | undefined {
  let here: TreeNode | TreeLeaf | undefined = root;
  for (const index of path) here = here && !isLeaf(here) ? here.kids[index] : undefined;
  return here;
}

/** The diagram with the box at `path` made anew by `change`; the rest is the same boxes. */
function replaceAt(root: TreeNode, path: TreePath, change: (node: TreeNode) => (TreeNode | TreeLeaf)[] | TreeNode): TreeNode {
  if (!path.length) {
    const next = change(root);
    return Array.isArray(next) ? root : next;
  }
  const [index, ...rest] = path as [number, ...number[]];
  const kid = root.kids[index];
  if (!kid || isLeaf(kid)) return root;
  if (rest.length) return { ...root, kids: root.kids.map((other, i) => (i === index ? replaceAt(kid, rest, change) : other)) };
  const next = change(kid);
  return { ...root, kids: root.kids.flatMap((other, i) => (i === index ? next : [other])) };
}

/** What a box is: its function, and whether it is a clause. */
export type BoxKind = { role: string; clause: boolean };

/** Puts the children `from`…`to` of the box at `parent` into a new box of their own, in their place. */
export function wrapKids(root: TreeNode, parent: TreePath, from: number, to: number, kind: BoxKind): TreeNode {
  const [first, last] = [Math.min(from, to), Math.max(from, to)];
  return replaceAt(root, parent, (node) => {
    if (first < 0 || last >= node.kids.length) return node;
    // A box around everything a part with no name of its own holds would be that part twice.
    return { ...node, kids: [...node.kids.slice(0, first), { ...kind, kids: node.kids.slice(first, last + 1) }, ...node.kids.slice(last + 1)] };
  });
}

/** Says what the box at `path` is. The whole sentence stays a clause. */
export function setBoxKind(root: TreeNode, path: TreePath, kind: BoxKind): TreeNode {
  return replaceAt(root, path, (node) => ({ ...node, role: kind.role, clause: path.length ? kind.clause : true }));
}

/** Takes the box at `path` away and leaves what it held where it was. The whole sentence cannot be taken away. */
export function dissolveBox(root: TreeNode, path: TreePath): TreeNode {
  return path.length ? replaceAt(root, path, (node) => node.kids) : root;
}

/**
 * Moves the child `index` of the box at `parent` into the box beside it: the one before (`side` -1), at its end,
 * or the one after (1), at its beginning. The words stay in the order of the text: a word only ever crosses the
 * edge it is next to. Nothing changes when what is beside it is a word, or nothing.
 */
export function moveBeside(root: TreeNode, parent: TreePath, index: number, side: -1 | 1): TreeNode {
  return replaceAt(root, parent, (node) => {
    const item = node.kids[index];
    const beside = node.kids[index + side];
    if (!item || !beside || isLeaf(beside)) return node;
    const grown: TreeNode = { ...beside, kids: side < 0 ? [...beside.kids, item] : [item, ...beside.kids] };
    return { ...node, kids: node.kids.flatMap((kid, i) => (i === index ? [] : i === index + side ? [grown] : [kid])) };
  });
}

/**
 * Takes the first or the last child of a box out of it, to stand before or after the box. One in the middle
 * cannot leave without the words changing order, and stays. A box left with nothing is gone.
 */
export function moveOut(root: TreeNode, path: TreePath): TreeNode {
  if (path.length < 2) return root;
  const boxAt = path[path.length - 2]!;
  const index = path[path.length - 1]!;
  return replaceAt(root, path.slice(0, -2), (outer) => {
    const box = outer.kids[boxAt];
    if (!box || isLeaf(box) || (index !== 0 && index !== box.kids.length - 1)) return outer;
    const item = box.kids[index]!;
    const rest: TreeNode = { ...box, kids: box.kids.filter((_, i) => i !== index) };
    const pieces = !rest.kids.length ? [item] : index === 0 ? [item, rest] : [rest, item];
    return { ...outer, kids: outer.kids.flatMap((kid, i) => (i === boxAt ? pieces : [kid])) };
  });
}

/** What a run of things is as a sentence: the one clause it is, or a clause that holds them. */
function asSentence(kids: (TreeNode | TreeLeaf)[]): TreeNode {
  const only = kids.length === 1 ? kids[0]! : null;
  return only && !isLeaf(only) && only.clause && !only.role ? only : { role: "", clause: true, kids };
}

/**
 * A sentence parted in two before its child `index`: what the analysis took for one sentence, and a team reads
 * as two. Null when there is nothing on one of the sides.
 */
export function splitSentence(root: TreeNode, index: number): [TreeNode, TreeNode] | null {
  if (index <= 0 || index >= root.kids.length) return null;
  return [asSentence(root.kids.slice(0, index)), asSentence(root.kids.slice(index))];
}

/**
 * Two sentences that follow one another made one, as clauses side by side: what the analysis parted, and a team
 * reads together. A sentence that is already several clauses side by side gives its clauses, not itself.
 */
export function joinSentences(first: TreeNode, second: TreeNode): TreeNode {
  const clauses = (root: TreeNode) => (joinedIn(root).length > 1 ? root.kids : [root]);
  return { role: "", clause: true, kids: [...clauses(first), ...clauses(second)] };
}

/** The place of a word in its book as one number, to tell which of two sentences comes first. */
export const leafOrder = (leaf: TreeLeaf): number => idOf(leaf);

/** A sentence with no boxes yet: the words of some verses, one after another, to be put into boxes. */
export function flatSentence(verses: (TreePlace & { words: number })[]): TreeNode {
  return { role: "", clause: true, kids: verses.flatMap((verse) => Array.from({ length: verse.words }, (_, i) => ({ chapter: verse.chapter, verse: verse.verse, word: i + 1 }))) };
}

// ---------------------------------------------------------------- the team's file

/** A team's diagrams of one chapter, by the first word of each sentence, and who left each one as it is. */
export type DiagramDoc = { book: string; chapter: number; sentences: Record<string, unknown[]>; by: Record<string, { by: string; at: string }> };

export const emptyDiagramDoc = (book: string, chapter: number): DiagramDoc => ({ book: book.trim().toUpperCase(), chapter, sentences: {}, by: {} });

/** The file of a chapter, in the folder of the team's space. */
export function diagramsPath(book: string, chapter: number): string {
  return `${scopeFolder()}diagramas/${book.trim().toUpperCase()}/${Math.floor(chapter)}.json`;
}

export function normalizeDiagramDoc(raw: unknown, book: string, chapter: number): DiagramDoc {
  const doc = emptyDiagramDoc(book, chapter);
  const row = raw as { sentences?: unknown; by?: unknown } | null;
  if (!row || typeof row.sentences !== "object" || !row.sentences) return doc;
  for (const [key, tree] of Object.entries(row.sentences as Record<string, unknown>)) {
    // Only what can be read back as a sentence is kept: a file somebody wrote by hand may hold anything.
    if (/^\d+$/.test(key) && Array.isArray(tree) && normalizeTreeFile({ sentences: [tree] })) doc.sentences[key] = tree;
  }
  for (const [key, who] of Object.entries((row.by ?? {}) as Record<string, { by?: unknown; at?: unknown }>)) {
    if (doc.sentences[key] && typeof who?.by === "string") doc.by[key] = { by: who.by, at: typeof who.at === "string" ? who.at : "" };
  }
  return doc;
}

/** The file with a sentence left as `root` by somebody; with no `root`, without the team's diagram of it. */
export function withDiagram(doc: DiagramDoc, key: string, root: TreeNode | null, who: { by: string; at: string }): DiagramDoc {
  const sentences = { ...doc.sentences };
  const by = { ...doc.by };
  delete sentences[key];
  delete by[key];
  if (root) {
    const own = sentenceKey(root);
    sentences[own] = encodeTree(root);
    by[own] = who;
  }
  return { ...doc, sentences, by };
}

/** The sentences of a team's file, to be shown. */
export function diagramSentences(doc: DiagramDoc | null | undefined): (TreeSentence & { key: string; by?: { by: string; at: string } })[] {
  if (!doc) return [];
  return Object.entries(doc.sentences).flatMap(([key, tree]) => {
    const sentence = normalizeTreeFile({ sentences: [tree] })?.sentences[0];
    return sentence ? [{ ...sentence, key, by: doc.by[key] }] : [];
  });
}

/**
 * What is shown for a verse: the team's diagrams that reach it, and of the ones that come with the app, those
 * that share no word with a diagram of the team (the team's one is in place of them).
 */
export function sentencesShown<T extends TreeSentence>(shipped: T[], team: (TreeSentence & { key: string })[], at: TreePlace): (T | (TreeSentence & { key: string }))[] {
  const here = team.filter((sentence) => sentence.verses.some((verse) => verse.chapter === at.chapter && verse.verse === at.verse));
  const taken = new Set(team.flatMap((sentence) => leavesOf(sentence.root).map(idOf)));
  const first = (sentence: TreeSentence) => Math.min(...leavesOf(sentence.root).map(idOf));
  return [...here, ...shipped.filter((sentence) => !leavesOf(sentence.root).some((leaf) => taken.has(idOf(leaf))))].sort((a, b) => first(a) - first(b));
}
