/**
 * Where each node of a sentence goes when it is drawn as a tree: the sentence at the top, its parts under it, and
 * the words in a row at the bottom, in the order they are read. A part stands over the middle of what it holds,
 * and is given as much room as its own name needs, so that two names side by side never run into each other.
 */
import { isLeaf, type TreeLeaf, type TreeNode } from "./syntaxTree";
import type { TreePath } from "./diagrams";

export type PlacedNode = { path: TreePath; node: TreeNode; parent?: TreeNode; nth?: number; x: number; depth: number; width: number };
export type PlacedLeaf = { path: TreePath; leaf: TreeLeaf; role: string; x: number; width: number };
/** A branch, from the middle of a part down to the middle of what hangs from it. */
export type Branch = { from: { x: number; depth: number }; to: { x: number; depth: number } | { x: number; leaf: true } };

export type TreeLayout = { nodes: PlacedNode[]; leaves: PlacedLeaf[]; branches: Branch[]; width: number; depth: number };

/**
 * `labelWidth` and `leafWidth` say how wide a name and a word are drawn; `gap` is the room between two neighbours.
 * `rtl` lays the words from right to left, as Hebrew is read. Positions are the middle of each thing, from the left.
 */
export function layoutTree(root: TreeNode, sizes: { labelWidth: (node: TreeNode, parent: TreeNode | undefined) => number; leafWidth: (leaf: TreeLeaf) => number; gap: number; rtl?: boolean }): TreeLayout {
  const nodes: PlacedNode[] = [];
  const leaves: PlacedLeaf[] = [];
  const branches: Branch[] = [];
  let depth = 0;

  /** How much room a subtree takes: what it holds, or its own name when that is wider. */
  const widths = new Map<TreeNode | TreeLeaf, number>();
  const measure = (item: TreeNode | TreeLeaf, parent: TreeNode | undefined): number => {
    const width = isLeaf(item)
      ? sizes.leafWidth(item)
      : Math.max(
          sizes.labelWidth(item, parent),
          item.kids.reduce((sum, kid) => sum + measure(kid, item), 0) + sizes.gap * Math.max(0, item.kids.length - 1),
        );
    widths.set(item, width);
    return width;
  };

  /** Places a subtree in the room from `left`; gives back the middle it stands over. */
  const place = (item: TreeNode | TreeLeaf, left: number, level: number, path: TreePath, parent: TreeNode | undefined, nth: number | undefined): number => {
    const room = widths.get(item)!;
    if (isLeaf(item)) {
      const x = left + room / 2;
      leaves.push({ path, leaf: item, role: parent?.role ?? "", x, width: room });
      return x;
    }
    depth = Math.max(depth, level);
    const inner = item.kids.reduce((sum, kid) => sum + widths.get(kid)!, 0) + sizes.gap * Math.max(0, item.kids.length - 1);
    // What it holds is centred under a name that is wider than it.
    let at = left + (room - inner) / 2;
    const middles: number[] = [];
    let clauses = 0;
    item.kids.forEach((kid, i) => {
      const count = !isLeaf(kid) && kid.clause && !kid.role ? ++clauses : undefined;
      middles.push(place(kid, at, level + 1, [...path, i], item, count));
      at += widths.get(kid)! + sizes.gap;
    });
    const x = middles.length ? (middles[0]! + middles[middles.length - 1]!) / 2 : left + room / 2;
    nodes.push({ path, node: item, parent, nth, x, depth: level, width: sizes.labelWidth(item, parent) });
    item.kids.forEach((kid, i) => branches.push({ from: { x, depth: level }, to: isLeaf(kid) ? { x: middles[i]!, leaf: true } : { x: middles[i]!, depth: level + 1 } }));
    return x;
  };

  const width = measure(root, undefined);
  place(root, 0, 0, [], undefined, undefined);
  if (sizes.rtl) {
    const flip = (x: number) => width - x;
    for (const node of nodes) node.x = flip(node.x);
    for (const leaf of leaves) leaf.x = flip(leaf.x);
    for (const branch of branches) {
      branch.from.x = flip(branch.from.x);
      branch.to.x = flip(branch.to.x);
    }
  }
  return { nodes, leaves, branches, width, depth };
}
