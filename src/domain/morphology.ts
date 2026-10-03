/**
 * The grammar of a word of the original, read from the code the texts tag it with (`x-morph`):
 * `Gr,V,IPA3,,S,` is a verb, indicative present active, third person singular.
 *
 * The codes and how they are read follow unfoldingWord's word-aligner (MIT), which translationCore uses: the
 * UGNT's twelve places, and the Open Scriptures codes of the UHB, where a word joined to particles has one code
 * per part (`He,C:Vqw3ms`). What comes out is a list of names to look up in the interface texts (`mo.<name>`),
 * so the grammar reads in the language of the team; the names of the Hebrew stems are the same in both.
 */

/** One trait of a word: a name to translate (`mo.<key>`), or a text that stands as it is. */
export type MorphLabel = { key: string } | { text: string };

const key = (name: string): MorphLabel => ({ key: name });

const GREEK_ROLES: Record<string, { key: string; types: Record<string, string> }> = {
  N: { key: "noun", types: { S: "substantive_adj", P: "predicate_adj" } },
  A: { key: "adjective", types: { A: "ascriptive", R: "restrictive" } },
  E: { key: "determiner", types: { A: "article", D: "demonstrative", F: "differential", P: "possessive", Q: "quantifier", N: "number", O: "ordinal", R: "relative", T: "interrogative" } },
  R: { key: "pronoun", types: { D: "demonstrative", P: "personal", E: "reflexive", C: "reciprocal", I: "indefinite", R: "relative", T: "interrogative" } },
  V: { key: "verb", types: { T: "transitive", I: "intransitive", L: "linking", M: "modal", P: "periphrastic" } },
  I: { key: "interjection", types: { E: "exclamation", D: "directive", R: "response" } },
  P: { key: "preposition", types: { I: "improper" } },
  D: { key: "adverb", types: { O: "correlative" } },
  C: { key: "conjunction", types: { C: "coordinating", S: "subordinating", O: "correlative" } },
  T: { key: "particle", types: { F: "foreign", E: "error" } },
};

/** The places after the role and its type: mood, tense, voice, person, case, gender, number, and one more. */
const GREEK_PLACES: Record<number, Record<string, string>> = {
  4: { I: "indicative", M: "imperative", S: "subjunctive", O: "optative", N: "infinitive", P: "participle" },
  5: { P: "present", I: "imperfect", F: "future", A: "aorist", E: "perfect", L: "pluperfect" },
  6: { A: "active", M: "middle", P: "passive" },
  7: { 1: "first", 2: "second", 3: "third" },
  8: { N: "nominative", G: "genitive", D: "dative", A: "accusative", V: "vocative" },
  9: { M: "masculine", F: "feminine", N: "neuter" },
  10: { S: "singular", P: "plural" },
  11: { C: "comparative", S: "superlative", D: "diminutive", I: "indeclinable" },
};

function greek(morph: string): MorphLabel[] {
  // Each place holds one character; an empty place is a comma.
  const codes = morph.match(/[A-Z0-9,]/g) ?? [];
  // "Gr" and the comma after it take the first two places; the role is the third.
  const at = (place: number) => {
    const code = codes[place];
    return code && code !== "," ? code : "";
  };
  const role = GREEK_ROLES[at(2)];
  if (!role) return at(2) ? [{ text: at(2) }] : [];
  const out: MorphLabel[] = [];
  const type = at(3);
  // An adjective used as a noun is tagged as a noun of that type: the type says it all.
  if (!(role.key === "noun" && role.types[type])) out.push(key(role.key));
  if (type) out.push(role.types[type] ? key(role.types[type]!) : { text: type });
  for (let place = 4; place <= 11; place++) {
    const code = at(place);
    if (!code) continue;
    const name = GREEK_PLACES[place]![code];
    out.push(name ? key(name) : { text: code });
  }
  return out;
}

const HEBREW_STEMS: Record<string, string> = {
  q: "qal", N: "nifal", p: "piel", P: "pual", h: "hifil", H: "hofal", t: "hitpael", o: "polel", O: "polal", r: "hitpolel", m: "poel", M: "poal", k: "palel", K: "pulal",
  l: "pilpel", L: "polpal", f: "hitpalpel", D: "nitpael", j: "pealal", i: "pilel", u: "hotpaal", c: "tifil", v: "hishtafel", w: "nitpalel", y: "nitpoel", z: "hitpoel",
};
const ARAMAIC_STEMS: Record<string, string> = {
  q: "peal", Q: "peil", u: "hitpeel", p: "pael", P: "itpaal", M: "hitpaal", a: "afel", h: "hafel", s: "safel", e: "shafel", H: "hofal", i: "itpeel", t: "hishtafel", v: "ishtafel",
  w: "hitafel", o: "polel", z: "itpoel", r: "hitpolel", f: "hitpalpel", b: "hefal", c: "tifel", m: "poel", l: "palpel", L: "itpalpel", O: "itpolel", G: "itafal",
};

const HEBREW_TRAITS: Record<string, Record<string, string>> = {
  adjective_types: { a: "", c: "cardinal_number", g: "gentilic", o: "ordinal_number" },
  gender: { b: "both_genders", c: "common_gender", f: "feminine", m: "masculine" },
  noun_types: { c: "common", g: "gentilic", p: "proper_name" },
  number: { d: "dual", p: "plural", s: "singular" },
  particle_types: { a: "affirmation", d: "definite_article", e: "exhortation", i: "interrogative", j: "interjection", m: "demonstrative", n: "negative", o: "direct_object_marker", r: "relative" },
  person: { 1: "first", 2: "second", 3: "third" },
  preposition_types: { d: "definite_article" },
  pronoun_types: { d: "demonstrative", f: "indefinite", i: "interrogative", p: "personal", r: "relative" },
  state: { a: "absolute", c: "construct", d: "determined" },
  suffix_types: { d: "directional_he", h: "paragogic_he", n: "paragogic_nun", p: "pronominal" },
  verb_conjugation_types: {
    p: "perfect_qatal", q: "sequential_perfect_weqatal", i: "imperfect_yiqtol", w: "sequential_imperfect_wayyiqtol", h: "cohortative", j: "jussive",
    v: "imperative", r: "participle_active", s: "participle_passive", a: "infinitive_absolute", c: "infinitive_construct",
  },
};

const HEBREW_PARTS: Record<string, { key: string; traits: string[] }> = {
  A: { key: "adjective", traits: ["adjective_types", "gender", "number", "state"] },
  C: { key: "conjunction", traits: [] },
  D: { key: "adverb", traits: [] },
  N: { key: "noun", traits: ["noun_types", "gender", "number", "state"] },
  P: { key: "pronoun", traits: ["pronoun_types", "person", "gender", "number"] },
  R: { key: "preposition", traits: ["preposition_types"] },
  S: { key: "suffix", traits: ["suffix_types", "person", "gender", "number"] },
  T: { key: "particle", traits: ["particle_types"] },
  V: { key: "verb", traits: ["verb_stems", "verb_conjugation_types", "person", "gender", "number", "state"] },
};

function hebrewPart(code: string, aramaic: boolean): MorphLabel[] {
  const part = HEBREW_PARTS[code[0] ?? ""];
  if (!part) return code ? [{ text: code }] : [];
  const out: MorphLabel[] = [key(part.key)];
  // A participle has no person: after the stem and the kind come gender, number and state.
  const traits = part.key === "verb" && /^V.[rs]/.test(code) ? ["verb_stems", "verb_conjugation_types", "gender", "number", "state"] : part.traits;
  for (let i = 1; i < code.length; i++) {
    const char = code[i]!;
    const trait = traits[i - 1];
    // "x" holds a place that does not apply.
    if (char === "x") continue;
    if (!trait) {
      out.push({ text: code.slice(i) });
      break;
    }
    if (trait === "verb_stems") {
      // The stems keep their names; only the Hebrew passive of qal has one to translate.
      const stem = (aramaic ? ARAMAIC_STEMS : HEBREW_STEMS)[char];
      out.push(!aramaic && char === "Q" ? key("qal_passive") : { text: stem ?? char });
      continue;
    }
    const name = HEBREW_TRAITS[trait]![char];
    if (name === "") continue;
    out.push(name ? key(name) : { text: char });
  }
  return out;
}

/**
 * The grammar of a word, one list per part of it: a Greek word has one; a Hebrew word joined to a conjunction,
 * a preposition or a suffix has one for each. Empty when the word carries no code.
 */
export function describeMorph(morph: string | undefined): MorphLabel[][] {
  const code = String(morph ?? "").trim();
  if (!code) return [];
  const language = code.split(",")[0]!.toLowerCase();
  if (language === "he" || language === "ar") {
    return code
      .slice(code.indexOf(",") + 1)
      .split(":")
      .map((part) => hebrewPart(part.trim(), language === "ar"))
      .filter((labels) => labels.length);
  }
  const labels = greek(code);
  return labels.length ? [labels] : [];
}

/** Every name `describeMorph` can give: each needs its text (`mo.<name>`) in every interface language. */
export const MORPH_KEYS: string[] = [
  ...new Set([
    ...Object.values(GREEK_ROLES).flatMap((role) => [role.key, ...Object.values(role.types)]),
    ...Object.values(GREEK_PLACES).flatMap((place) => Object.values(place)),
    ...Object.values(HEBREW_PARTS).map((part) => part.key),
    ...Object.values(HEBREW_TRAITS).flatMap((trait) => Object.values(trait)),
    "qal_passive",
  ]),
].filter(Boolean);
