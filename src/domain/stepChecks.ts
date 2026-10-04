import type { StepCheck } from "./types";

/**
 * Which checks of a step apply to the passage in hand. A check may say when it applies (`when`): words to look for
 * in the source of the passage. «"You": ¿una persona o varias?» is noise on a passage where nobody says «you»; a
 * list that only shows what the passage calls for gets read.
 *
 * A check without `when` always applies. When the source of the passage is not known (it could not be read, or the
 * list is shown away from the passage), every check applies: better one line too many than one missing.
 */

/** A digit anywhere in the source: `#`. */
const DIGIT = "#";

function wordPattern(word: string): RegExp | null {
  const clean = word.trim().toLowerCase();
  if (!clean) return null;
  if (clean === DIGIT) return /\d/;
  const starts = clean.startsWith("*");
  const ends = clean.endsWith("*");
  const core = clean.replace(/^\*|\*$/g, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!core) return null;
  // Whole words, unless a `*` says the word may go on before or after: `*ed` is «walked», `walk*` is «walking».
  // An ending needs a word of some length before it: «bed» and «red» are not verbs in the past.
  const letter = "[A-Za-zÀ-ÿ]";
  return new RegExp(`${starts ? `(?<!${letter})${letter}{2,}` : `(?<!${letter})`}${core}${ends ? `${letter}+` : `(?!${letter})`}`, "i");
}

export function checkApplies(check: Pick<StepCheck, "when">, source: string | null | undefined): boolean {
  const words = check.when ?? [];
  if (!words.length || source === null || source === undefined) return true;
  return words.some((word) => wordPattern(word)?.test(source));
}

export function applicableChecks<T extends Pick<StepCheck, "when">>(checks: T[], source: string | null | undefined): T[] {
  return checks.filter((check) => checkApplies(check, source));
}

/** «you, your, yours» as a person types it, to the list a check keeps (and back). */
export function parseWhen(text: string): string[] | undefined {
  const words = [...new Set(text.split(/[,;\n]/).map((word) => word.trim().toLowerCase()).filter(Boolean))];
  return words.length ? words : undefined;
}

export function formatWhen(when: string[] | undefined): string {
  return (when ?? []).join(", ");
}
