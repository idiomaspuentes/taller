/**
 * The way from one piece of the texts on a screen to the next or the previous one: in its own text first, then in
 * the texts that follow (or come before) it in `order`. What the app writes itself (`skip`) is passed over: there
 * is nothing there for whoever goes through the texts. Pure, so it can be tested; `usePieces` uses it.
 */

export type PieceSpot = { id: string; index: number };
export type PieceCounts = Record<string, { count: number; skip: number[] } | undefined>;

export function pieceAfter(counts: PieceCounts, order: string[], id: string, index: number): PieceSpot | null {
  const firstFrom = (text: string, from: number): PieceSpot | null => {
    const of = counts[text];
    for (let at = from; at < (of?.count ?? 0); at++) if (!of!.skip.includes(at)) return { id: text, index: at };
    return null;
  };
  const here = firstFrom(id, index + 1);
  if (here) return here;
  for (const other of order.slice(order.indexOf(id) + 1)) {
    const there = firstFrom(other, 0);
    if (there) return there;
  }
  return null;
}

export function pieceBefore(counts: PieceCounts, order: string[], id: string, index: number): PieceSpot | null {
  const lastFrom = (text: string, from: number): PieceSpot | null => {
    const of = counts[text];
    for (let at = Math.min(from, (of?.count ?? 0) - 1); at >= 0; at--) if (!of!.skip.includes(at)) return { id: text, index: at };
    return null;
  };
  const here = lastFrom(id, index - 1);
  if (here) return here;
  const at = order.indexOf(id);
  for (const other of order.slice(0, at < 0 ? 0 : at).reverse()) {
    const there = lastFrom(other, Number.MAX_SAFE_INTEGER);
    if (there) return there;
  }
  return null;
}
