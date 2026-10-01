import type { UiLanguage } from "../config";
import { getUiLanguage, useUiLanguage } from "./language";
import es from "./locales/es.json";
import pt from "./locales/pt.json";

/**
 * Texts of the app that are not specific to one organization (the organization's own words live in
 * taller.config.ts). They are data: one JSON file per language in `./locales/`, Spanish being the source.
 * To work on a translation use the review tool (`npm run translations:review`) rather than editing the JSON by hand;
 * `verify:config` checks that every key exists in every language and that the {placeholders} are kept.
 */
export type MessageKey = keyof typeof es;

const TABLE: Record<UiLanguage, Record<string, string>> = { es, pt };

export function translate(language: UiLanguage, key: MessageKey): string {
  return TABLE[language]?.[key] || es[key];
}

/** For code outside components. */
export const tNow = (key: MessageKey): string => translate(getUiLanguage(), key);

/** For components: re-renders when the interface language changes. */
export function useT(): (key: MessageKey) => string {
  const language = useUiLanguage();
  return (key) => translate(language, key);
}

export const MESSAGE_KEYS_ES = Object.keys(es) as MessageKey[];
