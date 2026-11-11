/**
 * The step-by-step guide: a screen says what there is to learn on it, as steps that point at something on screen
 * («toque aquí»), and the guide shows the ones a person has not seen yet, the first time they come. «Guía» shows them
 * all again. The team got lost in the app the first days of Nehemiah (November 2026): one translator pressed
 * «Terminé» thinking it saved, and handed in one verse of three.
 *
 * A guide is made of parts: what the step of the process is for (from its package, in any tool), what the screen
 * itself has to show, and the step that points at «Guía». Each step is remembered on its own, by `seenKey`: the
 * editor's steps are seen once, and opening it for another step (TPS after TPL) shows only what that step is for.
 *
 * A screen where work is done (a point of tuning, a verse to align) is not told all at once and then left to the
 * person: its guide is a walk (`flow`) that goes with them through the first piece of work. Each step shows one
 * thing and waits: «Mire» until «Entendido», «Toque» until what is lit is touched, «Haga» until the work it asks is
 * done (9 November: «te va guiando mientras tú vas haciendo»).
 */

/**
 * `look`: something to read; it goes on with its own button. `tap`: what is lit is touched, for real. `do`: some work
 * of several touches (marking words); the guide steps aside, small, until it is done.
 */
export type GuideKind = "look" | "tap" | "do";

export type GuideStep = {
  /** Unique within a guide. */
  id: string;
  /** What marks it seen, across screens and visits. The steps of one walk share theirs. */
  seenKey: string;
  /** The `data-guide` of what it points at. Without it, the step is said in the middle of the screen. */
  target?: string;
  title?: string;
  text: string;
  /** A second, smaller line: what else can be done («Si no está, toque…»). */
  sub?: string;
  /** The words of its button, for a `look` step («Ya la leí»). */
  ok?: string;
  kind?: GuideKind;
  /**
   * A step of a walk: said in its order, when its turn comes, whatever is on screen when the guide starts. It waits
   * for what it points at to appear (the next stage of the point), and is never left out for not being there yet.
   */
  flow?: boolean;
  /** The screen says it is done (what it asks was done, or the work is past it): the guide goes on. */
  done?: boolean;
  /** Done once one of these has happened while the guide is on (`did`): what the screen moves away from at once. */
  until?: string[];
  /** Said only once one of these has happened («¡Guardado!» after an answer). */
  after?: string[];
  /** What is not shown while it is said: the pieces of the screen whose turn has not come (`data-guide` names). */
  hide?: string[];
  /** Something to do from the step itself (install the app, turn the notices on). */
  action?: { label: string; run: () => unknown };
  /** False when the step does not apply now (the app is already installed). */
  when?: boolean;
  /** Seen in the shape the app had before (the card «En esta tarea» and its «Entendido»). */
  seenBefore?: boolean;
  /**
   * On what a step of the process is for: the person chose «Empezar sin guía» when the task was opened. The screen's
   * own steps do not start by themselves; «Guía» still shows them.
   */
  quiet?: boolean;
  /**
   * Said only when asked for («Muéstreme cómo», «Guía»), never by itself. The tuning team feared touching anything
   * that came uninvited (11 November): each stage of a point says first what it is for, and offers its walk.
   */
  manual?: boolean;
};

/** The guide on screen: the steps it is going through (as they read now) and the one in hand. */
export type GuideRun = { steps: GuideStep[]; index: number; flow: boolean };

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
 * A step whose target is missing (no task today) is not shown and stays unseen, so it comes when there is one. The
 * steps of a walk are all taken: whether each applies, and where it points, is seen when its turn comes.
 */
export function stepsToShow(steps: GuideStep[], seen: ReadonlySet<string>, options: { present: (target: string) => boolean; replay?: boolean }): GuideStep[] {
  const applicable = steps.filter((step) => step.flow || (step.when !== false && !step.after && (!step.target || options.present(step.target))));
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
  /**
   * The guide going on: the steps it took when it started (by id, read as the screen says them now), how far it is
   * (no step before `at` is said again), what has happened since (`did`), and what was said.
   */
  let going: { ids: string[]; keys: Map<string, string>; at: number; events: Set<string>; said: Set<string> } | null = null;
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
  const applies = (step: GuideStep, events: ReadonlySet<string>) => step.when !== false && (!step.after || step.after.some((event) => events.has(event)));
  const isDone = (step: GuideStep, events: ReadonlySet<string>) => step.done === true || Boolean(step.until?.some((event) => events.has(event)));

  /** Done, or skipped (`all`): what was said counts as seen; skipped, the whole of it. */
  const close = (all: boolean) => {
    if (!going) return;
    const seen = deps.load();
    for (const key of all ? going.keys.values() : going.said) seen.add(key);
    deps.save(seen);
    going = null;
    current = null;
  };

  /**
   * The step in hand: the first from where the guide is that applies and is not done. A step behind it is not said
   * again, though the next point of the work starts over: the guide goes with the first one only.
   */
  const settle = () => {
    if (!going) {
      current = null;
      return;
    }
    const byId = new Map(steps().map((step) => [step.id, step]));
    let found = -1;
    for (let at = going.at; at < going.ids.length; at += 1) {
      const step = byId.get(going.ids[at]!);
      // A step on its own (not of a walk) whose target has gone by its turn is left for when it is there again.
      const gone = Boolean(step && !step.flow && step.target && !deps.present(step.target));
      if (step && !gone && applies(step, going.events) && !isDone(step, going.events)) {
        found = at;
        break;
      }
    }
    if (found < 0) return close(false);
    going.at = found;
    const step = byId.get(going.ids[found]!)!;
    going.said.add(step.seenKey);
    const shown = going.ids.map((id) => byId.get(id)).filter((one): one is GuideStep => Boolean(one && applies(one, going!.events)));
    current = { steps: shown, index: shown.indexOf(step), flow: shown.some((one) => one.flow) };
  };

  const start = (shown: GuideStep[]): boolean => {
    if (!shown.length) return false;
    going = { ids: shown.map((step) => step.id), keys: new Map(shown.map((step) => [step.id, step.seenKey])), at: 0, events: new Set(), said: new Set() };
    ran = true;
    settle();
    emit();
    return Boolean(current);
  };

  return {
    /** A screen says what its guide has (null when it goes away). `ready`: false while what it points at is loading. */
    setPart(part: GuidePart, given: GuideStep[] | null, isReady = true) {
      const next = new Map(parts);
      if (given) next.set(part, { steps: given, ready: isReady });
      else next.delete(part);
      parts = next;
      // The screen it was about went away: the guide closes, and what was not finished shows next time.
      if (going && part !== "end" && !given) {
        going = null;
        current = null;
      } else settle();
      emit();
    },
    hasGuide: () => steps().length > 0,
    /** Starts by itself when there is something not seen yet (or a «Ver la guía» waiting for this screen). */
    autoStart(): boolean {
      if (going || !ready()) return false;
      const all = steps();
      if (!all.length) return false;
      if (pendingReplay) {
        pendingReplay = false;
        return start(stepsToShow(all, new Set(), { present: deps.present, replay: true }));
      }
      const quiet = parts.get("purpose")?.steps.some((step) => step.quiet);
      const own = (quiet ? ORDER.filter((part) => part !== "screen").flatMap((part) => parts.get(part)?.steps ?? []) : all).filter((step) => !step.manual);
      // A screen whose own steps all wait to be asked for does not start with only the step about «Guía».
      const endOnly = new Set((parts.get("end")?.steps ?? []).map((step) => step.id));
      if (!quiet && own.every((step) => endOnly.has(step.id))) return false;
      return start(stepsToShow(own, deps.load(), { present: deps.present }));
    },
    /**
     * «Guía»: every step again. `only` limits it to some parts: «Muéstreme cómo» in the window of a stage of tuning
     * shows that stage's walk, and not the step about «Guía» after it each time.
     */
    replay(only?: GuidePart[]): void {
      pendingReplay = false;
      going = null;
      const all = steps();
      const chosen = only ? ORDER.filter((part) => only.includes(part)).flatMap((part) => parts.get(part)?.steps ?? []) : all;
      start(stepsToShow(chosen, new Set(), { present: deps.present, replay: true }));
    },
    /** «Ver la guía» from the menu, on its way to the screen that has one. */
    replaySoon(): void {
      pendingReplay = true;
      emit();
    },
    /** «Entendido»: on to the next step. */
    next(): void {
      if (!going || !current) return;
      going.at += 1;
      settle();
      emit();
    },
    /** Something the person did on the screen («answered»): a step waiting for it is done. */
    did(event: string): void {
      if (!going) return;
      going.events.add(event);
      settle();
      emit();
    },
    skip(): void {
      close(true);
      emit();
    },
    run: (): GuideRun | null => current,
    ranThisVisit: () => ran,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
