import { useSyncExternalStore } from "react";

/**
 * The place in a tool's header where the notes button goes. The notes are mounted once, beside every tool, and the
 * header belongs to the tool: the header says where its slot is, and the button is drawn inside it. That makes the
 * button part of the header (it scrolls away with it) instead of a shape pinned over the screen to look like one.
 * With no header on screen there is no slot, and the button keeps its corner.
 */
let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

export function setNotesSlot(element: HTMLElement | null): void {
  if (slot === element) return;
  slot = element;
  for (const listener of listeners) listener();
}

export function useNotesSlot(): HTMLElement | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => slot,
    () => null,
  );
}
