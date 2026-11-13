import { useEffect, useRef, useSyncExternalStore } from "react";
import { createGuide, guideKey, readSeen, writeSeen, type GuidePart, type GuideRun, type GuideStep } from "./domain/guide";

/**
 * The one guide of the app (see `domain/guide.ts`): the screen on view gives it its steps, `GuideOverlay` shows them,
 * and «Guía» repeats them. What a person has seen is kept for whoever is signed in.
 */
let seenKey = "";

/** The element a step points at: the first one on screen with that `data-guide` (the phone and the desk each have theirs). */
export function guideTarget(name: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-guide="${CSS.escape(name)}"]`));
  return (
    all.find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }) ?? null
  );
}

export const guide = createGuide({
  load: () => (seenKey ? readSeen(seenKey) : new Set()),
  save: (seen) => {
    if (seenKey) writeSeen(seenKey, seen);
  },
  present: (target) => Boolean(guideTarget(target)),
});

/** Something the person did that a step of the guide may be waiting for («answered»). Nothing when no guide is on. */
export function guideDid(event: string): void {
  guide.did(event);
}

/** Whether whoever is signed in has seen this (a step, a walk, the window «De qué trata esta tarea»). */
export function guideSeen(key: string): boolean {
  return Boolean(seenKey) && readSeen(seenKey).has(key);
}

/** Marks these as seen for whoever is signed in. */
export function markGuideSeen(keys: string[]): void {
  if (!seenKey) return;
  const seen = readSeen(seenKey);
  for (const key of keys) seen.add(key);
  writeSeen(seenKey, seen);
}

/**
 * What «Guía» opens on the screen in view, when the screen has its own way in: the tuning tools open the window of
 * the step in hand, which offers its walk («Muéstreme cómo»). Without one, «Guía» shows the whole guide again.
 */
let opener: (() => void) | null = null;

export function useGuideOpener(open: (() => void) | null): void {
  useEffect(() => {
    opener = open;
    return () => {
      if (opener === open) opener = null;
    };
  });
}

/** «Guía» touched. */
export function openGuide(): void {
  if (opener) opener();
  else guide.replay();
}

/** The keys a step of a task is remembered by: its window, what it is for, and «Empezar sin guía». */
export const taskGuideKeys = (taskId: string, stepId: string) => ({
  intro: `intro:${taskId}:${stepId}`,
  purpose: `purpose:${taskId}:${stepId}`,
  quiet: `noguide:${taskId}:${stepId}`,
});

/** Whoever is signed in: what they have seen is theirs. */
export function setGuidePerson(session: { host: string; username: string } | null): void {
  seenKey = session ? guideKey(session.host, session.username) : "";
}

const subscribe = (listener: () => void) => guide.subscribe(listener);

export function useGuideRun(): GuideRun | null {
  return useSyncExternalStore(subscribe, guide.run, () => null);
}

/** Whether the screen on view has a guide: «Guía» shows only where there is one. */
export function useHasGuide(): boolean {
  return useSyncExternalStore(subscribe, guide.hasGuide, () => false);
}

/**
 * A screen's part of the guide, while it is on view. `ready` is false while what it points at is still loading. The
 * steps are compared by what they say, so a screen may build them on every render.
 */
export function useGuidePart(part: GuidePart, steps: GuideStep[] | null, ready = true, watch = ""): void {
  const latest = useRef(steps);
  latest.current = steps;
  const signature = steps
    ? JSON.stringify([
        ready,
        watch,
        steps.map((step) => [step.id, step.seenKey, step.target, step.title, step.text, step.sub, step.ok, step.kind, step.flow, step.done, step.until, step.after, step.hide, step.when, step.seenBefore, step.quiet, step.manual, step.action?.label]),
      ])
    : "";
  useEffect(() => {
    if (!latest.current) {
      guide.setPart(part, null);
      return;
    }
    // An action runs what the screen has now, not what it had when the step was given.
    guide.setPart(
      part,
      latest.current.map((step) =>
        step.action ? { ...step, action: { label: step.action.label, run: () => latest.current?.find((row) => row.id === step.id)?.action?.run() } } : step,
      ),
      ready,
    );
  }, [part, signature]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => guide.setPart(part, null), [part]);
}

/**
 * What the step of the process a tool was opened for is for, as the first step of its guide (it was the card «En
 * esta tarea» with «Entendido»). Seen once per step: `key` names it. Whoever pressed «Entendido» on that card
 * (`legacyKey`) has seen it.
 */
export function useGuidePurpose(key: string | null, purpose: string | undefined, title: string, legacyKey?: string): void {
  let before = false;
  if (legacyKey) {
    try {
      before = localStorage.getItem(legacyKey) === "1";
    } catch {
      before = false;
    }
  }
  // «Empezar sin guía» in the window that opened the task: the screen's walk waits for «Guía».
  const quiet = Boolean(key) && guideSeen(`noguide:${key}`);
  useGuidePart("purpose", key && purpose ? [{ id: "purpose", seenKey: `purpose:${key}`, title, text: purpose, ...(before ? { seenBefore: true } : {}), ...(quiet ? { quiet } : {}) }] : null);
}

/**
 * A screen's own steps, rendered where the screen is: a part of the guide that comes and goes with it. `watch` says
 * what the screen shows now («a draft to read»): when it changes, the guide looks again for steps not seen, since
 * what they point at may have just appeared.
 */
export function GuideScreen({ steps, ready = true, watch = "" }: { steps: GuideStep[]; ready?: boolean; watch?: string }) {
  useGuidePart("screen", steps, ready, watch);
  return null;
}

/** The same, for a tool that knows what its step is for only once it has read its work: rendered when it has. */
export function GuidePurpose({ id, purpose, title, legacyKey }: { id: string; purpose: string | undefined; title: string; legacyKey?: string }) {
  useGuidePurpose(id, purpose, title, legacyKey);
  return null;
}
