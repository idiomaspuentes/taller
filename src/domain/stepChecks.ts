import type { StepCheck } from "./types";

/**
 * Which checks of a step are of the item in hand. A check may say when it applies (`when`): words to look for in the
 * source of the item. «"You": ¿una persona o varias?» is noise on a verse where nobody says «you»: it is said at
 * the verse that says it (`itemChecks`). A check without `when` is of the whole step, and is said once for it
 * (`stepWideChecks`).
 */

/** A digit anywhere in the source: `#`. A proper name (a capitalised word that does not start a sentence): `Aa`. */
const DIGIT = "#";
const NAME = "aa";

function wordPattern(word: string): RegExp | null {
  const clean = word.trim().toLowerCase();
  if (!clean) return null;
  if (clean === DIGIT) return /\d/;
  // In the middle of a sentence, or opening it before a comma («Jude, a servant…»).
  if (clean === NAME) return /[a-zà-ÿ,;:]\s+[A-Z][a-zà-ÿ]{2,}|(?:^|[.!?]\s+)[A-Z][a-zà-ÿ]{2,},/;
  const starts = clean.startsWith("*");
  const ends = clean.endsWith("*");
  const core = clean.replace(/^\*|\*$/g, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!core) return null;
  // Whole words, unless a `*` says the word may go on before or after: `*ed` is «walked», `walk*` is «walking».
  // An ending needs a word of some length before it: «bed» and «red» are not verbs in the past.
  const letter = "[A-Za-zÀ-ÿ]";
  return new RegExp(`${starts ? `(?<!${letter})${letter}{2,}` : `(?<!${letter})`}${core}${ends ? `${letter}+` : `(?!${letter})`}`, "i");
}

/** The words of a source that are read: the links of a note or an article (their addresses, their numbers) are not. */
export function readable(source: string): string {
  return source
    .replace(/\[\[[^\]]*\]\]/g, " ")
    .replace(/\]\([^)]*\)/g, "] ")
    .replace(/(?:rc|https?):\/\/\S+/g, " ");
}

/**
 * The words of a source that a rule may be said to be about, as the source writes them, each once and in its order:
 * offered to touch to whoever turns a comment into a rule, so that nobody types a word of another language. The
 * shortest are left out («a», «of», «the»): a rule about one of them would come up at every verse. A name of three
 * letters stays («God», «Lot»).
 */
export function sourceWords(source: string, limit = 40): string[] {
  const text = readable(source).replace(/\*\*|__|[{}]/g, "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const found of text.matchAll(/\p{L}[\p{L}'’-]*\p{L}/gu)) {
    const word = found[0];
    const before = text.slice(0, found.index).trimEnd();
    // Capitalised in the middle of a sentence: a name, however short.
    const name = /^\p{Lu}/u.test(word) && Boolean(before) && !/[.!?:“"(]$/.test(before);
    const key = word.toLowerCase();
    if ((word.length < 4 && !(name && word.length === 3)) || seen.has(key)) continue;
    seen.add(key);
    out.push(word);
    if (out.length >= limit) break;
  }
  return out;
}

export function checkApplies(check: Pick<StepCheck, "when">, source: string | null | undefined): boolean {
  const words = check.when ?? [];
  if (!words.length || source === null || source === undefined) return true;
  const text = readable(source);
  return words.some((word) => wordPattern(word)?.test(text));
}

/**
 * The checks one item calls for (a verse, a note, a question, an article), for a list shown beside each item. Only
 * checks that say when they apply are of an item: those that always apply are asked once for the whole step, not
 * once per verse. `source` undefined (the source of that item could not be read): all of them, to be safe.
 */
export function itemChecks<T extends Pick<StepCheck, "when">>(checks: T[], source: string | null | undefined): T[] {
  return checks.filter((check) => check.when?.length && checkApplies(check, source));
}

/** The checks asked once for the whole step, when each item shows its own. */
export function stepWideChecks<T extends Pick<StepCheck, "when">>(checks: T[]): T[] {
  return checks.filter((check) => !check.when?.length);
}

/** In a long text (an article), the paragraphs that call for a check, counted from 1. */
export function paragraphsFor(check: Pick<StepCheck, "when">, source: string): number[] {
  if (!check.when?.length) return [];
  return source
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap((paragraph, index) => (checkApplies(check, paragraph) ? [index + 1] : []));
}

/** «you, your, yours» as a person types it, to the list a check keeps (and back). */
export function parseWhen(text: string): string[] | undefined {
  const words = [...new Set(text.split(/[,;\n]/).map((word) => word.trim().toLowerCase()).filter(Boolean))];
  return words.length ? words : undefined;
}

export function formatWhen(when: string[] | undefined): string {
  return (when ?? []).join(", ");
}
