/**
 * Moving between the pieces of a long text without losing one's place. When a piece opens and another closes, what
 * is on the screen changes height: the piece that was touched is kept where it is by scrolling, and whatever still
 * has to move slides there instead of jumping. Nothing here knows what a piece is: only that it has an id and is
 * marked `data-slide`.
 */

/** Where each piece is on the screen, by its id: read before a change, to slide each one from there afterwards. */
export function placesOf(pane: HTMLElement): Map<string, number> {
  const places = new Map<string, number>();
  pane.querySelectorAll<HTMLElement>("[data-slide]").forEach((el) => {
    if (el.id) places.set(el.id, el.getBoundingClientRect().top);
  });
  return places;
}

/** Scroll so that `el` is at `top` again. Returns how far it still is from there: the page may have no more room to scroll. */
export function holdAt(pane: HTMLElement, el: HTMLElement, top: number): number {
  const off = el.getBoundingClientRect().top - top;
  if (!off) return 0;
  const before = pane.scrollTop;
  pane.scrollTop = before + off;
  return off - (pane.scrollTop - before);
}

/**
 * Keep the box being written in on the screen. A phone's keyboard covers the bottom of the page without making the
 * page shorter, so what counts as the bottom is the bottom of what can be seen. `under`: room kept below the box for
 * the line of buttons that goes with it.
 */
export function reveal(pane: HTMLElement, box: HTMLElement, under = 56): void {
  const view = pane.getBoundingClientRect();
  const viewport = window.visualViewport;
  const bottom = Math.min(view.bottom, viewport ? viewport.offsetTop + viewport.height : window.innerHeight);
  const rect = box.getBoundingClientRect();
  if (rect.bottom + under > bottom) pane.scrollTop += rect.bottom + under - bottom;
  else if (rect.top < view.top) pane.scrollTop += rect.top - view.top - 8;
}

/**
 * Bring a piece that is only read onto the screen: all of it when it fits, and its top when it does not (what is
 * read starts there).
 */
export function revealWhole(pane: HTMLElement, el: HTMLElement): void {
  const view = pane.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  if (rect.top < view.top || rect.height > view.height - 16) pane.scrollTop += rect.top - view.top - 8;
  else if (rect.bottom > view.bottom) pane.scrollTop += rect.bottom - view.bottom + 8;
}

const SLIDE_MS = 180;

/**
 * Slide every piece from where it was (`before`) to where it is now. Whoever asked for less motion gets none.
 * `opened` is the piece that has just opened: what comes after it moves with it, as one block. Sliding each of those
 * from its own old place would draw them over the piece that grew to push them down.
 */
export function slideFrom(pane: HTMLElement, before: Map<string, number>, opened?: HTMLElement | null): void {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const view = pane.getBoundingClientRect();
  const openedWas = opened ? before.get(opened.id) : undefined;
  const withOpened = opened && openedWas !== undefined ? openedWas - opened.getBoundingClientRect().top : null;
  const moved: [HTMLElement, number][] = [];
  pane.querySelectorAll<HTMLElement>("[data-slide]").forEach((el) => {
    const was = before.get(el.id);
    if (was === undefined) return;
    const now = el.getBoundingClientRect();
    const follows = opened && withOpened !== null && (el === opened || Boolean(opened.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
    const delta = follows ? withOpened! : was - now.top;
    if (Math.abs(delta) < 1) return;
    // Only what is on the screen, or was, has to be seen moving.
    const seenNow = now.bottom > view.top && now.top < view.bottom;
    const seenBefore = now.top + delta + now.height > view.top && now.top + delta < view.bottom;
    if (seenNow || seenBefore) moved.push([el, delta]);
  });
  if (!moved.length) return;
  for (const [el, delta] of moved) {
    el.style.transition = "none";
    el.style.transform = `translateY(${delta}px)`;
  }
  // The starting places have to be laid out before the slide begins, or there is nothing to slide from.
  void pane.offsetHeight;
  for (const [el] of moved) {
    el.style.transition = `transform ${SLIDE_MS}ms ease-out`;
    el.style.transform = "";
  }
  window.setTimeout(() => {
    for (const [el] of moved) el.style.transition = "";
  }, SLIDE_MS + 60);
}
