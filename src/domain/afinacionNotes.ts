import { isIntroRef, parseVerseRef, supportReferenceOf } from "../prep/inventory";
import { alignedGatewayQuoteForHelpQuote } from "./helpQuoteMatch";
import type { AlignmentMap } from "@usfm-tools/types";

/**
 * The elements of the «Revisar notas» step of a Afinación: one per translation
 * note of the chapter, grouped by the category the note points to
 * (metáfora, modismo, pregunta retórica…). The notes come from the source
 * package the administrator chose (English in this team), never from the
 * draft language.
 */

export type NoteItem = {
  /** The note's own id in the TSV; unique in the book and stable across versions of the note. */
  id: string;
  chapter: number;
  verse: number;
  /** Verses the note covers when it spans several. */
  verseTo: number;
  /** tA slug, e.g. `figs-metaphor`; empty for a general-information note. */
  category: string;
  categoryLabel: string;
  /** Link of the support article, when the note has one. */
  supportRef: string;
  /** Original-language quote and which occurrence in the verse. */
  quote: string;
  occurrence: number;
  note: string;
  /** The quote as worded in the aligned English text (ULT or UST), when it can be found. */
  phrase?: string;
  /** Word positions of that phrase in the verse of the aligned text. */
  phraseTokens: number[];
};

const CATEGORY_LABEL: Record<string, string> = {
  "figs-metaphor": "Metáfora",
  "figs-simile": "Símil",
  "figs-idiom": "Modismo",
  "figs-rquestion": "Pregunta retórica",
  "figs-abstractnouns": "Sustantivos abstractos",
  "figs-activepassive": "Activa o pasiva",
  "figs-ellipsis": "Elipsis",
  "figs-exclusive": "«Nosotros» exclusivo",
  "figs-inclusive": "«Nosotros» inclusivo",
  "figs-you": "Formas de «tú»",
  "figs-yousingular": "«Tú» singular",
  "figs-youdual": "«Tú» dual",
  "figs-youplural": "«Tú» plural",
  "figs-123person": "Primera, segunda y tercera persona",
  "figs-aside": "Aparte",
  "figs-rpronouns": "Pronombres reflexivos",
  "writing-oathformula": "Fórmula de juramento",
  "figs-metonymy": "Metonimia",
  "figs-synecdoche": "Sinécdoque",
  "figs-hyperbole": "Hipérbole",
  "figs-doublet": "Doblete",
  "figs-parallelism": "Paralelismo",
  "figs-irony": "Ironía",
  "figs-personification": "Personificación",
  "figs-litotes": "Lítotes",
  "figs-euphemism": "Eufemismo",
  "figs-explicit": "Información implícita",
  "figs-go": "Ir y venir",
  "figs-doublenegatives": "Doble negación",
  "figs-quotations": "Citas",
  "figs-nominaladj": "Adjetivos como sustantivos",
  "figs-genericnoun": "Sustantivos genéricos",
  "figs-events": "Orden de los eventos",
  "figs-distinguish": "Distinguir",
  "figs-hendiadys": "Hendíadis",
  "figs-merism": "Merismo",
  "figs-gendernotations": "Género",
  "figs-possession": "Posesión",
  "figs-declarative": "Oraciones declarativas",
  "figs-imperative": "Imperativos",
  "figs-exclamations": "Exclamaciones",
  "figs-informremind": "Informar y recordar",
  "figs-pronouns": "Pronombres",
  "figs-sentences": "Oraciones",
  "figs-verbs": "Verbos",
  "figs-nominaladjs": "Adjetivos como sustantivos",
  "translate-names": "Nombres",
  "translate-unknown": "Cosas desconocidas",
  "translate-numbers": "Números",
  "translate-bdistance": "Distancias",
  "translate-bvolume": "Volúmenes",
  "translate-bweight": "Pesos",
  "translate-bmoney": "Dinero",
  "translate-transliterate": "Transliterar",
  "translate-textvariants": "Variantes del texto",
  "translate-symaction": "Acciones simbólicas",
  "translate-hebrewmonths": "Meses hebreos",
  "translate-ordinal": "Ordinales",
  "translate-fraction": "Fracciones",
  "translate-versebridge": "Versículos unidos",
  "translate-blessing": "Bendiciones",
  "translate-source": "Fuentes",
  "writing-background": "Información de fondo",
  "writing-newevent": "Eventos nuevos",
  "writing-participants": "Participantes",
  "writing-pronouns": "Pronombres",
  "writing-quotations": "Citas",
  "writing-politeness": "Cortesía",
  "writing-symlanguage": "Lenguaje simbólico",
  "grammar-collectivenouns": "Sustantivos colectivos",
  "grammar-connect-logic-result": "Conexiones: resultado",
  "grammar-connect-logic-goal": "Conexiones: propósito",
  "grammar-connect-logic-contrast": "Conexiones: contraste",
  "grammar-connect-logic-reason": "Conexiones: razón",
  "grammar-connect-condition-fact": "Condiciones",
  "grammar-connect-condition-hypothetical": "Condiciones hipotéticas",
  "grammar-connect-condition-contrary": "Condiciones contrarias",
  "grammar-connect-time-sequential": "Tiempo: secuencia",
  "grammar-connect-time-simultaneous": "Tiempo: a la vez",
  "grammar-connect-time-background": "Tiempo: trasfondo",
  "grammar-connect-words-phrases": "Conectar palabras y frases",
  "grammar-connect-exceptions": "Excepciones",
};

/** `rc://*​/ta/man/translate/figs-metaphor` → `figs-metaphor`. */
export function categoryFromSupportRef(ref: string): string {
  const clean = ref.trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  if (!clean) return "";
  return (clean.split("/").pop() ?? "").trim().toLowerCase();
}

/**
 * Where the article lives in an Academy repository: `rc://*​/ta/man/translate/figs-metaphor` →
 * `translate/figs-metaphor` (its `title.md`, `sub-title.md` and `01.md` are in that folder). Empty when the note
 * points to no article.
 */
export function articlePathOf(supportRef: string): string {
  const clean = supportRef.trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  const m = /\/ta\/man\/(.+)$/.exec(clean);
  if (m) return m[1]!.toLowerCase();
  // A bare `translate/figs-metaphor`, or only the slug: articles about translating are in `translate`.
  if (!clean || clean.includes("://")) return "";
  return clean.includes("/") ? clean.toLowerCase() : `translate/${clean.toLowerCase()}`;
}

/** What an Academy article is called and what it answers, as its repository says it. */
export type ArticleInfo = { title: string; question?: string; /** Read from the team's own Academy (its language) and not from the source package. */ own?: boolean };

/**
 * The name shown for the figure or topic a note points to: the title of its Academy article in the team's
 * language when the team translated it; else the name this app knows it by; else the title in the source package.
 */
export function articleName(item: Pick<NoteItem, "category" | "categoryLabel">, info: ArticleInfo | undefined, known: (label: string) => string): string {
  if (info?.own && info.title) return info.title;
  if (CATEGORY_LABEL[item.category]) return known(item.categoryLabel);
  return info?.title || known(item.categoryLabel);
}

export function categoryLabel(category: string): string {
  if (!category) return "Información general";
  const known = CATEGORY_LABEL[category];
  if (known) return known;
  const words = category.replace(/^(figs|translate|writing|grammar)-/, "").replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function normalizeNote(text: string): string {
  return text.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").trim();
}

/** One item per note of the chapter; intro notes and rows without a verse are left out. */
export function parseNoteRows(rows: Record<string, string>[], chapter: number): NoteItem[] {
  const items: NoteItem[] = [];
  for (const row of rows) {
    const reference = (row.Reference ?? row.reference ?? "").trim();
    if (!reference || isIntroRef(reference)) continue;
    const parsed = parseVerseRef(reference);
    if (!parsed || parsed.chapter !== chapter) continue;
    const id = (row.ID ?? row.Id ?? row.id ?? "").trim();
    if (!id) continue;
    const supportRef = supportReferenceOf(row);
    const category = categoryFromSupportRef(supportRef);
    const occurrence = Math.max(1, parseInt(row.Occurrence ?? row.occurrence ?? "1", 10) || 1);
    items.push({
      id,
      chapter,
      verse: parsed.verses[0]!,
      verseTo: parsed.verses[parsed.verses.length - 1]!,
      category,
      categoryLabel: categoryLabel(category),
      supportRef,
      quote: (row.Quote ?? row.quote ?? "").trim(),
      occurrence,
      note: normalizeNote(row.Note ?? row.note ?? ""),
      phraseTokens: [],
    });
  }
  return items;
}

/**
 * Fill the quote as worded in the aligned English text. The original quote is
 * carried to the English words through the alignment; if the verse has none,
 * the phrase stays empty and the original quote is shown instead.
 */
export function attachPhrases(
  items: NoteItem[],
  aligned: { verseTexts: Record<number, string>; alignments?: AlignmentMap; book: string },
): NoteItem[] {
  return items.map((item) => {
    const verseText = aligned.verseTexts[item.verse];
    if (!verseText || !item.quote) return item;
    const hit = alignedGatewayQuoteForHelpQuote({
      verseText,
      quote: item.quote,
      occurrence: item.occurrence,
      alignments: aligned.alignments,
      book: aligned.book,
      chapter: item.chapter,
      verse: item.verse,
    });
    return { ...item, phrase: hit.gatewayText ?? undefined, phraseTokens: hit.tokenIndices };
  });
}

export function sortByVerse(items: NoteItem[]): NoteItem[] {
  return [...items].sort((a, b) => a.verse - b.verse || (a.phraseTokens[0] ?? 9999) - (b.phraseTokens[0] ?? 9999) || a.id.localeCompare(b.id));
}

export type NoteGroup = { category: string; label: string; items: NoteItem[] };

/** Groups in order of first appearance in the chapter; items keep verse order. */
export function groupByCategory(items: NoteItem[]): NoteGroup[] {
  const groups = new Map<string, NoteGroup>();
  for (const item of sortByVerse(items)) {
    const group = groups.get(item.category) ?? { category: item.category, label: item.categoryLabel, items: [] };
    group.items.push(item);
    groups.set(item.category, group);
  }
  return [...groups.values()];
}
