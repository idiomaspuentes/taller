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

export function bookName(code: string): string {
  return BOOKS.find((b) => b.code === code)?.name ?? code;
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
