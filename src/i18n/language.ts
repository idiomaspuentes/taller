import { useSyncExternalStore } from "react";
import { tallerConfig, type UiLanguage } from "../config";

const KEY = "taller-ui-language";

/** The interface language to start in: what was chosen before, else the browser's, else the default. */
export function detectUiLanguage(
  supported: readonly UiLanguage[],
  stored: string | null,
  browser: readonly string[],
  fallback: UiLanguage,
): UiLanguage {
  if (stored && (supported as readonly string[]).includes(stored)) return stored as UiLanguage;
  for (const tag of browser) {
    const base = tag.toLowerCase().split("-")[0] ?? "";
    if ((supported as readonly string[]).includes(base)) return base as UiLanguage;
  }
  return fallback;
}

function initial(): UiLanguage {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    /* blocked storage */
  }
  const browser = typeof navigator === "undefined" ? [] : [...(navigator.languages ?? []), navigator.language].filter(Boolean);
  return detectUiLanguage(tallerConfig.uiLanguages, stored, browser, tallerConfig.defaultUiLanguage);
}

let current: UiLanguage = initial();
if (typeof document !== "undefined") document.documentElement.lang = current;
const listeners = new Set<() => void>();

export function getUiLanguage(): UiLanguage {
  return current;
}

export function setUiLanguage(next: UiLanguage): void {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* blocked storage */
  }
  if (typeof document !== "undefined") document.documentElement.lang = next;
  listeners.forEach((fn) => fn());
}

export function useUiLanguage(): UiLanguage {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getUiLanguage,
    getUiLanguage,
  );
}
