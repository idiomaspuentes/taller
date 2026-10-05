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
  /**
   * When a finger came down, while it is still on the screen. Pressing a button takes the focus out of the field,
   * and bringing the bars back then would move the button from under the finger before it lifts: the press would
   * land on something else, or on nothing. A press that never ends (its end was lost) stops counting.
   */
  let pressedAt = 0;
  const pressing = () => pressedAt > 0 && performance.now() - pressedAt < 3000;
  document.addEventListener("pointerdown", () => (pressedAt = performance.now()), true);
  for (const lifted of ["pointerup", "pointercancel"]) document.addEventListener(lifted, () => (pressedAt = 0), true);

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

  const leave = () => {
    // Going from one field to the next is not leaving: wait to see where the focus lands.
    window.clearTimeout(leaving);
    leaving = window.setTimeout(() => {
      // Nothing moves while a press is on its way: looked at again once it has landed.
      if (pressing()) return leave();
      const active = document.activeElement;
      if (!(active instanceof Element) || !active.closest(FIELD)) delete root.dataset.typing;
    }, 150);
  };
  document.addEventListener("focusout", leave);

  // Where the browser does not shrink the page for the keyboard (iOS), the styles are told how much it covers.
  const viewport = window.visualViewport;
  if (viewport) {
    const tell = () => root.style.setProperty("--keyboard", `${Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))}px`);
    viewport.addEventListener("resize", tell);
    viewport.addEventListener("scroll", tell);
    tell();
  }
}
