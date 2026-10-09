#!/usr/bin/env node
/**
 * Builds the lexicon repositories the alignment tool reads a word's meaning from: one small JSON file per
 * Strong's number, in the language of the team, in the layout Door43 lexicons use (`content/<number>.json`,
 * with `brief` and `long`, as translationCore and gateway-edit expect).
 *
 * The main source is the UBS dictionaries (github.com/ubsicap/ubs-open-license, CC BY-SA 4.0), which come as
 * one large file per language; their text is reshaped, not translated. What this adds is the list of senses
 * with the verses each one applies to, so a tool can show the sense of the verse in hand.
 *
 * The UBS dictionaries lack a few very frequent words (εἰμί, עַל, כֹּל…). Those are filled in from
 * scripts/lexicon-additions/, translated from the English lexicons of Door43 (CC BY-SA 4.0 too), so the
 * repositories stand on their own: a tool reads one place and finds every word of the text.
 *
 *   node scripts/build-lexicons.mjs                 # writes ../lexicons/<repo>
 *   node scripts/build-lexicons.mjs --coverage      # also checks every Strong's of the UGNT and the UHB
 *   node scripts/build-lexicons.mjs --out <dir>
 *
 * It only writes local files. Publishing them to Door43 is a separate, deliberate step.
 */
import { mkdir, readFile, writeFile, rm, readdir, copyFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
/** The most words a field of meaning may have and still be listed. */
const MAX_FIELD_WORDS = 150;
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

const OUT = path.resolve(option("--out", path.join(HERE, "..", "..", "lexicons")));
const SOURCES_DIR = path.join(OUT, ".sources");
const UBS = "https://raw.githubusercontent.com/ubsicap/ubs-open-license/main/dictionaries";
const DOOR43 = "https://git.door43.org";
const TODAY = new Date().toISOString().slice(0, 10);

const SOURCE_FILES = {
  greekEs: "greek/JSON/UBSGreekNTDic-v1.0-es.JSON",
  greekEn: "greek/JSON/UBSGreekNTDic-v1.1-en.JSON",
  hebrewEs: "hebrew/JSON/UBSHebrewDic-v0.9.3-es.JSON",
  hebrewPt: "hebrew/JSON/UBSHebrewDic-v0.9.3-pt.JSON",
  hebrewEn: "hebrew/JSON/UBSHebrewDic-v0.9.3-en.JSON",
  license: "greek/LICENSE.md",
};

/** The credit lines the UBS asks for, word for word. */
const ADDITIONS_DIR = path.join(HERE, "lexicon-additions");

/**
 * The English lexicons the added entries were translated from. They are the ones translationCore bundles and
 * gateway-edit reads (repackaged at git.door43.org/test_org); their text comes from these two works.
 */
const ADDED_FROM = {
  greek: {
    id: "en_ugl",
    title: "Dodson Greek Lexicon",
    url: "https://github.com/biblicalhumanities/Dodson-Greek-Lexicon",
    credit: "Greek-English Lexicon by John Jeffrey Dodson, in the public domain (CC0), from github.com/biblicalhumanities/Dodson-Greek-Lexicon; as packaged in the English Greek Lexicon of translationCore (unfoldingWord), git.door43.org/test_org/en_ugl.",
  },
  hebrew: {
    id: "en_uhl",
    title: "Strong's Hebrew Dictionary (Open Scriptures Hebrew Bible Project)",
    url: "https://github.com/openscriptures/HebrewLexicon",
    credit: "Strong's Hebrew Dictionary as edited in the OSHB Hebrew Lexicon (HebrewStrong.xml) by the Open Scriptures Hebrew Bible Project, CC BY 4.0, the text of Strong's being in the public domain; as packaged in the English Hebrew Lexicon of translationCore (unfoldingWord), git.door43.org/test_org/en_uhl.",
  },
};

const CREDIT = {
  greek:
    "UBS Dictionary of New Testament Greek, © United Bible Societies, 2023. Adapted from Semantic Dictionary of Biblical Greek: © United Bible Societies 2018-2023, which is adapted from Greek-English Lexicon of the New Testament: Based on Semantic Domains, Eds. J P Louw, Eugene Albert Nida © United Bible Societies 1988, 1989.",
  hebrew:
    "UBS Dictionary of Biblical Hebrew © United Bible Societies, 2023. Adapted from Semantic Dictionary of Biblical Hebrew © 2000-2023 United Bible Societies.",
};

const TARGETS = [
  { repo: "es-419_ugl", id: "ugl", kind: "greek", lang: "es-419", langTitle: "Español Latinoamericano", srcLang: "es", source: "greekEs", english: "greekEn", sourceVersion: "1.0", ui: "es" },
  { repo: "es-419_uhl", id: "uhl", kind: "hebrew", lang: "es-419", langTitle: "Español Latinoamericano", srcLang: "es", source: "hebrewEs", english: "hebrewEn", sourceVersion: "0.9.3", ui: "es" },
  { repo: "pt-br_uhl", id: "uhl", kind: "hebrew", lang: "pt-br", langTitle: "Português do Brasil", srcLang: "pt", source: "hebrewPt", english: "hebrewEn", sourceVersion: "0.9.3", ui: "pt" },
];

/** UBS numbers the books 1 to 66 in this order; references are BBBCCCVVV followed by the word's place. */
const BOOKS = "GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV".split(" ");

function parseRef(ref) {
  const digits = String(ref);
  const book = BOOKS[Number(digits.slice(0, 3)) - 1];
  const chapter = Number(digits.slice(3, 6));
  const verse = Number(digits.slice(6, 9));
  return book && chapter ? { book, chapter, verse } : null;
}

/** Verses packed by book as "1:7,9;2:3": a frequent word has thousands, and a phone reads this file. */
function packRefs(refs, unknown) {
  const books = new Map();
  for (const raw of refs ?? []) {
    const at = parseRef(raw);
    if (!at) {
      unknown.count += 1;
      continue;
    }
    if (!books.has(at.book)) books.set(at.book, new Map());
    const chapters = books.get(at.book);
    if (!chapters.has(at.chapter)) chapters.set(at.chapter, new Set());
    chapters.get(at.chapter).add(at.verse);
  }
  const out = {};
  for (const book of BOOKS) {
    const chapters = books.get(book);
    if (!chapters) continue;
    out[book] = [...chapters.keys()]
      .sort((a, b) => a - b)
      .map((c) => `${c}:${[...chapters.get(c)].sort((a, b) => a - b).join(",")}`)
      .join(";");
  }
  return out;
}

function refLabel(digits) {
  const at = parseRef(digits);
  return at ? `${at.book} ${at.chapter}${at.verse ? `:${at.verse}` : ""}` : "";
}

/**
 * The source marks links, notes and references inline. A reader wants the words:
 * {L:Asuero<SDBH:…>} → Asuero · {D:93.32} → 93.32 · {S:00200300100012} → EXO 3:1 · {A:NIV} → NIV · {N:001} → (gone)
 */
function clean(text) {
  return String(text ?? "")
    .replace(/\{L:([^<}]*)<[^>]*>\}/g, "$1")
    .replace(/\{L:([^}]*)\}/g, "$1")
    .replace(/\{D:\s*([^}]*)\}/g, "$1")
    // One mark may hold several references, or a range; a few in the source are never closed.
    .replace(/\{S:\s*([\d\s-]+)\}?/g, (_, body) => body.trim().split(/\s+/).map((part) => part.split("-").map(refLabel).filter(Boolean).join("–")).filter(Boolean).join(", ") + " ")
    .replace(/\{A:\s*([^}]*)\}/g, "$1")
    .replace(/\s*\{N:\s*\d+\s*\}/g, "")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ ([,.;:)])/g, "$1")
    .trim();
}

/** Grammar labels: the Spanish Greek file carries the French ones, the Hebrew files the English ones. */
const POS_GREEK_ES = [
  [/emprunt araméen/g, "préstamo arameo"],
  [/suivi par inf\./g, "seguido de inf."],
  [/\bavec\b/g, "con"],
  [/\bou\b/g, "o"],
  [/\bacc\./g, "ac."],
  [/\bverbe\b/g, "verbo"],
  [/\bnom\b/g, "sust."],
  [/\badjc\./g, "adj."],
  [/\badvb\./g, "adv."],
  [/\banum\./g, "num."],
  [/\bartc\./g, "art."],
  [/\bintj\./g, "interj."],
  [/\bpart\./g, "partícula"],
  [/\bpdem\./g, "pron. dem."],
  [/\bpidf\./g, "pron. indef."],
  [/\bpirg\./g, "pron. interr."],
  [/\bppos\./g, "pron. pos."],
  [/\bpprs\./g, "pron. pers."],
  [/\bprec\./g, "pron. recíp."],
  [/\bprel\./g, "pron. rel."],
  [/\bprfl\./g, "pron. refl."],
];
const POS_HEBREW = {
  es: { "noun m": "sust. m.", "noun f": "sust. f.", "noun c": "sust. común", noun: "sust.", "noun f pl": "sust. f. pl.", "noun m pl": "sust. m. pl.", "noun m du": "sust. m. dual", name: "nombre propio", verb: "verbo", adj: "adj.", adv: "adv.", intj: "interj.", inter: "interr.", "pers.pron": "pron. pers.", "dem.pron": "pron. dem.", "inter.pron": "pron. interr.", conj: "conj.", prep: "prep.", neg: "neg." },
  pt: { "noun m": "subst. m.", "noun f": "subst. f.", "noun c": "subst. comum", noun: "subst.", "noun f pl": "subst. f. pl.", "noun m pl": "subst. m. pl.", "noun m du": "subst. m. dual", name: "nome próprio", verb: "verbo", adj: "adj.", adv: "adv.", intj: "interj.", inter: "interr.", "pers.pron": "pron. pess.", "dem.pron": "pron. dem.", "inter.pron": "pron. interr.", conj: "conj.", prep: "prep.", neg: "neg." },
};

function partOfSpeech(label, target, report) {
  const raw = String(label ?? "").trim();
  if (!raw) return "";
  if (target.kind === "greek") return POS_GREEK_ES.reduce((text, [from, to]) => text.replace(from, to), raw);
  const known = POS_HEBREW[target.ui][raw];
  if (!known) report.unknownPos.add(raw);
  return known ?? raw;
}

/**
 * The Strong's numbers an entry answers to. Files are named by the number alone, as translationCore does
 * (G5228 → 5228, H0776 → 776); a letter after it tells homonyms apart and stays in the entry. UBS writes the
 * Aramaic words as A0004: they are in Strong's Hebrew numbering, so they file under the same number.
 */
function strongNumbers(codes) {
  const out = [];
  for (const code of codes ?? []) {
    for (const part of String(code).split("+")) {
      const m = /^([GHA])?(\d+)([a-z])?$/.exec(part.trim());
      if (!m) continue;
      const letter = m[1] === "G" ? "G" : "H";
      const digits = letter === "G" ? String(Number(m[2])) : m[2].padStart(4, "0");
      out.push({ number: Number(m[2]), strong: `${letter}${digits}${m[3] ?? ""}`, aramaic: m[1] === "A" });
    }
  }
  return out;
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function download(url, file) {
  if (await exists(file)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}

async function loadJson(file) {
  return JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
}

function sensesById(dictionary) {
  const out = new Map();
  for (const entry of dictionary) for (const base of entry.BaseForms ?? []) for (const meaning of base.LEXMeanings ?? []) if (meaning.LEXSenses?.[0]) out.set(meaning.LEXID, meaning.LEXSenses[0]);
  return out;
}

const definitionOf = (sense) => clean(sense?.DefinitionShort || sense?.DefinitionLong || "");

function buildEntry(entry, code, target, english, report) {
  const pos = [];
  const senses = [];
  for (const base of entry.BaseForms ?? []) {
    for (const label of base.PartsOfSpeech ?? []) {
      const text = partOfSpeech(label, target, report);
      if (text && !pos.includes(text)) pos.push(text);
    }
    for (const meaning of base.LEXMeanings ?? []) {
      const own = (meaning.LEXSenses ?? []).find((s) => s.LanguageCode === target.srcLang);
      const en = english.get(meaning.LEXID);
      const sense = own ?? en;
      if (!sense) continue;
      const definition = definitionOf(sense);
      const glosses = (sense.Glosses ?? []).map(clean).filter(Boolean);
      if (!definition && !glosses.length) continue;
      const out = {};
      if (definition) out.definition = definition;
      if (glosses.length) out.glosses = glosses;
      // A sense the source has not translated yet is kept, and said to be in English.
      if (!own) {
        out.lang = "en";
        report.sensesInEnglish += 1;
      } else if (definition && en && definition === definitionOf(en)) {
        out.definitionLang = "en";
        report.definitionsInEnglish += 1;
      }
      const domain = [...(meaning.LEXDomains ?? []), ...(meaning.LEXSubDomains ?? [])].map((d) => clean(d.Domain)).filter(Boolean);
      if (domain.length) out.domain = [...new Set(domain)].join(" · ");
      // The field of meaning the sense is filed under, the narrowest the source gives: the words that share it are
      // listed in `domains/<code>.json`, for whoever wants to see what else could have been said.
      const field = [...(meaning.LEXSubDomains ?? []), ...(meaning.LEXDomains ?? [])].find((d) => clean(d.DomainCode) && clean(d.Domain));
      if (field) {
        out.domainCode = clean(field.DomainCode);
        report.domainNames.set(out.domainCode, clean(field.Domain));
      }
      const entryCode = clean(meaning.LEXEntryCode);
      if (entryCode) out.code = entryCode;
      const comments = clean(sense.Comments);
      if (comments) out.comments = comments;
      out.refs = packRefs(meaning.LEXReferences, report.unknownRefs);
      senses.push(out);
      report.senses += 1;
    }
  }
  if (!senses.length) return null;
  const notes = (entry.Notes ?? []).filter((n) => n.LanguageCode === target.srcLang).map((n) => clean(n.Content)).filter(Boolean);
  const out = { strong: code.strong, lemma: entry.Lemma };
  if (code.aramaic) out.aramaic = true;
  if (pos.length) out.pos = pos;
  out.senses = senses;
  if (notes.length) out.notes = notes;
  return out;
}

/** `brief` and `long` are what translationCore and gateway-edit read; the senses are for tools that can do more. */
function summarize(entries) {
  const all = entries.flatMap((e) => e.senses);
  const firsts = [];
  for (const sense of all) {
    const gloss = sense.glosses?.[0];
    if (gloss && !firsts.includes(gloss)) firsts.push(gloss);
  }
  // "definition: glosses", with no "." before the colon, and the glosses left out when they only repeat it.
  const line = (sense) => {
    const definition = (sense.definition ?? "").replace(/[.;:]+$/, "");
    const glosses = sense.glosses?.join(", ") ?? "";
    return definition && glosses && !definition.toLowerCase().startsWith(glosses.toLowerCase()) ? `${definition}: ${glosses}` : definition || glosses;
  };
  const long = all.length === 1 ? line(all[0]) : all.map((sense, i) => `${i + 1}) ${line(sense)}`).join(" ");
  return { brief: firsts.slice(0, 4).join(", "), long };
}

function manifest(target, count) {
  const greek = target.kind === "greek";
  const title = greek
    ? target.ui === "es" ? "Léxico griego del Nuevo Testamento" : "Léxico grego do Novo Testamento"
    : target.ui === "es" ? "Léxico hebreo y arameo bíblico" : "Léxico hebraico e aramaico bíblico";
  const description =
    target.ui === "es"
      ? `Una entrada por número de Strong (${count}), con definiciones, glosas y los versículos de cada sentido. Adaptado del ${greek ? "UBS Dictionary of the Greek New Testament" : "UBS Dictionary of Biblical Hebrew"}.`
      : `Uma entrada por número de Strong (${count}), com definições, glosas e os versículos de cada sentido. Adaptado do ${greek ? "UBS Dictionary of the Greek New Testament" : "UBS Dictionary of Biblical Hebrew"}.`;
  return `---
dublin_core:
  conformsto: 'rc0.2'
  contributor:
    - 'United Bible Societies'
    - '${greek ? "John Jeffrey Dodson" : "Open Scriptures Hebrew Bible Project"}'
    - 'unfoldingWord'
    - 'Idiomas Puentes'
  creator: 'United Bible Societies'
  description: '${description.replace(/'/g, "''")}'
  format: 'json'
  identifier: '${target.id}'
  issued: '${TODAY}'
  language:
    direction: 'ltr'
    identifier: '${target.lang}'
    title: '${target.langTitle}'
  modified: '${TODAY}'
  publisher: 'Idiomas Puentes'
  relation:
    - '${greek ? "el-x-koine/ugnt" : "hbo/uhb"}'
  rights: 'CC BY-SA 4.0'
  source:
    -
      identifier: '${greek ? "ubs-dgnt" : "ubs-dbh"}'
      language: '${target.srcLang}'
      version: '${target.sourceVersion}'
    -
      identifier: '${target.id}'
      language: 'en'
      version: '0.1'
  subject: '${greek ? "Greek Lexicon" : "Hebrew-Aramaic Lexicon"}'
  title: '${title}'
  type: 'dict'
  version: '1'

checking:
  checking_entity:
    - 'United Bible Societies'
  checking_level: '1'

projects:
  -
    title: '${title}'
    versification: 'ufw'
    identifier: '${target.id}'
    format: 'json'
    sort: 1
    path: './content'
    categories: [ '${greek ? "lex-nt" : "lex-ot"}' ]
`;
}

function readme(target, stats) {
  const greek = target.kind === "greek";
  const credit = CREDIT[target.kind];
  const added = ADDED_FROM[target.kind];
  if (target.ui === "pt") {
    return `# ${target.repo}

Léxico ${greek ? "grego do Novo Testamento" : "hebraico e aramaico bíblico"} em português, uma entrada por número de Strong, para ferramentas de tradução bíblica (alinhamento, revisão).

## Origem e licença

Este recurso é uma **adaptação** do ${greek ? "UBS Dictionary of the Greek New Testament" : "UBS Dictionary of Biblical Hebrew"}, publicado pelas Sociedades Bíblicas Unidas em <https://github.com/ubsicap/ubs-open-license> sob a licença [Creative Commons Atribuição-CompartilhaIgual 4.0](http://creativecommons.org/licenses/by-sa/4.0/).

> ${credit}

Esta adaptação é distribuída sob a mesma licença (ver \`LICENSE.md\`). As Sociedades Bíblicas Unidas não revisaram nem endossam esta adaptação.

### Entradas acrescentadas

A fonte ainda não tem entrada para algumas palavras muito frequentes do texto original. Essas ${stats.added} entradas foram **traduzidas** do [${added.title}](${added.url}) e levam \`"source": "${added.id}"\`:

> ${added.credit}

A tradução foi feita com assistência automática e ainda não foi revisada por uma pessoa; por isso essas entradas levam \`"review": "pending"\`. Do original inglês foram traduzidos o significado e a origem da palavra; a lista de equivalências da versão King James não foi incluída. Os textos traduzidos estão em \`scripts/lexicon-additions/\` do repositório \`taller\`.

## O que foi alterado

O texto das definições e das glosas é o da fonte (versão ${target.sourceVersion}, idioma \`${target.srcLang}\`); nada foi traduzido nem redigido aqui. As alterações são de formato:

- O arquivo único da fonte foi dividido em um arquivo por número de Strong: \`content/<número>.json\`.
- De cada entrada ficam o lema, a categoria gramatical, os sentidos (definição, glosas, domínio semântico, comentários) e os versículos de cada sentido. Flexões, colocações, sinônimos e ligações internas foram omitidos.
- As marcas internas de ligações, notas e referências foram convertidas em texto simples.
- As categorias gramaticais, que na fonte estão em inglês, foram passadas para o português.
- Os campos \`brief\` e \`long\` foram compostos a partir das glosas e definições, para as ferramentas que leem esse formato.
- Os sentidos que a fonte ainda não traduziu ficam em inglês e marcados com \`"lang": "en"\`.

## Formato

\`\`\`json
{
  "brief": "glosas principais",
  "long": "1) definição: glosas 2) …",
  "entries": [
    {
      "strong": "H0776",
      "lemma": "אֶרֶץ",
      "pos": ["subst. f."],
      "senses": [
        { "definition": "…", "glosses": ["…"], "domain": "…", "refs": { "GEN": "1:1,2,10" } }
      ]
    }
  ]
}
\`\`\`

\`refs\` lista, por livro, os versículos em que o sentido se aplica (\`capítulo:versículos\`, capítulos separados por \`;\`). A numeração dos versículos é a da fonte e pode diferir em alguns capítulos.

## Números

- Arquivos (números de Strong): ${stats.files}
- Entradas: ${stats.entries}
- Sentidos: ${stats.senses}
- Sentidos ainda em inglês: ${stats.sensesInEnglish}
- Definições ainda em inglês: ${stats.definitionsInEnglish}
- Entradas acrescentadas do ${added.id}: ${stats.added}

Gerado em ${TODAY} com \`scripts/build-lexicons.mjs\` do repositório \`taller\` de Idiomas Puentes. Não edite \`content/\` à mão: as correções são feitas no script ou na fonte.
`;
  }
  return `# ${target.repo}

Léxico ${greek ? "griego del Nuevo Testamento" : "hebreo y arameo bíblico"} en español, una entrada por número de Strong, para herramientas de traducción bíblica (alineación, revisión).

## Origen y licencia

Este recurso es una **adaptación** del ${greek ? "UBS Dictionary of the Greek New Testament" : "UBS Dictionary of Biblical Hebrew"}, publicado por las Sociedades Bíblicas Unidas en <https://github.com/ubsicap/ubs-open-license> bajo la licencia [Creative Commons Atribución-CompartirIgual 4.0](http://creativecommons.org/licenses/by-sa/4.0/).

> ${credit}

Esta adaptación se distribuye bajo la misma licencia (ver \`LICENSE.md\`). Las Sociedades Bíblicas Unidas no han revisado ni avalan esta adaptación.

### Entradas añadidas

La fuente todavía no tiene entrada para algunas palabras muy frecuentes del texto original. Esas ${stats.added} entradas se **tradujeron** del [${added.title}](${added.url}) y llevan \`"source": "${added.id}"\`:

> ${added.credit}

La traducción se hizo con asistencia automática y todavía no la ha revisado una persona; por eso esas entradas llevan \`"review": "pending"\`. ${greek ? "" : "Del original inglés se tradujeron el significado y el origen de la palabra; la lista de equivalencias de la versión King James no se incluyó. "}Los textos traducidos están en \`scripts/lexicon-additions/\` del repositorio \`taller\`.

## Qué se cambió

El texto de las definiciones y de las glosas es el de la fuente (versión ${target.sourceVersion}, idioma \`${target.srcLang}\`); aquí no se tradujo ni se redactó nada. Los cambios son de formato:

- El archivo único de la fuente se partió en un archivo por número de Strong: \`content/<número>.json\`.
- De cada entrada quedan el lema, la categoría gramatical, los sentidos (definición, glosas, dominio semántico, comentarios) y los versículos de cada sentido. Se omitieron flexiones, colocaciones, sinónimos y enlaces internos.
- Las marcas internas de enlaces, notas y referencias se convirtieron en texto simple.
- Las categorías gramaticales, que en la fuente están en ${greek ? "francés" : "inglés"}, se pasaron al español.
- Los campos \`brief\` y \`long\` se compusieron a partir de las glosas y definiciones, para las herramientas que leen ese formato.
- Los sentidos que la fuente todavía no tradujo quedan en inglés y marcados con \`"lang": "en"\`.

## Formato

\`\`\`json
{
  "brief": "glosas principales",
  "long": "1) definición: glosas 2) …",
  "entries": [
    {
      "strong": "${greek ? "G5228" : "H0776"}",
      "lemma": "${greek ? "ὑπέρ" : "אֶרֶץ"}",
      "pos": ["${greek ? "prep. (con gen. o ac.)" : "sust. f."}"],
      "senses": [
        { "definition": "…", "glosses": ["…"], "domain": "…", "refs": { "${greek ? "3JN" : "GEN"}": "${greek ? "1:7" : "1:1,2,10"}" } }
      ]
    }
  ]
}
\`\`\`

\`refs\` lista, por libro, los versículos donde aplica el sentido (\`capítulo:versículos\`, capítulos separados por \`;\`).${greek ? "" : " La numeración de versículos es la de la fuente y puede diferir en algunos capítulos."}

## Cifras

- Archivos (números de Strong): ${stats.files}
- Entradas: ${stats.entries}
- Sentidos: ${stats.senses}
- Sentidos todavía en inglés: ${stats.sensesInEnglish}
- Definiciones todavía en inglés: ${stats.definitionsInEnglish}
- Entradas añadidas del ${added.id}: ${stats.added}

Generado el ${TODAY} con \`scripts/build-lexicons.mjs\` del repositorio \`taller\` de Idiomas Puentes. No edites \`content/\` a mano: las correcciones se hacen en el guion o en la fuente.
`;
}

async function buildTarget(target, dictionaries, original) {
  const report = { senses: 0, sensesInEnglish: 0, definitionsInEnglish: 0, unknownRefs: { count: 0 }, unknownPos: new Set(), noStrong: 0, leftoverMarks: 0, byLemma: 0, added: 0, domainNames: new Map() };
  const english = sensesById(dictionaries[target.english]);
  const files = new Map();
  let entries = 0;
  for (const entry of dictionaries[target.source]) {
    const codes = strongNumbers(entry.StrongCodes);
    if (!codes.length) {
      report.noStrong += 1;
      continue;
    }
    for (const code of codes) {
      const built = buildEntry(entry, code, target, english, report);
      if (!built) continue;
      if (!files.has(code.number)) files.set(code.number, []);
      files.get(code.number).push(built);
      entries += 1;
    }
  }

  // Strong numbered some inflected forms apart (σοῦ is G4675, σύ is G4771), and the source tags a few entries with
  // the number of a form. The text tags the lemma: an entry whose lemma the text files under a number that has
  // nothing yet is filed there too.
  for (const entry of dictionaries[target.source]) {
    for (const number of original.byLemma.get(String(entry.Lemma ?? "").normalize("NFC")) ?? []) {
      if (files.has(number)) continue;
      const strong = target.kind === "greek" ? `G${number}` : `H${String(number).padStart(4, "0")}`;
      const built = buildEntry(entry, { number, strong, aramaic: false }, target, english, report);
      if (!built) continue;
      files.set(number, [built]);
      entries += 1;
      report.byLemma += 1;
    }
  }

  // What the source lacks and the text uses, from the translated additions. Only where there is nothing:
  // the day the source gains the entry, the source wins.
  const additions = await loadJson(path.join(ADDITIONS_DIR, `${target.id}.json`));
  for (const [key, added] of Object.entries(additions)) {
    const number = Number(key);
    const text = added?.[target.ui];
    if (!number || !text || files.has(number)) continue;
    const sense = { definition: text.definition, glosses: text.glosses };
    if (text.etymology) sense.etymology = text.etymology;
    const strong = target.kind === "greek" ? `G${number}` : `H${String(number).padStart(4, "0")}`;
    // Said in the entry itself: where it comes from, and that a person has not reviewed the translation yet.
    files.set(number, [{ strong, lemma: added.lemma, senses: [sense], source: ADDED_FROM[target.kind].id, review: "pending" }]);
    entries += 1;
    report.senses += 1;
    report.added += 1;
  }

  const repo = path.join(OUT, target.repo);
  const content = path.join(repo, "content");
  await rm(content, { recursive: true, force: true });
  await mkdir(content, { recursive: true });

  // The words of each field of meaning. A field with one word has nobody to be compared with, and one with
  // hundreds (the names of people: 2808 in Hebrew) is a list nobody reads: neither is written, and their senses
  // do not point to one.
  const fields = new Map();
  for (const list of files.values()) {
    for (const entry of list) {
      for (const sense of entry.senses) {
        if (!sense.domainCode) continue;
        if (!fields.has(sense.domainCode)) fields.set(sense.domainCode, new Map());
        const words = fields.get(sense.domainCode);
        if (!words.has(entry.strong)) words.set(entry.strong, { strong: entry.strong, lemma: entry.lemma, gloss: sense.glosses?.[0] ?? "" });
      }
    }
  }
  for (const [code, words] of fields) if (words.size < 2 || words.size > MAX_FIELD_WORDS) fields.delete(code);
  for (const list of files.values()) for (const entry of list) for (const sense of entry.senses) if (sense.domainCode && !fields.has(sense.domainCode)) delete sense.domainCode;
  const domains = path.join(repo, "domains");
  await rm(domains, { recursive: true, force: true });
  await mkdir(domains, { recursive: true });
  for (const [code, words] of fields) {
    // A word Strong numbered twice is listed once: the same lemma with the same gloss reads as a repeated line.
    const once = new Map([...words.values()].reverse().map((word) => [`${word.lemma}\u0000${word.gloss}`, word]));
    const sorted = [...once.values()].sort((a, b) => a.lemma.localeCompare(b.lemma));
    await writeFile(path.join(domains, `${code}.json`), JSON.stringify({ name: report.domainNames.get(code) ?? "", words: sorted }, null, 1) + "\n");
  }
  let bytes = 0;
  let largest = { number: 0, bytes: 0 };
  for (const [number, list] of files) {
    list.sort((a, b) => a.strong.localeCompare(b.strong) || a.lemma.localeCompare(b.lemma));
    // With one sense there is nothing to choose by verse: the list of verses would only be weight.
    if (list.reduce((n, e) => n + e.senses.length, 0) === 1) delete list[0].senses[0].refs;
    const body = JSON.stringify({ ...summarize(list), entries: list }, null, 1) + "\n";
    if (/\{[A-Z]:/.test(body)) report.leftoverMarks += 1;
    bytes += Buffer.byteLength(body);
    if (Buffer.byteLength(body) > largest.bytes) largest = { number, bytes: Buffer.byteLength(body) };
    await writeFile(path.join(content, `${number}.json`), body);
  }
  const stats = { files: files.size, entries, senses: report.senses, sensesInEnglish: report.sensesInEnglish, definitionsInEnglish: report.definitionsInEnglish, added: report.added };
  await writeFile(path.join(repo, "manifest.yaml"), manifest(target, files.size));
  await writeFile(path.join(repo, "README.md"), readme(target, stats));
  await copyFile(path.join(SOURCES_DIR, "LICENSE.md"), path.join(repo, "LICENSE.md"));

  console.log(`\n${target.repo}`);
  console.log(`  ${files.size} files · ${entries} entries · ${report.senses} senses · ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  largest file: ${largest.number}.json, ${(largest.bytes / 1024).toFixed(0)} KB`);
  console.log(`  fields of meaning: ${fields.size} files, ${[...fields.values()].reduce((n, words) => n + words.size, 0)} words in them`);
  console.log(`  still in English: ${report.sensesInEnglish} senses, ${report.definitionsInEnglish} definitions`);
  console.log(`  filed by lemma, under the number the text uses: ${report.byLemma}`);
  console.log(`  added from ${ADDED_FROM[target.kind].id}, translated: ${report.added}`);
  console.log(`  left out: ${report.noStrong} entries with no Strong's number`);
  if (report.unknownRefs.count) console.log(`  references to a book outside the 66: ${report.unknownRefs.count}`);
  if (report.unknownPos.size) console.log(`  grammar labels with no translation: ${[...report.unknownPos].join(", ")}`);
  if (report.leftoverMarks) console.log(`  files with a mark left in the text: ${report.leftoverMarks}`);
  return { target, files };
}

const TEXTS = {
  greek: { repo: "el-x-koine_ugnt", dir: "ugnt" },
  hebrew: { repo: "hbo_uhb", dir: "uhb" },
};

/**
 * The words of an original text as it tags them: how often each Strong's number is used, and which number
 * each lemma carries. The lexicon is read by the number in the text, so that is the number that counts.
 */
async function readOriginal(kind) {
  const text = TEXTS[kind];
  const list = await (await fetch(`${DOOR43}/api/v1/repos/unfoldingWord/${text.repo}/contents/`)).json();
  const names = list.map((f) => f.name).filter((n) => /\.usfm$/i.test(n));
  const numbers = new Map();
  const byLemma = new Map();
  for (const name of names) {
    const file = path.join(SOURCES_DIR, text.dir, name);
    await download(`${DOOR43}/unfoldingWord/${text.repo}/raw/branch/master/${name}`, file);
    const usfm = await readFile(file, "utf8");
    for (const m of usfm.matchAll(/lemma="([^"]*)" strong="([^"]+)"/g)) {
      const lemma = m[1].normalize("NFC");
      for (const part of m[2].split(":")) {
        const n = kind === "greek" ? /^G(\d+)\d$/.exec(part) : /^H(\d+)([a-z])?$/.exec(part);
        if (!n) continue;
        const number = Number(n[1]);
        numbers.set(number, (numbers.get(number) ?? 0) + 1);
        if (!byLemma.has(lemma)) byLemma.set(lemma, new Set());
        byLemma.get(lemma).add(number);
      }
    }
  }
  return { ...text, books: names.length, numbers, byLemma };
}

/** What a tap on a word of the original would not find. */
function coverage(built, originals) {
  for (const { target, files } of built) {
    const { numbers, repo, books } = originals[target.kind];
    const words = [...numbers.values()].reduce((a, b) => a + b, 0);
    const missing = [...numbers.keys()].filter((n) => !files.has(n));
    const missingWords = missing.reduce((n, k) => n + numbers.get(k), 0);
    console.log(`\n${target.repo} against ${repo} (${books} books)`);
    console.log(`  ${numbers.size} Strong's numbers in the text, ${missing.length} with no entry (${((100 * (numbers.size - missing.length)) / numbers.size).toFixed(1)}% covered)`);
    console.log(`  ${words} words in the text, ${missingWords} with no entry (${((100 * (words - missingWords)) / words).toFixed(2)}% covered)`);
    if (missing.length) console.log(`  the most frequent missing: ${missing.sort((a, b) => numbers.get(b) - numbers.get(a)).slice(0, 12).map((n) => `${n}×${numbers.get(n)}`).join(" ")}`);
  }
}

async function main() {
  await mkdir(SOURCES_DIR, { recursive: true });
  console.log(`Sources in ${SOURCES_DIR}`);
  for (const file of Object.values(SOURCE_FILES)) await download(`${UBS}/${file}`, path.join(SOURCES_DIR, path.basename(file)));
  const dictionaries = {};
  for (const [key, file] of Object.entries(SOURCE_FILES)) if (key !== "license") dictionaries[key] = await loadJson(path.join(SOURCES_DIR, path.basename(file)));

  const built = [];
  const originals = { greek: await readOriginal("greek"), hebrew: await readOriginal("hebrew") };
  for (const target of TARGETS) built.push(await buildTarget(target, dictionaries, originals[target.kind]));
  if (flag("--coverage")) coverage(built, originals);
  console.log(`\nWritten to ${OUT}: ${(await readdir(OUT)).filter((n) => !n.startsWith(".")).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
