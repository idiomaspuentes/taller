import type { AlignmentGroup, OriginalWord } from "@usfm-tools/types";
import { readable } from "./stepChecks";

/**
 * The glossary of translation decisions: one row per word of the original and sense, kept as TSV in a repository of
 * the language (`<lang>_tg`). It holds decisions only; how a word was translated before is worked out from the
 * aligned texts every time, so it never goes stale. See docs/GLOSARIO_DOOR43.md.
 */

export type GlossaryScope = "tpl" | "tps" | "helps" | "all";
export type GlossaryStatus = "proposed" | "agreed";

export type GlossaryEntry = {
  id: string;
  /** Word of the original (or of English, for an entry not tied to the original yet). Several, joined by ` + `, for an expression. */
  lemma: string;
  /** Strong number(s) of the base word(s), `;` between the words of an expression. Empty for an English-only entry. */
  strong: string;
  english: string[];
  sense: string;
  rendering: string;
  alternatives: string[];
  avoid: string[];
  scope: GlossaryScope;
  variants: string[];
  twLink: string;
  examples: string[];
  status: GlossaryStatus;
  note: string;
};

export const GLOSSARY_COLUMNS = ["ID", "Lemma", "Strong", "English", "Sense", "Rendering", "Alternatives", "Avoid", "Scope", "Variants", "TWLink", "Examples", "Status", "Note"] as const;

/** The three files of the resource, by the language the entry hangs from. */
export type GlossaryFile = "tg_grc.tsv" | "tg_hbo.tsv" | "tg_en.tsv";
export const GLOSSARY_FILES: GlossaryFile[] = ["tg_grc.tsv", "tg_hbo.tsv", "tg_en.tsv"];

/** `G30840` → Greek, `H1234` → Hebrew and Aramaic, nothing → English only. */
export function glossaryFileFor(strong: string): GlossaryFile {
  const first = baseStrong(strong.split(";")[0] ?? "");
  if (/^G/i.test(first)) return "tg_grc.tsv";
  if (/^H/i.test(first)) return "tg_hbo.tsv";
  return "tg_en.tsv";
}

/** The Strong number of the word itself: a Hebrew prefix (`b:H1234`, `c:d:H1234`) is left out. */
export function baseStrong(strong: string): string {
  return (strong.split(":").pop() ?? "").trim();
}

const list = (cell: string | undefined): string[] => (cell ?? "").split(";").map((part) => part.trim()).filter(Boolean);
const clean = (cell: string): string => cell.replace(/[\t\r\n]+/g, " ").trim();

export function parseGlossary(tsv: string): GlossaryEntry[] {
  const lines = tsv.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const header = lines[0]!.split("\t").map((cell) => cell.trim().toLowerCase());
  const at = (name: string) => header.indexOf(name.toLowerCase());
  const col = Object.fromEntries(GLOSSARY_COLUMNS.map((name) => [name, at(name)])) as Record<(typeof GLOSSARY_COLUMNS)[number], number>;
  const out: GlossaryEntry[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    const cell = (name: (typeof GLOSSARY_COLUMNS)[number]) => (col[name] >= 0 ? (cells[col[name]] ?? "").trim() : "");
    const id = cell("ID");
    if (!id || !cell("Lemma")) continue;
    const scope = cell("Scope").toLowerCase();
    out.push({
      id,
      lemma: cell("Lemma"),
      strong: cell("Strong"),
      english: list(cell("English")),
      sense: cell("Sense"),
      rendering: cell("Rendering"),
      alternatives: list(cell("Alternatives")),
      avoid: list(cell("Avoid")),
      scope: scope === "tpl" || scope === "tps" || scope === "helps" ? scope : "all",
      variants: list(cell("Variants")),
      twLink: cell("TWLink"),
      examples: list(cell("Examples")),
      status: cell("Status").toLowerCase() === "agreed" ? "agreed" : "proposed",
      note: cell("Note"),
    });
  }
  return out;
}

export function serializeGlossary(entries: GlossaryEntry[]): string {
  const row = (e: GlossaryEntry) =>
    [e.id, e.lemma, e.strong, e.english.join("; "), e.sense, e.rendering, e.alternatives.join("; "), e.avoid.join("; "), e.scope, e.variants.join("; "), e.twLink, e.examples.join("; "), e.status, e.note].map(clean).join("\t");
  return `${[GLOSSARY_COLUMNS.join("\t"), ...entries.map(row)].join("\n")}\n`;
}

/** A short id no other row has, like the ids of notes: a letter first, four characters. */
export function newGlossaryId(taken: Iterable<string>, random: () => number = Math.random): string {
  const used = new Set(taken);
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const all = `${letters}0123456789`;
  for (;;) {
    let id = letters[Math.floor(random() * letters.length)]!;
    for (let i = 0; i < 3; i++) id += all[Math.floor(random() * all.length)]!;
    if (!used.has(id)) return id;
  }
}

/** Put an entry into its file's rows: replaces the row with its id, or goes last. */
export function upsertGlossaryEntry(entries: GlossaryEntry[], entry: GlossaryEntry): GlossaryEntry[] {
  return entries.some((e) => e.id === entry.id) ? entries.map((e) => (e.id === entry.id ? entry : e)) : [...entries, entry];
}

/**
 * Creating an entry is free, and so is working on one that is still a proposal. Changing what a team agreed needs
 * that agreement again: it goes as a proposal for the team (a pull request), unless only examples were added.
 */
export function changeNeedsAgreement(before: GlossaryEntry | undefined, after: GlossaryEntry): boolean {
  if (!before || before.status !== "agreed") return false;
  const decision = (e: GlossaryEntry) => JSON.stringify([e.lemma, e.strong, e.sense, e.rendering, e.alternatives, e.avoid, e.scope, e.status, e.note]);
  return decision(before) !== decision(after);
}

// ---------------------------------------------------------------- finding entries

const fold = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** Every entry that mentions the query, in any language and whatever the accents. */
export function searchGlossary(entries: GlossaryEntry[], query: string): GlossaryEntry[] {
  const wanted = fold(query);
  if (!wanted) return entries;
  return entries.filter((e) => [e.lemma, e.strong, e.rendering, e.sense, ...e.english, ...e.alternatives, ...e.variants].some((text) => fold(text).includes(wanted)));
}

const strongsOf = (entry: GlossaryEntry): string[] => entry.strong.split(";").map((s) => baseStrong(s)).filter(Boolean);

/**
 * The entries that matter for a passage: those of the words of the original that are in it. An expression (several
 * words) counts when all its words are there. English-only entries count when the English text has that term.
 */
export function entriesForPassage(entries: GlossaryEntry[], words: Pick<OriginalWord, "strong" | "lemma">[], englishText = ""): GlossaryEntry[] {
  const strongs = new Set(words.map((w) => baseStrong(w.strong)).filter(Boolean));
  const lemmas = new Set(words.map((w) => fold(w.lemma)).filter(Boolean));
  const english = fold(englishText);
  return entries.filter((entry) => {
    const mine = strongsOf(entry);
    if (mine.length) return mine.every((s) => strongs.has(s));
    if (lemmas.has(fold(entry.lemma))) return true;
    return Boolean(english) && [entry.lemma, ...entry.english].some((term) => termIn(term, english));
  });
}

/** Is a term in a text as a word of its own (not inside another)? `text` already without accents and in lower case. */
function termIn(term: string, text: string): boolean {
  const wanted = fold(term);
  return Boolean(wanted) && new RegExp(`(^|[^\\p{L}])${wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "u").test(text);
}

// ---------------------------------------------------------------- beside a verse

/** The text a person is working on, as a decision says where it holds. */
export type GlossaryText = Exclude<GlossaryScope, "all">;

/** A decision as it is said beside a verse of an English text that is aligned with the original. */
export type VerseDecision = {
  entry: GlossaryEntry;
  /** What that verse says in English on the entry's word(s) of the original: «James», or «Messiah» where another text says «Christ». */
  english: string;
  /** The English term the decision was taken on, when this verse says another: said too, so nobody takes it for this word's. */
  decidedFor?: string;
};

const plainWord = (text: string): string => text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/**
 * «servant» and «servants», «call» and «called»: the same word with an ending. Not «servant» and «serve», which
 * are two words for one of the original: a decision taken on one is said at the other as taken on the other.
 */
function sameWord(a: string, b: string): boolean {
  const [x, y] = [fold(a), fold(b)].sort((one, other) => one.length - other.length) as [string, string];
  return x === y || (x.length >= 3 && y.startsWith(x) && y.length - x.length <= 3);
}

/** The alignment groups of one verse of a parsed text, whose verses are named «JUD 1:1». */
export function groupsOfVerse(alignments: Record<string, AlignmentGroup[]> | undefined, chapter: number, verse: number): AlignmentGroup[] {
  for (const [sid, groups] of Object.entries(alignments ?? {})) {
    const match = /(\d+):(\d+)\s*$/.exec(sid.trim());
    if (match && Number(match[1]) === chapter && Number(match[2]) === verse) return groups;
  }
  return [];
}

/**
 * The decisions that hold for one verse of the text in hand. The glossary hangs from the original, and both English
 * texts are aligned with it: the word of the original under each English word of the verse says which decision is
 * that word's, whichever English text it is read in. So what was decided on «James» in one text is found at «James»
 * in the other, and at a verse where the same word of the original was put another way.
 *
 * `groups`: the alignment of that verse of the English text being translated. `text`: which text that is; a decision
 * taken for another text alone is left out. `englishText`: the verse as it reads, for the entries that have no word
 * of the original yet.
 */
export function decisionsForVerse(entries: GlossaryEntry[], groups: AlignmentGroup[], text: GlossaryText, englishText = ""): VerseDecision[] {
  const out: VerseDecision[] = [];
  const english = fold(englishText);
  for (const entry of entries) {
    if (!entry.rendering.trim() || (entry.scope !== "all" && entry.scope !== text)) continue;
    const mine = strongsOf(entry);
    if (!mine.length) {
      const term = [...entry.english, entry.lemma].find((candidate) => Boolean(english) && termIn(candidate, english));
      if (term) out.push({ entry, english: term });
      continue;
    }
    // In the order of the verse, so an expression reads as it does there whatever the order its words were filed in.
    const over = groups.filter((group) => group.sources.some((s) => mine.includes(baseStrong(s.strong))));
    if (!mine.every((strong) => over.some((group) => group.sources.some((s) => baseStrong(s.strong) === strong)))) continue;
    const words = [...new Set(over.flatMap((group) => group.targets.map((target) => plainWord(target.word))).filter(Boolean))];
    // A word of the original often stands under two of English («of James»): the one the decision names is the one said.
    const named = words.filter((word) => entry.english.some((term) => term.split(/\s+/).some((part) => sameWord(part, word))));
    out.push({
      entry,
      english: (named.length ? named : words).join(" ") || entry.english[0] || entry.lemma,
      decidedFor: entry.english.length && !named.length ? entry.english[0] : undefined,
    });
  }
  // The same word of the original may have a decision for each English word it was put as («Christ» in one text,
  // «Messiah» in the other): where the verse says one of them, that decision is the one said.
  const exact = new Set(out.filter((decision) => !decision.decidedFor).map((decision) => decision.entry.strong));
  return out.filter((decision) => !decision.decidedFor || !exact.has(decision.entry.strong)).sort((a, b) => Number(b.entry.status === "agreed") - Number(a.entry.status === "agreed"));
}

/**
 * The entry that already decides how some English words over a word of the original are translated, and the one
 * that decides it for another English word of the same original (to say, not to stop a new one: «Christ» has its
 * decision, «Messiah» may have another).
 */
export function entriesUnder(entries: GlossaryEntry[], strong: string, english: string): { existing?: GlossaryEntry; other?: GlossaryEntry } {
  const same = entries.filter((entry) => entry.strong === strong && Boolean(strong));
  const words = english.split(/\s+/).filter(Boolean);
  const names = (entry: GlossaryEntry) => !entry.english.length || entry.english.some((term) => term.split(/\s+/).some((part) => words.some((word) => sameWord(part, word))));
  const existing = same.find(names);
  return { existing, other: existing ? undefined : same.find((entry) => entry.rendering.trim()) };
}

/** Is an English term said in a text, as a word of its own, with its endings too (plural, possessive, «called», «calling»)? `text` already folded. */
function termSaid(term: string, text: string): boolean {
  const wanted = fold(term);
  return Boolean(wanted) && new RegExp(`(^|[^\\p{L}])${wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(e?s|e?d|ing|['’]s?)?([^\\p{L}]|$)`, "u").test(text);
}

/**
 * The decisions that hold for a text that is not a verse: a note, a question, a paragraph of an article. Such a
 * text is not aligned with the original. It says English words, and a decision is its own when it says the English
 * word the decision was taken on: the entry is what ties that word to the original. A note quotes the literal text
 * and explains it, so what was decided for the literal text holds in it; what was decided for the simplified text
 * alone does not. The addresses of a note's links are not text.
 */
export function decisionsForText(entries: GlossaryEntry[], text: string): VerseDecision[] {
  const said = fold(readable(text).replace(/\*\*|__/g, ""));
  if (!said) return [];
  const out: VerseDecision[] = [];
  for (const entry of entries) {
    if (!entry.rendering.trim() || entry.scope === "tps") continue;
    // The word of the original is not looked for: it is Greek or Hebrew, and the text is English.
    const term = (entry.english.length ? entry.english : entry.strong ? [] : [entry.lemma]).find((candidate) => termSaid(candidate, said));
    if (term) out.push({ entry, english: term });
  }
  return out.sort((a, b) => Number(b.entry.status === "agreed") - Number(a.entry.status === "agreed"));
}

/** What an entry says to avoid, without the reasons: «liberar: pierde la idea del precio» → «liberar». */
export function avoided(entry: GlossaryEntry): string[] {
  return entry.avoid.map((item) => (item.split(":")[0] ?? "").trim()).filter(Boolean);
}

// ---------------------------------------------------------------- from a tap on an aligned word

/**
 * What touching words of a verse's English leads to: the word(s) of the original under them, small words left out,
 * which is what an entry is filed by. `english`: those words as the verse says them, in its order. Null when one of
 * them is not aligned: there is nothing of the original to hang the entry from.
 */
export function sourcesUnder(groups: AlignmentGroup[], words: string[]): { english: string; sources: OriginalWord[]; strong: string } | null {
  const wanted = words.map((word) => fold(plainWord(word))).filter(Boolean);
  const has = (group: AlignmentGroup, word: string) => group.targets.some((target) => fold(plainWord(target.word)) === word);
  if (!wanted.length || wanted.some((word) => !groups.some((group) => has(group, word)))) return null;
  const over = groups.filter((group) => wanted.some((word) => has(group, word)));
  const sources = over.flatMap(contentSources).filter((source, index, all) => all.findIndex((other) => baseStrong(other.strong) === baseStrong(source.strong)) === index);
  const strong = sources.map((source) => baseStrong(source.strong)).filter(Boolean).join(";");
  if (!strong) return null;
  const said = over.flatMap((group) => group.targets.map((target) => plainWord(target.word))).filter((word) => wanted.includes(fold(word)));
  return { english: [...new Set(said)].join(" "), sources, strong };
}

/**
 * Where a decision made from some words of a text is filed. `verses`: the alignment of the verse those words may be
 * of, in each English text it is read in; the first that has them all says the word of the original. `englishOnly`:
 * for a note, a question or an article, whose words may be in no verse; then the entry is filed by the English word
 * alone, to be tied to the original later. An entry that names that word already is the one there is.
 */
export function filedUnder(entries: GlossaryEntry[], words: string[], verses: AlignmentGroup[][], englishOnly: boolean): { english: string; sources: OriginalWord[]; strong: string; existing?: GlossaryEntry; other?: GlossaryEntry } | null {
  for (const groups of verses) {
    const under = sourcesUnder(groups, words);
    if (under) return { ...under, ...entriesUnder(entries, under.strong, under.english) };
  }
  const english = words.map(plainWord).filter(Boolean).join(" ");
  if (!englishOnly || !english) return null;
  const existing = entries.find((entry) => (entry.english.length ? entry.english : [entry.lemma]).some((term) => fold(term) === fold(english)));
  return { english, sources: [], strong: "", existing };
}

/**
 * The wordings a comment names, to offer as the answer to «how do we translate it?»: what it says between quotation
 * marks («Jacobo», «Santiago»); or, without marks, the names it writes with a capital in mid sentence. Whoever made
 * the comment has written the word already. A comment that names none («Falta traducir el título.») offers none:
 * its other words would only be noise to choose from.
 */
export function namedWordings(comment: string, limit = 6): string[] {
  const quoted = [...comment.matchAll(/[«"“]([^«»"“”]{1,40})[»"”]/g)].map((match) => (match[1] ?? "").trim()).filter(Boolean);
  const names = [...comment.matchAll(/(?<![.!?¡¿:]\s*)(?<=\S\s)(\p{Lu}[\p{L}\p{M}'’-]{2,})/gu)].map((match) => match[1] ?? "");
  const from = quoted.length ? quoted : names;
  return from.filter((word, index) => from.findIndex((other) => fold(other) === fold(word)) === index).slice(0, limit);
}

/** Is this a word that carries meaning (noun, verb, adjective), going by the morphology the original texts bring? */
export function isContentWord(word: Pick<OriginalWord, "morph">): boolean {
  const morph = (word.morph ?? "").trim();
  if (!morph) return true; // no morphology: it cannot be told apart, so it is offered
  const [language, ...rest] = morph.split(",");
  if (/^Gr/i.test(language ?? "")) return /^[NVA]/.test((rest[0] ?? "").trim());
  // Hebrew and Aramaic: `He,R:Td:Ncmsa` has prefixes before the word itself.
  const base = (rest.join(",").split(":").pop() ?? "").trim();
  return /^[NVA]/.test(base);
}

/**
 * The word(s) of the original an aligned word stands on, small words left out (articles, prepositions,
 * conjunctions, particles, Hebrew prefixes). When only small words are there, they are all offered.
 */
export function contentSources(group: AlignmentGroup): OriginalWord[] {
  const content = group.sources.filter(isContentWord);
  return content.length ? content : group.sources;
}

/** The alignment group a word of the aligned text belongs to. */
export function groupOfWord(groups: AlignmentGroup[], word: string, occurrence: number): AlignmentGroup | undefined {
  const plain = (text: string) => text.replace(/[^\p{L}\p{N}\p{M}]/gu, "").toLowerCase();
  return groups.find((group) => group.targets.some((target) => plain(target.word) === plain(word) && target.occurrence === occurrence));
}

/** A new entry from the words chosen in the original (one word, or several for an expression). */
export function entryFromSources(params: { id: string; sources: Pick<OriginalWord, "strong" | "lemma">[]; english: string; example: string }): GlossaryEntry {
  return {
    id: params.id,
    lemma: params.sources.map((s) => s.lemma).join(" + ") || params.english,
    strong: params.sources.map((s) => baseStrong(s.strong)).filter(Boolean).join(";"),
    english: params.english ? [params.english] : [],
    sense: "",
    rendering: "",
    alternatives: [],
    avoid: [],
    scope: "all",
    variants: [],
    twLink: "",
    examples: params.example ? [params.example] : [],
    status: "proposed",
    note: "",
  };
}

// ---------------------------------------------------------------- how it was translated before

export type RenderingCount = { rendering: string; count: number; examples: string[] };

/**
 * How the team translated a word of the original in an aligned text: every wording, with how many times and where.
 * `verses` are the alignment groups by verse reference («TIT 2:14»).
 */
export function renderingsOf(strong: string, verses: Record<string, AlignmentGroup[]>): RenderingCount[] {
  const wanted = baseStrong(strong);
  const counts = new Map<string, RenderingCount>();
  if (!wanted) return [];
  for (const [ref, groups] of Object.entries(verses)) {
    for (const group of groups) {
      if (!group.sources.some((s) => baseStrong(s.strong) === wanted)) continue;
      const rendering = group.targets.map((t) => t.word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter(Boolean).join(" ").toLowerCase();
      if (!rendering) continue;
      const hit = counts.get(rendering) ?? { rendering, count: 0, examples: [] };
      hit.count++;
      if (hit.examples.length < 3) hit.examples.push(ref);
      counts.set(rendering, hit);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.rendering.localeCompare(b.rendering));
}

/**
 * Is a wording the decided one, allowing for inflection? «redimiese» is «redimir»: every word of the decision has a
 * word in the text that starts the same (four letters, or the whole word when it is shorter). It errs on the side of
 * accepting: a notice about a departure should be worth reading.
 */
function sameWording(text: string, decided: string): boolean {
  if (text.includes(decided)) return true;
  const words = text.split(/\s+/).filter(Boolean);
  return decided.split(/\s+/).filter(Boolean).every((want) => {
    const root = want.slice(0, Math.min(4, want.length));
    return words.some((word) => word.startsWith(root));
  });
}

/** Where an aligned text departs from an agreed entry: verses that use a wording the entry does not allow. */
export function departuresFrom(entry: GlossaryEntry, verses: Record<string, AlignmentGroup[]>): RenderingCount[] {
  if (entry.status !== "agreed" || !entry.rendering) return [];
  const allowed = [entry.rendering, ...entry.alternatives.map((a) => a.split(":")[0] ?? ""), ...entry.variants].map(fold).filter(Boolean);
  const first = entry.strong.split(";")[0] ?? "";
  return renderingsOf(first, verses).filter((r) => !allowed.some((a) => sameWording(fold(r.rendering), a)));
}

// ---------------------------------------------------------------- the index of every book

/** How each word of the original was translated in one aligned text, by Strong number. */
export type RenderingIndex = Record<string, RenderingCount[]>;

/** The index of one book, as kept in `index/<BOOK>.json` of the glossary repository. It is generated, never edited. */
export type BookRenderings = { book: string; generated: string; texts: Record<string, RenderingIndex> };

/** Every word of the original in an aligned text with its wordings, in one pass. */
export function indexRenderings(verses: Record<string, AlignmentGroup[]>): RenderingIndex {
  const byStrong = new Map<string, Map<string, RenderingCount>>();
  for (const [ref, groups] of Object.entries(verses)) {
    for (const group of groups) {
      const rendering = group.targets.map((t) => t.word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter(Boolean).join(" ").toLowerCase();
      if (!rendering) continue;
      for (const strong of new Set(group.sources.map((s) => baseStrong(s.strong)).filter(Boolean))) {
        const counts = byStrong.get(strong) ?? new Map<string, RenderingCount>();
        byStrong.set(strong, counts);
        const hit = counts.get(rendering) ?? { rendering, count: 0, examples: [] };
        hit.count++;
        if (hit.examples.length < 3) hit.examples.push(ref);
        counts.set(rendering, hit);
      }
    }
  }
  const sorted = (counts: Map<string, RenderingCount>) => [...counts.values()].sort((a, b) => b.count - a.count || a.rendering.localeCompare(b.rendering));
  return Object.fromEntries([...byStrong].sort(([a], [b]) => a.localeCompare(b)).map(([strong, counts]) => [strong, sorted(counts)]));
}

/** The wordings of a word across several books: counts added up, a few examples kept. */
export function renderingsAcross(strong: string, indexes: RenderingIndex[]): RenderingCount[] {
  const wanted = baseStrong(strong);
  const total = new Map<string, RenderingCount>();
  for (const index of indexes) {
    for (const row of index[wanted] ?? []) {
      const hit = total.get(row.rendering) ?? { rendering: row.rendering, count: 0, examples: [] };
      hit.count += row.count;
      for (const example of row.examples) if (hit.examples.length < 3) hit.examples.push(example);
      total.set(row.rendering, hit);
    }
  }
  return [...total.values()].sort((a, b) => b.count - a.count || a.rendering.localeCompare(b.rendering));
}
