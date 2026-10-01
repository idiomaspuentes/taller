export const BOOKS: { code: string; name: string }[] = [
  { code: "GEN", name: "Génesis" },
  { code: "EXO", name: "Éxodo" },
  { code: "LEV", name: "Levítico" },
  { code: "NUM", name: "Números" },
  { code: "DEU", name: "Deuteronomio" },
  { code: "JOS", name: "Josué" },
  { code: "JDG", name: "Jueces" },
  { code: "RUT", name: "Rut" },
  { code: "1SA", name: "1 Samuel" },
  { code: "2SA", name: "2 Samuel" },
  { code: "1KI", name: "1 Reyes" },
  { code: "2KI", name: "2 Reyes" },
  { code: "1CH", name: "1 Crónicas" },
  { code: "2CH", name: "2 Crónicas" },
  { code: "EZR", name: "Esdras" },
  { code: "NEH", name: "Nehemías" },
  { code: "EST", name: "Ester" },
  { code: "JOB", name: "Job" },
  { code: "PSA", name: "Salmos" },
  { code: "PRO", name: "Proverbios" },
  { code: "ECC", name: "Eclesiastés" },
  { code: "SNG", name: "Cantar de los Cantares" },
  { code: "ISA", name: "Isaías" },
  { code: "JER", name: "Jeremías" },
  { code: "LAM", name: "Lamentaciones" },
  { code: "EZK", name: "Ezequiel" },
  { code: "DAN", name: "Daniel" },
  { code: "HOS", name: "Oseas" },
  { code: "JOL", name: "Joel" },
  { code: "AMO", name: "Amós" },
  { code: "OBA", name: "Abdías" },
  { code: "JON", name: "Jonás" },
  { code: "MIC", name: "Miqueas" },
  { code: "NAM", name: "Nahúm" },
  { code: "HAB", name: "Habacuc" },
  { code: "ZEP", name: "Sofonías" },
  { code: "HAG", name: "Hageo" },
  { code: "ZEC", name: "Zacarías" },
  { code: "MAL", name: "Malaquías" },
  { code: "MAT", name: "Mateo" },
  { code: "MRK", name: "Marcos" },
  { code: "LUK", name: "Lucas" },
  { code: "JHN", name: "Juan" },
  { code: "ACT", name: "Hechos" },
  { code: "ROM", name: "Romanos" },
  { code: "1CO", name: "1 Corintios" },
  { code: "2CO", name: "2 Corintios" },
  { code: "GAL", name: "Gálatas" },
  { code: "EPH", name: "Efesios" },
  { code: "PHP", name: "Filipenses" },
  { code: "COL", name: "Colosenses" },
  { code: "1TH", name: "1 Tesalonicenses" },
  { code: "2TH", name: "2 Tesalonicenses" },
  { code: "1TI", name: "1 Timoteo" },
  { code: "2TI", name: "2 Timoteo" },
  { code: "TIT", name: "Tito" },
  { code: "PHM", name: "Filemón" },
  { code: "HEB", name: "Hebreos" },
  { code: "JAS", name: "Santiago" },
  { code: "1PE", name: "1 Pedro" },
  { code: "2PE", name: "2 Pedro" },
  { code: "1JN", name: "1 Juan" },
  { code: "2JN", name: "2 Juan" },
  { code: "3JN", name: "3 Juan" },
  { code: "JUD", name: "Judas" },
  { code: "REV", name: "Apocalipsis" },
];

/** The stored name is Spanish (it ends up in titles written to Door43); this is only for showing. */
const BOOK_NAMES_PT: Record<string, string> = {
  GEN: "Gênesis",
  EXO: "Êxodo",
  LEV: "Levítico",
  NUM: "Números",
  DEU: "Deuteronômio",
  JOS: "Josué",
  JDG: "Juízes",
  RUT: "Rute",
  "1SA": "1 Samuel",
  "2SA": "2 Samuel",
  "1KI": "1 Reis",
  "2KI": "2 Reis",
  "1CH": "1 Crônicas",
  "2CH": "2 Crônicas",
  EZR: "Esdras",
  NEH: "Neemias",
  EST: "Ester",
  JOB: "Jó",
  PSA: "Salmos",
  PRO: "Provérbios",
  ECC: "Eclesiastes",
  SNG: "Cântico dos Cânticos",
  ISA: "Isaías",
  JER: "Jeremias",
  LAM: "Lamentações",
  EZK: "Ezequiel",
  DAN: "Daniel",
  HOS: "Oseias",
  JOL: "Joel",
  AMO: "Amós",
  OBA: "Obadias",
  JON: "Jonas",
  MIC: "Miqueias",
  NAM: "Naum",
  HAB: "Habacuque",
  ZEP: "Sofonias",
  HAG: "Ageu",
  ZEC: "Zacarias",
  MAL: "Malaquias",
  MAT: "Mateus",
  MRK: "Marcos",
  LUK: "Lucas",
  JHN: "João",
  ACT: "Atos",
  ROM: "Romanos",
  "1CO": "1 Coríntios",
  "2CO": "2 Coríntios",
  GAL: "Gálatas",
  EPH: "Efésios",
  PHP: "Filipenses",
  COL: "Colossenses",
  "1TH": "1 Tessalonicenses",
  "2TH": "2 Tessalonicenses",
  "1TI": "1 Timóteo",
  "2TI": "2 Timóteo",
  TIT: "Tito",
  PHM: "Filemom",
  HEB: "Hebreus",
  JAS: "Tiago",
  "1PE": "1 Pedro",
  "2PE": "2 Pedro",
  "1JN": "1 João",
  "2JN": "2 João",
  "3JN": "3 João",
  JUD: "Judas",
  REV: "Apocalipse",
};

export function bookName(code: string): string {
  return BOOKS.find((b) => b.code === code)?.name ?? code;
}

/** Book name for the screen, in the interface language. */
export function bookLabel(code: string, language: "es" | "pt"): string {
  return (language === "pt" ? BOOK_NAMES_PT[code] : undefined) ?? bookName(code);
}

/**
 * Lowercase USFM id for chapter study URLs (`tit`, `neh`, `1sa`).
 * Unknown tokens (thematic slugs) return null so callers can disable launch.
 */
export function usfmStudyBookId(book: string): string | null {
  const upper = book.trim().toUpperCase();
  if (!upper || !BOOKS.some((b) => b.code === upper)) return null;
  return upper.toLowerCase();
}

/**
 * Project id in routes / storage.
 * Today often a UBS book code (`NEH`); later may be a thematic slug
 * (`pentateuco-r1`). Known book codes are normalized to uppercase.
 */
export function normalizeProjectId(raw: string): string {
  const id = raw.trim();
  if (!id) return id;
  const upper = id.toUpperCase();
  if (BOOKS.some((b) => b.code === upper)) return upper;
  return id;
}

/** Display label: book name when the id is a known book, else the id itself. */
export function projectDisplayName(projectId: string, language: "es" | "pt" = "es"): string {
  const id = normalizeProjectId(projectId);
  return BOOKS.some((b) => b.code === id) ? bookLabel(id, language) : id;
}

/** True when this project id is a single known Bible book (current MVP shape). */
export function isBookProjectId(projectId: string): boolean {
  const id = normalizeProjectId(projectId);
  return BOOKS.some((b) => b.code === id);
}

/** Default content org for a gateway language (e.g. es-419 → es-419_gl). */
export function defaultContentOrg(lang: string): string {
  const clean = lang.trim().toLowerCase();
  if (!clean) return "es-419_gl";
  return clean.endsWith("_gl") ? clean : `${clean}_gl`;
}

export function defaultTaRepo(lang: string): string {
  const base = lang.trim().toLowerCase().replace(/_gl$/, "");
  return `${base}_ta`;
}

export function defaultTwRepo(lang: string): string {
  const base = lang.trim().toLowerCase().replace(/_gl$/, "");
  return `${base}_tw`;
}
