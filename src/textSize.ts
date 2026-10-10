import { useSyncExternalStore } from "react";
import { asTextSize, TEXT_SCALE, type TextSize } from "./domain/textSize";

const KEY = "taller:text-size";
const listeners = new Set<() => void>();

function read(): TextSize {
  try {
    return asTextSize(window.localStorage.getItem(KEY));
  } catch {
    // A private window keeps nothing: the tools are drawn as they come.
    return "normal";
  }
}

let current: TextSize = typeof window === "undefined" ? "normal" : read();

/** Says the size on the page, where the styles read it. The size the tools come with leaves the page as it was. */
export function applyTextSize(): void {
  const root = document.documentElement;
  if (current === "normal") {
    root.removeAttribute("data-text");
    root.style.removeProperty("--ts");
  } else {
    root.setAttribute("data-text", current);
    root.style.setProperty("--ts", String(TEXT_SCALE[current]));
  }
}

export function setTextSize(size: TextSize): void {
  current = size;
  try {
    window.localStorage.setItem(KEY, size);
  } catch {
    /* it holds for this visit */
  }
  applyTextSize();
  for (const listener of listeners) listener();
}

export function useTextSize(): TextSize {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
