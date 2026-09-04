/**
 * Faithful port of the subset of Python's difflib.SequenceMatcher that
 * fcr_scan/detect.py relies on: `SequenceMatcher(None, left, right).ratio()`
 * — no custom isjunk function, default autojunk=True. Algorithm mirrors
 * CPython's Lib/difflib.py (find_longest_match / get_matching_blocks /
 * ratio) so thresholds tuned against the real Python stay meaningful here.
 */

type Match = { a: number; b: number; size: number };

function calculateRatio(matches: number, length: number): number {
  return length ? (2.0 * matches) / length : 1.0;
}

class SequenceMatcher {
  private a: string;
  private b: string;
  private b2j: Map<string, number[]>;
  private bPopular: Set<string>;
  private matchingBlocks: Match[] | null = null;

  constructor(a: string, b: string) {
    this.a = a;
    this.b = b;
    this.b2j = new Map();
    this.bPopular = new Set();
    this.chainB();
  }

  private chainB(): void {
    const b = this.b;
    const b2j = this.b2j;
    for (let i = 0; i < b.length; i++) {
      const elt = b[i];
      let indices = b2j.get(elt);
      if (!indices) {
        indices = [];
        b2j.set(elt, indices);
      }
      indices.push(i);
    }
    // autojunk=True: elements that dominate a long second sequence stop
    // counting as meaningful matches (they're treated as noise, e.g. runs
    // of spaces in long prose).
    const n = b.length;
    if (n >= 200) {
      const ntest = Math.floor(n / 100) + 1;
      for (const [elt, idxs] of b2j) {
        if (idxs.length > ntest) this.bPopular.add(elt);
      }
      for (const elt of this.bPopular) b2j.delete(elt);
    }
  }

  private findLongestMatch(alo: number, ahi: number, blo: number, bhi: number): Match {
    const { a, b, b2j } = this;
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map<number, number>();

    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map<number, number>();
      const indices = b2j.get(a[i]);
      if (indices) {
        for (const j of indices) {
          if (j < blo) continue;
          if (j >= bhi) break;
          const k = (j2len.get(j - 1) ?? 0) + 1;
          newj2len.set(j, k);
          if (k > bestsize) {
            besti = i - k + 1;
            bestj = j - k + 1;
            bestsize = k;
          }
        }
      }
      j2len = newj2len;
    }

    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
      besti -= 1;
      bestj -= 1;
      bestsize += 1;
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) {
      bestsize += 1;
    }

    return { a: besti, b: bestj, size: bestsize };
  }

  private getMatchingBlocks(): Match[] {
    if (this.matchingBlocks) return this.matchingBlocks;
    const la = this.a.length;
    const lb = this.b.length;
    const queue: [number, number, number, number][] = [[0, la, 0, lb]];
    const matchingBlocks: Match[] = [];
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop()!;
      const match = this.findLongestMatch(alo, ahi, blo, bhi);
      if (match.size) {
        matchingBlocks.push(match);
        if (alo < match.a && blo < match.b) queue.push([alo, match.a, blo, match.b]);
        if (match.a + match.size < ahi && match.b + match.size < bhi) {
          queue.push([match.a + match.size, ahi, match.b + match.size, bhi]);
        }
      }
    }
    matchingBlocks.sort((x, y) => x.a - y.a || x.b - y.b || x.size - y.size);

    const nonAdjacent: Match[] = [];
    let i1 = 0;
    let j1 = 0;
    let k1 = 0;
    for (const { a: i2, b: j2, size: k2 } of matchingBlocks) {
      if (i1 + k1 === i2 && j1 + k1 === j2) {
        k1 += k2;
      } else {
        if (k1) nonAdjacent.push({ a: i1, b: j1, size: k1 });
        i1 = i2;
        j1 = j2;
        k1 = k2;
      }
    }
    if (k1) nonAdjacent.push({ a: i1, b: j1, size: k1 });
    nonAdjacent.push({ a: la, b: lb, size: 0 });

    this.matchingBlocks = nonAdjacent;
    return nonAdjacent;
  }

  ratio(): number {
    const matches = this.getMatchingBlocks().reduce((sum, m) => sum + m.size, 0);
    return calculateRatio(matches, this.a.length + this.b.length);
  }
}

/** `difflib.SequenceMatcher(None, left, right).ratio()` */
export function sequenceMatcherRatio(left: string, right: string): number {
  return new SequenceMatcher(left, right).ratio();
}
