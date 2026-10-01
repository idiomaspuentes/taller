/**
 * Names of the translation-note categories and of the kinds of key terms, built in Spanish by
 * `afinacionNotes.ts` / `afinacionWords.ts`. Translated when shown; anything not listed (a category the table does
 * not know yields a capitalized form of its code) is returned as it is.
 */
import type { UiLanguage } from "../config";
import glossary from "../i18n/locales/glossary.pt.json";

const PT: [string, string][] = Object.entries(glossary.afinacion);

const MAP = new Map(PT);

export function localizeAfinacion(text: string, language: UiLanguage): string {
  return language === "pt" ? (MAP.get(text) ?? text) : text;
}
