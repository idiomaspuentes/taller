/**
 * Writing on a phone: the keyboard takes about half the screen, so while a field is in use everything that is
 * pinned to the screen (bottom bars, floating buttons, panels that follow the scroll) gives way, and the field is
 * brought into what is left. The page says so with `data-typing` on its root; the styles do the rest.
 * Only on touch screens and narrow windows: with a real keyboard nothing is covered.
 */

const FIELD = "textarea, [contenteditable='true'], [contenteditable=''], input:not([type]), input[type='text'], input[type='search'], input[type='url'], input[type='number'], input[type='email']";

function onSmallTouchScreen(): boolean {
  return window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 640;
}

export function installTypingMode(): void {
  const root = document.documentElement;
  let leaving: number | undefined;

  document.addEventListener("focusin", (event) => {
    const field = event.target instanceof Element ? event.target.closest<HTMLElement>(FIELD) : null;
    if (!field || !onSmallTouchScreen()) return;
    window.clearTimeout(leaving);
    root.dataset.typing = "true";
    // Once the keyboard is up and the bars are out of the way, the field is brought into view.
    window.setTimeout(() => {
      if (document.activeElement === field || field.contains(document.activeElement)) field.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 350);
  });

  document.addEventListener("focusout", () => {
    // Going from one field to the next is not leaving: wait to see where the focus lands.
    window.clearTimeout(leaving);
    leaving = window.setTimeout(() => {
      const active = document.activeElement;
      if (!(active instanceof Element) || !active.closest(FIELD)) delete root.dataset.typing;
    }, 150);
  });

  // Where the browser does not shrink the page for the keyboard (iOS), the styles are told how much it covers.
  const viewport = window.visualViewport;
  if (viewport) {
    const tell = () => root.style.setProperty("--keyboard", `${Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))}px`);
    viewport.addEventListener("resize", tell);
    viewport.addEventListener("scroll", tell);
    tell();
  }
}
