import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { holdAt, placesOf, reveal, revealWhole, slideFrom } from "./pieceMotion";

export type PieceCount = { done: number; total: number; firstPending: number; count: number };
export type ActivePiece = { id: string; index: number };

/** Put the caret where writing goes on: at the end of what a box holds, or in its empty first line. */
function caretInto(box: HTMLElement): void {
  let target: Node = box;
  while (target.lastChild instanceof HTMLElement && target.lastChild.tagName !== "BR" && target.lastChild.contentEditable !== "false") target = target.lastChild;
  const range = document.createRange();
  range.selectNodeContents(target);
  // An empty piece holds only the line a browser writes on: the caret goes before it, not after.
  range.collapse(!(target.textContent ?? "").trim());
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/**
 * The pieces of a long text shown one open at a time, across the several texts a screen may hold (the title of an
 * article, the line under it, its body): which piece is open, how to open another without losing one's place, and
 * which comes next. Shared by the screen where an article is translated and the one where it is reviewed.
 *
 * `domId` gives the prefix a text's pieces carry in the page: a piece is `${domId(id)}-row-${index}`, and the box it
 * is written in, where it has one, `${domId(id)}-${index}`.
 */
export function usePieces(domId: (id: string) => string) {
  const [active, setActive] = useState<ActivePiece | null>(null);
  const [counts, setCounts] = useState<Record<string, PieceCount>>({});
  /** The part of the screen that scrolls. */
  const pane = useRef<HTMLDivElement | null>(null);
  const idOf = useRef(domId);
  idOf.current = domId;
  /** A piece was opened for whoever came in, and is still to be brought onto the screen. */
  const toShow = useRef(false);

  /** A text says how many pieces it has, how many are translated and the first that is not. */
  const report = useCallback(
    (id: string, done: number, total: number, firstPending: number, count: number) =>
      setCounts((prev) => {
        const was = prev[id];
        return was && was.done === done && was.total === total && was.firstPending === firstPending && was.count === count ? prev : { ...prev, [id]: { done, total, firstPending, count } };
      }),
    [],
  );

  const reset = useCallback(() => {
    setActive(null);
    setCounts({});
  }, []);

  /**
   * Open a piece nobody touched (where whoever comes in starts from) and bring it onto the screen: it may be far
   * down a long article. It is not focused: on a phone that would raise the keyboard over a text nobody has looked
   * at yet.
   */
  const show = useCallback((id: string, index: number) => {
    toShow.current = true;
    setActive({ id, index });
  }, []);

  useLayoutEffect(() => {
    if (!toShow.current || !active) return;
    toShow.current = false;
    const row = document.getElementById(`${idOf.current(active.id)}-row-${active.index}`);
    if (row && pane.current) revealWhole(pane.current, row);
  }, [active]);

  /** A piece was touched: it opens, the one that was open closes, and where it is written in, the box is ready. */
  function open(id: string, index: number, element: HTMLElement) {
    const scroller = pane.current;
    const top = element.getBoundingClientRect().top;
    const before = scroller ? placesOf(scroller) : null;
    flushSync(() => setActive({ id, index }));
    const row = document.getElementById(`${domId(id)}-row-${index}`);
    const box = document.getElementById(`${domId(id)}-${index}`);
    // The piece that closed gave back its room: the one touched stays where the finger is.
    if (row && scroller) holdAt(scroller, row, top);
    if (box) {
      box.focus({ preventScroll: true });
      caretInto(box);
      if (scroller) {
        reveal(scroller, box);
        // On a phone the keyboard comes up after this: once it has, the box is brought over it.
        const viewport = window.visualViewport;
        const again = () => document.activeElement === box && reveal(scroller, box);
        viewport?.addEventListener("resize", again, { once: true });
        window.setTimeout(() => viewport?.removeEventListener("resize", again), 1500);
      }
    } else if (row && scroller) revealWhole(scroller, row);
    // What could not be kept still (at the top of the text there is nowhere to scroll to) slides instead of jumping.
    if (scroller && before) slideFrom(scroller, before, row);
  }

  /** The piece after one, in its own text or in the next of `order` (the texts as they follow one another on the screen). */
  function after(order: string[], id: string, index: number): ActivePiece | null {
    if (index + 1 < (counts[id]?.count ?? 0)) return { id, index: index + 1 };
    const next = order.slice(order.indexOf(id) + 1).find((other) => (counts[other]?.count ?? 0) > 0);
    return next ? { id: next, index: 0 } : null;
  }

  function next(order: string[], id: string, index: number) {
    const to = after(order, id, index);
    const element = to ? document.getElementById(`${domId(to.id)}-row-${to.index}`) : null;
    if (to && element) open(to.id, to.index, element);
  }

  /**
   * The piece in hand is done and none comes after it: it closes. The box lets go of the cursor, so on a phone the
   * keyboard goes down and what had given way to it comes back: the bar where the work is saved and handed in.
   * Without this the last piece was a dead end: nothing on the screen said what came next.
   */
  function close() {
    if (!active) return;
    const scroller = pane.current;
    const rowId = `${domId(active.id)}-row-${active.index}`;
    const top = document.getElementById(rowId)?.getBoundingClientRect().top;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    flushSync(() => setActive(null));
    const row = document.getElementById(rowId);
    // The box gave back its room: what was just written stays where the eyes are.
    if (row && scroller && top !== undefined) holdAt(scroller, row, top);
  }

  return { active, setActive, counts, pane, report, reset, open, show, after, next, close };
}
