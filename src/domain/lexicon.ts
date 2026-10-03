/**
 * What a word of the original means, read from a lexicon repository: one small file per Strong's number, in the
 * layout Door43 lexicons use (`brief`, `long`), with, when the lexicon has them, the senses of the word and the
 * verses each sense applies to. `scripts/build-lexicons.mjs` writes the repositories this team reads.
 */

export type LexiconSense = {
  definition?: string;
  glosses?: string[];
  domain?: string;
  code?: string;
  comments?: string;
  etymology?: string;
  /** "en" when the lexicon has not translated this sense yet. */
  lang?: string;
  definitionLang?: string;
  /** Verses the sense applies to, by book: "1:7,9;2:3". Absent when the word has one sense only. */
  refs?: Record<string, string>;
};

export type LexiconEntry = {
  strong: string;
  lemma: string;
  aramaic?: boolean;
  pos?: string[];
  senses: LexiconSense[];
  notes?: string[];
  /** Set on an entry that does not come from the lexicon's main source. */
  source?: string;
  /** "pending" while nobody has reviewed the translation of the entry. */
  review?: string;
};

export type LexiconFile = { brief: string; long: string; entries: LexiconEntry[] };

export type StrongPart = { kind: "greek" | "hebrew"; number: number; letter: string };

/**
 * The lexicon entries a word's Strong's attribute points to. The texts write it in their own way:
 * the UGNT adds a digit (`G52280` is entry 5228), the UHB prefixes the particles joined to the word
 * (`c:d:H0776`) and tells homonyms apart with a letter (`H1254a`).
 */
export function strongParts(strong: string | undefined): StrongPart[] {
  const out: StrongPart[] = [];
  for (const part of String(strong ?? "").split(":")) {
    const greek = /^G(\d+)\d$/.exec(part.trim());
    if (greek) {
      out.push({ kind: "greek", number: Number(greek[1]), letter: "" });
      continue;
    }
    const hebrew = /^H(\d+)([a-z])?$/.exec(part.trim());
    if (hebrew && Number(hebrew[1])) out.push({ kind: "hebrew", number: Number(hebrew[1]), letter: hebrew[2] ?? "" });
  }
  return out;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** A lexicon file as read, made safe to show. A plain Door43 lexicon (only `brief` and `long`) has no entries. */
export function normalizeLexiconFile(raw: unknown): LexiconFile | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const entries: LexiconEntry[] = [];
  for (const item of Array.isArray(row.entries) ? row.entries : []) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const senses: LexiconSense[] = [];
    for (const s of Array.isArray(e.senses) ? e.senses : []) {
      if (!s || typeof s !== "object") continue;
      const sense = s as Record<string, unknown>;
      const glosses = Array.isArray(sense.glosses) ? sense.glosses.map(text).filter(Boolean) : [];
      const definition = text(sense.definition);
      if (!definition && !glosses.length) continue;
      const refs: Record<string, string> = {};
      if (sense.refs && typeof sense.refs === "object") for (const [book, packed] of Object.entries(sense.refs as Record<string, unknown>)) if (text(packed)) refs[book] = text(packed);
      senses.push({
        ...(definition ? { definition } : {}),
        ...(glosses.length ? { glosses } : {}),
        ...(text(sense.domain) ? { domain: text(sense.domain) } : {}),
        ...(text(sense.code) ? { code: text(sense.code) } : {}),
        ...(text(sense.comments) ? { comments: text(sense.comments) } : {}),
        ...(text(sense.etymology) ? { etymology: text(sense.etymology) } : {}),
        ...(text(sense.lang) ? { lang: text(sense.lang) } : {}),
        ...(text(sense.definitionLang) ? { definitionLang: text(sense.definitionLang) } : {}),
        ...(Object.keys(refs).length ? { refs } : {}),
      });
    }
    if (!senses.length) continue;
    entries.push({
      strong: text(e.strong),
      lemma: text(e.lemma),
      ...(e.aramaic === true ? { aramaic: true } : {}),
      ...(Array.isArray(e.pos) && e.pos.map(text).filter(Boolean).length ? { pos: e.pos.map(text).filter(Boolean) } : {}),
      senses,
      ...(Array.isArray(e.notes) && e.notes.map(text).filter(Boolean).length ? { notes: e.notes.map(text).filter(Boolean) } : {}),
      ...(text(e.source) ? { source: text(e.source) } : {}),
      ...(text(e.review) ? { review: text(e.review) } : {}),
    });
  }
  const brief = text(row.brief);
  const long = text(row.long);
  return brief || long || entries.length ? { brief, long, entries } : null;
}

/** Whether a packed list of verses ("1:7,9;2:3") has this one. */
export function refsInclude(packed: string | undefined, chapter: number, verse: number): boolean {
  for (const part of String(packed ?? "").split(";")) {
    const [c, verses] = part.split(":");
    if (Number(c) === chapter && verses?.split(",").some((v) => Number(v) === verse)) return true;
  }
  return false;
}

export type SensesOfWord = {
  /** The entries of the file that are this word: the homonym the text points to, or all of them. */
  entries: LexiconEntry[];
  /** The senses the lexicon gives for the verse in hand; every sense when it gives none for it. */
  here: LexiconSense[];
  /** The other senses of the word. */
  other: LexiconSense[];
  /** `here` was chosen by the verse, not for lack of a better guide. */
  byVerse: boolean;
};

/**
 * The senses of a word in a verse. The lexicon says which verses each sense applies to, so the sense of the verse
 * in hand comes first; with nothing for the verse (a word with one sense, or a verse numbered differently) every
 * sense is shown, in the lexicon's order.
 */
export function sensesOfWord(file: LexiconFile, at: { book: string; chapter: number; verse: number }, letter = ""): SensesOfWord {
  const exact = letter ? file.entries.filter((e) => e.strong.toLowerCase().endsWith(letter.toLowerCase())) : [];
  const entries = exact.length ? exact : file.entries;
  const all = entries.flatMap((e) => e.senses);
  const here = all.filter((s) => refsInclude(s.refs?.[at.book], at.chapter, at.verse));
  if (!here.length) return { entries, here: all, other: [], byVerse: false };
  return { entries, here, other: all.filter((s) => !here.includes(s)), byVerse: true };
}

/** The gloss to put beside a word in a tight place: the first gloss of the sense of the verse. */
export function glossOfWord(file: LexiconFile, at: { book: string; chapter: number; verse: number }, letter = ""): string {
  const { here } = sensesOfWord(file, at, letter);
  return here[0]?.glosses?.[0] ?? file.brief.split(",")[0]?.trim() ?? "";
}

/** How a Strong's number is written for a person: G5228, H0776, H1254a. */
export function strongCode(part: StrongPart): string {
  return part.kind === "greek" ? `G${part.number}` : `H${String(part.number).padStart(4, "0")}${part.letter}`;
}

/**
 * The issue a person's report about an entry becomes. Whoever keeps the lexicon reads it away from the app, so it
 * carries what the person was looking at: the word, its entry, the verse and the sense shown. `labels` are the
 * words of the list, in the language the person works in.
 */
export function lexiconReport(input: {
  text: string;
  surface: string;
  lemma: string;
  part: StrongPart;
  at: { book: string; chapter: number; verse: number };
  /** The glosses and definition shown for the verse, if the lexicon had the word. */
  shown: string;
  username: string;
  labels: { word: string; lemma: string; entry: string; verse: string; shown: string; missing: string; from: string };
}): { title: string; body: string } {
  const { labels, part } = input;
  const said = input.text.trim().replace(/\s+/g, " ");
  const ref = `${input.at.book} ${input.at.chapter}:${input.at.verse}`;
  const code = strongCode(part);
  return {
    title: `${code} ${input.lemma || input.surface} · ${ref}: ${said.length > 70 ? `${said.slice(0, 69)}…` : said}`,
    body: [
      input.text.trim(),
      "",
      "---",
      `- ${labels.word}: ${input.surface}${input.lemma && input.lemma !== input.surface ? ` (${labels.lemma} ${input.lemma})` : ""}`,
      `- ${labels.entry}: ${code} · \`content/${part.number}.json\``,
      `- ${labels.verse}: ${ref}`,
      `- ${labels.shown}: ${input.shown || labels.missing}`,
      `- ${labels.from} @${input.username}`,
    ].join("\n"),
  };
}

/** Letters only, without accents or case: «Nombre,» and «nombre» are the same word. */
function fold(word: string): string {
  return word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words that join others in a gloss ("salir de", "a causa de") and say nothing of its meaning. */
const JOINING = new Set("a al de del el la los las lo un una unos unas y o que en por para con se su sus es no".split(" "));

/**
 * Whether two words are forms of the same one. The draft inflects («salieron») and the lexicon cites («salir»):
 * with no dictionary of the language, a long shared beginning is taken as the same word. It can be wrong both
 * ways (an irregular form is missed, two words of one root are taken together); it feeds a hint, not a decision.
 */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared++;
  return shared >= 4 && shared >= Math.min(a.length, b.length) - 2 && shared * 2 >= Math.max(a.length, b.length);
}

/**
 * Whether the lexicon gives a word of the draft as a rendering of this word of the original, in any of its
 * senses. A gloss of several words matches by the ones that carry meaning; a gloss that is one word, by it.
 */
export function glossesInclude(file: LexiconFile, draftWord: string): boolean {
  const word = fold(draftWord);
  if (!word) return false;
  const glosses = file.entries.length ? file.entries.flatMap((e) => e.senses.flatMap((s) => s.glosses ?? [])) : file.brief.split(",");
  for (const gloss of glosses) {
    const tokens = fold(gloss).split(" ").filter(Boolean);
    if (!tokens.length) continue;
    const meaningful = tokens.length === 1 ? tokens : tokens.filter((token) => !JOINING.has(token));
    if (meaningful.some((token) => sameWord(token, word))) return true;
  }
  return false;
}
