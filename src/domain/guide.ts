/**
 * The step-by-step guide: a screen says what there is to learn on it, as steps that point at something on screen
 * («toque aquí»), and the guide shows the ones a person has not seen yet, the first time they come. «Guía» shows them
 * all again. The team got lost in the app the first days of Nehemiah (November 2026): one translator pressed
 * «Terminé» thinking it saved, and handed in one verse of three.
 *
 * A guide is made of parts: what the step of the process is for (from its package, in any tool), what the screen
 * itself has to show, and the step that points at «Guía». Each step is remembered on its own, by `seenKey`: the
 * editor's steps are seen once, and opening it for another step (TPS after TPL) shows only what that step is for.
 */

export type GuideStep = {
  /** Unique within a guide. */
  id: string;
  /** What marks it seen, across screens and visits. */
  seenKey: string;
  /** The `data-guide` of what it points at. Without it, the step is said in the middle of the screen. */
  target?: string;
  title?: string;
  text: string;
  /** Something to do from the step itself (install the app, turn the notices on). */
  action?: { label: string; run: () => unknown };
  /** False when the step does not apply now (the app is already installed). */
  when?: boolean;
  /** Seen in the shape the app had before (the card «En esta tarea» and its «Entendido»). */
  seenBefore?: boolean;
};

export type GuideRun = { steps: GuideStep[]; index: number };

type Store = Pick<Storage, "getItem" | "setItem">;

/** Where what a person has seen is kept: per person and server on this device. */
export const guideKey = (host: string, username: string) => `taller-guide-seen:${host.replace(/\/$/, "")}:${username.toLowerCase()}`;

export function readSeen(key: string, store?: Store): Set<string> {
  try {
    const raw = (store ?? localStorage).getItem(key);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeSeen(key: string, seen: ReadonlySet<string>, store?: Store): void {
  try {
    (store ?? localStorage).setItem(key, JSON.stringify([...seen]));
  } catch {
    /* blocked storage: the guide shows again next time */
  }
}

/**
 * The steps to show now: those that apply and whose target is on screen; on its own, only the ones not seen yet.
 * A step whose target is missing (no task today) is not shown and stays unseen, so it comes when there is one.
 */
export function stepsToShow(steps: GuideStep[], seen: ReadonlySet<string>, options: { present: (target: string) => boolean; replay?: boolean }): GuideStep[] {
  const applicable = steps.filter((step) => step.when !== false && (!step.target || options.present(step.target)));
  if (options.replay) return applicable;
  return applicable.filter((step) => !step.seenBefore && !seen.has(step.seenKey));
}

/** The parts of a screen's guide, in the order they are said. `end` is the step that points at «Guía». */
export type GuidePart = "purpose" | "screen" | "end";
const ORDER: GuidePart[] = ["purpose", "screen", "end"];

export type Guide = ReturnType<typeof createGuide>;

/**
 * The guide of whatever is on screen. `present` says whether something to point at is there; `load` and `save` keep
 * what the person has seen.
 */
export function createGuide(deps: { load: () => Set<string>; save: (seen: Set<string>) => void; present: (target: string) => boolean }) {
  let parts = new Map<GuidePart, { steps: GuideStep[]; ready: boolean }>();
  let current: GuideRun | null = null;
  let pendingReplay = false;
  let ran = false;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };

  /** The guide of the screen: nothing when only the step about «Guía» is there. */
  const steps = (): GuideStep[] => {
    if (!parts.has("purpose") && !parts.has("screen")) return [];
    return ORDER.flatMap((part) => parts.get(part)?.steps ?? []);
  };
  const ready = () => [...parts.values()].every((part) => part.ready);

  const start = (shown: GuideStep[]): boolean => {
    if (!shown.length) return false;
    current = { steps: shown, index: 0 };
    ran = true;
    emit();
    return true;
  };

  /** Done or skipped: every step of the run counts as seen. */
  const close = () => {
    if (!current) return;
    const seen = deps.load();
    for (const step of current.steps) seen.add(step.seenKey);
    deps.save(seen);
    current = null;
    emit();
  };

  return {
    /** A screen says what its guide has (null when it goes away). `ready`: false while what it points at is loading. */
    setPart(part: GuidePart, given: GuideStep[] | null, isReady = true) {
      const next = new Map(parts);
      if (given) next.set(part, { steps: given, ready: isReady });
      else next.delete(part);
      parts = next;
      // The screen it was about went away: the guide closes, and what was not finished shows next time.
      if (current && part !== "end" && !given) current = null;
      emit();
    },
    hasGuide: () => steps().length > 0,
    /** Starts by itself when there is something not seen yet (or a «Ver la guía» waiting for this screen). */
    autoStart(): boolean {
      if (current || !ready()) return false;
      const all = steps();
      if (!all.length) return false;
      if (pendingReplay) {
        pendingReplay = false;
        return start(stepsToShow(all, new Set(), { present: deps.present, replay: true }));
      }
      return start(stepsToShow(all, deps.load(), { present: deps.present }));
    },
    /** «Guía»: every step again. */
    replay(): void {
      pendingReplay = false;
      start(stepsToShow(steps(), new Set(), { present: deps.present, replay: true }));
    },
    /** «Ver la guía» from the menu, on its way to the screen that has one. */
    replaySoon(): void {
      pendingReplay = true;
      emit();
    },
    next(): void {
      if (!current) return;
      if (current.index >= current.steps.length - 1) return close();
      current = { ...current, index: current.index + 1 };
      emit();
    },
    skip: close,
    run: (): GuideRun | null => current,
    ranThisVisit: () => ran,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
