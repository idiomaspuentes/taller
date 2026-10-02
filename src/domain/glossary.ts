import type { AlignmentGroup, OriginalWord } from "@usfm-tools/types";

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
    return Boolean(english) && [entry.lemma, ...entry.english].some((term) => new RegExp(`(^|[^\\p{L}])${fold(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "u").test(english));
  });
}

// ---------------------------------------------------------------- from a tap on an aligned word

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

/** Where an aligned text departs from an agreed entry: verses that use a wording the entry does not allow. */
export function departuresFrom(entry: GlossaryEntry, verses: Record<string, AlignmentGroup[]>): RenderingCount[] {
  if (entry.status !== "agreed" || !entry.rendering) return [];
  const allowed = [entry.rendering, ...entry.alternatives.map((a) => a.split(":")[0] ?? ""), ...entry.variants].map(fold).filter(Boolean);
  const first = entry.strong.split(";")[0] ?? "";
  return renderingsOf(first, verses).filter((r) => !allowed.some((a) => fold(r.rendering).includes(a)));
}
