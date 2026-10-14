import { useSyncExternalStore } from "react";

/**
 * Where a tool's header and the notes of the passage meet. The notes are mounted once, beside every tool, and the
 * header belongs to the tool: the header says it is there, and the notes give it a row for its «Más» menu, with
 * how many there are. With no header on screen the notes keep their button in a corner.
 */
export type NotesEntry = { count: number; open: boolean; toggle: () => void };

let slot: HTMLElement | null = null;
let entry: NotesEntry | null = null;
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function setNotesSlot(element: HTMLElement | null): void {
  if (slot === element) return;
  slot = element;
  changed();
}

export function useNotesSlot(): HTMLElement | null {
  return useSyncExternalStore(subscribe, () => slot, () => null);
}

export function setNotesEntry(next: NotesEntry | null): void {
  if (entry === next) return;
  entry = next;
  changed();
}

export function useNotesEntry(): NotesEntry | null {
  return useSyncExternalStore(subscribe, () => entry, () => null);
}
