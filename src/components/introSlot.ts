import { useSyncExternalStore } from "react";

/**
 * Where a tool's «Más» and the introduction of its passage meet. A step's explanation (`StepAsk`) holds the
 * introduction of the book and the chapter; it was a fold over the work in every tool. It says it is there, and every
 * «Más» on screen gives it a row that opens it in a sheet, as the notes of the passage do (`notesSlot.ts`).
 */
export type IntroEntry = { open: () => void };

let entry: IntroEntry | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function setIntroEntry(next: IntroEntry | null): void {
  if (entry === next) return;
  entry = next;
  for (const listener of listeners) listener();
}

export function useIntroEntry(): IntroEntry | null {
  return useSyncExternalStore(subscribe, () => entry, () => null);
}

/**
 * Likewise, «Sobre esta tarea»: what the step is for, how it is done and the team's rules. A step that says what it
 * is for (`purpose`) offers it, and the tool's header shows an «ⓘ» for it (or «Más» a row, where there is no header).
 */
export type AboutEntry = { open: () => void };

let about: AboutEntry | null = null;

export function setAboutEntry(next: AboutEntry | null): void {
  if (about === next) return;
  about = next;
  for (const listener of listeners) listener();
}

export function useAboutEntry(): AboutEntry | null {
  return useSyncExternalStore(subscribe, () => about, () => null);
}
